import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createNodeExecutor } from '@decision-lab/sdk/node';
import { createShipmentService } from '../src/sdk.mjs';
import { createDeskController } from '../src/controller.mjs';

const data = new URL('../public/data/', import.meta.url);
const config = JSON.parse(await readFile(new URL('config.json', data)));
const appPackage = JSON.parse(await readFile(new URL(config.appUrl, data)));
const readCase = async entry => JSON.parse(await readFile(new URL(entry.url, data)));

async function withDesk(operation, options = {}) {
  const downloads = [];
  const service = createShipmentService({ executor: createNodeExecutor(), ...options });
  const controller = createDeskController({ service,
    loadDefinition: async () => ({ config, appPackage }), loadCase: readCase,
    saveFile: (name, source) => downloads.push({ name, source }), now: () => '2026-11-17T14:05:00Z' });
  try { await controller.initialize(); await operation({ controller, service, downloads }); }
  finally { await controller.dispose(); }
}

// Real worker execution is used throughout. These verify lifecycle behavior
// around the SDK rather than replacing its result with a test implementation.
test('edited records invalidate current output, then retain both native calculations on export', async () => withDesk(async ({ controller, service, downloads }) => {
  assert.deepEqual(controller.getSnapshot().current.preferredIds, ['consolidated']);
  const original = structuredClone(controller.getSnapshot().caseData);
  controller.editConfirmation('status', 'none');
  let state = controller.getSnapshot();
  assert.equal(state.phase, 'dirty');
  assert.equal(state.current, null);
  assert.deepEqual(state.before.preferredIds, ['consolidated']);
  controller.downloadReview();
  assert.equal(downloads.length, 0, 'stale results cannot be exported as current');
  await controller.evaluate();
  state = controller.getSnapshot();
  assert.equal(state.phase, 'complete');
  assert.deepEqual(state.current.preferredIds, ['direct']);
  assert.deepEqual(state.before.preferredIds, ['consolidated']);
  assert.deepEqual(state.caseData, original, 'the editable source retains its initial basis');
  controller.downloadReview();
  const bundle = JSON.parse(downloads[0].source);
  assert.equal(bundle.format, 'shipment-reservation-review/1');
  assert.equal(bundle.case.tables.slotConfirmations.length, 0);
  assert.ok(bundle.previousRun);
  assert.equal(service.parse(downloads[0].source).run.identity.inputHash, state.lastRun.identity.inputHash);
  controller.downloadCase();
  const caseOnly = JSON.parse(downloads[1].source);
  assert.deepEqual(caseOnly, bundle.run.input.inputs);
  await controller.selectCase('permissions');
  assert.equal(controller.getSnapshot().current.status, 'blocked');
  await controller.importCaseText(downloads[0].source);
  assert.equal(controller.getSnapshot().selectedCaseId, '');
  assert.deepEqual(controller.getSnapshot().current.preferredIds, ['direct']);
  assert.deepEqual(controller.getSnapshot().before.preferredIds, ['consolidated']);
}));

test('invalid currency withholds a new finding and does not alter the last full run', async () => withDesk(async ({ controller, downloads }) => {
  const previous = controller.getSnapshot().lastRun.identity.inputHash;
  controller.editQuote('direct', 'currency', 'EUR');
  await controller.evaluate();
  const state = controller.getSnapshot();
  assert.equal(state.phase, 'invalid');
  assert.equal(state.current, null);
  assert.ok(state.issues.some(issue => /USD/.test(issue.message)));
  assert.equal(state.lastRun.identity.inputHash, previous);
  controller.downloadReview(); assert.equal(downloads.length, 0);
}));

