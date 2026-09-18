import * as THREE from 'three';
import { Workcell } from './scene.js';
import { MODEL, BINS, RECIPES, initialObjects, destinationPosition } from './world.js';

const $ = id => document.getElementById(id);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let view;
try { view = new Workcell($('viewport')); } catch (error) { $('webgl-error').hidden = false; console.error('WebGL setup failed', error); }
let objects = initialObjects();
let blockedBins = new Set();
let configured = false, running = false, paused = false, busy = false, stopped = false, calibrating = false;
let generation = 0, sceneRevision = 0, controller = null, currentMove = null, attachedId = null;
let motion = null, trailOn = true, speed = 1, requestId = 0;
let history = [], audit = [], activeMission = '', startedAt = null;
let lastFrame = performance.now(), lastTelemetry = 0;
$('mission-input').value = RECIPES.quality;
view?.resetObjects(objects);

function log(title, detail, type = '') {
  const entry = { time: new Date().toISOString(), title, detail, type }; audit.push(entry);
  const item = document.createElement('div'); item.className = `activity-item ${type}`;
  const dot = document.createElement('span'); dot.className = 'activity-dot';
  const content = document.createElement('div'); const heading = document.createElement('strong'); heading.textContent = title;
  const text = document.createElement('p'); text.textContent = detail; content.append(heading, text);
  const time = document.createElement('time'); time.textContent = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  item.append(dot, content, time); $('activity').prepend(item);
  while ($('activity').children.length > 80) $('activity').lastElementChild.remove();
  $('export').disabled = false;
}
function notice(message = '') { $('notice').textContent = message; $('notice').hidden = !message; }
function phase(label, count = '') { $('current-action').textContent = label; $('stage-count').textContent = count; }
function setControls() {
  $('start').disabled = !configured || !view || running || !!currentMove || busy;
  $('pause').disabled = !running && !currentMove;
  $('stop').disabled = !running && !currentMove;
  $('calibrate').disabled = !view || running || !!currentMove || busy;
  $('pause').textContent = paused ? '▶ Resume' : 'Ⅱ Pause';
  $('start-text').textContent = objects.every(o => o.status === 'placed') ? 'Run another mission' : stopped ? 'Continue mission' : 'Start mission';
  $('mission-input').disabled = running || !!currentMove;
  document.querySelectorAll('[data-recipe]').forEach(b => b.disabled = running || !!currentMove);
  $('sim-state').textContent = paused ? 'MOTION PAUSED' : calibrating ? 'CONTROLLER CHECK · NO AI' : busy ? 'JEV IS DECIDING' : running ? 'AUTONOMOUS RUN' : stopped ? 'WORKCELL STOPPED' : 'WORKCELL READY';
  $('sim-dot').className = `dot ${running && !paused ? 'running' : paused || stopped ? 'amber' : ''}`;
  BINS.forEach(b => { $(`block-${b.id}`).disabled = !!currentMove && currentMove.destination === b.id; });
}
function updateProgress() {
  const count = objects.filter(o => o.status === 'placed').length;
  $('placed-count').textContent = count; $('progress-fill').style.width = `${count / objects.length * 100}%`;
  $('progress-caption').textContent = count ? `${objects.length - count} parts remaining · ${history.length} Jev decisions` : 'Six parts. Four trays. One decision at a time.';
}
function renderDecision(decision) {
  $('decision-source').textContent = 'LIVE JEV RESPONSE';
  $('decision-title').textContent = decision.action?.label ?? (decision.choice === 'finish' ? 'Mission complete' : 'Waiting for operator');
  $('confidence').replaceChildren(document.createTextNode(`${Math.round(decision.confidence * 100)}%`));
  const small = document.createElement('small'); small.textContent = 'confidence'; $('confidence').append(small);
  $('latency').textContent = `${(decision.latencyMs / 1000).toFixed(2)}s`;
  $('probabilities').replaceChildren();
  const entries = Object.entries(decision.probabilities).sort((a, b) => b[1] - a[1]).slice(0, 3);
  for (const [id, probability] of entries) {
    const row = document.createElement('div'); row.className = 'prob-row';
    const label = document.createElement('span'); label.textContent = id.startsWith('move_') ? id.replace('move_', '').replace('_', ' → ') : id;
    const track = document.createElement('span'); track.className = 'prob-track'; const fill = document.createElement('i'); fill.style.width = `${probability * 100}%`; track.append(fill);
    const value = document.createElement('b'); value.textContent = `${Math.round(probability * 100)}%`; row.append(label, track, value); $('probabilities').append(row);
  }
}

