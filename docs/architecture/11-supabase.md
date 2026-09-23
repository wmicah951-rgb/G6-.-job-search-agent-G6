# Postgres (Supabase)

The app talks to whichever database is configured, through one small interface:

| Configured | Used |
|---|---|
| `SUPABASE_DB_URL` (or `POSTGRES_URL` / `DATABASE_URL`) | Postgres — Supabase |
| `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` | Turso (libSQL) |
| neither | a local file, `local.db` |
| the configured one refuses to serve | temporary in-memory storage, with a banner saying nothing is being saved |

Every query in the app is written once, in SQLite form.
[`src/lib/pgClient.ts`](../../src/lib/pgClient.ts) translates the handful of SQLite-isms we use
when the deployment is Postgres:

| SQLite | Postgres |
|---|---|
| `?` placeholders | `$1`, `$2`, … |
| `datetime('now')` | `to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS')` — the same text shape, so anything reading or sorting those columns behaves identically |
| `INSERT OR IGNORE INTO` | `INSERT INTO … ON CONFLICT DO NOTHING` |
| `ON CONFLICT(a, b)` | `ON CONFLICT (a, b)` |

`npx tsx scripts/pg-translate-tests.ts` checks those rules and then runs **every** SQL string the
app issues (52 of them) through the translator, failing if any comes out still containing a `?`
or a SQLite-only function.

## Setting it up

1. In Supabase: **Project Settings → Database → Connection string → URI**, and copy it with the
   database password filled in. The **Session pooler** URI is the right one for a serverless
   deployment like Vercel.
2. Put it in `.env.local` (local) and in the Vercel project's environment variables
   (Production *and* Preview):

   ```
   SUPABASE_DB_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
   ```

   Use the **pooler** host, not the direct `db.<project-ref>.supabase.co` one. The direct host is
   IPv6-only on current Supabase projects and Vercel's functions are IPv4, so the live site failed
   with `getaddrinfo ENOTFOUND` even though it worked from a laptop. This project's pooler is
   `aws-0-ca-central-1`, on port **6543** (transaction mode — the right one for serverless, where
   many short-lived instances would exhaust session-mode connections).

3. TLS is verified against Supabase's own CA, committed at `certs/supabase-prod-ca.crt`
   (their direct host is not signed by a CA in the system store, so plain verification fails
   with "self-signed certificate in certificate chain"). The file ships with the deploy via
   `outputFileTracingIncludes` in `next.config.ts`. Override the path with
   `SUPABASE_CA_CERT_PATH` if you keep it elsewhere. Verification is never switched off: a
   connection that cannot be verified fails, which is the point.

4. Nothing else is needed: the schema is created on the first request
   (`ensureSchema()` in [`src/lib/db.ts`](../../src/lib/db.ts)), exactly as it was on Turso.
   `docs/supabase-schema.sql` holds the same statements if you would rather create the tables
   yourself in the SQL editor first. `npx tsx scripts/db-check.ts` connects, creates the schema
   and prints a row count per table — the quickest way to confirm a connection string works.

The `SUPABASE_URL` / publishable / secret keys are for Supabase's REST and auth APIs. This app
does not use them — it speaks SQL directly — so the connection string is the only value it
needs. Keep all of them out of git (`.env.local` is ignored); if a key has been pasted into a
chat or a document, rotate it in the dashboard.

## What happened to Turso

The Turso database this project used hit its plan limit and began refusing **every** statement,
reads included (`BLOCKED: … do you need to upgrade your plan?`). That turned the whole site into
a 500 even though the agent itself was fine. Two things came out of it:

- the app now falls back to temporary in-memory storage instead of failing, and says so plainly
  in the UI rather than letting anyone think their work is saved;
- the database is no longer assumed to be libSQL, which is what made moving to Supabase a
  configuration change rather than a rewrite.
