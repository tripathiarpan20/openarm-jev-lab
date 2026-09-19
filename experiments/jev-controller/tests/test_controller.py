import asyncio
import copy

import numpy as np
import pytest
from websockets.asyncio.client import connect
from websockets.asyncio.server import serve

from jev_robot.actions import ACTIONS, decode
from jev_robot.cloudflare import JevError, parse
from jev_robot.policy import JevPolicy
from jev_robot.server import PolicyServer
from jev_robot.wire import pack, unpack


def response(choice="translate_coarse_p00_close", confidence=0.9):
    return {"result": {"state": "Completed", "result": {"model": "jev-test-fixture", "answers": {
        "movement": {"type": "choice", "choice": choice, "confidence": confidence,
                     "probabilities": {choice: 1.0}}}}}}


def obs(oracle=True):
    data = {"observation/state": np.array([0.1, 0.2, 0.9, 0, 0, 0, 0.04, -0.04]), "prompt": "Put cup on plate"}
    if oracle:
        data["observation/scene"] = {"source": "simulator_ground_truth", "objects": []}
    return data


def test_catalog_is_jointly_decoded_and_bounded():
    assert len(ACTIONS) <= 255
    assert len(ACTIONS) == 195
    for name in ACTIONS:
        chunk = decode(name, 5, -1.0)
        assert chunk.shape == (5, 7)
        assert np.isfinite(chunk).all() and np.abs(chunk).max() <= 1
    np.testing.assert_array_equal(decode("translate_coarse_p00_close", 1, -1)[0], [.25, 0, 0, 0, 0, 0, 1])
    assert decode("hold_keep", 1, 1)[0, 6] == 1


@pytest.mark.parametrize("choice,confidence", [("invented", .9), ("hold_keep", float("nan")), ("hold_keep", True)])
def test_malformed_provider_answer_cannot_move_robot(choice, confidence):
    with pytest.raises(JevError):
        parse(response(choice, confidence), ACTIONS, 0)


def test_probability_and_confidence_gates():
    p = response()
    p["result"]["result"]["answers"]["movement"]["probabilities"] = {"hold_keep": .4}
    with pytest.raises(JevError):
        parse(p, ACTIONS, 0)
    with pytest.raises(JevError):
        parse(response(confidence=.2), ACTIONS, .5)


def test_privileged_state_never_silently_enters_standard_mode():
    with pytest.raises(JevError, match="forbids"):
        JevPolicy(lambda _: response(), "proprio").infer(obs())
    with pytest.raises(JevError, match="requires"):
        JevPolicy(lambda _: response(), "sim-oracle").infer(obs(False))


def test_history_grip_and_budget_reset():
    requests = []
    def client(req):
        requests.append(copy.deepcopy(req))
        return response("hold_close" if len(requests) == 1 else "hold_keep")
    policy = JevPolicy(client, "sim-oracle", max_calls=2)
    policy.infer(obs())
    assert policy.infer(obs())["actions"][0, 6] == 1
    assert requests[1]["state"]["recent_decisions_and_observations"][0]["choice"] == "hold_close"
    with pytest.raises(JevError, match="budget"):
        policy.infer(obs())
    policy.reset()
    assert policy.grip == -1 and not policy.history and policy.calls == 0


def test_failed_call_consumes_budget_without_fallback():
    policy = JevPolicy(lambda _: {"success": False}, "sim-oracle", max_calls=1)
    with pytest.raises(JevError):
        policy.infer(obs())
    assert policy.calls == 1 and policy.grip == -1 and policy.history == []


def test_wire_roundtrip_and_object_array_rejection():
    data = obs()
    np.testing.assert_array_equal(unpack(pack(data))["observation/state"], data["observation/state"])
    with pytest.raises(ValueError):
        pack(np.array([object()], dtype=object))


def test_websocket_metadata_chunk_and_connection_isolation():
    async def scenario():
        server = PolicyServer(lambda: JevPolicy(lambda _: response(), "sim-oracle", max_calls=1))
        async with serve(server.handler, "127.0.0.1", 0, compression=None) as running:
            port = running.sockets[0].getsockname()[1]
            for _ in range(2):
                async with connect("ws://127.0.0.1:%d" % port) as client:
                    assert unpack(await client.recv())["choices"] == 195
                    await client.send(pack(obs()))
                    assert unpack(await client.recv())["actions"].shape == (5, 7)
                    await client.send(pack(obs()))
                    assert "budget" in await client.recv()
    asyncio.run(scenario())
