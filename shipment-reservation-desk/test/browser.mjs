/**
 * Exercise the copied, production-built client through its public interface.
 *
 * The CLI is only a test oracle here. The browser application never imports it:
 * its worker executes the installed SDK, and this test compares the resulting
 * retained reports with the same cases evaluated by the public CLI command.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';
import { chromium } from 'playwright';
import { runCLI } from '@decision-lab/cli';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, '.output');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'reservation-desk-browser-'));
const checks = [];
let browser, server;

const json = async filename => JSON.parse(await fs.readFile(filename, 'utf8'));
const cells = row => Object.fromEntries(Object.entries(row.cells).map(([key, cell]) => [key, cell.raw]));
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Read the SDK's prepared report. These are calculated facts, not shipment rules.
function outcome(run) {
  assert.equal(run.format, 'decision-lab-run/1');
  assert.equal(run.execution.status, 'completed');
  assert.equal(run.report.completeness.assessmentComplete, true);
  assert.equal(run.report.completeness.truncated, false);
  const report = run.report;
  const dataset = report.datasets.commitment;
  assert.equal(dataset.assessment.coverage.complete, true);
  const contexts = report.contextIndexes.planScenarios.entries;
  const sectionTables = sectionId => dataset.sections[sectionId].map(section => report.datasets[section.datasetId]).filter(table => table?.kind === 'table');
  const tableWith = (sectionId, keys) => {
    const tables = sectionTables(sectionId).filter(table => keys.every(key => table.columns.some(column => column.id === key)));
    assert.equal(tables.length, 1);
    return tables[0];
  };
  const preferred = dataset.summary.recommendation?.tiedPlanIds ?? [];
  const plans = report.datasets['commitment:comparison'].rows.map(row => {
    const comparison = cells(row);
    const plan = dataset.plans.find(candidate => candidate.id === row.id);
    const situations = contexts.filter(context => context.planId === row.id).map(context => {
      const failedChecks = tableWith(context.sections.checks, ['check', 'status']).rows
        .filter(check => check.cells.status.raw === false).map(check => check.id).sort();
      const arrival = tableWith(context.sections.schedule, ['value', 'result']).rows.find(value => value.id === 'arrival');
      assert.ok(arrival);
      return { scenarioId: context.scenarioId, arrival: arrival.cells.result.raw, failedChecks };
    });
    return { arrangement: comparison['choice:arrangement'], feasible: plan.feasible, preferred: preferred.includes(row.id), expense: comparison.expense, situations };
  }).sort((a, b) => a.arrangement.localeCompare(b.arrangement));
  return { finding: run.assessment.finding, plans };
}

async function cliRun(caseFile, name) {
  const filename = path.join(temporary, `${name}.run.json`);
  let stderr = '';
  const code = await runCLI(['run', '--app', path.join(root, 'public/data/shipment-review.app.json'), '--case', caseFile,
    '--reports', 'all', '--run-id', `reservation-desk-browser-${name}`, '--created-at', '2026-11-17T14:00:00.000Z',
    '--timeout-ms', '30000', '--output', filename], {
    stdout: { write() {} }, stderr: { write(chunk) { stderr += chunk; } },
  });
  assert.equal(code, 0, `CLI ${name}: ${stderr}`);
  return json(filename);
}

async function downloadReview(page) {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 45_000 }),
    page.getByRole('button', { name: 'Download review', exact: true }).click({ timeout: 45_000 }),
  ]);
  const filename = await download.path();
  assert.ok(filename, 'The browser retained the complete review download.');
  const review = await json(filename);
  assert.equal(review.format, 'shipment-reservation-review/1');
  assert.ok(review.run?.report, 'The review retains the complete SDK report, not just a display summary.');
  return review;
}

async function assertPageFlow(page, viewport) {
  await page.setViewportSize(viewport);
  const layout = await page.evaluate(() => {
    const nestedScroll = [...document.querySelectorAll('main, section, article, aside, [role="region"]')]
      .filter(element => ['auto', 'scroll'].includes(getComputedStyle(element).overflowY) && element.scrollHeight > element.clientHeight + 2)
      .map(element => `${element.tagName.toLowerCase()}.${element.className}`);
    return { viewport: innerWidth, width: document.documentElement.scrollWidth, nestedScroll };
  });
  assert.ok(layout.width <= layout.viewport + 1, `The ${viewport.width}px layout overflows horizontally: ${JSON.stringify(layout)}`);
  assert.deepEqual(layout.nestedScroll, [], 'The page scrolls normally; report panels do not trap vertical scrolling.');
}

async function screenshot(page, filename) {
  // A downloaded file restores focus differently across Chrome versions. Reset
  // focus and scroll before capturing the layout, rather than a hover/focus state.
  await page.evaluate(async () => {
    document.activeElement?.blur();
    window.scrollTo(0, 0);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.screenshot({ path: path.join(output, filename), fullPage: true, animations: 'disabled', caret: 'hide' });
}

try {
  await fs.mkdir(output, { recursive: true });
  await build({ configFile: path.join(root, 'vite.config.mjs') });
  server = await preview({ configFile: path.join(root, 'vite.config.mjs'), preview: { host: '127.0.0.1', port: 0, strictPort: false } });
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/`;
  const response = await fetch(base);
  assert.equal(response.status, 200, 'The production preview serves a successful response.');
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  browser = await chromium.launch({ headless: true, executablePath: process.env.HERMOD_CHROMIUM_PATH || (existsSync(chrome) ? chrome : undefined), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ acceptDownloads: true, serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } });
  await context.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = [], workers = [], requested = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('worker', worker => workers.push(worker.url()));
  page.on('request', request => requested.push(request.url()));
  await page.goto(base);

  const config = await json(path.join(root, 'public/data/config.json'));
  const selectCase = id => page.getByRole('button', { name: new RegExp(escapeRegex(config.cases.find(value => value.id === id).label)) }).click({ timeout: 45_000 });
  const expected = { confirmed: ['consolidated'], revised: ['direct'], permissions: [] };
  for (const [id, preferred] of Object.entries(expected)) {
    await selectCase(id);
    const review = await downloadReview(page);
    const reference = await cliRun(path.join(root, `public/data/cases/${id}.json`), id);
    const actual = outcome(review.run);
    assert.deepEqual(actual, outcome(reference), `${id}: SDK browser and public CLI return the same costs, arrivals, eligibility, preference and failed conditions.`);
    assert.deepEqual(actual.plans.filter(plan => plan.preferred).map(plan => plan.arrangement).sort(), preferred);
    assert.deepEqual(review.case, review.run.input.inputs, 'Downloaded inputs are exactly those evaluated.');
    checks.push(`${id}: browser worker and CLI agree on every arrangement and failed condition`);
    if (id === 'confirmed') {
      await assertPageFlow(page, { width: 1440, height: 1000 });
      await screenshot(page, 'browser-desktop.png');
      await assertPageFlow(page, { width: 390, height: 844 });
      await screenshot(page, 'browser-mobile.png');
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
  }

  await selectCase('confirmed');
  await downloadReview(page);
  await page.getByRole('button', { name: 'Consolidated', exact: true }).click();
  await page.getByLabel('Complete quote amount', { exact: true }).fill('5100');
  assert.equal(await page.getByRole('button', { name: 'Download review', exact: true }).isDisabled(), true);
  await page.getByText('Records changed. Review again.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'All arrangements', exact: true }).count(), 0, 'Superseded arrangements are not shown as a current result.');
  await page.getByRole('heading', { name: 'Last calculated proposal', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Review arrangements', exact: true }).click();
  const changed = await downloadReview(page);
  const changedFile = path.join(temporary, 'changed-case.json');
  await fs.writeFile(changedFile, JSON.stringify(changed.case));
  assert.deepEqual(outcome(changed.run), outcome(await cliRun(changedFile, 'changed-quote')));
  assert.deepEqual(outcome(changed.run).plans.filter(plan => plan.preferred).map(plan => plan.arrangement), ['direct']);
  assert.ok(changed.previousRun, 'The earlier complete calculation is retained separately for comparison.');
  checks.push('A changed quote invalidates the displayed recommendation; reassessment agrees with the CLI and retains the earlier basis');

  await page.getByLabel('Quote currency', { exact: true }).selectOption('EUR');
  await page.getByRole('button', { name: 'Review arrangements', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: /USD/ }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Download review', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('heading', { name: 'All arrangements', exact: true }).count(), 0, 'Unsupported currency never falls back to an older favorable recommendation.');
  checks.push('Unsupported quote currency produces an input error and withholds the current review');

  await page.getByLabel('Import canonical case JSON', { exact: true }).setInputFiles(path.join(root, 'public/data/cases/revised.json'));
  const imported = await downloadReview(page);
  const importedReference = await cliRun(path.join(root, 'public/data/cases/revised.json'), 'imported-case');
  assert.deepEqual(outcome(imported.run), outcome(importedReference));
  checks.push('A complete canonical case can be imported and evaluated without changing its permission or confirmation scope');
  await screenshot(page, 'browser-imported.png');

  assert.ok(workers.length > 0, 'The real browser worker ran.');
  assert.ok(workers.every(url => url.startsWith(base) && new URL(url).pathname.startsWith('/assets/') && !url.includes('/src/')), `Workers are emitted production assets: ${JSON.stringify(workers)}`);
  assert.ok(requested.some(url => new URL(url).pathname.startsWith('/assets/') && url.endsWith('.js')), 'The production build serves the emitted JavaScript assets.');
  assert.deepEqual(errors, []);
  checks.push('Production worker assets load from the built client; desktop/mobile panels use normal page scrolling');
  const result = { suite: 'Shipment Reservation Desk production browser', checks, workers: workers.map(url => new URL(url).pathname) };
  await fs.writeFile(path.join(output, 'browser-results.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (browser) await browser.close();
  if (server?.httpServer.listening) await new Promise(resolve => server.httpServer.close(resolve));
  await fs.rm(temporary, { recursive: true, force: true });
}
