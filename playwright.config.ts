import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const previewURL = new URL(baseURL);

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  outputDir: ".qa/playwright/results",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    channel: process.platform === "win32" ? "msedge" : undefined,
    headless: true,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    acceptDownloads: true,
    launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
  },
  webServer: {
    command: "npm run preview -- --vercel",
    url: baseURL,
    env: { PORT: previewURL.port || (previewURL.protocol === "https:" ? "443" : "80") },
    reuseExistingServer: true,
    timeout: 90_000,
  },
});
