import { BINS, COLORS, MODEL, candidatesFor } from './public/world.js';

export function validateScene(input) {
  if (!input || typeof input.mission !== 'string' || !input.mission.trim() || input.mission.length > 1600) throw new Error('Enter a mission of 1–1600 characters.');
  if (!Array.isArray(input.objects) || input.objects.length < 1 || input.objects.length > 12) throw new Error('Invalid scene objects.');
  const ids = new Set();
  const objects = input.objects.map(o => {
    if (!o || !/^P\d{2}$/.test(o.id) || ids.has(o.id) || !Object.hasOwn(COLORS, o.color) || typeof o.damaged !== 'boolean' || !['pending', 'placed'].includes(o.status)) throw new Error('Invalid object state.');
    if ((o.status === 'placed' && !BINS.some(b => b.id === o.destination)) || (o.status === 'pending' && o.destination != null)) throw new Error('Invalid object destination.');
    ids.add(o.id);
    return { id: o.id, color: o.color, damaged: o.damaged, status: o.status, destination: o.destination ?? null };
  });
  const blockedBins = input.blockedBins ?? [];
  if (!Array.isArray(blockedBins) || blockedBins.length > 4 || blockedBins.some(id => !BINS.some(b => b.id === id))) throw new Error('Invalid tray availability.');
  return { mission: input.mission.trim(), objects, blockedBins };
}

export function buildRequest(scene) {
  const actions = candidatesFor(scene.objects, scene.blockedBins);
  const criteria = Object.fromEntries(actions.map(a => [a.id, a.description]));
  criteria.finish = 'The user mission has been achieved. End the run. Parts unrelated to a selective mission may remain untouched.';
  criteria.wait = 'The mission is not complete but no currently available action can fulfill it, or the instruction is unsupported or ambiguous. Pause for operator input.';
  return { actions, body: { model: MODEL, input: {
    state: { operator_mission: scene.mission, objects: scene.objects,
      trays: BINS.map(b => ({ id: b.id, purpose: b.id === 'inspection' ? 'Quality inspection and damaged parts' : `${b.name} color sorting`, blocked: scene.blockedBins.includes(b.id), capacity: 6 })),
      rules: 'This is a virtual workcell. Choose one complete pick-and-place action from the listed candidates. Placed objects are already processed and cannot be picked again. Respect the operator mission, including selective tasks. Never send a part to a blocked tray. If the requested destination is blocked, process other eligible parts first, then wait. Object IDs are unique. Do not finish a full sorting mission while pending parts remain.' },
    questions: { next_action: { type: 'choice', instructions: 'Choose the single next action that best advances operator_mission from this exact observed state. Prefer the lowest object ID among equally appropriate moves. Finish only when the requested mission is complete. Use wait if no offered move is appropriate.', criteria } },
  } } };
}

export function parseDecision(payload, actions) {
  const envelope = payload?.result ?? payload;
  // Cloudflare's unified gateway wraps the completed provider response one level
  // deeper than the direct Workers AI examples in the model documentation.
  const result = envelope?.state === 'Completed' ? envelope.result : envelope;
  const answer = result?.answers?.next_action;
  const allowed = new Set([...actions.map(a => a.id), 'finish', 'wait']);
  if (!answer || answer.type !== 'choice' || !allowed.has(answer.choice)) throw new Error('Jev returned an invalid action. The arm has been paused.');
  if (!Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1) throw new Error('Jev returned invalid confidence. The arm has been paused.');
  const probabilities = answer.probabilities;
  if (!probabilities || typeof probabilities !== 'object' || Array.isArray(probabilities) || !Object.hasOwn(probabilities, answer.choice) || Object.entries(probabilities).some(([key, value]) => !allowed.has(key) || !Number.isFinite(value) || value < 0 || value > 1)) throw new Error('Jev returned invalid probabilities. The arm has been paused.');
  const sum = Object.values(probabilities).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 0.06) throw new Error('Jev returned an invalid probability distribution. The arm has been paused.');
  return { model: MODEL, servedModel: result.model ?? null, choice: answer.choice, confidence: answer.confidence, probabilities,
    action: actions.find(a => a.id === answer.choice) ?? null,
    usage: { input_tokens: result?.usage?.input_tokens ?? 0, output_tokens: result?.usage?.output_tokens ?? 0 } };
}

export async function decide(scene, { token, accountId, fetchImpl = fetch }) {
  const { actions, body } = buildRequest(scene);
  const started = performance.now();
  const response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(25000),
  });
  if (response.status === 402) throw new Error('Cloudflare returned HTTP 402: insufficient AI gateway balance. Add balance in Cloudflare, then retry. No action was executed.');
  if (!response.ok) throw new Error(`Cloudflare returned HTTP ${response.status}. Check Jev access and account configuration.`);
  const payload = await response.json();
  if (payload.success === false) throw new Error('Cloudflare could not run Jev. Check model access in your account.');
  return { ...parseDecision(payload, actions), latencyMs: Math.round(performance.now() - started), timestamp: new Date().toISOString() };
}
