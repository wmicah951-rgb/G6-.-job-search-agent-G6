// Offline checks for the tailored-résumé repair helpers (src/lib/agent.ts): lines the draft left
// out go back verbatim, in the right place, exactly once; confirmed answers are added once.
//   npx tsx scripts/restore-lines-tests.ts
import fs from "fs";
import { restoreOriginalLines, addQualifications, keepWorthyLine, mergeKnownEvidence, evidenceOf } from "../src/lib/agent";

const original = fs.readFileSync("src/data/classkit/resume.md", "utf-8");
let fails = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) fails += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
};
const sqlLine = "- Used SQL to answer recurring questions on store performance and customer purchase patterns with guidance from a senior analyst.";
const courseLine = "Relevant coursework: Data Management, Business Analytics, Python for Business, Systems Analysis";
const dining = "- Analyzed approximately 12,000 anonymized transaction records using Python and SQL to identify peak demand periods and product-mix differences.";
// A draft that dropped the SQL bullet, the coursework line and the whole projects section.
const draft = original
  .split("\n")
  .filter((l) => l.trim() !== sqlLine && !l.startsWith("Relevant coursework") && !/Campus Dining|12,000|three operational/.test(l))
  .join("\n")
  .replace("## Projects", "## PROJECTS");

const fixed = restoreOriginalLines(draft, original, [sqlLine, courseLine, dining]);
const lines = fixed.split("\n");
const sqlAt = lines.findIndex((l) => l.trim() === sqlLine);
const peachtree = lines.findIndex((l) => l.includes("Peachtree Retail Group"));
const gsu = lines.findIndex((l) => l.includes("Student Technology Assistant"));
check(sqlAt > peachtree && sqlAt < gsu, "a dropped bullet goes back under its own employer");
const edu = lines.findIndex((l) => /^## Education/.test(l));
const skills = lines.findIndex((l) => /^## Skills/.test(l));
const courseAt = lines.findIndex((l) => l.includes("Relevant coursework"));
check(courseAt > edu && courseAt < skills, "a dropped education line goes back into Education");
const projAt = lines.findIndex((l) => l.includes("12,000"));
check(projAt > lines.findIndex((l) => /^## PROJECTS/.test(l)), "a line whose entry is gone goes back into the same section (heading case ignored)");
check(restoreOriginalLines(fixed, original, [sqlLine]) === fixed || restoreOriginalLines(fixed, original, [sqlLine]).split(sqlLine).length === 2, "restoring twice does not duplicate");
check(restoreOriginalLines("# Jordan\n\n## Summary\nAnalyst.\n", original, [dining]).includes("## Additional Experience"), "no matching section: goes into Additional Experience");
check(!keepWorthyLine("*Fictional résumé created for classroom use. All names, contact details, employers, and experiences are illustrative.*"), "disclaimer lines are not restored");
check(!keepWorthyLine("Atlanta, GA | jordan.lee@example.com | (404) 555-0142"), "contact lines are not restored");
check(keepWorthyLine(sqlLine), "real bullets are restored");

const q = addQualifications(fixed, ["- Snowflake: I use Snowflake daily for warehouse queries"]);
check(/## Additional Qualifications\n- Snowflake: I use Snowflake daily/.test(q), "confirmed answers are added in the person's words");
check(addQualifications(q, ["- Snowflake: I use Snowflake daily for warehouse queries"]) === q, "adding the same answer twice changes nothing");

const ledger = [
  { requirement: "SQL", priority: "required" as const },
  { requirement: "Tableau", priority: "required" as const },
  { requirement: "Databases", priority: "required" as const },
];
const base = { score: 1 / 3, matched: ["SQL"], missing: ["Tableau", "Databases"], missingPreferred: [], matchedEvidence: { SQL: "Used SQL" }, method: "llm" as const, reasoning: null, note: "" };
const kept = mergeKnownEvidence(base, fixed, evidenceOf(["Tableau"], { Tableau: "Built a Tableau dashboard tracking product sell-through" }), ledger);
check(kept.matched.includes("Tableau") && !kept.missing.includes("Tableau") && Math.abs(kept.score - 2 / 3) < 0.01, "a sentence already judged as evidence, still in the document, stays evidence");
const reworded = "- Answered recurring business questions on store performance and customer purchase patterns in SQL";
const rw = mergeKnownEvidence(base, reworded, [{ requirement: "Databases", quote: "Used SQL to answer recurring questions on store performance and customer purchase patterns", strength: "full" }], ledger);
check(rw.matched.includes("Databases") && rw.matchedEvidence.Databases.includes("Answered recurring"), "a lightly reworded sentence still counts, with the document's own words as evidence");
const gone = mergeKnownEvidence(base, ["# Someone", "- Managed a bakery"].join(String.fromCharCode(10)), [{ requirement: "Tableau", quote: "Built a Tableau dashboard tracking product sell-through", strength: "full" }], ledger);
check(gone === base, "evidence the document does not contain is not credited");

console.log(fails ? `${fails} FAILED` : "ALL RESTORE CHECKS PASS");
process.exitCode = fails ? 1 : 0;
