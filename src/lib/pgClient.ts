// POSTGRES (SUPABASE) BEHIND THE SAME TINY INTERFACE THE APP ALREADY USES.
//
// Every query in this app is written as libSQL/SQLite: `execute("...")` or
// `execute({ sql, args })` with `?` placeholders, plus `executeMultiple()` for schema
// creation. Moving to Supabase could have meant rewriting all of that. Instead this file
// implements the same two methods on top of node-postgres and translates the handful of
// SQLite-isms we actually use, so `db()` can hand back either client and nothing else in the
// codebase changes:
//
//   ?                -> $1, $2, ...        (positional parameters)
//   datetime('now')  -> a UTC timestamp string, so `updated_at` keeps the same text shape
//   INSERT OR IGNORE -> INSERT ... ON CONFLICT DO NOTHING
//   ON CONFLICT(a,b) -> ON CONFLICT (a,b)  (Postgres wants the space)
//
// It is deliberately NOT a general SQLite-to-Postgres layer: it covers this app's SQL, and a
// query using something outside that set should fail loudly rather than be half-translated.

import fs from "fs";
import path from "path";
import { Pool } from "pg";

export interface SqlClient {
  execute(q: string | { sql: string; args?: unknown[] }): Promise<{ rows: Record<string, unknown>[] }>;
  executeMultiple(sql: string): Promise<void>;
}

/** The connection string, from whichever variable the deployment happens to use. */
export function postgresUrl(): string | null {
  return (
    process.env.SUPABASE_DB_URL ||
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    null
  );
}

export function isPostgresConfigured(): boolean {
  return !!postgresUrl();
}

/** SQLite dialect -> Postgres, for the SQL this app actually writes. */
export function toPostgres(sql: string): string {
  let out = sql;
  const ignoreDuplicates = /\bINSERT\s+OR\s+IGNORE\s+INTO\b/i.test(sql);
  out = out.replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, "INSERT INTO");
  if (ignoreDuplicates && !/ON\s+CONFLICT/i.test(sql)) {
    out = `${out.trimEnd().replace(/;$/, "")} ON CONFLICT DO NOTHING`;
  }
  out = out.replace(/ON\s+CONFLICT\(/gi, "ON CONFLICT (");
  // Keep timestamps as the same 'YYYY-MM-DD HH:MM:SS' text SQLite produced, so anything that
  // reads or sorts them behaves identically.
  out = out.replace(/datetime\('now'\)/gi, "to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS')");
  // Positional parameters. Placeholders only ever appear outside string literals in this app.
  let i = 0;
  out = out.replace(/\?/g, () => `$${++i}`);
  return out;
}

/**
 * Supabase's direct database host presents a certificate signed by Supabase's own CA, not by a
 * CA in the system store, so plain verification fails with "self-signed certificate in
 * certificate chain". The answer is to trust THAT CA — the certificate is committed at
 * certs/supabase-prod-ca.crt — and keep verification on. Turning verification off would have
 * been one line and would have meant nobody could tell an intercepted connection from a real
 * one. If the file is missing we fall back to the system store rather than to no checking at
 * all: a connection that cannot be verified should fail loudly.
 */
function tlsOptions(): { ca?: string } | boolean {
  const caPath = process.env.SUPABASE_CA_CERT_PATH || path.join(process.cwd(), "certs", "supabase-prod-ca.crt");
  try {
    return { ca: fs.readFileSync(caPath, "utf-8") };
  } catch {
    return true;
  }
}

let pool: Pool | null = null;

export function postgresClient(): SqlClient {
  if (!pool) {
    const connectionString = postgresUrl();
    if (!connectionString) throw new Error("No Postgres connection string configured.");
    pool = new Pool({
      connectionString,
      ssl: tlsOptions(),
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  const p = pool;
  return {
    async execute(q) {
      const sql = typeof q === "string" ? q : q.sql;
      const args = typeof q === "string" ? [] : (q.args ?? []);
      const res = await p.query(toPostgres(sql), args as unknown[]);
      return { rows: (res.rows ?? []) as Record<string, unknown>[] };
    },
    async executeMultiple(sql) {
      // A schema block: run each statement on its own so one "already exists" cannot abort the
      // rest, matching how libSQL's executeMultiple behaved for us.
      for (const stmt of sql.split(";").map((s) => s.trim()).filter(Boolean)) {
        await p.query(toPostgres(stmt));
      }
    },
  };
}
