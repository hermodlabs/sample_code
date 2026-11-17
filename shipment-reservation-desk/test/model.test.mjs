import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildCase, toDraft, cents, localTime, minuteFromLocal } from '../src/model.mjs';

const config = JSON.parse(await readFile(new URL('../public/data/config.json', import.meta.url)));
const cases = await Promise.all(config.cases.map(async entry => JSON.parse(await readFile(new URL(`../public/data/${entry.url}`, import.meta.url)))));

test('forms round trip all complete CLI cases without changing records or scopes', () => {
  for (const inputs of cases) assert.deepEqual(buildCase(inputs, toDraft(inputs, config), config), inputs);
});

test('editing a quote preserves all permissions and original confirmation scope', () => {
  const inputs = cases[1], original = structuredClone(inputs), draft = toDraft(inputs, config);
  draft.quotes[0].totalCost = '3999.99';
  const prepared = buildCase(inputs, draft, config);
  assert.equal(prepared.tables.arrangements[0].fee, 399999);
  assert.equal(prepared.parameters.orderRevision, '2');
  assert.equal(prepared.tables.slotConfirmations[0].orderRevision, '1');
  assert.deepEqual(prepared.tables.grants, inputs.tables.grants);
  assert.deepEqual(prepared.tables.arrangementAuthorities, inputs.tables.arrangementAuthorities);
  assert.deepEqual(prepared.tables.readiness, inputs.tables.readiness);
  assert.deepEqual(inputs, original, 'mapping never mutates the retained source case');
});

test('absent confirmation stays absent and a new blank record does not fabricate evidence', () => {
  const inputs = structuredClone(cases[0]); inputs.tables.slotConfirmations = [];
  const draft = toDraft(inputs, config);
  assert.equal(draft.confirmation.status, 'none');
  assert.equal(draft.confirmation.orderRevision, '');
  assert.equal(draft.confirmation.slotReference, '');
  assert.deepEqual(buildCase(inputs, draft, config).tables.slotConfirmations, []);
  draft.confirmation.status = 'confirmed';
  assert.throws(() => buildCase(inputs, draft, config), error => error.issues.some(issue => issue.path === 'confirmation.slotReference'));
});

test('money and dates require exact supported units rather than coercion or local time guesses', () => {
  assert.equal(cents('0.01'), 1);
  assert.equal(cents('5000'), 500000);
  for (const value of ['', '-1', '0.001', '5,000', ' 100', '1e3']) assert.throws(() => cents(value));
  assert.equal(localTime(3960, config), '2026-11-19T18:00');
  assert.equal(minuteFromLocal('2026-11-19T18:00', config), 3960);
  for (const value of ['2026-02-30T12:00', '2026-11-17T25:00', '', '2026-11-19T18:00Z']) assert.throws(() => minuteFromLocal(value, config));
  const draft = toDraft(cases[0], config); draft.quotes[0].currency = 'EUR';
  assert.throws(() => buildCase(cases[0], draft, config), error => error.issues.some(issue => /USD/.test(issue.message)));
});

test('the confirmation form preserves a mismatched revision instead of repairing it', () => {
  const draft = toDraft(cases[1], config);
  assert.equal(draft.confirmation.orderRevision, '1');
  draft.confirmation.slotReference = 'REPLACEMENT-RECORD';
  draft.confirmation.orderRevision = '2';
  const inputs = buildCase(cases[1], draft, config);
  assert.equal(inputs.tables.slotConfirmations[0].orderRevision, '2');
  assert.equal(cases[1].tables.slotConfirmations[0].orderRevision, '1');
  assert.deepEqual(inputs.tables.grants, cases[1].tables.grants);
});
