import { quantile, thresholdStats } from "./model.js?v=2.1";
import {
  indexed,
  growth,
  movingAverage,
  pairs,
  relationship,
  rankedDrivers,
  histogram,
  survival,
  centralPaths,
} from "./analysis.js?v=2.1";
import {
  lineChart,
  barChart,
  scatterChart,
  heatmap,
  escape,
  fmt,
  palette,
} from "./charts.js?v=2.1";
const $ = (id) => document.getElementById(id),
  pct = (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : "—"),
  rtext = (v) => (v === null ? "—" : v.toFixed(3));
const month = (value) =>
  new Date(`${value}-01T00:00:00Z`).toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
const alias = {
  montecarlo: "forecast",
  drivers: "relationships",
  executive: "summary",
  methods: "evaluation",
};
let report,
  targets,
  results,
  current,
  worker,
  requestId = 0,
  pending,
  runSettings,
  view = "fan",
  scenarioResults,
  scenarioSettings,
  scenarioId = 0,
  snapshots = [];
const names = () => Object.keys(report.targets);
function download(name, content, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([content], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const csv = (rows) =>
  rows
    .map((row) =>
      row
        .map((cell) => '"' + String(cell ?? "").replaceAll('"', '""') + '"')
        .join(","),
    )
    .join("\n") + "\n";
function panel() {
  const hash = location.hash.slice(1);
  return (
    alias[hash] ??
    (document.getElementById(hash)?.classList.contains("tool-panel")
      ? hash
      : "forecast")
  );
}
function navigate() {
  const active = panel();
  document
    .querySelectorAll(".tool-panel")
    .forEach((p) => (p.hidden = p.id !== active));
  document.querySelectorAll(".workspace-nav a").forEach((a) => {
    const selected = a.getAttribute("href") === "#" + active;
    a.setAttribute("aria-selected", String(selected));
    a.tabIndex = selected ? 0 : -1;
  });
  if (results) renderPanel(active);
}
function openPanel(id) {
  if (panel() === id) renderPanel(id);
  else location.hash = id;
}
window.addEventListener("hashchange", navigate);
document.querySelector(".workspace-nav").addEventListener("keydown", (e) => {
  if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
  e.preventDefault();
  const tabs = [...document.querySelectorAll(".workspace-nav a")],
    i = tabs.indexOf(document.activeElement),
    next =
      tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
  next.focus();
  location.hash = next.hash;
});
function effectiveTargets(mode) {
  return Object.fromEntries(
    names().map((name) => {
      const base = report.targets[name],
        model = mode === "selected" ? base.model : mode;
      return [name, { ...base, ...base.alternatives[model], model }];
    }),
  );
}
function run() {
  const seed = Number($("seed").value),
    n = Number($("paths").value);
  if (
    !$("seed").value ||
    !Number.isInteger(seed) ||
    seed < 0 ||
    seed > 4294967295
  ) {
    showError("Use an unsigned whole-number seed.");
    return;
  }
  const id = ++requestId;
  pending = {
    targets: effectiveTargets($("model-select").value),
    settings: { seed, n, model: $("model-select").value },
    id,
  };
  $("run").disabled = true;
  for (const id of ["export-csv", "export-json", "export-paths", "export-svg"])
    $(id).disabled = true;
  $("status").textContent = "Simulating four-month paths for all targets…";
  $("error").hidden = true;
  worker.postMessage({ op: "simulate", id, targets: pending.targets, n, seed });
}
function showError(message) {
  $("error").hidden = false;
  $("error").textContent = message;
}
function renderForecast() {
  const target = targets[current],
    s = results[current],
    h = target.holdout,
    unit = target.unit;
  $("forecast-context").textContent = `${current} · ${target.model} · ${unit}`;
  $("stats").innerHTML = [
    [
      "Latest observation",
      fmt(target.last),
      `${month(report.as_of)} · ${unit}`,
    ],
    [
      "Month 4 median",
      fmt(s.forecast[3].median),
      `${month(report.forecast_months[3])} · ${unit}`,
    ],
    [
      "Four-month total median",
      fmt(s.total.median),
      `80%: ${fmt(s.total.p10)}–${fmt(s.total.p90)}`,
    ],
    ["Evaluation MAE", fmt(h.mae), `Naive baseline: ${fmt(h.naive_mae)}`],
  ]
    .map(
      ([label, value, detail]) =>
        `<div class="stat"><small>${label}</small><strong>${value}</strong><p>${detail}</p></div>`,
    )
    .join("");
  $("plot-caption").textContent = `${current} · ${unit}`;
  const flat = Math.max(...target.point) - Math.min(...target.point) < 1e-6;
  $("model-explanation").textContent = flat
    ? `${target.model} has a flat point forecast. The uncertainty and simulated paths still vary across months; no extra trend is imposed.`
    : `${target.model} sets the point forecast. Sample paths show how outcomes vary around it.`;
  $("forecast-rows").innerHTML = s.forecast
    .map(
      (f, i) =>
        `<tr><th scope="row">${month(report.forecast_months[i])}</th><td>${fmt(f.median)}</td><td>${fmt(f.p10)}–${fmt(f.p90)}</td><td>${fmt(f.p025)}–${fmt(f.p975)}</td><td>${pct(s.paths.filter((p) => p[i] > target.last).length / s.paths.length)}</td></tr>`,
    )
    .join("");
  drawForecastView();
  renderThreshold();
}
function drawForecastView() {
  document
    .querySelectorAll(".forecast-view")
    .forEach((el) => (el.hidden = el.dataset.view !== view));
  document
    .querySelectorAll("[data-view][role=tab]")
    .forEach((el) =>
      el.setAttribute("aria-selected", String(el.dataset.view === view)),
    );
  const s = results[current],
    target = targets[current];
  if (view === "fan") {
    const history = report.history.data[current].slice(
        -Number($("history-window").value),
      ),
      historyLabels = report.history.months.slice(-history.length),
      labels = [...historyLabels, ...report.forecast_months.map(month)],
      blank = history.map(() => null),
      last = history.at(-1),
      band = $("band-level").value === "80" ? ["p10", "p90"] : ["p025", "p975"];
    const sampled = $("show-paths").checked ? centralPaths(s.paths) : [];
    lineChart($("forecast-chart"), {
      title: `${current}: observed history and four forecast months`,
      labels,
      series: [
        {
          key: "history",
          name: "Observed",
          values: [...history, ...Array(4).fill(null)],
          color: "#263347",
        },
        {
          key: "median",
          name: "Median",
          values: [
            ...blank.slice(0, -1),
            last,
            ...s.forecast.map((f) => f.median),
          ],
          color: palette[0],
          dashed: true,
        },
        {
          key: "point",
          name: "Model point",
          values: [...blank.slice(0, -1), last, ...target.point],
          color: palette[1],
          dashed: true,
        },
      ],
      bands: [
        {
          name: `${$("band-level").value}% interval`,
          low: [
            ...blank.slice(0, -1),
            last,
            ...s.forecast.map((f) => f[band[0]]),
          ],
          high: [
            ...blank.slice(0, -1),
            last,
            ...s.forecast.map((f) => f[band[1]]),
          ],
          color: "#e2ebfb",
        },
      ],
      samples: sampled.map((p) => [...blank.slice(0, -1), last, ...p]),
      boundary: history.length - 1,
      onSelect: (i) => {
        if (i >= history.length) {
          $("distribution-month").value = String(i - history.length);
          $("threshold-month").value = String(i - history.length);
          renderThreshold();
        }
      },
    });
    $("path-note").textContent =
      `${sampled.length} distinct central paths shown for readability (each month within its 80% band). All ${fmt(s.paths.length)} paths contribute to the tables, distributions and probabilities. History defaults to the latest 12 months so the four-month window has room.`;
  } else if (view === "distribution") {
    const values = outcomeValues(),
      rows = histogram(values, Number($("bins").value));
    barChart($("distribution-chart"), {
      title: "Simulated outcome distribution",
      rows: rows.map((r, i) => ({
        label: `${fmt(r.low)}–${fmt(r.high)} ${target.unit}`,
        short: i % 5 === 0 ? fmt((r.low + r.high) / 2) : "",
        value: r.probability,
        detail: `${fmt(r.count)} paths (${pct(r.probability)})`,
        color: palette[0],
      })),
      yformat: pct,
      onSelect: (i) => {
        $("threshold-month").value = $("distribution-month").value;
        $("threshold").value = Math.max(
          0,
          (rows[i].low + rows[i].high) / 2,
        ).toFixed(target.unit === "count" ? 0 : 2);
        renderThreshold();
      },
    });
    $("distribution-stats").textContent =
      `P10 ${fmt(quantile(values, 0.1))} · Median ${fmt(quantile(values, 0.5))} · P90 ${fmt(quantile(values, 0.9))}`;
  } else {
    const rows = survival(outcomeValues());
    lineChart($("probability-chart"), {
      title: "Probability of exceeding the chosen outcome threshold",
      labels: rows.map((r) => fmt(r.threshold)),
      xs: rows.map((r) => r.threshold),
      series: [
        {
          key: "probability",
          name: "P(outcome > threshold)",
          values: rows.map((r) => r.probability),
          color: palette[0],
        },
      ],
      yformat: pct,
      zero: true,
      step: true,
      onSelect: (i) => {
        $("threshold-month").value = $("distribution-month").value;
        $("threshold").value = rows[i].threshold;
        $("threshold-month").value = $("distribution-month").value;
        renderThreshold();
      },
    });
  }
}
function outcomeValues() {
  const h = $("distribution-month").value;
  return results[current].paths.map((p) =>
    h === "total" ? p.reduce((a, b) => a + b, 0) : p[Number(h)],
  );
}
function renderThreshold() {
  if (!results) return;
  const value = Number($("threshold").value),
    h = $("threshold-month").value;
  if (!$("threshold").value || !Number.isFinite(value) || value < 0) {
    $("threshold-result").textContent = "Enter a nonnegative threshold.";
    return;
  }
  const paths = results[current].paths;
  let stats;
  if (h === "total") {
    const vals = paths.map((p) => p.reduce((a, b) => a + b, 0)),
      probability = vals.filter((v) => v > value).length / vals.length;
    stats = {
      probability,
      expectedExcess:
        vals.reduce((s, v) => s + Math.max(0, v - value), 0) / vals.length,
      mcError:
        1.96 * Math.sqrt((probability * (1 - probability)) / vals.length),
    };
  } else stats = thresholdStats(paths, Number(h), value);
  $("threshold-result").innerHTML =
    `<strong>${pct(stats.probability)}</strong> above ${fmt(value)} ${escape(targets[current].unit)}.<br>Mean excess: <b>${fmt(stats.expectedExcess)}</b>.<br>Monte Carlo sampling error: about ±${(stats.mcError * 100).toFixed(2)} percentage points. Model error is separate.`;
}
function renderOverview() {
  $("data-line").textContent =
    `${report.history.months.length} months · ${report.quality.length} metrics · ${report.history.months[0]}–${report.history.months.at(-1)} · Source workbook preserved`;
  $("overview-stats").innerHTML = names()
    .map((name, i) => {
      const y = report.history.data[name],
        max = Math.max(...y),
        min = Math.min(...y),
        spark = y
          .map(
            (v, j) =>
              `${j ? "L" : "M"}${(j / (y.length - 1)) * 250},${40 - ((v - min) / (max - min || 1)) * 35}`,
          )
          .join(" ");
      return `<button class="overview-card" type="button" data-metric="${escape(name)}"><small>${escape(name)}</small><strong>${fmt(y.at(-1))}</strong><p>${pct(y.at(-1) / y.at(-2) - 1)} vs previous month</p><svg viewBox="0 0 250 44" role="img" aria-label="${escape(name)} historical sparkline"><path d="${spark}" fill="none" stroke="${palette[i]}" stroke-width="2"/></svg></button>`;
    })
    .join("");
  $("overview-stats")
    .querySelectorAll("button")
    .forEach(
      (b) =>
        (b.onclick = () => {
          $("metric").value = b.dataset.metric;
          selectMetric();
          openPanel("forecast");
        }),
    );
  lineChart($("overview-chart"), {
    title: "All targets indexed to 100",
    labels: report.history.months,
    series: names().map((name, i) => ({
      key: name,
      name,
      values: indexed(report.history.data[name]),
      color: palette[i],
    })),
  });
  $("overview-rows").innerHTML = Object.entries(report.history.data)
    .map(
      ([name, y]) =>
        `<tr><td>${escape(name)}</td><td>${fmt(y.at(-1))}</td><td>${fmt(y.at(-2))}</td><td>${typeof y.at(-1) === "number" && typeof y.at(-2) === "number" && y.at(-2) !== 0 ? pct(y.at(-1) / y.at(-2) - 1) : "—"}</td><td>${y.filter((v) => v !== null).length}/${y.length}</td></tr>`,
    )
    .join("");
}
function renderTrends() {
  const mode = $("trend-view").value,
    keys = mode === "raw" ? [$("trend-metric").value] : names(),
    window = Number($("trend-window").value),
    labels = report.history.months.slice(-window);
  const series = keys.map((key, i) => {
    let values =
      mode === "raw"
        ? report.history.data[key]
        : mode === "growth"
          ? growth(report.history.data[key])
          : indexed(report.history.data[key]);
    if ($("smooth-trend").checked) values = movingAverage(values);
    return { key, name: key, values: values.slice(-window), color: palette[i] };
  });
  lineChart($("trend-chart"), {
    title: `Historical ${mode} comparison`,
    labels,
    series,
    yformat: mode === "growth" ? (v) => `${fmt(v, 1)}%` : fmt,
  });
  $("trend-note").textContent =
    mode === "raw"
      ? "Raw mode shows one metric so counts and volume are never overlaid on the same numerical axis."
      : mode === "growth"
        ? "Monthly changes are percentage changes against the previous observed month. Zero denominators and missing pairs remain gaps."
        : "Each target is indexed to its own first valid observation; this compares relative trajectories rather than numerical units.";
  $("trend-head").innerHTML =
    `<tr><th>Month</th>${keys.map((k) => `<th>${escape(k)}</th>`).join("")}</tr>`;
  $("trend-rows").innerHTML = labels
    .map(
      (label, i) =>
        `<tr><td>${label}</td>${series.map((s) => `<td>${fmt(s.values[i], mode === "growth" ? 1 : 0)}</td>`).join("")}</tr>`,
    )
    .join("");
}
function renderRelationships() {
  const data = report.history.data,
    target = $("relation-target").value,
    driver = $("driver").value,
    basis = $("relation-basis").value,
    ranked = rankedDrivers(data, target, 0, basis).slice(0, 10);
  barChart($("driver-chart"), {
    title: "Contemporaneous driver associations",
    horizontal: true,
    rows: ranked.map((r, i) => ({
      label: r.metric,
      short: String(i + 1),
      value: r.r,
      color: r.r >= 0 ? palette[0] : palette[1],
      detail: `Rank ${i + 1} · ${r.n} pairs · tap to inspect`,
    })),
    yformat: (v) => v.toFixed(2),
    onSelect: (i) => {
      $("driver").value = ranked[i].metric;
      renderRelationships();
    },
  });
  const points = pairs(data[driver], data[target], 0, basis),
    stats = relationship(points);
  scatterChart($("driver-scatter"), {
    title: `${driver} versus ${target}`,
    points: points.map((p) => ({
      ...p,
      label: report.history.months[p.index],
    })),
    xLabel: driver,
    yLabel: target,
  });
  $("scatter-title").textContent = `${driver} ↔ ${target}`;
  $("scatter-stats").textContent =
    `Pearson r ${rtext(stats.r)} · ${stats.n} pairs · ${basis === "changes" ? "monthly differences" : "raw levels; common trends may inflate correlations"} · Missing pairs excluded.`;
  const keyMetrics = [
      ...names(),
      ...Object.keys(data).filter((k) => !names().includes(k)),
    ],
    keys = keyMetrics.slice(0, Number($("matrix-size").value));
  heatmap($("correlation-matrix"), {
    title: "Computed Pearson correlations",
    rows: keys,
    columns: keys,
    cells: keys.map((a) =>
      keys.map((b) => relationship(pairs(data[a], data[b], 0, basis))),
    ),
    onSelect: (i, j) => {
      if (i !== j) {
        $("driver").value = keys[i];
        $("relation-target").value = keys[j];
        renderRelationships();
      }
    },
  });
}
function renderLags() {
  const data = report.history.data,
    driver = $("lag-driver").value,
    lag = Number($("lag").value),
    basis = $("lag-basis").value,
    ranked = rankedDrivers(data, current, lag, basis),
    drivers = [
      ...new Set([driver, ...ranked.slice(0, 5).map((r) => r.metric)]),
    ],
    labels = Array.from({ length: 7 }, (_, i) => `Lag ${i}`);
  lineChart($("lag-chart"), {
    title: `Lag relationships for ${current}`,
    labels,
    series: drivers.map((name, i) => ({
      key: name,
      name,
      values: labels.map(
        (_, lag) =>
          relationship(pairs(data[name], data[current], lag, basis)).r,
      ),
      color: palette[i],
    })),
    yformat: (v) => v.toFixed(2),
    onSelect: (i) => {
      $("lag").value = String(i);
      renderLags();
    },
  });
  const points = pairs(data[driver], data[current], lag, basis),
    stats = relationship(points);
  scatterChart($("lag-scatter"), {
    title: `${driver} at lag ${lag}`,
    points: points.map((p) => ({
      ...p,
      label: `Driver ${report.history.months[p.sourceIndex]} → outcome ${report.history.months[p.index]}`,
    })),
    xLabel: driver,
    yLabel: current,
  });
  $("lag-stats").textContent =
    `${driver} → ${current} · lag ${lag} · r ${rtext(stats.r)} · ${stats.n} observed pairs.`;
  const matrixDrivers = ranked.slice(0, 10).map((r) => r.metric);
  heatmap($("lag-matrix"), {
    title: "Driver and target changes across lags",
    rows: matrixDrivers,
    columns: labels,
    cells: matrixDrivers.map((name) =>
      labels.map((_, lag) =>
        relationship(pairs(data[name], data[current], lag, basis)),
      ),
    ),
    onSelect: (i, j) => {
      $("lag-driver").value = matrixDrivers[i];
      $("lag").value = String(j);
      renderLags();
    },
  });
  $("lag-rows").innerHTML = ranked
    .slice(0, 10)
    .map(
      (r) =>
        `<tr><td>${escape(r.metric)}</td><td>${rtext(r.r)}</td><td>${r.n}</td></tr>`,
    )
    .join("");
}
function getScenarioSettings() {
  return {
    growthPct: Number($("scenario-growth").value),
    pattern: $("scenario-pattern").value,
    drivers: Object.fromEntries(
      [...document.querySelectorAll("[data-driver]")].map((input) => [
        input.dataset.driver,
        Number(input.value),
      ]),
    ),
  };
}
function requestScenario() {
  if (!results || $("run").disabled) return;
  scenarioId++;
  scenarioSettings = getScenarioSettings();
  $("scenario-status").textContent = "Computing all four scenario outcomes…";
  $("save-scenario").disabled = true;
  $("export-scenario").disabled = true;
  worker.postMessage({
    op: "scenario",
    id: scenarioId,
    baseId: requestId,
    settings: scenarioSettings,
  });
}
function renderScenario() {
  if (!scenarioResults) {
    requestScenario();
    return;
  }
  const base = results[current],
    s = scenarioResults[current],
    labels = report.forecast_months.map(month);
  lineChart($("scenario-chart"), {
    title: `${current}: baseline versus scenario`,
    labels,
    series: [
      {
        key: "base",
        name: "Baseline median",
        values: base.forecast.map((f) => f.median),
        color: palette[0],
      },
      {
        key: "scenario",
        name: "Scenario median",
        values: s.forecast.map((f) => f.median),
        color: palette[1],
      },
    ],
    bands: [
      {
        name: "Scenario 80%",
        low: s.forecast.map((f) => f.p10),
        high: s.forecast.map((f) => f.p90),
        color: "#f5ead7",
      },
    ],
  });
  $("scenario-fit").textContent =
    `Descriptive response fit through ${month(targets[current].scenario_response.fit_end)} · ${targets[current].scenario_response.pairs} complete monthly-change pairs · implied offset ${fmt(s.offset)} ${targets[current].unit}. Future inputs are user assumptions; no causal accuracy is claimed.`;
  $("scenario-rows").innerHTML = names()
    .map((name) => {
      const a = results[name].forecast[3],
        b = scenarioResults[name].forecast[3];
      return `<tr><td>${escape(name)}</td><td>${fmt(a.median)}</td><td>${fmt(b.median)}</td><td>${a.median ? pct(b.median / a.median - 1) : "—"}</td><td>${fmt(b.p10)}–${fmt(b.p90)}</td></tr>`;
    })
    .join("");
  $("saved-scenarios").textContent = snapshots.length
    ? snapshots
        .map(
          (s, i) =>
            `Comparison ${i + 1}: growth ${s.assumptions.growthPct}%/month; ${
              Object.entries(s.assumptions.drivers)
                .filter(([, v]) => v)
                .map(([k, v]) => `${k} ${v}%`)
                .join(", ") || "no driver offset"
            }; ${s.settings.model}; seed ${s.settings.seed}`,
        )
        .join(" · ")
    : "No comparisons saved. Up to three can be kept in this session.";
  if (snapshots.length)
    lineChart($("snapshot-chart"), {
      title: `Saved comparisons for ${current}`,
      labels,
      series: [
        {
          key: "baseline",
          name: "Active baseline",
          values: base.forecast.map((f) => f.median),
          color: palette[0],
        },
        ...snapshots.map((snap, i) => ({
          key: `snapshot-${i}`,
          name: `Comparison ${i + 1}`,
          values: snap.forecasts[current].map((f) => f.median),
          color: palette[i + 1],
        })),
      ],
    });
  else $("snapshot-chart").innerHTML = "";
}
function renderEvidence() {
  const t = targets[current],
    h = t.holdout;
  $("evaluation-copy").textContent =
    `${current} · model ${t.model} · selection cutoff ${month(report.development_end)} · evaluation ${month(report.holdout_start)}–${month(report.as_of)}. Five four-month origins overlap.`;
  $("evaluation-note").textContent =
    `${t.model} has ${pct(Math.abs(h.skill))} ${h.skill >= 0 ? "lower" : "higher"} MAE than the naive baseline. Nominal 80% intervals covered ${pct(h.coverage80)} of evaluation outcomes. ${h.coverage80 < 0.7 ? "Coverage is weak; do not treat these bands as calibrated planning guarantees." : "The sample is small and overlapping; reliable calibration is not established."} ${runSettings.model === "selected" ? "The selection used development data only." : "This is a manually selected model comparison, not a new validated selection."}`;
  $("model-rows").innerHTML = t.development
    .map(
      (r) =>
        `<tr><td>${escape(r.model)}</td><td>${fmt(r.mae)}</td><td>${fmt(t.alternatives[r.model].holdout.mae)}</td><td>${r.model === t.model ? "Active" : r.model === report.targets[current].model ? "Development winner" : "—"}</td></tr>`,
    )
    .join("");
  $("horizon-rows").innerHTML = t.by_horizon
    .map(
      (r, i) =>
        `<tr><td>${i + 1} month${i ? "s" : ""}</td><td>${fmt(r.mae)}</td><td>${fmt(r.naive_mae)}</td><td>${pct(r.coverage80)}</td></tr>`,
    )
    .join("");
  $("audit-rows").innerHTML = t.holdout_predictions
    .map(
      (r) =>
        `<tr><td>${report.history.months[r.origin_index - 1]}</td><td>${report.history.months[r.origin_index + r.horizon - 1]}</td><td>${fmt(r.actual)}</td><td>${fmt(r.forecast)}</td><td>${fmt(r.naive)}</td></tr>`,
    )
    .join("");
  $("provenance").innerHTML = [
    ["Source", "Platform BU data for analysis.xlsx · Trends data"],
    [
      "Calendar",
      `${report.history.months.length} months, ${report.history.months[0]}–${report.history.months.at(-1)}`,
    ],
    [
      "Units",
      "Counts and MT as inherited from the original project; confirm volume units with the source owner",
    ],
    [
      "Validation",
      "Workbook cells match the exported source series; missing auxiliary observations stay null",
    ],
    ["Fingerprint", report.data_sha256],
    [
      "Run",
      `${runSettings.n} paths · seed ${runSettings.seed} · ${runSettings.model}`,
    ],
  ]
    .map(([k, v]) => `<dt>${k}</dt><dd>${escape(v)}</dd>`)
    .join("");
  $("quality-rows").innerHTML = report.quality
    .filter((r) => r.missing || r.negative)
    .map(
      (r) =>
        `<tr><td>${escape(r.metric)}</td><td>${r.missing}/${r.observations}</td><td>${r.negative}</td></tr>`,
    )
    .join("");
}
function summaryText() {
  return (
    `# Biofuelcircle monthly research summary\n\nData through ${month(report.as_of)}. Forecast window: ${report.forecast_months.map(month).join(", ")}.\n${runSettings.n} paths, seed ${runSettings.seed}, model mode ${runSettings.model}.\n\n` +
    names()
      .map((name) => {
        const t = targets[name],
          s = results[name],
          y = report.history.data[name];
        return `## ${name}\nLatest ${fmt(t.last)} ${t.unit}; month-over-month ${pct(y.at(-1) / y.at(-2) - 1)}.\nMonth-four median ${fmt(s.forecast[3].median)}, 80% band ${fmt(s.forecast[3].p10)}–${fmt(s.forecast[3].p90)}. Four-month total median ${fmt(s.total.median)}.\nModel ${t.model}; later MAE ${fmt(t.holdout.mae)}, naive MAE ${fmt(t.holdout.naive_mae)}. Nominal 80% coverage ${pct(t.holdout.coverage80)}.\n`;
      })
      .join("\n") +
    `\n## Limitations\nThe snapshot is not current. Evaluation origins overlap, the sample is small, and uncertainty bands under-cover several outcomes. Associations and scenario offsets do not establish causation. No cross-target total is computed.\n\nSource SHA-256: ${report.data_sha256}\n`
  );
}
function renderSummary() {
  $("summary-content").innerHTML =
    `<div class="panel"><h2>Active four-month outlook</h2><div class="table-scroll"><table><thead><tr><th>Target</th><th>Model</th><th>Month-four median</th><th>Four-month total median</th><th>MAE vs naive</th><th>80% coverage</th></tr></thead><tbody>${names()
      .map((name) => {
        const t = targets[name],
          s = results[name];
        return `<tr><td>${escape(name)}</td><td>${escape(t.model)}</td><td>${fmt(s.forecast[3].median)}</td><td>${fmt(s.total.median)}</td><td>${fmt(t.holdout.mae)} / ${fmt(t.holdout.naive_mae)}</td><td>${pct(t.holdout.coverage80)}</td></tr>`;
      })
      .join(
        "",
      )}</tbody></table></div></div><div class="summary-grid"><article class="panel"><h2>Measured performance</h2><p>${names().filter((name) => targets[name].holdout.skill > 0).length} of four active models beat the last-observation baseline on later evaluation MAE. Model comparisons after viewing this period remain exploratory.</p><p>The dashboard shows every evaluation forecast and separates the model point from the simulated median.</p></article><article class="panel"><h2>Planning limitations</h2><p>The snapshot ends in April 2026. Intervals under-cover several metrics; nominal percentages are not guarantees. Scenario inputs are assumptions and driver effects are descriptive associations.</p><p>Use current source data, verify units, and collect new forecast origins before relying on these numbers for decisions.</p></article></div>`;
}
function renderPanel(id) {
  (
    ({
      forecast: renderForecast,
      overview: renderOverview,
      trends: renderTrends,
      relationships: renderRelationships,
      lagged: renderLags,
      scenarios: renderScenario,
      summary: renderSummary,
      evaluation: renderEvidence,
    })[id] ?? renderForecast
  )();
}
function selectMetric() {
  current = $("metric").value;
  $("threshold").value = targets[current].last;
  $("relation-target").value = current;
  renderPanel(panel());
}
$("controls").onsubmit = (e) => {
  e.preventDefault();
  run();
};
$("metric").onchange = () => results && selectMetric();
$("model-select").onchange = () => report && run();
for (const id of [
  "history-window",
  "band-level",
  "show-paths",
  "distribution-month",
  "bins",
])
  $(id).onchange = () => {
    if (id === "distribution-month")
      $("threshold-month").value = $("distribution-month").value;
    if (results) {
      drawForecastView();
      renderThreshold();
    }
  };
document.querySelectorAll(".view-tabs button").forEach(
  (btn) =>
    (btn.onclick = () => {
      view = btn.dataset.view;
      drawForecastView();
    }),
);
$("threshold").oninput = renderThreshold;
$("threshold-month").onchange = renderThreshold;
for (const id of ["trend-view", "trend-metric", "trend-window", "smooth-trend"])
  $(id).onchange = () => results && renderTrends();
for (const id of ["relation-target", "driver", "relation-basis", "matrix-size"])
  $(id).onchange = () => results && renderRelationships();
for (const id of ["lag-driver", "lag", "lag-basis"])
  $(id).onchange = () => results && renderLags();
$("scenario-growth").oninput = () =>
  ($("growth-label").textContent = `${$("scenario-growth").value}%`);
$("scenario-growth").onchange = requestScenario;
$("scenario-pattern").onchange = requestScenario;
document.querySelectorAll("[data-preset]").forEach(
  (btn) =>
    (btn.onclick = () => {
      document.querySelectorAll("[data-driver]").forEach((input) => {
        input.value = 0;
        input.previousElementSibling.value = "0%";
      });
      $("scenario-growth").value = 0;
      $("growth-label").textContent = "0%";
      const p = btn.dataset.preset,
        inputs = [...document.querySelectorAll("[data-driver]")];
      if (p === "platform10" || p === "platform20")
        inputs[0].value = p === "platform10" ? 10 : 20;
      if (p === "seller10") inputs[1].value = 10;
      if (p === "interest20") inputs[2].value = 20;
      inputs.forEach(
        (input) => (input.previousElementSibling.value = `${input.value}%`),
      );
      requestScenario();
    }),
);
$("save-scenario").onclick = () => {
  if (snapshots.length >= 3) {
    $("scenario-status").textContent =
      "Three comparisons are saved. Clear them to start a new set.";
    return;
  }
  snapshots.push({
    assumptions: structuredClone(scenarioSettings),
    settings: { ...runSettings },
    forecasts: Object.fromEntries(
      names().map((name) => [
        name,
        structuredClone(scenarioResults[name].forecast),
      ]),
    ),
  });
  renderScenario();
};
$("clear-scenarios").onclick = () => {
  snapshots = [];
  renderScenario();
};
$("export-csv").onclick = () =>
  download(
    "biofuel-four-month-forecast.csv",
    csv([
      [
        "metric",
        "unit",
        "month",
        "model",
        "p025",
        "p10",
        "median",
        "p90",
        "p975",
        "mean",
        "as_of",
        "seed",
        "paths",
      ],
      ...names().flatMap((name) =>
        results[name].forecast.map((f, i) => [
          name,
          targets[name].unit,
          report.forecast_months[i],
          targets[name].model,
          f.p025,
          f.p10,
          f.median,
          f.p90,
          f.p975,
          f.mean,
          report.as_of,
          runSettings.seed,
          runSettings.n,
        ]),
      ),
    ]),
  );
$("export-json").onclick = () =>
  download(
    "biofuel-forecast-report.json",
    JSON.stringify(
      {
        ...report,
        browser_run: {
          metric: current,
          ...runSettings,
          forecasts: Object.fromEntries(
            names().map((name) => [
              name,
              {
                model: targets[name].model,
                forecast: results[name].forecast,
                total: results[name].total,
              },
            ]),
          ),
        },
        scenario: scenarioResults
          ? {
              assumptions: scenarioSettings,
              results: Object.fromEntries(
                names().map((name) => [
                  name,
                  {
                    forecast: scenarioResults[name].forecast,
                    total: scenarioResults[name].total,
                    offset: scenarioResults[name].offset,
                  },
                ]),
              ),
            }
          : null,
        saved_comparisons: snapshots,
      },
      null,
      2,
    ),
    "application/json",
  );
$("export-paths").onclick = () =>
  download(
    "biofuel-simulated-paths.csv",
    csv([
      ["path", ...report.forecast_months, "total", "metric", "model", "seed"],
      ...results[current].paths.map((p, i) => [
        i + 1,
        ...p,
        p.reduce((a, b) => a + b, 0),
        current,
        targets[current].model,
        runSettings.seed,
      ]),
    ]),
  );
$("export-svg").onclick = () => {
  const id =
      view === "fan"
        ? "forecast-chart"
        : view === "distribution"
          ? "distribution-chart"
          : "probability-chart",
    svg = $(id).querySelector("svg").cloneNode(true);
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent =
    "text{font:11px monospace;fill:#65758d}.grid-line{stroke:#e6ebf2;stroke-width:1}";
  svg.prepend(style);
  download(
    "biofuel-chart.svg",
    new XMLSerializer().serializeToString(svg),
    "image/svg+xml",
  );
};
$("export-history").onclick = () => {
  const keys = Object.keys(report.history.data);
  download(
    "biofuel-history.csv",
    csv([
      ["month", ...keys],
      ...report.history.months.map((m, i) => [
        m,
        ...keys.map((k) => report.history.data[k][i]),
      ]),
    ]),
  );
};
$("export-scenario").onclick = () =>
  download(
    "biofuel-assumed-scenario.csv",
    csv([
      [
        "metric",
        "month",
        "baseline_median",
        "scenario_median",
        "scenario_p10",
        "scenario_p90",
        "assumed_monthly_growth_pct",
        "driver_changes",
        "pattern",
        "seed",
        "model",
      ],
      ...names().flatMap((name) =>
        scenarioResults[name].forecast.map((f, i) => [
          name,
          report.forecast_months[i],
          results[name].forecast[i].median,
          f.median,
          f.p10,
          f.p90,
          scenarioSettings.growthPct,
          JSON.stringify(scenarioSettings.drivers),
          scenarioSettings.pattern,
          runSettings.seed,
          targets[name].model,
        ]),
      ),
    ]),
  );
$("export-summary").onclick = () =>
  download("biofuel-research-summary.md", summaryText(), "text/markdown");
async function init() {
  try {
    const response = await fetch("./forecast_report.json?v=2.1");
    if (!response.ok) throw new Error("Could not load forecast_report.json.");
    report = await response.json();
    current = $("metric").value;
    $("asof").textContent = `Snapshot · ${month(report.as_of)}`;
    $("model-select").insertAdjacentHTML(
      "beforeend",
      report.targets[current].development
        .map((r) => `<option>${escape(r.model)}</option>`)
        .join(""),
    );
    const options = Object.keys(report.history.data)
      .map((name) => `<option>${escape(name)}</option>`)
      .join("");
    for (const id of [
      "trend-metric",
      "driver",
      "relation-target",
      "lag-driver",
    ])
      $(id).innerHTML = options;
    $("trend-metric").value = current;
    $("relation-target").value = current;
    $("driver").value = "Platform delivered Vol";
    $("lag-driver").value = "Platform delivered Vol";
    const monthOptions =
      report.forecast_months
        .map((m, h) => `<option value="${h}">${month(m)}</option>`)
        .join("") + '<option value="total">Four-month total</option>';
    for (const id of ["distribution-month", "threshold-month"])
      $(id).innerHTML = monthOptions;
    $("distribution-month").value = "3";
    $("threshold").value = report.targets[current].last;
    $("driver-sliders").innerHTML = report.targets[
      current
    ].scenario_response.drivers
      .map(
        (d, i) =>
          `<label>${escape(d.metric)}<output>0%</output><input type="range" data-driver="${escape(d.metric)}" min="-30" max="30" value="0" step="1"></label>`,
      )
      .join("");
    document.querySelectorAll("[data-driver]").forEach((input) => {
      input.oninput = () =>
        (input.previousElementSibling.value = `${input.value}%`);
      input.onchange = requestScenario;
    });
    worker = new Worker("./worker.js?v=2.1", { type: "module" });
    worker.onmessage = ({ data }) => {
      if (data.op === "scenario") {
        if (data.id !== scenarioId || data.baseId !== requestId) return;
        if (data.error) {
          showError(data.error);
          return;
        }
        scenarioResults = data.results;
        $("scenario-status").textContent =
          "Scenario computed from the active baseline.";
        $("save-scenario").disabled = false;
        $("export-scenario").disabled = false;
        if (panel() === "scenarios") renderScenario();
        return;
      }
      if (data.id !== requestId) return;
      $("run").disabled = false;
      if (data.error) {
        showError(data.error);
        $("status").textContent = "Simulation failed.";
        return;
      }
      results = data.results;
      targets = pending.targets;
      runSettings = pending.settings;
      scenarioResults = null;
      $("status").textContent =
        `${fmt(runSettings.n)} paths · four months · seed ${runSettings.seed}`;
      for (const id of [
        "export-csv",
        "export-json",
        "export-paths",
        "export-svg",
      ])
        $(id).disabled = false;
      renderPanel(panel());
      if (panel() !== "scenarios") requestScenario();
    };
    worker.onerror = () => {
      $("run").disabled = false;
      showError(
        "The simulation worker failed. Reload the site or serve this folder over HTTP.",
      );
    };
    navigate();
    run();
  } catch (error) {
    showError(`${error.message} Serve this folder over HTTP.`);
    $("run").disabled = true;
  }
}
init();
