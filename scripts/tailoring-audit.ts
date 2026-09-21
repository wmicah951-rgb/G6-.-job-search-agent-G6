// Measures whether the TAILORED resume is actually tailored.
//
// The complaint this exists to answer: "the tailored resume doesn't seem to reword the
// experience toward the posting". Opinions are useless here, so this measures it:
//
//   1. BULLET REWRITE RATE - what share of the original achievement bullets came back
//      changed at all (token-level), vs copied through verbatim.
//   2. POSTING VOCABULARY PICKUP - which distinctive terms from the posting (that the
//      resume genuinely supports) actually appear in the tailored resume.
//   3. FACT SAFETY - employers/titles/dates still carried over character-for-character,
//      and the verifier's flag count, so "more rewording" never means "more invention".
//   4. GAP COVERAGE - every missing skill got an addressedGaps entry.
//
//   set -a && source .env.local && set +a && npx tsx scripts/tailoring-audit.ts [jobId...]
import fs from "fs";
import path from "path";
import { runAgent, applyHumanDecision } from "../src/lib/agent";
import { getModelName } from "../src/lib/llmEvaluator";

const dataDir = path.join(__dirname, "..", "src", "data");
// --profile <name> swaps in one of src/data/profiles/<name>/ so the audit can be run
// against a different, more detailed resume than the built-in demo one.
const argv = process.argv.slice(2);
const flag = (n: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};
const profile = flag("--profile");
const profileDir = profile ? path.join(dataDir, "profiles", profile) : dataDir;
const resume = fs.readFileSync(path.join(profileDir, "resume.md"), "utf-8");
const prefs = fs.readFileSync(path.join(profileDir, "preferences.md"), "utf-8");
const job = (id: string) => fs.readFileSync(path.join(dataDir, "jobs", `${id}.md`), "utf-8");

