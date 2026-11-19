#!/usr/bin/env python3
"""Retain one gift-kit review through evidence, planning and explicit reviews."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from decision_lab import (
    DecisionLab,
    WORKFLOW_ANSWER_STATUS,
    WORKFLOW_NEXT_ACTION_KIND,
    WORKFLOW_REVIEW_STATUS,
    WORKFLOW_STEP_STATUS,
)

ROOT = Path(__file__).resolve().parent
ORIGIN = datetime(2026, 11, 18, tzinfo=timezone.utc)


def at_minute(minute: int) -> str:
    return (ORIGIN + timedelta(minutes=minute)).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def save(lab: DecisionLab, path: Path, value: dict) -> None:
    path.write_text(lab.sources.render_json(value, max_bytes=50_000_000), encoding="utf-8")


def read(lab: DecisionLab, path: Path) -> dict:
    return lab.sources.parse_artifact(path.read_text(encoding="utf-8"), max_bytes=50_000_000)


def finding_summary(lab: DecisionLab, run: dict) -> dict:
    profile = json.loads((ROOT / "data/config.json").read_text())["decisionPresentation"]
    view = lab.reports.decision(run["report"], profile=profile)
    assessment = lab.commitment.resolve_commitment_assessment(run["assessment"], run["report"])
    preferred_ids = set(view["summary"]["preferredIds"])
    preferred = [{"id": plan["id"], "choices": plan["choices"], "expenseMinor": plan["expense"],
                  "finishMinute": next(activity["end"] for activity in plan["activities"] if activity["id"] == "handoff")}
                 for plan in assessment["plans"] if plan["id"] in preferred_ids]
    return {**view["summary"], "preferred": preferred}


def operating_definition(lab: DecisionLab, definition: dict) -> dict:
    # This is the same extension used by the companion React desk. The authored
    # native workflow still owns evidence handoffs and actual completion gates.
    source = copy.deepcopy(definition)
    source.pop("contentHash", None)
    source["metadata"]["reviewJourney"].update(
        version=1, planningStepId="planning", caseIdPath="gifting.id")
    source["metadata"]["caseSchema"]["properties"].update(
        journeyContext={"type": "object"}, journeyOperations={"type": "array", "items": {"type": "object"}})
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


def start(lab: DecisionLab, case_name: str) -> dict:
    config = json.loads((ROOT / "data/config.json").read_text())
    app = lab.apps.open(read(lab, ROOT / "data/planning.app.json"))
    authored = read(lab, ROOT / "data/workflow.definition.json")
    if app["contentHash"] != config["binding"]["packageHash"] or authored["contentHash"] != config["definitionHash"]:
        raise ValueError("The app/workflow differs from the pinned client release.")
    path = ROOT / "fixtures" / f"{case_name}.json"
    data = path.read_bytes()
    business_case = lab.sources.parse_case(data.decode("utf-8"))
    at = at_minute(business_case["gifting"]["commitment"]["nowMinute"])
    template = read(lab, ROOT / "data/template.json")
    author_config = json.loads((ROOT / "data/configuration.json").read_text())
    # The public composition mapping derives conservative inputs from this exact
    # business snapshot. A separately saved same-ID screen can be out of date.
    derived = lab.compositions.generate(template=template,
        config={**author_config, "workedExample": business_case["gifting"]}, created_at=app["app"]["createdAt"])
    generated_model = derived["apps"]["planning"]["app"]["model"]
    if lab.hashing.canonical_hash(generated_model["module"]) != config["binding"]["moduleHash"]:
        raise ValueError("The composition mapping changed the pinned planning rules.")
    screening = lab.run(app=app, case=generated_model["case"], timeout_ms=30_000,
                        created_at=at, run_id=f"python-gifting-screen-{business_case['gifting']['id']}")
    source = {"reference": path.relative_to(ROOT).as_posix(), "bytes": len(data),
              "sha256": hashlib.sha256(data).hexdigest(), "scope": business_case["gifting"]["scope"]}
    current_case = {**business_case, "journeyContext": {"owner": "Jordan Reed", "sources": [source],
        "screeningRun": screening, "previousRun": None, "originalCase": copy.deepcopy(business_case)},
        "journeyOperations": []}
    return lab.workflows.start(definition=operating_definition(lab, authored), case=current_case,
        created_at=at, run_id=f"python-gifting-review-{business_case['gifting']['id']}")


def continue_review(lab: DecisionLab, run: dict, args: argparse.Namespace) -> dict:
    at = at_minute(run["case"]["gifting"]["commitment"]["nowMinute"])
    if args.review_inputs:
        # This loop is reached only through an explicit named review action.
        # Imported answers and completed calculations remain unaccepted by default.
        for question in run["definition"]["questions"]:
            if question["id"] in {"journey-context", "journey-operations"}:
                continue
            answer = run["answers"][question["id"]]
            if answer["status"] == WORKFLOW_ANSWER_STATUS.AWAITING_REVIEW:
                run = lab.workflows.answer(run=run, question_id=question["id"], value=answer["value"],
                    status=WORKFLOW_ANSWER_STATUS.ACCEPTED, actor=args.actor, role=question["role"], at=at)
    if args.accept_finding:
        prepared = lab.workflows.prepare(run=run, step_id=args.accept_finding)
        if prepared["status"] != WORKFLOW_STEP_STATUS.AWAITING_REVIEW:
            raise ValueError("Inspect a current completed finding before accepting it.")
        run = lab.workflows.review(run=run, evaluation_id=prepared["evaluationId"], status=WORKFLOW_REVIEW_STATUS.ACCEPTED,
            actor=args.actor, role=prepared["role"], at=at, note="Explicit review supplied through the Python sample command.")
    output = lab.workflows.output(run=run)
    next_action = next((action for action in output["nextActions"]
                        if action["kind"] == WORKFLOW_NEXT_ACTION_KIND.EVALUATE), None)
    if next_action:
        # Stop after this calculation. Its finding needs its own review
        # before a dependent step can use it.
        run = lab.workflows.evaluate(run=run, step_id=next_action["stepId"], timeout_ms=30_000, created_at=at)
    return run


def export(lab: DecisionLab, run: dict, folder: Path) -> dict:
    output = lab.workflows.output(run=run)
    save(lab, folder / "review.workflow.json", run)
    save(lab, folder / "output.json", output)
    screening = run["case"]["journeyContext"]["screeningRun"]
    save(lab, folder / "screening.run.json", screening)
    summary = {"caseId": run["case"]["gifting"]["id"], "revision": run["revision"],
               "steps": [{"id": row["id"], "status": row["status"]} for row in output["steps"]],
               "screening": finding_summary(lab, screening),
               "originalCutoffMinute": run["case"]["journeyContext"]["originalCase"]["gifting"]["commitment"]["handoffDeadlineMinute"],
               "operatingRecords": len(run["case"]["journeyOperations"])}
    evaluations = [row for row in run["evaluations"] if row["stepId"] == "planning"]
    if evaluations:
        planning = evaluations[-1]["run"]
        save(lab, folder / "planning.run.json", planning)
        summary["planning"] = finding_summary(lab, planning)
        save(lab, folder / "changes.json", lab.reports.compare_findings(before=screening, after=planning))
    (folder / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    begin = commands.add_parser("start", help="Create an unreviewed portable workflow")
    begin.add_argument("--case", choices=["urgent-window", "supported-smaller-correction"],
                       default="supported-smaller-correction")
    resume = commands.add_parser("continue", help="Record an explicit review, then calculate the next ready step")
    resume.add_argument("--review", required=True, type=Path)
    actions = resume.add_mutually_exclusive_group(required=True)
    actions.add_argument("--review-inputs", action="store_true")
    actions.add_argument("--accept-finding", choices=["evidence", "planning"])
    resume.add_argument("--actor", required=True)
    for command in [begin, resume]:
        command.add_argument("--output", required=True, type=Path, help="A new output directory")
    args = parser.parse_args()
    if args.command == "continue" and not args.actor.strip():
        parser.error("--actor must name the person recording the review")
    args.output.mkdir(parents=True, exist_ok=False)
    with DecisionLab() as lab:
        if args.command == "start":
            run = start(lab, args.case)
        else:
            run = lab.workflows.open_run(read(lab, args.review))
            run = continue_review(lab, run, args)
        print(json.dumps(export(lab, run, args.output), indent=2))


if __name__ == "__main__":
    main()
