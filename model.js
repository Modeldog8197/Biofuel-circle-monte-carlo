export function quantile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lo = Math.floor(index),
    hi = Math.ceil(index);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
}
export function simulate(target, n = 20000, seed = 8197) {
  if (
    ![1000, 10000, 20000, 50000].includes(n) ||
    !Number.isInteger(seed) ||
    seed < 0 ||
    seed > 4294967295
  )
    throw new Error(
      "Choose a supported path count and an unsigned 32-bit seed.",
    );
  if (
    target.point?.length !== 4 ||
    !target.errors?.length ||
    target.errors.some(
      (e) => e.length !== 4 || e.some((x) => !Number.isFinite(x)),
    ) ||
    target.point.some((x) => !Number.isFinite(x)) ||
    !Number.isFinite(target.error_scale) ||
    target.error_scale < 0
  )
    throw new Error("Invalid four-month forecast inputs.");
  const medians = [0, 1, 2, 3].map((h) =>
    quantile(
      target.errors.map((e) => e[h]),
      0.5,
    ),
  );
  let state = seed;
  const paths = Array.from({ length: n }, () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    const errors =
      target.errors[Math.floor((state / 4294967296) * target.errors.length)];
    return target.point.map((v, h) => {
      const value = Math.max(
        0,
        v + (errors[h] - medians[h]) * target.error_scale,
      );
      return target.unit === "count" ? Math.floor(value + 0.5) : value;
    });
  });
  const summary = (values) => ({
    p025: quantile(values, 0.025),
    p10: quantile(values, 0.1),
    median: quantile(values, 0.5),
    p90: quantile(values, 0.9),
    p975: quantile(values, 0.975),
    mean: values.reduce((a, b) => a + b, 0) / values.length,
  });
  return {
    paths,
    forecast: [0, 1, 2, 3].map((h) => summary(paths.map((p) => p[h]))),
    total: summary(paths.map((p) => p.reduce((a, b) => a + b, 0))),
  };
}
export function thresholdStats(paths, horizon, threshold) {
  if (!paths.length || !Number.isInteger(horizon) || horizon < 0 || horizon > 3)
    throw new Error("Choose one of the four forecast months.");
  if (!Number.isFinite(threshold) || threshold < 0)
    throw new Error("Threshold must be a nonnegative number.");
  const values = paths.map((p) => p[horizon]);
  const probability =
    values.filter((v) => v > threshold).length / values.length;
  return {
    probability,
    mcError:
      1.96 * Math.sqrt((probability * (1 - probability)) / values.length),
    expectedExcess:
      values.reduce((s, v) => s + Math.max(0, v - threshold), 0) /
      values.length,
  };
}