const STOP = new Set([
  "the","and","for","with","that","from","this","have","has","are","was","were","will","you","your",
  "our","their","its","a","an","in","on","of","to","as","at","by","or","is","be","we","they","it",
  "role","team","work","working","job","position","candidate","experience","years","year","company",
  "requirements","required","preferred","plus","nice","looking","join","hiring","about","who","what",
  "will","can","other","using","use","used","across","into","within","more","most","also","than",
]);
const words = (t: string) =>
  t.toLowerCase().split(/[^a-z0-9+#/.]+/).filter((w) => w.length >= 3 && !STOP.has(w));

/** Achievement bullets ("- ...") from a resume, minus the internal (N yrs) bookkeeping. */
function bullets(md: string): string[] {
  return md
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- ") && l.length > 20)
    .map((l) => l.replace(/^-\s*/, "").replace(/\(\s*[\d.]+\s*yrs?\s*\)/gi, "").trim());
}

/** 0 = identical wording, 1 = completely rewritten. Token multiset difference. */
function rewriteDistance(a: string, b: string): number {
  const A = words(a), B = words(b);
  if (!A.length && !B.length) return 0;
  const countOf = (xs: string[]) => xs.reduce((m, w) => m.set(w, (m.get(w) ?? 0) + 1), new Map<string, number>());
  const ca = countOf(A), cb = countOf(B);
  let shared = 0;
  for (const [w, n] of ca) shared += Math.min(n, cb.get(w) ?? 0);
  return 1 - (2 * shared) / (A.length + B.length);
}

/** Best-matching tailored bullet for an original bullet (by token overlap). */
function bestMatch(orig: string, candidates: string[]): { text: string; dist: number } | null {
  let best: { text: string; dist: number } | null = null;
  for (const c of candidates) {
    const d = rewriteDistance(orig, c);
    if (!best || d < best.dist) best = { text: c, dist: d };
  }
  return best;
}

async function audit(id: string) {
  const text = job(id);
  const r = await runAgent(id, text, resume, prefs);
  if (r.state.stage !== "awaiting_approval") {
    console.log(`\n${id}: stage=${r.state.stage} — not a drafting case, skipped.`);
    return null;
  }
  const done = await applyHumanDecision(r, "approve", null, text, resume);
  const tailored = done.state.tailoredResume ?? "";
  if (!tailored) {
    console.log(`\n${id}: no tailored resume produced.`);
    return null;
  }

  const origB = bullets(resume);
  const tailB = bullets(tailored);

  // 1. rewrite rate
  const pairs = origB.map((o) => ({ orig: o, match: bestMatch(o, tailB) }));
  const changed = pairs.filter((p) => p.match && p.match.dist > 0.15);
  const verbatim = pairs.filter((p) => p.match && p.match.dist <= 0.05);
  const avgDist = pairs.reduce((s, p) => s + (p.match?.dist ?? 1), 0) / (pairs.length || 1);

  // 2. posting vocabulary pickup: distinctive posting terms the RESUME already supports
  const postingTerms = [...new Set(words(text))];
  const resumeTerms = new Set(words(resume));
  const supported = postingTerms.filter((w) => resumeTerms.has(w));
  const tailoredTerms = new Set(words(tailored));
  const pickedUp = supported.filter((w) => tailoredTerms.has(w));
  // terms the posting uses that the résumé supports but the tailored resume dropped
  const dropped = supported.filter((w) => !tailoredTerms.has(w));

  // 3. fact safety
  // Employer/title/date lines pulled from the ORIGINAL resume: these must survive
  // character-for-character no matter how much the bullets are reworded.
  const facts = [...resume.matchAll(/^\*\*(.+?)\*\*/gm)].map((m) => m[1].split("—")[0].trim()).filter((f) => f.length > 3).slice(0, 6);
  const factsKept = facts.filter((f) => tailored.includes(f));
  const flagged = done.state.draftVerification?.totals.unsupported ?? 0;
  const claims = done.state.draftVerification?.totals.claims ?? 0;

  // 4. gap coverage
  const gapNotes = done.state.gapNotes ?? [];
  const missing = done.state.missingSkills;
  const uncovered = missing.filter(
    (m) => !gapNotes.some((g) => g.skill.trim().toLowerCase() === m.trim().toLowerCase())
  );

  console.log(`\n${"=".repeat(78)}\n${id} — fit ${Math.round((r.state.fitScore ?? 0) * 100)}%\n${"=".repeat(78)}`);
  console.log(`BULLET REWRITE   : ${changed.length}/${origB.length} bullets changed; ${verbatim.length} copied verbatim; avg distance ${avgDist.toFixed(2)}`);
  console.log(`POSTING VOCAB    : picked up ${pickedUp.length}/${supported.length} supported terms`);
  if (dropped.length) console.log(`   not surfaced  : ${dropped.slice(0, 12).join(", ")}`);
  console.log(`FACTS KEPT       : ${factsKept.length}/${facts.length} (${facts.filter((f) => !tailored.includes(f)).join(", ") || "all present"})`);
  console.log(`VERIFIER         : ${flagged} flagged of ${claims} claims`);
  for (const c of done.state.draftVerification?.claims ?? []) if (c.verdict === "unsupported") console.log(`   FLAGGED: ${c.text.slice(0, 90)}  <- ${c.unsupportedFacts.join(", ")}`);
  console.log(`GAP COVERAGE     : ${gapNotes.length} notes for ${missing.length} missing; uncovered=[${uncovered.join("; ")}]`);
  for (const p of pairs) {
    const tag = !p.match ? "DROPPED " : p.match.dist <= 0.05 ? "VERBATIM" : p.match.dist > 0.4 ? "REWRITTEN" : "tweaked ";
    console.log(`   [${tag}] ${p.orig.slice(0, 72)}`);
    if (p.match && p.match.dist > 0.05) console.log(`              -> ${p.match.text.slice(0, 72)}`);
  }
  return { id, changed: changed.length, total: origB.length, avgDist, pickedUp: pickedUp.length, supported: supported.length, flagged, uncovered: uncovered.length };
}

async function main() {
  const ids = argv.filter((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--profile");
  if (!ids.length) ids.push("J001", "spec/K001", "J006");
  console.log(`Brain: ${getModelName()}`);
  const rows = [];
  for (const id of ids) {
    const res = await audit(id);
    if (res) rows.push(res);
  }
  console.log(`\n${"=".repeat(78)}\nSUMMARY`);
  for (const r of rows) {
    console.log(
      `${r.id.padEnd(12)} rewritten ${r.changed}/${r.total}  avgDist ${r.avgDist.toFixed(2)}  vocab ${r.pickedUp}/${r.supported}  flagged ${r.flagged}  uncoveredGaps ${r.uncovered}`
    );
  }
}
main();
