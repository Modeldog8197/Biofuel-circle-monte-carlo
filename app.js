// ========================================
// BIOFUELCIRCLE ANALYTICS DASHBOARD — app.js
// Fan chart Monte Carlo + full dashboard
// ========================================

const MONTHS = [
    'Oct-22','Nov-22','Dec-22','Jan-23','Feb-23','Mar-23','Apr-23','May-23','Jun-23',
    'Jul-23','Aug-23','Sep-23','Oct-23','Nov-23','Dec-23','Jan-24','Feb-24','Mar-24',
    'Apr-24','May-24','Jun-24','Jul-24','Aug-24','Sep-24','Oct-24','Nov-24','Dec-24',
    'Jan-25','Feb-25','Mar-25','Apr-25','May-25','Jun-25','Jul-25','Aug-25','Sep-25',
    'Oct-25','Nov-25','Dec-25','Jan-26','Feb-26','Mar-26','Apr-26'
];
const FUTURE_MONTHS = ['May-26','Jun-26','Jul-26','Aug-26','Sep-26','Oct-26','Nov-26','Dec-26','Jan-27','Feb-27','Mar-27','Apr-27'];
const ALL_MONTHS = [...MONTHS, ...FUTURE_MONTHS];

const DATA = {
    'New Sell Trades (No)': [94,192,125,138,131,110,94,158,95,92,106,82,100,67,80,86,129,120,101,182,182,276,243,276,273,296,303,332,313,441,321,386,365,574,422,445,266,475,544,668,649,633,620],
    'New Sell Trades (V)': [69404,75424,39569,55362,58096,56253,26684,68541,57123,39950,62989,74540,58475,41605,130089,47072,47325,54623,49440,162397,85194,90540,253645,160548,147154,146898,131249,144673,110320,140644,149925,161964,123067,186521,96478,153356,104584,434282,88003,745736,369700,397220,432387],
    'Manual Responses (No)': [21,218,194,113,147,179,171,247,146,247,265,126,168,174,215,167,200,207,92,161,93,94,148,375,244,279,293,237,187,234,251,236,252,387,323,433,270,484,569,653,811,784,660],
    'Manual Responses (V)': [15000,69458,46288,27290,24699,64252,36878,57955,73500,85528,69425,41438,51348,64016,56906,42600,30734,58289,33895,79800,24552,20552,39043,109387,62534,31897,64602,54718,28485,34449,119076,54970,81917,34166,27517,32419,29556,49756,242973,100432,128403,110438,81607],
    'Unique participants': [null,null,null,null,155,139,122,153,108,115,151,105,123,101,120,101,132,138,59,142,125,139,147,169,134,156,167,181,165,217,196,246,236,265,240,280,248,303,312,336,376,362,349],
    'Deals': [36,64,55,39,72,59,85,95,53,80,111,62,64,37,52,59,70,74,39,58,66,52,43,89,137,190,214,137,127,134,157,174,143,256,199,236,161,229,350,340,419,440,326],
    'Platform delivered Vol': [null,null,null,null,null,null,318,1369,786,868,2730,2610,1495,719,421,1874,3450,4198,2418,2114,1084,1253,2820,3183,3504,2347,1860,2373,2930,3928,5032,5376,5912,4289,4989,5057,4357,7602,9714,8658,11558,13676,11248],
    'Successful Participants': [null,null,null,null,55,42,49,73,45,40,56,51,38,38,44,48,48,52,24,39,47,43,38,65,78,90,93,84,72,86,92,108,97,149,133,153,115,164,195,179,225,236,186],
};

// ===== CHART.JS DEFAULTS =====
Chart.defaults.color = '#94a3b8';
Chart.defaults.font.family = 'Inter, sans-serif';
Chart.defaults.font.size = 12;
Chart.defaults.plugins.legend.labels.usePointStyle = true;
Chart.defaults.plugins.legend.labels.pointStyleWidth = 10;
Chart.defaults.elements.line.tension = 0.35;
Chart.defaults.elements.point.radius = 2;
Chart.defaults.elements.point.hoverRadius = 5;

const COLORS = {
    blue: 'rgba(99, 102, 241, 1)', blueAlpha: 'rgba(99, 102, 241, 0.15)',
    purple: 'rgba(167, 139, 250, 1)', purpleAlpha: 'rgba(167, 139, 250, 0.15)',
    green: 'rgba(52, 211, 153, 1)', greenAlpha: 'rgba(52, 211, 153, 0.15)',
    orange: 'rgba(251, 146, 60, 1)', orangeAlpha: 'rgba(251, 146, 60, 0.15)',
    cyan: 'rgba(34, 211, 238, 1)', cyanAlpha: 'rgba(34, 211, 238, 0.15)',
    pink: 'rgba(244, 114, 182, 1)', pinkAlpha: 'rgba(244, 114, 182, 0.15)',
    red: 'rgba(248, 113, 113, 1)', redAlpha: 'rgba(248, 113, 113, 0.15)',
    gridColor: 'rgba(99, 102, 241, 0.08)',
};
function gridOpts() { return { color: COLORS.gridColor, drawBorder: false }; }
function tooltipOpts() { return { backgroundColor: 'rgba(15,23,42,0.95)', borderColor: 'rgba(99,102,241,0.3)', borderWidth: 1, titleColor: '#f1f5f9', bodyColor: '#94a3b8' }; }

