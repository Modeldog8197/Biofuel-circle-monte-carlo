import { thresholdStats } from "./model.js";
const $ = (id) => document.getElementById(id);
const number = (x) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(x);
const percent = (x) => `${(x * 100).toFixed(1)}%`;
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const month = (value) =>
  new Date(`${value}-01T00:00:00Z`).toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
let report,
  current,
  simulation,
  worker,
  requestId = 0,
  runSettings;
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function plot() {
  const history = report.history.data[current];
  const labels = [
    ...report.history.months,
    ...report.forecast_months.map(month),
  ];
  const rows = simulation.forecast;
  const values = [...history, ...rows.flatMap((r) => [r.p025, r.p975])];
  const W = 1040,
    H = 300,
    L = 68,
    R = 22,
    T = 15,
    B = 38,
    max = Math.max(...values) * 1.06 || 1;
  const x = (i) => L + (i / (labels.length - 1)) * (W - L - R),
    y = (v) => T + (1 - v / max) * (H - T - B);
  const line = (vals, start = 0) =>
    vals
      .map(
        (v, i) =>
          `${i ? "L" : "M"}${x(start + i).toFixed(2)},${y(v).toFixed(2)}`,
      )
      .join(" ");
  const area = (low, high) =>
    line([history.at(-1), ...high], history.length - 1) +
    " " +
    [...low]
      .reverse()
      .map(
        (v, i) => `L${x(labels.length - 1 - i).toFixed(2)},${y(v).toFixed(2)}`,
      )
      .join(" ") +
    ` L${x(history.length - 1)},${y(history.at(-1))} Z`;
  let grid = "";
  for (let i = 0; i <= 4; i++) {
    const v = (max * i) / 4;
    grid += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#e5e8e0"/><text x="${L - 10}" y="${y(v) + 4}" text-anchor="end">${number(v)}</text>`;
  }
  const ticks = [0, 12, 24, 36, history.length - 1, labels.length - 1];
  const tickText = ticks
    .map(
      (i) =>
        `<text x="${x(i)}" y="${H - 10}" text-anchor="${i === labels.length - 1 ? "end" : "middle"}">${escape(labels[i])}</text>`,
    )
    .join("");
  $("forecast-chart").innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escape(current)} history and four-month forecast. Values are available in the table below."><title>Observed history, median forecast and simulated intervals</title>${grid}<path d="${area(
      rows.map((r) => r.p025),
      rows.map((r) => r.p975),
    )}" fill="#edf1e5"/><path d="${area(
      rows.map((r) => r.p10),
      rows.map((r) => r.p90),
    )}" fill="#cfddc8"/><line x1="${x(history.length - 1)}" x2="${x(history.length - 1)}" y1="${T}" y2="${H - B}" stroke="#b7bfae" stroke-dasharray="4 5"/><path d="${line(history)}" fill="none" stroke="#3c6551" stroke-width="2.5"/><path d="${line([history.at(-1), ...rows.map((r) => r.median)], history.length - 1)}" fill="none" stroke="#a5693f" stroke-width="2.5" stroke-dasharray="5 4"/>${rows.map((r, i) => `<circle cx="${x(history.length + i)}" cy="${y(r.median)}" r="4" fill="#a5693f"><title>${month(report.forecast_months[i])}: ${number(r.median)}</title></circle>`).join("")}${tickText}</svg>`;
}
function renderThreshold() {
  const threshold = Number($("threshold").value),
    horizon = Number($("threshold-month").value);
  if (!$("threshold").value || !Number.isFinite(threshold) || threshold < 0) {
    $("threshold-result").textContent = "Enter a nonnegative threshold.";
    return;
  }
  const stats = thresholdStats(simulation.paths, horizon, threshold);
  $("threshold-result").innerHTML =
    `<strong>${percent(stats.probability)}</strong> above ${number(threshold)} ${escape(report.targets[current].unit)}.<br>Mean excess: <strong>${number(stats.expectedExcess)}</strong>. Simulation sampling error: about ±${(stats.mcError * 100).toFixed(2)} percentage points; model uncertainty is separate.`;
}
function render() {
  const target = report.targets[current],
    unit = target.unit,
    holdout = target.holdout,
    f = simulation.forecast;
  $("stats").innerHTML = [
    [
      "Latest observation",
      number(target.last),
      `${month(report.as_of)} · ${unit}`,
    ],
    [
      "Month 4 median",
      number(f[3].median),
      `${month(report.forecast_months[3])} · ${unit}`,
    ],
    [
      "Four-month total median",
      number(simulation.total.median),
      `80%: ${number(simulation.total.p10)}–${number(simulation.total.p90)}`,
    ],
    [
      "Evaluation MAE",
      number(holdout.mae),
      `Last-observation baseline: ${number(holdout.naive_mae)}`,
    ],
  ]
    .map(
      (r) =>
        `<div class="stat"><small>${r[0]}</small><strong>${r[1]}</strong><p>${r[2]}</p></div>`,
    )
    .join("");
  $("plot-caption").textContent = `${current} · ${unit} · ${target.model}`;
  $("forecast-rows").innerHTML = f
    .map(
      (r, h) =>
        `<tr><th scope="row">${month(report.forecast_months[h])}</th><td>${number(r.median)}</td><td>${number(r.p10)}–${number(r.p90)}</td><td>${number(r.p025)}–${number(r.p975)}</td><td>${percent(simulation.paths.filter((p) => p[h] > target.last).length / simulation.paths.length)}</td></tr>`,
    )
    .join("");
  const skill = holdout.skill;
  $("evaluation-note").textContent =
    `${target.model} has ${percent(Math.abs(skill))} ${skill >= 0 ? "lower" : "higher"} MAE than the last-observation baseline on later months. The nominal 80% bands covered ${percent(holdout.coverage80)} of evaluation outcomes. ${holdout.coverage80 < 0.7 ? "Coverage is low: these ranges should not be treated as calibrated planning guarantees." : "The evaluation sample is too small to establish reliable probability calibration."}`;
  $("model-rows").innerHTML = target.development
    .map(
      (r) =>
        `<tr><td>${escape(r.model)}</td><td>${number(r.mae)} ${unit}</td><td class="selected">${r.model === target.model ? "Selected" : "—"}</td></tr>`,
    )
    .join("");
  $("horizon-rows").innerHTML = target.by_horizon
    .map(
      (r, h) =>
        `<tr><td>${h + 1} month${h ? "s" : ""}</td><td>${number(r.mae)}</td><td>${number(r.naive_mae)}</td><td>${percent(r.coverage80)}</td></tr>`,
    )
    .join("");
  $("audit-rows").innerHTML = target.holdout_predictions
    .map(
      (r) =>
        `<tr><td>${report.history.months[r.origin_index - 1]}</td><td>${report.history.months[r.origin_index + r.horizon - 1]}</td><td>${number(r.actual)}</td><td>${number(r.forecast)}</td><td>${number(r.naive)}</td></tr>`,
    )
    .join("");
  $("association-rows").innerHTML = target.associations
    .map(
      (r) =>
        `<tr><td>${escape(r.metric)}</td><td>${r.lag} month${r.lag ? "" : "s"}</td><td>${r.r.toFixed(3)}</td><td>${r.n}</td></tr>`,
    )
    .join("");
  plot();
  renderThreshold();
}
function run() {
  const seed = Number($("seed").value),
    n = Number($("paths").value);
  if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) {
    $("error").hidden = false;
    $("error").textContent = "Use a whole-number seed from 0 to 4,294,967,295.";
    return;
  }
  current = $("metric").value;
  const id = ++requestId;
  runSettings = { seed, n };
  $("run").disabled = true;
  $("export-csv").disabled = true;
  $("export-json").disabled = true;
  $("status").textContent = "Simulating four-month paths…";
  $("error").hidden = true;
  worker.postMessage({ id, target: report.targets[current], n, seed });
}
$("controls").addEventListener("submit", (e) => {
  e.preventDefault();
  run();
});
$("metric").addEventListener("change", () => {
  $("threshold").value = report.targets[$("metric").value].last;
  run();
});
$("threshold").addEventListener("input", () => simulation && renderThreshold());
$("threshold-month").addEventListener(
  "change",
  () => simulation && renderThreshold(),
);
$("export-csv").addEventListener("click", () => {
  const rows = [
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
  ];
  for (const [name, t] of Object.entries(report.targets)) {
    const fs = name === current ? simulation.forecast : t.forecast;
    fs.forEach((f, i) =>
      rows.push([
        name,
        t.unit,
        report.forecast_months[i],
        t.model,
        f.p025,
        f.p10,
        f.median,
        f.p90,
        f.p975,
        f.mean,
        report.as_of,
        name === current ? runSettings.seed : report.seed,
        name === current ? simulation.paths.length : report.paths,
      ]),
    );
  }
  download(
    "biofuel-four-month-forecast.csv",
    rows
      .map((r) =>
        r.map((c) => '"' + String(c).replaceAll('"', '""') + '"').join(","),
      )
      .join("\n"),
    "text/csv",
  );
});
$("export-json").addEventListener("click", () =>
  download(
    "biofuel-forecast-report.json",
    JSON.stringify(
      {
        ...report,
        browser_run: {
          metric: current,
          seed: runSettings.seed,
          paths: simulation.paths.length,
          forecast: simulation.forecast,
          total: simulation.total,
        },
      },
      null,
      2,
    ),
    "application/json",
  ),
);
async function init() {
  try {
    const response = await fetch("./forecast_report.json");
    if (!response.ok)
      throw new Error("The published forecast report could not be loaded.");
    report = await response.json();
    $("data-line").textContent =
      `${report.history.months.length} monthly observations · ${report.quality.length} metrics · Four-month horizon`;
    $("asof").textContent = `Data through ${month(report.as_of)}`;
    $("evaluation-copy").textContent =
      `Model selection ends in ${month(report.development_end)}. Expanding forecasts over ${month(report.holdout_start)}–${month(report.as_of)} produce five four-month origins and 20 overlapping target–horizon observations per metric. Every evaluation interval uses only data available at its origin.`;
    $("threshold-month").innerHTML = report.forecast_months
      .map((m, h) => `<option value="${h}">${month(m)}</option>`)
      .join("");
    $("threshold").value = report.targets[$("metric").value].last;
    $("provenance").innerHTML =
      `<dt>Source</dt><dd>Platform BU data for analysis.xlsx · Trends data</dd><dt>Source comparison</dt><dd>Exported series checked against workbook cells</dd><dt>Units</dt><dd>Counts and MT, as defined in the original project; volume units require source-owner confirmation</dd><dt>Fingerprint</dt><dd>${report.data_sha256}</dd><dt>Simulation basis</dt><dd>Joint, level-scaled forecast-error vectors; seed ${report.seed}</dd>`;
    $("quality-rows").innerHTML = report.quality
      .filter((r) => r.missing || r.negative)
      .map(
        (r) =>
          `<tr><td>${escape(r.metric)}</td><td>${r.missing}/${r.observations}</td><td>${r.negative}</td></tr>`,
      )
      .join("");
    worker = new Worker("./worker.js", { type: "module" });
    worker.onmessage = ({ data }) => {
      if (data.id !== requestId) return;
      $("run").disabled = false;
      if (data.error) {
        $("error").textContent = data.error;
        $("error").hidden = false;
        $("status").textContent = "Simulation failed.";
        return;
      }
      simulation = data.result;
      render();
      $("export-csv").disabled = false;
      $("export-json").disabled = false;
      $("status").textContent =
        `${number(simulation.paths.length)} paths · four months · seed ${runSettings.seed}`;
    };
    worker.onerror = () => {
      $("run").disabled = false;
      $("error").hidden = false;
      $("error").textContent =
        "The simulation worker failed. Reload the page or use the published CSV report.";
    };
    run();
  } catch (error) {
    $("error").hidden = false;
    $("error").textContent =
      `${error.message} Serve this folder over HTTP; opening index.html directly cannot load the data or worker.`;
    $("run").disabled = true;
  }
}
init();
