// Where is this job, and is that somewhere the candidate will work?
//
// Real postings broke the first version twice: "ACCEL Schools Marion, OH" was read as a town
// called "Schools Marion", and place names were matched as bare substrings, so "Portland, OR"
// contained "la" (Louisiana) and counted as the Southeast. A posting that names a headquarters
// before the job's own city could also be judged by the wrong city. These cases pin the rules.
//
//   LLM_PROVIDER=none DEEPSEEK_API_KEY= npx tsx scripts/location-tests.ts

import fs from "fs";
import path from "path";
import { runAgent } from "../src/lib/agent";

const data = path.join(__dirname, "..", "src", "data");
const kitPrefs = fs.readFileSync(path.join(data, "classkit", "preferences.md"), "utf-8"); // Atlanta / Remote / Hybrid within the Southeast
const nursePrefs = fs.readFileSync(path.join(data, "profiles", "nursing", "preferences.md"), "utf-8"); // Tucson / Phoenix / Remote
const teachPrefs = fs.readFileSync(path.join(data, "profiles", "teaching", "preferences.md"), "utf-8"); // Columbus / Dublin / Remote
const resume = "Test Candidate\nTotal professional experience: ~2 years";

const cases: [string, string, string, boolean, RegExp?][] = [
  ["Portland, OR is not the Southeast", "Data Analyst\nLocation: Portland, OR\nRequirements:\n- SQL", kitPrefs, true],
  ["New York is outside Atlanta/the Southeast (kit J006)", "Marketing Coordinator\nLocation: New York, NY\nRequirements:\n- Copywriting", kitPrefs, true],
  ["Atlanta is inside", "Data Analyst\nLocation: Atlanta, GA\nRequirements:\n- SQL", kitPrefs, false],
  ["Charlotte counts as the Southeast", "Data Analyst\nLocation: Charlotte, NC\nRequirements:\n- SQL", kitPrefs, false],
  [
    "a company name before the city is not part of the city",
    "6th-8th Grade Math Teacher\nACCEL Schools Marion, OH\nRequirements:\n- Ohio teaching license",
    teachPrefs,
    true,
    /Marion, OH/,
  ],
  [
    "a LinkedIn header 'Company City, ST' is read as the city",
    "Registered Nurse (RN) / MS / Telemetry (Tele)\nTalented Medical Solutions Tucson, AZ\nRequirements:\n- RN license",
    nursePrefs,
    false,
  ],
  [
    "a headquarters elsewhere does not override the job's own city",
    "Data Analyst\nHeadquartered in New York, NY. This role is based in Atlanta, GA.\nRequirements:\n- SQL",
    kitPrefs,
    false,
  ],
  ["a remote posting is never a relocation", "Data Analyst\nLocation: Remote - US\nRequirements:\n- SQL", kitPrefs, false],
];

(async () => {
  let failures = 0;
  for (const [label, posting, prefs, expectViolation, messageShape] of cases) {
    const r = await runAgent("loc", posting, resume, prefs);
    const v = r.state.hardConstraintViolations.filter((x) => /preferred locations/.test(x));
    const got = v.length > 0;
    const shapeOk = !messageShape || v.some((x) => messageShape.test(x));
    const ok = got === expectViolation && shapeOk;
    if (!ok) failures += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}\n      ${v.join("; ") || "no location violation"}`);
  }
  console.log(`\n${failures === 0 ? "ALL LOCATION TESTS PASSED" : `${failures} TEST(S) FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
})();