// ===== MONTE CARLO SIMULATION ENGINE =====
function randn() {
    // Box-Muller transform for normal distribution
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function computeReturns(data) {
    const returns = [];
    for (let i = 1; i < data.length; i++) {
        if (data[i] !== null && data[i - 1] !== null && data[i - 1] !== 0) {
            returns.push(data[i] / data[i - 1] - 1);
        }
    }
    return returns;
}

function simulatePaths(historicalData, numPaths, numMonths) {
    const returns = computeReturns(historicalData);
    const meanR = returns.reduce((a, b) => a + b, 0) / returns.length;
    const stdR = Math.sqrt(returns.reduce((a, b) => a + (b - meanR) ** 2, 0) / (returns.length - 1));
    // Compute trend component (linear regression on values)
    const vals = historicalData.filter(v => v !== null);
    const n = vals.length;
    const mx = (n - 1) / 2;
    const my = vals.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    vals.forEach((v, i) => { num += (i - mx) * (v - my); den += (i - mx) ** 2; });
    const trendSlope = num / den;

    const lastVal = historicalData[historicalData.length - 1];
    const paths = [];
    const finalValues = [];

    for (let p = 0; p < numPaths; p++) {
        const path = [lastVal];
        for (let m = 1; m <= numMonths; m++) {
            // Trend-adjusted: add trend + random noise
            const trendComponent = trendSlope;
            const noiseComponent = stdR * lastVal * randn() * 0.5;
            let nextVal = path[path.length - 1] + trendComponent + noiseComponent;
            if (nextVal < 0) nextVal = Math.abs(nextVal) * 0.1; // floor at near-zero
            path.push(nextVal);
        }
        paths.push(path);
        finalValues.push(path[path.length - 1]);
    }

    finalValues.sort((a, b) => a - b);
    const percentile = (arr, p) => arr[Math.floor(arr.length * p / 100)];

    return {
        paths,
        finalValues,
        stats: {
            p5: percentile(finalValues, 5),
            p25: percentile(finalValues, 25),
            median: percentile(finalValues, 50),
            p75: percentile(finalValues, 75),
            p95: percentile(finalValues, 95),
            mean: finalValues.reduce((a, b) => a + b, 0) / finalValues.length,
            growthProb: finalValues.filter(v => v > lastVal).length / finalValues.length,
        },
        // Compute percentile paths (for each month, get the percentile across paths)
        percPaths: (() => {
            const p5Path = [lastVal], p50Path = [lastVal], p95Path = [lastVal];
            for (let m = 1; m <= numMonths; m++) {
                const monthVals = paths.map(p => p[m]).sort((a, b) => a - b);
                p5Path.push(percentile(monthVals, 5));
                p50Path.push(percentile(monthVals, 50));
                p95Path.push(percentile(monthVals, 95));
            }
            return { p5: p5Path, p50: p50Path, p95: p95Path };
        })()
    };
}

// ===== GLOBAL MC STATE =====
let currentMCTarget = 'New Sell Trades (No)';
let mcSimResults = {}; // cache
let fanChartInstance = null;
let spreadChartInstance = null;
let targetChartInstance = null;

function getMCResult(targetKey) {
    if (!mcSimResults[targetKey]) {
        mcSimResults[targetKey] = simulatePaths(DATA[targetKey], 500, 12);
    }
    return mcSimResults[targetKey];
}

function formatVal(v) {
    if (Math.abs(v) >= 1000000) return (v / 1000000).toFixed(1) + 'M';
    if (Math.abs(v) >= 1000) return (v / 1000).toFixed(1) + 'K';
    return Math.round(v).toLocaleString();
}

// ===== DRAW FAN CHART =====
function drawFanChart(targetKey) {
    const result = getMCResult(targetKey);
    const historical = DATA[targetKey];
    const lastVal = historical[historical.length - 1];

    // Destroy previous chart
    if (fanChartInstance) { fanChartInstance.destroy(); fanChartInstance = null; }

    const canvas = document.getElementById('fanChart');
    if (!canvas) return;

    // Build datasets
    // 1. Historical line (positions 0-42)
    const histData = historical.map((v, i) => ({ x: i, y: v }));

    // 2. Sample simulation paths (show 60 of 500, low opacity)
    const sampleIndices = [];
    const step = Math.floor(500 / 60);
    for (let i = 0; i < 500; i += step) sampleIndices.push(i);

    const sampleDatasets = sampleIndices.map((si, idx) => {
        const path = result.paths[si];
        const data = path.map((v, m) => ({ x: 42 + m, y: v }));
        return {
            data,
            borderColor: 'rgba(255,255,255,0.07)',
            borderWidth: 1,
            pointRadius: 0,
            fill: false,
            tension: 0.3,
            label: '',
        };
    });

    // 3. Percentile paths
    const p5Data = result.percPaths.p5.map((v, m) => ({ x: 42 + m, y: v }));
    const p50Data = result.percPaths.p50.map((v, m) => ({ x: 42 + m, y: v }));
    const p95Data = result.percPaths.p95.map((v, m) => ({ x: 42 + m, y: v }));

    // 4. Confidence band (fill between p5 and p95)
    const p95ForFill = result.percPaths.p95.map((v, m) => ({ x: 42 + m, y: v }));

    const datasets = [
        // Confidence band - P95 upper bound
        {
            label: 'P95 Ceiling',
            data: p95ForFill,
            borderColor: 'rgba(248,113,113,0.4)',
            borderWidth: 1.5,
            borderDash: [5, 4],
            pointRadius: 0,
            fill: '+2', // fill down to P5 dataset (2 positions ahead)
            backgroundColor: 'rgba(99,102,241,0.06)',
            tension: 0.3,
        },
        // Median (most likely) - bold white
        {
            label: 'Most Likely (Median)',
            data: p50Data,
            borderColor: 'rgba(255,255,255,0.95)',
            borderWidth: 3,
            pointRadius: 0,
            fill: false,
            tension: 0.3,
        },
        // P5 lower bound
        {
            label: 'P5 Floor',
            data: p5Data,
            borderColor: 'rgba(248,113,113,0.4)',
            borderWidth: 1.5,
            borderDash: [5, 4],
            pointRadius: 0,
            fill: false,
            tension: 0.3,
        },
        // Sample paths
        ...sampleDatasets,
        // Historical (on top of everything)
        {
            label: 'Historical',
            data: histData,
            borderColor: '#6366f1',
            borderWidth: 2.5,
            pointRadius: 0,
            pointHoverRadius: 4,
            fill: false,
            tension: 0.3,
        },
    ];

    fanChartInstance = new Chart(canvas, {
        type: 'line',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', axis: 'x', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    enabled: false,
                    external: function(context) {
                        // Custom HTML tooltip
                        let el = document.getElementById('fanTooltip');
                        if (!el) {
                            el = document.createElement('div');
                            el.id = 'fanTooltip';
                            el.style.cssText = 'position:fixed;pointer-events:none;background:rgba(10,14,26,0.95);border:1px solid rgba(99,102,241,0.4);border-radius:10px;padding:12px 16px;font-family:Inter,sans-serif;font-size:13px;color:#f1f5f9;z-index:9999;box-shadow:0 8px 30px rgba(0,0,0,0.5);min-width:180px;transition:opacity 0.15s;';
                            document.body.appendChild(el);
                        }
                        const tooltip = context.tooltip;
                        if (tooltip.opacity === 0) { el.style.opacity = '0'; return; }

                        const xIdx = Math.round(tooltip.dataPoints?.[0]?.parsed?.x ?? -1);
                        if (xIdx < 0) { el.style.opacity = '0'; return; }

                        const monthLabel = ALL_MONTHS[xIdx] || '';
                        const isHistory = xIdx <= 42;
                        let html = '<div style="font-weight:700;margin-bottom:8px;color:#818cf8;font-size:14px;">' + monthLabel + '</div>';

                        if (isHistory && xIdx < historical.length) {
                            const val = historical[xIdx];
                            html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">'
                                  + '<span style="display:inline-block;width:10px;height:3px;background:#6366f1;border-radius:2px;"></span>'
                                  + '<span style="color:#94a3b8;">Actual:</span> <strong>' + (val !== null ? Number(val).toLocaleString() : '—') + '</strong></div>';
                        }

                        if (xIdx >= 42) {
                            const forecastMonth = xIdx - 42;
                            const p95v = result.percPaths.p95[forecastMonth];
                            const p50v = result.percPaths.p50[forecastMonth];
                            const p5v = result.percPaths.p5[forecastMonth];
                            html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">'
                                  + '<span style="display:inline-block;width:10px;height:3px;background:#34d399;border-radius:2px;"></span>'
                                  + '<span style="color:#94a3b8;">Best case (P95):</span> <strong style="color:#34d399;">' + formatVal(p95v) + '</strong></div>';
                            html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">'
                                  + '<span style="display:inline-block;width:10px;height:3px;background:#fff;border-radius:2px;"></span>'
                                  + '<span style="color:#94a3b8;">Most likely:</span> <strong>' + formatVal(p50v) + '</strong></div>';
                            html += '<div style="display:flex;align-items:center;gap:8px;">'
                                  + '<span style="display:inline-block;width:10px;height:3px;background:#f87171;border-radius:2px;"></span>'
                                  + '<span style="color:#94a3b8;">Worst case (P5):</span> <strong style="color:#f87171;">' + formatVal(p5v) + '</strong></div>';
                        }

                        el.innerHTML = html;
                        el.style.opacity = '1';

                        // Position near cursor
                        const canvasRect = context.chart.canvas.getBoundingClientRect();
                        let left = canvasRect.left + tooltip.caretX + 16;
                        let top = canvasRect.top + tooltip.caretY - 30;
                        // Keep on screen
                        if (left + 220 > window.innerWidth) left = canvasRect.left + tooltip.caretX - 230;
                        if (top < 0) top = 10;
                        if (top + 150 > window.innerHeight) top = window.innerHeight - 160;
                        el.style.left = left + 'px';
                        el.style.top = top + 'px';
                    }
                },
            },
            scales: {
                x: {
                    type: 'linear',
                    grid: gridOpts(),
                    ticks: {
                        callback: (val) => ALL_MONTHS[val] || '',
                        maxTicksLimit: 14,
                        maxRotation: 45,
                    },
                    min: 0,
                    max: 54,
                },
                y: {
                    grid: gridOpts(),
                    ticks: {
                        callback: v => formatVal(v),
                    },
                    beginAtZero: false,
                }
            },
            // Draw a vertical separator line at index 42 (boundary between history and forecast)
        },
        plugins: [{
            id: 'dividerLine',
            beforeDraw: (chart) => {
                const xScale = chart.scales.x;
                const yScale = chart.scales.y;
                const ctx = chart.ctx;
                const xPos = xScale.getPixelForValue(42);
                ctx.save();
                ctx.strokeStyle = 'rgba(99,102,241,0.35)';
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.moveTo(xPos, yScale.top);
                ctx.lineTo(xPos, yScale.bottom);
                ctx.stroke();
                // Label
                ctx.fillStyle = 'rgba(99,102,241,0.6)';
                ctx.font = '11px Inter, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('← History | Forecast →', xPos, yScale.top - 6);
                ctx.restore();
            }
        }]
    });

    // Update summary cards
    document.getElementById('fanChartTitle').textContent = targetKey + ' — History + Forecast';
    document.getElementById('mcCurrentVal').textContent = formatVal(lastVal);
    document.getElementById('mcCurrentSub').textContent = 'Apr 2026';
    document.getElementById('mcForecastVal').textContent = formatVal(result.stats.median);
    document.getElementById('mcForecastRange').textContent = 'range: ' + formatVal(result.stats.p5) + ' – ' + formatVal(result.stats.p95);
    document.getElementById('mcGrowthProb').textContent = (result.stats.growthProb * 100).toFixed(1) + '%';
}

