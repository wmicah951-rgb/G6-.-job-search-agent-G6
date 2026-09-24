"use client";

// LIVE DEMO: show the class the agent working on a real job, in three steps.
//
//   1. Pick a candidate — the class kit's Jordan Lee, our demo Jordan Ellis, or one of the other
//      fictional candidates — and see exactly what résumé and preferences they have.
//   2. Give it a job: paste a link (LinkedIn, a company careers page, ...) or paste the text.
//   3. Run the agent and see its decision, in plain words and in the class's action names, with
//      a link to the full trace and the Approve / Edit / Reject step.
//
// Links are read only when the page is public. The class rule is "do not scrape login-protected
// job boards", and this agent never signs in anywhere; if a site asks for a sign-in, it says so
// and asks for the text instead.

import { useEffect, useState } from "react";

type Candidate = {
  key: string;
  name: string;
  field: string;
  blurb: string;
  resumeText: string;
  preferencesText: string;
};

type TraceStep = { selectedAction: string; classAction?: string; chosenBy?: string };
type State = {
  stage: string;
  fitScore: number | null;
  matchedSkills: string[];
  missingSkills: string[];
  hardConstraintViolations: string[];
  injectionDetected: boolean;
  injectionSnippets: string[];
  clarificationQuestion: string | null;
  advice?: { headline?: string; recommendation?: string } | null;
};
type Outcome = { id: string; state: State; trace: TraceStep[]; reused: boolean };

const OUTCOME: Record<string, { label: string; tone: string; meaning: string }> = {
  awaiting_approval: {
    label: "Recommended — waiting for your approval",
    tone: "bg-emerald-50 border-emerald-300 text-emerald-950",
    meaning: "The agent thinks this is worth applying to. Nothing is written until a person approves.",
  },
  rejected_low_fit: {
    label: "Down-ranked — not a strong enough fit",
    tone: "bg-amber-50 border-amber-300 text-amber-950",
    meaning: "The skills match is below this candidate's own bar. A person can still overrule it.",
  },
  rejected_hard_constraint: {
    label: "Rejected — breaks one of the candidate's hard rules",
    tone: "bg-rose-50 border-rose-300 text-rose-950",
    meaning: "A deal-breaker (years required, location, clearance, …) settles it whatever the skills look like.",
  },
  awaiting_clarification: {
    label: "The agent is asking you a question",
    tone: "bg-sky-50 border-sky-300 text-sky-950",
    meaning: "The posting is silent on something a hard rule depends on, so the agent asks instead of guessing.",
  },
};