test('a newly scoped confirmation can restore Consolidated, but cannot create missing permissions', async () => withDesk(async ({ controller }) => {
  await controller.selectCase('revised');
  assert.deepEqual(controller.getSnapshot().current.preferredIds, ['direct']);
  const grants = structuredClone(controller.getSnapshot().caseData.tables.grants);
  controller.editConfirmation('slotReference', 'NEW-SLOT-105-R2');
  controller.editConfirmation('orderRevision', '2');
  await controller.evaluate();
  assert.deepEqual(controller.getSnapshot().current.preferredIds, ['consolidated']);
  assert.deepEqual(controller.getSnapshot().lastRun.input.inputs.tables.grants, grants);
  await controller.selectCase('permissions');
  controller.editConfirmation('slotReference', 'NEW-SLOT-106-R2');
  controller.editConfirmation('orderRevision', '2');
  await controller.evaluate();
  const state = controller.getSnapshot();
  assert.equal(state.current.status, 'blocked');
  assert.ok(state.current.plans.find(plan => plan.arrangementId === 'consolidated').blockers.some(blocker => blocker.id === 'arrangement-selection-authority'));
  assert.ok(state.lastRun.input.inputs.tables.grants.every(grant => grant.orderRevision === '1'));
}));

test('equally preferred native arrangements remain a tie in the team view', async () => withDesk(async ({ controller }) => {
  controller.editQuote('direct', 'totalCost', '5000.00');
  controller.editQuote('direct', 'travelMinutes', '2520');
  await controller.evaluate();
  assert.equal(controller.getSnapshot().phase, 'complete');
  assert.deepEqual(controller.getSnapshot().current.preferredIds, ['direct', 'consolidated']);
}));

test('edits and case changes abort superseded work without accepting a late result', async () => withDesk(async ({ controller }) => {
  const pending = controller.evaluate();
  controller.editQuote('consolidated', 'totalCost', '5001.00');
  await pending;
  assert.equal(controller.getSnapshot().phase, 'dirty');
  assert.equal(controller.getSnapshot().current, null);
  const superseded = controller.evaluate();
  await controller.selectCase('permissions');
  await superseded;
  const state = controller.getSnapshot();
  assert.equal(state.selectedCaseId, 'permissions');
  assert.equal(state.current.scope.orderId, 'ORD-106');
  assert.equal(state.current.finding, 'no_feasible_plan');
}));

test('cancel leaves a stale draft that can be reassessed, never a current success', async () => withDesk(async ({ controller }) => {
  const pending = controller.evaluate(); controller.cancel(); await pending;
  assert.equal(controller.getSnapshot().phase, 'dirty');
  assert.equal(controller.getSnapshot().current, null);
  assert.match(controller.getSnapshot().issues[0].message, /cancelled/);
  await controller.evaluate();
  assert.deepEqual(controller.getSnapshot().current.preferredIds, ['consolidated']);
}));

test('bounded incomplete native results are unavailable rather than blocked or preferred', async () => withDesk(async ({ controller, downloads }) => {
  const state = controller.getSnapshot();
  assert.equal(state.phase, 'unavailable');
  assert.equal(state.current.available, false);
  assert.deepEqual(state.current.preferredIds, []);
  assert.equal(state.lastRun.report.completeness.assessmentComplete, false);
  controller.downloadReview(); assert.equal(downloads.length, 0);
}, { assessmentOptions: { maxPlans: 0 } }));

test('a failed import preserves the form and rejects mismatched or altered review artifacts', async () => withDesk(async ({ controller, downloads }) => {
  const original = structuredClone(controller.getSnapshot().draft);
  controller.downloadReview();
  const bundle = JSON.parse(downloads[0].source);
  bundle.case.parameters.orderRevision = '999';
  await controller.importCaseText(JSON.stringify(bundle));
  assert.equal(controller.getSnapshot().phase, 'invalid');
  assert.equal(controller.getSnapshot().current, null);
  assert.deepEqual(controller.getSnapshot().draft, original);
  assert.match(controller.getSnapshot().issues[0].message, /differ/);
  bundle.appPackage.app.id = 'different-app';
  await controller.importCaseText(JSON.stringify(bundle));
  assert.equal(controller.getSnapshot().phase, 'invalid');
  assert.ok(controller.getSnapshot().issues.length);
}));
