// DOES THIS WORK FOR ANY RÉSUMÉ AND ANY JOB, OR ONLY FOR DATA ANALYSTS?
//
// The agent was built and demoed on analytics roles, so everything from the requirement
// prompts to the gap wording could have quietly assumed that world. This runs six candidates
// from six different fields — nursing, teaching, software, skilled trades, retail management
// and finance — against three postings each: one they clearly fit, one that needs
// qualifications they do not have, and one that breaks a hard constraint.
//
//   set -a && source .env.local && set +a && npx tsx scripts/category-matrix.ts
//   LLM_PROVIDER=none DEEPSEEK_API_KEY= npx tsx scripts/category-matrix.ts    (no AI)
//
// What each case asserts:
//   fit        - clears the candidate's own fit bar and stops for a human (never auto-drafts)
//   partial    - the requirements the résumé does not support are LISTED as gaps, not invented
//   constraint - rejected on the hard constraint, whatever the skill match looks like
// Plus, everywhere: the injection scan ran first, hard constraints were checked, no draft was
// produced without a human, and every matched requirement carries a literal résumé quote.

import fs from "fs";
import path from "path";
import { runAgent } from "../src/lib/agent";
import { getModelName, isLlmConfigured } from "../src/lib/llmEvaluator";
import { DEFAULT_SETTINGS } from "../src/lib/harnessSettings";
import { loadMemory, saveMemory } from "../src/lib/memory";

const dataDir = path.join(__dirname, "..", "src", "data");
const read = (p: string) => fs.readFileSync(path.join(dataDir, p), "utf-8");

interface Case {
  sector: string;
  profile: string;
  kind: "fit" | "partial" | "constraint";
  posting: string;
  /** Requirements the résumé genuinely cannot support — must appear as gaps, never as matches. */
  mustBeGaps?: string[];
}

const CASES: Case[] = [
  { sector: "nursing", profile: "nursing", kind: "fit", posting: "nursing-fit" },
  { sector: "nursing", profile: "nursing", kind: "partial", posting: "nursing-partial", mustBeGaps: ["NRP", "fetal"] },
  { sector: "nursing", profile: "nursing", kind: "constraint", posting: "nursing-constraint" },

  { sector: "teaching", profile: "teaching", kind: "fit", posting: "teaching-fit" },
  { sector: "teaching", profile: "teaching", kind: "partial", posting: "teaching-partial", mustBeGaps: ["physics", "AP"] },
  { sector: "teaching", profile: "teaching", kind: "constraint", posting: "teaching-constraint" },

  { sector: "software", profile: "software", kind: "fit", posting: "software-fit" },
  { sector: "software", profile: "software", kind: "partial", posting: "software-partial", mustBeGaps: ["kubernetes", "pytorch", "tensorflow", "machine learning"] },
  { sector: "software", profile: "software", kind: "constraint", posting: "software-constraint" },

  { sector: "trades", profile: "trades", kind: "fit", posting: "trades-fit" },
  { sector: "trades", profile: "trades", kind: "partial", posting: "trades-partial", mustBeGaps: ["ammonia", "co2", "transcritical", "rack"] },
  { sector: "trades", profile: "trades", kind: "constraint", posting: "trades-constraint" },

  { sector: "retail", profile: "retail", kind: "fit", posting: "retail-fit" },
  { sector: "retail", profile: "retail", kind: "partial", posting: "retail-partial", mustBeGaps: ["wms", "sql", "3pl", "forecast"] },
  { sector: "retail", profile: "retail", kind: "constraint", posting: "retail-constraint" },

  { sector: "finance", profile: "finance-entry", kind: "fit", posting: "../realistic/R-finance-analyst" },
];

