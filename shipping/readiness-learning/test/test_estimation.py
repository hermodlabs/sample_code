"""Real fitting and temporal/integrity checks; no estimator mocks."""

from __future__ import annotations

import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))

from estimation import estimate
from train import read_history, split_history, train


FEATURES = {"portal_listing_age_days": 14, "prior_shipments_90d": 2, "days_since_scope_change": 10, "open_setup_tasks": 3}
AS_OF = "2026-11-17T14:00:00Z"


class EstimationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.temp = tempfile.TemporaryDirectory(prefix="readiness-estimation-")
        cls.model = Path(cls.temp.name) / "model"
        cls.policy_path = HERE / "data" / "training-policy.json"
        cls.policy = json.loads(cls.policy_path.read_text())
        cls.trained = train(HERE / "data" / "history.csv", cls.model, cls.policy_path)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.temp.cleanup()

    def test_estimates_have_held_out_improvement_and_complete_report_support(self) -> None:
        proposal = estimate(self.model, FEATURES, AS_OF)
        self.assertTrue(proposal["supported"], proposal["reasons"])
        self.assertGreater(proposal["probabilityRegistered"], 0)
        self.assertLess(proposal["probabilityRegistered"], 1)
        self.assertTrue(proposal["provenance"]["synthetic"])
        validation = proposal["validation"]
        self.assertLess(validation["calibratedModel"]["brierScore"], validation["baseline"]["brierScore"])
        self.assertLess(validation["calibratedModel"]["logLoss"], validation["baseline"]["logLoss"])
        self.assertEqual(sum(row["count"] for row in validation["reliabilityBins"]), validation["splitCounts"]["test"])
        for state in ("registered", "not_registered"):
            rows = [row for row in proposal["likelihoods"] if row["state"] == state]
            self.assertAlmostEqual(sum(row["probability"] for row in rows), 1)
            self.assertGreater(next(row["probability"] for row in rows if row["report"] == "no_result"), 0)
            impossible = "confirmed_not_registered" if state == "registered" else "confirmed_registered"
            self.assertEqual(next(row["probability"] for row in rows if row["report"] == impossible), 0)

    def test_unknown_out_of_range_and_noninteger_features_do_not_become_probabilities(self) -> None:
        variations = [
            {**FEATURES, "open_setup_tasks": None}, {**FEATURES, "open_setup_tasks": True},
            {**FEATURES, "open_setup_tasks": 3.5}, {**FEATURES, "open_setup_tasks": 100},
            {**FEATURES, "registered": 1}, {key: value for key, value in FEATURES.items() if key != "open_setup_tasks"},
        ]
        for features in variations:
            with self.subTest(features=features):
                result = estimate(self.model, features, AS_OF)
                self.assertFalse(result["supported"])
                self.assertIsNone(result["probabilityRegistered"])
                self.assertEqual(result["likelihoods"], [])
                self.assertTrue(result["reasons"])

    def test_proposed_time_cannot_precede_validation_or_exceed_age_limit(self) -> None:
        for when in ("2026-08-01T00:00:00Z", "2027-11-17T14:00:00Z", "2026-11-17"):
            result = estimate(self.model, FEATURES, when)
            self.assertFalse(result["supported"])
            self.assertIsNone(result["probabilityRegistered"])

    def test_late_labels_are_excluded_from_earlier_training_and_calibration(self) -> None:
        frame = read_history(HERE / "data" / "history.csv", self.policy)
        original, excluded = split_history(frame, self.policy)
        train_row = original["train"].index[0]
        calibration_row = original["calibration"].index[0]
        frame.loc[train_row, "verified_at"] = frame["verified_at"].max()
        frame.loc[calibration_row, "verified_at"] = frame["verified_at"].max()
        revised, revised_excluded = split_history(frame, self.policy)
        self.assertEqual(len(revised["train"]), len(original["train"]) - 1)
        self.assertEqual(len(revised["calibration"]), len(original["calibration"]) - 1)
        self.assertEqual(revised_excluded["train"], excluded["train"] + 1)
        self.assertNotIn(train_row, revised["calibration"].index)

    def test_bundle_changes_are_rejected_before_deserializing(self) -> None:
        altered = Path(self.temp.name) / "altered"
        shutil.copytree(self.model, altered)
        with (altered / "model.joblib").open("ab") as stream:
            stream.write(b"changed")
        result = estimate(altered, FEATURES, AS_OF)
        self.assertFalse(result["supported"])
        self.assertIn("integrity", " ".join(result["reasons"]))

    def test_failed_quality_policy_produces_an_unqualified_bundle(self) -> None:
        policy = {**self.policy, "maximumBrierScore": 0.0}
        policy_path = Path(self.temp.name) / "strict-policy.json"
        policy_path.write_text(json.dumps(policy))
        target = Path(self.temp.name) / "unqualified"
        train(HERE / "data" / "history.csv", target, policy_path)
        result = estimate(target, FEATURES, AS_OF)
        self.assertFalse(result["supported"])
        self.assertIsNone(result["probabilityRegistered"])
        self.assertIn("Brier", " ".join(result["reasons"]))

    def test_absence_of_an_allowed_report_does_not_establish_impossibility(self) -> None:
        frame = read_history(HERE / "data" / "history.csv", self.policy)
        frame.loc[(frame["registered"] == 1) & (frame["report"] == "no_result"), "report"] = "confirmed_registered"
        csv_path = Path(self.temp.name) / "missing-no-result.csv"
        frame.to_csv(csv_path, index=False)
        target = Path(self.temp.name) / "sparse-checks"
        train(csv_path, target, self.policy_path)
        result = estimate(target, FEATURES, AS_OF)
        self.assertFalse(result["supported"])
        self.assertIsNone(result["probabilityRegistered"])
        self.assertIn("no_result", " ".join(result["reasons"]))

    def test_contradictory_confirmation_history_is_rejected(self) -> None:
        import pandas as pd
        frame = pd.read_csv(HERE / "data" / "history.csv")
        first = frame.index[frame["registered"] == 0][0]
        frame.loc[first, "report"] = "confirmed_registered"
        target = Path(self.temp.name) / "contradiction.csv"
        frame.to_csv(target, index=False)
        with self.assertRaisesRegex(ValueError, "contradicts"):
            read_history(target, self.policy)

    def test_training_does_not_overwrite_a_prior_bundle(self) -> None:
        with self.assertRaisesRegex(ValueError, "Refusing"):
            train(HERE / "data" / "history.csv", self.model, self.policy_path)

    def test_unused_future_history_cannot_refresh_model_age(self) -> None:
        import pandas as pd
        frame = pd.read_csv(HERE / "data" / "history.csv")
        future = frame.iloc[-1].copy()
        future["case_id"] = "SYN-FUTURE"
        future["observed_at"] = "2027-05-01T08:00:00Z"
        future["verified_at"] = "2027-05-02T08:00:00Z"
        future["report_received_at"] = "2027-05-01T10:00:00Z"
        frame = pd.concat([frame, future.to_frame().T], ignore_index=True)
        history = Path(self.temp.name) / "future-history.csv"
        frame.to_csv(history, index=False)
        target = Path(self.temp.name) / "future-history"
        changed = train(history, target, self.policy_path)
        self.assertEqual(changed["manifest"]["latestQualifiedObservationAt"], self.trained["manifest"]["latestQualifiedObservationAt"])
        self.assertEqual(changed["manifest"]["ignoredRows"]["observedAtOrAfterValidationCutoff"], 1)
        self.assertEqual(changed["validation"], self.trained["validation"])
        result = estimate(target, FEATURES, "2027-03-17T14:00:00Z")
        self.assertFalse(result["supported"])
        self.assertIn("older than", " ".join(result["reasons"]))


if __name__ == "__main__":
    unittest.main()
