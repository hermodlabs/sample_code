import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createDecisionLab } from '@decision-lab/sdk';
import { createNodeExecutor } from '@decision-lab/sdk/node';
import { buildCase, cents, formatMinutes, summarizeRun, toDraft } from '../src/gifting.js';

const data = new URL('../public/data/', import.meta.url);
const config = JSON.parse(await readFile(new URL('config.json', data)));
const appPackage = JSON.parse(await readFile(new URL(config.appUrl, data)));
const cases = await Promise.all(config.cases.map(async entry => (
  JSON.parse(await readFile(new URL(entry.url, data)))
)));

test('forms round trip complete cases and preserve separate record scopes', () => {
  for (const inputs of cases) {
    assert.deepEqual(buildCase(inputs, toDraft(inputs, config), config), inputs);
  }
  const source = structuredClone(cases[1]);
  const draft = toDraft(source, config);
  draft.quotes[0].totalCost = '19.95';
  const prepared = buildCase(source, draft, config);
  assert.equal(prepared.tables.packages[0].repairCostMinor, 1995);
  assert.equal(prepared.parameters.insertRevision, 'insert-4');
  assert.equal(prepared.tables.confirmations[0].insertRevision, 'insert-3');
  for (const table of ['permissions', 'scenarios', 'people', 'resources', 'calendars', 'bookings']) {
    assert.deepEqual(prepared.tables[table], source.tables[table]);
  }
  for (const [index, row] of prepared.tables.packages.entries()) {
    for (const flag of ['fixes0', 'fixes1', 'fixes2']) {
      assert.equal(row[flag], source.tables.packages[index][flag]);
    }
  }
  assert.deepEqual(source, cases[1], 'mapping never mutates the imported case');
});

test('missing or negative bookings never become positive evidence', () => {
  const source = structuredClone(cases[0]);
  source.tables.confirmations = [];
  const draft = toDraft(source, config);
  assert.equal(draft.confirmation.status, 'none');
  assert.equal(draft.confirmation.insertRevision, '');
  assert.equal(draft.confirmation.recordedBy, '');
  assert.deepEqual(buildCase(source, draft, config).tables.confirmations, []);
  draft.confirmation.status = 'positive';
  assert.throws(() => buildCase(source, draft, config), error => (
    error.issues.some(issue => issue.path === 'confirmation.source')
  ));

  const negative = structuredClone(cases[0]);
  negative.tables.confirmations[0].confirmed = false;
  const negativeDraft = toDraft(negative, config);
  assert.equal(negativeDraft.confirmation.status, 'negative');
  assert.deepEqual(buildCase(negative, negativeDraft, config), negative);
});

test('money and elapsed minutes have explicit units and reject coercion', () => {
  assert.equal(cents('0.01'), 1);
  assert.equal(cents('400'), 40000);
  assert.equal(formatMinutes(20), '20 min');
  for (const value of ['', '-1', '0.001', '4,000', ' 100', '1e3']) {
    assert.throws(() => cents(value));
  }
  for (const [field, value] of [['repairMinutes', '1.5'], ['quantity', '']]) {
    const draft = toDraft(cases[0], config);
    draft.quotes[0][field] = value;
    assert.throws(() => buildCase(cases[0], draft, config), error => error.issues.length > 0);
  }
  const draft = toDraft(cases[0], config);
  draft.quotes[0].currency = 'EUR';
  assert.throws(() => buildCase(cases[0], draft, config), error => (
    error.issues.some(issue => /USD/.test(issue.message))
  ));
  draft.quotes[0].currency = 'USD';
  draft.quotes.push({ ...draft.quotes[0] });
  assert.throws(() => buildCase(cases[0], draft, config), error => (
    error.issues.some(issue => issue.path === 'quotes')
  ));
});