function move(target, label, stage, grip = null, duration = null) {
  return new Promise((resolve, reject) => {
    const from = view.arm.tip.clone(); const to = new THREE.Vector3(...target);
    motion = { from, to, label, stage, elapsed: 0, duration: duration ?? Math.max(0.55, from.distanceTo(to) / 0.30), resolve, reject, gripFrom: view.gripAmount, grip, settling: 0 };
    phase(label, stage);
  });
}
async function pickPlace(action, runId) {
  const object = objects.find(o => o.id === action.objectId);
  if (!object || object.status !== 'pending' || blockedBins.has(action.destination)) throw new Error('The scene changed. Request a fresh decision.');
  const slot = objects.filter(o => o.destination === action.destination).length;
  const destination = destinationPosition(action.destination, slot);
  const source = [...object.position]; currentMove = action; view.highlight(object.id); setControls();
  const check = () => { if (generation !== runId) throw new Error('cancelled'); };
  const go = async (...args) => { check(); await move(...args); check(); };
  const lift = 0.32;
  await go([view.arm.tip.x, lift, view.arm.tip.z], `Clear workspace · ${object.id}`, '1 / 10');
  await go([source[0], lift, source[2]], `Approach ${object.id}`, '2 / 10');
  await go(source, `Lower gripper · ${object.id}`, '3 / 10');
  await go(source, `Grip ${object.id}`, '4 / 10', 1, 0.45);
  attachedId = object.id; $('gripper-state').textContent = `HOLDING ${object.id}`;
  await go([source[0], lift, source[2]], `Lift ${object.id}`, '5 / 10');
  await go([0, lift, 0.27], `Clear pedestal · ${object.id}`, '6 / 10');
  await go([destination[0], lift, destination[2]], `Transfer to ${action.destination}`, '7 / 10');
  await go(destination, `Lower into ${action.destination}`, '8 / 10');
  await go(destination, `Release ${object.id}`, '9 / 10', 0, 0.45);
  attachedId = null; object.position = [...destination]; object.status = 'placed'; object.destination = action.destination;
  view.moveObject(object.id, new THREE.Vector3(...destination)); $('gripper-state').textContent = 'GRIPPER OPEN';
  updateProgress(); sceneRevision++; log(`${object.id} placed in ${action.destination}`, `${object.color} part${object.damaged ? ' · damaged' : ''} · kinematic grasp and release complete`);
  await go([destination[0], lift, destination[2]], 'Retract gripper', '10 / 10');
  view.highlight(null); currentMove = null; setControls();
}

async function run() {
  if (running || busy || currentMove || !configured || !view) return;
  if (objects.every(o => o.status === 'placed')) reset();
  activeMission = $('mission-input').value.trim();
  if (!activeMission) { notice('Describe a mission first.'); return; }
  running = true; stopped = false; paused = false; notice();
  startedAt ??= new Date().toISOString(); const runId = ++generation; let decisionsThisRun = 0;
  log('Mission started', activeMission); setControls();
  try {
    while (running && generation === runId) {
      while (paused && generation === runId) await sleep(100);
      if (generation !== runId || !running) break;
      if (++decisionsThisRun > 16) throw new Error('Decision limit reached. Review the scene before continuing.');
      const revision = sceneRevision;
      busy = true; controller = new AbortController(); setControls(); phase('Jev is observing the workcell…');
      const response = await fetch('/api/decide', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission: activeMission, objects, blockedBins: [...blockedBins] }), signal: controller.signal });
      const decision = await response.json();
      if (generation !== runId) break;
      busy = false;
      if (!response.ok) throw new Error(decision.error || 'Jev could not make a decision.');
      $('connection-label').textContent = 'Jev connected · live inference'; $('connection-dot').className = 'dot';
      history.push({ ...decision, requestId: ++requestId, sceneRevision: revision, mission: activeMission, observations: structuredClone(objects), blockedBins: [...blockedBins] });
      renderDecision(decision); updateProgress();
      while (paused && generation === runId) await sleep(100);
      if (generation !== runId || !running) break;
      if (revision !== sceneRevision) { log('Scene changed during inference', 'Discarded stale decision; observing again.'); await sleep(750); continue; }
      if (decision.confidence < 0.50) { notice('Jev’s confidence is below 50%. Clarify the mission and try again.'); log('Low-confidence decision held', `${Math.round(decision.confidence * 100)}% confidence · no motion executed`); stopped = true; phase('Low confidence · operator action required'); break; }
      if (decision.choice === 'wait') { notice('Jev is waiting: unblock a required tray or clarify the mission, then continue.'); log('Jev requested operator input', 'No suitable action selected. The arm remains stationary.'); phase('Waiting · operator action required'); stopped = true; break; }
      if (decision.choice === 'finish') { phase('Jev marked the mission complete', '✓'); log('Jev marked the mission complete', `${objects.filter(o => o.status === 'placed').length} of ${objects.length} parts placed. Check the scene against your goal.`); break; }
      log('Jev selected an action', `${decision.action.label} · ${Math.round(decision.confidence * 100)}% confidence · ${decision.latencyMs} ms`);
      await pickPlace(decision.action, runId);
      await sleep(150);
    }
  } catch (error) {
    if (generation === runId && error.name !== 'AbortError') {
      if (error.message.includes('402')) { $('connection-label').textContent = 'Jev needs AI gateway balance'; $('connection-dot').className = 'dot amber'; }
      notice(error.message); log('Mission paused', error.message, 'error'); phase('Paused · operator action required'); stopped = true;
      // A failed motion can leave a part grasped. Keep the scene frozen until reset.
      if (currentMove) notice(`${error.message} Reset the scene to recover the interrupted motion.`);
    }
  } finally {
    if (generation === runId) { running = false; busy = false; paused = false; controller = null; setControls(); }
  }
}

