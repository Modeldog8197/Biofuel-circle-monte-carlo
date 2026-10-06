import copy
import importlib.util
import unittest
import numpy as np
from forecast import *


class ForecastTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = read_json(ROOT / "verified_data.json")
        cls.report = build_report(cls.data, 1000)

    def test_workbook_matches_export(self):
        spec = importlib.util.spec_from_file_location(
            "extractor", ROOT / "01_data_inspection.py"
        )
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        source = mod.extract(ROOT / "Platform BU data for analysis.xlsx")
        self.assertEqual(source, self.data)

    def test_exact_four_month_calendar(self):
        self.assertEqual(
            self.report["forecast_months"], ["2026-05", "2026-06", "2026-07", "2026-08"]
        )
        self.assertEqual(
            next_months(datetime(2025, 11, 1)),
            ["2025-12", "2026-01", "2026-02", "2026-03"],
        )
        with self.assertRaises(ValueError):
            predict(np.ones(43), MODELS[0], 12)

    def test_holdout_does_not_select_model(self):
        changed = copy.deepcopy(self.data)
        for name in TARGETS:
            changed["data"][name][-8:] = [1000000] * 8
        other = build_report(changed, 1000)
        for name in TARGETS:
            self.assertEqual(
                self.report["targets"][name]["model"], other["targets"][name]["model"]
            )
            self.assertEqual(
                self.report["targets"][name]["development"],
                other["targets"][name]["development"],
            )

    def test_early_predictions_do_not_see_later_outcomes(self):
        y = np.array(self.data["data"][TARGETS[0]], float)
        original = evaluate(y, "Damped trend", 35)
        changed = y.copy()
        changed[39:] *= 100
        rerun = evaluate(changed, "Damped trend", 35)
        for a, b in zip(original[:4], rerun[:4]):
            for key in ("forecast", "naive", "lower80", "upper80"):
                self.assertEqual(a[key], b[key])

    def test_each_model_constant_and_zero(self):
        for model in MODELS:
            np.testing.assert_allclose(predict(np.ones(43) * 10, model), 10, atol=1e-8)
            np.testing.assert_allclose(predict(np.zeros(43), model), 0)

    def test_seeded_count_paths(self):
        t = self.report["targets"][TARGETS[0]]
        a = simulate(t["point"], t["errors"], 1000, 8197, True, t["error_scale"])
        b = simulate(t["point"], t["errors"], 1000, 8197, True, t["error_scale"])
        np.testing.assert_array_equal(a, b)
        self.assertTrue(np.all(a >= 0))
        self.assertTrue(np.all(a == np.floor(a)))
        self.assertEqual(a.shape, (1000, 4))

    def test_total_is_path_sum(self):
        paths = np.array([[1, 2, 3, 4], [10, 2, 5, 4], [4, 20, 2, 1]])
        self.assertEqual(summarize(paths.sum(axis=1)[:, None])[0]["median"], 21)

    def test_missing_target_rejected_auxiliary_retained(self):
        changed = copy.deepcopy(self.data)
        changed["data"][TARGETS[0]][0] = None
        with self.assertRaises(ValueError):
            validate_data(changed)
        validate_data(self.data)
        self.assertTrue(any(r["missing"] for r in self.report["quality"]))
        self.assertTrue(any(r["negative"] for r in self.report["quality"]))

    def test_calendar_gaps_rejected(self):
        changed = copy.deepcopy(self.data)
        changed["months"][3] = changed["months"][2]
        with self.assertRaises(ValueError):
            validate_data(changed)

    def test_metrics_and_overlapping_origins(self):
        t = self.report["targets"][TARGETS[0]]
        self.assertEqual(t["holdout"]["observations"], 20)
        self.assertEqual(
            len(set(r["origin_index"] for r in t["holdout_predictions"])), 5
        )
        score = t["holdout"]
        self.assertAlmostEqual(score["skill"], 1 - score["mae"] / score["naive_mae"])

    def test_invalid_simulation(self):
        with self.assertRaises(ValueError):
            simulate([1] * 4, [], 1000)
        with self.assertRaises(ValueError):
            simulate([1] * 4, [[0] * 4], 1000, -1)


if __name__ == "__main__":
    unittest.main()
