# Monitoring and backups

This is how Applyance tells you something is wrong before your users do, and how your data survives a lost database. Everything here is off until you add the settings below, and none of it needs a paid plan to start.

There are three parts:

| Part | What it does | What you sign up for |
| --- | --- | --- |
| Error alerts | Every crash in the web app, API, worker or browser is sent to you with where it happened. Personal data is removed first. | [Sentry](https://sentry.io) (or self-hosted [GlitchTip](https://glitchtip.com)) |
| Uptime checks | A service outside your hosting checks the site every few minutes and emails or texts you when it's down, the worker stopped, or a backup was missed. | [Better Stack](https://betterstack.com/uptime) or [UptimeRobot](https://uptimerobot.com) |
| Database backups | An encrypted copy of the database every night, kept for 30 days in a separate storage bucket, and a weekly test that restores it and checks every table. | [Cloudflare R2](https://www.cloudflare.com/developer-platform/r2/) or [Backblaze B2](https://www.backblaze.com/cloud-storage) (any S3-compatible storage works) |

All settings go in the same place as your other environment variables on your host. Set the error reporting ones on the web app, the API and the worker, and the backup ones on the worker.

## 1. Error alerts (Sentry)

1. Create a free account at sentry.io.
2. Create a project. For the platform, choose **Node.js**. Name it `applyance`.
3. Sentry shows a **DSN**, a link that looks like `https://abc123@o456.ingest.sentry.io/789`. (Later: Settings → Projects → applyance → Client Keys.)
4. Add it to the web app, API and worker:

   ```
   ERROR_REPORTING_DSN=https://abc123@o456.ingest.sentry.io/789
   APP_ENV=production
   ```

5. Redeploy, then from a terminal with the same settings run `pnpm ops test-alert`. A test error should appear in Sentry within a minute, and Sentry emails you about new problems by default.

What is sent: the error message and stack, the route pattern (like `/applications/:id`, never the real address), the service name, and the user's internal id. Emails, phone numbers, tokens, passwords and connection strings are removed from messages, and request bodies, cookies and headers are never sent. At most 30 reports a minute leave each process, so a crash loop can't use up your Sentry quota.

## 2. Uptime checks (Better Stack or UptimeRobot)

Applyance has two health addresses:

| Address | Fails when |
| --- | --- |
| `https://YOUR-DOMAIN/api/health` | The site is down or can't reach its database |
| `https://YOUR-DOMAIN/api/health/ready` | Any of: the database, Redis, no worker running, the newest backup is older than 26 hours, or the last restore test failed |

1. Create a free account at Better Stack (Uptime) or UptimeRobot.
2. Add a monitor of type **HTTP(s)** / **URL** for `https://YOUR-DOMAIN/api/health/ready`, checked every 3 to 5 minutes, alerting when the status code isn't 2xx.
3. Add a second monitor for `https://YOUR-DOMAIN/api/health`. When only the first one is red, the site is up but something behind it (worker, backups) needs you; open the address in a browser to see which part says `"fail"`.
4. If the API runs as its own service, add a third monitor for `https://YOUR-API-DOMAIN/health`.
5. Turn on email and phone app notifications for yourself.

Parts that aren't set up yet show `"off"` and don't turn the monitor red.

## 3. Nightly encrypted backups

Your hosting provider's own database backups are the first line: turn them on (and point-in-time recovery if offered). Applyance's backups are a second, independent copy in another company's storage, encrypted with a key only you hold, so losing one provider or account doesn't lose your users' data.

### Set it up

1. **Create a bucket** at Cloudflare R2 or Backblaze B2 named something like `applyance-backups`. Use a different bucket from the one that stores resumes. If offered, turn on versioning or object lock.
2. **Create an access key** that can only read and write that bucket. Note the key id, secret, and the bucket's S3 endpoint.
3. **Create the encryption key.** Run `pnpm ops generate-key` (or `openssl rand -base64 32`). Save it in your password manager now. **Without this key, the backups can't be opened by anyone, including you.** It must be different from `DATA_ENCRYPTION_KEY`, and you also need that one to use a restored database.
4. **Create an empty scratch database** for the weekly restore test, for example a second database named `applyance_restore_test` on the same Postgres server. It's wiped and refilled each week, and emptied again after each test.
5. **Add these settings** to the worker:

   ```
   BACKUP_ENCRYPTION_KEY=<from step 3>
   BACKUP_S3_BUCKET=applyance-backups
   BACKUP_S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
   BACKUP_S3_REGION=auto
   BACKUP_S3_ACCESS_KEY_ID=<from step 2>
   BACKUP_S3_SECRET_ACCESS_KEY=<from step 2>
   BACKUP_VERIFY_DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/applyance_restore_test
   ```

   Give the web app the same `BACKUP_S3_*` bucket settings too (not the encryption key or the scratch database), so its health check can see when the last backup and restore test ran. A read-only key for the bucket is enough there.

   If your `DATABASE_URL` goes through a connection pooler (Neon's `-pooler` address, Supabase's port 6543, PgBouncer), also set `BACKUP_DATABASE_URL` to the direct connection string.

6. **The worker needs the Postgres client tools** (`pg_dump` and `pg_restore`), at least as new as your database server. On Debian or Ubuntu images that is the `postgresql-client-16` package (or 17, to match your server).
7. Redeploy the worker. Its log says `backups to bucket applyance-backups on "0 3 * * *" UTC`.
8. Check it now instead of waiting for tonight: `pnpm ops backup`, then `pnpm ops test-restore`. Both should end with a success line.

### What runs, and when

| When | What | If it fails |
| --- | --- | --- |
| Every night at 03:00 UTC | Dump the database, encrypt it, upload it with a manifest of every table's row count, delete backups older than 30 days (always keeping the newest 7) | Retried twice, 5 and 10 minutes later, then you get an alert, and the readiness check turns red after 26 hours without a backup |
| Sundays at 04:30 UTC | Download the newest backup, check its checksum, decrypt it, restore it into the scratch database, and compare every table's row count with the manifest | Alert, and the readiness check turns red |

Encryption is AES-256-GCM, done before upload, so the storage provider only ever holds ciphertext. A changed or damaged file fails its integrity check instead of restoring bad data. Row counts are read inside the same database snapshot as the dump, so the restore test can demand an exact match even while people use the app.

## If you need to restore

1. Create a **new, empty** database (never restore over the live one). The restore refuses a database that already has tables.
2. From a machine with the repository, the Postgres client tools and the backup settings above:

   ```bash
   pnpm ops list                                    # newest first
   pnpm ops restore --target-url "postgresql://...new-db..." --yes
   # or a specific one:  --file applyance-20261006T030000Z.dump.enc
   ```

   It downloads, verifies and decrypts the backup, restores it in a single transaction (all or nothing), and checks every table's row count.
3. Point `DATABASE_URL` at the new database and restart the web app, API and worker. Keep the same `DATA_ENCRYPTION_KEY`.

To rotate the backup key: move the old key into `BACKUP_PREVIOUS_ENCRYPTION_KEYS` (comma-separated) and set the new one as `BACKUP_ENCRYPTION_KEY`. New backups use the new key, and older ones still restore.

## All settings

| Variable | Default | |
| --- | --- | --- |
| `ERROR_REPORTING_DSN` | | Sentry or GlitchTip DSN. Off when empty |
| `APP_ENV` | `NODE_ENV` | Environment name shown on reports and alerts |
| `APP_RELEASE` | host's commit id | Version shown on reports |
| `ALERT_WEBHOOK_URL` | | Optional Slack or Discord incoming webhook for backup alerts (they also go to Sentry) |
| `BACKUP_ENCRYPTION_KEY` | | 32 bytes, base64. Backups are off without it |
| `BACKUP_PREVIOUS_ENCRYPTION_KEYS` | | Retired keys, comma-separated, for restoring older backups |
| `BACKUP_S3_BUCKET` | | Backup bucket. Endpoint, region and keys fall back to the `S3_*` ones |
| `BACKUP_S3_ENDPOINT`, `BACKUP_S3_REGION`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`, `BACKUP_S3_FORCE_PATH_STYLE` | | Connection to the backup bucket |
| `BACKUP_LOCAL_DIR` | | A folder instead of a bucket, for local development only |
| `BACKUP_DATABASE_URL` | `DATABASE_URL` | Direct (unpooled) connection for `pg_dump` |
| `BACKUP_PREFIX` | `database/` | Folder inside the bucket |
| `BACKUP_SCHEDULE` | `0 3 * * *` | When backups run (cron) |
| `BACKUP_VERIFY_SCHEDULE` | `30 4 * * 0` | When the restore test runs (cron) |
| `BACKUP_TIMEZONE` | `UTC` | Time zone for both schedules |
| `BACKUP_VERIFY_DATABASE_URL` | | Scratch database for the restore test; it's wiped each time. Refused if it's the live database |
| `BACKUP_RETENTION_DAYS` | `30` | Delete backups older than this |
| `BACKUP_KEEP_MIN` | `7` | Always keep at least this many, however old |
| `BACKUP_MAX_AGE_HOURS` | `26` | The readiness check fails when the newest backup is older |

## Commands

Run from the repository root with the production settings loaded:

| Command | |
| --- | --- |
| `pnpm ops backup` | Back up now |
| `pnpm ops list` | List backups |
| `pnpm ops test-restore [--file NAME]` | Run the restore test now |
| `pnpm ops restore --target-url URL [--file NAME] --yes` | Restore into a new, empty database |
| `pnpm ops status` | Backup and restore-test health |
| `pnpm ops test-alert` | Send a test error report and alert |
| `pnpm ops generate-key` | Print a new backup encryption key |

Uploaded resumes and documents live in the document bucket, not the database. Turn on versioning for that bucket at your storage provider so a deleted or overwritten file can be recovered.
