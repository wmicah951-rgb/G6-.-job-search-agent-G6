// Does the agent account for EVERY requirement the posting states?
//
// The worry this answers: "make sure it names all the skills we're missing, so we're not
// leaving gaps open". A silently dropped requirement is the worst failure mode here —
// the score still looks plausible, and the candidate never learns what to add.
//
// Method: pull the explicit requirement bullets straight out of the posting text, then check
// each one is accounted for in the agent's output as either MATCHED or MISSING. Anything in
// neither list was silently dropped.
//
//   set -a && source .env.local && set +a && npx tsx scripts/gap-completeness.ts
import fs from "fs";
import path from "path";
import { runAgent } from "../src/lib/agent";
import { getModelName } from "../src/lib/llmEvaluator";

const dataDir = path.join(__dirname, "..", "src", "data");

/**
 * Requirement bullets only — the "- ..." lines under a Requirements/Qualifications heading.
 *
 * Deliberately EXCLUDES responsibility sections ("What you'll be doing", "Responsibilities"):
 * those are duties, not screening requirements, and the Matcher is instructed to ignore them.
 * Counting them here produced seven bogus "silently dropped" hits on the first run of this
 * script — the script was wrong, not the agent.
 */
const DUTY_HEADING = /^#{0,3}\s*(what you'?l*l?\s*(be\s*)?(do|doing)|responsibilities|the role|role overview|about the role|day to day)/i;
const REQ_HEADING = /^#{0,3}\s*(requirements?|qualifications|what you'?l*l?\s*need|you (?:will )?(?:need|bring)|must have|preferred|nice to have|bonus points|a plus)/i;

/** Soft skills / generic traits the agent is SUPPOSED to ignore (not tools, degrees or years). */
const SOFT = /\b(communication|communicat|interpersonal|collaborat|team player|attention to detail|self[- ]starter|organi[sz]ed|problem[- ]solving|presenting|presentation skills|comfort presenting|work ethic|curiosity|proactive)\b/i;

function statedRequirements(jobText: string): { hard: string[]; soft: string[] } {
  const lines = jobText.split("\n");
  const hard: string[] = [];
  const soft: string[] = [];
  let inReq = false;
  for (const raw of lines) {
    const l = raw.trim();
    if (DUTY_HEADING.test(l)) {
      inReq = false;
      continue;
    }
    if (REQ_HEADING.test(l)) {
      inReq = true;
      continue;
    }
    // A new non-list heading ends the block.
    if (inReq && l && !l.startsWith("-") && !l.startsWith("*") && /^[A-Z#]/.test(l) && l.length < 60) inReq = false;
    if (inReq && (l.startsWith("- ") || l.startsWith("* "))) {
      const t = l.replace(/^[-*]\s*/, "").trim();
      (SOFT.test(t) ? soft : hard).push(t);
    }
  }
  return { hard, soft };
}

const STOP = new Set(["experience","years","year","with","and","the","for","strong","working","knowledge","ability","skills","data","using","team","plus","similar","related","such","into","from","that","this","our","you","your"]);
const key = (t: string) =>
  new Set(t.toLowerCase().split(/[^a-z0-9+#/]+/).filter((w) => w.length >= 3 && !STOP.has(w)));

/** Is this stated requirement represented anywhere in the agent's matched/missing lists? */
function accountedFor(req: string, reported: string[]): boolean {
  const rk = [...key(req)];
  if (!rk.length) return true;
  return reported.some((r) => {
    const got = key(r);
    const hits = rk.filter((w) => got.has(w)).length;
    return hits >= Math.max(1, Math.ceil(rk.length * 0.34));
  });
}

interface Row { id: string; profile: string; stated: number; missed: string[]; matched: number; missing: number }

async function run(jobRel: string, profileName: string | null): Promise<Row | null> {
  const jobText = fs.readFileSync(path.join(dataDir, "jobs", `${jobRel}.md`), "utf-8");
  const dir = profileName ? path.join(dataDir, "profiles", profileName) : dataDir;
  const resume = fs.readFileSync(path.join(dir, "resume.md"), "utf-8");
  const prefs = fs.readFileSync(path.join(dir, "preferences.md"), "utf-8");
  const r = await runAgent(`gap-${jobRel}`, jobText, resume, prefs);
  if (r.state.fitScore === null) {
    console.log(`\n${jobRel} [${profileName ?? "demo"}]: fit not evaluated (${r.state.stage}) — skipped.`);
    return null;
  }
  // Surfaced-as-unassessed counts as accounted for: the human is told about it either way.
  const reported = [...r.state.matchedSkills, ...r.state.missingSkills, ...(r.state.unassessedRequirements ?? [])];
  const { hard, soft } = statedRequirements(jobText);
  const missed = hard.filter((s) => !accountedFor(s, reported));

  console.log(`\n${"=".repeat(78)}\n${jobRel}  [profile: ${profileName ?? "demo"}]  fit ${Math.round((r.state.fitScore ?? 0) * 100)}%`);
  console.log(`stated HARD requirements   : ${hard.length}  (+${soft.length} soft-skill bullet(s) the agent is meant to ignore)`);
  console.log(`agent reported             : ${r.state.matchedSkills.length} matched + ${r.state.missingSkills.length} missing = ${reported.length}`);
  console.log(`MISSING SKILLS NAMED       : ${r.state.missingSkills.join(" | ") || "(none)"}`);
  if ((r.state.unassessedRequirements ?? []).length) console.log(`SURFACED AS UNASSESSED     : ${r.state.unassessedRequirements!.join(" | ")}`);
  if (missed.length) {
    console.log(`UNACCOUNTED (silently dropped):`);
    for (const m of missed) console.log(`   ! ${m}`);
  } else {
    console.log(`UNACCOUNTED                : none — every stated requirement is in matched or missing`);
  }
  return { id: jobRel, profile: profileName ?? "demo", stated: hard.length, missed, matched: r.state.matchedSkills.length, missing: r.state.missingSkills.length };
}

async function main() {
  console.log(`Brain: ${getModelName()}`);
  const cases: [string, string | null][] = [
    ["J001", null],
    ["J002", null],
    ["spec/K002", null],
    ["realistic/R-data-analyst", null],
    ["realistic/R-marketing-ops", "marketing-ops"],
    ["realistic/R-finance-analyst", "finance-entry"],
  ];
  const rows: Row[] = [];
  for (const [j, p] of cases) {
    const r = await run(j, p);
    if (r) rows.push(r);
  }
  console.log(`\n${"=".repeat(78)}\nSUMMARY`);
  let bad = 0;
  for (const r of rows) {
    if (r.missed.length) bad++;
    console.log(`${r.id.padEnd(28)} ${r.profile.padEnd(14)} stated ${String(r.stated).padStart(2)}  reported ${String(r.matched + r.missing).padStart(2)}  unaccounted ${r.missed.length}`);
  }
  console.log(bad === 0 ? "\nEVERY STATED REQUIREMENT IS ACCOUNTED FOR" : `\n${bad} posting(s) dropped a stated requirement`);
  process.exit(bad === 0 ? 0 : 1);
}
main();
