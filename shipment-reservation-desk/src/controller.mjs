import { buildCase, toDraft } from './model.mjs';

const messages = error => error.issues?.length ? error.issues.map(issue => ({ path: issue.path ?? '', message: issue.message }))
  : [{ path: '', message: error.message }];

/**
 * UI orchestration, independent of React and browser storage. The service is the
 * public SDK adapter, not a replacement evaluator. An input edit immediately
 * invalidates current output. Abort plus a generation check prevents a worker
 * finishing late from publishing findings for an older draft or another order.
 */
export function createDeskController({ service, loadDefinition, loadCase, saveFile, now = () => new Date().toISOString() }) {
  let state = { loading: true, error: null, cases: [], selectedCaseId: '', config: null,
    caseData: null, draft: null, phase: 'loading', issues: [], current: null, before: null, lastRun: null };
  let generation = 0, active, latestRun = null, comparisonRun = null, disposed = false;
  const listeners = new Set();
  const publish = change => { if (!disposed) { state = { ...state, ...change }; listeners.forEach(listener => listener()); } };
  const invalidate = () => { generation += 1; active?.abort(); active = null; return generation; };
  const dirty = change => {
    invalidate();
    publish({ ...change, phase: 'dirty', current: null, before: state.current?.available ? state.current : state.before, error: null, issues: [] });
  };
  async function installCase(inputs, selectedCaseId, retained = {}) {
    const admitted = service.admit(inputs);
    const draft = toDraft(admitted, state.config);
    latestRun = retained.run ?? null; comparisonRun = retained.previousRun ?? null;
    const current = latestRun && service.project(latestRun);
    publish({ loading: false, caseData: admitted, draft, selectedCaseId, current,
      before: comparisonRun ? service.project(comparisonRun) : null, lastRun: latestRun,
      phase: current ? current.available ? 'complete' : 'unavailable' : 'ready', issues: [], error: null });
    if (!latestRun) await controller.evaluate();
  }
  const controller = {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async initialize() {
      const token = invalidate();
      try {
        const definition = await loadDefinition();
        if (disposed || token !== generation) return;
        service.open(definition);
        publish({ config: definition.config, cases: definition.config.cases });
        await controller.selectCase(definition.config.cases[0].id);
      } catch (error) { if (!disposed && token === generation) publish({ loading: false, phase: 'invalid', error: error.message, issues: messages(error) }); }
    },
    async selectCase(id) {
      const entry = state.cases.find(item => item.id === id);
      if (!entry) return;
      const token = invalidate(); latestRun = null; comparisonRun = null;
      publish({ loading: true, phase: 'loading', selectedCaseId: id, current: null, before: null, lastRun: null, caseData: null, draft: null, issues: [], error: null });
      try {
        const inputs = await loadCase(entry);
        if (!disposed && token === generation) await installCase(inputs, id);
      } catch (error) { if (!disposed && token === generation) publish({ loading: false, phase: 'invalid', error: error.message, issues: messages(error) }); }
    },
    editQuote(id, field, value) {
      if (!state.draft || !['shipPoint', 'currency', 'totalCost', 'departure', 'travelMinutes', 'capacity'].includes(field)) return;
      dirty({ draft: { ...state.draft, quotes: state.draft.quotes.map(row => row.id === id ? { ...row, [field]: value } : row) } });
    },
    editConfirmation(field, value) {
      if (!state.draft || !Object.hasOwn(state.draft.confirmation, field)) return;
      dirty({ draft: { ...state.draft, confirmation: { ...state.draft.confirmation, [field]: value } } });
    },
    async evaluate() {
      if (!state.caseData || !state.draft || disposed) return;
      const token = invalidate();
      const controller = new AbortController(); active = controller;
      const previous = latestRun;
      publish({ phase: 'running', current: null, before: previous ? service.project(previous) : state.before, issues: [], error: null });
      try {
        const inputs = service.admit(buildCase(state.caseData, state.draft, state.config));
        const run = await service.evaluate(inputs, { signal: controller.signal, priorRun: previous, createdAt: now() });
        if (disposed || token !== generation) return;
        const projected = service.project(run);
        // A partial or cancelled run is retained for diagnostics, but never
        // replaces the most recent complete comparison basis.
        if (projected.available) { comparisonRun = previous; latestRun = run; }
        publish({ phase: projected.available ? 'complete' : 'unavailable', current: projected, lastRun: run,
          issues: projected.issues.map(message => ({ path: '', message })) });
      } catch (error) {
        if (!disposed && token === generation) publish({ phase: error.name === 'FormError' || error.issues ? 'invalid' : 'unavailable', current: null, issues: messages(error), error: null });
      } finally { if (token === generation) active = null; }
    },
    cancel() {
      invalidate();
      publish({ phase: 'dirty', current: null, issues: [{ path: '', message: 'Review cancelled. Reassess the current records before using a recommendation.' }] });
    },
    async importCaseText(text) {
      const token = invalidate();
      // A failed import preserves the current form but invalidates the displayed
      // recommendation. The user sees the error rather than an old success.
      publish({ phase: 'loading', loading: true, current: null, before: state.current?.available ? state.current : state.before, error: null, issues: [] });
      try {
        const imported = service.parse(text);
        if (!disposed && token === generation) await installCase(imported.inputs, '', imported);
      } catch (error) { if (!disposed && token === generation) publish({ loading: false, phase: 'invalid', current: null, issues: messages(error) }); }
    },
    downloadReview() {
      if (state.phase !== 'complete' || !state.current?.available || !latestRun) return;
      const inputs = latestRun.input.inputs;
      saveFile(`${inputs.id}-review.json`, service.serialize(service.review(inputs, latestRun, comparisonRun)));
    },
    downloadCase() {
      if (!state.caseData || !state.draft) return;
      try {
        const inputs = service.admit(buildCase(state.caseData, state.draft, state.config));
        saveFile(`${inputs.id}-case.json`, service.serialize(inputs));
      } catch (error) { publish({ issues: messages(error) }); }
    },
    async dispose() { disposed = true; invalidate(); listeners.clear(); await service.close(); },
  };
  return controller;
}
