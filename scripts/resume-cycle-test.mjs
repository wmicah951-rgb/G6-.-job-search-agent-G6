// THE WHOLE TAILOR -> DOWNLOAD -> RE-UPLOAD CYCLE, several times over, the way a person does it.
//
//   node scripts/resume-cycle-test.mjs                          (http://localhost:3200)
//   BASE=https://g6-job-search-agent-g6.vercel.app node scripts/resume-cycle-test.mjs
//   WORKERS=6 ROUNDS=4 node scripts/resume-cycle-test.mjs       (several people at once)
//
// Each worker is its own browser (workspace) with its own profile. Every round it:
//   1. adds the same posting        -> must be scored fresh, because the résumé changed
//   2. adds it again                -> must reopen that result, not score it twice
//   3. approves (round 1 and 2 with a note confirming one real gap, like the gap buttons do)
//   4. checks the tailored résumé   -> exists, is not the old text, keeps every employer/title/
//                                      date/degree, claims no missing skill the person did not confirm
//   5. "downloads" it and uploads it back through the résumé file reader, then saves it to the profile
// and the score may never go down from one round to the next. Finally it puts the ORIGINAL résumé
// back and adds the posting again: that must reopen the very first result, with the first score.
// Needs a model (drafting is the model's job); on a server with no model it says so and stops.

const BASE = process.env.BASE ?? "http://localhost:3200";
const WORKERS = Number(process.env.WORKERS ?? 1);
const ROUNDS = Number(process.env.ROUNDS ?? 4);
const fs = await import("node:fs");
const ORIGINAL = fs.readFileSync("src/data/resume.md", "utf-8");
const PREFS = fs.readFileSync("src/data/preferences.md", "utf-8");
const POSTING = `# Data Analyst, Growth Analytics
Remote (US). 1-3 years of experience.

Requirements:
- SQL for analysis against a cloud warehouse
- Python for data cleaning and automation
- Tableau dashboards for stakeholder reporting
- Spark for large datasets
- Excel for quick reconciliations
- statistics for experiment readouts`;
// What a person confirms through the gap buttons: real experience the résumé did not show.
const NOTES = {
  1: "- For Tableau requirement: I built Tableau dashboards for a university capstone project on retail sales",
  2: "- For Spark requirement: I processed clickstream data with Spark in a graduate data engineering course",
};
const FACTS = ["Meridian Logistics", "Halden Retail Co.", "State University Econ Dept", "Jun 2024", "May 2023 – Aug 2023", "B.S. Business Analytics", "Google Data Analytics Certificate"];
// The file reader rejoins lines a document wrapped mid-sentence; the words are what must survive.
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

let fails = 0;
const results = [];