// ===== DRAW SPREAD (HISTOGRAM) =====
function drawSpread(targetKey) {
    const result = getMCResult(targetKey);
    const lastVal = DATA[targetKey][DATA[targetKey].length - 1];
    if (spreadChartInstance) { spreadChartInstance.destroy(); spreadChartInstance = null; }
    const canvas = document.getElementById('spreadChart');
    if (!canvas) return;

    const finals = result.finalValues;
    const minV = Math.min(...finals);
    const maxV = Math.max(...finals);
    const numBins = 30;
    const binWidth = (maxV - minV) / numBins;
    const bins = Array(numBins).fill(0);
    const binLabels = [];
    for (let i = 0; i < numBins; i++) {
        const low = minV + i * binWidth;
        binLabels.push(formatVal(low + binWidth / 2));
        finals.forEach(v => {
            if (v >= low && v < low + binWidth) bins[i]++;
        });
    }
    // Colour bins: green if above current, orange if below
    const binColors = binLabels.map((_, i) => {
        const mid = minV + (i + 0.5) * binWidth;
        return mid >= lastVal ? 'rgba(52,211,153,0.6)' : 'rgba(251,146,60,0.5)';
    });
    const binBorders = binLabels.map((_, i) => {
        const mid = minV + (i + 0.5) * binWidth;
        return mid >= lastVal ? 'rgba(52,211,153,1)' : 'rgba(251,146,60,1)';
    });

    document.getElementById('spreadTitle').textContent = targetKey + ' — Where Could We End Up in 12 Months?';
    document.getElementById('spreadP5').textContent = formatVal(result.stats.p5);
    document.getElementById('spreadMedian').textContent = formatVal(result.stats.median);
    document.getElementById('spreadP95').textContent = formatVal(result.stats.p95);

    spreadChartInstance = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: binLabels,
            datasets: [{
                label: 'Simulations',
                data: bins,
                backgroundColor: binColors,
                borderColor: binBorders,
                borderWidth: 1,
                borderRadius: 3,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { ...tooltipOpts(), callbacks: { title: (items) => 'Value: ~' + items[0].label, label: (ctx) => ctx.parsed.y + ' simulations' } },
            },
            scales: {
                x: { grid: gridOpts(), ticks: { maxTicksLimit: 10, maxRotation: 45 }, title: { display: true, text: 'Possible 12-month outcome', color: '#64748b' } },
                y: { grid: gridOpts(), title: { display: true, text: '# of simulations', color: '#64748b' } },
            }
        },
        plugins: [{
            id: 'currentLine',
            beforeDraw: (chart) => {
                const xScale = chart.scales.x;
                const yScale = chart.scales.y;
                const ctx = chart.ctx;
                // Find which bin the current value falls in
                const binIdx = Math.min(numBins - 1, Math.max(0, Math.floor((lastVal - minV) / binWidth)));
                const xPos = xScale.getPixelForValue(binIdx);
                ctx.save();
                ctx.strokeStyle = '#6366f1';
                ctx.lineWidth = 2;
                ctx.setLineDash([6, 4]);
                ctx.beginPath();
                ctx.moveTo(xPos, yScale.top);
                ctx.lineTo(xPos, yScale.bottom);
                ctx.stroke();
                ctx.fillStyle = '#6366f1';
                ctx.font = 'bold 11px Inter, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('Today: ' + formatVal(lastVal), xPos, yScale.top - 6);
                ctx.restore();
            }
        }]
    });
}