function reset() {
  generation++; controller?.abort(); controller = null;
  motion?.reject(new Error('cancelled')); motion = null; currentMove = null; attachedId = null;
  running = false; paused = false; busy = false; stopped = false; calibrating = false; sceneRevision++;
  objects = initialObjects(); history = []; audit = []; startedAt = null; requestId = 0;
  blockedBins.clear(); BINS.forEach(b => { $(`block-${b.id}`).classList.remove('blocked'); $(`block-${b.id}`).setAttribute('aria-pressed', 'false'); view?.blockTray(b.id, false); });
  if (view) { view.resetObjects(objects); view.arm.angles = [-0.24, 0.60, 0, 1.55, 0, 0.99, 0]; view.moveTo([0, 0.48, -0.06]); view.arm.solve([0, 0.48, -0.06], 200); view.setGrip(0); }
  $('gripper-state').textContent = 'GRIPPER OPEN'; $('activity').replaceChildren(); $('confidence').innerHTML = '—<small>confidence</small>';
  $('decision-title').textContent = 'Observe. Decide. Move.'; $('decision-source').textContent = 'AWAITING JEV'; $('latency').textContent = '—';
  $('probabilities').innerHTML = '<div class="empty-prob"><span></span><span></span><span></span><p>Real model probabilities appear here after each decision.</p></div>';
  log('Workcell reset', '6 parts observed · 1 marked damaged · 4 trays available'); notice(); phase('Ready for your next mission'); updateProgress(); setControls();
}