async function worker(w) {
  const cookie = `g6_workspace=cycle${Date.now()}w${w}`;
  const log = (ok, what, detail = "") => {
    if (!ok) fails += 1;
    if (!ok || WORKERS === 1) console.log(`${ok ? "PASS" : "FAIL"}  [w${w}] ${what}${detail ? `  (${detail})` : ""}`);
  };
  const call = async (method, url, body, raw) => {
    const r = await fetch(BASE + url, {
      method,
      headers: raw ? { cookie } : { "content-type": "application/json", cookie },
      body: raw ?? (body ? JSON.stringify(body) : undefined),
    });
    const t = await r.text();
    try { return { s: r.status, j: JSON.parse(t) }; } catch { return { s: r.status, j: { raw: t.slice(0, 200) } }; }
  };
  const status = (await call("GET", "/api/system-status")).j;
  if (!status?.llm?.configured) {
    console.log("No AI model on this server: drafting (and so this cycle) needs one. Stopping.");
    process.exit(2);
  }

  const prof = await call("POST", "/api/profiles", { name: `Cycle ${w}`, resumeText: ORIGINAL, preferencesText: PREFS, setActive: true });
  log(prof.s === 200 && !!prof.j.id, "own profile created", `HTTP ${prof.s}`);
  const profileId = prof.j.id;

  let resume = ORIGINAL;
  let firstId = null, firstScore = null, lastScore = -1, lastId = null, changed = true;
  const confirmed = [];
  for (let round = 1; round <= ROUNDS; round++) {
    const add = await call("POST", "/api/jobs", { title: "Growth Analytics", rawText: POSTING });
    const id = add.j.id;
    if (!changed) {
      // The last round's draft came back word-for-word the same, so the profile holds the same
      // résumé: reopening that result is the right answer, and the cycle has nothing left to do.
      log(add.j.duplicateOf === lastId, `round ${round}: résumé unchanged since last round, so the posting reopens that result`);
      break;
    }
    const score = add.j.evaluation?.state?.fitScore;
    log(add.s === 200 && !add.j.duplicateOf && typeof score === "number", `round ${round}: posting scored fresh for the current résumé`, `score=${score} ${add.j.duplicateOf ? "REOPENED OLD RESULT" : ""}`);
    lastId = id;
    if (round === 1) { firstId = id; firstScore = score; }
    log(score >= lastScore - 1e-9, `round ${round}: score did not go down`, `${Math.round(lastScore * 100)}% -> ${Math.round(score * 100)}%`);
    lastScore = score;

    const again = await call("POST", "/api/jobs", { title: "Growth Analytics", rawText: POSTING });
    log(again.j.duplicateOf === id, `round ${round}: same résumé + same posting reopens that result`);

    // Get it to the approval gate the way a person would.
    let stage = add.j.evaluation?.state?.stage;
    if (stage === "awaiting_clarification") stage = (await call("POST", "/api/agent/clarify", { jobId: id, answer: "compatible" })).j.evaluation?.state?.stage;
    if (stage === "rejected_low_fit") stage = (await call("POST", "/api/agent/override", { jobId: id, reason: "cycle test" })).j.evaluation?.state?.stage;
    log(stage === "awaiting_approval", `round ${round}: reaches the approval gate`, `stage=${stage}`);

    const note = NOTES[round] ?? null;
    if (note) confirmed.push(note.match(/For (.+?) requirement/)[1]);
    const dec = await call("POST", "/api/agent/approve", { jobId: id, decision: note ? "edit" : "approve", editNote: note });
    const st = dec.j.evaluation?.state ?? {};
    const tailored = st.tailoredResume;
    log(dec.s === 200 && st.stage === "drafted", `round ${round}: approved and drafted`, `HTTP ${dec.s} ${dec.j.error ?? ""}`);
    log(!!tailored && norm(tailored).length > 200, `round ${round}: a tailored résumé was written`, `${norm(tailored).length} chars`);
    // The first draft must differ from what was uploaded. Later rounds may legitimately return the
    // same text once there is nothing new to add.
    if (round === 1) log(norm(tailored) !== norm(resume), `round ${round}: the tailored résumé is not the uploaded text`);
    const lost = FACTS.filter((f) => !norm(tailored).includes(f));
    log(lost.length === 0, `round ${round}: every employer, date, degree and certificate kept`, lost.join(", "));
    const invented = ["Spark", "Tableau"].filter((s) => !confirmed.includes(s) && new RegExp(`\\b${s}\\b`, "i").test(tailored) && !new RegExp(`\\b${s}\\b`, "i").test(resume));
    log(invented.length === 0, `round ${round}: claims no skill the person did not confirm`, invented.join(", "));
    const rs = st.rescore;
    log(rs && rs.after >= rs.before - 1e-9, `round ${round}: in-app re-score did not drop`, rs ? `${Math.round(rs.before * 100)}% -> ${Math.round(rs.after * 100)}%` : "no rescore");

    // Download, then upload that file back through the résumé reader, then save it to the profile.
    const form = new FormData();
    form.append("file", new Blob([tailored], { type: "text/markdown" }), `tailored-round${round}.md`);
    const up = await call("POST", "/api/resume/extract", null, form);
    log(up.s === 200 && norm(up.j.text) === norm(tailored), `round ${round}: uploaded file reads back exactly`, `HTTP ${up.s} ${up.j.error ?? ""}`);
    const save = await call("PATCH", `/api/profiles/${profileId}`, { resumeText: up.j.text });
    log(save.s === 200, `round ${round}: saved to the profile`, `HTTP ${save.s} ${save.j.error ?? ""}`);
    const check = await call("GET", `/api/profiles/${profileId}`);
    log(norm(check.j.resumeText) === norm(tailored), `round ${round}: profile now holds the tailored résumé`);
    changed = norm(up.j.text) !== norm(resume);
    resume = up.j.text;
  }

  // Put the original back: the posting must reopen the very first result, unchanged.
  await call("PATCH", `/api/profiles/${profileId}`, { resumeText: ORIGINAL });
  const back = await call("POST", "/api/jobs", { title: "Growth Analytics", rawText: POSTING });
  log(back.j.duplicateOf === firstId, "original résumé back: reopens the first result", `${back.j.duplicateOf} vs ${firstId}`);
  const firstNow = (await call("GET", `/api/jobs/${firstId}`)).j.evaluation;
  log(Math.abs((firstNow?.fitScore ?? -1) - firstScore) < 1e-9, "the first result's score is untouched", `${firstNow?.fitScore} vs ${firstScore}`);
  results.push({ w, first: firstScore, last: lastScore });
}

const t0 = Date.now();
await Promise.all(Array.from({ length: WORKERS }, (_, i) => worker(i + 1)));
for (const r of results) console.log(`w${r.w}: ${Math.round(r.first * 100)}% with the original résumé -> ${Math.round(r.last * 100)}% after ${ROUNDS} tailor/re-upload rounds`);
console.log(`\n${WORKERS} worker(s) x ${ROUNDS} round(s) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(fails ? `${fails} CHECK(S) FAILED` : "THE WHOLE TAILOR / RE-UPLOAD CYCLE WORKS");
process.exitCode = fails ? 1 : 0;
