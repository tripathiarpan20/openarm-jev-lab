# OpenArm × Jev — Autonomous Lab

A local, interactive robot workcell. Give the arm a natural-language mission;
**Cloudflare `typesafe/jev`** selects each pick-and-place action from the current
structured scene. Seven-axis inverse kinematics drives the visual arm. No other
model, prerecorded model response, or rule-based decision fallback is used.

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
