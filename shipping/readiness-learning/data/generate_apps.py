#!/usr/bin/env python3
"""Rebuild portable authored packages using only the public Python SDK.

The source models are the module author's rules. Reference numbers admit the
package; assess.py always replaces them with the current reviewed case and
fresh planning results. No training, prediction or actual operations occur here.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from decision_lab import DecisionLab
from decision import DATA, STUDY, evaluate, learning_case, load_json, planning_case, save

CREATED_AT = "2026-11-17T14:00:00Z"


def main() -> None:
    business = load_json(DATA / "cases/timely.json")
    models = {name: load_json(DATA / f"{name}.model.json") for name in ("planning", "learning")}
    with DecisionLab() as lab:
        apps = {}
        for name, pattern, title in (("planning", "complete-a-commitment/1", "Complete a commitment"),
                                     ("learning", "assess-value-of-learning/1", "Assess the value of learning")):
            template = lab.templates.pack(lab.templates.create(
                template_id=pattern.split("/")[0], version="1.0.0", pattern=pattern, title=title), created_at=CREATED_AT)
            if name == "learning":
                contexts = {context: evaluate(lab, apps["planning"],
                    planning_case(models["planning"], business, study=context != "no-study"), business, f"authoring-{context}")
                    for context in ("no-study", STUDY)}
                reference = {"probabilityRegistered": 0.5, "likelihoods": models[name]["case"]["studies"][0]["likelihoods"],
                             "qualification": "Explicit authoring reference, not a model prediction or an accepted current numerical basis."}
                models[name]["case"] = learning_case(lab, models[name], business, reference, contexts)
            definition = lab.apps.create(template=template, app_id=f"readiness-learning-{name}", release=1, model=models[name])
            apps[name] = lab.apps.pack(definition, created_at=CREATED_AT)
            save(lab, DATA / f"{name}.app.json", apps[name])
        save(lab, DATA / "config.json", {"format": "readiness-learning-package-pins/1", "sdkVersion": lab.sdk_version,
            "packages": {name: {"appId": app["app"]["id"], "contentHash": app["contentHash"]}
                         for name, app in apps.items()}})
    print("Rebuilt planning and learning app packages from the authored models.")


if __name__ == "__main__":
    main()
