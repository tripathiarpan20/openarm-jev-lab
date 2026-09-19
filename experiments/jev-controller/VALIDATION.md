# Geometry-aware controller and web demo validation

2026-09-19; branch `arpan/jev-openroboto-web-demo` in `openarm-jev-lab`.
The prior baseline report is preserved below.

## Measured final-controller runs

Task: `libero_spatial_swap`, task 0, initial state 0, seed 7. Five-step chunks,
maximum 44 requests and 220 simulation steps. Hosted model: `jev-1.13.0` via
`typesafe/jev`. Both trials use privileged simulator geometry and contacts.

| Artifact | Simulator success | Calls | Steps | Median request | Rollout wall time |
| --- | --- | --- | --- | --- | --- |
| `grounded-5` / public `improved` | true | 35 | 173 | 440.05 ms | 26.02 s |
| `web-2bedb3c1fdc444768f1738d85728643e` / public `web-live` | true | 21 | 103 | 454.10 ms | 16.51 s |

The second trial was started through the Node `/api/simulation` endpoint, which
called the native worker, which launched the actual pinned MuJoCo environment and
live Jev policy. The API returned camera frames, all 21 decisions, and the final
simulator success result. No model answers were mocked for these runs. The worker
trial records source hashes captured at startup. Later validation-only changes
reject missing geometry and mismatched action sets; recorded action regeneration
checks cover both successful traces. Render/video time excludes inference waits;
rollout wall time excludes simulator initialization.

Bundled evidence: [manifest](../../public/runs/manifest.json),
[first success](../../public/runs/improved/result.json),
[web-worker success](../../public/runs/web-live/result.json), and accompanying
`trace.json`, `decisions.jsonl`, `rollout.mp4`, and `final.png` files.

## Development failures retained locally

- `grounded-1`: faster approach, then central rim collision; no grasp.
- `grounded-2`: additional rim choices alone did not solve the collision.
- `grounded-3`: wrong assumed closing axis; closed without securing the bowl.
- `grounded-4`: measured closing axis enabled grasp/lift/transport, but no release.
- `grounded-5`: explicit nearby-destination release choice completed the task.

These changed-policy trials are not independent benchmark repeats and must not be
pooled into a success-rate claim. Two final-controller successes on one development
scene do not establish generalization, physical safety, or miner eligibility.
The controller handles top-down grasps, not arbitrary orientations. It adds
task-independent geometric affordances, including rim offsets and grasp/release
proximity gates; it is no longer the original raw-direction-only baseline.

## Engineering checks

- Node regression suite: hosted-key gating, origin checks, fixed proxy operations,
  upstream-error redaction, original Jev response validation and workcell IK.
- Python regression suite: bounded geometry-based chunks, measured closing-axis
  regression, proximity gates, no implicit object attachment, missing geometry,
  actual OpenPI client framing, per-connection memory, and worker authorization.
- `npm run build`: public static assets and Three.js dependencies produce `dist/`.
- Native worker installed in this repository's own `.venv`; simulator sources
  pinned in this repository's ignored `third_party/` directory.
- HTTP checks: page, manifests, traces, MP4 byte ranges and live status/start/stop.
- No browser interaction/visual QA or hosted Vercel execution is claimed. The
  optional WebMCP recording-inspection tool has not been runtime-verified in a
  supported browser context. No site was published and no real robot connected.

---

# Validation — 2026-09-19

## Completed

- 11 automated tests passed, including the actual pinned OpenPI
  `WebsocketClientPolicy` connecting to this server and decoding a float32
  `(5, 7)` action chunk. The model response in that protocol test is an explicitly
  synthetic fixture; it is not counted as live Jev evidence.
- Tested malformed provider answers, unknown choices, invalid probabilities,
  confidence gating, exhausted budgets, state reset, connection isolation,
  privileged-observation rejection and NumPy wire round trips.
- **Unmodified OpenRoboto `libero_eval/eval_task.py`, live Jev:** one short
  standard-observation trial, two inference calls, ten action steps after ten
  stabilization steps, `error: null`. No oracle fields were provided. This
  verifies the actual evaluator client path, not task competence. Raw output is
  in `artifacts/upstream-client-live/result.json`.
- Native macOS arm64 MuJoCo 3.2.3 / robosuite 1.4.1 smoke completed 10 hold steps
  and rendered an MP4. This check made no Jev calls.
- **Live Jev over the websocket adapter:** 20 requests, 100 executed simulator
  steps, no provider/protocol errors. Task did not succeed. This early version
  repeatedly descended without first aligning over the target.
- **Revised state/criteria, live Jev in-process:** 44 requests, 220 executed steps,
  no provider errors, median end-to-end request latency **603.8 ms**, wall time
  **36.60 s**. Actual served model: `jev-1.13.0`.

Both live trials used `libero_spatial_swap`, task 0, official initial-state index
0, seed 7, with privileged simulator object poses. The task was to pick the
black bowl between the plate and ramekin and place it on the plate.

The revised policy moved horizontally towards the target area and then descended.
It did **not** complete a grasp and placement within the 220-step budget.
Simulator-reported success is **false** in both records. These are developmental
attempts on the same task, not independent benchmark trials or a success-rate estimate.

Local raw artifacts (ignored by Git):

- `artifacts/jev-swap-live-1/`: initial live websocket run.
- `artifacts/jev-swap-live-2/`: revised live controller run, including video.

The revised trial ran before adding per-request SHA-256 logging; subsequent runs
include that field. The change adds provenance, not action-selection logic.

## Not established

- Competitive manipulation success, reliable grasping or generalization.
- Raw-camera perception: RGB observations are not processed by this policy.
- Real-time hardware control. A five-step chunk is 250 ms of simulation at 20 Hz;
  measured API latency alone exceeded that duration. The simulator waits during
  requests, so video playback is faster than wall-clock operation.
- The production Linux/GPU evaluator's numerical behavior, full 16-suite score,
  mixed initial-state seeding, or independent held-out performance.
- Acceptance as an OpenRoboto miner submission. This is a controller service,
  whereas published competitions require compatible model checkpoints.

## Reproducibility

The source revisions and exact commands are in README.md. The downloaded
position-swap assets are pinned to Hugging Face dataset
`zhouxueyang/LIBERO-Pro@c86fc3b8293185a6f373677018ff3e37f8391602`.
The per-call records retain returned probabilities, confidence, usage, served
model identity, state and decoded actions. The Cloudflare alias may change;
no claim of bitwise reproducibility of hosted Jev outputs is made.
