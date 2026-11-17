import { createDecisionLab, hashing } from '@decision-lab/sdk';
import { projectRun } from './projection.mjs';

const same = (a, b) => hashing.canonicalHash(a) === hashing.canonicalHash(b);

/** Public SDK boundary shared by the browser and real Node/CLI parity tests. */
export function createShipmentService({ executor, executionOptions = {}, assessmentOptions } = {}) {
  const lab = createDecisionLab({ executor });
  let appPackage, config;
  function checkBinding(identity) {
    for (const [key, expected] of Object.entries(config.binding)) {
      if (identity?.[key] !== expected) throw new Error(`This artifact does not use the desk's pinned ${key}.`);
    }
  }
  function verifyRun(run, inputs) {
    const receipt = lab.runs.validate(run);
    if (!receipt.valid) throw Object.assign(new Error('The retained SDK run is invalid.'), { issues: receipt.issues });
    checkBinding(run.identity);
    lab.cases.create({ app: appPackage, inputs: run.input });
    if (!same(run.input.inputs, inputs)) throw new Error('The retained run and case inputs differ.');
    return run;
  }
  return {
    open(definition) {
      config = definition.config;
      if (config.format !== 'shipment-reservation-config/1' || config.currency !== 'USD' || config.moneyDivisor !== 100) throw new Error('Unsupported reservation desk profile or currency units.');
      appPackage = lab.apps.open(definition.appPackage);
      checkBinding({ appId: appPackage.app.id, release: appPackage.app.version,
        appHash: appPackage.app.contentHash, packageHash: appPackage.contentHash,
        moduleHash: hashing.canonicalHash(appPackage.app.model.module), pattern: appPackage.app.model.format });
      return appPackage;
    },
    admit(value) {
      const snapshot = lab.cases.create({ app: appPackage, inputs: value });
      const receipt = lab.cases.validate({ app: appPackage, case: snapshot });
      if (!receipt.valid) throw Object.assign(new Error('The case does not satisfy the published input declarations.'), { issues: receipt.issues });
      return structuredClone(snapshot.inputs);
    },
    parse(text) {
      const value = lab.sources.parseArtifact(text, { maxBytes: 50000000 });
      if (value.format !== 'shipment-reservation-review/1') return { inputs: this.admit(value) };
      const suppliedApp = lab.apps.open(value.appPackage);
      if (suppliedApp.contentHash !== appPackage.contentHash) throw new Error('This review belongs to a different app release.');
      const inputs = this.admit(value.case);
      const run = verifyRun(value.run, inputs);
      if (value.previousRun) {
        verifyRun(value.previousRun, value.previousRun.input?.inputs);
        if (value.previousRun.input.inputs.id !== inputs.id || value.previousRun.input.inputs.parameters.orderId !== inputs.parameters.orderId) throw new Error('The earlier run belongs to a different shipment.');
      }
      return { inputs, run, previousRun: value.previousRun ?? null };
    },
    async evaluate(inputs, { signal, priorRun, createdAt = new Date().toISOString() } = {}) {
      const snapshot = lab.cases.create({ app: appPackage, inputs });
      const run = await lab.run({ app: appPackage, case: snapshot, createdAt,
        execution: { timeoutMs: 15000, ...executionOptions, signal },
        ...(assessmentOptions ? { assessmentOptions } : {}),
        ...(priorRun ? { context: { priorRun } } : {}), reportOptions: { scope: 'all', locale: 'en-US' } });
      verifyRun(run, inputs);
      return run;
    },
    project: run => projectRun(run, { ...config, expectedBinding: config.binding }),
    review(inputs, run, previousRun) {
      verifyRun(run, inputs);
      return { format: 'shipment-reservation-review/1', createdAt: run.identity.createdAt,
        appPackage, case: inputs, run, previousRun: previousRun ?? null };
    },
    serialize: value => lab.sources.renderJSON(value, { maxBytes: 50000000 }),
    close: () => executor?.close(),
  };
}
