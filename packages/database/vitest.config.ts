import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const rootEnv = resolve(__dirname, "../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL must be set to run database tests (it is reset by the run)");

export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    fileParallelism: false,
    env: {
      DATABASE_URL: testDatabaseUrl,
      DATA_ENCRYPTION_KEY: process.env.DATA_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64"),
    },
    testTimeout: 20_000,
  },
});
