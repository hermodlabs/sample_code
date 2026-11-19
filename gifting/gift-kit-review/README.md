# Gift-kit workflow from Python

A standalone Python integration that continues the same native workflow used
by the Gift-kit Handoff Desk. It derives conservative screening inputs from the
actual business snapshot, retains that run and source receipt, then uses the
authored evidence-to-planning handoff. Python contains no fault elimination or
feasibility rules.

Use Python 3.10 or later and install a qualified **platform wheel**. It includes
the matching SDK, CLI and Node runtime, so installed execution needs no system
Node/npm or network access. The `0.1.0` candidate does not announce registry
publication.

```sh
python -m pip install /absolute/path/to/decision_lab-0.1.0-py3-none-PLATFORM.whl
cd /absolute/path/to/this/folder
python review_gifts.py start --case supported-smaller-correction --output /tmp/gift-inputs
```

Replace the wheel path with its real platform-specific filename. This folder is
self-contained; script data paths resolve relative to `__file__`. For an
editable repository checkout after its npm workspace build:

```sh
python -m pip install --no-build-isolation -e packages/python
export DECISION_LAB_NODE=/absolute/path/to/compatible/node
python sample_code/gifting/gift-kit-review/review_gifts.py start \
  --case supported-smaller-correction --output /tmp/gift-inputs-dev
```

The explicit Node override is for development. Installed platform wheels choose
their bundled runtime automatically.

Starting writes an **unreviewed** native run. Inspect the fictional case and
reports before supplying each named review action:

```sh
python review_gifts.py continue --review /tmp/gift-inputs/review.workflow.json \
  --review-inputs --actor 'Campaign reviewer' --output /tmp/gift-evidence

python review_gifts.py continue --review /tmp/gift-evidence/review.workflow.json \
  --accept-finding evidence --actor 'Campaign reviewer' --output /tmp/gift-planning

python review_gifts.py continue --review /tmp/gift-planning/review.workflow.json \
  --accept-finding planning --actor 'Campaign reviewer' --output /tmp/gift-reviewed
```

Each calculation stops for its own finding review. These explicit commands are
recorded assertions by the named actor. A production integration must connect
them to actual review actions and identity; import never silently accepts a
record or finding.

For the included fictional GIFT-324 case, actual Python execution retains:

| Stage | Native result |
| --- | --- |
| Initial import | Evidence needs input review; planning is not yet applicable. |
| Conservative screening | External complete correction, $400, ready at minute 1,435. |
| Reviewed source-artwork and checkout evidence | Only the printed inserts need correction. |
| Planning | Replace inserts, $100, ready at minute 1,435; finding awaits review. |
| Explicit planning acceptance | Accepted analytical finding; operating records remain empty. |

The original cutoff remains minute 1,440. `--case urgent-window` instead uses
the companion GIFT-321 records whose retained uncertainty requires complete
correction. Both cases use whole elapsed minutes from
`2026-11-18T00:00:00.000Z`; no calendar or working-day arithmetic is implied.

Every stage writes `review.workflow.json`, `output.json`, `screening.run.json`
and `summary.json`. After planning it also writes `planning.run.json` and native
`changes.json`, comparing the same case and pinned planning rules against the
conservative screen. All complete preferred ties and unavailable outcomes keep
their SDK meaning.

Import `review.workflow.json` in the companion React desk to continue. It retains
the exact authored definition and app pins, original commitment and report text,
source receipts, answers, evaluation runs and review history. The installed CLI
opens the identical artifact:

```sh
python -m decision_lab workflow inspect --run /tmp/gift-planning/review.workflow.json \
  --output /tmp/gift-inspection.json
```

Accepting an analytical finding does not select a package, spend money, perform
correction, prove a passing rehearsal or hand over kits. The authored closure
gate still requires separately supplied scoped operating records linked to the
current accepted finding and completion before the original cutoff. No
operating records are invented here. File receipts detect changed bytes and do
not authenticate reports.

Outputs use a new directory each time. Native history is retained in full; the
sample uses the SDK's explicit 50,000,000-byte artifact source bound. All records
are fictional and production resources are independently allocated per case.
Maintained source is `examples/gifting/clients/journey-v3`. The canonical client
generator copies its pinned runtime JSON, complete config and case fixtures into
this folder alongside the Node and React client copies.

From the repository root, refresh or verify these generated runtime inputs:

```sh
node examples/gifting/clients/generate.mjs
node examples/gifting/clients/generate.mjs --check
```

Ordinary Python execution imports no JavaScript sample helper and does not
rewrite the older version 2 marketplace releases.
