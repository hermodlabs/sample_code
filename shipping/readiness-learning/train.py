"""Train a bounded probability proposal, keeping future answers out of training.

The included history is synthetic. Its held-out scores exercise the pipeline;
they are not performance claims for real suppliers. A different population or
check requires a reviewed dataset, policy and app definition, not just this CSV.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import platform
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from estimation import (
    ALLOWED_REPORTS, BUNDLE_SCHEMA, FEATURES, REPORTS, STATES,
    calibrated_probabilities, dependency_versions, iso_time, sha256,
)

HERE = Path(__file__).resolve().parent


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def read_history(path: Path, policy: dict[str, Any]) -> pd.DataFrame:
    frame = pd.read_csv(path)
    required = {"case_id", "observed_at", "verified_at", "registered", "report", "report_received_at", "source", *FEATURES}
    missing = required - set(frame.columns)
    if missing:
        raise ValueError("History is missing columns: " + ", ".join(sorted(missing)))
    if frame.empty or frame[list(required)].isna().any().any():
        raise ValueError("History cannot contain empty required fields.")
    if frame["case_id"].duplicated().any():
        raise ValueError("case_id must be unique; repeated ship-point/order snapshots need an explicit grouped validation design.")
    for column in ("observed_at", "verified_at", "report_received_at"):
        # Reject naive timestamps instead of silently assigning a timezone.
        frame[column] = pd.to_datetime(frame[column].map(iso_time), utc=True)
    if (frame["verified_at"] < frame["observed_at"]).any() or (frame["report_received_at"] < frame["observed_at"]).any():
        raise ValueError("Verification and check receipt cannot precede their decision snapshot.")
    for name in FEATURES:
        numeric = pd.to_numeric(frame[name], errors="raise")
        bounds = policy["featureContract"][name]
        if not np.isfinite(numeric).all() or (numeric % 1 != 0).any() or not numeric.between(bounds["minimum"], bounds["maximum"]).all():
            raise ValueError(f"{name} does not satisfy the authored integer/range contract.")
        frame[name] = numeric.astype("int64")
    if not frame["registered"].isin([0, 1]).all():
        raise ValueError("registered must contain only independently verified 0/1 labels.")
    frame["registered"] = frame["registered"].astype("int64")
    if not frame["report"].isin(REPORTS).all():
        raise ValueError("An unknown check report is present.")
    contradictory = ((frame["registered"] == 0) & (frame["report"] == "confirmed_registered")) | ((frame["registered"] == 1) & (frame["report"] == "confirmed_not_registered"))
    if contradictory.any():
        raise ValueError("A confirmation contradicts independent verification. The published confirmation contract does not support noisy or incorrectly scoped confirmations.")
    return frame.sort_values(["observed_at", "case_id"]).reset_index(drop=True)


def split_history(frame: pd.DataFrame, policy: dict[str, Any]) -> tuple[dict[str, pd.DataFrame], dict[str, int]]:
    train_end = pd.Timestamp(iso_time(policy["trainBefore"]))
    calibration_end = pd.Timestamp(iso_time(policy["calibrateBefore"]))
    validation_end = pd.Timestamp(iso_time(policy["validationCompletedAt"]))
    if not train_end < calibration_end < validation_end:
        raise ValueError("Training, calibration and validation cutoffs must be strictly increasing.")
    boundaries = {
        "train": (None, train_end),
        "calibration": (train_end, calibration_end),
        "test": (calibration_end, validation_end),
    }
    splits, excluded = {}, {}
    for name, (start, end) in boundaries.items():
        observed = frame["observed_at"] < end
        if start is not None:
            observed &= frame["observed_at"] >= start
        candidates = frame.loc[observed]
        # Verification is the target; its later availability must be respected.
        splits[name] = candidates.loc[candidates["verified_at"] < end].copy()
        excluded[name] = len(candidates) - len(splits[name])
        minimum = policy[{"train": "minimumTrainRows", "calibration": "minimumCalibrationRows", "test": "minimumTestRows"}[name]]
        if len(splits[name]) < minimum:
            raise ValueError(f"The {name} partition has {len(splits[name])} eligible rows; at least {minimum} are required.")
        for state in (0, 1):
            if (splits[name]["registered"] == state).sum() < policy["minimumRowsPerStatePerSplit"]:
                raise ValueError(f"The {name} partition has too few verified examples of state {state}.")
    return splits, excluded


def scores(labels: pd.Series, probabilities: np.ndarray) -> dict[str, float]:
    return {"brierScore": float(brier_score_loss(labels, probabilities)), "logLoss": float(log_loss(labels, probabilities, labels=[0, 1]))}


def reliability_bins(labels: pd.Series, probabilities: np.ndarray) -> list[dict[str, Any]]:
    observed = labels.to_numpy()
    bins = []
    for index in range(10):
        lower, upper = index / 10, (index + 1) / 10
        selected = (probabilities >= lower) & ((probabilities < upper) if index < 9 else (probabilities <= upper))
        count = int(selected.sum())
        bins.append({
            "lowerInclusive": lower, "upper": upper, "upperInclusive": index == 9,
            "count": count,
            "meanPredictedProbability": float(probabilities[selected].mean()) if count else None,
            "observedRegisteredRate": float(observed[selected].mean()) if count else None,
        })
    return bins


def check_statistics(frame: pd.DataFrame, policy: dict[str, Any]) -> dict[str, Any]:
    cutoff = pd.Timestamp(iso_time(policy["calibrateBefore"]))
    usable = frame.loc[(frame["observed_at"] < cutoff) & (frame["verified_at"] < cutoff) & (frame["report_received_at"] < cutoff)]
    likelihoods, counts, reasons = [], {}, []
    for state in STATES:
        selected = usable.loc[usable["registered"] == (1 if state == "registered" else 0)]
        total = len(selected)
        counts[state] = {"total": total, "reports": {report: int((selected["report"] == report).sum()) for report in REPORTS}}
        if total < policy["minimumCheckRowsPerState"]:
            reasons.append(f"Too few pre-test check results in state {state}.")
        for report in REPORTS:
            count = counts[state]["reports"][report]
            allowed = report in ALLOWED_REPORTS[state]
            if allowed and count < policy["minimumAllowedReportRowsPerState"]:
                reasons.append(f"Too few observations of {report} in state {state}; retain the possibility without inventing a likelihood.")
            # Zero here comes from authored confirmation semantics, never absence.
            probability = count / total if allowed and total else 0.0
            likelihoods.append({"state": state, "report": report, "probability": probability})
    return {
        "qualified": not reasons, "qualificationReasons": reasons,
        "estimatedBefore": policy["calibrateBefore"], "eligibleRows": len(usable),
        "counts": counts, "likelihoods": likelihoods,
        "allowedReports": {state: list(reports) for state, reports in ALLOWED_REPORTS.items()},
        "structuralZeroBasis": "Author-defined correctly scoped, authoritative confirmation; no_result remains possible in both states.",
        "selectionCaveat": "Every synthetic case receives a check. Escalation-only real records would not represent the same population.",
    }


def train(history: Path, output: Path, policy_path: Path) -> dict[str, Any]:
    if output.exists():
        raise ValueError(f"Refusing to replace existing output directory: {output}")
    policy = json.loads(policy_path.read_text(encoding="utf-8"))
    frame = read_history(history, policy)
    splits, excluded = split_history(frame, policy)
    training, calibration, test = (splits[name] for name in ("train", "calibration", "test"))
    classifier = make_pipeline(StandardScaler(), LogisticRegression(C=1.0, max_iter=1000, random_state=17))
    classifier.fit(training[list(FEATURES)], training["registered"])
    # Separate sigmoid calibration on later cases. No test labels reach either fit.
    calibrator = LogisticRegression(C=1_000_000, max_iter=1000, random_state=17)
    calibrator.fit(classifier.decision_function(calibration[list(FEATURES)]).reshape(-1, 1), calibration["registered"])
    bundle = {"classifier": classifier, "calibrator": calibrator, "featureNames": list(FEATURES)}
    predicted = calibrated_probabilities(bundle, test[list(FEATURES)])
    raw = classifier.predict_proba(test[list(FEATURES)])[:, 1]
    historical_rate = float(training["registered"].mean())
    baseline = np.full(len(test), historical_rate)
    model_scores, baseline_scores = scores(test["registered"], predicted), scores(test["registered"], baseline)
    reasons = []
    if model_scores["brierScore"] > policy["maximumBrierScore"]:
        reasons.append("Held-out Brier score exceeds the authored maximum.")
    if baseline_scores["brierScore"] - model_scores["brierScore"] < policy["minimumBrierImprovement"]:
        reasons.append("Held-out Brier improvement over the historical-rate baseline is insufficient.")
    if model_scores["logLoss"] > policy["maximumLogLoss"]:
        reasons.append("Held-out log loss exceeds the authored maximum.")
    if baseline_scores["logLoss"] - model_scores["logLoss"] < policy["minimumLogLossImprovement"]:
        reasons.append("Held-out log-loss improvement over the historical-rate baseline is insufficient.")
    validation = {
        "qualified": not reasons, "qualificationReasons": reasons,
        "completedAt": policy["validationCompletedAt"],
        "splitCounts": {name: len(rows) for name, rows in splits.items()},
        "labelsUnavailableAtCutoff": excluded,
        "historicalRegisteredRate": historical_rate,
        "baseline": baseline_scores, "uncalibratedModel": scores(test["registered"], raw),
        "calibratedModel": model_scores,
        "reliabilityBins": reliability_bins(test["registered"], predicted),
        "syntheticCaveat": "These measurements assess a deterministic fictional dataset, not operational prediction quality.",
    }
    check_stats = check_statistics(frame, policy)
    output.mkdir(parents=True)
    joblib.dump(bundle, output / "model.joblib")
    write_json(output / "validation.json", validation)
    write_json(output / "check-statistics.json", check_stats)
    write_json(output / "training-policy.json", policy)
    synthetic = bool((frame["source"] == "synthetic-teaching-data").all())
    latest_qualified = pd.concat(list(splits.values()))["observed_at"].max().isoformat().replace("+00:00", "Z")
    manifest = {
        "schemaVersion": BUNDLE_SCHEMA, "modelId": "ship-point-registration-logistic-v1",
        "datasetSha256": sha256(history), "datasetRows": len(frame), "synthetic": synthetic,
        "population": {
            "unit": "One independent ship-point/order readiness decision, with at-decision features and later independent verification.",
            "sourceLabels": sorted(str(value) for value in frame["source"].unique()),
            "assumption": "Each case belongs to the reviewed population; no repeated-entity or escalation-only sampling is qualified by this example.",
        },
        "featureContract": policy["featureContract"],
        "trainingFeatureRanges": {name: {"minimum": int(training[name].min()), "maximum": int(training[name].max())} for name in FEATURES},
        "splitBounds": {"trainBefore": policy["trainBefore"], "calibrateBefore": policy["calibrateBefore"], "validationCompletedAt": policy["validationCompletedAt"]},
        "latestObservationAt": latest_qualified,
        "latestQualifiedObservationAt": latest_qualified,
        "ignoredRows": {
            "observedAtOrAfterValidationCutoff": int((frame["observed_at"] >= pd.Timestamp(iso_time(policy["validationCompletedAt"]))).sum()),
            "labelsUnavailableAtPartitionCutoff": sum(excluded.values()),
        },
        "pythonVersion": platform.python_version(),
        "dependencyVersions": dependency_versions(),
        "method": "Standardized logistic regression; sigmoid calibration fitted on a separate later partition; untouched chronological test partition.",
        "files": {name: sha256(output / name) for name in ("model.joblib", "validation.json", "check-statistics.json", "training-policy.json")},
    }
    write_json(output / "manifest.json", manifest)
    return {"manifest": manifest, "validation": validation, "checkStatistics": check_stats}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--history", type=Path, default=HERE / "data" / "history.csv")
    parser.add_argument("--policy", type=Path, default=HERE / "data" / "training-policy.json")
    parser.add_argument("--output", type=Path, required=True, help="New directory for the model and its reviewed basis.")
    args = parser.parse_args()
    try:
        result = train(args.history, args.output, args.policy)
    except (OSError, ValueError, KeyError) as error:
        parser.exit(2, f"Training failed: {error}\n")
    print(json.dumps({"output": str(args.output), "qualified": result["validation"]["qualified"] and result["checkStatistics"]["qualified"], "validation": result["validation"]}, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