// ===== DRAW TARGET PROBABILITY =====
function drawTargetProb(targetKey) {
    const result = getMCResult(targetKey);
    const lastVal = DATA[targetKey][DATA[targetKey].length - 1];
    if (targetChartInstance) { targetChartInstance.destroy(); targetChartInstance = null; }
    const canvas = document.getElementById('targetChart');
    if (!canvas) return;

    document.getElementById('targetTitle').textContent = targetKey + ' — Probability of Hitting a Target in 12 Months';

    // Generate target thresholds
    const multipliers = [0.5, 0.75, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];
    const targets = multipliers.map(m => Math.round(lastVal * m));
    const probs = targets.map(t => {
        const above = result.finalValues.filter(v => v >= t).length;
        return (above / result.finalValues.length) * 100;
    });

    const barColors = probs.map(p => {
        if (p >= 75) return 'rgba(52,211,153,0.7)';
        if (p >= 50) return 'rgba(99,102,241,0.6)';
        if (p >= 25) return 'rgba(251,146,60,0.6)';
        return 'rgba(248,113,113,0.5)';
    });

    targetChartInstance = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: targets.map(t => formatVal(t)),
            datasets: [{
                label: 'Probability (%)',
                data: probs,
                backgroundColor: barColors,
                borderColor: barColors.map(c => c.replace(/[\d.]+\)$/, '1)')),
                borderWidth: 1.5,
                borderRadius: 6,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { ...tooltipOpts(), callbacks: { label: (ctx) => ctx.parsed.y.toFixed(1) + '% chance of reaching ' + ctx.label } },
            },
            scales: {
                x: { grid: gridOpts(), title: { display: true, text: 'Target value to reach', color: '#64748b' } },
                y: { grid: gridOpts(), max: 100, title: { display: true, text: 'Probability (%)', color: '#64748b' }, ticks: { callback: v => v + '%' } },
            }
        },
        plugins: [{
            id: 'currentMarker',
            beforeDraw: (chart) => {
                const xScale = chart.scales.x;
                const yScale = chart.scales.y;
                const ctx = chart.ctx;
                const idx = targets.indexOf(Math.round(lastVal));
                if (idx >= 0) {
                    const xPos = xScale.getPixelForValue(idx);
                    ctx.save();
                    ctx.strokeStyle = '#6366f1';
                    ctx.lineWidth = 2;
                    ctx.setLineDash([6, 4]);
                    ctx.beginPath();
                    ctx.moveTo(xPos, yScale.top);
                    ctx.lineTo(xPos, yScale.bottom);
                    ctx.stroke();
                    ctx.fillStyle = '#6366f1';
                    ctx.font = 'bold 11px Inter, sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText('Current', xPos, yScale.top - 6);
                    ctx.restore();
                }
            }
        }]
    });
}

