import { test, expect } from "@playwright/test";
async function start(page) {
  await page.goto("/");
  await expect(page.locator("#status")).toContainText("20,000 paths");
}
async function tool(page, id) {
  await page.locator(`.workspace-nav a[href="#${id}"]`).click();
  await expect(page.locator("#" + id)).toBeVisible();
}
for (const width of [1440, 390])
  test(`complete interactive workspace at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await start(page);
    await expect(page.locator("#forecast-rows tr")).toHaveCount(4);
    await expect(page.locator("#forecast-chart")).toHaveAttribute(
      "data-visible-points",
      "16",
    );
    await expect(page.locator("#path-note")).toContainText("central paths");
    await expect(page.locator("#forecast-chart svg path")).not.toHaveCount(3);
    await page.locator("#metric").selectOption("Manual Responses (No)");
    await expect(page.locator("#model-explanation")).toContainText(
      "flat point forecast",
    );
    await page.locator("#forecast-chart").focus();
    await page.keyboard.press("End");
    await expect(page.locator("#forecast-chart .chart-tooltip")).toContainText(
      "Aug 2026",
    );
    await page.keyboard.press("Escape");
    await expect(page.locator("#forecast-chart .chart-tooltip")).toBeHidden();
    await page.locator('[data-view="distribution"][role=tab]').click();
    await expect(page.locator("#distribution-chart svg")).toBeVisible();
    await page.locator('[data-view="probability"][role=tab]').click();
    await page.locator("#probability-chart").focus();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await expect(page.locator("#threshold-month")).toHaveValue("3");
    await expect(page.locator("#threshold-result")).toContainText("0.0%");
    for (const id of [
      "overview",
      "trends",
      "relationships",
      "lagged",
      "scenarios",
      "summary",
      "evaluation",
    ]) {
      await tool(page, id);
      const svg =
        id === "overview"
          ? "#overview-chart"
          : id === "trends"
            ? "#trend-chart"
            : id === "relationships"
              ? "#driver-scatter"
              : id === "lagged"
                ? "#lag-chart"
                : id === "scenarios"
                  ? "#scenario-chart"
                  : null;
      if (svg) await expect(page.locator(svg + " svg")).toBeVisible();
    }
    await expect(page.locator("#evaluation-note")).toContainText("higher MAE");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    expect(errors).toEqual([]);
  });
test("hover, legend toggles, drag zoom and reset change the displayed chart", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await start(page);
  const svg = page.locator("#forecast-chart svg"),
    box = await svg.boundingBox();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.45);
  await expect(page.locator("#forecast-chart .chart-tooltip")).toBeVisible();
  const toggle = page
    .locator("#forecast-chart .legend-toggle")
    .filter({ hasText: "Model point" });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.5, {
    steps: 8,
  });
  await page.mouse.up();
  const count = Number(
    await page.locator("#forecast-chart").getAttribute("data-visible-points"),
  );
  expect(count).toBeLessThan(16);
  expect(count).toBeGreaterThan(2);
  await page.locator("#forecast-chart .reset-zoom").click();
  await expect(page.locator("#forecast-chart")).toHaveAttribute(
    "data-visible-points",
    "16",
  );
  await page.locator("#history-window").selectOption("1");
  await expect(page.locator("#forecast-chart")).toHaveAttribute(
    "data-visible-points",
    "5",
  );
});
test("correlation cells and lag cells update the selected data pair", async ({
  page,
}) => {
  await start(page);
  await tool(page, "relationships");
  await page.locator("#matrix-size").selectOption("32");
  await expect(page.locator("#correlation-matrix tbody tr")).toHaveCount(32);
  const cell = page.locator(
    '#correlation-matrix button[data-row="4"][data-col="0"]',
  );
  await cell.click();
  await expect(page.locator("#scatter-title")).toContainText(
    await page.locator("#driver").inputValue(),
  );
  await tool(page, "lagged");
  const lagCell = page.locator(
    '#lag-matrix button[data-row="0"][data-col="3"]',
  );
  await lagCell.click();
  await expect(page.locator("#lag")).toHaveValue("3");
  await expect(page.locator("#lag-stats")).toContainText("lag 3");
});
test("scenarios alter outcomes, preserve the baseline and save reproducible comparisons", async ({
  page,
}) => {
  await start(page);
  const before = await page.locator("#forecast-rows").innerText();
  await tool(page, "scenarios");
  await expect(page.locator("#scenario-status")).toContainText("computed");
  await page.locator('[data-preset="platform20"]').click();
  await expect(page.locator("#save-scenario")).toBeEnabled();
  await expect(page.locator("#scenario-status")).toContainText("computed");
  await page.locator("#save-scenario").click();
  await expect(page.locator("#saved-scenarios")).toContainText("20%");
  const promise = page.waitForEvent("download");
  await tool(page, "forecast");
  await page.locator("#export-json").click();
  const download = await promise,
    stream = await download.createReadStream(),
    chunks = [];
  for await (const c of stream) chunks.push(c);
  const report = JSON.parse(Buffer.concat(chunks));
  expect(report.scenario.assumptions.drivers["Platform delivered Vol"]).toBe(
    20,
  );
  expect(report.saved_comparisons).toHaveLength(1);
  expect(await page.locator("#forecast-rows").innerText()).toBe(before);
});
test("manual models and exports retain executed seed despite edits to controls", async ({
  page,
}) => {
  await start(page);
  await page.locator("#model-select").selectOption("Damped trend");
  await expect(page.locator("#status")).toContainText("20,000 paths");
  await expect(page.locator("#forecast-context")).toContainText("Damped trend");
  await page.locator("#seed").fill("42");
  await page.locator("#run").click();
  await expect(page.locator("#status")).toContainText("seed 42");
  await page.locator("#seed").fill("7");
  const promise = page.waitForEvent("download");
  await page.locator("#export-json").click();
  const download = await promise,
    stream = await download.createReadStream(),
    chunks = [];
  for await (const c of stream) chunks.push(c);
  const report = JSON.parse(Buffer.concat(chunks));
  expect(report.browser_run.seed).toBe(42);
  expect(report.browser_run.model).toBe("Damped trend");
  expect(
    Object.values(report.browser_run.forecasts).every(
      (t) => t.forecast.length === 4 && t.model === "Damped trend",
    ),
  ).toBeTruthy();
});
