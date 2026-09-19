// Accuracy diagnostic: run every realistic profile against every realistic posting and
// show WHERE the score comes from, requirement by requirement.
//
// Why this exists: a job board recommends a posting on title + a few keywords + location.
// This agent scores every named requirement. Those two things disagree constantly, and
// the disagreement is only useful if you can see which requirements are being counted
// and whether counting them is fair.
//
//   set -a && source .env.local && set +a && npx tsx scripts/profile-matrix.ts
//   npx tsx scripts/profile-matrix.ts --profile finance-entry --job R-finance-analyst

import fs from "fs";
import path from "path";
import { runAgent } from "../src/lib/agent";
import { getModelName, isLlmConfigured } from "../src/lib/llmEvaluator";

const dataDir = path.join(__dirname, "..", "src", "data");
const profilesDir = path.join(dataDir, "profiles");
const realisticDir = path.join(dataDir, "jobs", "realistic");

interface Profile {
  id: string;
  resume: string;
  prefs: string;
}

function loadProfiles(): Profile[] {
  const out: Profile[] = [
    {
      id: "demo-data-analyst",
      resume: fs.readFileSync(path.join(dataDir, "resume.md"), "utf-8"),
      prefs: fs.readFileSync(path.join(dataDir, "preferences.md"), "utf-8"),
    },
  ];
  if (fs.existsSync(profilesDir)) {
    for (const dir of fs.readdirSync(profilesDir)) {
      const r = path.join(profilesDir, dir, "resume.md");
      const p = path.join(profilesDir, dir, "preferences.md");
      if (fs.existsSync(r) && fs.existsSync(p)) {
        out.push({
          id: dir,
          resume: fs.readFileSync(r, "utf-8"),
          prefs: fs.readFileSync(p, "utf-8"),
        });
      }
    }
  }
  return out;
}

const argv = process.argv.slice(2);
const only = (flag: string) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
};

async function main() {
  const profiles = loadProfiles().filter((p) => !only("--profile") || p.id === only("--profile"));
  const jobs = fs
    .readdirSync(realisticDir)
    .filter((f) => f.endsWith(".md"))
    .filter((f) => !only("--job") || f.startsWith(only("--job")!));

  console.log(`Brain: ${getModelName()} (LLM ${isLlmConfigured() ? "ON" : "OFF"})\n`);
  console.log("Every realistic profile x every realistic posting.\n");

  const grid: Record<string, Record<string, string>> = {};

  for (const profile of profiles) {
    grid[profile.id] = {};
    for (const jobFile of jobs) {
      const jobText = fs.readFileSync(path.join(realisticDir, jobFile), "utf-8");
      const jobId = jobFile.replace(/\.md$/, "");
      const r = await runAgent(jobId, jobText, profile.resume, profile.prefs);
      const s = r.state;
      const pct = Math.round((s.fitScore ?? 0) * 100);
      const bar = Math.round((s.minFit ?? 0.6) * 100);
      grid[profile.id][jobId] = `${pct}% ${s.stage.startsWith("rejected") ? "REJ" : "ok "}`;

      const partial = Object.entries(s.matchStrength ?? {})
        .filter(([, v]) => v === "partial")
        .map(([k]) => k);
      const preferred = new Set((s.missingPreferredSkills ?? []).map((x) => x.toLowerCase()));
      const missReq = s.missingSkills.filter((m) => !preferred.has(m.toLowerCase()));
      const missPref = s.missingSkills.filter((m) => preferred.has(m.toLowerCase()));

      console.log(`${"=".repeat(78)}`);
      console.log(`${profile.id}  x  ${jobId}`);
      console.log(`  SCORE ${pct}%  (their bar: ${bar}%)  -> ${s.stage}`);
      if (s.hardConstraintViolations.length) {
        console.log(`  HARD RULE: ${s.hardConstraintViolations.join("; ")}`);
      }
      console.log(`  counted ${s.matchedSkills.length + s.missingSkills.length} requirements`);
      console.log(`  MATCHED (${s.matchedSkills.length}):`);
      for (const m of s.matchedSkills) {
        const tag = partial.includes(m) ? "~partial" : "  full  ";
        console.log(`    [${tag}] ${m}`);
      }
      if (missReq.length) {
        console.log(`  MISSING - required (${missReq.length}):`);
        for (const m of missReq) console.log(`    [ REQUIRED ] ${m}`);
      }
      if (missPref.length) {
        console.log(`  MISSING - nice to have (${missPref.length}):`);
        for (const m of missPref) console.log(`    [ optional ] ${m}`);
      }
      if (s.fitReasoning) console.log(`  model says: ${s.fitReasoning}`);
      console.log();
    }
  }

  // Summary grid — the quick read on whether the numbers look sane.
  console.log("=".repeat(78));
  console.log("SUMMARY (REJ = auto-rejected against that profile's own bar)\n");
  const jobIds = jobs.map((f) => f.replace(/\.md$/, ""));
  const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);
  console.log(pad("profile", 22) + jobIds.map((j) => pad(j, 20)).join(""));
  for (const p of Object.keys(grid)) {
    console.log(pad(p, 22) + jobIds.map((j) => pad(grid[p][j] ?? "-", 20)).join(""));
  }
  console.log(
    "\nRead it diagonally: each profile should score highest on the posting from its own field."
  );
}

main();
