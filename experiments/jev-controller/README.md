# Jev controller: geometry-aware update

This folder now belongs to the `openarm-jev-lab` feature branch. The original
195-direction controller is preserved under `--action-set discrete` (the default).
Use **`--action-set grounded --observation-mode sim-oracle`** for the improved
controller. The grounded menu requires simulator collision bounds and the measured
finger-closing axis in addition to object poses; it cannot operate on the unmodified
RGB-only evaluator payload.

See the [root README](../../README.md) for action-by-action explanations, web
controls, Vercel settings, and a successful measured grasp-and-place recording.

Start the live web worker from this directory after setup and asset download:

```bash
.venv/bin/python -m jev_robot.worker --env-file ../../.env
```

The root Node app proxies to `http://127.0.0.1:8788`. Use a separate terminal for
`npm start` at the repository root. The worker serves `GET /tasks` and accepts `POST /query` or `POST /start` with
validated `suite`, `task_id`, `init_index`, `seed`, `instruction`, and `max_calls`
settings. The web API wraps these in `{op, settings}`. Budgets are 1–80 calls.
`POST /stop` cancels the active job. No client-supplied paths, URLs or shell commands
are accepted. Each selected task must exist in the installed catalog.

CLI equivalents for a new task and a custom query:

```bash
.venv/bin/python -m jev_robot.run_libero \
  --libero-root third_party/LIBERO-PRO --assets-root third_party/pro-assets \
  --suite libero_spatial_swap --task-id 2 --init-index 1 --seed 9 \
  --observation-mode sim-oracle --action-set grounded --env-file ../../.env

# Same flags, plus:
# --instruction="Lift the black bowl and hold it raised" --query-only
```

Custom goals are unscored; `success` is null. The underlying scene predicate is
logged separately as `environment_goal_reached`. Query-only runs return a proposed
action and never execute that chunk. The public replay fixtures are historical,
not automatically overwritten by new queries or runs.

For a grounded websocket run, pass `--action-set grounded` to **both** the policy
server and runner. The policy server still emits the same normalized OSC `(N,7)`
chunks and binary OpenPI framing. Set the server's call budget explicitly.

The remainder documents the original baseline and transport contract.

---

# Jev movement controller for OpenRoboto / LIBERO

A working experimental **policy adapter**, not a checkpoint miner submission.
Jev selects one coordinated movement from a 195-action catalog. Ordinary code
decodes that choice into a short `(H, 7)` action chunk, MuJoCo executes it, and
Jev receives fresh state before selecting again. No other AI model or scripted
pick-and-place policy selects movements.

## What is compatible

| Surface | Support |
|---|---|
| OpenPI websocket transport used by OpenRoboto | Binary msgpack + NumPy arrays, metadata handshake, `infer` response |
| LIBERO action semantics | Normalized `OSC_POSE`: end-effector XYZ translation, XYZ rotation, gripper |
| Action output | Finite float32 `(H, 7)` array, `H=1..5`, default 5 |
| Standard policy request | `observation/state` (8), RGB fields, `prompt`, `task_suite` |
| LIBERO-Pro | Pinned simulator; base suites and downloaded perturbation suites |
| xArm hardware `50 × 7` joint commands | **Not implemented.** Different units, reference frames and gripper convention |
| Official miner admission | **Not supported.** This is an API-backed experimental controller, not LingBot/π0.5 weights |

The physical xArm contract is not LIBERO's simulation contract. Do not send
these normalized end-effector commands to a joint-space hardware controller.
This project does not pay fees, register a miner, publish weights, or write
scores into OpenRoboto's backend.

## Two explicit observation modes

**`sim-oracle`** reads object poses, relative offsets, fixture sites and gripper
contacts directly from the simulator. It is useful for testing whether Jev can
control motion given good state. These observations are privileged and are not
available in the standard RGB policy request. Every result is labelled accordingly.
The adapter does not send task success predicates or a privileged action plan to Jev.

**`proprio`** accepts the unmodified evaluator request, but Jev currently uses only
the task instruction and eight proprioceptive values. The RGB arrays are accepted
by the protocol and **not interpreted**. This mode is a transport/ablation path,
not a credible camera-based manipulation solution. It rejects injected oracle data.

A real camera-compatible miner would still need a validated perception solution
and an evaluator interface permitting this controller, or a distilled compatible
checkpoint. Simulator compatibility does not establish miner eligibility.

## Run locally

From this directory, install once (Git and `uv` are required):

```bash
bash setup.sh
.venv/bin/python -m pytest -q
```

The setup pins LIBERO-Pro and the OpenPI client, and creates an isolated Python
3.11 environment. It downloads no VLA checkpoint and needs no inference GPU:
Jev is hosted, and MuJoCo physics runs locally. On Linux, rendering defaults to
EGL; use a functioning EGL driver or set `MUJOCO_GL=osmesa` with the required
system libraries. The original evaluator uses a different Python/client stack;
this portable environment is an experiment, not numerically qualified production
benchmark infrastructure.

Check the simulator without spending any Jev calls:

```bash
.venv/bin/python -m jev_robot.run_libero \
  --libero-root third_party/LIBERO-PRO \
  --observation-mode sim-oracle --sim-smoke
```

For a live Jev run, reuse the credentials already configured in the earlier demo:

```bash
.venv/bin/python -m jev_robot.run_libero \
  --libero-root third_party/LIBERO-PRO \
  --observation-mode sim-oracle \
  --env-file ../../.env \
  --max-calls 40 --max-steps 200
```

Alternatively export `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` and omit
`--env-file`. The dotenv loader reads only those keys and does not execute shell
code. Credentials are neither copied into this project nor logged.

