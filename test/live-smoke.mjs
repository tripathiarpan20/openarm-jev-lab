// Opt-in integration checks. Calls only typesafe/jev and consumes Cloudflare usage.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { decide, validateScene } from '../jev.mjs';
import { initialObjects, RECIPES } from '../public/world.js';

if (process.env.RUN_LIVE_JEV !== '1') throw new Error('Set RUN_LIVE_JEV=1 to explicitly enable paid live integration checks.');
const token = process.env.CLOUDFLARE_API_TOKEN, accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !/^[a-f\d]{32}$/i.test(accountId ?? '')) throw new Error('Configure server credentials first.');
const damageScene = initialObjects().map(o => o.damaged ? o : { ...o, status: 'placed', destination: o.color });
const violetDone = initialObjects().map(o => o.color === 'violet' ? { ...o, status: 'placed', destination: 'violet' } : o);
const cases = [
  { name: 'damaged part goes to inspection', scene: { mission: RECIPES.quality, objects: damageScene }, expected: ['move_P05_inspection'] },
  { name: 'selective mission chooses only violet', scene: { mission: RECIPES.violet, objects: initialObjects() }, expected: ['move_P03_violet', 'move_P04_violet'] },
  { name: 'selective mission finishes with unrelated parts untouched', scene: { mission: RECIPES.violet, objects: violetDone }, expected: ['finish'] },
  { name: 'blocked required tray causes wait', scene: { mission: RECIPES.violet, objects: initialObjects(), blockedBins: ['violet'] }, expected: ['wait'] },
];
const evidence = { testedAt: new Date().toISOString(), model: 'typesafe/jev', tests: [] };
for (const item of cases) {
  const decision = await decide(validateScene(item.scene), { token, accountId });
  const passed = item.expected.includes(decision.choice);
  evidence.tests.push({ ...item, decision, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${item.name}: ${decision.choice} (${decision.latencyMs} ms)`);
}
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/live-smoke.json', JSON.stringify(evidence, null, 2));
assert(evidence.tests.every(t => t.passed), 'A live Jev behavior check failed; see artifacts/live-smoke.json.');