// These are actual SDK assessments in a Node worker, not a replacement engine.
// The browser worker must produce the same native conclusions for these inputs.
test('native SDK chooses the fastest authorized package across all eight scenarios', async () => {
  const executor = createNodeExecutor();
  const lab = createDecisionLab({ executor });
  const app = lab.apps.open(appPackage);
  try {
    const expected = [['external-replace-and-repair'], ['replace-and-repair'], []];
    for (const [index, inputs] of cases.entries()) {
      const bound = lab.cases.create({ app, inputs });
      assert.equal(lab.cases.validate({ app, case: bound }).valid, true);
      const run = await lab.run({ app, case: bound, reportOptions: { scope: 'all', locale: 'en-US' } });
      const result = summarizeRun(run, config);
      assert.equal(result.available, true);
      assert.deepEqual(result.preferredIds, expected[index]);
      assert.equal(result.plans.length, 5);
      assert.equal(result.scenarioCount, 8);
      assert.deepEqual(run.input.inputs.tables.scenarios, inputs.tables.scenarios);
      if (index === 0) {
        assert.equal(result.preferred[0].expense, 40000);
        assert.equal(result.preferred[0].finishMinute, 20);
      }
      if (index === 1) {
        assert.equal(result.preferred[0].expense, 30000);
        assert.equal(result.preferred[0].finishMinute, 35);
        const external = result.plans.find(plan => plan.packageId === 'external-replace-and-repair');
        assert.ok(external.blockers.some(blocker => blocker.id === 'scoped-package-confirmation'));
      }
      if (index === 2) {
        assert.equal(result.status, 'blocked');
        assert.equal(result.finding, 'no_feasible_plan');
        assert.ok(result.plans.every(plan => !plan.feasible));
      }
    }

    // Recording a newer booking does not renew old package permissions.
    for (const index of [1, 2]) {
      const draft = toDraft(cases[index], config);
      draft.confirmation.id = `NEW-BOOKING-${cases[index].id}`;
      draft.confirmation.insertRevision = 'insert-4';
      const inputs = buildCase(cases[index], draft, config);
      const bound = lab.cases.create({ app, inputs });
      const run = await lab.run({ app, case: bound, reportOptions: { scope: 'all' } });
      const result = summarizeRun(run, config);
      assert.deepEqual(result.preferredIds, index === 1 ? ['external-replace-and-repair'] : []);
      assert.deepEqual(run.input.inputs.tables.permissions, cases[index].tables.permissions);
    }
  } finally {
    await executor.close();
  }
});

test('ties and additional start options survive projection; partial searches cannot recommend', async () => {
  const executor = createNodeExecutor();
  const lab = createDecisionLab({ executor });
  const app = lab.apps.open(appPackage);
  try {
    const inputs = structuredClone(cases[0]);
    inputs.parameters.startOptions = [0, 5];
    const internal = inputs.tables.packages.find(row => row.id === 'replace-and-repair');
    internal.repairMinutes = 10;
    internal.repairCostMinor = 40000;
    const bound = lab.cases.create({ app, inputs });
    const run = await lab.run({ app, case: bound, reportOptions: { scope: 'all' } });
    const result = summarizeRun(run, config);
    assert.equal(result.available, true);
    assert.equal(result.plans.length, 10, 'each start option remains a distinct candidate');
    assert.deepEqual(result.preferredIds, ['replace-and-repair', 'external-replace-and-repair']);
    assert.ok(result.preferred.every(plan => plan.startMinute === 0 && plan.finishMinute === 20));

    const limited = await lab.run({
      app, case: bound, assessmentOptions: { maxPlans: 0 }, reportOptions: { scope: 'all' },
    });
    const unavailable = summarizeRun(limited, config);
    assert.equal(unavailable.available, false);
    assert.equal(unavailable.status, 'unavailable');
    assert.deepEqual(unavailable.preferredIds, []);
  } finally {
    await executor.close();
  }
});

test('a missing budget remains an explicit native validation error', async () => {
  const lab = createDecisionLab();
  const app = lab.apps.open(appPackage);
  const inputs = structuredClone(cases[0]);
  inputs.parameters.budgetMinor = null;
  const bound = lab.cases.create({ app, inputs });
  const validation = lab.cases.validate({ app, case: bound });
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some(issue => issue.path.includes('budgetMinor')));
});