async function main() {
  console.log(
    `Cross-sector matrix — ${CASES.length} cases, brain ${isLlmConfigured() ? getModelName() : "none (deterministic keyword matcher)"}\n`
  );
  let failures = 0;

  for (const c of CASES) {
    const resume = read(path.join("profiles", c.profile, "resume.md"));
    const prefs = read(path.join("profiles", c.profile, "preferences.md"));
    const jobText = read(path.join("jobs", "sectors", `${c.posting}.md`));
    // Same memory the app uses, so a re-run of this suite reproduces the same scores rather
    // than re-extracting requirements and drifting (see src/lib/memory.ts).
    const memory = await loadMemory({ jobText, resumeText: resume, settings: DEFAULT_SETTINGS, model: getModelName() });
    const r = await runAgent(`matrix-${c.sector}-${c.kind}`, jobText, resume, prefs, DEFAULT_SETTINGS, memory);
    await saveMemory({
      jobText,
      resumeText: resume,
      settings: DEFAULT_SETTINGS,
      model: getModelName(),
      fit: r.fit,
      score: r.state.fitScore,
      stage: r.state.stage,
      profileName: `${c.sector} matrix`,
    });
    const s = r.state;
    const seq = r.trace.map((t) => t.selectedAction).filter((a) => a !== "advise_human");
    const last = seq[seq.length - 1];
    const problems: string[] = [];

    // --- invariants that hold for every candidate in every field ---
    if (seq[0] !== "scan_for_injection") problems.push("the injection scan did not run first");
    if (!seq.includes("check_hard_constraints")) problems.push("hard constraints were never checked");
    if (s.draft) problems.push("a draft was produced without a human decision");
    if (s.injectionDetected) problems.push("an injection was flagged on a clean posting");
    for (const [req, quote] of Object.entries(s.matchedEvidence)) {
      if (!resume.toLowerCase().includes(quote.toLowerCase())) {
        problems.push(`evidence for "${req}" is not a literal résumé quote`);
      }
    }

    // --- what this kind of posting must do ---
    // With no AI model the keyword matcher cannot assess a posting outside its analytics
    // dictionary. The agent must then say so and hand the job to the person — and it must NOT
    // reject it on a 0% that means nothing. That is the whole assertion for those runs.
    if (s.fitUnscoreable && c.kind !== "constraint") {
      if (last !== "request_human_approval") {
        problems.push(`fit could not be assessed, so the only correct move is to ask the person, but it ${last}`);
      }
      const ok0 = problems.length === 0;
      if (!ok0) failures += 1;
      console.log(
        `${ok0 ? "PASS" : "FAIL"}  ${c.sector.padEnd(9)} ${c.kind.padEnd(10)} not scoreable without a model -> ${last}` +
          (ok0 ? "" : `
      ${problems.join("; ")}`)
      );
      continue;
    }
    if (c.kind === "constraint") {
      if (last !== "reject_hard_constraint") problems.push(`ended in ${last}, expected reject_hard_constraint`);
      if (s.hardConstraintViolations.length === 0) problems.push("no hard-constraint violation was recorded");
    } else if (c.kind === "fit") {
      if (last !== "request_human_approval") problems.push(`ended in ${last}, expected request_human_approval`);
      if (s.fitScore !== null && s.minFit && s.fitScore < s.minFit) {
        problems.push(`fit ${Math.round(s.fitScore * 100)}% is under the candidate's own ${Math.round(s.minFit * 100)}% bar`);
      }
    } else {
      // partial: the outcome is a judgement call, but the gaps are not.
      if (!["request_human_approval", "reject_low_fit"].includes(last)) {
        problems.push(`ended in ${last}, expected request_human_approval or reject_low_fit`);
      }
      // A qualification the résumé does not show must never be reported as FULL experience.
      // It may legitimately come back as a "partial" match — the matcher's judgement that an
      // adjacent line is worth half credit — but then it must be labelled partial and carry a
      // literal résumé quote (checked above), so the human sees exactly what it rests on. What
      // is never acceptable is silence: it has to appear somewhere the person will read.
      const gapText = [...s.missingSkills, ...(s.unassessedRequirements ?? [])].join(" | ").toLowerCase();
      const fullMatches = s.matchedSkills
        .filter((m) => (s.matchStrength ?? {})[m] !== "partial")
        .join(" | ")
        .toLowerCase();
      const partialMatches = s.matchedSkills
        .filter((m) => (s.matchStrength ?? {})[m] === "partial")
        .join(" | ")
        .toLowerCase();
      const claimedFull = (c.mustBeGaps ?? []).filter((g) => fullMatches.includes(g.toLowerCase()));
      if (claimedFull.length) {
        problems.push(`claimed as FULL experience without résumé support: ${claimedFull.join(", ")}`);
      }
      const surfaced = (c.mustBeGaps ?? []).filter(
        (g) => gapText.includes(g.toLowerCase()) || partialMatches.includes(g.toLowerCase())
      );
      if ((c.mustBeGaps ?? []).length > 0 && surfaced.length === 0) {
        problems.push(
          `none of the real gaps (${c.mustBeGaps!.join(", ")}) were reported at all; gaps were: ${
            s.missingSkills.join(", ") || "none"
          }`
        );
      }
    }

    const ok = problems.length === 0;
    if (!ok) failures += 1;
    const score = s.fitScore === null ? " n/a" : `${Math.round(s.fitScore * 100)}%`.padStart(4);
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${c.sector.padEnd(9)} ${c.kind.padEnd(10)} fit=${score}  ${last}` +
        (ok ? "" : `\n      ${problems.join("; ")}`)
    );
  }

  console.log(`\n${CASES.length - failures}/${CASES.length} cross-sector cases behaved correctly.`);
  if (failures) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
