import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const rootEnv = resolve(__dirname, "../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL must be set to run notification tests (it is reset by the run)");

export default defineConfig({
  test: {
    globalSetup: ["../database/test/global-setup.ts"],
    fileParallelism: false,
    env: {
      DATABASE_URL: testDatabaseUrl,
      DATA_ENCRYPTION_KEY: process.env.DATA_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64"),
      // Analysis must be deterministic in tests, whatever the developer's environment has.
      AI_PROVIDER: "none",
      ANTHROPIC_API_KEY: "",
      APP_URL: "https://app.example.com",
      EMAIL_PROVIDER: "",
    },
    testTimeout: 20_000,
  },
});
