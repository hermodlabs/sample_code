# Shipment readiness: learn whether a check is worth buying

A standalone Python application that combines a small machine learning model
with Decision Lab's commitment and learning patterns. It answers a specific
question: **should we pay for a registration check before reserving freight?**

The cheaper shipment arrangement needs current, correctly scoped registration
confirmation. An unresolved record does not provide it. A fallback arrangement
is available, but its reservation window closes. Python estimates the chance
that a check will establish readiness; Decision Lab compares choosing now with
checking first and responding while an arrangement remains available.

This is a fictional integration example. Its generated history demonstrates
training, validation and the handoff to a decision calculation. It provides no
evidence of performance on real suppliers, orders or registration systems.

## Install and run

Use Python 3.12 or later, an isolated environment and a qualified Decision Lab
platform wheel. The optional ML dependencies require a newer Python than the
SDK's Python 3.10 minimum.

The local `decision-lab` 0.1.0 candidate has not been published to PyPI. Its
currently qualified wheel is macOS ARM64 and includes the matching Node runtime;
installed execution needs no system Node or npm.

```sh
cd sample_code/shipping/readiness-learning
python3 -m venv .venv
source .venv/bin/activate
python -m pip install /absolute/path/to/decision_lab-0.1.0-py3-none-PLATFORM.whl
python -m pip install -r requirements.lock.txt

python train.py --history data/history.csv --output .output/model
python assess.py --model .output/model --case data/cases/timely.json --output .output/proposal
```

The folder can be copied independently. Its scripts use the public Python
package, and all authored model definitions and fictional case inputs travel
with the sample. The optional ML dependencies belong to this application, not
the Decision Lab package.

[`requirements.lock.txt`](requirements.lock.txt) records the complete environment
used to qualify this example with Python 3.14.6 on macOS ARM64.
[`requirements.txt`](requirements.txt) lists the direct optional dependencies.
Use the lock for the demonstrated run; changing dependency versions requires
retraining, since fitted model loading checks the training versions.

Open `.output/proposal/report.html` in a browser. Imported estimates await a
named review by default. The application can still assess what can be done
without a study, while the learning calculation remains unassessed.

After reviewing the model's basis and current case, explicitly accept the
numerical premises in a fresh assessment:

```sh
python assess.py --model .output/model --case data/cases/timely.json \
  --accept-estimates --reviewer 'Demo analyst' --output .output/timely
```

The flag records a local acceptance of numerical estimates for this calculation.
It does not establish registration, accept a factual finding, authenticate a
reviewer, authorize spending or reserve freight.

## Four cases for the article

Use the same fitted model with each case. Output directories must be new.

```sh
python assess.py --model .output/model --case data/cases/high-fee.json \
  --accept-estimates --reviewer 'Demo analyst' --output .output/too-expensive
python assess.py --model .output/model --case data/cases/late.json \
  --accept-estimates --reviewer 'Demo analyst' --output .output/too-late
python assess.py --model .output/model --case data/cases/unsupported.json \
  --accept-estimates --reviewer 'Demo analyst' --output .output/unsupported
```

| Case | What it demonstrates |
| --- | --- |
| `timely.json` | A check can return before the reservation cutoff and may justify its cost. |
| `high-fee.json` | Information can change the choice but cost more than the expected improvement. |
| `late.json` | A useful result cannot inform a reservation whose cutoff has already passed. |
| `unsupported.json` | Unsupported estimates leave learning value unassessed; the planning result remains available. |

The qualified fictional run estimates registration at **24.96%**. The timely
check costs $200 and takes 120 minutes, with another 30 minutes for the response:
ready at **10:30**, before the **12:00** reservation cutoff. Reserving the
supported fallback now costs **$6,000**.

Only an actual correctly scoped registration confirmation would permit the
$4,000 Direct arrangement. Nonregistration confirmation or an inconclusive
result leaves the fallback as the complete response.

| Case | Expected complete cost with check | Recorded finding |
| --- | --- | --- |
| Timely, $200 check | $5,772.96 | Propose checking: $227.04 expected improvement. |
| Timely, $2,500 check | $8,072.96 | Reserve the fallback now: checking adds $2,072.96 in expected cost. |
| Result and response ready at 15:00 | Unavailable | Reserve now: the check leaves no complete response before the cutoff. |
| Unsupported current features | Unassessed | Keep the planning result; do not accept the estimate or calculate learning value. |

These are conditional calculations on generated inputs, not observed savings.
The retained [qualification record](qualification.json) identifies the tested
source, packages and output hashes. It is a historical receipt; it does not
qualify later edits or authenticate the underlying records.

Start an article with the unaccepted proposal, then show the reviewed timely
calculation. Follow with cost, time and applicability changes. Screenshots should
show the generated report's decision and basis, with detailed calculations
opened only when they explain the change. Report the numbers from the retained
output for that run, rather than treating the fictional model as a published
operational benchmark.

