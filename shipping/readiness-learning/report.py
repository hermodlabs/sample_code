"""A small human-facing brief over SDK findings, not another decision engine.

Keep the complete SDK artifacts beside this page. The page shows the next
decision first, with model diagnostics and calculation records available on
request. It works as a local file and makes no external requests.
"""

from __future__ import annotations

from html import escape
from typing import Any


def text(value: Any) -> str:
    return escape(str(value))


def money(value: int | float | None) -> str:
    return "Not assessed" if value is None else f"${value / 100:,.2f}"


def percent(value: int | float | None) -> str:
    return "Not available" if value is None else f"{value:.1%}"


def clock(value: int | None) -> str:
    if value is None:
        return "Not supplied"
    day, minute = divmod(value, 1440)
    return f"{minute // 60:02d}:{minute % 60:02d}" + (f" (day {day + 1})" if day else "")


def arrangement(value: str | None) -> str:
    return {"direct": "Direct through SP-A", "backup": "Backup through SP-B",
            "no-study": "Reserve without another check", "registration_check": "Check before reserving"}.get(value, value or "No supported response")


def render_html(summary: dict) -> str:
    estimates = summary["estimates"]
    proposal = estimates.get("proposal") or {}
    learning = summary["learning"]
    baseline = summary["planning"]["baseline"]
    accepted = estimates["status"] == "accepted"
    assessed = learning["status"] == "assessed"
    feasible = learning.get("studyFeasible") is True
    selected = learning.get("recommendedOption")
    if not baseline.get("complete"):
        title, tone = "The planning assessment is incomplete", "pending"
    elif not baseline.get("feasible"):
        title, tone = "No listed complete arrangement is available now", "pending"
    elif not assessed:
        title = "Review the estimates before comparing the check" if estimates["status"] == "awaiting-review" else "A supported learning estimate is unavailable"
        tone = "pending"
    elif not feasible:
        title, tone = "Reserve now; the check leaves no complete response", "pending"
    elif selected == "registration_check":
        title, tone = "A registration check improves the modeled choice", "positive"
    else:
        title, tone = "Reserve now; the check does not improve the modeled choice", "neutral"

    next_action = summary.get("nextAction", "Inspect the retained findings before acting.")
    reason = learning.get("reason") or "Compare the complete check-and-response alternative with the available arrangement now."
    timing = summary.get("timing", {})
    review = estimates.get("review")
    review_text = f"Numerical basis accepted by {text(review['reviewer'])}." if accepted and review else "The model output has not been accepted as a numerical basis."
    readiness = proposal.get("probabilityRegistered")
    check_cost = "Unavailable" if assessed and not feasible else money(learning.get("expectedCostMinor"))
    improvement = "Unavailable" if assessed and not feasible else money(learning.get("netBenefitMinor"))
    metric = lambda label, value, detail: f'<div class="metric"><span>{text(label)}</span><strong>{text(value)}</strong><small>{text(detail)}</small></div>'
    metrics = "".join([
        metric("Reserve now", money(learning.get("baselineCostMinor")), "Complete supported arrangement"),
        metric("Check, then respond", check_cost, "Expected cost including the check fee"),
        metric("Expected improvement", improvement, "Relative to reserving now"),
        metric("Estimated readiness" if accepted else "Proposed readiness estimate", percent(readiness), "A probability estimate; registration is not confirmed"),
    ])

    rows = []
    if assessed:
        baseline_status = "Available" if baseline.get("feasible") else "No complete arrangement"
        rows.append(f'<tr><th scope="row">Reserve now</th><td>{text(baseline_status)}</td><td>{text(money(learning.get("baselineCostMinor")))}</td><td>Use a complete arrangement supported across both registration possibilities.</td></tr>')
        study_status = "Complete responses available" if feasible else "Unavailable"
        study_detail = reason if feasible else "No complete response remains available after the check. Inspect the planning checks and reservation cutoff."
        rows.append(f'<tr><th scope="row">Check before reserving</th><td>{text(study_status)}</td><td>{text(check_cost)}</td><td>{text(study_detail)}</td></tr>')
    else:
        preferred = ", ".join(arrangement(row) for row in baseline.get("preferredActionIds", []))
        rows.append(f'<tr><th scope="row">Reserve now</th><td>{text("Available" if baseline.get("feasible") else "No complete arrangement")}</td><td>See planning basis</td><td>{text(preferred or "Review the planning blockers.")}</td></tr>')
        rows.append(f'<tr><th scope="row">Check before reserving</th><td>Not assessed</td><td>Not assessed</td><td>{text(reason)}</td></tr>')
    comparison = f'<div class="table-wrap"><table><caption>Available alternatives</caption><thead><tr><th>Alternative</th><th>Execution</th><th>Complete cost</th><th>Meaning</th></tr></thead><tbody>{"".join(rows)}</tbody></table></div>'

    response_rows = []
    for row in learning.get("responses", []):
        label = row.get("label", row.get("reportId", row.get("report", "Result")))
        action = row.get("actionId", row.get("action"))
        response_rows.append(f'<tr><th scope="row">{text(label)}</th><td>{text(percent(row.get("probability")))}</td><td>{text(arrangement(action)) if row.get("available", bool(action)) else "No complete response"}</td><td>{text(row.get("reason") or "Inspect the actual scoped record before accepting a finding.")}</td></tr>')
    responses = ""
    if response_rows:
        responses = f'<section><h2>After each possible result</h2><p>These are hypothetical responses. A real result needs its own scoped record and review.</p><div class="table-wrap"><table><thead><tr><th>Check result</th><th>Estimated chance</th><th>Complete response</th><th>Required follow-up</th></tr></thead><tbody>{"".join(response_rows)}</tbody></table></div></section>'

    model_details = []
    provenance = proposal.get("provenance") or {}
    provenance_labels = {"modelId": "Estimator", "asOf": "Case assessment time", "basis": "Meaning of this estimate", "synthetic": "Uses synthetic teaching data"}
    for key, label in provenance_labels.items():
        value = provenance.get(key)
        if value is not None:
            model_details.append(f'<tr><th scope="row">{text(label)}</th><td>{text(value)}</td></tr>')
    reasons = estimates.get("reasons", [])
    reasons_html = '<ul>' + "".join(f'<li>{text(value)}</li>' for value in reasons) + '</ul>' if reasons else ''
    validation = proposal.get("validation") or {}
    validation_html = _validation_table(validation)
    feature_labels = {"portal_listing_age_days": "Portal listing age (days)", "prior_shipments_90d": "Prior shipments in 90 days", "days_since_scope_change": "Days since the location scope changed", "open_setup_tasks": "Open setup tasks"}
    feature_rows = ''.join(f'<tr><th scope="row">{text(label)}</th><td>{text(summary.get("caseFeatures", {}).get(key, "Not supplied"))}</td></tr>' for key, label in feature_labels.items())
    inputs_table = f'<div class="table-wrap"><table><caption>Measurements at decision time</caption><tbody>{feature_rows}</tbody></table></div>'
    model_panel = f'<details><summary>Estimate basis and model validation</summary><p>{review_text}</p>{reasons_html}{inputs_table}{validation_html}<div class="table-wrap"><table><tbody>{"".join(model_details)}</tbody></table></div><p>The history is synthetic teaching data. These metrics demonstrate the method and establish no real-world performance.</p></details>'

    sensitivity_rows = []
    for row in summary.get("sensitivity", []):
        sensitivity_rows.append(f'<tr><th scope="row">{text(percent(row.get("probabilityRegistered")))}</th><td>{text(arrangement(row.get("recommendedOption")))}</td><td>{text(money(row.get("netBenefitMinor")))}</td></tr>')
    sensitivity = ""
    if sensitivity_rows:
        sensitivity = f'<details><summary>Would a different probability change the choice?</summary><p>These are declared sensitivity assumptions, not confidence bounds or additional observed evidence.</p><div class="table-wrap"><table><thead><tr><th>Assumed registration probability</th><th>Preferred alternative</th><th>Expected improvement from checking</th></tr></thead><tbody>{"".join(sensitivity_rows)}</tbody></table></div></details>'

    plan_rows = []
    for context in ["baseline", "study"]:
        for plan in summary["planning"][context].get("plans", []):
            blockers = "; ".join(dict.fromkeys(row.get("label", row.get("constraintId", "Unresolved requirement")) for row in plan.get("blockers", [])))
            plan_rows.append(f'<tr><th scope="row">{text("Reserve now" if context == "baseline" else "After check and response")}</th><td>{text(arrangement(plan.get("action")))}</td><td>{text("Meets every requirement" if plan.get("feasible") else "Blocked")}</td><td>{text(money(plan.get("expenseMinor")))}</td><td>{text(blockers or "No blocking condition")}</td></tr>')
    planning_panel = f'<details><summary>Complete planning checks</summary><p>The SDK checks the supplied complete plans. A probability estimate does not waive registration, capacity, cash, time or permission requirements.</p><div class="table-wrap"><table><thead><tr><th>Context</th><th>Arrangement</th><th>Finding</th><th>Complete expense</th><th>Blocking conditions</th></tr></thead><tbody>{"".join(plan_rows)}</tbody></table></div></details>'
    artifacts = '<details><summary>Retained calculation records</summary><p>These machine-readable artifacts preserve the complete SDK output and the proposed numerical basis.</p><ul>' + ''.join(f'<li><a href="{filename}">{label}</a></li>' for filename, label in [
        ('summary.json', 'Decision summary'), ('estimates.proposal.json', 'Proposed estimates and provenance'),
        ('planning-baseline.run.json', 'Complete planning run: reserve now'), ('planning-study.run.json', 'Complete planning run: check first'),
    ]) + ('<li><a href="learning.run.json">Complete learning calculation</a></li>' if assessed else '') + '</ul></details>'
    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Shipment readiness check · {text(summary['caseId'])}</title>
