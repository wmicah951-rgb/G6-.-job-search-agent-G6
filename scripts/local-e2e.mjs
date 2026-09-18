// End-to-end check against a running local server (default http://localhost:3200).
import fs from "fs";
const base = process.env.BASE || "http://localhost:3200";
const dir = "src/data/jobs/";
const j = async (u, o) => {
  const r = await fetch(base + u, o);
  return { s: r.status, b: await r.json() };
};
const post = (title, rawText) =>
  j("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, rawText }) });
let fail = 0;
const check = (name, ok, extra = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} ${extra}`);
};

const t = (t) => "E2E " + t;
const ids = [];

// 1. injection gates
const j008 = await post(t("J008 hidden injection"), fs.readFileSync(dir + "J008.md", "utf-8"));
ids.push(j008.b.id);
check("J008 hidden-comment injection flagged", j008.b.evaluation.state.injectionDetected === true, "sources=" + j008.b.evaluation.state.injectionSources);
const j009 = await post(t("J009 polite injection"), fs.readFileSync(dir + "J009.md", "utf-8"));
ids.push(j009.b.id);
check("J009 polite injection flagged (AI reader)", j009.b.evaluation.state.injectionDetected === true, "sources=" + j009.b.evaluation.state.injectionSources);
check("J009 still needs a human (not obeyed)", ["awaiting_approval", "rejected_low_fit"].includes(j009.b.evaluation.state.stage), "stage=" + j009.b.evaluation.state.stage);
const det = await j("/api/jobs/" + j009.b.id);
check("job detail API exposes injection snippets", det.b.evaluation.injectionDetected && det.b.evaluation.injectionSnippets.length > 0);

// 2. work-arrangement inference (no question when it can be inferred)
const cases = [
  ["hybrid inferred from '3 days in the office'", "# Data Analyst\nWe need SQL, Python and Power BI. 1-3 years. Team works three days a week in our Denver office, two days from home.", "hybrid", "awaiting_approval"],
  ["remote inferred from 'work from anywhere'", "# Data Analyst\nSQL, Python, Power BI. 1-2 years. Work from anywhere in the US.", "remote", "awaiting_approval"],
  ["on-site inferred and rejected", "# Data Analyst\nSQL, Python, Power BI. 1-2 years. All employees report daily to our Houston headquarters.", "onsite", "rejected_hard_constraint"],
  ["silent posting asks the user", "# Data Analyst\nSQL, Python, Power BI. 1-2 years. Competitive pay.", "unknown", "awaiting_clarification"],
];
let asked;
for (const [name, text, arr, stage] of cases) {
  const r = await post(t(name), text);
  ids.push(r.b.id);
  const st = r.b.evaluation.state;
  check(name, st.workArrangement === arr && st.stage === stage, `arrangement=${st.workArrangement} stage=${st.stage}`);
  if (stage === "awaiting_clarification") asked = r.b.id;
}

// 3. ASK_USER round trip + gate guards
const bad = await j("/api/agent/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: asked, decision: "approve" }) });
check("cannot approve while the agent has a question (409)", bad.s === 409);
const cl = await j("/api/agent/clarify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: asked, answer: "compatible" }) });
check("answering resumes to approval", cl.b.evaluation.state.stage === "awaiting_approval");

// 4. approve -> LLM cover letter + tailored resume in structured markdown
const ap = await j("/api/agent/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: asked, decision: "approve" }) });
const s = ap.b.evaluation.state;
check("approve produced a cover letter", !!s.coverLetter && s.coverLetter.length > 300);
check("résumé is structured markdown (# name, ## sections, ** bold, - bullets)", /^# /m.test(s.tailoredResume) && /^## /m.test(s.tailoredResume) && /\*\*/.test(s.tailoredResume) && /^- /m.test(s.tailoredResume));
check("every missing skill has a gap note", s.missingSkills.length === 0 || s.gapNotes.length >= 1, `missing=${s.missingSkills.length} notes=${s.gapNotes.length}`);

// 4b. class-style J tests through the live API: J001-J006 sequences
const expect = [
  ["J001", "awaiting_approval"], ["J002", "rejected_low_fit"], ["J003", "rejected_hard_constraint"],
  ["J004", "awaiting_approval"], ["J005", "rejected_low_fit"], ["J006", "awaiting_approval"],
];
const made = {};
for (const [id, stage] of expect) {
  const r = await post(t(id), fs.readFileSync(dir + id + ".md", "utf-8"));
  ids.push(r.b.id);
  made[id] = r.b.id;
  check(id + " -> " + stage, r.b.evaluation.state.stage === stage, "got " + r.b.evaluation.state.stage);
}

// 4c. HITL: REJECT ends with no draft, then approving is refused (409)
const post2 = (body) => j("/api/agent/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const rej = await post2({ jobId: made.J001, decision: "reject" });
check("REJECT -> rejected_by_human and no draft", rej.b.evaluation.state.stage === "rejected_by_human" && !rej.b.evaluation.state.coverLetter && !rej.b.evaluation.state.draft);
check("approving an already-rejected job is refused (409)", (await post2({ jobId: made.J001, decision: "approve" })).s === 409);
check("approving an auto-rejected job is refused (409)", (await post2({ jobId: made.J003, decision: "approve" })).s === 409);
check("bad decision value is refused (400)", (await post2({ jobId: made.J006, decision: "maybe" })).s === 400);

// 4d. HITL: EDIT with the "add skill" bridge note (what the skill button writes)
const pre = (await j("/api/jobs/" + made.J006)).b.evaluation;
const gap = (pre.missingSkills || [])[0];
const bridge = gap ? `- For ${gap} requirement: I used it in a university class project analysing sales data` : "- Additional relevant qualification: capstone project on retail analytics";
const ed = await post2({ jobId: made.J006, decision: "edit", editNote: bridge });
const es = ed.b.evaluation.state;
check("EDIT -> drafted with cover letter + résumé", !!es.coverLetter && !!es.tailoredResume, "stage=" + es.stage);
check("edit note is recorded", (es.approvalNote || "").includes("capstone") || (es.approvalNote || "").includes("class project"));
if (gap) {
  const gn = (es.gapNotes || []).find((g) => g.skill === gap);
  check(`bridge for "${gap}" is reported (bridged_from_note)`, !!gn && gn.status === "bridged_from_note", "status=" + (gn && gn.status));
}
check("second decision on a drafted job is refused (409)", (await post2({ jobId: made.J006, decision: "approve" })).s === 409);

// 4e. skill-bridge on a posting with a REAL gap (Tableau): the button's note must be honoured
const gp = await post(t("gap posting"), `# Data Analyst
Remote. Requirements: SQL, Python (pandas), Excel, Power BI, Tableau. 1-3 years of experience.`);
ids.push(gp.b.id);
const gpMissing = gp.b.evaluation.state.missingSkills || [];
check("gap posting pauses for approval with Tableau missing", gp.b.evaluation.state.stage === "awaiting_approval" && gpMissing.some((m) => /tableau/i.test(m)), "missing=" + gpMissing.join("|"));
const tab = gpMissing.find((m) => /tableau/i.test(m));
const gd = await post2({ jobId: gp.b.id, decision: "edit", editNote: `- For ${tab} requirement: I built Tableau dashboards for a university capstone project` });
const gn = (gd.b.evaluation.state.gapNotes || []).find((g) => g.skill === tab);
check("Tableau bridge note honoured (bridged_from_note)", !!gn && gn.status === "bridged_from_note", "status=" + (gn && gn.status));
const gd2 = await post("x", `# Data Analyst
Remote. Requirements: SQL, Python (pandas), Excel, Power BI, Tableau. 1-3 years of experience.`);
ids.push(gd2.b.id);
const gd3 = await post2({ jobId: gd2.b.id, decision: "approve" });
const gn3 = (gd3.b.evaluation.state.gapNotes || []).find((g) => /tableau/i.test(g.skill));
check("with NO note, the gap is never claimed as experience (not bridged)", !!gn3 && gn3.status !== "bridged_from_note", "status=" + (gn3 && gn3.status));

// 5. delete
const before = (await j("/api/jobs")).b.jobs.length;
let deleted = 0;
for (const id of ids) {
  const d = await j("/api/jobs/" + id, { method: "DELETE" });
  if (d.s === 200) deleted++;
}
const after = (await j("/api/jobs")).b.jobs.length;
check("DELETE removed every test posting", deleted === ids.length && before - after === ids.length, `${before} -> ${after}`);
check("DELETE of a missing job is a 404", (await j("/api/jobs/nope", { method: "DELETE" })).s === 404);

console.log(fail ? `\n${fail} FAILED` : "\nALL LOCAL E2E CHECKS PASSED");
process.exit(fail ? 1 : 0);
