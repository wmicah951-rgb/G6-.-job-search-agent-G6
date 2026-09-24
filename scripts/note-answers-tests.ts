// How the agent reads a person's answers to its gap questions.
//
// When someone answers "YES — I build PowerPoint decks every week" to a gap, that answer must reach
// the draft AND the re-score. A "NO — never did" answer must never be credited, and must never make
// a claim in the draft look sourced. These rules are small and easy to break, so they are tested
// directly, including the older note formats the job page used to write.
//
//   npx tsx scripts/note-answers-tests.ts

import { confirmedAnswers, confirmedExperienceFromNote, deniedFromNote, noteForVerification } from "../src/lib/agent";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${detail}` : ""}`);
};

const note = [
  "Open the summary by naming your Power BI dashboard work.",
  "- Ability to create compelling PPT presentations: YES — I build weekly PowerPoint decks for leadership",
  "- Must comply with HIPAA rules and regulations: NO — never did but can learn",
  "- Tableau: YES",
  // the older formats the page used to write
  "- Experience with Exposure to cloud platforms (or equivalent): [answer honestly, then delete these brackets — have you used any cloud service hands-on? YES AT THE FUNDAMENTALS LEVEL",
  "- Experience with Data warehousing (or equivalent): never did, willing to learn",
  "- For SQL requirement: 2 years querying Postgres at my internship",
].join("\n");

const confirmed = confirmedExperienceFromNote(note);
check("a YES answer with words is read as confirmed experience", confirmed.some((c) => /PPT presentations: I build weekly PowerPoint/.test(c)), confirmed.join(" | "));
check("a bare YES is read as confirmed experience", confirmed.some((c) => /^Tableau:/.test(c)));
check("an old-format answer is read, with the question stripped out", confirmed.some((c) => /cloud platforms: YES AT THE FUNDAMENTALS LEVEL$/.test(c)), confirmed.find((c) => /cloud/.test(c)) ?? "missing");
check("a 'For X requirement' line is read", confirmed.some((c) => /^SQL: 2 years querying Postgres/.test(c)));
check("a NO answer is NOT read as experience", !confirmed.some((c) => /HIPAA/i.test(c)));
check("a negative old-format answer is NOT read as experience", !confirmed.some((c) => /warehousing/i.test(c)));
check("drafting instructions are not mistaken for experience", !confirmed.some((c) => /Open the summary/.test(c)));

const denied = deniedFromNote(note);
check("the NO answers are recognised as denied", denied.includes("Must comply with HIPAA rules and regulations") && denied.includes("Data warehousing"), denied.join(" | "));
check("a YES answer is never listed as denied", !denied.some((d) => /PPT|Tableau|SQL|cloud/i.test(d)));

const answers = confirmedAnswers(note);
const ppt = answers.find((a) => /PPT/.test(a.requirement));
const tableau = answers.find((a) => a.requirement === "Tableau");
check("a described answer counts as full experience", ppt?.detailed === true, JSON.stringify(ppt));
check("a bare 'yes' counts as partial, not full", tableau?.detailed === false, JSON.stringify(tableau));

const trusted = noteForVerification(note) ?? "";
check("the draft checker is not given the denied lines", !/HIPAA/i.test(trusted) && !/warehousing/i.test(trusted), trusted.replace(/\n/g, " / ").slice(0, 160));
check("the draft checker still gets the confirmed lines and instructions", /PowerPoint/.test(trusted) && /Open the summary/.test(trusted));

console.log(`\n${failures === 0 ? "ALL NOTE-ANSWER TESTS PASSED" : `${failures} TEST(S) FAILED`}`);
process.exitCode = failures === 0 ? 0 : 1;
