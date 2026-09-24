// REAL POSTINGS, REAL GAPS, NOTHING SCRIPTED IN ADVANCE.
//
//   node scripts/real-cycle-audit.mjs                                   (live site)
//   BASE=http://localhost:3200 node scripts/real-cycle-audit.mjs
//   PROFILES=nursing,software TARGETS=1 CROSS=2 ROUNDS=3 WORKERS=3 node scripts/real-cycle-audit.mjs
//   RESUME_FILE=my-resume.md PREFS_FILE=my-prefs.md PROFILES=classkit node scripts/real-cycle-audit.mjs
//
// resume-cycle-test.mjs proves the plumbing with one made-up posting and gap answers written in
// advance. This one asks the question a person actually has: "if I take the résumé the agent wrote
// for me and use it for real, does it score the way it should?"
//
// For every sample candidate it takes the REAL scraped postings in src/data/demo-links.json and:
//   1. scores each one with the original résumé (the baseline);
//   2. picks target postings and READS the gaps the agent reports; nothing is hard-coded. Like a
//      person at the gap buttons, it answers YES (with detail) to some and NO to the rest;
//   3. approves with those answers, gets the tailored résumé, downloads it, re-uploads it through
//      the file reader and saves it as the profile's résumé;
//   4. scores the SAME posting again from that résumé alone (the note is gone now). Every YES gap
//      must now be matched, every NO gap must still be missing (an honest, expected gap), nothing
//      the original proved may be lost, and the in-app re-score must predict this real score.
//      If a YES gap is still open it LOOPS: answers again, re-tailors, re-uploads, up to ROUNDS;
//   5. scores OTHER postings (same field, plus one from another field as a control) with the
//      tailored résumé and compares them with the baseline: no requirement the original matched may
//      be lost, and the unrelated posting must not jump.
// Writes a readable report to stdout and the full detail to results/real-cycle-audit.json.

const BASE = process.env.BASE ?? "https://g6-job-search-agent-g6.vercel.app";
const TARGETS = Number(process.env.TARGETS ?? 2);
const CROSS = Number(process.env.CROSS ?? 2);
const ROUNDS = Number(process.env.ROUNDS ?? 3);
const WORKERS = Number(process.env.WORKERS ?? 3);
const TOL = Number(process.env.TOL ?? 0.1); // allowed gap between the in-app re-score and the real one
const fs = await import("node:fs");

const LINKS = JSON.parse(fs.readFileSync("src/data/demo-links.json", "utf-8"));
const FILES = {
  classkit: ["src/data/classkit/resume.md", "src/data/classkit/preferences.md"],
  demo: ["src/data/resume.md", "src/data/preferences.md"],
};
const filesFor = (p) => FILES[p] ?? [`src/data/profiles/${p}/resume.md`, `src/data/profiles/${p}/preferences.md`];
const ALL = [...new Set(LINKS.map((l) => l.profile))];
const PROFILES = process.env.PROFILES ? process.env.PROFILES.split(",").map((s) => s.trim()) : ALL;

const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const pct = (x) => (typeof x === "number" ? `${Math.round(x * 100)}%` : "n/a");
const lc = (s) => norm(s).toLowerCase();
const has = (list, req) => (list ?? []).some((x) => lc(x) === lc(req));

