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
type DemoLink = {
  url: string;
  title: string;
  company: string;
  score: number | null;
  stage: string;
  band: "high" | "mid" | "low" | "rejected" | "asks";
  afterTailoring: number | null;
  violations: string[];
  gaps: string[];
  featured: boolean;
  checkedAt: string;
};

const BAND: Record<DemoLink["band"], { label: string; cls: string }> = {
  high: { label: "strong fit", cls: "bg-emerald-100 text-emerald-900 border-emerald-300" },
  mid: { label: "partial fit", cls: "bg-amber-100 text-amber-900 border-amber-300" },
  low: { label: "weak fit", cls: "bg-orange-100 text-orange-900 border-orange-300" },
  rejected: { label: "hard rule", cls: "bg-rose-100 text-rose-900 border-rose-300" },
  asks: { label: "asks you", cls: "bg-sky-100 text-sky-900 border-sky-300" },
};

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
  const [demoLinks, setDemoLinks] = useState<DemoLink[]>([]);
  const [showAllLinks, setShowAllLinks] = useState(false);

  // The candidate's pre-tested LinkedIn postings (scripts/build-demo-links.ts).
  useEffect(() => {
    setDemoLinks([]);
    setShowAllLinks(false);
    fetch(`/api/demo-links?profile=${encodeURIComponent(key)}`)
      .then((r) => r.json())
      .then((d) => setDemoLinks(d.links ?? []))
      .catch(() => {});
  }, [key]);

  async function useSavedCopy(link: DemoLink) {
    setError(null);
    setOutcome(null);
    const d = await fetch(`/api/demo-links?url=${encodeURIComponent(link.url)}`).then((r) => r.json());
    if (d.error) {
      setError(d.error);
      return;
    }
    setMode("link");
    setUrl(link.url);
    setTitle(d.title ?? link.title);
    setText(d.text ?? "");
    setNotice(
      `Loaded the saved copy of this posting: the exact text that was scored, so the result should match the ${
        link.score === null ? "listed outcome" : `${Math.round(link.score * 100)}% shown`
      }.`
    );
  }

  async function readFromLinkedIn(link: DemoLink) {
    setMode("link");
    setUrl(link.url);
    setOutcome(null);
    await readLink(link.url);
  }

  useEffect(() => {
    fetch("/api/samples")
      .then((r) => r.json())
      .then((d) => setCandidates(d.profiles ?? []))
      .catch(() => setError("Could not load the candidates."));
  }, []);

  const candidate = candidates.find((c) => c.key === key);

  async function readLink(target?: string) {
    setBusy("reading");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/jobs/scrape", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: (target ?? url).trim() }),
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

  const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
  const shownLinks = showAllLinks ? demoLinks : demoLinks.filter((l) => l.featured);

  return (
    <div className="max-w-6xl grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_22rem] gap-5 items-start">
    <div className="min-w-0">
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
                onClick={() => readLink()}
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

    {/* ------------------------------------------------------------ sidebar: tested links */}
    <aside className="lg:sticky lg:top-4 border border-neutral-200 bg-white rounded-2xl p-4 min-w-0">
      <h2 className="font-semibold text-sm">Real LinkedIn postings to try</h2>
      <p className="text-[11px] text-neutral-500 mt-0.5 mb-3 leading-relaxed">
        Tested in advance as <strong>{candidate?.name ?? "this candidate"}</strong>: each link opened without a login
        and was run through the agent. <strong>Use saved copy</strong> loads the exact text that was scored (same
        result every time); <strong>Read from LinkedIn</strong> pulls the live page.
      </p>
      {demoLinks.length === 0 && <p className="text-xs text-neutral-500">No tested links for this candidate yet.</p>}
      <ul className="space-y-2">
        {shownLinks.map((l) => (
          <li key={l.url} className="border border-neutral-200 rounded-xl p-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <a href={l.url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-neutral-900 underline break-words">
                  {l.title}
                </a>
                {l.company && <div className="text-[11px] text-neutral-500 break-words">{l.company}</div>}
              </div>
              <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${BAND[l.band]?.cls ?? ""}`}>
                {BAND[l.band]?.label ?? l.band}
              </span>
            </div>
            <div className="text-[11px] text-neutral-700 mt-1.5">
              {l.band === "rejected" ? (
                <>
                  Expected: <strong>rejected</strong> — {l.violations[0] ?? "a hard rule"}
                </>
              ) : l.band === "asks" ? (
                <>
                  Expected: the agent <strong>asks you a question</strong>
                </>
              ) : (
                <>
                  Expected score <strong>{pct(l.score)}</strong>
                  {l.afterTailoring !== null && (
                    <>
                      {" "}→ <strong>{pct(l.afterTailoring)}</strong> after tailoring
                    </>
                  )}
                  {l.stage === "rejected_low_fit" ? " · down-ranked" : l.stage === "awaiting_approval" ? " · recommended" : ""}
                </>
              )}
            </div>
            {l.gaps.length > 0 && l.band !== "rejected" && (
              <div className="text-[10px] text-neutral-500 mt-0.5 break-words">gaps: {l.gaps.slice(0, 3).join(" · ")}</div>
            )}
            <div className="flex flex-wrap gap-1.5 mt-2">
              <button
                onClick={() => useSavedCopy(l)}
                disabled={!!busy}
                className="text-[11px] bg-neutral-900 text-white px-2 py-1 rounded-md disabled:opacity-50"
              >
                Use saved copy
              </button>
              <button
                onClick={() => readFromLinkedIn(l)}
                disabled={!!busy}
                className="text-[11px] bg-white border border-neutral-300 px-2 py-1 rounded-md disabled:opacity-50"
              >
                Read from LinkedIn
              </button>
            </div>
          </li>
        ))}
      </ul>
      {demoLinks.length > shownLinks.length || showAllLinks ? (
        <button onClick={() => setShowAllLinks(!showAllLinks)} className="text-[11px] underline text-neutral-600 mt-2">
          {showAllLinks ? "Show only the three picks" : `Show all ${demoLinks.length} tested links`}
        </button>
      ) : null}
      {demoLinks[0] && (
        <p className="text-[10px] text-neutral-400 mt-2">
          Checked {demoLinks[0].checkedAt}. Live LinkedIn postings can close at any time; the saved copy always works.
        </p>
      )}
    </aside>
    </div>
  );
}
