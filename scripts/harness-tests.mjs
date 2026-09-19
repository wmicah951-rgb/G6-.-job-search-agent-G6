// Harness settings: persistence, validation, reset, and that an override actually
// reaches the agent. Needs the server running.
//   node scripts/harness-tests.mjs
const base = process.env.BASE || "http://localhost:3200";
const H = { "Content-Type": "application/json" };
const j = async (u, o) => {
  const r = await fetch(base + u, o);
  return { s: r.status, b: await r.json() };
};
let fail = 0;
const check = (n, ok, extra = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${extra ? "  " + extra : ""}`);
};

const put = (settings) => j("/api/harness", { method: "PUT", headers: H, body: JSON.stringify({ settings }) });

// start clean
await j("/api/harness", { method: "DELETE" });
const base0 = (await j("/api/harness")).b;
check("starts with no overrides (defaults are the source of truth)", base0.modified.length === 0);

// --- 1. a numeric override persists and is reported as modified ---
await put({ ...base0.effective, lowFitThresholdDefault: 0.45 });
let cur = (await j("/api/harness")).b;
check("numeric override persists", cur.effective.lowFitThresholdDefault === 0.45, String(cur.effective.lowFitThresholdDefault));
check("and is reported as modified", cur.modified.includes("lowFitThresholdDefault"));

// --- 2. out-of-range values are clamped, not accepted blindly ---
const clamped = await put({ ...base0.effective, lowFitThresholdDefault: 5 });
check("an absurd value is clamped rather than stored", clamped.b.effective.lowFitThresholdDefault === 0.9, String(clamped.b.effective.lowFitThresholdDefault));
check("and the clamp is reported back", (clamped.b.warnings ?? []).length > 0);

// --- 3. genuinely broken input is refused outright ---
const empty = await put({ ...base0.effective, prompts: { ...base0.effective.prompts, fit: "   " } });
check("an empty prompt is refused (400)", empty.s === 400, JSON.stringify(empty.b.errors ?? []));
const inverted = await put({ ...base0.effective, verifyHighThreshold: 0.4, verifyLowThreshold: 0.7 });
check("inverted verification thresholds are refused (400)", inverted.s === 400);
cur = (await j("/api/harness")).b;
check("a refused save leaves the previous settings intact", cur.effective.verifyHighThreshold === base0.effective.verifyHighThreshold);

// --- 4. a prompt override persists ---
const customFit = base0.effective.prompts.fit + "\n\nALWAYS reply in the requested structured format.";
await put({ ...base0.effective, prompts: { ...base0.effective.prompts, fit: customFit } });
cur = (await j("/api/harness")).b;
check("prompt override persists", cur.effective.prompts.fit === customFit);
check("prompt shows as modified", cur.modified.includes("prompts.fit"));

// --- 5. resetting ONE key leaves the others alone ---
await put({ ...cur.effective, lowFitThresholdDefault: 0.5 });
await j("/api/harness?key=lowFitThresholdDefault", { method: "DELETE" });
cur = (await j("/api/harness")).b;
check("resetting one key restores its default", cur.effective.lowFitThresholdDefault === 0.6, String(cur.effective.lowFitThresholdDefault));
check("and leaves other overrides in place", cur.modified.includes("prompts.fit"));

// --- 6. an override actually REACHES the agent ---
// Turning the AI reader off must make the four subtle injections undetectable, because
// only the AI can see them. This proves the setting is wired, not just stored.
await j("/api/harness", { method: "DELETE" });
const onRes = await j("/api/testlab", { method: "POST", headers: H, body: JSON.stringify({ ids: ["J011"] }) });
check("with the AI reader ON, the poem injection is caught", onRes.b.results[0]?.actual?.injectionDetected === true, JSON.stringify(onRes.b.results[0]?.actual?.injectionSources));

const fresh = (await j("/api/harness")).b;
await put({ ...fresh.effective, llmAssessmentEnabled: false });
const offRes = await j("/api/testlab", { method: "POST", headers: H, body: JSON.stringify({ ids: ["J011"] }) });
check("turning the AI reader OFF really reaches the agent", offRes.b.results[0]?.actual?.injectionDetected === false, "injection=" + offRes.b.results[0]?.actual?.injectionDetected);
check("and the keyword floor still catches the obvious one (J004)", (await j("/api/testlab", { method: "POST", headers: H, body: JSON.stringify({ ids: ["J004"] }) })).b.results[0]?.actual?.injectionDetected === true);

// leave it clean
await j("/api/harness", { method: "DELETE" });
const end = (await j("/api/harness")).b;
check("reset-all clears every override", end.modified.length === 0);

console.log(fail === 0 ? "\nALL HARNESS TESTS PASSED" : `\n${fail} HARNESS TEST(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
