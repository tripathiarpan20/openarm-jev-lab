"""Single-episode HTTP worker. Native MuJoCo runs here, never in Vercel.

Only fixed simulator arguments are accepted; no paths, prompts, shell commands or
URLs come from the browser. Bind loopback locally; require a secret off loopback.
"""
import argparse
import base64
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import uuid


class Worker:
    def __init__(self, args):
        self.args = args
        self.process = None
        self.out = None
        self.stopped = False
        self.lock = threading.RLock()

    def start(self):
        with self.lock:
            if self.process and self.process.poll() is None:
                return 409, {"error": "A simulation is already running"}
            self.out = Path(self.args.output).resolve() / ("web-" + uuid.uuid4().hex)
            # The runner creates the unique output directory, so keep logs outside.
            self.out.parent.mkdir(parents=True, exist_ok=True)
            command = [sys.executable, "-m", "jev_robot.run_libero", "--libero-root", self.args.libero_root,
                       "--assets-root", self.args.assets_root, "--suite", "libero_spatial_swap", "--task-id", "0",
                       "--init-index", "0", "--seed", "7", "--observation-mode", "sim-oracle",
                       "--action-set", "grounded", "--max-calls", "44", "--max-steps", "220", "--output", str(self.out)]
            if self.args.env_file:
                command += ["--env-file", self.args.env_file]
            if self.args.sim_smoke:
                command += ["--sim-smoke"]
            self.stopped = False
            with self.out.with_suffix(".log").open("wb") as log:
                self.process = subprocess.Popen(command, cwd=Path(__file__).resolve().parents[1], stdout=log, stderr=log)
            return 202, {"status": "starting", "run_id": self.out.name, "smoke": self.args.sim_smoke}

    def stop(self):
        with self.lock:
            if self.process and self.process.poll() is None:
                self.stopped = True
                self.process.terminate()
                try:
                    self.process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait(timeout=5)
            return 200, {"status": "stopped"}

    def snapshot(self):
        with self.lock:
            if self.out is None:
                return {"status": "ready", "smoke": self.args.sim_smoke}
            running = self.process.poll() is None
            value = {"status": "running" if running else "stopped" if self.stopped else "finished",
                     "run_id": self.out.name, "smoke": self.args.sim_smoke}
            for name in ("result.json", "live.json"):
                try:
                    value["result"] = json.loads((self.out / name).read_text())
                    break
                except (OSError, ValueError):
                    pass
            if not running and (self.stopped or self.process.returncode != 0):
                value["status"] = "stopped" if self.stopped else "error"
                value["error"] = "Stopped by operator" if self.stopped else "Simulator failed; inspect the worker's local log"
                if "result" in value:
                    value["result"] = {**value["result"], "termination": value["status"], "success": False}
            try:
                lines = (self.out / "decisions.jsonl").read_text().splitlines()
                value["decisions"] = []
                for line in lines:
                    try:
                        value["decisions"].append(json.loads(line))
                    except ValueError:
                        pass  # Writer may be between bytes of the newest line.
            except OSError:
                pass
            try:
                value["frame"] = "data:image/jpeg;base64," + base64.b64encode((self.out / "frame.jpg").read_bytes()).decode()
            except OSError:
                pass
            return value


def handler_for(worker, token):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def respond(self, status, value):
            data = json.dumps(value).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def authorized(self):
            # No CORS. The fixed header blocks browser form/no-cors requests locally.
            return self.headers.get("X-Jev-Lab") == "simulation-proxy" and (
                not token or hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + token))

        def do_GET(self):
            if not self.authorized():
                return self.respond(403, {"error": "Forbidden"})
            if self.path != "/status":
                return self.respond(404, {"error": "Not found"})
            self.respond(200, worker.snapshot())

        def do_POST(self):
            if not self.authorized():
                return self.respond(403, {"error": "Forbidden"})
            if self.path == "/start":
                status, value = worker.start()
            elif self.path == "/stop":
                status, value = worker.stop()
            else:
                status, value = 404, {"error": "Not found"}
            self.respond(status, value)
    return Handler


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8788)
    p.add_argument("--libero-root", default="third_party/LIBERO-PRO")
    p.add_argument("--assets-root", default="third_party/pro-assets")
    p.add_argument("--env-file")
    p.add_argument("--output", default="artifacts")
    p.add_argument("--sim-smoke", action="store_true", help="Installation check only; no Jev calls or task solving")
    args = p.parse_args()
    token = os.environ.get("SIMULATOR_TOKEN", "")
    if args.host not in ("127.0.0.1", "localhost") and len(token) < 24:
        p.error("Off-loopback workers require SIMULATOR_TOKEN of at least 24 characters and an HTTPS reverse proxy")
    for key in ("libero_root", "assets_root", "env_file", "output"):
        if getattr(args, key):
            setattr(args, key, str(Path(getattr(args, key)).resolve()))
    worker = Worker(args)
    server = ThreadingHTTPServer((args.host, args.port), handler_for(worker, token))
    print("MuJoCo worker: http://%s:%s (one bounded episode at a time)" % (args.host, args.port), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        worker.stop()
        server.server_close()


if __name__ == "__main__":
    main()
