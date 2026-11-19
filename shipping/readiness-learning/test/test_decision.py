"""End-to-end decision tests using the installed SDK, fitted model and CLI."""

from __future__ import annotations

import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))

from decision_lab import DecisionLab
from decision import assess_case, load_json
from estimation import estimate
from report import render_html
from train import train


class DecisionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.temp = tempfile.TemporaryDirectory(prefix="shipment-learning-decision-")
        cls.directory = Path(cls.temp.name)
        cls.model = cls.directory / "model"
        train(HERE / "data/history.csv", cls.model, HERE / "data/training-policy.json")
        cls.lab = DecisionLab()
        cls.counter = 0

    @classmethod
    def tearDownClass(cls) -> None:
        cls.lab.close()
        cls.temp.cleanup()

    def assess(self, name: str, *, reviewer: str | None = "Fictional test reviewer", business: dict | None = None,
               probability: float | None = None) -> tuple[dict, Path]:
        business = copy.deepcopy(business or load_json(HERE / f"data/cases/{name}.json"))
        proposal = estimate(self.model, business["features"], business["asOf"])
        if probability is not None:
            proposal["probabilityRegistered"] = probability
            proposal["provenance"]["testAssumption"] = "Explicit endpoint assumption, not a fitted prediction."
        type(self).counter += 1
        folder = self.directory / f"assessment-{self.counter}"
        folder.mkdir()
        result = assess_case(self.lab, business, proposal, folder, reviewer=reviewer)
        return result, folder

    def test_import_does_not_accept_estimates_or_create_a_learning_finding(self) -> None:
        result, folder = self.assess("timely", reviewer=None)
        self.assertEqual(result["estimates"]["status"], "awaiting-review")
        self.assertIsNone(result["estimates"]["review"])
        self.assertEqual(result["learning"]["status"], "unassessed")
        self.assertEqual(result["learning"]["baselineCostMinor"], 600000)
        self.assertTrue(result["planning"]["baseline"]["feasible"])
        self.assertTrue((folder / "learning.proposal.json").exists())
        self.assertFalse((folder / "learning.run.json").exists())

    def test_timely_check_matches_independent_complete_cost_and_retains_all_branches(self) -> None:
        result, folder = self.assess("timely")
        comparison = result["learning"]
        proposal = result["estimates"]["proposal"]
        p_ready = proposal["probabilityRegistered"]
        p_confirmation = next(row["probability"] for row in proposal["likelihoods"]
                              if row["state"] == "registered" and row["report"] == "confirmed_registered")
        expected_cost = 600000 - 200000 * p_ready * p_confirmation + 20000
        self.assertAlmostEqual(comparison["expectedCostMinor"], expected_cost, places=6)
        self.assertAlmostEqual(comparison["netBenefitMinor"], 600000 - expected_cost, places=6)
        self.assertTrue(comparison["studyFeasible"])
        self.assertEqual(comparison["recommendedOption"], "registration_check")
        responses = {row["reportId"]: row for row in comparison["responses"]}
        self.assertEqual(responses["confirmed_registered"]["actionId"], "direct")
        self.assertEqual(responses["confirmed_not_registered"]["actionId"], "backup")
        self.assertEqual(responses["no_result"]["actionId"], "backup")
        self.assertGreater(responses["no_result"]["probability"], 0)
        self.assertEqual(set(responses["no_result"]["supportedStateIds"]), {"registered", "not_registered"})
        self.assertEqual(len(result["sensitivity"]), 5)
        for filename in ["planning-baseline.run.json", "planning-study.run.json", "learning.run.json"]:
            self.assertTrue(self.lab.runs.validate(load_json(folder / filename))["valid"])

    def test_expensive_check_is_operationally_possible_but_not_worth_its_fee(self) -> None:
        result, _ = self.assess("high-fee")
        comparison = result["learning"]
        self.assertTrue(comparison["studyFeasible"])
        self.assertLess(comparison["netBenefitMinor"], 0)
        self.assertGreater(comparison["expectedCostMinor"], comparison["baselineCostMinor"])
        self.assertEqual(comparison["recommendedOption"], "no-study")

    def test_late_result_cannot_restore_an_expired_reservation(self) -> None:
        result, _ = self.assess("late")
        self.assertTrue(result["planning"]["baseline"]["feasible"])
        self.assertFalse(result["planning"]["study"]["feasible"])
        self.assertFalse(result["learning"]["studyFeasible"])
        self.assertIsNone(result["learning"]["expectedCostMinor"])
        self.assertEqual(result["learning"]["recommendedOption"], "no-study")
        self.assertGreater(result["timing"]["responseReadyMinute"], result["timing"]["reservationDeadlineMinute"])

    def test_unsupported_estimates_do_not_acquire_acceptance_through_a_flag(self) -> None:
        result, folder = self.assess("unsupported")
        self.assertEqual(result["estimates"]["status"], "unsupported")
        self.assertIsNone(result["estimates"]["proposal"]["probabilityRegistered"])
        self.assertIsNone(result["estimates"]["review"])
        self.assertTrue(result["planning"]["baseline"]["feasible"])
        self.assertEqual(result["learning"]["status"], "unassessed")
        self.assertFalse((folder / "estimates.review.json").exists())
        self.assertFalse((folder / "learning.run.json").exists())

    def test_probability_one_does_not_remove_the_unregistered_planning_state(self) -> None:
        result, folder = self.assess("timely", probability=1.0)
        direct = next(row for row in result["planning"]["baseline"]["plans"] if row["action"] == "direct")
        self.assertFalse(direct["feasible"])
        inputs = load_json(folder / "learning.case.json")
        self.assertEqual(set(inputs["executionFeasibility"]["admittedStateIds"]), {"registered", "not_registered"})
        self.assertEqual({row["state"] for row in inputs["executionFeasibility"]["reportSupport"]
                          if row["report"] == "no_result" and row["possible"]}, {"registered", "not_registered"})
        self.assertEqual(result["learning"]["baselineCostMinor"], 600000)

    def test_a_prediction_cannot_supply_study_purchase_authority(self) -> None:
        business = load_json(HERE / "data/cases/timely.json")
        business["planning"]["studyPurchaseCap"] = 0
        result, _ = self.assess("timely", business=business)
        self.assertTrue(result["planning"]["baseline"]["feasible"])
        self.assertFalse(result["learning"]["studyFeasible"])
        self.assertEqual(result["learning"]["recommendedOption"], "no-study")

    def test_no_arrangement_is_recommended_when_every_plan_is_blocked(self) -> None:
        business = load_json(HERE / "data/cases/timely.json")
        business["planning"]["cashLimit"] = 100
        result, _ = self.assess("timely", business=business)
        self.assertFalse(result["planning"]["baseline"]["feasible"])
        self.assertIsNone(result["learning"]["recommendedOption"])
        self.assertIsNone(result["learning"]["expectedCostMinor"])
        self.assertIn("No listed complete arrangement", render_html(result))

    def test_report_is_local_accessible_html_and_escapes_supplied_values(self) -> None:
        result, _ = self.assess("timely")
        result["nextAction"] = '<script>alert("test")</script>'
        html = render_html(result)
        self.assertIn("Should we buy a readiness check?", html)
        self.assertIn("Calibrated classifier", html)
        self.assertIn("Historical readiness rate", html)
        self.assertIn("&lt;script&gt;", html)
        self.assertNotIn('<script>', html)
        self.assertNotIn('https://', html)
        self.assertIn("<details>", html)
        self.assertIn("<caption>", html)

    def test_installed_cli_reproduces_complete_sdk_learning_output(self) -> None:
        result, folder = self.assess("timely")
        original = load_json(folder / "learning.run.json")
        target = folder / "learning.cli.run.json"
        process = subprocess.run([sys.executable, "-m", "decision_lab", "run", "--app", str(HERE / "data/learning.app.json"),
            "--case", str(folder / "learning.bound-case.json"), "--run-id", original["identity"]["runId"],
            "--created-at", original["identity"]["createdAt"], "--timeout-ms", "30000", "--output", str(target)],
            capture_output=True, text=True, timeout=60, cwd=self.directory)
        self.assertEqual(process.returncode, 0, process.stderr)
        reproduced = self.lab.sources.parse_artifact(target.read_text(), max_bytes=50_000_000)
        self.assertEqual(self.lab.hashing.canonical_hash(reproduced), self.lab.hashing.canonical_hash(original))


if __name__ == "__main__":
    unittest.main()
