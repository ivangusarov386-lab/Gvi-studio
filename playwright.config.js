import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
process.env.PLAYWRIGHT_BROWSERS_PATH ||= new URL(
  "./.local/browsers",
  import.meta.url,
).pathname;
const executablePath =
  process.env.CHROMIUM_PATH ||
  (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
const chromium = { launchOptions: { executablePath } };
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:3100", trace: "off", screenshot: "off" },
  webServer: [
    {
      command: "PORT=3100 GTO_MODE=demo npm start",
      url: "http://127.0.0.1:3100",
      reuseExistingServer: false,
    },
    {
      command: "node tests/serve-pages.js",
      url: "http://127.0.0.1:3101/Gvi-studio/",
      reuseExistingServer: false,
    },
  ],
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], ...chromium } },
    {
      name: "iphone-chromium",
      use: {
        ...devices["iPhone 13"],
        defaultBrowserType: "chromium",
        ...chromium,
      },
    },
    ...(process.env.GVI_TEST_WEBKIT === "1"
      ? [
          {
            name: "iphone-webkit",
            use: { ...devices["iPhone 13"], defaultBrowserType: "webkit" },
          },
        ]
      : []),
  ],
});