let fails = 0;
let warns = 0;
// The words of a requirement that name the skill itself (not "experience", "ability", ...), cut to a
// stem so "statistics" and "statistical" are the same claim.
const GENERIC = new Set(["experience", "analysis", "knowledge", "ability", "skills", "working", "years", "strong", "understanding", "business", "large", "scale", "using", "with", "work", "data", "degree", "related", "field", "including"]);
const stems = (req) => lc(req).split(/[^a-z0-9+#]+/).filter((w) => w.length >= 3 && !GENERIC.has(w)).map((w) => w.slice(0, 6));
const names = (text, req) => stems(req).some((st) => lc(text).includes(st));
const report = [];
const OUT = process.env.OUT ?? "results/real-cycle-audit.json";

async function runProfile(profile) {
  const out = { profile, targets: [], checks: [] };
  const say = (line) => console.log(`[${profile}] ${line}`);
  const warn = (what, detail = "") => {
    out.checks.push({ ok: true, warn: true, what, detail });
    warns += 1;
    say(`WARN  ${what}${detail ? `  (${detail})` : ""}`);
  };
  const check = (ok, what, detail = "") => {
    out.checks.push({ ok, what, detail });
    if (!ok) fails += 1;
    say(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
    return ok;
  };
  const [resumeFile, prefsFile] = filesFor(profile);
  const ORIGINAL = fs.readFileSync(process.env.RESUME_FILE ?? resumeFile, "utf-8");
  const PREFS = fs.readFileSync(process.env.PREFS_FILE ?? prefsFile, "utf-8");
  const cookie = `g6_workspace=audit${Date.now()}${profile.replace(/\W/g, "")}`;
  const call = async (method, url, body, raw) => {
    for (let attempt = 1; ; attempt++) {
      try {
        const r = await fetch(BASE + url, {
          method,
          headers: raw ? { cookie } : { "content-type": "application/json", cookie },
          body: raw ?? (body ? JSON.stringify(body) : undefined),
        });
        const t = await r.text();
        if (r.status >= 502 && attempt < 3) continue; // platform hiccup, not an app answer
        try { return { s: r.status, j: JSON.parse(t) }; } catch { return { s: r.status, j: { raw: t.slice(0, 200) } }; }
      } catch (e) {
        if (attempt >= 3) return { s: 0, j: { error: String(e) } };
      }
    }
  };
  // One shape for a scored posting, whether it was scored now or reopened.
  const score = async (link) => {
    const add = await call("POST", "/api/jobs", { title: link.title, rawText: link.postingText, sourceUrl: link.url });
    const id = add.j.id;
    let st = add.j.evaluation?.state;
    if (!st && id) {
      const got = (await call("GET", `/api/jobs/${id}`)).j.evaluation ?? {};
      st = { ...got, stage: got.stage };
    }
    return {
      id, reopened: !!add.j.duplicateOf, http: add.s, stage: st?.stage, fitScore: st?.fitScore ?? null,
      matched: st?.matchedSkills ?? [], missing: st?.missingSkills ?? [], preferred: st?.missingPreferredSkills ?? [],
      violations: st?.hardConstraintViolations ?? [],
      evidence: st?.matchedEvidence ?? null,
    };
  };

  const prof = await call("POST", "/api/profiles", { name: `Audit ${profile}`, resumeText: ORIGINAL, preferencesText: PREFS, setActive: true });
  if (!check(prof.s === 200 && !!prof.j.id, "profile created from the real résumé", `HTTP ${prof.s}`)) return out;
  const profileId = prof.j.id;
  const setResume = async (text) => (await call("PATCH", `/api/profiles/${profileId}`, { resumeText: text })).s === 200;

  // Postings: this candidate's own (the ones the agent can tailor for), plus one from another field.
  const own = LINKS.filter((l) => l.profile === profile && l.postingText);
  const tailorable = own.filter((l) => l.stage !== "rejected_hard_constraint");
  // Postings with real gaps first: those are the ones that test whether a gap gets closed.
  tailorable.sort((a, b) => (b.gaps?.length ?? 0) - (a.gaps?.length ?? 0));
  const targets = tailorable.slice(0, TARGETS);
  const others = own.filter((l) => !targets.includes(l)).slice(0, CROSS);
  // The control comes from a clearly different field, so a jump there would mean inflation.
  const FAR = { classkit: "nursing", demo: "trades", "finance-entry": "teaching", "marketing-ops": "trades", nursing: "software", teaching: "software", software: "retail", trades: "finance-entry", retail: "nursing" };
  const controls = LINKS.filter((l) => l.profile === (FAR[profile] ?? "nursing") && l.stage !== "rejected_hard_constraint" && l.postingText);
  const crossSet = [...others];

  // 1. Baseline with the original résumé.
  const baseline = new Map();
  for (const l of [...targets, ...crossSet]) {
    const b = await score(l);
    baseline.set(l.url, b);
    say(`baseline  ${pct(b.fitScore).padStart(4)} ${String(b.stage).padEnd(26)} ${l.title.slice(0, 60)}`);
  }
  // A control this candidate's hard rules reject has no score to compare, so try the next one.
  for (const c of controls) {
    const b = await score(c);
    say(`baseline  ${pct(b.fitScore).padStart(4)} ${String(b.stage).padEnd(26)} ${c.title.slice(0, 60)}  [other field]`);
    if (typeof b.fitScore === "number") {
      baseline.set(c.url, b);
      crossSet.push({ ...c, control: true });
      break;
    }
  }

  for (const target of targets) {
    await setResume(ORIGINAL);
    const base = baseline.get(target.url);
    const t = { title: target.title, url: target.url, baseline: base.fitScore, rounds: [], yes: [], no: [] };
    out.targets.push(t);
    say(`--- target: ${target.title}  (baseline ${pct(base.fitScore)}, ${base.missing.length} gap(s): ${base.missing.join(" | ") || "none"})`);

    // The person's truth, decided once from the gaps the agent reported: every other gap is a YES.
    // A posting with a single gap gets a YES, so something is always there to close.
    base.missing.forEach((g, i) => (i % 2 === 0 ? t.yes : t.no).push(g));
    // A credential is held, not "applied": answer the way a person holding it would.
    const CREDENTIAL = /(degree|master'?s|bachelor'?s|ph.?d|doctorate|certifw*|licen[cs]w*|cpa|cma|cfa|credential|diploma|registered|praxis)/i;
    const answer = (g) =>
      CREDENTIAL.test(g)
        ? `- ${g}: YES — I hold this; I completed it in 2021 and can show the certificate or transcript`
        : `- ${g}: YES — I did this hands-on in my most recent role, applying ${g.replace(/[.:]+$/, "")} on real work every week for over a year`;
    const deny = (g) => `- ${g}: NO — not yet, willing to learn`;

    let current = base;
    let resume = ORIGINAL;
    for (let round = 1; round <= ROUNDS; round++) {
      const r = { round };
      t.rounds.push(r);
      // Get the posting to the approval gate the way a person would.
      let stage = current.stage;
      if (stage === "awaiting_clarification") stage = (await call("POST", "/api/agent/clarify", { jobId: current.id, answer: "compatible" })).j.evaluation?.state?.stage;
      if (stage === "rejected_low_fit") stage = (await call("POST", "/api/agent/override", { jobId: current.id, reason: "audit: tailor anyway" })).j.evaluation?.state?.stage;
      if (!check(stage === "awaiting_approval", `round ${round}: reaches the approval gate`, `stage=${stage}`)) break;

      const openYes = t.yes.filter((g) => !has(current.matched, g));
      const note = [...openYes.map(answer), ...t.no.map(deny)].join("\n") || null;
      const dec = await call("POST", "/api/agent/approve", { jobId: current.id, decision: note ? "edit" : "approve", editNote: note });
      const st = dec.j.evaluation?.state ?? {};
      const tailored = st.tailoredResume;
      if (!check(dec.s === 200 && st.stage === "drafted" && norm(tailored).length > 200, `round ${round}: tailored résumé drafted`, `HTTP ${dec.s} ${dec.j.error ?? ""}`)) break;

      // What the app itself says it achieved.
      const rs = st.rescore ?? {};
      r.predicted = rs.after;
      r.tailored = tailored;
      r.note = note;
      r.rescore = rs;
      check(rs.comparable !== false, `round ${round}: in-app re-score used the same requirement list`);
      const notClosedInApp = openYes.filter((g) => !has(rs.newlyMatched, g) && has(rs.stillMissing, g));
      check(notClosedInApp.length === 0, `round ${round}: in-app re-score counts every YES gap as closed`, notClosedInApp.join(" | "));
      const noCredited = t.no.filter((g) => has(rs.newlyMatched, g));
      const noClaimed = noCredited.filter((g) => names(tailored, g) && !names(ORIGINAL, g));
      check(noClaimed.length === 0, `round ${round}: in-app re-score never credits a NO gap the draft claimed`, noClaimed.join(" | "));
      for (const g of noCredited.filter((x) => !noClaimed.includes(x))) warn(`round ${round}: in-app re-score inferred the NO gap "${g}" from another line`);
      if (rs.restoredLines?.length || rs.addedFromNote?.length)
        say(`round ${round}: agent repaired its draft: ${rs.restoredLines?.length ?? 0} original line(s) put back, ${rs.addedFromNote?.length ?? 0} confirmed answer(s) added`);
      check((rs.droppedFromDraft ?? []).length === 0, `round ${round}: draft keeps everything the original proved`, (rs.droppedFromDraft ?? []).join(" | "));
      check((rs.unearned ?? []).length === 0, `round ${round}: no score gain rests on an untraceable sentence`, (rs.unearned ?? []).join(" | "));

      // Download -> upload through the file reader -> save as the profile's résumé.
      const form = new FormData();
      form.append("file", new Blob([tailored], { type: "text/markdown" }), `tailored-${profile}-r${round}.md`);
      const up = await call("POST", "/api/resume/extract", null, form);
      check(up.s === 200 && norm(up.j.text) === norm(tailored), `round ${round}: downloaded file reads back exactly`, `HTTP ${up.s}`);
      const uploaded = up.j.text ?? tailored;
      await setResume(uploaded);
      const changed = norm(uploaded) !== norm(resume);
      resume = uploaded;

      // The real test: the same posting, scored from the tailored résumé alone.
      const real = await score(target);
      r.real = real.fitScore;
      r.matched = real.matched;
      r.missing = real.missing;
      r.evidence = real.evidence;
      if (!changed) {
        check(real.reopened, `round ${round}: résumé unchanged, so the posting reopens the last result`);
      } else {
        check(!real.reopened && typeof real.fitScore === "number", `round ${round}: scored fresh from the tailored résumé`, `score=${pct(real.fitScore)}`);
      }
      check((real.fitScore ?? 0) >= (base.fitScore ?? 0) - 1e-9, `round ${round}: real score not below the original`, `${pct(base.fitScore)} -> ${pct(real.fitScore)}`);
      if (typeof rs.after === "number" && typeof real.fitScore === "number") {
        check(Math.abs(rs.after - real.fitScore) <= TOL + 1e-9, `round ${round}: the in-app re-score predicted the real score`, `predicted ${pct(rs.after)}, real ${pct(real.fitScore)}`);
      }
      const lost = base.matched.filter((m) => !has(real.matched, m));
      check(lost.length === 0, `round ${round}: nothing the original matched is now missing`, lost.join(" | "));
      const leaked = t.no.filter((g) => has(real.matched, g));
      // A NO gap now counted as matched is a FAIL when the tailored résumé actually names that skill
      // (it claimed what the person denied), and a WARN when the scorer only inferred it from a line
      // the person DID confirm (e.g. "sampling techniques" read as statistics).
      const claimed = leaked.filter((g) => names(tailored, g) && !names(ORIGINAL, g));
      check(claimed.length === 0, `round ${round}: the tailored résumé never claims a skill the person said NO to`, claimed.join(" | "));
      for (const g of leaked.filter((x) => !claimed.includes(x))) {
        const q = Object.entries(real.evidence ?? {}).find(([k]) => lc(k) === lc(g))?.[1];
        warn(`round ${round}: scorer inferred the NO gap "${g}" from another line`, q ? `"${q.slice(0, 120)}"` : "");
      }
      const stillOpen = t.yes.filter((g) => !has(real.matched, g));
      say(`round ${round}: real ${pct(real.fitScore)} | YES closed ${t.yes.length - stillOpen.length}/${t.yes.length} | NO still missing ${t.no.length - leaked.length}/${t.no.length}${stillOpen.length ? ` | open: ${stillOpen.join(" | ")}` : ""}`);
      current = real;
      if (stillOpen.length === 0 || !changed) break;
    }
    const last = t.rounds[t.rounds.length - 1] ?? {};
    const openAtEnd = t.yes.filter((g) => !has(last.matched, g));
    t.final = last.real ?? null;
    t.openYesAtEnd = openAtEnd;
    check(openAtEnd.length === 0, `every YES gap closed within ${ROUNDS} round(s)`, openAtEnd.join(" | "));

    // Other postings with the tailored résumé.
    for (const l of crossSet) {
      const b = baseline.get(l.url);
      const c = await score(l);
      const lostX = b.matched.filter((m) => !has(c.matched, m));
      const tag = l.control ? "other-field control" : "same field";
      say(`cross (${tag}) ${pct(b.fitScore)} -> ${pct(c.fitScore)}  ${l.title.slice(0, 60)}`);
      (t.cross ??= []).push({ title: l.title, control: !!l.control, before: b.fitScore, after: c.fitScore, lost: lostX, evidenceBefore: b.evidence, evidenceAfter: c.evidence, gained: c.matched.filter((m) => !has(b.matched, m)) });
      check(lostX.length === 0, `cross ${tag}: tailored résumé keeps every requirement the original matched`, `${l.title.slice(0, 40)}: ${lostX.join(" | ")}`);
      if (typeof b.fitScore === "number" && typeof c.fitScore === "number") {
        if (l.control) check(c.fitScore - b.fitScore <= 0.25, `cross ${tag}: an unrelated posting is not inflated`, `${pct(b.fitScore)} -> ${pct(c.fitScore)}`);
        else check(c.fitScore >= b.fitScore - 0.05, `cross ${tag}: score not lower than with the original`, `${pct(b.fitScore)} -> ${pct(c.fitScore)}`);
      }
    }
  }
  await setResume(ORIGINAL);
  return out;
}

const t0 = Date.now();
const status = (await (await fetch(`${BASE}/api/system-status`)).json().catch(() => ({})));
if (!status?.llm?.configured) {
  console.log("No AI model on this server: drafting needs one. Stopping.");
  process.exit(2);
}
console.log(`Real-posting audit against ${BASE}: ${PROFILES.length} candidate(s), ${TARGETS} target(s) each, ${CROSS}+1 cross posting(s), up to ${ROUNDS} round(s)\n`);
const queue = [...PROFILES];
await Promise.all(
  Array.from({ length: Math.min(WORKERS, queue.length) }, async () => {
    while (queue.length) {
      const p = queue.shift();
      try {
        report.push(await runProfile(p));
      } catch (e) {
        fails += 1;
        console.log(`[${p}] FAIL  crashed: ${e?.stack ?? e}`);
      }
    }
  })
);

console.log("\n==================== SUMMARY ====================");
for (const p of report) {
  for (const t of p.targets) {
    const closed = t.yes.length - (t.openYesAtEnd?.length ?? t.yes.length);
    console.log(
      `${p.profile.padEnd(13)} ${t.title.slice(0, 44).padEnd(44)} ${pct(t.baseline).padStart(4)} -> ${pct(t.final).padStart(4)} ` +
        `in ${t.rounds.length} round(s) | YES closed ${closed}/${t.yes.length} | expected gaps kept ${t.no.length}` +
        (t.cross?.length ? ` | cross: ${t.cross.map((c) => `${pct(c.before)}->${pct(c.after)}${c.control ? "*" : ""}`).join(" ")}` : "")
    );
  }
}
const total = report.reduce((n, p) => n + p.checks.length, 0);
console.log(`\n(* = posting from another field, a control)\n${total - fails}/${total} checks passed in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
if (warns) console.log(`${warns} warning(s): the scorer inferred a skill the person denied from a line they confirmed`);
console.log(fails ? `${fails} CHECK(S) FAILED` : "TAILORED RÉSUMÉS SCORE THE WAY THEY SHOULD ON REAL POSTINGS");
fs.mkdirSync("results", { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ base: BASE, at: new Date().toISOString(), report }, null, 2));
process.exitCode = fails ? 1 : 0;
