// PROVES THE SCORE HOLDS STILL.
//
// The complaint this answers: the same posting and the same résumé produced 42% one run and
// 58% the next, so nobody could trust the number or tell whether a tailored draft had actually
// improved anything. Cause: every run asked the model to read the requirements out of the
// posting afresh, and a model does not return the same list twice — so the denominator moved.
//
// The fix is memory (src/lib/memory.ts): the first run's requirement list is stored and every
// later run is judged against that same list, and a verdict already reached for this exact
// posting + résumé is reused outright. This script measures the result.
//
//   set -a && source .env.local && set +a && npx tsx scripts/stability.ts
//   NO_MEMORY=1 ... npx tsx scripts/stability.ts    # the old behaviour, for comparison
//
// Runs each posting N times (default 3) and reports the spread. With memory the spread must be
// exactly 0; the same script with NO_MEMORY=1 shows the drift the memory removes.

import fs from "fs";
import path from "path";
import { runAgent } from "../src/lib/agent";
import { classKitPosting, classKitPreferences, classKitResume } from "../src/lib/classKit";
import { getModelName, isLlmConfigured } from "../src/lib/llmEvaluator";
import { DEFAULT_SETTINGS } from "../src/lib/harnessSettings";
import { forgetLedger, loadMemory, saveMemory } from "../src/lib/memory";

const RUNS = Number(process.env.RUNS ?? 3);
const useMemory = process.env.NO_MEMORY !== "1";
const dataDir = path.join(__dirname, "..", "src", "data");

async function scoreOnce(id: string, jobText: string, resume: string, prefs: string): Promise<number | null> {
  const memory = useMemory
    ? await loadMemory({ jobText, resumeText: resume, settings: DEFAULT_SETTINGS, model: getModelName() })
    : {};
  const r = await runAgent(`stability-${id}`, jobText, resume, prefs, DEFAULT_SETTINGS, memory);
  if (useMemory) {
    await saveMemory({
      jobText,
      resumeText: resume,
      settings: DEFAULT_SETTINGS,
      model: getModelName(),
      fit: r.fit,
      score: r.state.fitScore,
      stage: r.state.stage,
      profileName: "stability script",
    });
  }
  return r.state.fitScore;
}

async function main() {
  console.log(
    `Score stability — ${RUNS} runs per posting, memory ${useMemory ? "ON" : "OFF"}, brain ${
      isLlmConfigured() ? getModelName() : "none (deterministic)"
    }\n`
  );

  const cases: { id: string; jobText: string; resume: string; prefs: string }[] = [
    // The class kit's two scoring cases, against the kit's own candidate.
    { id: "KIT-J001", jobText: classKitPosting("J001"), resume: classKitResume(), prefs: classKitPreferences() },
    { id: "KIT-J002", jobText: classKitPosting("J002"), resume: classKitResume(), prefs: classKitPreferences() },
    { id: "KIT-J005", jobText: classKitPosting("J005"), resume: classKitResume(), prefs: classKitPreferences() },
    // And the demo profile's own borderline posting, historically the worst drifter.
    {
      id: "J002 (demo résumé)",
      jobText: fs.readFileSync(path.join(dataDir, "jobs", "J002.md"), "utf-8"),
      resume: fs.readFileSync(path.join(dataDir, "resume.md"), "utf-8"),
      prefs: fs.readFileSync(path.join(dataDir, "preferences.md"), "utf-8"),
    },
  ];

  let worst = 0;
  for (const c of cases) {
    // Start from no memory of this posting so the first run below is genuinely a first read.
    if (useMemory) await forgetLedger(c.jobText);
    const scores: (number | null)[] = [];
    for (let i = 0; i < RUNS; i++) scores.push(await scoreOnce(c.id, c.jobText, c.resume, c.prefs));
    const nums = scores.filter((s): s is number => s !== null);
    const spread = nums.length ? Math.round((Math.max(...nums) - Math.min(...nums)) * 100) : 0;
    worst = Math.max(worst, spread);
    console.log(
      `${spread === 0 ? "STABLE" : "DRIFT "}  ${c.id.padEnd(20)} ${scores
        .map((s) => (s === null ? " n/a" : `${Math.round(s * 100)}%`.padStart(4)))
        .join(" ")}   spread ${spread} point(s)`
    );
  }

  console.log("");
  if (useMemory) {
    if (worst === 0) console.log("Every posting returned the identical score on every run.");
    else console.log(`FAIL: worst spread was ${worst} points with memory on — it should be 0.`);
    if (worst !== 0) process.exitCode = 1;
  } else {
    console.log(`Memory off: worst spread ${worst} points. This is the drift memory removes.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
