/**
 * Give an existing account access to the owner admin panel, or take it away.
 *
 *   pnpm admin:grant you@example.com
 *   pnpm admin:revoke someone@example.com
 *
 * Uses DATABASE_URL (from the environment, or the repo's .env file). The app
 * has no screen for changing roles, so this command is the only way in.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const rootEnv = resolve(import.meta.dirname, "../../../.env");
if (!process.env.DATABASE_URL && existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const [command, email] = process.argv.slice(2);
if ((command !== "grant" && command !== "revoke") || !email) {
  console.error("Usage: pnpm admin:grant <email>  |  pnpm admin:revoke <email>");
  process.exit(1);
}

const { NotFoundError, prisma, setUserRole } = await import("../src/index");
try {
  const user = await setUserRole(email, command === "grant" ? "ADMIN" : "USER");
  process.stdout.write(command === "grant" ? `${user.email} is now an admin. Reload Applyance and choose Admin in the sidebar.\n` : `${user.email} is no longer an admin.\n`);
} catch (error) {
  if (error instanceof NotFoundError) {
    console.error(`No account uses ${email}. Sign up in Applyance with that email first, then run this again.`);
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  await prisma.$disconnect();
}
