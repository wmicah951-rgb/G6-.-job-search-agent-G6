// False-positive guard for the injection keyword floor.
//
// Every pattern added to INJECTION_PATTERNS buys detection at the risk of crying wolf on an
// ordinary posting — and a banner that fires on honest text is one people learn to ignore,
// which is worse than no banner. This runs the floor (no AI) over every posting in the repo
// and asserts that exactly the postings that SHOULD be flagged are flagged.
//
//   LLM_PROVIDER=none npx tsx scripts/injection-falsepositive.ts
import fs from "fs";
import path from "path";
import { runAgent } from "../src/lib/agent";

const dataDir = path.join(__dirname, "..", "src", "data");
const resume = fs.readFileSync(path.join(dataDir, "resume.md"), "utf-8");
const prefs = fs.readFileSync(path.join(dataDir, "preferences.md"), "utf-8");

/** Postings that genuinely contain an injection attempt. Everything else must stay clean. */
const INJECTED = new Set(["J004", "J008", "J009", "J010", "J011", "J012", "spec/K004"]);

/**
 * Injected postings the FLOOR is not expected to catch on its own — they carry no trigger
 * wording at all and exist precisely to show the AI reader adds real detection. J011 hides
 * its instruction inside a poem. Missing these is by design; the human gate still holds.
 */
const AI_ONLY = new Set(["J011"]);

function collect(): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  const jobsDir = path.join(dataDir, "jobs");
  for (const f of fs.readdirSync(jobsDir)) {
    if (f.endsWith(".md")) out.push({ id: f.replace(/\.md$/, ""), text: fs.readFileSync(path.join(jobsDir, f), "utf-8") });
  }
  for (const sub of ["spec", "realistic"]) {
    const d = path.join(jobsDir, sub);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      if (f.endsWith(".md")) out.push({ id: `${sub}/${f.replace(/\.md$/, "")}`, text: fs.readFileSync(path.join(d, f), "utf-8") });
    }
  }
  return out;
}

async function main() {
  let fail = 0;
  const postings = collect();
  console.log(`Floor-only scan over ${postings.length} postings\n`);
  for (const p of postings) {
    const r = await runAgent(p.id, p.text, resume, prefs);
    const flagged = r.state.injectionDetected;
    const shouldFlag = INJECTED.has(p.id);
    const aiOnly = AI_ONLY.has(p.id);
    // A false positive is always a failure. A miss is only a failure when the floor was
    // supposed to catch it — the AI-only fixtures are expected to slip past the floor.
    const ok = flagged ? shouldFlag : !shouldFlag || aiOnly;
    if (!ok) fail++;
    const label = ok ? (flagged === shouldFlag ? "ok  " : "ai-only (expected)") : flagged ? "FALSE POSITIVE" : "MISSED";
    console.log(
      `${label.padEnd(15)} ${p.id.padEnd(22)} flagged=${String(flagged).padEnd(5)} expected=${shouldFlag}` +
        (flagged ? `  [${r.state.injectionSnippets.slice(0, 2).join(" | ").slice(0, 90)}]` : "")
    );
  }
  console.log(fail === 0 ? "\nNO FALSE POSITIVES, NO MISSES (floor only)" : `\n${fail} POSTING(S) WRONG`);
  process.exit(fail === 0 ? 0 : 1);
}
main();
