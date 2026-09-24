// Checks the Live Demo's tested links on the DEPLOYED site, the way a presenter uses them: pick the
// candidate, "Use saved copy", run the agent — and compare with the score the sidebar promises.
//
//   node scripts/live-demo-check.mjs            (featured links for every candidate)
//   node scripts/live-demo-check.mjs classkit   (one candidate)
//
// Uses its own fresh workspace cookie, so it changes nobody else's data.

const BASE = process.env.LIVE_URL ?? "https://g6-job-search-agent-g6.vercel.app";
const PROFILES = process.argv[2]
  ? [process.argv[2]]
  : ["classkit", "demo", "nursing", "teaching", "software", "trades", "retail", "finance-entry", "marketing-ops"];
const jar = new Map();

async function call(method, path, body) {
  const headers = { "content-type": "application/json" };
  if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
  return { status: res.status, json: await res.json().catch(() => null) };
}

let same = 0;
let total = 0;
for (const profile of PROFILES) {
  const links = ((await call("GET", `/api/demo-links?profile=${profile}`)).json?.links ?? []).filter((l) => l.featured);
  await call("POST", "/api/samples", { action: "profile", key: profile });
  for (const l of links) {
    total += 1;
    const saved = (await call("GET", `/api/demo-links?url=${encodeURIComponent(l.url)}`)).json;
    const run = await call("POST", "/api/jobs", { title: saved.title, rawText: saved.text, sourceUrl: l.url });
    let state = run.json?.evaluation?.state;
    if (!state && run.json?.id) state = (await call("GET", `/api/jobs/${run.json.id}`)).json?.evaluation?.state;
    const ok = state && state.fitScore === l.score && state.stage === l.stage;
    if (ok) same += 1;
    const pct = (v) => (v === null || v === undefined ? "n/a" : `${Math.round(v * 100)}%`);
    console.log(
      `${ok ? "SAME" : "DIFF"}  ${profile.padEnd(13)} ${l.title.slice(0, 44).padEnd(44)} listed ${pct(l.score).padStart(4)} ${l.stage.padEnd(24)} live ${pct(state?.fitScore).padStart(4)} ${state?.stage ?? run.status}`
    );
  }
}
console.log(`\n${same}/${total} featured links give the listed result on the live site.`);
process.exitCode = same === total ? 0 : 1;