// ===== REFRESH ALL MC VIEWS =====
function refreshMC() {
    drawFanChart(currentMCTarget);
    drawSpread(currentMCTarget);
    drawTargetProb(currentMCTarget);
}

// ===== NAVIGATION =====
document.addEventListener('DOMContentLoaded', () => {
    const links = document.querySelectorAll('.nav-link');
    const sections = document.querySelectorAll('.section');
    const menuToggle = document.getElementById('menuToggle');
    const sidebar = document.getElementById('sidebar');

    function navigate(sectionId) {
        sections.forEach(s => s.classList.remove('active-section'));
        links.forEach(l => l.classList.remove('active'));
        document.getElementById(sectionId)?.classList.add('active-section');
        document.querySelector(`.nav-link[data-section="${sectionId}"]`)?.classList.add('active');
        sidebar.classList.remove('open');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    links.forEach(link => link.addEventListener('click', e => { e.preventDefault(); navigate(link.dataset.section); }));
    menuToggle?.addEventListener('click', () => sidebar.classList.toggle('open'));

    // MC target tabs
    document.querySelectorAll('#mcTargetTabs .tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('#mcTargetTabs .tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentMCTarget = tab.dataset.target;
            mcSimResults = {}; // re-simulate for new target
            refreshMC();
        });
    });

    // MC sub-tabs
    document.querySelectorAll('#mcSubTabs .subtab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('#mcSubTabs .subtab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            document.querySelectorAll('.mc-view').forEach(v => v.classList.remove('active'));
            document.getElementById('mcView-' + tab.dataset.view)?.classList.add('active');
        });
    });

    // Init everything
    initSparklines();
    initTrendCharts();
    refreshMC();
    initDriverChart();
    initCorrChart();
    initLagChart();
    initLagDecayChart();
    initScenarioCharts();
    animateKPIs();
});

