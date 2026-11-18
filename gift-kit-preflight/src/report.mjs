import { formatMinutes, formatPosition } from './gifting.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

const labels = {
  eligible: 'Ready for review',
  blocked: 'No package meets the requirements',
  'input-error': 'Correct the inputs',
  unavailable: 'Assessment unavailable',
};
const position = value => escape(formatPosition(value));
const duration = value => escape(formatMinutes(value));
const interval = (start, end) => `${position(start)} to ${position(end)}`;

function timingBasis(row, policy) {
  const timing = row.review?.timing ?? row.basis?.timing;
  if (!timing) return '';
  const fields = [
    ['Review time', position(timing.nowMinute)],
    ['Handoff cutoff', position(timing.handoffDeadlineMinute)],
    ['Time remaining at review', duration(Number.isFinite(timing.handoffDeadlineMinute) && Number.isFinite(timing.nowMinute)
      ? timing.handoffDeadlineMinute - timing.nowMinute : undefined)],
    ['Planned rehearsal', duration(timing.rehearsalMinutes)],
    ['Published rehearsal minimum', duration(policy?.minimumRehearsalMinutes)],
    ['Handoff duration', duration(timing.handoffMinutes)],
    ['Candidate starts', Array.isArray(timing.startOptions) ? timing.startOptions.map(position).join(', ') : 'Not established'],
  ];
  return `<section class="basis"><h3>Timing basis</h3><dl>${fields.map(([name, value]) => `<div><dt>${name}</dt><dd>${value}</dd></div>`).join('')}</dl>
<p><small>T+ marks a position after the case’s review origin. Rehearsal and handoff are durations. Candidate starts are the finite choices supplied for this review.</small></p></section>`;
}

function scope(record) {
  const fields = [
    ['Campaign', 'batchId'], ['Insert', 'insertRevision'], ['Destination', 'destinationRevision'],
    ['Checkout', 'checkoutRevision'], ['Device', 'deviceScope'], ['Account', 'accountScope'],
  ];
  return fields.map(([label, field]) => `${label}: ${escape(record[field] ?? 'Not supplied')}`).join(' · ');
}

function sourceRecords(row) {
  const basis = row.basis;
  if (!basis) return '';
  const calendars = basis.calendars.map(record => `<li><strong>${escape(record.resource)}</strong>: ${interval(record.start, record.end)}</li>`).join('');
  const bookings = basis.bookings.map(record => `<li><strong>${escape(record.resource)}</strong>: ${interval(record.start, record.end)}${record.amount === undefined ? '' : `; occupied units ${escape(record.amount)}`}<small>${escape(record.id)}</small></li>`).join('');
  const permissions = basis.permissions.map(record => `<li><strong>${escape(record.packageId)}</strong> · ${interval(record.validFrom, record.validThrough)}
<small>${escape(record.id)} · actor ${escape(record.actorId)}<br>${scope(record)}<br>Source: ${escape(record.source)}</small></li>`).join('');
  const confirmations = basis.confirmations.map(record => `<li><strong>${escape(record.packageId)}</strong> · ${record.confirmed === true ? 'Confirmed' : record.confirmed === false ? 'Not confirmed' : 'Status not supplied'} · ${interval(record.validFrom, record.validThrough)}
<small>${escape(record.id)} · recorded at ${position(record.recordedAt)} by ${escape(record.recordedBy)}<br>${scope(record)}<br>Source: ${escape(record.source)}</small></li>`).join('');
  return `<details class="records"><summary>Recorded availability, permissions and confirmation</summary>
<p><small>These are the supplied records. A later cutoff does not extend an interval or change its scope. Failed conditions in the comparison come from the app.</small></p>
<h4>Production availability</h4><ul>${calendars || '<li>No availability recorded.</li>'}</ul>
<h4>Existing resource bookings</h4><ul>${bookings || '<li>No bookings recorded.</li>'}</ul>
<h4>Operating permissions</h4><ul>${permissions || '<li>No permission recorded.</li>'}</ul>
<h4>External-booking confirmation</h4><ul>${confirmations || '<li>No confirmation recorded.</li>'}</ul></details>`;
}

