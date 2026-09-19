import argparse
import asyncio
import http

from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed

from .cloudflare import CloudflareJev, JevError, load_env
from .policy import JevPolicy
from .wire import pack, unpack


class PolicyServer:
    def __init__(self, factory):
        self.factory = factory

    async def handler(self, ws):
        policy = self.factory()  # State and call budget are isolated per connection.
        await ws.send(pack(policy.metadata))
        try:
            async for message in ws:
                try:
                    obs = unpack(message)
                    if obs.get("reset") is True:
                        policy.reset()
                        await ws.send(pack({"reset": True}))
                        continue
                    result = await asyncio.to_thread(policy.infer, obs)
                    await ws.send(pack(result))
                except Exception as exc:
                    # Match OpenPI's text error framing, without traceback or secrets.
                    msg = str(exc) if isinstance(exc, JevError) else "Invalid observation or controller failure"
                    await ws.send(msg)
                    await ws.close(code=1011, reason="Policy inference failed")
                    return
        except ConnectionClosed:
            return


def health(connection, request):
    if request.path == "/healthz":
        return connection.respond(http.HTTPStatus.OK, "OK\n")


async def run(factory, host, port):
    async with serve(PolicyServer(factory).handler, host, port, compression=None,
                     max_size=8 * 1024 * 1024, process_request=health) as server:
        print("Jev policy server listening on ws://%s:%s" % (host, port), flush=True)
        await server.serve_forever()


def main():
    p = argparse.ArgumentParser(description="Jev-only experimental LIBERO policy server")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--env-file")
    p.add_argument("--observation-mode", choices=("proprio", "sim-oracle"), required=True)
    p.add_argument("--action-set", choices=("discrete", "grounded"), default="discrete")
    p.add_argument("--horizon", type=int, default=5)
    p.add_argument("--max-calls", type=int, default=40)
    p.add_argument("--confidence-floor", type=float, default=0.0)
    args = p.parse_args()
    load_env(args.env_file)
    client = CloudflareJev()
    factory = lambda: JevPolicy(client, args.observation_mode, args.horizon, args.max_calls, args.confidence_floor, args.action_set)
    factory()  # Validate before binding.
    try:
        asyncio.run(run(factory, args.host, args.port))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
