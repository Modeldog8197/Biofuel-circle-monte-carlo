import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.js",
  use: {
    launchOptions: process.env.LOCAL_BROWSER
      ? {
          executablePath: process.env.LOCAL_BROWSER,
          args: [
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--single-process",
            "--no-zygote",
          ],
        }
      : {},
    baseURL: "http://127.0.0.1:4173",
  },
  webServer: {
    command: "python3 -m http.server 4173 --bind 127.0.0.1",
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
});
