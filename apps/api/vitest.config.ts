import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const rootEnv = resolve(__dirname, "../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL must be set to run API tests");

export default defineConfig({
  test: {
    globalSetup: ["../../packages/database/test/global-setup.ts"],
    env: { DATABASE_URL: process.env.TEST_DATABASE_URL, DATA_ENCRYPTION_KEY: process.env.DATA_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64") },
    testTimeout: 20_000,
  },
});
