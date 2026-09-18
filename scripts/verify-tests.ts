// Acceptance tests for the draft verifier (src/lib/draftVerifier.ts).
//
// The critical property is NOT "catches fabrication" — it is "catches fabrication
// WITHOUT crying wolf on honest rewording". A verifier that flags paraphrase gets
// ignored after two uses. So fixture C (heavily but honestly reworded) is the one
// that matters most, and it must produce ZERO flags.

import fs from "fs";
import path from "path";
import { verifyDraft } from "../src/lib/draftVerifier";

const resume = fs.readFileSync(
  path.join(__dirname, "..", "src", "data", "resume.md"),
  "utf-8"
);

// (A) Faithful tailoring — real output from the live DeepSeek draft path.
const FAITHFUL = `# Jordan Ellis

jordan.ellis@email.com | (555) 123-4567 | Remote | linkedin.com/in/jordanellis

## SUMMARY

Data analyst with 2 years of professional experience turning messy operational data into dashboards and reports. Strong in SQL, Python with pandas, Excel, and Power BI.

## SKILLS

**Query & Analysis:** SQL, Postgres, window functions, joins, group by
**BI & Reporting:** Power BI, Excel, pivot tables, VLOOKUP

## EXPERIENCE

**Meridian Logistics — Data Analyst** | Jun 2024 - Present
- Built weekly Power BI dashboards tracking on-time delivery rate across 40 warehouses
- Wrote SQL queries with joins, group by, and window functions against a Postgres warehouse
- Automated a manual Excel reconciliation process with Python and pandas, cutting a 6-hour weekly task to 20 minutes

**Halden Retail Co. — Business Intelligence Intern** | May 2023 - Aug 2023
- Cleaned and merged POS data from 3 regional systems into one reporting table
`;

// (B) Two deliberate fabrications: a metric that is nowhere in the resume (92%)
// and an employer that does not exist (Vertex Global).
const FABRICATED = `# Jordan Ellis

## EXPERIENCE

**Meridian Logistics — Data Analyst** | Jun 2024 - Present
- Built weekly Power BI dashboards tracking on-time delivery rate across 40 warehouses
- Improved forecast accuracy by 92% using advanced predictive modelling techniques
- Led the analytics workstream for Vertex Global during their supply chain migration
`;

// (C) The same facts as (A), rewritten hard: different verbs, different sentence
// shapes, reordered clauses. Every number and name still traces to the resume.
const REWORDED = `# Jordan Ellis

## EXPERIENCE

**Meridian Logistics — Data Analyst** | Jun 2024 - Present
- Owned the weekly reporting cadence, delivering Power BI dashboards that surfaced on-time delivery performance across a 40-warehouse network
- Authored analytical SQL against a Postgres warehouse, leaning on joins, grouping and window functions to answer operational questions
- Replaced a manual Excel reconciliation routine with a Python and pandas workflow, compressing a 6-hour weekly chore into roughly 20 minutes

**Halden Retail Co. — Business Intelligence Intern** | May 2023 - Aug 2023
- Consolidated point-of-sale records drawn from 3 regional systems into a single reporting table
`;

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
}

function flagged(draft: string) {
  const v = verifyDraft(draft, resume, null);
  return {
    v,
    bad: v.claims.filter((c) => c.verdict === "unsupported"),
  };
}

console.log("Draft verifier acceptance tests\n");

// --- A: faithful -------------------------------------------------------------
{
  const { v, bad } = flagged(FAITHFUL);
  check(
    "A. Faithful tailoring raises ZERO flags",
    bad.length === 0,
    bad.length ? "flagged: " + bad.map((c) => c.unsupportedFacts.join("/")).join(" | ") : ""
  );
  check(
    "A. and it actually checked real claims (not everything skipped)",
    v.totals.claims >= 5,
    `claims=${v.totals.claims}`
  );
}

// --- B: fabricated -----------------------------------------------------------
{
  const { bad } = flagged(FABRICATED);
  const facts = bad.flatMap((c) => c.unsupportedFacts).join(" ").toLowerCase();
  check("B. Fabricated metric (92%) is caught", facts.includes("92"), facts);
  check("B. Fabricated employer (Vertex Global) is caught", facts.includes("vertex"), facts);
  check(
    "B. Genuine bullets in the same draft are NOT flagged",
    bad.length === 2,
    `flagged ${bad.length} of 3 bullets`
  );
}

