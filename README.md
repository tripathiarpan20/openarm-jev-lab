# OpenArm × Jev — Autonomous Lab

A local, interactive robot workcell. Give the arm a natural-language mission;
**Cloudflare `typesafe/jev`** selects each pick-and-place action from the current
structured scene. Seven-axis inverse kinematics drives the visual arm. No other
model, prerecorded model response, or rule-based decision fallback is used.

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

Open **http://127.0.0.1:4317**, choose **Quality sort**, and click **Start mission**.
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