function details(row, policy) {
  const basis = timingBasis(row, policy);
  if (row.status === 'input-error' || row.status === 'unavailable') {
    return `<ul>${row.messages.map(message => `<li>${escape(message)}</li>`).join('')}</ul>${basis}${sourceRecords(row)}`;
  }
  const preferred = row.review?.preferred ?? [];
  const proposal = preferred.length
    ? `<p><strong>${preferred.map(plan => escape(plan.label)).join(' or ')}</strong></p>`
      + `<ul>${preferred.map(plan => `<li>${escape(plan.expenseDisplay)} · handoff finishes ${position(plan.finishMinute)} · cutoff slack ${duration(plan.deadlineSlackMinute)}</li>`).join('')}</ul>`
    : '<p>Review the failed conditions before proposing a handoff package.</p>';
  const plans = row.review?.plans ?? [];
  return proposal + basis + `<details><summary>Compare all ${plans.length} calculated package/start combinations</summary><ul>${plans.map(plan =>
    `<li><strong>${escape(plan.label)}</strong>: ${plan.feasible ? 'meets the requirements' : 'blocked'}; `
      + `${escape(plan.expenseDisplay)}. Start ${position(plan.startMinute)}; handoff finishes ${position(plan.finishMinute)}; cutoff slack ${duration(plan.deadlineSlackMinute)}.`
      + (plan.blockers.length ? `<ul>${[...new Set(plan.blockers.map(item => item.label))].map(label => `<li>${escape(label)}</li>`).join('')}</ul>` : '')
      + '</li>').join('')}</ul></details>` + sourceRecords(row);
}

export function renderHTML(manifest) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gift-kit preflight</title><style>
body{font:16px/1.55 system-ui,sans-serif;color:#233c4a;background:#f3f6f8;margin:0}main{max-width:1200px;padding:28px;margin:auto}
h1{line-height:1.15}a{color:#126183}table{width:100%;border-collapse:collapse;background:white}th,td{padding:16px;text-align:left;vertical-align:top;border-bottom:1px solid #d9e3e8}th{background:#e8f0f4}p{margin:0 0 12px}ul{padding-left:21px}summary{cursor:pointer}small{display:block;color:#506978}li{margin-bottom:10px;overflow-wrap:anywhere}
.notice{border-left:4px solid #527f96;background:white;padding:16px;margin:20px 0}.status{font-weight:650}footer{padding:20px 0}.basis{margin:18px 0}.basis h3{font-size:1rem;margin:0 0 8px}dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:0 0 8px}dl div{padding:8px;background:#f3f6f8}dt{font-size:.8rem;color:#506978}dd{margin:0;overflow-wrap:anywhere}details{margin:16px 0}.records h4{margin:16px 0 6px}
@media(max-width:700px){main{padding:16px}table,tbody,tr,td{display:block}thead{display:none}tr{padding:10px;margin-bottom:16px;background:white;border:1px solid #d9e3e8}td{border:0;padding:8px}td:before{content:attr(data-label);display:block;font-weight:650;color:#506978;font-size:.85rem}dl{grid-template-columns:1fr}}
</style></head><body><main><h1>Gift-kit preflight</h1>
<p>Compare complete preparation and handoff packages before the event team commits to one.</p>
<div class="notice">These are calculated proposals awaiting review. A slot confirmation does not provide operating permission or establish that preparation and handoff happened. Each campaign is evaluated independently.</div>
<p><small>App: ${escape(manifest.binding.appId)} · release ${escape(manifest.binding.release)}<br>Generated ${escape(manifest.createdAt)}</small></p>
<table><thead><tr><th>Campaign</th><th>Outcome</th><th>Package comparison</th><th>Continue the review</th></tr></thead><tbody>
${manifest.campaigns.map(row => `<tr><td data-label="Campaign"><strong>${escape(row.id)}</strong><small>${escape(row.owner)}</small></td>
<td data-label="Outcome" class="status">${escape(labels[row.status])}${row.review?.available ? `<small>${escape(row.review.scenarioCount)} retained fault configuration${row.review.scenarioCount === 1 ? '' : 's'}</small>` : ''}</td><td data-label="Package comparison">${details(row, manifest.policy)}</td>
<td data-label="Continue the review"><p>${row.status === 'eligible' ? 'Review the proposed package and obtain the required operating approvals.' : row.status === 'blocked' ? 'Review the failed conditions and recorded intervals, revise the inputs where supported, then reassess.' : row.status === 'input-error' ? 'Correct the source case before using a recommendation.' : 'Resolve the assessment problem, then run it again.'}</p>
${row.case ? `<a href="${escape(row.case)}" download>Download case for the React desk</a><br>` : ''}
${row.run ? `<a href="${escape(row.run)}" download>Download complete CLI report</a><br>` : ''}
${row.validation ? `<a href="${escape(row.validation)}" download>Input validation</a>` : ''}</td></tr>`).join('\n')}
</tbody></table><footer>Each result applies only to the supplied and admitted fault configurations. This review does not infer which fault actually occurred or reserve shared staff, equipment, funds, or a handoff slot.</footer>
</main></body></html>\n`;
}
