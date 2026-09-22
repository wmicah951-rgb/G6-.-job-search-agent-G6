// Empties the app's data: profiles, postings, evaluations, harness overrides, workspaces and
// the agent's remembered requirement lists and scores.
//
// Why this exists: the live site had accumulated demo profiles (one built from a real person's
// details) and jobs from months of testing, all under the old single-global-profile model. The
// app now seeds the official class-kit profile per browser on first visit, so starting empty is
// both cleaner and safer. Nothing here touches code or the kit fixtures on disk.
//
//   set -a && source .env.local && set +a && npx tsx scripts/reset-data.ts            # dry run
//   set -a && source .env.local && set +a && npx tsx scripts/reset-data.ts --yes      # delete

import { db, ensureSchema, isTursoConfigured } from "../src/lib/db";
import { ensureMemorySchema } from "../src/lib/memory";

const TABLES = [
  "evaluations",
  "jobs",
  "harness_settings",
  "profiles",
  "workspace_state",
  "requirement_ledgers",
  "fit_cache",
  "eval_history",
];

async function main() {
  const confirmed = process.argv.includes("--yes");
  await ensureSchema();
  await ensureMemorySchema();
  const c = db();
  console.log(`Database: ${isTursoConfigured() ? "Turso (LIVE)" : "local file (local.db)"}\n`);

  for (const t of TABLES) {
    try {
      const res = await c.execute(`SELECT COUNT(*) as n FROM ${t}`);
      console.log(`${t.padEnd(22)} ${String(res.rows[0]?.n ?? 0).padStart(5)} row(s)`);
    } catch {
      console.log(`${t.padEnd(22)} (table not present)`);
    }
  }

  if (!confirmed) {
    console.log("\nDry run. Re-run with --yes to delete every row above.");
    return;
  }

  for (const t of TABLES) {
    try {
      await c.execute(`DELETE FROM ${t}`);
    } catch {
      /* table not present — nothing to clear */
    }
  }
  console.log("\nDeleted. The next visit to the app seeds a fresh 'Class kit — Jordan Lee' profile.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
