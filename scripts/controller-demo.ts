// Shows WHO chose each action. For every posting it prints the executed sequence, tagging
// each step  [model] = the controller picked among 2+ permitted actions,
//            [guard] = only one action was permitted (a guardrail, not a choice),
//            [policy] = default policy (no model, model failed, or proposal refused),
// plus the model's own reason. This is the runtime evidence that the model, not a fixed
// script, selects the next action, and that the harness bounds what it may pick.
//
//   set -a && source .env.local && set +a && npx tsx scripts/controller-demo.ts [ids...]
import fs from "fs";
import path from "path";
import { runAgent } from "../src/lib/agent";
import { getModelName } from "../src/lib/llmEvaluator";

const dataDir = path.join(__dirname, "..", "src", "data");
const resume = fs.readFileSync(path.join(dataDir, "resume.md"), "utf-8");
const prefs = fs.readFileSync(path.join(dataDir, "preferences.md"), "utf-8");

const ids = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["J001", "J002", "J003", "J004", "J007", "J1.5", "J2.5", "spec/K002", "spec/K003"];
const TAG = { model: "model", harness: "guard", policy: "policy" } as const;

async function main() {
  console.log(`Controller: ${getModelName()}\n`);
  for (const id of ids) {
    const text = fs.readFileSync(path.join(dataDir, "jobs", `${id}.md`), "utf-8");
    const r = await runAgent(id, text, resume, prefs);
    console.log(`${id}  ->  ${r.state.stage}   (fit ${r.state.fitScore ?? "not evaluated"})`);
    for (const t of r.trace) {
      const who = TAG[t.chosenBy ?? "policy"];
      const opts = t.availableActions.length > 1 && t.availableActions.length <= 3 ? `  options: [${t.availableActions.join(" | ")}]` : "";
      console.log(`   ${t.step}. [${who}] ${t.selectedAction}${opts}`);
      const thought = t.thinking ?? t.modelReasoning;
      if (thought) console.log(`        ${t.brain === "ai" ? "AI thinking" : "thinking"}: ${thought.split("\n").join(" / ")}`);
      if (t.overruled) console.log(`        harness overruled: ${t.overruled}`);
    }
    const ad = r.state.advice;
    if (ad) {
      console.log(`   ADVISOR (${ad.source}): ${ad.headline}`);
      console.log(`      recommends: ${ad.recommendation} - ${ad.recommendationWhy}`);
      if (ad.rankedGaps.length) console.log(`      gaps ranked: ${ad.rankedGaps.map((g) => `${g.gap} [${g.importance}]`).join(" > ")}`);
      for (const p of ad.draftPresets) console.log(`      preset: "${p.label}"  <- backed by: "${p.evidenceQuote.slice(0, 70)}"`);
      if (ad.overruled) console.log(`      harness note: ${ad.overruled}`);
    }
    console.log("");
  }
}
main();
