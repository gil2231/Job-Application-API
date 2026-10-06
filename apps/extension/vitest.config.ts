import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defineConfig } from "vitest/config";

const rootEnv = resolve(__dirname, "../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL must be set to run the extension tests");

export default defineConfig({
  test: {
    globalSetup: ["../../packages/database/test/global-setup.ts"],
    fileParallelism: false,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      DATA_ENCRYPTION_KEY: process.env.DATA_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64"),
      STORAGE_DRIVER: "local",
      STORAGE_LOCAL_DIR: mkdtempSync(join(tmpdir(), "applyance-extension-test-")),
      APP_URL: "http://localhost:3000",
    },
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
