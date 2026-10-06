/** Small SVG charts with inspection, keyboard navigation, legend toggles and drag zoom. */
export const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const fmt = (n, d = 0) =>
  Number.isFinite(n)
    ? new Intl.NumberFormat("en-IN", { maximumFractionDigits: d }).format(n)
    : "—";
export const palette = [
  "#2d64d5",
  "#b16c20",
  "#16847e",
  "#8d5ac1",
  "#ba4566",
  "#73813b",
];
const finite = (v) => typeof v === "number" && Number.isFinite(v);
function extent(values, zero = false) {
  let low = Math.min(...values),
    high = Math.max(...values);
  if (zero) {
    low = Math.min(0, low);
    high = Math.max(0, high);
  }
  const pad = (high - low || Math.abs(high) || 1) * 0.08;
  return [zero && low >= 0 ? 0 : low - pad, high + pad];
}
function frame(root, title, legend = "") {
  root.classList.add("interactive-chart");
  root.tabIndex = 0;
  root.setAttribute("role", "group");
  root.setAttribute(
    "aria-label",
    `${title}. Arrow keys inspect values; drag horizontally to zoom; Escape dismisses details.`,
  );
  root.innerHTML = `<div class="chart-toolbar">${legend}<button class="reset-zoom" type="button">Reset zoom</button></div><div class="plot-surface"></div><div class="chart-tooltip" role="status" aria-live="polite" hidden></div><p class="chart-hint">Hover or tap to inspect · drag to zoom · arrow keys to step</p>`;
  return root.querySelector(".plot-surface");
}
function tooltip(root, event, html) {
  const tip = root.querySelector(".chart-tooltip");
  tip.innerHTML = html;
  tip.hidden = false;
  const rect = root.getBoundingClientRect(),
    left = event ? event.clientX - rect.left : rect.width / 2;
  tip.style.left = `${Math.max(6, Math.min(left + 12, rect.width - Math.min(280, rect.width - 12) - 6))}px`;
  tip.style.top = `${Math.max(35, event ? event.clientY - rect.top - 80 : 70)}px`;
}
function bind(
  root,
  { indices, locate, inspect, select, redraw, canZoom = true },
) {
  let down = null,
    pinned = false,
    index = indices[0];
  const show = (i, event) => {
    index = i;
    inspect(i, event);
  };
  root.onpointermove = (e) => {
    if (!e.target.closest("svg") && !down) return;
    if (pinned && !down) return;
    show(locate(e), e);
  };
  root.onpointerleave = () => {
    if (!pinned && !down) root.querySelector(".chart-tooltip").hidden = true;
  };
  root.onpointerdown = (e) => {
    if (!e.target.closest("svg")) return;
    down = { index: locate(e), x: e.clientX, y: e.clientY };
    root.setPointerCapture(e.pointerId);
  };
  root.onpointerup = (e) => {
    if (!down) return;
    const last = locate(e),
      horizontal = Math.abs(e.clientX - down.x),
      vertical = Math.abs(e.clientY - down.y);
    if (
      canZoom &&
      horizontal > 18 &&
      horizontal > vertical &&
      Math.abs(last - down.index) >= 2
    ) {
      root._zoom = [Math.min(down.index, last), Math.max(down.index, last)];
      redraw();
    } else if (horizontal < 12 && vertical < 12) {
      pinned = true;
      show(last, e);
      select?.(last);
    }
    down = null;
  };
  root.onpointercancel = () => (down = null);
  root.onkeydown = (e) => {
    if (e.target !== root) return;
    if (e.key === "Escape") {
      pinned = false;
      root.querySelector(".chart-tooltip").hidden = true;
      return;
    }
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      let pos = indices.indexOf(index);
      pos =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? indices.length - 1
            : Math.max(
                0,
                Math.min(
                  indices.length - 1,
                  pos + (e.key === "ArrowRight" ? 1 : -1),
                ),
              );
      pinned = true;
      show(indices[pos]);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pinned = true;
      show(index);
      select?.(index);
    }
  };
  root.querySelector(".reset-zoom").onclick = () => {
    root._zoom = null;
    redraw();
  };
}
export function lineChart(root, config) {
  const {
    title,
    labels,
    series,
    bands = [],
    samples = [],
    xs = labels.map((_, i) => i),
    zero = false,
    yformat = fmt,
    onSelect,
    step = false,
    boundary = null,
  } = config;
  const signature = title + labels.join("|");
  if (root._signature !== signature) {
    root._zoom = null;
    root._hidden = new Set();
    root._signature = signature;
  }
  const hidden = root._hidden ?? new Set();
  root._hidden = hidden;
  const [start, end] = root._zoom ?? [0, labels.length - 1],
    indices = labels.map((_, i) => i).filter((i) => i >= start && i <= end),
    visible = series.filter((s) => !hidden.has(s.key));
  const vals = indices
    .flatMap((i) => [
      ...visible.map((s) => s.values[i]),
      ...bands.flatMap((b) => [b.low[i], b.high[i]]),
      ...samples.map((s) => s[i]),
    ])
    .filter(finite);
  const [lo, hi] = extent(vals.length ? vals : [0, 1], zero),
    W = 1000,
    H = 340,
    L = 70,
    R = 24,
    T = 22,
    B = 38;
  const x = (i) =>
      L + ((xs[i] - xs[start]) / (xs[end] - xs[start] || 1)) * (W - L - R),
    y = (v) => T + ((hi - v) / (hi - lo)) * (H - T - B);
  const path = (values) => {
    let open = false;
    return indices
      .map((i) => {
        if (!finite(values[i])) {
          open = false;
          return "";
        }
        const command = open ? (step ? `H${x(i)}V` : "L") : "M";
        open = true;
        return step && command.startsWith("H")
          ? `${command}${y(values[i])}`
          : `${command}${x(i)},${y(values[i])}`;
      })
      .join(" ");
  };
  const legend = series
    .map(
      (s) =>
        `<button type="button" class="legend-toggle ${hidden.has(s.key) ? "muted-line" : ""}" data-key="${escape(s.key)}" aria-pressed="${!hidden.has(s.key)}"><i style="background:${s.color}"></i>${escape(s.name)}</button>`,
    )
    .join("");
  const surface = frame(root, title, legend);
  root.dataset.visiblePoints = String(indices.length);
  root.dataset.chartKind = "line";
  let grid = "";
  for (let k = 0; k < 5; k++) {
    const v = lo + ((hi - lo) * k) / 4;
    grid += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid-line"/><text x="${L - 10}" y="${y(v) + 4}" text-anchor="end">${escape(yformat(v))}</text>`;
  }
  const tickIndices = [
    ...new Set(
      Array.from(
        { length: Math.min(6, indices.length) },
        (_, k) =>
          indices[
            Math.round(
              (k * (indices.length - 1)) /
                (Math.min(6, indices.length) - 1 || 1),
            )
          ],
      ),
    ),
  ];
  const ticks = tickIndices
    .map(
      (i) =>
        `<text x="${x(i)}" y="${H - 9}" text-anchor="${i === end ? "end" : i === start ? "start" : "middle"}">${escape(labels[i])}</text>`,
    )
    .join("");
  const areas = bands
    .map((b) => {
      const valid = indices.filter(
        (i) => finite(b.low[i]) && finite(b.high[i]),
      );
      return valid.length
        ? `<path d="${valid.map((i, k) => `${k ? "L" : "M"}${x(i)},${y(b.high[i])}`).join(" ")} ${[
            ...valid,
          ]
            .reverse()
            .map((i) => `L${x(i)},${y(b.low[i])}`)
            .join(" ")} Z" fill="${b.color}"/>`
        : "";
    })
    .join("");
  const divider =
    boundary !== null && boundary >= start && boundary <= end
      ? `<line x1="${x(boundary)}" x2="${x(boundary)}" y1="${T}" y2="${H - B}" stroke="#9aa8ba" stroke-dasharray="4 4"/><text x="${Math.min(x(boundary) + 7, W - R - 62)}" y="${T + 12}">Forecast</text>`
      : "";
  surface.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escape(title)}"><title>${escape(title)}</title>${grid}${areas}${samples.map((s) => `<path d="${path(s)}" fill="none" stroke="#7b94be" stroke-width="1" opacity=".35"/>`).join("")}${divider}${visible.map((s) => `<path d="${path(s.values)}" fill="none" stroke="${s.color}" stroke-width="2.6" ${s.dashed ? 'stroke-dasharray="5 4"' : ""}/>`).join("")}${ticks}<line class="crosshair" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="#344e79" visibility="hidden"/><rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent"/></svg>`;
  const inspect = (i, e) => {
    const cursor = surface.querySelector(".crosshair");
    cursor.setAttribute("x1", x(i));
    cursor.setAttribute("x2", x(i));
    cursor.setAttribute("visibility", "visible");
    tooltip(
      root,
      e,
      `<strong>${escape(labels[i])}</strong>${visible
        .filter((s) => finite(s.values[i]))
        .map(
          (s) =>
            `<div><i style="background:${s.color}"></i>${escape(s.name)} <b>${escape(yformat(s.values[i]))}</b></div>`,
        )
        .join("")}${bands
        .filter((b) => finite(b.low[i]))
        .map(
          (b) =>
            `<div>${escape(b.name)} <b>${escape(yformat(b.low[i]))}–${escape(yformat(b.high[i]))}</b></div>`,
        )
        .join("")}`,
    );
  };
  const locate = (e) => {
    const rect = surface.querySelector("svg").getBoundingClientRect(),
      vx = ((e.clientX - rect.left) / rect.width) * W,
      value = xs[start] + ((vx - L) / (W - L - R)) * (xs[end] - xs[start]);
    return indices.reduce(
      (best, i) =>
        Math.abs(xs[i] - value) < Math.abs(xs[best] - value) ? i : best,
      indices[0],
    );
  };
  bind(root, {
    indices,
    locate,
    inspect,
    select: onSelect,
    redraw: () => lineChart(root, config),
  });
  root.querySelectorAll(".legend-toggle").forEach(
    (btn) =>
      (btn.onclick = () => {
        const key = btn.dataset.key;
        if (hidden.has(key)) hidden.delete(key);
        else if (visible.length > 1) hidden.add(key);
        lineChart(root, config);
      }),
  );
}
export function barChart(
  root,
  { title, rows, yformat = fmt, onSelect, horizontal = false },
) {
  if (horizontal) {
    const W = 1000,
      H = Math.max(300, rows.length * 30 + 65),
      L = 245,
      R = 25,
      T = 20,
      B = 35,
      values = rows.map((r) => r.value),
      [lo, hi] = extent(values.length ? values : [0, 1], true),
      x = (v) => L + ((v - lo) / (hi - lo)) * (W - L - R),
      slot = (H - T - B) / (rows.length || 1),
      surface = frame(root, title);
    root.dataset.chartKind = "bar";
    root.querySelector(".reset-zoom").hidden = true;
    root.querySelector(".chart-hint").textContent =
      "Hover or tap a driver; arrow keys inspect the ranked observations.";
    let grid = "";
    for (let i = 0; i < 5; i++) {
      const v = lo + ((hi - lo) * i) / 4;
      grid += `<line x1="${x(v)}" x2="${x(v)}" y1="${T}" y2="${H - B}" class="grid-line"/><text x="${x(v)}" y="${H - 10}" text-anchor="middle">${escape(yformat(v))}</text>`;
    }
    surface.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escape(title)}">${grid}${rows.map((r, i) => `<text x="${L - 14}" y="${T + (i + 0.55) * slot + 4}" text-anchor="end">${escape(r.label.length > 32 ? r.label.slice(0, 30) + "…" : r.label)}</text><rect x="${Math.min(x(0), x(r.value))}" y="${T + i * slot + slot * 0.15}" width="${Math.max(1, Math.abs(x(r.value) - x(0)))}" height="${slot * 0.7}" fill="${r.color ?? palette[0]}"/>`).join("")}</svg>`;
    const locate = (e) => {
      const rect = surface.querySelector("svg").getBoundingClientRect();
      return Math.max(
        0,
        Math.min(
          rows.length - 1,
          Math.floor((((e.clientY - rect.top) / rect.height) * H - T) / slot),
        ),
      );
    };
    bind(root, {
      indices: rows.map((_, i) => i),
      locate,
      inspect: (i, e) => {
        const r = rows[i];
        if (r)
          tooltip(
            root,
            e,
            `<strong>${escape(r.label)}</strong><div>Pearson r ${escape(yformat(r.value))}</div><p>${escape(r.detail ?? "")}</p>`,
          );
      },
      select: onSelect,
      redraw: () => {},
      canZoom: false,
    });
    return;
  }

  const W = 1000,
    H = 340,
    L = 70,
    R = 24,
    T = 22,
    B = 65,
    values = rows.map((r) => r.value).filter(finite),
    [lo, hi] = extent(values.length ? values : [0, 1], true),
    y = (v) => T + ((hi - v) / (hi - lo)) * (H - T - B),
    slot = (W - L - R) / (rows.length || 1);
  const surface = frame(root, title);
  root.dataset.chartKind = "bar";
  root.querySelector(".reset-zoom").hidden = true;
  root.querySelector(".chart-hint").textContent =
    "Hover, tap or use arrow keys to inspect; tap a bar to select.";
  let grid = "";
  for (let k = 0; k < 5; k++) {
    const v = lo + ((hi - lo) * k) / 4;
    grid += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid-line"/><text x="${L - 10}" y="${y(v) + 4}" text-anchor="end">${escape(yformat(v))}</text>`;
  }
  surface.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escape(title)}">${grid}${rows.map((r, i) => `<rect x="${L + i * slot + slot * 0.1}" y="${Math.min(y(r.value), y(0))}" width="${slot * 0.8}" height="${Math.max(1, Math.abs(y(r.value) - y(0)))}" fill="${r.color ?? palette[0]}"/><text x="${L + (i + 0.5) * slot}" y="${H - B + 18}" text-anchor="middle">${escape(r.short ?? r.label)}</text>`).join("")}</svg>`;
  const locate = (e) => {
    const rect = surface.querySelector("svg").getBoundingClientRect();
    return Math.max(
      0,
      Math.min(
        rows.length - 1,
        Math.floor((((e.clientX - rect.left) / rect.width) * W - L) / slot),
      ),
    );
  };
  bind(root, {
    indices: rows.map((_, i) => i),
    locate,
    inspect: (i, e) => {
      const r = rows[i];
      if (r)
        tooltip(
          root,
          e,
          `<strong>${escape(r.label)}</strong><div>${escape(yformat(r.value))}</div>${r.detail ? `<p>${escape(r.detail)}</p>` : ""}`,
        );
    },
    select: onSelect,
    redraw: () => {},
    canZoom: false,
  });
}
export function scatterChart(
  root,
  { title, points, xLabel, yLabel, onSelect },
) {
  const W = 1000,
    H = 340,
    L = 70,
    R = 24,
    T = 20,
    B = 40,
    [xmin, xmax] = extent(
      points.map((p) => p.x).length ? points.map((p) => p.x) : [0, 1],
    ),
    [ymin, ymax] = extent(
      points.map((p) => p.y).length ? points.map((p) => p.y) : [0, 1],
    );
  const x = (v) => L + ((v - xmin) / (xmax - xmin)) * (W - L - R),
    y = (v) => T + ((ymax - v) / (ymax - ymin)) * (H - T - B),
    surface = frame(root, title);
  root.querySelector(".reset-zoom").hidden = true;
  root.querySelector(".chart-hint").textContent =
    "Hover or tap a monthly observation. Arrow keys step in chronological order.";
  let grid = "";
  for (let i = 0; i < 5; i++) {
    const xv = xmin + ((xmax - xmin) * i) / 4,
      yv = ymin + ((ymax - ymin) * i) / 4;
    grid += `<line class="grid-line" x1="${L}" x2="${W - R}" y1="${y(yv)}" y2="${y(yv)}"/><text x="${L - 8}" y="${y(yv) + 4}" text-anchor="end">${fmt(yv)}</text><text x="${x(xv)}" y="${H - 12}" text-anchor="${i === 4 ? "end" : i === 0 ? "start" : "middle"}">${fmt(xv)}</text>`;
  }
  surface.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escape(title)}">${grid}${points.map((p) => `<circle cx="${x(p.x)}" cy="${y(p.y)}" r="5" fill="#2d64d5" opacity=".6"/>`).join("")}</svg>`;
  const locate = (e) => {
    const rect = surface.querySelector("svg").getBoundingClientRect(),
      px = ((e.clientX - rect.left) / rect.width) * W,
      py = ((e.clientY - rect.top) / rect.height) * H;
    return points.reduce(
      (best, p, i) =>
        (x(p.x) - px) ** 2 + (y(p.y) - py) ** 2 <
        (x(points[best].x) - px) ** 2 + (y(points[best].y) - py) ** 2
          ? i
          : best,
      0,
    );
  };
  bind(root, {
    indices: points.map((_, i) => i),
    locate,
    inspect: (i, e) => {
      const p = points[i];
      if (p)
        tooltip(
          root,
          e,
          `<strong>${escape(p.label)}</strong><div>${escape(xLabel)} <b>${fmt(p.x, 2)}</b></div><div>${escape(yLabel)} <b>${fmt(p.y, 2)}</b></div>`,
        );
    },
    select: onSelect,
    redraw: () => {},
    canZoom: false,
  });
}
export function heatmap(root, { rows, columns, cells, title, onSelect }) {
  root.classList.add("matrix-chart");
  root.innerHTML = `<div class="matrix-scroll"><table><thead><tr><th></th>${columns.map((c) => `<th title="${escape(c)}">${escape(c.length > 20 ? c.slice(0, 18) + "…" : c)}</th>`).join("")}</tr></thead><tbody>${rows
    .map(
      (r, i) =>
        `<tr><th title="${escape(r)}">${escape(r)}</th>${columns
          .map((c, j) => {
            const cell = cells[i][j],
              v = cell.r,
              intensity = v === null ? 0 : Math.abs(v),
              bg =
                v === null
                  ? "#edf0f4"
                  : v >= 0
                    ? `rgba(45,100,213,${0.08 + intensity * 0.65})`
                    : `rgba(177,108,32,${0.08 + intensity * 0.65})`;
            return `<td><button type="button" data-row="${i}" data-col="${j}" style="background:${bg};color:${intensity > 0.72 ? "#fff" : "#263347"}" aria-label="${escape(`${r} versus ${c}: r ${v === null ? "unavailable" : v.toFixed(3)}, ${cell.n} pairs`)}">${v === null ? "—" : v.toFixed(2)}</button></td>`;
          })
          .join("")}</tr>`,
    )
    .join(
      "",
    )}</tbody></table></div><p class="matrix-readout" role="status">${escape(title)} · select a cell to inspect its paired observations.</p>`;
  const inspect = (button) => {
    if (!button) return;
    const i = Number(button.dataset.row),
      j = Number(button.dataset.col),
      cell = cells[i][j];
    root.querySelector(".matrix-readout").textContent =
      `${rows[i]} → ${columns[j]} · r ${cell.r === null ? "unavailable" : cell.r.toFixed(3)} · ${cell.n} observed pairs`;
  };
  root.onpointerover = (e) => inspect(e.target.closest("button"));
  root.onfocusin = (e) => inspect(e.target.closest("button"));
  root.onclick = (e) => {
    const b = e.target.closest("button");
    if (b) {
      inspect(b);
      onSelect?.(Number(b.dataset.row), Number(b.dataset.col));
    }
  };
}
