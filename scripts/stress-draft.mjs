// Stress-tests the drafting path on several postings and asserts the things that make
// a resume actually submittable:
//   - employer names, job titles, degrees and dates are carried over EXACTLY
//   - no internal "(1.3 yrs)" bookkeeping leaks into the document
//   - no nested parentheses
//   - the verifier does not cry wolf on the cover letter naming the employer
//   node scripts/stress-draft.mjs
import fs from "fs";

const base = process.env.BASE || "http://localhost:3200";
// Every browser gets its own workspace (src/lib/workspace.ts); one fixed cookie keeps this run in one.
const WORKSPACE = `g6_workspace=${process.env.WORKSPACE ?? "e2e" + Date.now()}`;
const H = { "Content-Type": "application/json" };
const j = async (u, o) => {
  const r = await fetch(base + u, { ...o, headers: { ...(o?.headers ?? {}), cookie: WORKSPACE } });
  return { s: r.status, b: await r.json() };
};

const resume = fs.readFileSync("src/data/resume.md", "utf-8");

// Facts that must survive verbatim into any tailored resume.
const MUST_KEEP = [
  "Meridian Logistics",
  "Halden Retail Co.",
  "State University",
  "Data Analyst",
  "Business Intelligence Intern",
  "Undergraduate Research Assistant",
  "B.S. Business Analytics",
];

const POSTINGS = [
  ["J001", "src/data/jobs/J001.md"],
  ["J006", "src/data/jobs/J006.md"],
  ["J1.5", "src/data/jobs/J1.5.md"],
];

let fail = 0;
const check = (n, ok, extra = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${extra ? "  " + extra : ""}`);
};

const ids = [];
for (const [label, file] of POSTINGS) {
  const rawText = fs.readFileSync(file, "utf-8");
  const p = await j("/api/jobs", { method: "POST", headers: H, body: JSON.stringify({ title: `STRESS ${label}`, rawText }) });
  ids.push(p.b.id);
  if (p.b.evaluation.state.stage !== "awaiting_approval") {
    console.log(`(skip ${label}: ${p.b.evaluation.state.stage})`);
    continue;
  }
  const a = await j("/api/agent/approve", { method: "POST", headers: H, body: JSON.stringify({ jobId: p.b.id, decision: "approve" }) });
  const st = a.b.evaluation?.state;
  const tr = st?.tailoredResume ?? "";
  const cl = st?.coverLetter ?? "";

  console.log(`\n--- ${label}`);
  // 1. identity of the work history is preserved
  const dropped = MUST_KEEP.filter((f) => resume.includes(f) && !tr.includes(f));
  check(`${label}: employers / titles / degrees carried over verbatim`, dropped.length === 0, dropped.length ? "MISSING: " + dropped.join(" | ") : "");

  // 2. no invented job titles (a title in the draft that is not in the resume)
  // A ROLE line looks like "**Employer — Title** | dates". A SKILLS line looks like
  // "**Category:** item, item" — the colon inside the bold is the giveaway, and those
  // category names are the model's own grouping, not claims about the candidate.
  const draftRoles = [...tr.matchAll(/^\*\*(.+?)\*\*/gm)]
    .map((m) => m[1].trim())
    .filter((r) => !r.endsWith(":") && /\s[—–-]\s|\|/.test(r));
  const invented = draftRoles.filter((r) => {
    const parts = r.split(/\s+[—–-]\s+/).map((x) => x.trim());
    return parts.some((part) => part.length > 3 && !resume.includes(part));
  });
  check(`${label}: no retitled or invented roles`, invented.length === 0, invented.length ? "SUSPECT: " + invented.join(" | ") : "");

  // 3. document hygiene
  check(`${label}: no internal (N yrs) annotations leaked`, !/\(\s*~?[\d.]+\s*(yrs|years)\s*\)/i.test(tr));
  check(`${label}: no nested parentheses`, !/\([^()]*\([^()]*\)/.test(tr));
  check(`${label}: resume has name, sections, roles and bullets`, /^# /m.test(tr) && /^## /m.test(tr) && /^\*\*/m.test(tr) && /^- /m.test(tr));
  check(`${label}: cover letter is a real letter`, /dear hiring manager/i.test(cl) && cl.length > 400);

  // 4. verification is clean on honest drafts
  const dv = st?.draftVerification;
  const cv = st?.coverLetterVerification;
  check(`${label}: resume verification ran`, !!dv && dv.totals.claims > 0, `claims=${dv?.totals.claims}`);
  const flags = [...(dv?.claims ?? []), ...(cv?.claims ?? [])].filter((c) => c.verdict === "unsupported");
  check(`${label}: no false alarms on an honest draft`, flags.length === 0, flags.map((f) => `${f.unsupportedFacts.join("/")} in "${f.text.slice(0, 50)}"`).join(" | "));
}

for (const id of ids) await j("/api/jobs/" + id, { method: "DELETE" });
console.log(fail === 0 ? "\nALL DRAFT STRESS CHECKS PASSED" : `\n${fail} DRAFT STRESS CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
