import { quantile, summarizePaths } from "./model.js?v=2.1";
export const finite = (x) => typeof x === "number" && Number.isFinite(x);
export function differences(values) {
  return values.map((v, i) =>
    i && finite(v) && finite(values[i - 1]) ? v - values[i - 1] : null,
  );
}
export function growth(values) {
  return values.map((v, i) =>
    i && finite(v) && finite(values[i - 1]) && values[i - 1] !== 0
      ? (v / values[i - 1] - 1) * 100
      : null,
  );
}
export function indexed(values) {
  const first = values.find(finite);
  return values.map((v) =>
    finite(v) && first !== 0 ? (v / first) * 100 : null,
  );
}
export function movingAverage(values, n = 3) {
  return values.map((_, i) => {
    const window = values.slice(Math.max(0, i - n + 1), i + 1);
    return window.length === n && window.every(finite)
      ? window.reduce((a, b) => a + b, 0) / n
      : null;
  });
}
export function pairs(x, y, lag = 0, mode = "changes") {
  if (!Number.isInteger(lag) || lag < 0 || lag > 6 || x.length !== y.length)
    throw new Error("Use aligned series and lag 0–6.");
  const a = mode === "changes" ? differences(x) : x,
    b = mode === "changes" ? differences(y) : y;
  return b.flatMap((v, i) =>
    i >= lag && finite(v) && finite(a[i - lag])
      ? [{ x: a[i - lag], y: v, index: i, sourceIndex: i - lag }]
      : [],
  );
}
export function relationship(points) {
  if (points.length < 3) return { r: null, n: points.length, slope: null };
  const mx = points.reduce((s, p) => s + p.x, 0) / points.length,
    my = points.reduce((s, p) => s + p.y, 0) / points.length;
  const xx = points.reduce((s, p) => s + (p.x - mx) ** 2, 0),
    yy = points.reduce((s, p) => s + (p.y - my) ** 2, 0),
    xy = points.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
  return {
    r: xx && yy ? Math.max(-1, Math.min(1, xy / Math.sqrt(xx * yy))) : null,
    n: points.length,
    slope: xx ? xy / xx : null,
    intercept: xx ? my - (xy / xx) * mx : null,
  };
}
export function rankedDrivers(data, target, lag = 0, mode = "changes") {
  return Object.keys(data)
    .filter((k) => k !== target)
    .map((metric) => ({
      metric,
      ...relationship(pairs(data[metric], data[target], lag, mode)),
    }))
    .filter((r) => r.r !== null && r.n >= 12)
    .sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
}
export function histogram(values, bins = 30) {
  if (!values.length || values.some((v) => !finite(v)))
    throw new Error("Histogram needs finite values.");
  const min = Math.min(...values),
    max = Math.max(...values),
    width =
      max === min ? Math.max(1, Math.abs(min) * 0.05) : (max - min) / bins;
  const start = max === min ? min - width / 2 : min,
    counts = Array(max === min ? 1 : bins).fill(0);
  for (const v of values)
    counts[Math.min(counts.length - 1, Math.floor((v - start) / width))]++;
  return counts.map((count, i) => ({
    low: start + i * width,
    high: start + (i + 1) * width,
    count,
    probability: count / values.length,
  }));
}
export function survival(values) {
  const sorted = [...values].sort((a, b) => a - b),
    rows = [];
  for (let i = 0; i < sorted.length;) {
    let end = i + 1;
    while (end < sorted.length && sorted[end] === sorted[i]) end++;
    rows.push({
      threshold: sorted[i],
      probability: (sorted.length - end) / sorted.length,
    });
    i = end;
  }
  return rows;
}
export function cumulative(paths) {
  return paths.map((p) => {
    let sum = 0;
    return p.map((v) => (sum += v));
  });
}
export function centralPaths(paths, limit = 24) {
  const ranges = [0, 1, 2, 3].map((h) => [
    quantile(
      paths.map((p) => p[h]),
      0.1,
    ),
    quantile(
      paths.map((p) => p[h]),
      0.9,
    ),
  ]);
  const unique = new Map();
  for (const p of paths)
    if (p.every((v, h) => v >= ranges[h][0] && v <= ranges[h][1]))
      unique.set(JSON.stringify(p), p);
  return [...unique.values()].slice(0, limit);
}
export function scenarioPaths(
  paths,
  { unit, response, growthPct = 0, drivers = {}, pattern = "persistent" },
) {
  if (
    !finite(growthPct) ||
    growthPct < -50 ||
    growthPct > 50 ||
    !["persistent", "first"].includes(pattern)
  )
    throw new Error("Invalid scenario assumptions.");
  const offset = response.drivers.reduce((sum, d) => {
    const pct = drivers[d.metric] ?? 0;
    if (!finite(pct) || pct < -50 || pct > 50)
      throw new Error("Driver changes must be between -50% and 50%.");
    return sum + (d.coefficient * d.last * pct) / 100;
  }, 0);
  const changed = paths.map((p) =>
    p.map((v, h) => {
      const out = Math.max(
        0,
        v * (1 + growthPct / 100) ** (h + 1) +
          (pattern === "first" && h ? 0 : offset),
      );
      return unit === "count" ? Math.floor(out + 0.5) : out;
    }),
  );
  return { ...summarizePaths(changed), offset };
}
