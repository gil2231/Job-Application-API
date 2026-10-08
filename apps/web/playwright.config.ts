import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const rootEnv = resolve(import.meta.dirname, "../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const mockProviderPort = process.env.MOCK_PROVIDER_PORT ?? "4120";
const mockProviderUrl = `http://127.0.0.1:${mockProviderPort}`;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync("/opt/pw-browsers/chromium-1194/chrome-linux/chrome") ? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" : undefined);

/**
 * End-to-end tests run against the local app only (never real employer sites).
 * Each test creates its own user, so they can run against a shared dev database.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: 2,
  reporter: [["list"]],
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "chromium", testIgnore: /worker\.spec\.ts/, use: { ...devices["Desktop Chrome"], launchOptions: { executablePath } } },
    // Starts the real worker and the local mock application site. Runs last so
    // the worker doesn't pick up applications the other tests set up by hand.
    { name: "worker", testMatch: /worker\.spec\.ts/, dependencies: ["chromium"], use: { ...devices["Desktop Chrome"], launchOptions: { executablePath } } },
  ],
  webServer: [
    // Stands in for Google and Microsoft sign-in, Gmail, Outlook and their calendars.
    {
      command: "pnpm --filter @autoapply/inbox mock",
      url: `${mockProviderUrl}/__mock/events`,
      reuseExistingServer: true,
      timeout: 60_000,
      env: { MOCK_PROVIDER_PORT: mockProviderPort },
    },
    {
      command: "pnpm dev",
      url: `${baseURL}/api/health`,
      reuseExistingServer: true,
      timeout: 120_000,
      // Email sync talks to the mock provider, never to real Google or Microsoft accounts.
      env: {
        GOOGLE_ENDPOINT_BASE: mockProviderUrl,
        MICROSOFT_ENDPOINT_BASE: mockProviderUrl,
        GOOGLE_CLIENT_ID: "e2e-google-client",
        GOOGLE_CLIENT_SECRET: "e2e-google-secret",
        MICROSOFT_CLIENT_ID: "e2e-microsoft-client",
        MICROSOFT_CLIENT_SECRET: "e2e-microsoft-secret",
        // Job search reads stand-in boards instead of real employers' (see src/lib/fake-job-sources.ts).
        E2E_FAKE_JOB_SOURCES: "1",
      },
    },
  ],
});