export default function DemoPage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [key, setKey] = useState("classkit");
  const [showProfile, setShowProfile] = useState(false);
  const [mode, setMode] = useState<"link" | "text">("link");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<null | "reading" | "running">(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    fetch("/api/samples")
      .then((r) => r.json())
      .then((d) => setCandidates(d.profiles ?? []))
      .catch(() => setError("Could not load the candidates."));
  }, []);

  const candidate = candidates.find((c) => c.key === key);

  async function readLink() {
    setBusy("reading");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/jobs/scrape", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? "That link could not be read.");
        setMode("text");
        return;
      }
      setTitle(d.title ?? "");
      setText(d.text ?? "");
      setNotice("Read the posting from the link. Check the text below, then run the agent.");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function run() {
    setBusy("running");
    setError(null);
    setOutcome(null);
    try {
      // Work as the chosen candidate (in this browser's own workspace only).
      const p = await fetch("/api/samples", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "profile", key }),
      });
      if (!p.ok) throw new Error((await p.json()).error ?? "Could not switch candidate.");

      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || text.match(/^#?\s*(.+)$/m)?.[1]?.slice(0, 90) || "Pasted posting",
          rawText: text,
          sourceUrl: mode === "link" && url.trim() ? url.trim() : null,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "The agent could not run on that posting.");

      if (d.evaluation) {
        setOutcome({ id: d.id, state: d.evaluation.state, trace: d.evaluation.trace, reused: false });
      } else {
        // Already evaluated for this candidate: show the saved result rather than a second one.
        const saved = await fetch(`/api/jobs/${d.id}`).then((r) => r.json());
        setOutcome({ id: d.id, state: saved.evaluation.state, trace: saved.evaluation.trace, reused: true });
      }
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
    }
  }

  const o = outcome ? OUTCOME[outcome.state.stage] : null;

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold mb-1">Live demo</h1>
      <p className="text-sm text-neutral-600 mb-5 leading-relaxed">
        Pick a candidate, give the agent a real job — a link or the posting text — and watch what it decides. Every
        candidate here is fictional. The agent never applies, sends or contacts anyone; it stops for a person before
        anything is written.
      </p>

      {/* ---------------------------------------------------------------- 1 */}
      <section className="border border-neutral-200 bg-white rounded-2xl p-4 mb-4">
        <h2 className="font-semibold text-sm mb-2">1. Candidate</h2>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setOutcome(null);
            }}
            disabled={!!busy}
            className="border border-neutral-300 rounded-md px-2 py-1.5 text-sm bg-white text-neutral-900 min-w-0 max-w-full"
          >
            {candidates.map((c) => (
              <option key={c.key} value={c.key}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => setShowProfile(!showProfile)}
            className="text-xs border border-neutral-300 rounded-md px-2 py-1.5 bg-white hover:bg-neutral-50"
          >
            {showProfile ? "Hide résumé & preferences" : "Show résumé & preferences"}
          </button>
        </div>
        {candidate && (
          <p className="text-xs text-neutral-500 mt-1.5 break-words">
            {candidate.field} — {candidate.blurb}
          </p>
        )}
        {candidate && showProfile && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            <div className="min-w-0">
              <div className="text-xs font-medium text-neutral-500 mb-1">Résumé (the only facts the agent may use)</div>
              <pre className="text-[11px] whitespace-pre-wrap break-words bg-neutral-50 border border-neutral-200 rounded-lg p-2 max-h-72 overflow-y-auto">
                {candidate.resumeText}
              </pre>
            </div>
            <div className="min-w-0">
              <div className="text-xs font-medium text-neutral-500 mb-1">Preferences and hard rules</div>
              <pre className="text-[11px] whitespace-pre-wrap break-words bg-neutral-50 border border-neutral-200 rounded-lg p-2 max-h-72 overflow-y-auto">
                {candidate.preferencesText}
              </pre>
            </div>
          </div>
        )}
      </section>

      {/* ---------------------------------------------------------------- 2 */}
      <section className="border border-neutral-200 bg-white rounded-2xl p-4 mb-4">
        <h2 className="font-semibold text-sm mb-2">2. The job</h2>
        <div className="flex gap-2 mb-3 text-xs">
          {(["link", "text"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1.5 rounded-md border font-medium ${
                mode === m ? "bg-neutral-900 text-white border-neutral-900" : "bg-white text-neutral-700 border-neutral-300"
              }`}
            >
              {m === "link" ? "Paste a link" : "Paste the text"}
            </button>
          ))}
        </div>

        {mode === "link" && (
          <div className="mb-3">
            <div className="flex flex-wrap gap-2">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.linkedin.com/jobs/view/…  or any job posting link"
                className="flex-1 min-w-0 border border-neutral-300 rounded-md px-3 py-1.5 text-sm bg-white text-neutral-900"
              />
              <button
                onClick={readLink}
                disabled={!!busy || !/^https?:\/\//i.test(url.trim())}
                className="text-sm bg-neutral-900 text-white px-3 py-1.5 rounded-md disabled:opacity-50 whitespace-nowrap"
              >
                {busy === "reading" ? "Reading…" : "Read the posting"}
              </button>
            </div>
            <p className="text-[11px] text-neutral-500 mt-1.5 leading-relaxed">
              The page is read only if it is public. If LinkedIn (or any site) asks for a sign-in, the agent will not log
              in — that is a class rule — so open the job yourself and use &ldquo;Paste the text&rdquo;.
            </p>
          </div>
        )}

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Job title (optional)"
          className="w-full border border-neutral-300 rounded-md px-3 py-1.5 text-sm bg-white text-neutral-900 mb-2"
        />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          placeholder="The posting text — requirements, location, experience. Paste it here, or read it from a link above."
          className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm bg-white text-neutral-900"
        />
        {notice && <p className="text-xs text-emerald-800 mt-1">{notice}</p>}
      </section>

      {/* ---------------------------------------------------------------- 3 */}
      <section className="border border-neutral-200 bg-white rounded-2xl p-4 mb-4">
        <h2 className="font-semibold text-sm mb-2">3. Run the agent</h2>
        <button
          onClick={run}
          disabled={!!busy || text.trim().length < 40 || !candidate}
          className="text-sm bg-sky-700 text-white px-4 py-2 rounded-md disabled:opacity-50"
        >
          {busy === "running" ? "The agent is working… (10–20 seconds)" : `Run the agent as ${candidate?.name ?? "…"}`}
        </button>
        {error && <p className="text-sm text-red-700 mt-2 break-words">{error}</p>}

        {outcome && (
          <div className="mt-4 space-y-3">
            <div className={`border-2 rounded-xl p-3 ${o?.tone ?? "bg-neutral-50 border-neutral-300"}`}>
              <div className="font-bold text-sm">{o?.label ?? outcome.state.stage}</div>
              <div className="text-xs mt-0.5">{o?.meaning}</div>
              {outcome.reused && (
                <div className="text-xs mt-1 opacity-80">
                  This posting was already evaluated for this candidate, so the saved result is shown.
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="border border-neutral-200 rounded-lg p-2">
                <div className="text-neutral-500">Fit</div>
                <div className="font-bold text-base">
                  {outcome.state.fitScore === null ? "not scored" : `${Math.round(outcome.state.fitScore * 100)}%`}
                </div>
              </div>
              <div className="border border-neutral-200 rounded-lg p-2">
                <div className="text-neutral-500">Matched</div>
                <div className="font-bold text-base">{outcome.state.matchedSkills.length}</div>
              </div>
              <div className="border border-neutral-200 rounded-lg p-2">
                <div className="text-neutral-500">Gaps</div>
                <div className="font-bold text-base">{outcome.state.missingSkills.length}</div>
              </div>
              <div className="border border-neutral-200 rounded-lg p-2">
                <div className="text-neutral-500">Injection</div>
                <div className="font-bold text-base">{outcome.state.injectionDetected ? "caught" : "none"}</div>
              </div>
            </div>

            {outcome.state.hardConstraintViolations.length > 0 && (
              <div className="text-xs">
                <span className="font-semibold">Hard rule broken: </span>
                {outcome.state.hardConstraintViolations.join("; ")}
              </div>
            )}
            {outcome.state.injectionDetected && (
              <div className="text-xs">
                <span className="font-semibold">Instructions aimed at the AI were found and refused: </span>
                {outcome.state.injectionSnippets.slice(0, 2).join(" | ")}
              </div>
            )}
            {outcome.state.clarificationQuestion && (
              <div className="text-xs">
                <span className="font-semibold">The agent asks: </span>
                {outcome.state.clarificationQuestion}
              </div>
            )}
            {outcome.state.missingSkills.length > 0 && (
              <div className="text-xs break-words">
                <span className="font-semibold">Gaps it reported honestly: </span>
                {outcome.state.missingSkills.join("; ")}
              </div>
            )}
            {outcome.state.advice?.headline && (
              <div className="text-xs bg-indigo-50 border border-indigo-200 rounded-lg p-2">
                <span className="font-semibold">The agent&apos;s recommendation: </span>
                {outcome.state.advice.headline}
              </div>
            )}

            <div className="text-xs break-words">
              <span className="font-semibold">The path it took (class action names): </span>
              <span className="font-mono">
                {outcome.trace.map((t) => t.classAction ?? t.selectedAction).join(" → ")}
              </span>
            </div>

            <a
              href={`/jobs/${outcome.id}`}
              className="inline-block text-sm bg-neutral-900 text-white px-4 py-2 rounded-md"
            >
              Open the full trace{outcome.state.stage === "awaiting_approval" ? " and approve / edit / reject" : ""} →
            </a>
          </div>
        )}
      </section>
    </div>
  );
}
