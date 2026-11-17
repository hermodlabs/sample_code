/**
 * Project the SDK report into the reservation desk's business view.
 *
 * Adapted from the CLI example's browser-safe report projection. Both consumers
 * read the same public ReportDocument contract; no rules are evaluated here.
 *
 * This is a report adapter, not another shipment evaluator. It reads choices,
 * expenses, consequences, failed checks, and preference ties already calculated
 * by Decision Lab. In particular, it never adds a quote to a fee, recalculates an
 * arrival, tests a confirmation, or promotes an otherwise blocked arrangement.
 *
 * The adapter deliberately requires a complete assessment. A partial search can
 * contain a feasible witness without establishing the best available choice.
 * The desk's question is which recommendations changed, so a partial witness
 * cannot be presented as a current recommendation here.
 */

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (object, key) => plain(object) && Object.hasOwn(object, key);
const array = value => Array.isArray(value) ? value : [];
const text = value => value === null || value === undefined ? '' : String(value);
const unique = values => new Set(values).size === values.length;
const same = (a, b) => stable(a) === stable(b);
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (plain(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function table(report, id) {
  const value = report.datasets?.[id];
  return value?.kind === 'table' && Array.isArray(value.rows) ? value : null;
}
function raw(row, key) {
  const cell = row?.cells?.[key];
  if (cell?.available !== true || !own(cell, 'raw')) throw new Error(`The report has no available ${key} value.`);
  return cell.raw;
}
function tablesInSection(report, dataset, sectionId) {
  if (!sectionId || !Array.isArray(dataset.sections?.[sectionId])) throw new Error('A retained plan section is missing.');
  return dataset.sections[sectionId].map(section => table(report, section.datasetId)).filter(Boolean);
}
function hasColumns(value, required) {
  return required.every(key => value.columns?.some(column => column.id === key));
}
function oneTable(values, columns) {
  const found = values.filter(value => hasColumns(value, columns));
  if (found.length !== 1) throw new Error(`The retained report needs one ${columns.join('/')} table for each plan and situation.`);
  return found[0];
}
function assert(condition, message) { if (!condition) throw new Error(message); }

/** Format model minutes using a configured, fixed origin; do not assume local TZ. */
export function formatMinute(minute, options = {}) {
  const origin = Date.parse(options.timeOrigin ?? '');
  if (!Number.isFinite(minute) || !Number.isFinite(origin)) return 'Not established';
  const date = new Date(origin + minute * 60_000);
  if (!Number.isFinite(date.getTime())) return 'Not established';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: options.timeZone ?? 'UTC', month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    }).format(date);
  } catch { return 'Not established'; }
}

function money(value, options) {
  if (!Number.isFinite(value)) return 'Not established';
  const divisor = options.moneyDivisor ?? 100;
  if (!Number.isFinite(divisor) || divisor <= 0) return 'Not established';
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: options.currency ?? 'USD' }).format(value / divisor); }
  catch { return 'Not established'; }
}

/**
 * Read one complete complete-a-commitment/1 run produced by `decision-lab run`.
 *
 * `preferredIds` contains business arrangement IDs, not generated plan IDs. Keep
 * every tied preferred plan: picking the first row would invent a tie-breaker.
 * `expectedBinding` should be the pinned app/case binding retained by the caller.
 * The full run remains the audit record; this projection is intentionally small.
 */