The run writes a new directory in `artifacts/`:

- `rollout.mp4`: the actual simulator recording, rendered at 20 simulation FPS.
- `final.png`: final observed camera frame.
- `index.html`: local video viewer with synchronized Jev choices and measurements.
- `decisions.jsonl`: Jev choices, probabilities, confidence, latency, usage,
  decoded actions, robot state and explicit oracle observations when enabled.
- `result.json`: simulator-reported success, termination cause, calls, steps,
  model/observation metadata and source revision.

Video time is **simulation time**. API waits are excluded from playback; the result
and per-call log retain actual elapsed time. A failed task is still a completed
experiment; `success: false` must not be presented as successful manipulation.

## Try an OpenRoboto position-swap suite

Download only the selected suite at the recorded dataset revision:

```bash
.venv/bin/python scripts/download_pro_assets.py \
  --suite libero_spatial_swap \
  --revision c86fc3b8293185a6f373677018ff3e37f8391602

.venv/bin/python -m jev_robot.run_libero \
  --libero-root third_party/LIBERO-PRO \
  --assets-root third_party/pro-assets \
  --suite libero_spatial_swap --task-id 0 --init-index 0 \
  --observation-mode sim-oracle \
  --env-file ../../.env \
  --max-calls 44 --max-steps 220
```

Task instructions come from the BDDL environment, as needed for changed-language
and changed-goal suites. The runner uses the selected official initial state,
seed 7 by default, and ten stabilization steps. It does not reproduce the full
16-suite scoring campaign or OpenRoboto's mixed seeded-initial-state protocol.

## Run through the websocket adapter

Terminal 1:

```bash
.venv/bin/python -m jev_robot.server \
  --observation-mode sim-oracle --port 8766 --max-calls 44 \
  --env-file ../../.env
```

Terminal 2:

```bash
.venv/bin/python -m jev_robot.run_libero \
  --libero-root third_party/LIBERO-PRO \
  --assets-root third_party/pro-assets --suite libero_spatial_swap \
  --observation-mode sim-oracle --server ws://127.0.0.1:8766 \
  --max-calls 44 --max-steps 220
```

Each connection gets separate history, remembered gripper state and call budget.
The experimental client opens a new connection for each trial. An explicit
`{"reset": true}` request also resets the server's episode state.

### Unmodified OpenRoboto evaluation client

Start this server with `--observation-mode proprio`. In an already configured,
pinned OpenRoboto evaluation checkout, use its client environment:

```bash
third_party/openpi/examples/libero/.venv/bin/python libero_eval/eval_task.py \
  --host 127.0.0.1 --port 8766 \
  --task-suite-name libero_spatial --task-id 0 \
  --num-trials 1 --replan-steps 5 --max-steps 200 \
  --out-json /tmp/jev-proprio-contract.json
```

Use **one trial per invocation**. Upstream `WebsocketClientPolicy.reset()` is a
no-op and that evaluator reuses one connection across trials; it cannot reset
this controller's memory between multiple episodes without a client change.
An upstream evaluation package / PYTHONPATH and LIBERO configuration must already
be prepared. `setup.sh` here installs the simulator and policy client only, not
OpenRoboto's CUDA checkpoint-serving environments or its full scheduler.

## Exactly what Jev decides

The 195 options are:

- 26 nonzero XYZ direction combinations × 2 magnitudes × 3 gripper choices = 156.
- 3 rotation axes × 2 signs × 2 magnitudes × 3 gripper choices = 36.
- Stationary motion × 3 gripper choices = 3.

Magnitudes are normalized controller values `0.08` and `0.25`, not metres or
radians. The gripper choices are keep the previous command, open (`-1`), and
close (`+1`). A single option coordinates all seven channels. Translation and
rotation are separate primitives in this first catalog; simultaneous translation
and rotation are not offered. The underlying simulator handles motor control.

One Jev request selects one option; code repeats its seven-vector for the chosen
1–5-step horizon. There is no rule selecting the target object, no automatic
grasp, no teleport, no fallback policy, and no precomputed task trajectory.

Provider failures, malformed choices/distributions, and exhausted budgets abort
the run. `--confidence-floor` can abort low-confidence decisions. Its default is
zero for exploratory simulation: a probability-distribution confidence is not a
verified safety or correctness guarantee. No retries secretly substitute an action.

## Validation and source pins

See [VALIDATION.md](VALIDATION.md) for measured evidence and limitations.

- OpenRoboto subnet: `726e42aea3a8901dc2f431ab8d17c7d5c46594a4`.
- OpenRoboto evaluation: `fd1a52a98546ff0fa52da4955e38f21deac4b2eb`.
- LIBERO-Pro: `eafdb809426b13153aa1e4c42d6601844217dfec`.
- OpenPI client: `15a9616a00943ada6c20a0f158e3adb39df2ccac`.
- Jev: only `typesafe/jev`; actual served model identity is logged per answer.
  The hosted alias is not an immutable model pin.

Protocol references: [evaluation client](https://github.com/openroboto-ai/openroboto-evaluation/blob/fd1a52a98546ff0fa52da4955e38f21deac4b2eb/libero_eval/eval_task.py),
[OpenPI transport](https://github.com/Physical-Intelligence/openpi/blob/15a9616a00943ada6c20a0f158e3adb39df2ccac/packages/openpi-client/src/openpi_client/websocket_client_policy.py),
[Jev Choice](https://docs.typesafe.ai/primitives/choice).

The transport encoding follows OpenPI's public msgpack NumPy representation;
see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
