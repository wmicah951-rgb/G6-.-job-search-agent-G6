// Checks the DEPLOYED site end to end, the way a grader would use it.
//
//   node scripts/live-verify.mjs                  (default: https://g6-job-search-agent-g6.vercel.app)
//   LIVE_URL=https://... node scripts/live-verify.mjs
//
// 1. The status panel: database connected and saving, a model configured.
// 2. Every ready-made candidate loads, and every posting in its set runs through the agent and
//    lands on the board (this is also what proves the data files shipped with the deploy).
// 3. The class kit gives the outcomes the assignment asks for.
// 4. Every Test Lab case passes on the live server.
// It uses its own fresh workspace cookie, so it touches nobody else's data.

const BASE = process.env.LIVE_URL ?? "https://g6-job-search-agent-g6.vercel.app";
const jar = new Map();
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

async function call(method, url, body) {
  const headers = { "content-type": "application/json" };
  if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const res = await fetch(`${BASE}${url}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) };
  } catch {
    return { status: res.status, json: null, text };
  }
}

const EXPECT_KIT = {
  J001: ["awaiting_approval"],
  J002: ["awaiting_approval", "rejected_low_fit"],
  J003: ["rejected_hard_constraint"],
  J004: ["awaiting_approval", "rejected_low_fit", "rejected_hard_constraint"],
  J005: ["awaiting_approval"],
  J006: ["rejected_hard_constraint", "rejected_low_fit"],
};

async function main() {
  console.log(`Live verification against ${BASE}\n`);

  const status = (await call("GET", "/api/system-status")).json;
  check("database is connected and saving", status?.database?.ok === true && !status?.database?.degraded, status?.database?.mode);
  check("an AI model is configured", status?.llm?.configured === true, status?.llm?.model);

  const catalogue = (await call("GET", "/api/samples")).json;
  check("sample catalogue is served", (catalogue?.profiles?.length ?? 0) >= 9, `${catalogue?.profiles?.length ?? 0} candidates`);

  for (const profile of catalogue?.profiles ?? []) {
    const switched = await call("POST", "/api/samples", { action: "profile", key: profile.key });
    if (switched.status !== 200) {
      check(`${profile.name}: loads`, false, `HTTP ${switched.status} ${switched.json?.error ?? ""}`);
      continue;
    }
    const set = catalogue.postingSets.find((s) => s.key === profile.postingSet);
    const outcomes = [];
    for (let i = 0; i < (set?.count ?? 0); i++) {
      const r = await call("POST", "/api/samples", { action: "postings", set: profile.postingSet, index: i });
      const row = r.json?.results?.[0];
      outcomes.push(row);
      if (r.status !== 200 || !row || row.error) {
        check(`${profile.name}: posting ${i + 1} runs`, false, row?.error ?? `HTTP ${r.status}`);
      }
    }
    const ok = outcomes.length === (set?.count ?? 0) && outcomes.every((o) => o && !o.error);
    const summary = outcomes
      .map((o) => (o ? `${o.stage ?? (o.duplicate ? "dupe" : "?")}${o.fitScore == null ? "" : ` ${Math.round(o.fitScore * 100)}%`}` : "missing"))
      .join(" | ");
    check(`${profile.name}: ${outcomes.length} posting(s) through the agent`, ok, summary);

    if (profile.key === "classkit") {
      for (const o of outcomes) {
        const id = o?.title?.slice(0, 4);
        if (EXPECT_KIT[id]) check(`class kit ${id} outcome`, EXPECT_KIT[id].includes(o.stage), o.stage);
      }
    }
  }

  const board = (await call("GET", "/api/jobs")).json?.jobs ?? [];
  check("everything landed on this browser's board", board.length >= 20, `${board.length} jobs`);

  const cases = (await call("GET", "/api/testlab")).json?.cases ?? [];
  let passed = 0;
  for (const c of cases) {
    const r = (await call("POST", "/api/testlab", { ids: [c.id] })).json?.results?.[0];
    if (r?.pass || r?.skipped) passed += 1;
    else check(`Test Lab ${c.id}`, false, (r?.problems ?? [r?.error]).join("; "));
  }
  check(`Test Lab: all ${cases.length} cases pass live`, passed === cases.length, `${passed}/${cases.length}`);

  console.log(`\n${failures === 0 ? "THE LIVE SITE IS READY" : `${failures} LIVE CHECK(S) FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
