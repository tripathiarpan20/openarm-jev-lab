# Jev / Motion Lab

A Vercel-deployable web demo of **Jev controlling a real LIBERO MuJoCo simulation**.
Inspect actual recorded runs, step through Jev's choices, or start a new run through
a native simulation worker. **Only `typesafe/jev` is used as the learned policy.**

The earlier [OpenArm kinematic workcell](#demo-recording) remains available at
`/index.html`. The new LIBERO experiment opens at `/`.

## What improved

Same `libero_spatial_swap` task 0, initial state 0, seed 7, five-step action chunks,
and maximum 220 physics steps:

| Recorded development run | Task completed | Jev calls | Physics steps | Median request | Rollout wall time |
| --- | --- | --- | --- | --- | --- |
| Original fixed directions | No | 44 | 220 | 604 ms | 36.6 s |
| Improved geometry-aware choices | **Yes** | **35** | **173** | **440 ms** | **26.0 s** |
| Same controller through live web API | **Yes** | **21** | **103** | **454 ms** | **16.5 s** |

The simulator reported success after Jev grasped the bowl, moved it over the plate,
and selected release. These are individual development runs on the same scene,
not a benchmark success rate. Several intermediate revisions failed. Latency is
observed per request, not a guaranteed model speedup. See
[experiment validation](experiments/jev-controller/VALIDATION.md).

**The important boundary:** this prototype uses privileged object poses, collision
bounds and contacts from the simulator. It does not interpret camera images and
is not an eligible downloadable OpenRoboto miner checkpoint. The adapter retains
OpenPI's binary websocket protocol and normalized `(N, 7)` OSC action chunks;
these are not physical xArm joint deltas.

## Launch the web demo

```bash
npm ci
npm start
```

Open **http://127.0.0.1:4317/**. Recordings require no Cloudflare key, Python,
GPU, or robot. Play, scrub, compare the runs, and use **Next choice** to inspect
what Jev commanded. Videos show physics time at 20 Hz; API waits are excluded.
The wall-time and request metrics show the actual inference cost in time.

If the original app is still using port 4317:

```bash
PORT=4318 npm start
```

### Query Jev and run new tasks from the browser

Install the simulator once:

```bash
cd experiments/jev-controller
bash setup.sh
.venv/bin/python scripts/download_pro_assets.py \
  --suite libero_spatial_swap \
  --revision c86fc3b8293185a6f373677018ff3e37f8391602
cd ../..
```

Set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in the ignored root `.env`.
Then launch **both the web app and native worker with one command**:

```bash
npm run dev:live
```

Open **http://127.0.0.1:4318/**. Stop an older server using that port first, or use
`PORT=4319 npm run dev:live`. Ctrl+C stops both processes and any active rollout.
The worker uses port 8788; stop an older worker before launching the combined app.
The simpler `npm start` still runs the web server only.

The page lets you:

1. **Choose a scene/task** from the worker's installed catalog. The default download
   provides 10 spatial-swap tasks with 50 initial states each. Choose an initial
   state and seed to vary the episode.
2. **Edit the instruction** or retain the task's built-in goal. Text refers to
   objects already in the selected scene; it does not generate new scenes or objects.
3. **Query Jev**: initialize that scene, make one fresh Jev call and show its proposed
   movement, probabilities and camera frame. No Jev-selected action is executed.
4. **Run task**: initialize a fresh episode and let Jev choose/exercise movement
   chunks, with live frames and feedback. A run repeats inference; it does not
   replay the earlier query's answer. Configure 1–80 calls (default 44), five physics
   steps per call. Stop at any time.

A built-in task uses the simulator's original goal predicate for success. A changed
instruction is labelled **Custom goal · unscored**, with `success: null`. Its
`environment_goal_reached` field refers only to the original scene goal, never
proof that the custom instruction succeeded. Custom runs continue until you stop
or the call/step budget is reached. Query-only runs also have `success: null` and
record `executed: false` on the proposed action.

This is an experimental top-down grasp controller, not a guarantee that all
catalog tasks or arbitrary instructions are solvable. Drawer manipulation and
other actions outside its geometric menu may fail. Only Jev is queried; failures
never switch models or replay recorded decisions.

Setup requires Git and [uv](https://docs.astral.sh/uv/). It installs pinned Python
3.11 simulator components; first startup may take a minute. On Linux, provide EGL
or configure `MUJOCO_GL=osmesa` with its system libraries. No inference GPU or
checkpoint is required. The native worker can also run independently:

```bash
cd experiments/jev-controller
.venv/bin/python -m jev_robot.worker --env-file ../../.env
```

Run artifacts stay under `experiments/jev-controller/artifacts/web-…/`. The catalog
also discovers installed `libero_object_swap` and `libero_goal_swap` suites; download
those with the same pinned asset script and restart the worker to expose them.
For direct CLI / OpenPI websocket usage see the [controller README](experiments/jev-controller/README.md).

## Exactly what Jev chooses in the improved controller

Every call supplies the current instruction, measured robot/object geometry,
finger contacts, and recent observations. Code constructs a task-independent menu;
**Jev selects one whole action**. It never emits arbitrary code or free-form
joint coordinates.

| Choice | What the selected short chunk does |
| --- | --- |
| `hold`, `open`, `lift` | Keep still, open fingers, or move upward with the current grip. |
| `<object>__above` | Approach above that object's grasp point, or carry a held object above that destination. |
| `<object>__grasp` | Approach its geometry-derived grasp point with fingers open. Wide objects use an offset along the measured finger-closing axis. |
| `<object>__grip` | Close in place. Offered only near its grasp point. |
| `<object>__lift` | Move upward with fingers closed when both fingers contact that object. |
| `<destination>__place` | Move the held object toward that support, accounting for the observed hand-to-object offset. |
| `<destination>__release` | Open in place when the held object is within 2.5 cm of the placement target. |

Already-reached movements and re-grasping an already-held object are omitted.
Availability depends on measured geometry; code does not parse the instruction
or choose the task's target/destination. The menu stays below Jev's 255-choice
limit. The original **195-direction** policy is retained as `--action-set discrete`.

The geometric decoder scales the selected positional error into normalized OSC
translation commands, caps each axis at ±0.8, and repeats the vector for at most
five steps. Rotations remain zero in the improved menu; this assumes a roughly
vertical gripper with a horizontal closing axis. Gripper commands are −1/open or
+1/close. A movement is not a completed skill: Jev must choose again after every
chunk. Grasp and placement are physical contacts, never object attachment or
teleportation. Runtime failures stop the episode. This demonstration is not a
collision-certified or general-purpose robot controller.

## Deploy to Vercel

Deploy the repository root from branch **`arpan/jev-openroboto-web-demo`**.
`vercel.json` configures the static build and the three Node API functions.

```bash
npm run build
# From this feature branch, with your Vercel account authenticated:
npx vercel
# When ready to publish the reviewed deployment:
npx vercel --prod
```

Or push this branch and import the GitHub repository in Vercel. Select **Other**,
Node **22.x**, build command **`npm run build`**, output directory **`dist`**,
and the repository root. The supplied configuration already sets these build
values. The build copies only public assets and the required Three.js modules.
It does not package the private `.env`, Python environment or simulator sources.

**Playback works immediately with no environment variables.** Native MuJoCo runs
outside the Vercel functions. To enable browser task selection, querying and fresh rollouts on a hosted deployment:

1. Run the Python worker on a machine with the pinned simulator installed. Export
   a random `SIMULATOR_TOKEN` of at least 24 characters, run it with
   `--host 0.0.0.0`, and place it behind an authenticated HTTPS reverse proxy.
   The worker itself verifies `Authorization: Bearer <SIMULATOR_TOKEN>`.
2. Set these private Vercel environment variables, then redeploy:
   - `SIMULATOR_URL`: the worker's HTTPS origin (no path or credentials).
   - `SIMULATOR_TOKEN`: the same worker secret.
   - `DEMO_ACCESS_KEY`: a separate random string of at least 24 characters.
3. Enter **only the demo access key** in the page, then click **Connect / refresh tasks**. Select, query, run and stop tasks entirely from the page.
   Cloudflare credentials stay on the worker. The browser never receives them.

For the older `/index.html` workcell's live inference, additionally set
`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in Vercel. Its calls use the
same demo-access-key gate. No credentials are needed for reading recorded runs.
Do not treat the demo key as per-user authentication or a global spending quota;
anyone you share it with can request further bounded episodes.

Implementation follows [Vercel's Node function convention](https://vercel.com/docs/functions/runtimes/node-js)
and [project configuration](https://vercel.com/docs/project-configuration).
The production bundle has been built locally; no Vercel deployment is claimed.

## Reproduce and add a recording

```bash
cd experiments/jev-controller
.venv/bin/python -m jev_robot.run_libero \
  --libero-root third_party/LIBERO-PRO --assets-root third_party/pro-assets \
  --suite libero_spatial_swap --task-id 0 --init-index 0 --seed 7 \
  --observation-mode sim-oracle --action-set grounded --env-file ../../.env \
  --max-calls 44 --max-steps 220 --output artifacts/my-run
cd ../..
node scripts/export-run.mjs experiments/jev-controller/artifacts/my-run my-run "My measured run"
npm run build
```

Each run has a video, actual decision trace and simulator result. New runs also
record controller-source hashes. Do not edit success flags or invent missing
frames. The bundled comparison MP4s are each under 0.4 MB and intentionally
included as small demo fixtures. Large personal recordings in `demo/` remain
ignored as before.

## Tests

```bash
npm test
npm run build
cd experiments/jev-controller
.venv/bin/python -m pytest -q
```

The OpenArm submodule remains pinned at its existing commit. Python dependencies,
run outputs and `.env` files stay outside Git. No model substitution was added.

---

## Demo recording

https://github.com/user-attachments/assets/a23491db-a75c-41c5-8818-ad9a194238c6

Watch the 31-second demo inline on GitHub. The video is hosted as a GitHub
attachment, so normal clones do not download it. Optional local recordings
(`demo/demo.mp4` and `demo/demo.mov`) are ignored by Git; the app runs without them.

## Local setup and launch

Requires Node.js 22 (tested with 22.23.2), npm, Git, and a browser with WebGL.

On the machine where this project was created, the existing Cloudflare credentials
have already been carried over to the private `.env` file. Start the demo with:

```bash
cd /Users/arpantripathi/Documents/Github/openarm-jev-lab
npm ci
npm start
```

Open **http://127.0.0.1:4317/index.html**, choose **Quality sort**, and click **Start mission**.
Stop the server with **Ctrl+C** in its terminal. On subsequent launches, `npm start`
is enough unless dependencies have changed. If port 4317 is already in use by a
running copy, open that address or stop the earlier server before launching again.
To use a different port, run `PORT=4318 npm start` and open `http://127.0.0.1:4318`.

### Fresh checkout

From this repository's root:

```bash
git submodule update --init --recursive
npm ci
test -f .env || cp .env.example .env
chmod 600 .env
```

Set these values in `.env`, then run `npm start`:

```dotenv
CLOUDFLARE_API_TOKEN=your-cloudflare-api-token
CLOUDFLARE_ACCOUNT_ID=your-cloudflare-account-id
PORT=4317
```

The server binds only to localhost. The token stays in the ignored, server-side
`.env`; it is never sent to the browser. Keep an existing configured `.env` file
when reinstalling dependencies. Cloudflare needs sufficient AI gateway balance and
permission to run Jev for the configured account.

## Pinned OpenArm submodule

[`openarm/`](openarm/) contains the upstream OpenArm project as a Git submodule:

- Upstream: https://github.com/enactic/openarm.git
- Pinned commit: `fb8a65ad957cc4c6a83c70d90e6ab3b7a8fc5237`
- Commit subject: `website: bump katex from 0.18.5 to 0.18.7 in /website (#598)`

This is the original OpenArm checkout's HEAD at the time this standalone project
was created. The parent repository records the exact commit, so a normal
`git submodule update --init --recursive` restores that revision. Do not use
`git submodule update --remote` if you want to retain this pin.

Verify it with:

```bash
git submodule status
git -C openarm rev-parse HEAD
```

The submodule supplies upstream documentation and project references. This demo's
renderer and controller live in the parent repository and do not load OpenArm CAD
or physics assets at runtime. Its Docusaurus website has its own dependencies and
is not required to launch this demo.

## Demonstrate

1. Click **Motion check** to exercise the controller along five fixed targets.
   This is explicitly an offline mechanical check: no model calls or object sorting.
2. Select **Quality sort** and click **Start mission** for a real Jev-driven run.
   Jev observes six colored parts, including a damaged jade part, and chooses one
   object/destination pair at a time. The controller approaches, grips, lifts,
   transfers, releases, and retracts, then requests a new decision.
3. Watch confidence, the top three action probabilities, request latency, joint
   angles, tool coordinates, the motion trail, and the activity stream.
4. Try **Color sort**, **Inspect all**, **Violet only**, or write your own instruction
   involving the existing parts and trays. This workcell supports pick-and-place
   choices, not arbitrary generated tools, stacking, or new physical objects.
5. Block a tray before a run or between actions. Blocked destinations disappear
   from the next candidate list. A response based on an outdated scene is discarded.
   The destination of a move already underway stays locked until release/retraction.
6. **Pause** holds the current pose. **Stop** also holds immediately, including a
   grasped part; **Resume** continues the interrupted motion. **Reset** cancels the
   run and restores the initial workcell. Camera orbit/zoom and speed are adjustable.
7. **Export run** downloads decisions, probabilities, timings, observations, events,
   and final object states as JSON, without credentials.

## How the model is used

`POST /api/decide` validates the scene and generates only actions applicable to
pending objects and unblocked trays with spare capacity. It calls:

```text
POST https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run
model: typesafe/jev
input: { state: { operator_mission, objects, trays, rules },
         questions: { next_action: { type: "choice", instructions, criteria } } }
```

### Exactly what Jev can choose on each call

Each call asks **one Choice question, `next_action`**, and Jev selects exactly one
ID from the supplied `criteria` map. A movement choice specifies an **object and a
tray**; it represents a complete pick-and-place operation. The available forms are:

| Choice ID | Meaning |
|---|---|
| `move_<objectId>_jade` | Pick that part and place it in the jade tray. |
| `move_<objectId>_amber` | Pick that part and place it in the amber tray. |
| `move_<objectId>_violet` | Pick that part and place it in the violet tray. |
| `move_<objectId>_inspection` | Pick that part and place it in the inspection tray. |
| `finish` | End the current mission because Jev judges the requested goal complete. |
| `wait` | End the decision loop and hold for operator input because no appropriate move is available, or the request is ambiguous or unsupported. |

For example, `move_P05_inspection` means “pick P05 and put it in the inspection
tray.” The initial scene contains P01–P06: jade, amber, violet, violet, damaged jade,
and amber, respectively.

**The initial call offers 26 choices:** six pending parts × four available trays,
plus `finish` and `wait`. The server rebuilds this list from the scene on every call:

- Only parts with `status: pending` can be picked. A placed part cannot be moved
  again during the same scene, even if it was placed in the wrong tray.
- Blocked trays are excluded, as are trays already containing six placed parts.
- Every pending part can go to every remaining available tray. Color and damage
  do **not** filter the candidates: interpreting the mission and choosing the
  appropriate destination is Jev's job.
- `finish` and `wait` are always offered, including when no movement is available.

After one part is placed, with all trays still available, the next call has
5 × 4 + 2 = **22 choices**. Blocking one tray in the initial six-part scene gives
6 × 3 + 2 = **20 choices**. If every tray is blocked, only `finish` and `wait` remain;
for an unfinished mission the intended choice is `wait`.

### What information guides that choice

The request contains the operator's mission, each object's ID, color, damage flag,
pending/placed status and destination, and each tray's purpose, blocked state and
capacity. It also includes operating rules and a description of each candidate,
such as “Pick P05, a jade part (DAMAGED), and place it in the Inspection tray.”
The prompt asks Jev to prefer the lowest object ID among equally appropriate moves.

These are structured facts supplied by the simulator. Jev does not receive camera
images, joint angles, Cartesian coordinates, or previous response history in this
request; damage and color are already labeled for it. Each call uses a fresh scene
snapshot, including the results of previous completed placements.

The same candidate list can produce different choices under different missions:

| Mission and observed state | Intended next choice |
|---|---|
| Quality sort; damaged jade P05 is the last pending part | `move_P05_inspection` |
| Color sort regardless of damage; P05 is the last pending part | `move_P05_jade` |
| Inspect all; P01 is next | `move_P01_inspection` |
| Violet only; P03 and P04 are pending | `move_P03_violet`, then `move_P04_violet` on a later call |
| Violet only; both violet parts are placed but other colors remain | `finish` |
| Violet only; the violet tray is blocked | `wait` |

These describe the intended behavior, not hard-coded routing rules. Validation
checks that an answer is an offered action; it does not prove the choice satisfies
the mission. For example, sending a jade part to an available amber tray is a valid
candidate even when it would be a sorting mistake.

### What the motion controller does after a choice

Once a move is accepted, application code chooses the next free slot in the target
tray and executes ten fixed phases: clear the workspace, approach the part, lower,
close the gripper, lift, clear the pedestal, transfer, lower into the tray, release,
and retract. It solves joint motion and updates the object's state. **Jev is called
again only after that full operation**, rather than once per animation frame or
once per joint movement. A six-part sorting mission normally needs six move
choices and one final `finish` choice.

Jev cannot choose individual joint angles, torques, speeds, intermediate waypoints,
gripper commands, arbitrary coordinates, or new action types. It cannot create
objects, stack them, rearrange already placed parts, or issue code for execution.
The operator controls pause, stop, reset, speed, and tray blocking. A `wait` result
requires an explicit restart with **Continue mission** after changing the scene or
instruction; it does not poll the model automatically. The **Motion check** button
runs a separate fixed controller test with no Jev calls.

If the scene changes while a model request is in flight, the returned decision is
discarded and a fresh one is requested. A tray targeted by a move already underway
cannot be blocked until that operation finishes.

### Response checks and execution limits

Jev returns a typed choice, confidence, and probabilities. The server validates
these against the offered actions. API errors, invalid responses, confidence below
50%, or unreachable motion targets pause the mission. There is a 16-decision
budget per run and a 25-second inference timeout. `wait` pauses for operator input;
`finish` means **Jev claims the mission is complete**, not an independently verified
semantic success. Check the final state and exported evidence against the goal.

Reference: [Cloudflare Jev documentation](https://developers.cloudflare.com/ai/models/typesafe/jev/index.md).

## Simulation fidelity

This is a **stylized OpenArm-inspired kinematic demonstration**, not an exact
OpenArm digital twin. The arm uses a seven-joint chain with an elbow-up analytic
seed and damped least-squares IK for position and downward tool orientation. The
two redundant axial roll joints remain neutral for these grasping tasks. The model receives structured object
metadata; this is not camera-based perception. Grasping uses idealized object
attachment. There is no rigid-body/contact physics, self-collision checking,
torque control, or real hardware connection. High-clearance transfer waypoints
are used, but this controller is not suitable for physical actuation.

For physics and actual OpenArm assets, see the project's separate
[MuJoCo](https://github.com/enactic/openarm_mujoco) and
[Isaac Lab](https://github.com/enactic/openarm_isaac_lab) repositories.

## Verify

```bash
npm test
```

Tests cover candidate availability, input/response validation, fixed-model routing,
safe billing failure, all pickup positions and 24 tray slots, downward tool
orientation, cross-workcell transfers, and unreachable targets. Tests use labeled synthetic provider
responses in isolation; the running application always calls Jev.

Optional live behavior checks (four small billed Jev requests):

```bash
RUN_LIVE_JEV=1 node --env-file=.env test/live-smoke.mjs
```

This saves the full decisions and inputs to the ignored `artifacts/live-smoke.json`.
See [VALIDATION.md](VALIDATION.md) for the completed local and live checks.

If Cloudflare returns **HTTP 402 / insufficient balance**, the scene remains visible
and the offline motion check works. Add AI gateway balance before starting live
automation. A token can be active yet lack account-read permission; account details
returning 403 do not establish whether inference is enabled.

## Files

- `openarm/`: upstream OpenArm submodule, pinned to the revision above.

- `server.mjs`: localhost HTTP server and credential boundary.
- `jev.mjs`: scene validation and Jev request/response contract.
- `public/world.js`: parts, trays, candidate actions, and mission presets.
- `public/kinematics.js`: seven-axis FK and damped least-squares IK.
- `public/scene.js`: Three.js workcell, robot, and rendering.
- `public/app.js`: mission lifecycle, animation, controls, and evidence export.

The upstream Docusaurus documentation site lives in `openarm/website/` and is independent of this application.
