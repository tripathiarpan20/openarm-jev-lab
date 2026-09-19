import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const controller = path.join(root, "experiments/jev-controller");
const python = path.join(controller, ".venv/bin/python");
if (!existsSync(python)) {
  console.error(
    "Install the simulator first: cd experiments/jev-controller && bash setup.sh",
  );
  process.exit(1);
}
const env = {
  ...process.env,
  PORT: process.env.PORT || "4318",
  SIMULATOR_URL: "http://127.0.0.1:8788",
};
const children = [
  spawn(python, ["-m", "jev_robot.worker", "--env-file", "../../.env"], {
    cwd: controller,
    env,
    stdio: "inherit",
  }),
  spawn(process.execPath, ["--env-file-if-exists=.env", "server.mjs"], {
    cwd: root,
    env,
    stdio: "inherit",
  }),
];
let closing = false;
function stop(code = 0) {
  if (closing) return;
  closing = true;
  process.exitCode = code;
  for (const p of children) p.kill("SIGINT");
  setTimeout(() => {
    for (const p of children) if (p.exitCode === null) p.kill("SIGKILL");
    process.exit(code);
  }, 6000).unref();
}
for (const p of children) {
  p.on("error", () => stop(1));
  p.on("exit", (code) => stop(code || 0));
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
