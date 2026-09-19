// Exports REAL decision traces to JSON for the submission PDF.
//
// The rubric requires system-generated traces. The PDF used to contain traces typed
// in by hand, which quietly went stale (old threshold, old action names). This script
// runs the actual agent and writes exactly what it logged, so the PDF can never again
// show a trace the code did not produce.
//
//   set -a && source .env.local && set +a && npx tsx scripts/export-traces.ts

import fs from "fs";
import path from "path";
import { runAgent, applyHumanDecision, applyClarificationAnswer } from "../src/lib/agent";
import { getModelName } from "../src/lib/llmEvaluator";

const dataDir = path.join(__dirname, "..", "src", "data");
const resume = fs.readFileSync(path.join(dataDir, "resume.md"), "utf-8");
const prefs = fs.readFileSync(path.join(dataDir, "preferences.md"), "utf-8");
const job = (id: string) => fs.readFileSync(path.join(dataDir, "jobs", `${id}.md`), "utf-8");

const slim = (trace: any[]) =>
  trace.map((t) => ({
    step: t.step,
    action: t.selectedAction,
    available: t.availableActions,
    observation: t.observation,
    result: t.result,
    stageAfter: t.stateAfter?.stage,
  }));

async function main() {
  const out: any = { model: getModelName(), generatedAt: new Date().toISOString(), runs: {} };

  for (const id of ["J001", "J002", "J003", "J004", "J007"]) {
    const r = await runAgent(id, job(id), resume, prefs);
    out.runs[id] = {
      stage: r.state.stage,
      fitScore: r.state.fitScore,
      matched: r.state.matchedSkills,
      missing: r.state.missingSkills,
      violations: r.state.hardConstraintViolations,
      injectionSnippets: r.state.injectionSnippets,
      injectionSources: r.state.injectionSources,
      trace: slim(r.trace),
    };
    console.log(id, r.state.stage, r.state.fitScore, r.trace.map((t) => t.selectedAction).join(">"));
  }

  // J004 carried all the way through: human edits -> draft -> verify -> re-score.
  const j4 = await runAgent("J004", job("J004"), resume, prefs);
  const j4done = await applyHumanDecision(
    j4,
    "edit",
    "Emphasize willingness to grow into missing skills; still worth a shot.",
    job("J004"),
    resume
  );
  out.runs.J004_full = {
    stage: j4done.state.stage,
    rescore: j4done.state.rescore,
    verification: j4done.state.draftVerification?.totals,
    coverLetterVerification: j4done.state.coverLetterVerification?.totals,
    coverLetterExcerpt: (j4done.state.coverLetter ?? "").slice(0, 700),
    trace: slim(j4done.trace),
  };
  console.log("J004_full", j4done.trace.map((t) => t.selectedAction).join(">"));

  // J001 approved, for the approval-evidence section.
  const j1 = await runAgent("J001", job("J001"), resume, prefs);
  const j1done = await applyHumanDecision(j1, "approve", null, job("J001"), resume);
  out.runs.J001_approved = {
    stage: j1done.state.stage,
    rescore: j1done.state.rescore,
    verification: j1done.state.draftVerification?.totals,
    resumeExcerpt: (j1done.state.tailoredResume ?? "").slice(0, 900),
    trace: slim(j1done.trace),
  };
  console.log("J001_approved", j1done.trace.map((t) => t.selectedAction).join(">"));

  // J007 ASK_USER answered both ways.
  const j7 = await runAgent("J007", job("J007"), resume, prefs);
  out.runs.J007_compatible = { trace: slim(applyClarificationAnswer(j7, "compatible").trace) };
  out.runs.J007_violation = { trace: slim(applyClarificationAnswer(j7, "violation").trace) };

  const seqs = new Set(
    ["J001", "J002", "J003", "J004"].map((id) => out.runs[id].trace.map((t: any) => t.action).join(">"))
  );
  out.distinctRequired = seqs.size;

  const dest = path.join(__dirname, "..", "docs", "submission", "traces.json");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(out, null, 2));
  console.log(`\ndistinct required sequences: ${seqs.size}/4\nwrote ${dest}`);
}
main();
