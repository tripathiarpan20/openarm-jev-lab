"""Integration with the actual pinned upstream client, installed by setup.sh."""
import asyncio
import numpy as np
import pytest
from websockets.asyncio.server import serve

from jev_robot.policy import JevPolicy
from jev_robot.server import PolicyServer


def test_upstream_openpi_client_decodes_real_server():
    client_module = pytest.importorskip("openpi_client.websocket_client_policy")
    def fake_jev(_):
        return {"answers": {"movement": {"type": "choice", "choice": "hold_open", "confidence": 1.,
                                          "probabilities": {"hold_open": 1.}}}}
    async def scenario():
        async with serve(PolicyServer(lambda: JevPolicy(fake_jev, "proprio")).handler,
                         "127.0.0.1", 0, compression=None) as server:
            port = server.sockets[0].getsockname()[1]
            def use_client():
                client = client_module.WebsocketClientPolicy("127.0.0.1", port)
                try:
                    assert client.get_server_metadata()["action_dim"] == 7
                    result = client.infer({"observation/state": np.zeros(8), "prompt": "hold position",
                                           "observation/image": np.zeros((224, 224, 3), dtype=np.uint8)})
                    np.testing.assert_array_equal(result["actions"], np.tile([0, 0, 0, 0, 0, 0, -1], (5, 1)))
                finally:
                    client._ws.close()
            await asyncio.to_thread(use_client)
    asyncio.run(scenario())