// ===== SPARKLINES =====
function initSparklines() {
    [
        { id: 'sparkSellNo', key: 'New Sell Trades (No)', color: COLORS.blue },
        { id: 'sparkSellV', key: 'New Sell Trades (V)', color: COLORS.purple },
        { id: 'sparkManNo', key: 'Manual Responses (No)', color: COLORS.green },
        { id: 'sparkManV', key: 'Manual Responses (V)', color: COLORS.orange },
    ].forEach(t => {
        const ctx = document.getElementById(t.id);
        if (!ctx) return;
        new Chart(ctx, {
            type: 'line',
            data: { labels: DATA[t.key].map((_, i) => i), datasets: [{ data: DATA[t.key], borderColor: t.color, backgroundColor: t.color.replace('1)', '0.1)'), fill: true, borderWidth: 2, pointRadius: 0 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { x: { display: false }, y: { display: false } }, elements: { line: { tension: 0.4 } } }
        });
    });
}

// ===== TREND CHARTS =====
function initTrendCharts() {
    [
        { id: 'trendSellNo', key: 'New Sell Trades (No)', color: COLORS.blue, alpha: COLORS.blueAlpha },
        { id: 'trendSellV', key: 'New Sell Trades (V)', color: COLORS.purple, alpha: COLORS.purpleAlpha },
        { id: 'trendManNo', key: 'Manual Responses (No)', color: COLORS.green, alpha: COLORS.greenAlpha },
        { id: 'trendManV', key: 'Manual Responses (V)', color: COLORS.orange, alpha: COLORS.orangeAlpha },
    ].forEach(t => {
        const ctx = document.getElementById(t.id);
        if (!ctx) return;
        const vals = DATA[t.key];
        const pairs = []; vals.forEach((v, i) => { if (v !== null) pairs.push({ x: i, y: v }); });
        const n = pairs.length, mx = pairs.reduce((a, p) => a + p.x, 0) / n, my = pairs.reduce((a, p) => a + p.y, 0) / n;
        let num = 0, den = 0;
        pairs.forEach(p => { num += (p.x - mx) * (p.y - my); den += (p.x - mx) ** 2; });
        const slope = num / den, intercept = my - slope * mx;
        const trend = vals.map((_, i) => slope * i + intercept);

        new Chart(ctx, {
            type: 'line',
            data: { labels: MONTHS, datasets: [
                { label: t.key, data: vals, borderColor: t.color, backgroundColor: t.alpha, fill: true, borderWidth: 2.5, pointRadius: 3, pointHoverRadius: 6 },
                { label: 'Trend', data: trend, borderColor: COLORS.red, borderWidth: 1.5, borderDash: [6, 4], pointRadius: 0, fill: false }
            ] },
            options: {
                responsive: true, interaction: { mode: 'index', intersect: false },
                plugins: { legend: { position: 'top' }, tooltip: { ...tooltipOpts(), callbacks: { label: ctx => ctx.dataset.label + ': ' + (ctx.parsed.y || 0).toLocaleString() } } },
                scales: { x: { grid: gridOpts(), ticks: { maxRotation: 45, maxTicksLimit: 12 } }, y: { grid: gridOpts(), ticks: { callback: v => formatVal(v) } } }
            }
        });
    });

    const normCtx = document.getElementById('trendAllNorm');
    if (!normCtx) return;
    const datasets = [
        { key: 'New Sell Trades (No)', color: COLORS.blue, label: 'Sell Trades (No)' },
        { key: 'New Sell Trades (V)', color: COLORS.purple, label: 'Sell Trades (V)' },
        { key: 'Manual Responses (No)', color: COLORS.green, label: 'Manual Resp (No)' },
        { key: 'Manual Responses (V)', color: COLORS.orange, label: 'Manual Resp (V)' },
    ].map(t => {
        const vals = DATA[t.key]; const first = vals.find(v => v !== null && v > 0);
        return { label: t.label, data: vals.map(v => v !== null ? (v / first) * 100 : null), borderColor: t.color, borderWidth: 2.5, pointRadius: 1, fill: false };
    });
    new Chart(normCtx, {
        type: 'line', data: { labels: MONTHS, datasets },
        options: {
            responsive: true, interaction: { mode: 'index', intersect: false },
            plugins: { legend: { position: 'top' }, tooltip: { ...tooltipOpts(), callbacks: { label: ctx => ctx.dataset.label + ': ' + (ctx.parsed.y || 0).toFixed(0) } } },
            scales: { x: { grid: gridOpts(), ticks: { maxRotation: 45, maxTicksLimit: 12 } }, y: { grid: gridOpts(), title: { display: true, text: 'Growth Index (100 = start)', color: '#64748b' } } }
        }
    });
}

// ===== DRIVER CHART =====
function initDriverChart() {
    const ctx = document.getElementById('driverChart');
    if (!ctx) return;
    const drivers = [
        { name: 'Total Trades (No)', score: 0.8425 }, { name: 'Trades ARR (month)', score: 0.8332 },
        { name: 'Scheduled Volume', score: 0.4904 }, { name: 'Unique Participants', score: 0.4874 },
        { name: 'Deals', score: 0.2930 }, { name: 'Deals ARR (month)', score: 0.2799 },
        { name: 'Deal Vol Supply Chain', score: 0.2711 }, { name: 'Successful Participants', score: 0.2581 },
        { name: 'Platform Delivered Vol', score: 0.2529 }, { name: 'Seller Delivered Vol', score: 0.2515 },
    ];
    new Chart(ctx, {
        type: 'bar',
        data: { labels: drivers.map(d => d.name), datasets: [{ label: 'Composite Importance', data: drivers.map(d => d.score), backgroundColor: drivers.map((_, i) => i < 2 ? COLORS.blue : i < 4 ? COLORS.purple : COLORS.cyanAlpha), borderColor: drivers.map((_, i) => i < 2 ? COLORS.blue : i < 4 ? COLORS.purple : COLORS.cyan), borderWidth: 1.5, borderRadius: 6 }] },
        options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false }, tooltip: tooltipOpts() }, scales: { x: { grid: gridOpts(), title: { display: true, text: 'Composite Importance Score', color: '#64748b' } }, y: { grid: { display: false } } } }
    });
}

