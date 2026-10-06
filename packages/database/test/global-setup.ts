import { execSync } from "node:child_process";

/**
 * Bring the dedicated test database up to the current migrations. Each test
 * file truncates its tables (see helpers.ts), so no destructive reset is needed.
 */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL!;
  if (!/test/i.test(new URL(url).pathname)) {
    throw new Error("TEST_DATABASE_URL must point at a database whose name contains 'test'; its tables are truncated by the tests");
  }
  execSync("npx prisma migrate deploy", {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}