export function projectRun(run, options = {}) {
  const unavailable = message => ({
    status: 'unavailable', available: false, issues: [message], identity: run?.identity ?? null,
    scope: null, finding: run?.assessment?.finding ?? null, preferredIds: [], preferredPlanIds: [],
    preferred: [], plans: [], blockers: [],
  });
  try {
    assert(run?.format === 'decision-lab-run/1', 'The file is not a supported Decision Lab run.');
    assert(run.execution?.status === 'completed', `The assessment did not complete (${text(run.execution?.status) || 'unknown execution status'}).`);
    const report = run.report;
    assert(report?.format === 'decision-lab-report/1', 'The run has no complete retained report.');
    const completeness = report.completeness;
    assert(completeness?.materialized === true && completeness.allRequestedViews === true
      && completeness.allRetainedContexts === true && completeness.truncated === false
      && completeness.assessmentComplete === true, 'The retained report is incomplete or truncated.');
    const dataset = report.datasets?.commitment;
    assert(plain(dataset), 'The run has no commitment report dataset.');
    const assessment = dataset.assessment;
    assert(assessment?.format === 'complete-a-commitment.assessment-normalized/1'
      && assessment.pattern === 'complete-a-commitment/1' && assessment.status === 'complete',
    'The commitment assessment is unavailable, invalid, or incomplete.');
    assert(run.assessment?.format === 'complete-a-commitment.assessment-reference/1'
      && run.assessment.datasetId === 'commitment'
      && run.assessment.assessmentHash === assessment.assessmentHash
      && run.assessment.status === assessment.status && run.assessment.finding === assessment.finding
      && same(run.assessment.coverage, assessment.coverage) && same(run.assessment.basis, assessment.basis),
    'The run and report do not retain the same assessment basis.');
    assert(['feasible_witness', 'no_feasible_plan'].includes(assessment.finding), 'The assessment does not establish a shipment finding.');

    // A valid JSON object can still pair a report with the wrong run or inputs.
    // Check the identities supplied by the CLI before drawing conclusions.
    const identity = run.identity;
    assert(plain(identity) && identity.pattern === 'complete-a-commitment/1', 'The run belongs to a different reasoning pattern.');
    for (const key of ['runId', 'appId', 'release', 'appHash', 'packageHash', 'pattern', 'moduleHash', 'inputHash', 'modelHash']) {
      assert(identity[key] !== undefined && report.identity?.[key] === identity[key], `The report and run differ at ${key}.`);
    }
    assert(run.execution.inputHash === identity.inputHash
      && report.evaluatedInput?.inputHash === identity.inputHash, 'The retained input identity differs from the execution.');
    for (const binding of [run.input?.binding, report.evaluatedInput?.binding]) {
      assert(plain(binding), 'A retained case binding is missing.');
      for (const key of ['appId', 'release', 'appHash', 'packageHash', 'pattern', 'moduleHash']) {
        assert(binding[key] === identity[key], `The case and run differ at ${key}.`);
      }
    }
    if (options.expectedBinding) {
      for (const [key, value] of Object.entries(options.expectedBinding)) {
        if (value !== undefined) assert(identity[key] === value, `The run does not use the expected ${key}.`);
      }
    }
    assert(same(run.input?.inputs, report.evaluatedInput?.inputs), 'The retained case inputs differ from the reported inputs.');
    assert(report.evaluatedInput?.model?.format === 'complete-a-commitment/1'
      && same(report.evaluatedInput.model.case, report.evaluatedInput.inputs), 'The evaluated model and case inputs differ.');

    const coverage = assessment.coverage;
    const declared = array(dataset.plans);
    const scenarios = array(dataset.scenarios);
    assert(coverage?.complete === true && coverage.admissionComplete === true,
      'The assessment did not examine the complete admitted possibility set.');
    assert(Number.isSafeInteger(coverage.totalCandidates) && coverage.totalCandidates >= 1
      && coverage.totalCandidates === coverage.evaluatedCandidates
      && coverage.totalCandidates === coverage.visitedCandidates
      && coverage.totalCandidates === declared.length && completeness.planCount === declared.length,
    'The retained report does not contain every complete alternative.');
    assert(Number.isSafeInteger(coverage.totalScenarios) && coverage.totalScenarios >= 1
      && coverage.totalScenarios === scenarios.length && completeness.scenarioCount === scenarios.length
      && unique(scenarios.map(row => row.id)), 'The retained report does not contain every operating situation.');
    const expectedContexts = declared.length * scenarios.length;
    assert(coverage.totalPlanScenarioChecks === expectedContexts
      && coverage.evaluatedPlanScenarioChecks === expectedContexts
      && completeness.evaluatedPlanScenarioChecks === expectedContexts,
    'The assessment has incomplete plan and operating-situation coverage.');
    assert(unique(declared.map(row => row.id)) && declared.every(row => row.complete === true
      && typeof row.feasible === 'boolean' && typeof row.id === 'string'), 'The report has incomplete or duplicated plan identities.');

    const comparison = table(report, 'commitment:comparison');
    assert(comparison?.rows.length === declared.length && unique(comparison.rows.map(row => row.id)),
      'The report comparison does not contain every plan exactly once.');
    const contexts = report.contextIndexes?.planScenarios;
    assert(contexts?.entries?.length === expectedContexts, 'Some retained plan and operating-situation contexts are missing.');
    assert(unique(contexts.entries.map(row => `${row.planId}\u0000${row.scenarioId}`)), 'The report repeats a plan and operating-situation context.');
    assert(contexts.entries.every(row => declared.some(plan => plan.id === row.planId)
      && scenarios.some(scenario => scenario.id === row.scenarioId)), 'The report has an unfamiliar plan or operating-situation identity.');

    const module = report.evaluatedInput.model.module;
    const labels = module?.labels ?? {};
    const declaredCheckIds = array(module?.constraints).map(constraint => constraint.id);
    assert(declaredCheckIds.length > 0 && unique(declaredCheckIds)
      && declaredCheckIds.every(id => typeof id === 'string'), 'The evaluated module has no complete condition catalog.');
    const plans = declared.map(plan => {
      const row = comparison.rows.find(value => value.id === plan.id);
      assert(row && raw(row, 'plan') === plan.id, 'A comparison row does not match its plan identity.');
      const arrangementId = raw(row, 'choice:arrangement');
      const expense = raw(row, 'expense');
      assert(typeof arrangementId === 'string' && arrangementId.length > 0 && Number.isFinite(expense),
        'A shipment comparison has no usable arrangement or expense.');
      assert(report.evaluatedInput.inputs.tables?.arrangements?.some(value => value.id === arrangementId),
        'A reported arrangement is absent from the evaluated case.');
      const planContexts = contexts.entries.filter(context => context.planId === plan.id);
      assert(planContexts.length === scenarios.length, 'An alternative is missing an operating situation.');
      const blockers = [];
      const arrivals = [];
      for (const context of planContexts) {
        const checks = oneTable(tablesInSection(report, dataset, context.sections?.checks), ['check', 'requirement', 'status']);
        assert(checks.rows.length === declaredCheckIds.length && unique(checks.rows.map(check => check.id))
          && declaredCheckIds.every(id => checks.rows.some(check => check.id === id)), 'The report has missing or repeated conditions.');
        for (const check of checks.rows) {
          const passed = raw(check, 'status');
          assert(typeof passed === 'boolean', 'A retained condition has no established result.');
          if (!passed) blockers.push({
            id: check.id, planId: plan.id, arrangementId, scenarioId: context.scenarioId,
            label: options.labels?.checks?.[check.id] ?? labels[`constraint.${check.id}`] ?? text(raw(check, 'check')),
            requirement: text(raw(check, 'requirement')),
          });
        }
        const consequences = oneTable(tablesInSection(report, dataset, context.sections?.schedule), ['value', 'result']);
        const arrival = consequences.rows.find(value => value.id === 'arrival');
        const value = raw(arrival, 'result');
        assert(Number.isFinite(value), 'A retained shipment arrival is unavailable.');
        arrivals.push(value);
      }
      assert(plan.feasible === (blockers.length === 0), 'The plan finding and its retained failed checks disagree.');
      assert(raw(row, 'blockers') === blockers.length, 'The plan comparison omits or adds failed checks.');
      // This importer supports static shipment arrangements. If a future profile
      // has scenario-dependent arrivals, retain its report and add an explicit
      // presentation instead of silently choosing an optimistic arrival here.
      assert(arrivals.every(value => value === arrivals[0]), 'The report has scenario-dependent arrivals; this summary cannot display a single arrival.');
      return {
        id: plan.id, arrangementId, label: options.labels?.arrangements?.[arrangementId] ?? arrangementId,
        feasible: plan.feasible, preferred: false, expense, expenseDisplay: money(expense, options),
        arrivalMinutes: arrivals[0], arrival: formatMinute(arrivals[0], options), blockers,
      };
    });
    assert(unique(plans.map(plan => plan.arrangementId)), 'Several complete plans use the same arrangement; this adapter expects one plan per arrangement.');
    const feasible = plans.filter(plan => plan.feasible);
    assert((assessment.finding === 'feasible_witness') === (feasible.length > 0), 'The summary finding disagrees with the retained alternatives.');
    assert(dataset.summary?.finding === assessment.finding, 'The report summary has a different finding.');
    const recommendation = dataset.summary?.recommendation;
    let preferredPlanIds = [];
    if (feasible.length > 0) {
      assert(dataset.summary.optimalityEstablished === true && recommendation?.preferenceEstablished === true,
        'The complete assessment has not established the declared preference.');
      preferredPlanIds = array(recommendation.tiedPlanIds);
      assert(preferredPlanIds.length > 0 && unique(preferredPlanIds)
        && preferredPlanIds.includes(recommendation.planId)
        && preferredPlanIds.every(id => feasible.some(plan => plan.id === id))
        && recommendation.unique === (preferredPlanIds.length === 1), 'The preferred alternatives are incomplete or inconsistent.');
      for (const plan of plans) plan.preferred = preferredPlanIds.includes(plan.id);
    } else {
      assert(!recommendation || !recommendation.planId && array(recommendation.tiedPlanIds).length === 0,
        'A blocked finding also claims a preferred alternative.');
    }
    const preferred = plans.filter(plan => plan.preferred);
    const parameters = report.evaluatedInput.inputs.parameters;
    return {
      status: feasible.length ? 'eligible' : 'blocked', available: true, issues: [], identity: { ...identity },
      scope: { orderId: parameters.orderId, orderRevision: parameters.orderRevision, recipient: parameters.recipient,
        shipDate: parameters.shipDate, profileVersion: parameters.profileVersion },
      finding: assessment.finding, preferredIds: preferred.map(plan => plan.arrangementId), preferredPlanIds,
      preferred, plans, blockers: plans.flatMap(plan => plan.blockers), coverage: { ...coverage },
    };
  } catch (error) { return unavailable(error.message); }
}

