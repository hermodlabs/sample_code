#!/usr/bin/env python3
"""Compare shipment snapshots through the installed Decision Lab SDK binding."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path

from decision_lab import DecisionLab

ROOT = Path(__file__).resolve().parent
CREATED_AT = "2026-11-17T14:00:00.000Z"
LATER_AT = "2026-11-17T17:30:00.000Z"


def receipt(path: Path) -> dict:
    data = path.read_bytes()
    return {"reference": path.relative_to(ROOT).as_posix(), "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest()}


def save(lab: DecisionLab, path: Path, value: dict) -> None:
    path.write_text(lab.sources.render_json(value, max_bytes=50_000_000), encoding="utf-8")


def operating_definition(lab: DecisionLab, definition: dict) -> dict:
    # Match the companion desk's native definition extension. Domain gates stay
    # in the authored workflow; these questions only retain source/event records.
    source = copy.deepcopy(definition)
    source.pop("contentHash", None)
    source["metadata"]["reviewJourney"].update(
        version=1, planningStepId="planning", caseIdPath="inputs.id")
    source["questions"].extend([
        {"id": "journey-context", "path": "journeyContext", "label": "Screening and source basis",
         "question": "Who owns this review and where did its records come from?",
         "meaning": "Imported source receipts and provisional screening are retained for inspection, not accepted findings.",
         "role": "case-owner", "type": "object"},
        {"id": "journey-operations", "path": "journeyOperations", "label": "Operating records",
         "question": "What decision or actual operating record has been supplied?",
         "meaning": "Record a selection, external authority or actual event separately from accepting an analytical finding. A recorded assertion does not authenticate its source.",
         "role": "case-owner", "type": "array"},
    ])
    return lab.workflows.create(source)


def summarize(lab: DecisionLab, run: dict) -> dict:
    view = lab.reports.decision(run["report"])
    return {"execution": run["execution"]["status"], "assessment": view["assessmentStatus"],
            "heading": view["summary"]["heading"], "detail": view["summary"]["detail"],
            "preferredPlanIds": view["summary"]["preferredIds"]}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path, help="A new output directory")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    with DecisionLab() as lab:
        app = lab.apps.open(lab.sources.parse_artifact((ROOT / "data/shipment.app.json").read_text()))
        config = json.loads((ROOT / "data/config.json").read_text())
        if app["contentHash"] != config["binding"]["packageHash"]:
            raise ValueError("The app does not match the pinned release.")
        authored = lab.sources.parse_artifact((ROOT / "data/shipment.workflow.json").read_text())
        if authored["contentHash"] != config["workflowHash"]:
            raise ValueError("The operating workflow does not match the pinned release.")
        definition = operating_definition(lab, authored)
        cases = {name: lab.sources.parse_case((ROOT / "fixtures" / filename).read_text()) for name, filename in {
            "confirmed": "baseline-SHIP-104.case.json", "before-revision": "baseline-SHIP-105.case.json",
            "changed-order": "morning-SHIP-105.case.json"}.items()}
        cases["after-cutoff"] = copy.deepcopy(cases["confirmed"])
        # Moving the case clock is a fresh pre-booking decision. It does not
        # cancel an existing reservation or extend any quote or permission.
        cases["after-cutoff"]["parameters"].update(currentTime=690, actionReady=690)
        runs = {}
        summary = {}
        for name, inputs in cases.items():
            at = LATER_AT if name == "after-cutoff" else CREATED_AT
            run = lab.run(app=app, case=inputs, timeout_ms=30_000, created_at=at,
                          run_id=f"python-shipping-{name}")
            runs[name] = run
            folder = args.output / name
            folder.mkdir()
            save(lab, folder / "case.json", inputs)
            save(lab, folder / "run.json", run)
            summary[name] = summarize(lab, run)
            source_name = {"after-cutoff": "baseline-SHIP-104.case.json", "confirmed": "baseline-SHIP-104.case.json",
                           "before-revision": "baseline-SHIP-105.case.json", "changed-order": "morning-SHIP-105.case.json"}[name]
            source = receipt(ROOT / "fixtures" / source_name)
            if name == "after-cutoff":
                source["assessmentTimeOverride"] = LATER_AT
            original = {"inputs": inputs}
            current_case = {**original, "journeyContext": {"owner": config["owner"]["name"],
                "sources": [source], "screeningRun": run,
                "previousRun": runs.get("before-revision") if name == "changed-order" else None,
                "originalCase": original}, "journeyOperations": []}
            native = lab.workflows.start(definition=definition, case=current_case, created_at=at,
                                         run_id=f"python-shipping-review-{name}")
            save(lab, folder / "review.workflow.json", native)
            save(lab, folder / "output.json", lab.workflows.output(run=native))
        for label, before, after in [("booking-cutoff", "confirmed", "after-cutoff"),
                                     ("order-revision", "before-revision", "changed-order")]:
            changes = lab.reports.compare_findings(before=runs[before], after=runs[after])
            save(lab, args.output / f"{label}.changes.json", changes)
        (args.output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
        print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
