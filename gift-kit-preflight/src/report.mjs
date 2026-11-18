const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

const labels = {
  eligible: 'Ready for review',
  blocked: 'No package meets the requirements',
  'input-error': 'Correct the inputs',
  unavailable: 'Assessment unavailable',
};

function details(row) {
  if (row.status === 'input-error' || row.status === 'unavailable') {
    return `<ul>${row.messages.map(message => `<li>${escape(message)}</li>`).join('')}</ul>`;
  }
  const preferred = row.review?.preferred ?? [];
  const proposal = preferred.length
    ? `<p><strong>${preferred.map(plan => escape(plan.label)).join(' or ')}</strong></p>`
      + `<ul>${preferred.map(plan => `<li>${escape(plan.expenseDisplay)} · ready at ${escape(plan.finishMinute)} min</li>`).join('')}</ul>`
    : '<p>Review the failed conditions before proposing a handoff package.</p>';
  const plans = row.review?.plans ?? [];
  return proposal + `<details><summary>Compare all ${plans.length} calculated packages</summary><ul>${plans.map(plan =>
    `<li><strong>${escape(plan.label)}</strong>: ${plan.feasible ? 'meets the requirements' : 'blocked'}; `
      + `${escape(plan.expenseDisplay)}, ready at ${escape(plan.finishMinute)} min.`
      + (plan.blockers.length ? `<ul>${[...new Set(plan.blockers.map(item => item.label))].map(label => `<li>${escape(label)}</li>`).join('')}</ul>` : '')
      + '</li>').join('')}</ul></details>`;
}

export function renderHTML(manifest) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gift-kit preflight</title><style>
body{font:16px/1.55 system-ui,sans-serif;color:#233c4a;background:#f3f6f8;margin:0}main{max-width:1100px;padding:28px;margin:auto}
h1{line-height:1.15}a{color:#126183}table{width:100%;border-collapse:collapse;background:white}th,td{padding:16px;text-align:left;vertical-align:top;border-bottom:1px solid #d9e3e8}th{background:#e8f0f4}p{margin:0 0 12px}ul{padding-left:21px}summary{cursor:pointer}small{display:block;color:#506978}
.notice{border-left:4px solid #527f96;background:white;padding:16px;margin:20px 0}.status{font-weight:650}footer{padding:20px 0}
@media(max-width:700px){main{padding:16px}table,tbody,tr,td{display:block}thead{display:none}tr{padding:10px;margin-bottom:16px;background:white;border:1px solid #d9e3e8}td{border:0;padding:8px}td:before{content:attr(data-label);display:block;font-weight:650;color:#506978;font-size:.85rem}}
</style></head><body><main><h1>Gift-kit preflight</h1>
<p>Compare complete preparation and handoff packages before the event team commits to one.</p>
<div class="notice">These are calculated proposals awaiting review. A slot confirmation does not provide operating permission or establish that preparation and handoff happened. Each campaign is evaluated independently.</div>
<p><small>App: ${escape(manifest.binding.appId)} · release ${escape(manifest.binding.release)}<br>Generated ${escape(manifest.createdAt)}</small></p>
<table><thead><tr><th>Campaign</th><th>Outcome</th><th>Package comparison</th><th>Continue the review</th></tr></thead><tbody>
${manifest.campaigns.map(row => `<tr><td data-label="Campaign"><strong>${escape(row.id)}</strong><small>${escape(row.owner)}</small></td>
<td data-label="Outcome" class="status">${escape(labels[row.status])}${row.review?.available ? `<small>${escape(row.review.scenarioCount)} retained fault configuration${row.review.scenarioCount === 1 ? '' : 's'}</small>` : ''}</td><td data-label="Package comparison">${details(row)}</td>
<td data-label="Continue the review"><p>${row.status === 'eligible' ? 'Review the proposed package and obtain the required operating approvals.' : row.status === 'blocked' ? 'Update the missing authority or revise the complete packages, then reassess.' : row.status === 'input-error' ? 'Correct the source case before using a recommendation.' : 'Resolve the assessment problem, then run it again.'}</p>
${row.case ? `<a href="${escape(row.case)}" download>Download case for the React desk</a><br>` : ''}
${row.run ? `<a href="${escape(row.run)}" download>Download complete CLI report</a><br>` : ''}
${row.validation ? `<a href="${escape(row.validation)}" download>Input validation</a>` : ''}</td></tr>`).join('\n')}
</tbody></table><footer>Each result applies only to the supplied and admitted fault configurations. This review does not infer which fault actually occurred or reserve shared staff, equipment, funds, or a handoff slot.</footer>
</main></body></html>\n`;
}