for (const bin of BINS) {
  const button = document.createElement('button'); button.id = `block-${bin.id}`; button.className = 'tray-toggle'; button.setAttribute('aria-pressed', 'false'); button.title = `Toggle ${bin.name} tray availability`;
  const swatch = document.createElement('i'); swatch.style.setProperty('--swatch', bin.color); button.append(swatch, document.createTextNode(bin.name));
  button.addEventListener('click', () => {
    if (currentMove?.destination === bin.id) return;
    if (blockedBins.has(bin.id)) blockedBins.delete(bin.id); else blockedBins.add(bin.id);
    const blocked = blockedBins.has(bin.id); button.classList.toggle('blocked', blocked); button.setAttribute('aria-pressed', String(blocked)); view?.blockTray(bin.id, blocked); sceneRevision++;
    log(`${bin.name} tray ${blocked ? 'blocked' : 'available'}`, 'The next Jev decision uses this updated observation.');
  }); $('tray-toggles').append(button);
}
for (let i = 0; i < 7; i++) { const element = document.createElement('div'); element.className = 'joint'; element.innerHTML = `<span>J${i + 1}</span><output id="joint-${i}">0°</output><i><b id="joint-bar-${i}"></b></i>`; $('joints').append(element); }
document.querySelectorAll('[data-recipe]').forEach(button => button.addEventListener('click', () => {
  $('mission-input').value = RECIPES[button.dataset.recipe]; document.querySelectorAll('[data-recipe]').forEach(b => b.classList.toggle('active', b === button));
}));
$('mission-input').addEventListener('input', () => document.querySelectorAll('[data-recipe]').forEach(b => b.classList.remove('active')));
$('start').addEventListener('click', run);
$('calibrate').addEventListener('click', async () => {
  if (!view || running || currentMove) return;
  calibrating = true; running = true; paused = false; stopped = false;
  const runId = ++generation; notice('Motion check: a fixed controller trajectory, with no AI decisions or object manipulation.');
  log('Controller motion check', 'Offline trajectory test · no model calls · objects stay on the table.'); setControls();
  const targets = [[-0.35, 0.32, -0.10], [-0.40, 0.32, 0.22], [0.42, 0.32, 0.22], [0.42, 0.32, -0.12], [0, 0.48, -0.06]];
  try {
    for (let i = 0; i < targets.length; i++) {
      if (generation !== runId) return;
      await move(targets[i], 'Controller motion check · no AI', `${i + 1} / ${targets.length}`);
    }
    if (generation === runId) { log('Motion check passed', 'Five Cartesian targets reached with downward gripper orientation.'); phase('Motion check complete · ready for Jev', '✓'); notice(); }
  } catch (error) { if (generation === runId) { notice(error.message); log('Motion check failed', error.message, 'error'); } }
  finally { if (generation === runId) { calibrating = false; running = false; paused = false; stopped = false; setControls(); } }
});
$('reset').addEventListener('click', reset);
$('pause').addEventListener('click', () => { paused = !paused; if (!paused) { stopped = false; notice(); if (motion) phase(motion.label, motion.stage); } setControls(); log(paused ? 'Motion paused' : 'Mission resumed', paused ? 'Current pose held. No next action will execute until resumed.' : 'Continuing from the current state.'); });
$('stop').addEventListener('click', () => {
  // Stop freezes immediately, preserving the held object and motion for explicit resume/reset.
  paused = true; stopped = true; setControls(); phase('Stopped · pose held'); notice('Motion stopped. Resume to finish this action, or reset the scene.'); log('Operator stop', 'Arm and held part frozen immediately. No new decision will execute.');
});
$('speed').addEventListener('input', e => { speed = Number(e.target.value); $('speed-value').textContent = `${speed}×`; });
$('camera-reset').addEventListener('click', () => view?.resetCamera()); $('camera-top').addEventListener('click', () => view?.topCamera());
$('trail-toggle').addEventListener('click', e => { trailOn = !trailOn; if (view) view.trail.visible = trailOn; e.currentTarget.classList.toggle('active', trailOn); e.currentTarget.setAttribute('aria-pressed', String(trailOn)); });
$('export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ schema: 'openarm-jev-run.v1', model: MODEL, simulation: 'kinematic; no physical robot; idealized attachment grasp', startedAt, exportedAt: new Date().toISOString(), mission: activeMission, decisions: history, events: audit, finalObjects: objects }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'openarm-jev-run.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
async function status() {
  try { const response = await fetch('/api/status'); const state = await response.json(); configured = state.configured;
    $('connection-label').textContent = configured ? 'Jev configured · ready to connect' : 'Account configuration required'; $('connection-dot').className = `dot ${configured ? '' : 'amber'}`;
    if (!configured) notice(state.message);
  } catch { notice('Cannot reach the local server. Start it with npm start.'); }
  setControls();
}

function frame(now) {
  const dt = Math.min((now - lastFrame) / 1000, 0.05); lastFrame = now;
  if (view) {
    if (motion && !paused) {
      const current = motion; current.elapsed += dt * speed;
      const t = Math.min(current.elapsed / current.duration, 1); const eased = t * t * (3 - 2 * t);
      const position = current.from.clone().lerp(current.to, eased); const error = view.moveTo(position.toArray());
      if (current.grip !== null) view.setGrip(THREE.MathUtils.lerp(current.gripFrom, current.grip, eased));
      if (attachedId) view.moveObject(attachedId, view.arm.tip);
      if (trailOn) view.addTrail();
      if (t === 1) {
        current.settling += dt;
        if (error < 0.007 && view.arm.orientationError < 0.10) { motion = null; current.resolve(); }
        else if (current.settling > 2) { motion = null; current.reject(new Error('Motion target is unreachable. Arm held at its last pose.')); }
      }
    }
    if (now - lastTelemetry > 120) {
      lastTelemetry = now;
      view.arm.angles.forEach((a, i) => { $(`joint-${i}`).textContent = `${Math.round(a * 180 / Math.PI)}°`; $(`joint-bar-${i}`).style.width = `${(a + Math.PI) / (2 * Math.PI) * 100}%`; });
      const p = view.arm.tip; $('tcp').textContent = `${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)} m`;
    }
    view.render();
  }
  requestAnimationFrame(frame);
}
status(); requestAnimationFrame(frame);
