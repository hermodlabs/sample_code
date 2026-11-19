# Shipment review from Python

A standalone Python integration with the same Decision Lab SDK used by the Node
and React clients. It loads pinned authored JSON, runs current cases, retains
complete reports and compares findings. Python contains no feasibility rules.

Use Python 3.10 or later. Install a qualified **platform wheel** containing the
matching SDK, CLI and Node runtime. No system Node/npm or network access is
needed after installation. The current `0.1.0` candidate is not a registry
publication announcement.

```sh
python -m pip install /absolute/path/to/decision_lab-0.1.0-py3-none-PLATFORM.whl
python /absolute/path/to/this/folder/review_shipments.py --output /tmp/python-shipment-review
python -m decision_lab --help
```

Replace the wheel path with the actual archive for your platform. The folder
can be copied independently; all runtime inputs are included under `data/` and
`fixtures/`, and paths resolve relative to the script.

For development in the Decision Lab checkout, after building its npm workspace:

```sh
python -m pip install --no-build-isolation -e packages/python
export DECISION_LAB_NODE=/absolute/path/to/compatible/node
python sample_code/shipping/shipment-review/review_shipments.py --output /tmp/python-shipment-dev
```

The explicit Node override is for the editable checkout. Installed platform
wheels select their bundled runtime automatically. The source package README
documents supported runtime versions and wheel preparation.

The sample compares four real SDK assessments of the included fictional data:

| Snapshot | Verified finding |
| --- | --- |
| SHIP-104 at 08:00 | Direct is preferred. |
| SHIP-104 at 11:30 | Direct's booking cutoff passed; Consolidated is preferred. |
| SHIP-105 before its revision | Direct is preferred. |
| SHIP-105 after its revision | No listed complete arrangement meets all requirements. |

The least expensive complete supported arrangement is preferred, then arrival.
SHIP-105's revised quantity exceeds Direct's capacity. Its consolidation slot
still names the previous order revision. Python preserves those source scopes;
the SDK reports their effect. The 11:30 run explicitly moves `currentTime` and
`actionReady` in a new pre-booking case. It does not extend a quote or permission,
and it does not model cancellation of an existing reservation.

Each scenario writes `case.json`, `run.json`, `review.workflow.json` and
`output.json`. `booking-cutoff.changes.json` and `order-revision.changes.json`
come directly from `lab.reports.compare_findings`, preserving keyed record
changes, completeness, feasibility, blockers and every preferred tie.

Import `review.workflow.json` into the companion Shipment Reservation Desk. The
native workflow retains its exact definition, pinned app, provisional screen,
original commitment, source receipt and prior matching run where available.
Business answers still await explicit review; the script performs no input or
finding acceptance, operating selection, authorization or booking.

The same installed CLI can inspect the continuing workflow:

```sh
python -m decision_lab workflow inspect \
  --run /tmp/python-shipment-review/changed-order/review.workflow.json \
  --output /tmp/python-shipment-inspection.json
```

Output directories must be new; prior reviews are never overwritten. SHA-256
receipts detect changed local files and do not authenticate their sources.
Resources are independently allocated per fictional shipment. Passing cases
separately does not prove shared resource feasibility.

Maintained source is `examples/shipping/clients`. Its canonical generator copies
the authored app, workflow and complete config into this folder and derives the
`.case.json` files from the shipment-exceptions baseline/morning CSV snapshots
and retained records through the checked importer. The baseline and current
SHIP-105 cases retain their own original scope.

From the repository root, refresh or verify these generated runtime inputs:

```sh
node examples/shipping/clients/generate.mjs
node examples/shipping/clients/generate.mjs --check
```

Updating rules requires an explicit release and pin update. Ordinary Python
execution reads the generated JSON and imports no JavaScript sample source.
