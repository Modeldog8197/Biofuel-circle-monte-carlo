import test from "node:test";
import assert from "node:assert/strict";
import {
  pairs,
  relationship,
  indexed,
  growth,
  movingAverage,
  histogram,
  survival,
  cumulative,
  centralPaths,
  scenarioPaths,
} from "../analysis.js";
test("lag direction uses earlier driver and later target without filling gaps", () => {
  const points = pairs([1, 2, 4, 8, 16, 32], [99, 1, 2, 4, 8, 16], 1, "levels");
  assert.equal(points.length, 5);
  assert.equal(points[0].sourceIndex, 0);
  assert.equal(points[0].index, 1);
  assert.equal(relationship(points).r, 1);
  const masked = pairs([null, 10, 15, null, 22], [1, 2, 3, 4, 5], 0, "changes");
  assert.equal(masked.length, 1);
  assert.equal(masked[0].x, 5);
  assert.throws(() => pairs([1], [1], 7));
});
test("transforms retain undefined denominators and incomplete windows", () => {
  assert.deepEqual(indexed([null, 10, 20]), [null, 100, 200]);
  assert.deepEqual(growth([0, 10, null, 20]), [null, null, null, null]);
  assert.deepEqual(movingAverage([1, 2, 3, null, 5]), [
    null,
    null,
    2,
    null,
    null,
  ]);
  assert.equal(
    relationship([
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 1, y: 3 },
    ]).r,
    null,
  );
});
test("histogram conserves every path, including constant and maximum values", () => {
  const bins = histogram([0, 0, 2, 3, 5, 5], 3);
  assert.equal(
    bins.reduce((s, b) => s + b.count, 0),
    6,
  );
  assert.equal(bins.at(-1).count, 2);
  assert.deepEqual(
    histogram([7, 7, 7], 30).map((b) => b.count),
    [3],
  );
  assert.throws(() => histogram([]));
});
test("survival is strict above threshold and includes duplicate outcomes", () => {
  assert.deepEqual(survival([1, 1, 3, 5]), [
    { threshold: 1, probability: 0.5 },
    { threshold: 3, probability: 0.25 },
    { threshold: 5, probability: 0 },
  ]);
});
test("cumulative totals and central examples never mutate the simulation", () => {
  const paths = [
      [1, 2, 3, 4],
      [2, 3, 4, 5],
      [3, 4, 5, 6],
      [100, 100, 100, 100],
    ],
    before = structuredClone(paths);
  assert.deepEqual(cumulative(paths)[0], [1, 3, 6, 10]);
  assert.ok(centralPaths(paths).every((p) => paths.includes(p)));
  assert.deepEqual(paths, before);
});
test("scenario identity, persistence, first-month shock and clipping reconcile", () => {
  const paths = [
      [100, 100, 100, 100],
      [200, 200, 200, 200],
    ],
    response = { drivers: [{ metric: "Driver", last: 100, coefficient: 2 }] };
  assert.deepEqual(
    scenarioPaths(paths, { unit: "count", response }).paths,
    paths,
  );
  const persistent = scenarioPaths(paths, {
    unit: "count",
    response,
    drivers: { Driver: 10 },
  });
  assert.deepEqual(persistent.paths[0], [120, 120, 120, 120]);
  assert.equal(persistent.total.median, 680);
  const first = scenarioPaths(paths, {
    unit: "count",
    response,
    drivers: { Driver: 10 },
    pattern: "first",
  });
  assert.deepEqual(first.paths[0], [120, 100, 100, 100]);
  assert.deepEqual(
    scenarioPaths([[1, 1, 1, 1]], {
      unit: "count",
      response,
      drivers: { Driver: -30 },
    }).paths[0],
    [0, 0, 0, 0],
  );
  assert.throws(() =>
    scenarioPaths(paths, { unit: "count", response, growthPct: 100 }),
  );
  assert.deepEqual(paths, [
    [100, 100, 100, 100],
    [200, 200, 200, 200],
  ]);
});
