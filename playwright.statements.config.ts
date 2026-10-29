import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/statements",
  timeout: 45000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5179",
    headless: true,
    trace: "retain-on-failure",
  },
  outputDir: "output/playwright/results",
  reporter: [
    ["list"],
    ["html", { outputFolder: "output/playwright/report", open: "never" }],
  ],
  webServer: {
    command: "npx tsx scripts/statement-fixture-server.ts",
    url: "http://127.0.0.1:5179/statements",
    reuseExistingServer: true,
    timeout: 60000,
  },
});
