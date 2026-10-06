import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { simulate, quantile, thresholdStats } from "../model.js";
const report = JSON.parse(
  readFileSync(new URL("../forecast_report.json", import.meta.url)),
);
test("browser and Python use identical seeded distribution", () => {
  for (const t of Object.values(report.targets)) {
    const result = simulate(t, 20000, 8197);
    for (let h = 0; h < 4; h++)
      for (const key of ["p025", "p10", "median", "p90", "p975", "mean"])
        assert.ok(
          Math.abs(result.forecast[h][key] - t.forecast[h][key]) < 1e-6,
          key,
        );
    assert.ok(Math.abs(result.total.median - t.total.median) < 1e-6);
  }
});
test("quantile interpolates without mutating input", () => {
  const a = [3, 1, 9, 2];
  assert.equal(quantile(a, 0.5), 2.5);
  assert.deepEqual(a, [3, 1, 9, 2]);
});
test("probabilities and expected excess use strict threshold", () => {
  const s = thresholdStats(
    [
      [1, 2, 3, 4],
      [3, 4, 5, 6],
    ],
    0,
    1,
  );
  assert.equal(s.probability, 0.5);
  assert.equal(s.expectedExcess, 1);
});
test("invalid horizon, seed and vectors fail", () => {
  assert.throws(() => thresholdStats([], 0, 1));
  assert.throws(() => thresholdStats([[1, 2, 3, 4]], 4, 1));
  const t = Object.values(report.targets)[0];
  assert.throws(() => simulate(t, 1000, -1));
  assert.throws(() => simulate({ ...t, errors: [] }, 1000, 1));
});
