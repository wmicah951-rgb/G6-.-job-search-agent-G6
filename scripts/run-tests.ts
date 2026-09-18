import fs from "fs";
import path from "path";
import { runAgent, applyHumanDecision } from "../src/lib/agent";

const dataDir = path.join(__dirname, "..", "src", "data");
const resumeText = fs.readFileSync(path.join(dataDir, "resume.md"), "utf-8");
const preferencesText = fs.readFileSync(path.join(dataDir, "preferences.md"), "utf-8");

const jobIds = ["J001", "J002", "J003", "J004", "J005", "J006"];

async function printTrace(jobId: string, label: string) {
  const jobText = fs.readFileSync(path.join(dataDir, "jobs", `${jobId}.md`), "utf-8");
  console.log("\n" + "=".repeat(80));
  console.log(`${jobId} — ${label}`);
  console.log("=".repeat(80));

  const result = await runAgent(jobId, jobText, resumeText, preferencesText);

  for (const t of result.trace) {
    console.log(`\n[Step ${t.step}] selected_action = ${t.selectedAction}`);
    console.log(`  state_before.stage   : ${t.stateBefore.stage}`);
    console.log(`  observation          : ${t.observation}`);
    console.log(`  available_actions    : [${t.availableActions.join(", ")}]`);
    console.log(`  result               : ${t.result}`);
    console.log(`  state_after.stage    : ${t.stateAfter.stage}`);
  }

  console.log(`\n  ACTION SEQUENCE: ${result.trace.map((t) => t.selectedAction).join(" -> ")}`);
  console.log(`  FINAL STAGE: ${result.state.stage}`);

  // If the agent reached awaiting_approval, simulate one human decision to
  // produce approval evidence + a grounded draft.
  if (result.state.stage === "awaiting_approval") {
    const decision = jobId === "J001" ? "approve" : "edit";
    const note =
      decision === "edit"
        ? "Emphasize willingness to grow into missing skills; still worth a shot."
        : null;
    console.log(`\n  --- HUMAN-IN-THE-LOOP: simulating decision = "${decision}" ---`);
    const after = applyHumanDecision(result, decision, note, jobText);
    const newSteps = after.trace.slice(result.trace.length);
    for (const t of newSteps) {
      console.log(`\n[Step ${t.step}] selected_action = ${t.selectedAction}`);
      console.log(`  observation          : ${t.observation}`);
      console.log(`  result               : ${t.result}`);
    }
    console.log(`\n  DRAFT OUTPUT:\n${after.state.draft}`);
  }

  return result;
}

async function main() {
  const results: Record<string, Awaited<ReturnType<typeof runAgent>>> = {};
  results["J001"] = await printTrace("J001", "obvious fit");
  results["J002"] = await printTrace("J002", "partial fit");
  results["J003"] = await printTrace("J003", "hard-constraint conflict (years + clearance + on-site)");
  results["J004"] = await printTrace("J004", "prompt injection embedded in posting");
  await printTrace("J005", "extra: low fit");
  await printTrace("J006", "extra: good fit");

  console.log("\n" + "=".repeat(80));
  console.log("CROSS-CHECK: required tests produced materially different action sequences");
  console.log("=".repeat(80));
  for (const id of ["J001", "J002", "J003", "J004"]) {
    const seq = results[id]?.trace.map((t) => t.selectedAction).join(" -> ");
    console.log(`${id}: ${seq}`);
  }
  const seqs = new Set(
    ["J001", "J002", "J003", "J004"].map((id) => results[id]?.trace.map((t) => t.selectedAction).join(","))
  );
  console.log(`\nDistinct sequences across required tests: ${seqs.size} / 4`);
}

main();
