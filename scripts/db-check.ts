// Connects to whichever database is configured, creates the schema if needed, and reports what
// is there. Safe to run repeatedly: it writes nothing but the schema.
//   set -a && source .env.local && set +a && npx tsx scripts/db-check.ts
import { db, databaseKind, ensureSchema, isDegraded } from "../src/lib/db";
import { ensureMemorySchema } from "../src/lib/memory";

(async () => {
  console.log("configured:", databaseKind());
  await ensureSchema();
  await ensureMemorySchema();
  console.log("degraded (fell back to temporary storage):", isDegraded());
  const c = db();
  for (const t of ["profiles", "jobs", "evaluations", "workspace_state", "harness_settings",
                   "requirement_ledgers", "fit_cache", "eval_history"]) {
    try {
      const r = await c.execute(`SELECT COUNT(*) as n FROM ${t}`);
      console.log(`  ${t.padEnd(22)} ${String(r.rows[0]?.n ?? 0).padStart(5)} row(s)`);
    } catch (e) {
      console.log(`  ${t.padEnd(22)} ERROR ${String(e).slice(0, 90)}`);
    }
  }
  process.exit(0);
})();
