import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateScene, buildRequest, parseDecision, decide } from '../jev.mjs';
import { initialObjects, RECIPES } from '../public/world.js';

const scene = () => validateScene({ mission: RECIPES.quality, objects: initialObjects() });
test('offers only pending objects and available trays, retaining finish and wait', () => {
  const input = scene(); input.objects[0].status = 'placed'; input.objects[0].destination = 'jade'; input.blockedBins = ['inspection'];
  const { body, actions } = buildRequest(input);
  assert.equal(body.model, 'typesafe/jev'); assert.equal(actions.length, 15);
  assert(actions.every(a => a.objectId !== 'P01' && a.destination !== 'inspection'));
  assert(body.input.questions.next_action.criteria.finish); assert(body.input.questions.next_action.criteria.wait);
});
test('rejects ambiguous object identity and invalid state', () => {
  const input = scene(); input.objects[1].id = input.objects[0].id;
  assert.throws(() => validateScene(input), /Invalid object/);
  assert.throws(() => validateScene({ ...scene(), mission: '' }), /mission/);
  assert.throws(() => validateScene({ ...scene(), blockedBins: ['unknown'] }), /availability/);
});
test('rejects invented actions and malformed confidence or probabilities', () => {
  const { actions } = buildRequest(scene());
  const answer = { type: 'choice', choice: actions[0].id, confidence: 0.9, probabilities: { [actions[0].id]: 0.9, finish: 0.1 } };
  const payload = value => ({ result: { answers: { next_action: value } } });
  assert.equal(parseDecision(payload(answer), actions).action.objectId, 'P01');
  assert.throws(() => parseDecision(payload({ ...answer, choice: 'arbitrary_motion' }), actions), /invalid action/);
  assert.throws(() => parseDecision(payload({ ...answer, confidence: NaN }), actions), /confidence/);
  assert.throws(() => parseDecision(payload({ ...answer, probabilities: { [answer.choice]: 2 } }), actions), /probabilities/);
  assert.throws(() => parseDecision(payload({ ...answer, probabilities: { [answer.choice]: 0.1 } }), actions), /distribution/);
});
test('unwraps the observed Cloudflare unified gateway Completed envelope', () => {
  const { actions } = buildRequest(scene());
  const payload = { success: true, result: { state: 'Completed', result: { model: 'jev-1.13.0', answers: { next_action: { type: 'choice', choice: 'move_P01_jade', confidence: 1, probabilities: { move_P01_jade: 1 } } }, usage: { input_tokens: 1808, output_tokens: 337 } }, gatewayMetadata: { keySource: 'Unified' } } };
  const parsed = parseDecision(payload, actions);
  assert.equal(parsed.action.destination, 'jade'); assert.equal(parsed.servedModel, 'jev-1.13.0'); assert.equal(parsed.usage.input_tokens, 1808);
  assert.throws(() => parseDecision({ result: { ...payload.result, state: 'Pending' } }, actions), /invalid action/);
});
test('only sends the fixed Jev model to Cloudflare; credentials never enter the scene', async () => {
  const result = await decide(scene(), { token: 'test-secret', accountId: 'a'.repeat(32), fetchImpl: async (url, options) => {
    assert.equal(url, `https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/ai/run`);
    assert.equal(options.headers.Authorization, 'Bearer test-secret');
    assert(!options.body.includes('test-secret')); assert.equal(JSON.parse(options.body).model, 'typesafe/jev');
    return { ok: true, json: async () => ({ result: { answers: { next_action: { type: 'choice', choice: 'move_P01_jade', confidence: 1, probabilities: { move_P01_jade: 1 } } } } }) };
  } });
  assert.equal(result.action.destination, 'jade');
});
test('billing failures stop without choosing an action or leaking upstream payloads', async () => {
  await assert.rejects(decide(scene(), { token: 'secret', accountId: 'a'.repeat(32), fetchImpl: async () => ({ ok: false, status: 402 }) }), /insufficient AI gateway balance/);
});
