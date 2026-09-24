// One-time copy of everything already in Supabase into Turso, so Turso is an exact copy before
// the live mirror (src/lib/db.ts) keeps it that way. Replaces Turso's contents table by table.
//
//   set -a && source .env.local && set +a && npx tsx scripts/copy-supabase-to-turso.ts
//   (needs SUPABASE_DB_URL, G6_TURSO_URL and G6_TURSO_TOKEN)

import pg from "pg";
import { createClient, type InValue } from "@libsql/client";

const TABLES = ["profiles", "jobs", "evaluations", "harness_settings", "workspace_state", "requirement_ledgers", "fit_cache", "eval_history"];
const clean = (v: string | undefined) => (v ?? "").trim().replace(/^["']|["']$/g, "").trim();

async function main() {
  const pgUrl = clean(process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL);
  const tUrl = clean(process.env.G6_TURSO_URL), tToken = clean(process.env.G6_TURSO_TOKEN);
  if (!pgUrl || !tUrl) throw new Error("Set SUPABASE_DB_URL and G6_TURSO_URL (and G6_TURSO_TOKEN).");
  const src = new pg.Client({ connectionString: pgUrl, ssl: /sslmode=disable/.test(pgUrl) ? false : { rejectUnauthorized: false } });
  await src.connect();
  const dst = createClient(tToken ? { url: tUrl, authToken: tToken } : { url: tUrl });
  let bad = 0;
  for (const table of TABLES) {
    // Turso gets exactly Supabase's columns: create the table if missing, add any column it lacks.
    const cols = (await src.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position",
      [table]
    )).rows as { column_name: string; data_type: string }[];
    if (cols.length === 0) { console.log(`${table.padEnd(20)} not in Supabase, skipped`); continue; }
    const type = (t: string) => (/int/.test(t) ? "INTEGER" : /real|double|numeric/.test(t) ? "REAL" : "TEXT");
    await dst.execute(`CREATE TABLE IF NOT EXISTS ${table} (${cols.map((c) => `${c.column_name} ${type(c.data_type)}`).join(", ")})`);
    const have = new Set((await dst.execute(`PRAGMA table_info(${table})`)).rows.map((r) => String(r.name)));
    for (const c of cols) if (!have.has(c.column_name)) await dst.execute(`ALTER TABLE ${table} ADD COLUMN ${c.column_name} ${type(c.data_type)}`);

    const rows = (await src.query(`SELECT * FROM ${table}`)).rows as Record<string, unknown>[];
    const stmts: { sql: string; args: InValue[] }[] = [{ sql: `DELETE FROM ${table}`, args: [] }];
    for (const r of rows) {
      const names = Object.keys(r);
      stmts.push({
        sql: `INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
        args: names.map((c) => (r[c] === undefined || r[c] === null ? null : r[c] instanceof Date ? (r[c] as Date).toISOString() : (r[c] as InValue))),
      });
    }
    await dst.batch(stmts, "write");
    const n = Number((await dst.execute(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n);
    if (n !== rows.length) bad++;
    console.log(`${table.padEnd(20)} supabase ${String(rows.length).padStart(5)}  turso ${String(n).padStart(5)}  ${n === rows.length ? "OK" : "MISMATCH"}`);
  }
  await src.end();
  console.log(bad ? "COPY INCOMPLETE" : "TURSO NOW HOLDS EVERYTHING IN SUPABASE");
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
