import { formatMinute } from './projection.mjs';

export const formatTime = (value, config) => formatMinute(value, config);
export const formatMoney = (value, config) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: config.currency,
}).format(value / config.moneyDivisor);

export class FormError extends Error {
  constructor(issues) { super('Correct the input records before reassessing.'); this.name = 'FormError'; this.issues = issues; }
}

function offsetMinutes(config) {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(config.utcOffset ?? '');
  if (!match || Number(match[2]) > 14 || Number(match[3]) > 59 || Number(match[2]) === 14 && Number(match[3]) !== 0) throw new Error('Configure a valid fixed UTC offset for the shipment profile.');
  return (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]));
}

// datetime-local deliberately displays the profile's offset, not the browser's
// local zone. This teaching profile uses one fixed offset for its review dates.
export function localTime(minute, config) {
  if (!Number.isSafeInteger(minute)) throw new Error('The case contains an unsupported timestamp.');
  const epoch = Date.parse(config.timeOrigin) + (minute + offsetMinutes(config)) * 60_000;
  return new Date(epoch).toISOString().slice(0, 16);
}

export function minuteFromLocal(value, config) {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value ?? '')) throw new Error('Enter a date and time with whole-minute precision.');
  const instant = Date.parse(`${value}:00${config.utcOffset}`);
  const minute = (instant - Date.parse(config.timeOrigin)) / 60_000;
  if (!Number.isSafeInteger(minute) || minute < 0 || localTime(minute, config) !== value) throw new Error('Enter a valid time at or after the configured review origin.');
  return minute;
}

function required(value) {
  if (typeof value !== 'string' || !value || value.trim() !== value) throw new Error('Supply a value without surrounding whitespace.');
  return value;
}
function whole(value) {
  required(value);
  if (!/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('Enter a nonnegative whole number.');
  return Number(value);
}
export function cents(value) {
  required(value);
  if (!/^(0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) throw new Error('Enter a nonnegative USD amount with at most two decimal places.');
  const [dollars, fraction = ''] = value.split('.');
  const amount = BigInt(dollars) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('The amount exceeds the supported integer range.');
  return Number(amount);
}
function decimal(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('The case contains an unsupported amount.');
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`;
}

/** Read an existing case without changing its facts, permissions or scope. */
export function toDraft(inputs, config) {
  const records = inputs.tables.slotConfirmations;
  const arrangementId = config.slotArrangement ?? 'consolidated';
  if (!Array.isArray(records) || records.length > 1 || records.some(record => record.arrangement !== arrangementId)) {
    throw new Error('This desk supports one current consolidation-slot record. Reconcile the case before importing it.');
  }
  const record = records[0];
  const quote = inputs.tables.arrangements.find(row => row.id === arrangementId);
  return {
    quotes: inputs.tables.arrangements.map(row => ({
      id: row.id, shipPoint: row.shipPoint, currency: config.currency,
      totalCost: decimal(row.fee), departure: localTime(row.departure, config),
      travelMinutes: String(row.travelDuration), capacity: String(row.capacity),
    })),
    confirmation: {
      // Only a genuinely new blank record receives contextual defaults. An
      // existing confirmation always retains its own original scope, even when
      // it differs from the order currently being reviewed.
      status: record?.status ?? 'none', slotReference: record?.slotReference ?? '',
      orderId: record?.orderId ?? inputs.parameters.orderId,
      orderRevision: record?.orderRevision ?? '', recipient: record?.recipient ?? '',
      shipPoint: record?.shipPoint ?? quote?.shipPoint ?? '', shipDate: record?.shipDate ?? '',
      profileVersion: record?.profileVersion ?? inputs.parameters.profileVersion,
      ...Object.fromEntries(['confirmedAt', 'knownAt', 'validFrom', 'validUntil'].map(key => [key, record ? localTime(record[key], config) : ''])),
    },
  };
}

/**
 * Map team-owned fields into the canonical case; leave business checks to SDK.
 * Invalid intervals and mismatched scopes are not "repaired" here. The published
 * app decides whether those supplied records satisfy the shipment requirements.
 */
export function buildCase(base, draft, config) {
  const issues = [];
  const read = (field, value, convert = required) => {
    try { return convert(value); }
    catch (error) { issues.push({ path: field, message: error.message }); return undefined; }
  };
  const result = structuredClone(base);
  result.tables.arrangements = base.tables.arrangements.map(original => {
    const row = draft.quotes.find(quote => quote.id === original.id);
    if (!row) { issues.push({ path: original.id, message: 'The complete quote is missing.' }); return original; }
    const prefix = `quotes.${row.id}`;
    read(`${prefix}.currency`, row.currency, value => {
      if (value !== 'USD' || config.currency !== 'USD') throw new Error('This review accepts USD quotes only; foreign-exchange conversion is not supported.');
      return value;
    });
    return { ...original,
      shipPoint: read(`${prefix}.shipPoint`, row.shipPoint),
      fee: read(`${prefix}.totalCost`, row.totalCost, cents),
      departure: read(`${prefix}.departure`, row.departure, value => minuteFromLocal(value, config)),
      travelDuration: read(`${prefix}.travelMinutes`, row.travelMinutes, whole),
      capacity: read(`${prefix}.capacity`, row.capacity, whole),
    };
  });
  const row = draft.confirmation;
  if (!['none', 'confirmed', 'cancelled', 'conflicting'].includes(row.status)) issues.push({ path: 'confirmation.status', message: 'Select a supported current record status.' });
  result.tables.slotConfirmations = row.status === 'none' ? [] : [{
    ...base.tables.slotConfirmations[0],
    arrangement: config.slotArrangement ?? 'consolidated', status: row.status,
    ...Object.fromEntries(['slotReference', 'orderId', 'orderRevision', 'recipient', 'shipPoint', 'profileVersion'].map(key => [key, read(`confirmation.${key}`, row[key])])),
    shipDate: read('confirmation.shipDate', row.shipDate, value => {
      required(value);
      if (!/^\d{4}-\d\d-\d\d$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new Error('Enter a valid ship date.');
      return value;
    }),
    ...Object.fromEntries(['confirmedAt', 'knownAt', 'validFrom', 'validUntil'].map(key => [key, read(`confirmation.${key}`, row[key], value => minuteFromLocal(value, config))])),
  }];
  if (issues.length) throw new FormError(issues);
  return result;
}