// --- C: honest rewording — the one that matters ------------------------------
{
  const { v, bad } = flagged(REWORDED);
  check(
    "C. Heavy but honest rewording raises ZERO flags",
    bad.length === 0,
    bad.length
      ? "FALSE ALARMS: " + bad.map((c) => `${c.unsupportedFacts.join("/")} in "${c.text.slice(0, 60)}"`).join(" | ")
      : ""
  );
  check(
    "C. and it is recognised as coming from the resume, not invented",
    v.totals.grounded + v.totals.reworded >= 3,
    `grounded=${v.totals.grounded} reworded=${v.totals.reworded} subjective=${v.totals.subjective}`
  );
}

// --- edit-note provenance ----------------------------------------------------
{
  const note = "I built Tableau dashboards for a university capstone project on retail analytics.";
  const draft = `# Jordan Ellis

## EXPERIENCE
- Built Tableau dashboards for a university capstone project on retail analytics
`;
  const v = verifyDraft(draft, resume, note);
  const claim = v.claims.find((c) => c.verdict !== "structural");
  check(
    "D. A claim supplied in the human's note is attributed to the note",
    claim?.verdict === "from_your_note",
    `verdict=${claim?.verdict}`
  );

  const vNoNote = verifyDraft(draft, resume, null);
  const badNoNote = vNoNote.claims.filter((c) => c.verdict === "unsupported");
  check(
    "D. The same claim WITHOUT the note is flagged (Tableau is not on the resume)",
    badNoNote.length === 1,
    badNoNote.map((c) => c.unsupportedFacts.join("/")).join("")
  );
}

// --- E. the posting's own job title, quoted back in a cover letter ------------
// A cover letter always names the role. Those words are not on the resume and never
// will be — flagging them made the panel fire on the very first line of every letter.
{
  const draft = "I'm applying for the Senior-ish Data Analyst role.";
  const withTitle = verifyDraft(draft, resume, null, { jobTitle: "Senior-ish Data Analyst" });
  const withoutTitle = verifyDraft(draft, resume, null);
  check(
    "E. Naming the role in an 'applying for...' sentence is NOT flagged",
    withTitle.claims.filter((c) => c.verdict === "unsupported").length === 0,
    withTitle.claims.map((c) => c.unsupportedFacts.join("/")).join("")
  );
  check(
    "E. but the exemption is scoped to the job title, not a blanket pass",
    withoutTitle.claims.filter((c) => c.verdict === "unsupported").length === 1
  );
  // The dangerous case must still be caught: claiming a skill the POSTING asked for.
  const sneaky = verifyDraft(
    "I built Tableau dashboards for 40 warehouses last year.",
    resume,
    null,
    { jobTitle: "Tableau Data Analyst" }
  );
  check(
    "E. Claiming a skill named in the posting is STILL flagged (not exempted)",
    sneaky.claims.some((c) => c.verdict === "unsupported"),
    sneaky.claims.map((c) => c.verdict).join(",")
  );
}

// --- F. willingness language ---------------------------------------------------
// DRAFT_SYSTEM_PROMPT tells the model to express willingness for missing skills, so
// "eager to learn X" / "growing into X" is expected output, not fabrication.
{
  for (const sentence of [
    "I am keen on growing into Snowflake and applied statistics.",
    "I have not yet worked with Tableau in a professional setting.",
    "I'm eager to learn dbt and would pick it up quickly.",
  ]) {
    const v = verifyDraft(sentence, resume, null);
    check(
      `F. Honest gap statement is not flagged: "${sentence.slice(0, 44)}..."`,
      v.claims.filter((c) => c.verdict === "unsupported").length === 0,
      v.claims.map((c) => `${c.verdict}:${c.unsupportedFacts.join("/")}`).join(" ")
    );
  }
}

console.log(
  failures === 0 ? "\nALL VERIFIER TESTS PASSED" : `\n${failures} VERIFIER TEST(S) FAILED`
);
process.exit(failures === 0 ? 0 : 1);
