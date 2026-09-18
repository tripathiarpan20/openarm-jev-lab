# Validation — 18 September 2026

## Automated checks

`npm test`: **9 tests passed**.

- Pending-object and available-tray candidate generation.
- Invalid and duplicate object inputs.
- Invented actions and invalid confidence/probability distributions.
- Cloudflare's observed nested `result.state = Completed` response envelope.
- Only `typesafe/jev` requested; credential stays out of the scene payload.
- HTTP 402 handling pauses without an action.
- Every pickup and all 24 destination slots reachable with the downward tool pose.
- Unreachable targets report error while joint values remain finite.
- Full cross-workcell transfer sequence keeps joint centers above the tabletop.

Static JavaScript syntax checks passed. Local HTTP checks returned 404 for `.env`,
server source, and arbitrary dependency paths; cross-origin inference returned 403.
The private `.env` has mode 0600 and is ignored by Git.

## Live browser mission

The funded Cloudflare account successfully served **Jev 1.13.0** via the fixed
`typesafe/jev` route. In the interactive browser workcell, the quality-sort mission
completed six pick-and-place cycles, followed by a Jev `finish` decision:

| Part | Observed color / condition | Jev destination | Pick decision latency |
|---|---|---|---|
| P01 | Jade / undamaged | Jade | 646 ms |
| P02 | Amber / undamaged | Amber | 418 ms |
| P03 | Violet / undamaged | Violet | 660 ms |
| P04 | Violet / undamaged | Violet | 548 ms |
| P05 | Jade / damaged | Inspection | 409 ms |
| P06 | Amber / undamaged | Amber | 382 ms |

The browser reported 6/6 placed and seven Jev decisions. These timings measure the
server's complete upstream request, not isolated model computation. This was one
observed run, not a reliability or latency benchmark.

The offline five-target motion check also completed in the browser with no model
calls. A live violet-only mission with its tray blocked returned `wait`; after the
tray was unblocked, Jev selected a violet part. Pause held the initial pose, and
Stop held the arm while it was grasping P03. On resume, both violet parts were
placed and Jev finished with the other four parts untouched. No browser JavaScript errors were
observed during these checks.

## Live provider behavior checks

`RUN_LIVE_JEV=1 node --env-file=.env test/live-smoke.mjs`: **4/4 passed**.

| Scenario | Observed Jev choice |
|---|---|
| Only damaged jade part remains in a quality-sort mission | `move_P05_inspection` |
| Violet-only mission begins | `move_P03_violet` |
| Both violet parts placed; other colors untouched | `finish` |
| Violet-only mission, violet tray blocked | `wait` |

Full inputs, probability distributions, served model version, and timings are in
the ignored local `artifacts/live-smoke.json`. The initial successful raw provider
envelope is in `artifacts/jev-live-response.json`.

## Limits

This verifies a stylized kinematic scene and live structured model decisions.
It does not verify contact dynamics, real OpenArm geometry, torque control,
collision-free hardware motion, camera perception, or deployment to a real robot.

## Standalone repository migration

The demo was moved to `openarm-jev-lab` with its application at the repository
root. `npm ci --offline --no-audit --no-fund` and all nine tests passed there.
The `openarm` submodule is pinned to
`fb8a65ad957cc4c6a83c70d90e6ab3b7a8fc5237` and uses the canonical upstream HTTPS URL.
The original OpenArm checkout was restored to a clean working tree. Existing
credentials and local evidence were preserved as ignored files.
