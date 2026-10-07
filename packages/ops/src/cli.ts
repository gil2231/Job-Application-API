import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { sendAlert } from "./alerts";
import { restoreBackup, runBackup, testRestore } from "./backup/backup";
import { listBackups } from "./backup/catalog";
import { loadBackupConfig } from "./backup/config";
import { captureException, flushErrorReports, initErrorReporting } from "./errors";
import { backupHealthChecks } from "./health";

/**
 * Operations commands: `pnpm ops <command>` from the repository root.
 *
 *   backup                       Back up the database now
 *   list                         List backups, newest first
 *   test-restore [--file NAME]   Restore a backup into BACKUP_VERIFY_DATABASE_URL and check it
 *   restore --target-url URL [--file NAME] --yes
 *                                Restore into a new, empty database (disaster recovery)
 *   status                       Show backup and restore-test health
 *   test-alert                   Send a test error report and alert, to check your setup
 *   generate-key                 Print a new BACKUP_ENCRYPTION_KEY
 */
const rootEnv = resolve(import.meta.dirname, "../../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
initErrorReporting("ops");

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { file: { type: "string" }, "target-url": { type: "string" }, yes: { type: "boolean", default: false } },
});
const command = positionals[0];

const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`;

async function main(): Promise<number> {
  switch (command) {
    case "generate-key":
      console.warn(randomBytes(32).toString("base64"));
      console.warn("Save this in your password manager too. Without it, backups can't be decrypted.");
      return 0;
    case "backup": {
      const config = loadBackupConfig();
      console.warn(`Backing up to ${config.store.description}…`);
      const m = await runBackup(config);
      const rows = Object.values(m.counts).reduce((a, b) => a + b, 0);
      console.warn(`Done: ${m.file} (${mb(m.bytes)}, ${Object.keys(m.counts).length} tables, ${rows} rows, ${Math.round(m.durationMs / 1000)}s)`);
      return 0;
    }
    case "list": {
      const config = loadBackupConfig();
      const backups = await listBackups(config.store, config.prefix);
      if (!backups.length) console.warn("No backups yet.");
      for (const b of backups) console.warn(`${b.createdAt.toISOString()}  ${mb(b.size).padStart(10)}  ${b.file}`);
      return 0;
    }
    case "test-restore": {
      const config = loadBackupConfig();
      console.warn("Restoring into the scratch database and checking every table…");
      const r = await testRestore(config, { file: values.file });
      if (r.ok) {
        console.warn(`Restore test passed: ${r.backup}, ${r.tables} tables, ${r.rows} rows match (${Math.round(r.durationMs / 1000)}s)`);
        return 0;
      }
      console.error(`Restore test FAILED: ${r.error}`);
      for (const m of r.mismatches) console.error(`  ${m.table}: expected ${m.expected ?? "missing"}, restored ${m.restored ?? "missing"}`);
      await sendAlert({ key: "restore-test-failed", title: "Database restore test failed", detail: r.error });
      return 1;
    }
    case "restore": {
      const target = values["target-url"];
      if (!target) {
        console.error("Pass --target-url with the connection string of a NEW, EMPTY database.");
        return 2;
      }
      if (!values.yes) {
        console.error("This restores a backup into the target database. Re-run with --yes to confirm.");
        return 2;
      }
      const config = loadBackupConfig();
      const { manifest, counts } = await restoreBackup(config, target, { file: values.file });
      console.warn(`Restored ${manifest.file} (taken ${manifest.createdAt}): ${Object.keys(counts).length} tables, all row counts match.`);
      console.warn("Next: point DATABASE_URL at this database and restart the web app, API and worker. Keep the same DATA_ENCRYPTION_KEY.");
      return 0;
    }
    case "status": {
      const { backups, restoreTest } = await backupHealthChecks();
      console.warn(`Backups:      ${backups.state}${backups.note ? ` (${backups.note})` : ""}`);
      console.warn(`Restore test: ${restoreTest.state}${restoreTest.note ? ` (${restoreTest.note})` : ""}`);
      return backups.state === "fail" || restoreTest.state === "fail" ? 1 : 0;
    }
    case "test-alert": {
      if (!process.env.ERROR_REPORTING_DSN && !process.env.ALERT_WEBHOOK_URL) {
        console.error("Neither ERROR_REPORTING_DSN nor ALERT_WEBHOOK_URL is set, so there is nowhere to send a test.");
        return 1;
      }
      captureException(new Error("Test error from Applyance (pnpm ops test-alert). You can ignore or resolve this."), { level: "info", tags: { test: true } });
      await sendAlert({ key: "test", title: "Test alert from Applyance", detail: "If you can read this, alerts reach you.", severity: "warning" });
      console.warn("Sent. Check your error reporting inbox and your alert channel.");
      return 0;
    }
    default:
      console.error("Usage: pnpm ops <backup | list | test-restore | restore | status | test-alert | generate-key>");
      return 2;
  }
}

let code = 1;
try {
  code = await main();
} catch (err) {
  console.error(`Error: ${(err as Error).message}`);
  if (command === "backup") await sendAlert({ key: "backup-failed", title: "Database backup failed", detail: (err as Error).message });
  else captureException(err, { tags: { command: command ?? "none" } });
}
await flushErrorReports();
process.exit(code);
