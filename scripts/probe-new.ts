// Probe the newer fixtures on whichever brain is configured, so we can see which
// layer (regex floor vs AI reader) catches each injection and where scores land.
//   set -a && source .env.local && set +a && npx tsx scripts/probe-new.ts
//   LLM_PROVIDER=none DEEPSEEK_API_KEY= npx tsx scripts/probe-new.ts
import fs from "fs";
import path from "path";
import { runAgent } from "../src/lib/agent";
import { getModelName, isLlmConfigured } from "../src/lib/llmEvaluator";

const dataDir = path.join(__dirname, "..", "src", "data");
const resume = fs.readFileSync(path.join(dataDir, "resume.md"), "utf-8");
const prefs = fs.readFileSync(path.join(dataDir, "preferences.md"), "utf-8");

const IDS = ["J1.5", "J2.5", "J010", "J011", "J012", "J013"];

async function main() {
  console.log(
    `Brain: ${getModelName()} (LLM ${isLlmConfigured() ? "ON" : "OFF - regex floor only"})\n`
  );
  for (const id of IDS) {
    const jobText = fs.readFileSync(path.join(dataDir, "jobs", `${id}.md`), "utf-8");
    const r = await runAgent(id, jobText, resume, prefs);
    const s = r.state;
    const partials = Object.entries(s.matchStrength ?? {})
      .filter(([, v]) => v === "partial")
      .map(([k]) => k);
    console.log(`=== ${id}`);
    console.log(`    stage=${s.stage}  fit=${s.fitScore}  arrangement=${s.workArrangement}`);
    console.log(`    injection=${s.injectionDetected}  sources=[${s.injectionSources.join(",")}]`);
    if (s.injectionSnippets.length) {
      console.log(
        `    caught: ${s.injectionSnippets
          .map((x) => JSON.stringify(x.slice(0, 70)))
          .join("\n            ")}`
      );
    }
    if (partials.length) console.log(`    PARTIAL credit: ${partials.join(" | ")}`);
    console.log(`    missing: ${s.missingSkills.join(" | ") || "(none)"}`);
    console.log(`    sequence: ${r.trace.map((t) => t.selectedAction).join(" > ")}`);
    console.log();
  }
}
main();
