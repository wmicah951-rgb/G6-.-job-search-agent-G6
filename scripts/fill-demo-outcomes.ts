// Gives EVERY Live Demo link both numbers — the score the agent gives the posting, and the score
// after tailoring — instead of leaving the second box blank whenever the agent stopped early.
//
//   set -a && source .env.local && set +a && npx tsx scripts/fill-demo-outcomes.ts
//
// The agent stops early on purpose in three cases, and each gets the number a person would see by
// taking the next step in the app themselves:
//   - down-ranked (below the fit bar): the human overrides the rejection, then approves the draft;
//     the re-score of that draft is the "after" number.
//   - asks a question: the human answers "compatible", then approves; same re-score.
//   - hard rule broken (years, location, on-site): the agent never drafts — that is the class rule,
//     and the app offers no override. The skills match is still scored and recorded as
//     `fitIfAllowed`, so the box says what the fit would have been and why it stops anyway.
// Works from each link's saved posting text, so every number is reproducible with "Use saved copy".

import fs from "fs";
import path from "path";
import {
  runAgent,
  applyHumanDecision,
  applyLowFitOverride,
  applyClarificationAnswer,
  performFitEvaluation,
  type EvaluationResult,
} from "../src/lib/agent";
import { DEFAULT_SETTINGS } from "../src/lib/harnessSettings";
import { getModelName } from "../src/lib/llmEvaluator";
import { loadMemory, saveMemory } from "../src/lib/memory";
import { SAMPLE_PROFILES, sampleProfileText } from "../src/lib/samples";

type Link = Record<string, unknown> & {
  profile: string;
  title: string;
  postingText: string;
  score: number | null;
  stage: string;
  afterTailoring: number | null;
};

const outPath = path.join(__dirname, "..", "src", "data", "demo-links.json");
const pct = (n: number | null | undefined) => (n === null || n === undefined ? "  — " : `${Math.round(n * 100)}%`.padStart(4));

async function approveAndRescore(r: EvaluationResult, jobText: string, resume: string): Promise<number | null> {
  const approved = await applyHumanDecision(r, "approve", null, jobText, resume);
  return approved.state.rescore?.after ?? null;
}

async function fill(l: Link): Promise<Link> {
  const t = sampleProfileText(l.profile)!;
  const settings = DEFAULT_SETTINGS;
  const model = getModelName();
  const memory = await loadMemory({ jobText: l.postingText, resumeText: t.resumeText, settings, model });
  const r = await runAgent(`demo-${l.profile}`, l.postingText, t.resumeText, t.preferencesText, settings, memory);
  await saveMemory({
    jobText: l.postingText,
    resumeText: t.resumeText,
    settings,
    model,
    fit: r.fit,
    score: r.state.fitScore,
    stage: r.state.stage,
    profileName: SAMPLE_PROFILES.find((p) => p.key === l.profile)?.name ?? l.profile,
  });
  const ctx = { resumeText: t.resumeText, jobText: l.postingText, settings };

  let after: number | null = null;
  let afterVia: string | null = null;
  let fitIfAllowed: number | null = null;
  let afterNote: string | null = null;

  if (r.state.stage === "awaiting_approval") {
    // Keep the number already published when there is one: it is what was verified live.
    after = l.afterTailoring ?? (await approveAndRescore(r, l.postingText, t.resumeText));
    afterVia = "approve";
  } else if (r.state.stage === "rejected_low_fit") {
    const overridden = await applyLowFitOverride(r, "Demo: pursue anyway", ctx);
    after = await approveAndRescore(overridden, l.postingText, t.resumeText);
    afterVia = "override";
  } else if (r.state.stage === "awaiting_clarification") {
    let answered = await applyClarificationAnswer(r, "compatible", ctx);
    if (answered.state.stage === "rejected_low_fit") answered = await applyLowFitOverride(answered, "Demo: pursue anyway", ctx);
    if (answered.state.stage === "awaiting_approval") {
      after = await approveAndRescore(answered, l.postingText, t.resumeText);
      afterVia = "answer";
    } else afterNote = `stops at ${answered.state.stage} after the answer`;
  } else if (r.state.stage === "rejected_hard_constraint") {
    const fit = await performFitEvaluation(t.resumeText, l.postingText, settings, memory.ledger ?? null);
    fitIfAllowed = fit.score;
    afterNote = "No tailoring: the agent never drafts for a job that breaks a hard rule.";
  }

  // Tailoring only adds verified matches (the re-score is monotonic), so "after" below "before"
  // would be a bug, not a result.
  if (after !== null && r.state.fitScore !== null && after < r.state.fitScore) {
    throw new Error(`${l.profile} / ${l.title}: after ${after} < before ${r.state.fitScore}`);
  }

  return {
    ...l,
    score: r.state.fitScore,
    stage: r.state.stage,
    violations: r.state.hardConstraintViolations,
    afterTailoring: after,
    afterVia,
    afterNote,
    fitIfAllowed,
  };
}

(async () => {
  const links: Link[] = JSON.parse(fs.readFileSync(outPath, "utf-8"));
  const out: Link[] = [];
  for (let i = 0; i < links.length; i += 3) {
    const batch = await Promise.all(links.slice(i, i + 3).map(fill));
    for (const b of batch) {
      out.push(b);
      console.log(
        `${b.featured ? "*" : " "} ${b.profile.padEnd(13)} ${b.title.slice(0, 42).padEnd(42)} ${b.stage.padEnd(24)} ` +
          `before ${pct(b.score as number | null)}  after ${pct(b.afterTailoring)} ${b.afterVia ? `(${b.afterVia})` : ""}` +
          `${b.fitIfAllowed !== null ? `  skills-fit ${pct(b.fitIfAllowed as number)} but rule stops it` : ""}`
      );
    }
  }
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  const empty = out.filter((l) => l.afterTailoring === null && l.fitIfAllowed === null);
  console.log(`\n${out.length} links written; boxes with no number: ${empty.length}`);
  for (const e of empty) console.log(`  EMPTY ${e.profile} / ${e.title}: ${e.afterNote}`);
})();