<style>{CSS}</style></head><body><main>
<header><a class="brand" href="#decision">Decision Lab <span>/ Python + machine learning</span></a><span class="badge">Fictional teaching case</span></header>
<p class="eyebrow">Shipment {text(summary['caseId'])} · {text(summary['asOf'])}</p>
<h1>Should we buy a readiness check?</h1>
<p class="intro">Review the value of confirming SP-A registration before reserving a complete shipment arrangement.</p>
<section class="finding {tone}" id="decision" aria-labelledby="finding-title"><span class="eyebrow">Decision finding</span><h2 id="finding-title">{text(title)}</h2><p>{text(next_action)}</p></section>
<div class="metrics">{metrics}</div>
<section>{comparison}<p class="timing">Check and response ready: <strong>{text(clock(timing.get('responseReadyMinute')))}</strong> · Reservation cutoff: <strong>{text(clock(timing.get('reservationDeadlineMinute')))}</strong>. Times use the case's local minute origin.</p></section>
{responses}
<section class="explanations"><h2>Inspect the basis</h2>{model_panel}{sensitivity}{planning_panel}{artifacts}</section>
<footer><p>{text(summary.get('qualification', 'Conditional findings under the supplied assumptions.'))}</p><p>No check is purchased, shipment reserved, finding accepted or operating permission issued by this report.</p></footer>
</main></body></html>'''


def _validation_table(validation: dict) -> str:
    # Diagnostics come from train.py. Keep nested records in the artifact rather
    # than exposing raw dictionaries on the human-facing page.
    metrics = {label: validation[key] for key, label in [
        ("baseline", "Historical readiness rate"), ("uncalibratedModel", "Logistic regression"),
        ("calibratedModel", "Calibrated classifier"),
    ] if key in validation}
    rows = []
    if isinstance(metrics, dict):
        for model, values in metrics.items():
            if isinstance(values, dict):
                rows.append(f'<tr><th scope="row">{text(model)}</th><td>{text(_decimal(values.get("brier", values.get("brierScore"))))}</td><td>{text(_decimal(values.get("logLoss", values.get("log_loss"))))}</td></tr>')
    if not rows:
        return '<p>Inspect the model’s validation.json for held-out scores, baseline comparison and reliability bins.</p>'
    return f'<div class="table-wrap"><table><caption>Held-out validation</caption><thead><tr><th>Estimator</th><th>Brier score</th><th>Log loss</th></tr></thead><tbody>{"".join(rows)}</tbody></table></div>'


def _decimal(value: Any) -> str:
    return f"{value:.4f}" if isinstance(value, (float, int)) else "Not supplied"


CSS = '''
:root{color-scheme:light;--ink:#263c49;--muted:#5c7280;--blue:#315b73;--line:#dce5e9;--paper:#fff;--bg:#f3f6f7;--soft:#eef4f7}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:1160px;margin:0 auto;padding:30px 28px 44px}header{display:flex;justify-content:space-between;gap:16px;align-items:center;border-bottom:1px solid var(--line);padding-bottom:22px;margin-bottom:34px}.brand{font-weight:750;color:#193a4c;text-decoration:none}.brand span{font-size:.85rem;font-weight:450;color:var(--muted)}.badge{background:#fff3db;border:1px solid #ecd9ae;border-radius:30px;padding:5px 12px;color:#77531b;font-size:.78rem;white-space:nowrap}.eyebrow{font-size:.75rem;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)}h1{font-size:clamp(1.9rem,4vw,2.7rem);line-height:1.2;letter-spacing:-.025em;margin:8px 0 12px}h2{font-size:1.2rem;line-height:1.35;margin:12px 0}p{margin:10px 0}.intro{max-width:780px;color:var(--muted);margin-bottom:24px}.finding{background:#fff;border:1px solid var(--line);border-left:5px solid var(--blue);border-radius:8px;padding:22px 26px}.finding h2{font-size:1.45rem;margin:8px 0}.finding p{max-width:900px}.finding.positive{border-left-color:#2b7b60;background:#f4faf7}.finding.pending{border-left-color:#b38332;background:#fffbf3}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:20px 0 26px}.metric{background:#fff;border:1px solid var(--line);border-radius:8px;padding:18px}.metric span,.metric small{display:block;color:var(--muted);font-size:.8rem}.metric strong{display:block;font-size:1.7rem;margin:7px 0}.metric small{line-height:1.45}section{margin-bottom:26px}.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:8px;background:var(--paper)}table{border-collapse:collapse;width:100%;font-size:.875rem;text-align:left}caption{padding:16px;text-align:left;font-weight:700;font-size:1rem}th,td{vertical-align:top;padding:14px 16px;border-bottom:1px solid var(--line)}thead th{background:var(--soft);color:#3f6175;font-size:.8rem}tbody th{font-weight:600}tbody tr:last-child>*{border-bottom:0}td{min-width:110px}.timing,section>p{color:var(--muted);font-size:.875rem}.explanations{background:#fff;border:1px solid var(--line);border-radius:8px;padding:20px 24px}details{border-top:1px solid var(--line);padding:15px 0}details:last-child{padding-bottom:0}summary{font-weight:600;color:var(--blue);cursor:pointer}details .table-wrap{margin-top:16px}details p{font-size:.875rem;color:var(--muted)}a{color:#2d657e}li{margin:5px 0}footer{font-size:.78rem;color:var(--muted);max-width:1000px}button:focus-visible,a:focus-visible,summary:focus-visible{outline:3px solid #cf9700;outline-offset:4px}td,th{overflow-wrap:anywhere}@media(max-width:760px){main{padding:20px 16px}header{align-items:flex-start;flex-direction:column;margin-bottom:24px}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.metric strong{font-size:1.4rem}.finding{padding:18px}.finding h2{font-size:1.25rem}th,td{padding:12px}.explanations{padding:16px}}@media(max-width:420px){.metrics{grid-template-columns:1fr}.metric{padding:14px}.metric strong{margin:4px 0}}@media print{body{background:white}main{padding:0}details{break-inside:avoid}header{margin-bottom:16px}.badge{border-color:#aaa}.finding{break-inside:avoid}.metrics{gap:6px}.metric{padding:10px}a{color:inherit}footer{margin-top:24px}}
'''
