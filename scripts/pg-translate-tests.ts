// The SQLite -> Postgres translation, checked statement by statement.
//
// Every query in the app is written once, in SQLite form, and translated when the deployment
// uses Postgres (Supabase). A silent mistranslation would be the worst kind of bug — it would
// look like the agent misbehaving — so the translation is tested directly, and every SQL string
// the app actually issues is run through it to prove none of them comes out with a `?` or a
// SQLite-only function still in it.
//
//   npx tsx scripts/pg-translate-tests.ts

import fs from "fs";
import path from "path";
import { toPostgres } from "../src/lib/pgClient";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${detail}` : ""}`);
};

const cases: [string, string, RegExp][] = [
  [
    "placeholders are numbered in order",
    "SELECT id FROM jobs WHERE workspace_id = ? AND content_hash = ? LIMIT 1",
    /workspace_id = \$1 AND content_hash = \$2/,
  ],
  [
    "datetime('now') becomes a Postgres timestamp string",
    "UPDATE evaluations SET updated_at = datetime('now') WHERE job_id = ?",
    /to_char\(now\(\) at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS'\)/,
  ],
  [
    "INSERT OR IGNORE becomes ON CONFLICT DO NOTHING",
    "INSERT OR IGNORE INTO requirement_ledgers (job_hash, ledger_json, source) VALUES (?, ?, ?)",
    /INSERT INTO requirement_ledgers [\s\S]* ON CONFLICT DO NOTHING/,
  ],
  [
    "an existing ON CONFLICT clause is left alone, with the space Postgres wants",
    "INSERT INTO fit_cache (job_hash, fit_key, fit_json) VALUES (?, ?, ?) ON CONFLICT(job_hash, fit_key) DO UPDATE SET fit_json = excluded.fit_json",
    /ON CONFLICT \(job_hash, fit_key\) DO UPDATE SET fit_json = excluded\.fit_json/,
  ],
  [
    "column defaults in CREATE TABLE are translated too",
    "CREATE TABLE IF NOT EXISTS t (created_at TEXT NOT NULL DEFAULT (datetime('now')))",
    /DEFAULT \(to_char\(/,
  ],
];

for (const [name, sql, expected] of cases) {
  const out = toPostgres(sql);
  check(name, expected.test(out), out);
}

// Nothing SQLite-only may survive translation, across every SQL string the app issues.
const files = [
  path.join("src", "lib", "db.ts"),
  path.join("src", "lib", "memory.ts"),
  path.join("src", "lib", "evaluateJob.ts"),
  ...fs
    .readdirSync(path.join(__dirname, "..", "src", "app", "api"), { recursive: true, encoding: "utf-8" })
    .filter((f) => f.endsWith("route.ts"))
    .map((f) => path.join("src", "app", "api", f)),
];
const sqlStrings: string[] = [];
for (const rel of files) {
  const text = fs.readFileSync(path.join(__dirname, "..", rel), "utf-8");
  for (const m of text.matchAll(/(?:sql:\s*|execute\(\s*|executeMultiple\(\s*)(["'`])([\s\S]*?)\1/g)) {
    const s = m[2];
    if (/\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER)\b/i.test(s)) sqlStrings.push(s);
  }
}
check("found the app's SQL statements", sqlStrings.length >= 15, `${sqlStrings.length} statements`);

const leftovers = sqlStrings
  .map((s) => ({ sql: s, out: toPostgres(s) }))
  .filter(({ out }) => out.includes("?") || /datetime\('now'\)|INSERT\s+OR\s+IGNORE|AUTOINCREMENT/i.test(out));
check(
  "no statement still contains SQLite-only syntax after translation",
  leftovers.length === 0,
  leftovers.map((l) => l.out.slice(0, 90)).join("\n      ")
);

console.log(`\n${failures === 0 ? "ALL POSTGRES-TRANSLATION TESTS PASSED" : `${failures} TEST(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
