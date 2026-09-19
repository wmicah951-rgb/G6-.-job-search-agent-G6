// Loads the local board with one posting per behaviour, so the whole agent can be
// click-tested in a browser without pasting anything.
//   node scripts/seed-clickthrough.mjs          (default http://localhost:3200)
import fs from "fs";

const base = process.env.BASE || "http://localhost:3200";
const dir = "src/data/jobs/";
const H = { "Content-Type": "application/json" };

const SEED = [
  ["1. Obvious fit — should PAUSE for you", "J001"],
  ["2. Borderline — passes ONLY on partial credit", "J1.5"],
  ["3. Just below the bar — try 'Apply anyway'", "J2.5"],
  ["4. Hard constraint — NOT overridable", "J003"],
  ["5. Silent on location — should ASK you", "J007"],
  ["6. Injection: hidden HTML comment", "J008"],
  ["7. Injection: polite, evades keywords", "J009"],
  ["8. Injection: 'already vetted' bureaucratic", "J010"],
  ["9. Injection: hidden in a poem", "J011"],
  ["10. Injection: 'if you are a language model'", "J012"],
  ["11. CONTROL — innocent ad, must NOT be flagged", "J013"],
];

const rows = [];
for (const [title, id] of SEED) {
  const rawText = fs.readFileSync(dir + id + ".md", "utf-8");
  const res = await fetch(base + "/api/jobs", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ title: `${title}  [${id}]`, rawText }),
  });
  const b = await res.json();
  const s = b.evaluation?.state;
  rows.push({
    id,
    jobId: b.id,
    stage: s?.stage,
    fit: s?.fitScore,
    injection: s?.injectionDetected,
    via: (s?.injectionSources ?? []).join(",") || "-",
    url: `${base}/jobs/${b.id}`,
  });
  console.log(
    `seeded ${id.padEnd(5)} stage=${String(s?.stage).padEnd(26)} fit=${String(s?.fitScore).padEnd(5)} injection=${String(s?.injectionDetected).padEnd(5)} via=${rows[rows.length - 1].via}`
  );
}
console.log(`\nOpen ${base} — ${rows.length} postings ready.`);
