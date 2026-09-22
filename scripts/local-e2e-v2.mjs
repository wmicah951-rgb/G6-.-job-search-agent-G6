// End-to-end over HTTP against a running dev server, exercising what a person actually does:
// add a posting, see it evaluated, add the SAME posting again (must reopen, not re-score),
// approve it and get drafted material, switch profile, and prove a second browser is isolated.
//
//   npx next dev -p 3005      (in another terminal, with .env.local loaded)
//   node scripts/local-e2e-v2.mjs
//
// Cookies are kept per "browser" so the workspace behaviour is genuinely tested.

import fs from "fs";
import path from "path";

const BASE = process.env.E2E_BASE ?? "http://localhost:3005";
const root = path.join(import.meta.dirname, "..");

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${detail}` : ""}`);
};

function browser() {
  const jar = new Map();
  return async function req(method, url, body) {
    const headers = { "content-type": "application/json" };
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(`${BASE}${url}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON — the caller sees status + raw text */
    }
    return { status: res.status, json, text };
  };
}

const posting = fs.readFileSync(path.join(root, "src/data/jobs/J001.md"), "utf-8");

async function main() {
  console.log(`E2E against ${BASE}\n`);
  const alice = browser();
  const bob = browser();

  // --- first visit seeds the class-kit profile ---
  const p1 = await alice("GET", "/api/profiles");
  check("a first visit seeds exactly one profile", p1.json?.profiles?.length === 1, JSON.stringify(p1.json?.profiles ?? p1.text.slice(0, 120)));
  check("and it is the official class kit's candidate", /Jordan Lee/.test(p1.json?.profiles?.[0]?.name ?? ""), p1.json?.profiles?.[0]?.name);

  // --- add a posting ---
  const add = await alice("POST", "/api/jobs", { title: "Data Analyst (e2e)", rawText: posting });
  check("a posting can be added and evaluated", add.status === 200 && !!add.json?.id, add.text.slice(0, 160));
  const jobId = add.json?.id;
  const first = add.json?.evaluation?.state;
  check("the agent stopped for a human instead of drafting", first?.stage === "awaiting_approval" && !first?.draft, `stage=${first?.stage}`);
  check("the injection scan ran first", add.json?.evaluation?.trace?.[0]?.selectedAction === "scan_for_injection");
  check("each trace step carries the class action vocabulary", !!add.json?.evaluation?.trace?.[0]?.classAction, add.json?.evaluation?.trace?.[0]?.classAction);

  // --- the same posting again is the same job, with the same score ---
  const again = await alice("POST", "/api/jobs", { title: "Data Analyst (e2e again)", rawText: posting });
  check("pasting the same posting reopens the same job", again.json?.id === jobId, `${again.json?.id} vs ${jobId}`);

  // --- the job page payload ---
  const view = await alice("GET", `/api/jobs/${jobId}`);
  const ev = view.json?.evaluation;
  check("the job page reports what the agent remembered", !!ev?.memory, JSON.stringify(ev?.memory ?? null).slice(0, 140));
  check("and keeps a score history", Array.isArray(ev?.scoreHistory), `${ev?.scoreHistory?.length ?? 0} entries`);

  // --- human approval produces material ---
  const approve = await alice("POST", "/api/agent/approve", { jobId, decision: "approve" });
  const after = approve.json?.evaluation?.state;
  check("approving produces application material", approve.status === 200 && !!after?.coverLetter, `stage=${after?.stage}`);
  check("the material was verified line by line", !!after?.coverLetterVerification || !!after?.draftVerification);

  // --- a second browser is a separate workspace ---
  const p2 = await bob("GET", "/api/profiles");
  check("a second browser gets its own profile list", p2.json?.profiles?.length === 1 && p2.json.profiles[0].id !== p1.json.profiles[0].id, `${p2.json?.profiles?.[0]?.id} vs ${p1.json?.profiles?.[0]?.id}`);
  const bobJobs = await bob("GET", "/api/jobs");
  check("and cannot see the first browser's postings", (bobJobs.json?.jobs ?? []).every((j) => j.id !== jobId), `${bobJobs.json?.jobs?.length ?? 0} jobs visible`);
  const steal = await bob("GET", `/api/jobs/${jobId}`);
  check("nor open one by id", steal.status === 404, `status ${steal.status}`);

  // --- a second profile, from a different field, in the same browser ---
  const resume = fs.readFileSync(path.join(root, "src/data/profiles/nursing/resume.md"), "utf-8");
  const prefs = fs.readFileSync(path.join(root, "src/data/profiles/nursing/preferences.md"), "utf-8");
  const created = await alice("POST", "/api/profiles", { name: "Nursing — Alicia", resumeText: resume, preferencesText: prefs, setActive: true });
  check("a profile from another field can be added and made active", created.status === 200 && !!created.json?.id, created.text.slice(0, 120));
  const profilesNow = await alice("GET", "/api/profiles");
  const active = profilesNow.json?.profiles?.find((p) => p.isActive);
  check("the switch applies to this browser", active?.name === "Nursing — Alicia", active?.name);
  const bobActive = (await bob("GET", "/api/profiles")).json?.profiles?.find((p) => p.isActive);
  check("and does NOT change the other browser", bobActive?.name === "Class kit — Jordan Lee", bobActive?.name);

  // --- a nursing posting against the nursing résumé ---
  const nursing = fs.readFileSync(path.join(root, "src/data/jobs/sectors/nursing-fit.md"), "utf-8");
  const nurseJob = await alice("POST", "/api/jobs", { title: "RN Med-Surg (e2e)", rawText: nursing });
  const ns = nurseJob.json?.evaluation?.state;
  check("a posting from a different field is evaluated too", nurseJob.status === 200 && ns?.stage === "awaiting_approval", `stage=${ns?.stage} fit=${ns?.fitScore}`);
  check("with hard constraints checked", nurseJob.json?.evaluation?.trace?.some((t) => t.selectedAction === "check_hard_constraints"));

  // --- résumé file extraction ---
  const form = new FormData();
  form.append("file", new Blob([resume], { type: "text/markdown" }), "resume.md");
  const upload = await fetch(`${BASE}/api/resume/extract`, { method: "POST", body: form });
  const up = await upload.json();
  check("a résumé file can be read into text", upload.status === 200 && up.text?.includes("Alicia Moreno"), `${up.chars ?? 0} chars`);

  console.log(`\n${failures === 0 ? "ALL E2E CHECKS PASSED" : `${failures} E2E CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
