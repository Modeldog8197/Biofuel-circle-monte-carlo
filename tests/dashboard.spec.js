import { test, expect } from "@playwright/test";
for (const width of [1440, 390])
  test(`four-month dashboard at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await expect(page.locator("#status")).toContainText("20,000 paths");
    await expect(page.locator("#forecast-rows tr")).toHaveCount(4);
    await expect(page.locator("#forecast-rows")).toContainText("Aug 2026");
    await page.locator("#metric").selectOption("Manual Responses (No)");
    await expect(page.locator("#evaluation-note")).toContainText("higher MAE");
    await page.locator("#seed").fill("42");
    await page.locator("#run").click();
    await expect(page.locator("#status")).toContainText("seed 42");
    await page.locator("#seed").fill("7");
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#export-json").click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const json = JSON.parse(Buffer.concat(chunks));
    expect(json.browser_run.seed).toBe(42);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    expect(errors).toEqual([]);
  });
