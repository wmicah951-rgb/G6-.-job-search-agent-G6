// Guards the docs against the code moving underneath them.
//
// This exists because the action inventory silently drifted THREE actions behind
// agent.ts while still stating "this is the literal set of choices", and several docs
// kept claiming the agent never calls an AI model long after it did. Cleaning that up
// once is worthless if nothing stops it recurring.
//
//   npx tsx scripts/doc-check.ts

import fs from "fs";
import path from "path";

const root = path.join(__dirname, "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf-8");

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "\n        " + detail : ""}`);
};

const agent = read("src", "lib", "agent.ts");

// ---------------------------------------------------------------- actions
// Every log() call passes selectedAction as the 3rd argument, on its own line
// immediately after the availableActions array. Collect them from the calls rather
// than guessing, so this can't fall out of step either.
const actions = new Set<string>();
for (const m of agent.matchAll(/(?:\]|permitted)\s*,\s*\n\s*"([a-z_]+)"\s*,/g)) actions.add(m[1]);

check("found the agent's action list", actions.size >= 10, `${actions.size} actions: ${[...actions].sort().join(", ")}`);

const inventory = read("docs", "architecture", "04-tool-action-inventory.md");
const undocumented = [...actions].filter((a) => !inventory.includes(`\`${a}\``));
check(
  "every action the agent can take is in the action inventory",
  undocumented.length === 0,
  undocumented.length ? `MISSING from 04-tool-action-inventory.md: ${undocumented.join(", ")}` : ""
);

// ---------------------------------------------------------------- no false claims
// Phrases that were once true and are now flatly wrong. Each caused a real
// contradiction in the shipped docs.
const BANNED: [string, RegExp][] = [
  ["claims no AI model is ever called", /no llm\/ai api is called anywhere/i],
  ["claims posting text never reaches a prompt", /there is no llm call, no `?eval`?, no template/i],
  ["claims every drafted line is a literal résumé quote", /every drafted bullet is a literal quote/i],
  ["states the dead 34% threshold as current", /34%\s*auto-reject threshold/i],
];
const docs = [
  ...fs.readdirSync(path.join(root, "docs", "architecture")).map((f) => path.join("docs", "architecture", f)),
  "README.md",
  "G6-AGENT.md",
  "PROJECT-BREAKDOWN.md",
  "TESTING-GUIDE.md",
  "HANDOFF.md",
  "DOCS-INDEX.md",
].filter((f) => f.endsWith(".md"));

for (const [label, re] of BANNED) {
  const hits = docs.filter((f) => re.test(read(f)));
  check(`no doc ${label}`, hits.length === 0, hits.join(", "));
}

// ---------------------------------------------------------------- thresholds
const lowFit = agent.match(/const LOW_FIT_THRESHOLD = ([\d.]+)/)?.[1];
check("LOW_FIT_THRESHOLD is readable from the code", !!lowFit, `= ${lowFit}`);
const prefs = read("src", "data", "preferences.md");
const prefBar = prefs.match(/minimum\s+fit[^0-9\n]*(\d{1,3})\s*%/i)?.[1];
check(
  "the demo profile's Minimum fit line agrees with the code default",
  !!prefBar && Number(prefBar) / 100 === Number(lowFit),
  `preferences.md says ${prefBar}%, code default ${Number(lowFit) * 100}%`
);

// ---------------------------------------------------------------- input cap
const cap = read("src", "lib", "llm", "types.ts").match(/MAX_INPUT_CHARS = (\d+)/)?.[1];
const capClaims = docs.filter((f) => /capped at (?:\*\*)?6,000/i.test(read(f)));
check("no doc still claims the old 6,000-character input cap", capClaims.length === 0, `cap is ${cap}; stale in: ${capClaims.join(", ")}`);

console.log(failed === 0 ? "\nDOC CHECK PASSED" : `\n${failed} DOC CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