## What Python learns

`data/history.csv` has 1,200 deterministic synthetic records. The generator in
`data/generate_history.py` makes the fictional source and assumptions explicit.
Each record distinguishes information available at decision time from the
subsequently verified registration status and the check result.

Alongside the four features, the CSV retains a unique `case_id`, decision-time
`observed_at`, independently verified `registered` label and `verified_at`, check
`report` and `report_received_at`, and a `source` explicitly naming synthetic
teaching data. Label and check availability must precede the cutoff for their
partition; later answers are excluded rather than silently treated as known.

The model uses four decision-time features:

| Feature | Meaning |
| --- | --- |
| `portal_listing_age_days` | Age of the portal listing when the decision was considered. |
| `prior_shipments_90d` | Prior shipments in the preceding 90 days. |
| `days_since_scope_change` | Time since the location's recorded scope changed. |
| `open_setup_tasks` | Setup tasks still unresolved at that time. |

Training, sigmoid calibration and held-out evaluation use separate chronological
partitions. The candidate is compared with a historical-rate baseline using
Brier score, log loss and reliability bins. The sample also estimates the
check's chance of returning no result from the earlier data, without fitting
on the held-out test partition. A quality gate and feature support checks can
withhold an estimate.

In the qualified environment, 727 records enter training, 176 calibration and
290 held-out evaluation; seven labels were unavailable at their partition
cutoff. The recorded held-out Brier scores are 0.2490 for the historical-rate
baseline, 0.1470 for the raw classifier and 0.1481 for the calibrated classifier.
Calibration did not improve this particular synthetic test score. The pipeline
is specified before evaluation; the sample reports all three rather than
selecting a winner on the held-out data.

A model that ranks cases well can still supply poor probabilities. Examine the
saved validation results before accepting estimates. Real adoption also needs
review of label quality, time leakage, repeated entities, changed operating
conditions and who was selected for historical checking. A population made up
only of escalated shipments does not automatically represent all shipments.

Run the example's tests from this folder:

```sh
python -m unittest discover -s test -v
```

## What remains authored

The app fixes two possible states: registered and not registered. Its authored
check has three reports: confirmed registered, confirmed not registered and no
result. Registration confirmation has an explicit business meaning and scope.
Machine learning supplies numerical premises; it does not define these states,
report meanings, prerequisites, shipment arrangements or response rules.

The scripts use the public SDK to produce fresh planning runs for acting now
and for the responses to a check, then assess execution and learning value. The
same engine generates the complete reports. `report.html` presents a concise
decision with tables and optional explanations; retained JSON remains available
for a different interface or analysis.

The main retained files are:

| File | Purpose |
| --- | --- |
| `summary.json` / `report.html` | The concise machine-readable and browser-facing review. |
| `planning-baseline.run.json` | The complete SDK report for arrangements available without the check. |
| `planning-study.run.json` | The complete SDK report for the potential check and response arrangements. |
| `learning.run.json` | The complete learning report, when supported estimates are explicitly accepted; it also retains infeasible study findings. |

Companion assessments, proposed inputs and manifests retain the calculation's
basis. Amounts in case JSON use integer minor currency units; planning times
use minutes from midnight on November 17, 2026 at UTC−06:00. `asOf` and
`planning.currentTime` must agree on that origin. Keep these units when changing a
case. Increasing a fee or moving a deadline is an input change; changing what
counts as valid confirmation belongs in the authored model.

Replay the timely learning run through the installed CLI:

```sh
python -m decision_lab run --app data/learning.app.json \
  --case .output/timely/learning.bound-case.json \
  --run-id ship-ml-timely-learning --created-at 2026-11-17T14:00:00Z \
  --timeout-ms 30000 --output .output/timely/learning.cli.run.json
```

`learning.bound-case.json` preserves the SDK input binding and original source
provenance. Supplying the same run ID and creation time reproduces the complete
SDK run, not just its preferred option. The tests compare the full canonical
output hashes. Reusing only the plain case values can change source provenance
even when the numerical conclusion agrees.

An estimated zero does not remove a structurally possible failure. A predicted
probability of registration never substitutes for authoritative confirmation.
Planned checking and its possible reports are different from an actual check
having been completed. No external operating action occurs in this sample.

## Model files and source trust

Load `model.joblib` only when you trust its producer. Joblib uses Python pickle
semantics and loading an untrusted model can execute code. The local manifest
and source hashes detect changed files; they do not authenticate their author.

Keep the training history, model/validation basis, case, acceptance and complete
run outputs together when reproducing a result. A changed case or model requires
a new assessment. Installing compatible packages and passing validation alone
does not establish that numerical estimates apply to a real business setting.

For the package contract, see the
[Python SDK guide](../../../decision-lab-developer-docs/docs/guides/python-sdk.md).