// ===== CORRELATION CHART =====
function initCorrChart() {
    const ctx = document.getElementById('corrChart');
    if (!ctx) return;
    const data = [
        { name: 'Total Trades (No)', r: [0.969, 0.797, 0.969, 0.505] },
        { name: 'Unique Participants', r: [0.940, 0.741, 0.940, 0.447] },
        { name: 'Deals', r: [0.919, 0.714, 0.919, 0.540] },
        { name: 'Scheduled Volume', r: [0.880, 0.660, 0.880, 0.562] },
        { name: 'Platform Del Vol', r: [0.856, 0.708, 0.856, 0.547] },
        { name: 'Successful Part.', r: [0.926, 0.679, 0.926, 0.487] },
    ];
    const labels = ['Sell (No)', 'Sell (V)', 'Manual (No)', 'Manual (V)'];
    const colors = [COLORS.blue, COLORS.purple, COLORS.green, COLORS.orange];
    new Chart(ctx, {
        type: 'bar',
        data: { labels: data.map(d => d.name), datasets: labels.map((lbl, i) => ({ label: lbl, data: data.map(d => d.r[i]), backgroundColor: colors[i].replace('1)', '0.2)'), borderColor: colors[i], borderWidth: 1.5, borderRadius: 4 })) },
        options: { responsive: true, plugins: { legend: { position: 'top' }, tooltip: tooltipOpts() }, scales: { x: { grid: gridOpts() }, y: { grid: gridOpts(), min: 0.3, max: 1.0, title: { display: true, text: 'Pearson r', color: '#64748b' } } } }
    });
}

