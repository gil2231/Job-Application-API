import { spawn } from "node:child_process";
import pg from "pg";

/**
 * pg_dump / pg_restore wrappers. Credentials are passed through PG*
 * environment variables, never on the command line where `ps` would show them.
 */
export function pgEnv(databaseUrl: string): NodeJS.ProcessEnv {
  const u = new URL(databaseUrl);
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    PGHOST: decodeURIComponent(u.hostname),
    PGPORT: u.port || "5432",
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: decodeURIComponent(u.pathname.replace(/^\//, "")),
    PGCONNECT_TIMEOUT: "15",
    PGAPPNAME: "applyance-backup",
  };
  const sslmode = u.searchParams.get("sslmode");
  if (sslmode) env.PGSSLMODE = sslmode;
  else if (u.searchParams.get("ssl") === "true") env.PGSSLMODE = "require";
  return env;
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr = (stderr + d.toString()).slice(-4000)));
    child.on("error", (err: NodeJS.ErrnoException) =>
      reject(err.code === "ENOENT" ? new Error(`${command} is not installed. Install the PostgreSQL client tools (postgresql-client) matching your server's version`) : err),
    );
    child.on("close", (code) => {
      if (code === 0) return resolve(stdout);
      const detail = stderr.trim() || `exit code ${code}`;
      if (/server version mismatch/i.test(detail)) {
        return reject(new Error(`${command} is older than the database server. Install a postgresql-client at least as new as the server (${detail})`));
      }
      reject(new Error(`${command} failed: ${detail}`));
    });
  });
}

export async function pgToolVersion(tool: "pg_dump" | "pg_restore"): Promise<string> {
  return (await run(tool, ["--version"], { PATH: process.env.PATH })).trim();
}

/** Opens a client with Prisma-style URLs (Prisma's own query options are dropped). */
export function connect(databaseUrl: string): pg.Client {
  const u = new URL(databaseUrl);
  for (const key of [...u.searchParams.keys()]) if (!["sslmode", "ssl", "options", "application_name"].includes(key)) u.searchParams.delete(key);
  return new pg.Client({ connectionString: u.toString(), application_name: "applyance-backup", connectionTimeoutMillis: 15_000 });
}

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** Exact row count of every table in the public schema. */
export async function tableCounts(client: pg.Client): Promise<Record<string, number>> {
  const { rows } = await client.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
  const counts: Record<string, number> = {};
  for (const { tablename } of rows) {
    const res = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.${quoteIdent(tablename)}`);
    counts[tablename] = Number(res.rows[0]!.n);
  }
  return counts;
}

export interface DumpResult {
  counts: Record<string, number>;
  serverVersion: string;
  database: string;
}

/**
 * Dumps the database in pg_dump's compressed custom format. The row counts
 * are read inside the same snapshot pg_dump uses, so the restore test can
 * demand an exact match even while people are using the app.
 */
export async function dumpDatabase(databaseUrl: string, outFile: string): Promise<DumpResult> {
  const client = connect(databaseUrl);
  await client.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const snapshot = (await client.query<{ s: string }>("SELECT pg_export_snapshot() AS s")).rows[0]!.s;
    const info = (await client.query<{ v: string; db: string }>("SELECT current_setting('server_version') AS v, current_database() AS db")).rows[0]!;
    const dump = run("pg_dump", ["--format=custom", "--compress=6", "--no-owner", "--no-acl", `--snapshot=${snapshot}`, `--file=${outFile}`], pgEnv(databaseUrl));
    // Count while pg_dump runs; both read the same snapshot.
    const [counts] = await Promise.all([tableCounts(client), dump]);
    await client.query("COMMIT");
    return { counts, serverVersion: info.v, database: info.db };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (/pg_export_snapshot|cannot export a snapshot/i.test((err as Error).message)) {
      throw new Error(
        "The database connection doesn't support snapshots, which usually means it goes through a connection pooler. Set BACKUP_DATABASE_URL to the direct (unpooled) connection string",
        { cause: err },
      );
    }
    throw err;
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function listPublicTables(databaseUrl: string): Promise<string[]> {
  const client = connect(databaseUrl);
  await client.connect();
  try {
    const { rows } = await client.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
    return rows.map((r) => r.tablename);
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** Drops and recreates the public schema. Only ever called on the restore-test scratch database. */
export async function resetScratchDatabase(databaseUrl: string): Promise<void> {
  const client = connect(databaseUrl);
  await client.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** Restores a dump into an empty database, all or nothing. */
export async function restoreDump(databaseUrl: string, dumpFile: string): Promise<void> {
  const env = pgEnv(databaseUrl);
  await run("pg_restore", ["--no-owner", "--no-acl", "--exit-on-error", "--single-transaction", `--dbname=${env.PGDATABASE}`, dumpFile], env);
}

export async function countRows(databaseUrl: string): Promise<Record<string, number>> {
  const client = connect(databaseUrl);
  await client.connect();
  try {
    return await tableCounts(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}
