// Reading a posting's years-of-experience requirement — including the traps real postings set.
//
// A real LinkedIn posting ("American Residential Services has 45 years of experience serving
// homeowners") made the agent reject an HVAC job for "requiring 45+ years": the company's history
// uses exactly the words a requirement does. And "12+ years of HVAC experience" was not recognised
// at all, because only "years of experience" with nothing in between was. These cases pin both.
//
//   LLM_PROVIDER=none DEEPSEEK_API_KEY= npx tsx scripts/years-tests.ts

import { runAgent } from "../src/lib/agent";

const prefs = "## Hard constraints\n- Will NOT apply to roles requiring 10+ years of professional experience\n";
const resume = "Marcus Bell\nHVAC service technician\nTotal professional experience: ~6 years";

const cases: [string, string, boolean][] = [
  [
    "a company's own history is not a requirement",
    "HVAC Service Tech\nLocation: Greensboro, NC\nAmerican Residential Services has 45 years of experience serving homeowners.\nRequirements:\n- EPA 608\n- 2+ years of HVAC experience",
    false,
  ],
  ["'12+ years of HVAC experience' is a requirement", "Senior Mechanic\nLocation: Greensboro, NC\nRequirements:\n- 12+ years of HVAC experience", true],
  [
    "'our team brings 30 years' is not a requirement",
    "Tech\nLocation: Greensboro, NC\nOur team brings 30 years of experience to every job. You will need 3 years of experience.",
    false,
  ],
  ["'minimum 11 years in …' is a requirement", "Lead\nLocation: Greensboro, NC\nMinimum 11 years in commercial refrigeration.", true],
  ["a requirement under the candidate's limit breaks no rule", "Analyst\nLocation: Greensboro, NC\n5+ years of professional experience required.", false],
];

(async () => {
  let failures = 0;
  for (const [label, text, expectViolation] of cases) {
    const r = await runAgent("years", text, resume, prefs);
    const got = r.state.hardConstraintViolations.length > 0;
    if (got !== expectViolation) failures += 1;
    console.log(`${got === expectViolation ? "PASS" : "FAIL"}  ${label}\n      ${r.state.hardConstraintViolations.join("; ") || "no violation"}`);
  }
  console.log(`\n${failures === 0 ? "ALL YEARS TESTS PASSED" : `${failures} TEST(S) FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
})();
