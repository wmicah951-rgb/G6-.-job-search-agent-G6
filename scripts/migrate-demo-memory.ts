// One-off: carry the demo links' remembered scores over to the new posting identity.
//
// jobHash() now ignores text a job board changes daily ("2 weeks ago", applicant counts), so a
// LinkedIn posting read tomorrow is recognised as the same posting scored today. The demo links
// were scored before that change, under the old identity (a plain hash of the text). This copies
// each one's requirement list, saved verdicts and score history to the new identity, so the Live
// Demo reproduces the listed scores without re-running anything.
//
//   set -a && source .env.local && set +a && npx tsx scripts/migrate-demo-memory.ts

import fs from "fs";
import path from "path";
import { db, ensureSchema } from "../src/lib/db";
import { ensureMemorySchema, hashText, jobHash } from "../src/lib/memory";

async function main() {
  await ensureSchema();
  await ensureMemorySchema();
  const links = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "src", "data", "demo-links.json"), "utf-8")) as {
    url: string;
    postingText: string;
  }[];
  const c = db();
  let moved = 0;
  for (const l of links) {
    const oldH = hashText(l.postingText);
    const newH = jobHash(l.postingText);
    if (oldH === newH) continue;
    const ledger = await c.execute({ sql: "SELECT ledger_json, source FROM requirement_ledgers WHERE job_hash = ?", args: [oldH] });
    if (ledger.rows.length) {
      await c.execute({
        sql: "INSERT OR IGNORE INTO requirement_ledgers (job_hash, ledger_json, source) VALUES (?, ?, ?)",
        args: [newH, ledger.rows[0].ledger_json as string, ledger.rows[0].source as string],
      });
    }
    const verdicts = await c.execute({ sql: "SELECT fit_key, fit_json FROM fit_cache WHERE job_hash = ?", args: [oldH] });
    for (const v of verdicts.rows) {
      await c.execute({
        sql: `INSERT INTO fit_cache (job_hash, fit_key, fit_json) VALUES (?, ?, ?)
              ON CONFLICT(job_hash, fit_key) DO NOTHING`,
        args: [newH, v.fit_key as string, v.fit_json as string],
      });
    }
    if (ledger.rows.length || verdicts.rows.length) moved += 1;
  }
  console.log(`Carried memory over for ${moved} of ${links.length} demo postings.`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