// ===== LAG CHART =====
function initLagChart() {
    const ctx = document.getElementById('lagChart');
    if (!ctx) return;
    const d = [
        { name: 'Platform Delivered Vol', composite: 0.6968 }, { name: 'Rural Warehouse Out', composite: 0.6247 },
        { name: 'Successful Participants', composite: 0.5428 }, { name: 'Unique Participants', composite: 0.4571 },
        { name: 'Trades Lost', composite: 0.3708 }, { name: 'Total Trades (No)', composite: 0.3667 },
        { name: 'Trades ARR (month)', composite: 0.3074 }, { name: 'Deal Vol Supply Chain', composite: 0.2927 },
        { name: 'Open Interest', composite: 0.2683 }, { name: 'Scheduled Volume', composite: 0.2360 },
    ];
    new Chart(ctx, {
        type: 'bar',
        data: { labels: d.map(x => x.name), datasets: [{ label: 'Lagged Composite Score', data: d.map(x => x.composite), backgroundColor: COLORS.cyanAlpha, borderColor: COLORS.cyan, borderWidth: 1.5, borderRadius: 6 }] },
        options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false }, tooltip: tooltipOpts() }, scales: { x: { grid: gridOpts(), title: { display: true, text: 'Importance (t → t+1)', color: '#64748b' } }, y: { grid: { display: false } } } }
    });
}

// ===== LAG DECAY =====
function initLagDecayChart() {
    const ctx = document.getElementById('lagDecayChart');
    if (!ctx) return;
    const lagData = {
        'Unique Participants': [0.940, 0.872, 0.888, 0.821],
        'Deals': [0.919, 0.850, 0.834, 0.790],
        'Scheduled Vol': [0.880, 0.834, 0.827, 0.770],
        'Platform Del Vol': [0.856, 0.832, 0.823, 0.802],
        'Pass Through Vol': [0.745, 0.797, 0.834, 0.762],
    };
    const colors = [COLORS.blue, COLORS.purple, COLORS.green, COLORS.orange, COLORS.cyan];
    new Chart(ctx, {
        type: 'line',
        data: { labels: ['Lag 0', 'Lag 1', 'Lag 2', 'Lag 3'], datasets: Object.entries(lagData).map(([name, vals], i) => ({ label: name, data: vals, borderColor: colors[i], borderWidth: 2.5, pointRadius: 5, pointBackgroundColor: colors[i], fill: false })) },
        options: { responsive: true, plugins: { legend: { position: 'top' }, tooltip: tooltipOpts() }, scales: { x: { grid: gridOpts(), title: { display: true, text: 'Lag (months ahead)', color: '#64748b' } }, y: { grid: gridOpts(), min: 0.7, max: 0.96, title: { display: true, text: 'Pearson r', color: '#64748b' } } } }
    });
}

// ===== SCENARIO CHART =====
function initScenarioCharts() {
    const ctx = document.getElementById('scenarioChartV');
    if (!ctx) return;
    const scenarios = ['Platform\nVol +10%', 'Platform\nVol +20%', 'Seller\nVol +10%', 'Seller\nVol +20%', 'Open Int\n+10%', 'Open Int\n+20%'];
    const pcts = [5.3, 10.5, 1.7, 3.4, 2.1, 4.3];
    new Chart(ctx, {
        type: 'bar',
        data: { labels: scenarios, datasets: [{ label: 'Impact %', data: pcts, backgroundColor: pcts.map((v, i) => i < 2 ? COLORS.blueAlpha : i < 4 ? COLORS.purpleAlpha : COLORS.greenAlpha), borderColor: pcts.map((v, i) => i < 2 ? COLORS.blue : i < 4 ? COLORS.purple : COLORS.green), borderWidth: 1.5, borderRadius: 8 }] },
        options: { responsive: true, plugins: { legend: { display: false }, tooltip: { ...tooltipOpts(), callbacks: { label: ctx => '+' + ctx.parsed.y.toFixed(1) + '%' } } }, scales: { x: { grid: gridOpts() }, y: { grid: gridOpts(), title: { display: true, text: '% Change', color: '#64748b' }, ticks: { callback: v => '+' + v + '%' } } } }
    });
}

// ===== KPI ANIMATIONS =====
function animateKPIs() {
    [
        { id: 'kpiSellCount', target: 620 }, { id: 'kpiSellVol', target: 432387 },
        { id: 'kpiManualCount', target: 660 }, { id: 'kpiManualVol', target: 81607 },
    ].forEach(kpi => {
        const el = document.getElementById(kpi.id);
        if (!el) return;
        let cur = 0; const step = Math.max(1, Math.ceil(kpi.target / 50));
        const interval = setInterval(() => { cur += step; if (cur >= kpi.target) { cur = kpi.target; clearInterval(interval); } el.textContent = cur.toLocaleString(); }, 20);
    });
}
