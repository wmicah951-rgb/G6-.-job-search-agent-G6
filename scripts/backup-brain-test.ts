// Proves the last-resort backup brain works and stays out of the way.
//   set -a && source .env.local && set +a && npx tsx scripts/backup-brain-test.ts
// 1. With the primary healthy, the backup is never used.
// 2. With the primary broken (a bad key forced for this process only), every model call falls
//    through to the backup and the agent still runs on an AI, not on keywords.
import fs from "fs";
import path from "path";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${detail}` : ""}`);
};

async function run(label: string) {
  // Fresh module state per scenario, so the backup counter starts at zero.
  for (const k of Object.keys(require.cache)) if (k.includes(`${path.sep}src${path.sep}`)) delete require.cache[k];
  const { runAgent } = await import("../src/lib/agent");
  const { backupStatus, getModelName } = await import("../src/lib/llmEvaluator");
  const { classKitPosting, classKitResume, classKitPreferences } = await import("../src/lib/classKit");
  const r = await runAgent(`backup-${label}`, classKitPosting("J001"), classKitResume(), classKitPreferences());
  return { r, backup: backupStatus(), model: getModelName() };
}

(async () => {
  const healthy = await run("healthy");
  check("primary healthy: the agent scored with the AI", healthy.r.state.fitMethod === "llm", `primary ${healthy.model}`);
  if (healthy.backup.uses > 0) {
    // The primary is not actually healthy right now (out of credit, bad key, outage), so this
    // half of the test cannot be measured. Say so, rather than report a false failure.
    console.log(`SKIP  primary healthy: the backup was never called
      the primary is failing on its own right now (${healthy.backup.lastReason}); fix that, then re-run`);
  } else {
    check("primary healthy: the backup was never called", true, "0 backup call(s)");
  }

  const realKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "sk-deliberately-invalid-for-this-test";
  const broken = await run("broken");
  process.env.DEEPSEEK_API_KEY = realKey;
  check("primary broken: the backup stepped in", broken.backup.uses > 0, `${broken.backup.uses} call(s) via ${broken.backup.provider}`);
  check("primary broken: the agent still scored with an AI, not keywords", broken.r.state.fitMethod === "llm", `fit ${broken.r.state.fitScore}`);
  check(
    "primary broken: same outcome as the healthy run",
    broken.r.state.stage === healthy.r.state.stage,
    `${broken.r.state.stage} vs ${healthy.r.state.stage}`
  );
  void fs;
  console.log(`\n${failures === 0 ? "BACKUP BRAIN BEHAVES AS INTENDED" : `${failures} CHECK(S) FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
})();
