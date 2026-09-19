"use client";

import { useEffect, useState } from "react";

type TestCase = {
  id: string;
  title: string;
  why: string;
  sequence: string;
  expectedStage: string;
  injection: boolean;
  arrangement?: string;
  requires: "any" | "llm";
  group: "required" | "branching" | "injection" | "control";
};

type Result = {
  id: string;
  pass?: boolean;
  skipped?: boolean;
  note?: string;
  error?: string;
  problems?: string[];
  ms?: number;
  actual?: {
    stage: string;
    sequence: string;
    fitScore: number | null;
    injectionDetected: boolean;
    injectionSources: string[];
    injectionSnippets: string[];
    workArrangement: string;
    matchedSkills: string[];
    missingSkills: string[];
    matchStrength: Record<string, string>;
    fitReasoning: string | null;
  };
};

const GROUP_LABEL: Record<string, string> = {
  required: "The four the assignment requires",
  branching: "Other branches the agent can take",
  injection: "Prompt injection, escalating in subtlety",
  control: "False-positive control",
};

export default function TestLabPage() {
  const [cases, setCases] = useState<TestCase[]>([]);
  const [model, setModel] = useState("");
  const [llmOn, setLlmOn] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [results, setResults] = useState<Record<string, Result>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch("/api/testlab")
      .then((r) => r.json())
      .then((d) => {
        setCases(d.cases ?? []);
        setModel(d.model ?? "");
        setLlmOn(!!d.llmConfigured);
      });
  }, []);

  async function run(ids: string[]) {
    const res = await fetch("/api/testlab", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    const d = await res.json();
    setProfileName(d.profileName ?? "");
    setModel(d.model ?? model);
    setResults((prev) => {
      const next = { ...prev };
      for (const r of d.results ?? []) next[r.id] = r;
      return next;
    });
  }

  async function runOne(id: string) {
    setRunning(id);
    try {
      await run([id]);
    } finally {
      setRunning(null);
    }
  }

  async function runAll() {
    setRunningAll(true);
    setResults({});
    try {
      // Sequentially, so the live tally is meaningful and we never fire a dozen
      // model calls at once.
      for (const c of cases) await run([c.id]);
    } finally {
      setRunningAll(false);
    }
  }

  const done = Object.values(results).filter((r) => !r.skipped && !r.error);
  const passed = done.filter((r) => r.pass).length;
  const failed = done.filter((r) => !r.pass).length;
  const skipped = Object.values(results).filter((r) => r.skipped).length;

  const groups = ["required", "branching", "injection", "control"] as const;

  return (
    <div className="w-full max-w-5xl mx-auto pb-24">
      <h1 className="text-2xl font-bold tracking-tight mb-1">Test Lab</h1>
      <p className="text-sm text-neutral-600 mb-4 leading-relaxed">
        Every built-in test posting, what it is supposed to prove, and a button to run it
        through the <strong>real agent</strong> right now. Nothing here is saved to your
        job board — this is for checking behaviour and for demoing in class.
      </p>

      <div className="border border-neutral-200 bg-white rounded-2xl p-4 mb-5 shadow-xs">
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={runAll}
            disabled={runningAll || cases.length === 0}
            className="text-sm bg-neutral-900 hover:bg-neutral-800 text-white font-semibold px-4 py-2 rounded-xl disabled:opacity-50 transition-colors cursor-pointer shadow-xs"
          >
            {runningAll ? "Running all…" : `Run all ${cases.length} tests`}
          </button>
          <span className="text-xs text-neutral-600">
            Brain: <strong>{model || "…"}</strong>{" "}
            {llmOn ? (
              <span className="text-green-700">(AI on)</span>
            ) : (
              <span className="text-amber-700">(no AI — keyword floor only)</span>
            )}
            {profileName && (
              <>
                {" · "}Profile: <strong>{profileName}</strong>
              </>
            )}
          </span>
          {done.length > 0 && (
            <span className="text-sm font-semibold ml-auto">
              <span className="text-green-700">{passed} passed</span>
              {failed > 0 && <span className="text-red-700"> · {failed} failed</span>}
              {skipped > 0 && <span className="text-neutral-500"> · {skipped} skipped</span>}
            </span>
          )}
        </div>
        {!llmOn && (
          <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">
            No model is configured, so the cases marked <strong>needs AI</strong> will be
            skipped. That is honest, not a failure: those injections are written to slip
            past a keyword list, and the keyword list genuinely cannot see them.
          </p>
        )}
      </div>

      {groups.map((g) => {
        const list = cases.filter((c) => c.group === g);
        if (!list.length) return null;
        return (
          <div key={g} className="mb-6">
            <h2 className="text-sm font-bold text-neutral-900 uppercase tracking-wide mb-2">
              {GROUP_LABEL[g]}
            </h2>
            <div className="space-y-2.5">
              {list.map((c) => {
                const r = results[c.id];
                const open = expanded[c.id];
                return (
                  <div
                    key={c.id}
                    className={`border rounded-2xl p-4 shadow-xs ${
                      !r
                        ? "border-neutral-200 bg-white"
                        : r.skipped
                        ? "border-neutral-300 bg-neutral-50"
                        : r.error || !r.pass
                        ? "border-red-300 bg-red-50/70"
                        : "border-green-300 bg-green-50/60"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs bg-neutral-900 text-white px-1.5 py-0.5 rounded">
                            {c.id}
                          </span>
                          <span className="font-bold text-sm text-neutral-900">{c.title}</span>
                          {c.requires === "llm" && (
                            <span className="text-[10px] bg-sky-100 text-sky-900 border border-sky-300 px-1.5 py-0.5 rounded font-semibold">
                              needs AI
                            </span>
                          )}
                          {r && !r.skipped && !r.error && (
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded font-bold border ${
                                r.pass
                                  ? "bg-green-200 text-green-900 border-green-400"
                                  : "bg-red-200 text-red-900 border-red-400"
                              }`}
                            >
                              {r.pass ? "PASS" : "FAIL"}
                            </span>
                          )}
                          {r?.skipped && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-bold border bg-neutral-200 text-neutral-700 border-neutral-400">
                              SKIPPED
                            </span>
                          )}
                          {r?.ms != null && (
                            <span className="text-[10px] text-neutral-500">{(r.ms / 1000).toFixed(1)}s</span>
                          )}
                        </div>
                        <p className="text-xs text-neutral-700 mt-1.5 leading-relaxed">{c.why}</p>
                      </div>
                      <button
                        onClick={() => runOne(c.id)}
                        disabled={running === c.id || runningAll}
                        className="shrink-0 text-xs bg-white hover:bg-neutral-100 text-neutral-900 font-semibold px-3 py-1.5 rounded-lg border border-neutral-400 disabled:opacity-50 cursor-pointer"
                      >
                        {running === c.id ? "Running…" : "Run"}
                      </button>
                    </div>

                    {/* expected — always visible, this is the teaching part */}
                    <div className="mt-2.5 text-xs bg-white/70 border border-neutral-200 rounded-lg p-2.5">
                      <span className="text-neutral-500 font-semibold">Expected: </span>
                      <span className="text-neutral-900">
                        ends at <strong>{c.expectedStage}</strong>
                        {c.injection ? ", injection flagged and refused" : ", no injection flagged"}
                        {c.arrangement ? `, work arrangement read as ${c.arrangement}` : ""}
                      </span>
                      <div className="font-mono text-[11px] text-neutral-600 mt-1 break-all">
                        {c.sequence.split(">").join(" → ")}
                      </div>
                    </div>

                    {r?.skipped && (
                      <p className="mt-2 text-xs text-neutral-700">{r.note}</p>
                    )}
                    {r?.error && <p className="mt-2 text-xs text-red-800">{r.error}</p>}

                    {r && !r.pass && r.problems && r.problems.length > 0 && (
                      <ul className="mt-2 text-xs text-red-900 list-disc pl-5">
                        {r.problems.map((p, i) => (
                          <li key={i}>{p}</li>
                        ))}
                      </ul>
                    )}

                    {r?.actual && (
                      <>
                        <button
                          onClick={() => setExpanded((e) => ({ ...e, [c.id]: !open }))}
                          className="mt-2 text-xs font-medium text-neutral-700 hover:text-neutral-900 hover:underline cursor-pointer"
                        >
                          {open ? "Hide" : "Show"} what actually happened
                        </button>
                        {open && (
                          <div className="mt-2 text-xs bg-white border border-neutral-200 rounded-lg p-3 space-y-1">
                            <div>
                              <span className="text-neutral-500">Ended at: </span>
                              <strong>{r.actual.stage}</strong>
                              {r.actual.fitScore != null && (
                                <> · fit {Math.round(r.actual.fitScore * 100)}%</>
                              )}
                            </div>
                            <div className="font-mono text-[11px] text-neutral-600 break-all">
                              {r.actual.sequence.split(">").join(" → ")}
                            </div>
                            {r.actual.injectionDetected && (
                              <div className="text-purple-900 bg-purple-50 border border-purple-200 rounded p-2">
                                <strong>Injection caught</strong> via{" "}
                                {r.actual.injectionSources.join(" + ") || "—"}
                                {r.actual.injectionSources.includes("llm") &&
                                  !r.actual.injectionSources.includes("regex") && (
                                    <em> — the keyword list missed this; only the AI saw it.</em>
                                  )}
                                {r.actual.injectionSnippets.map((s, i) => (
                                  <div key={i} className="mt-1 italic text-purple-800">
                                    “{s.slice(0, 160)}”
                                  </div>
                                ))}
                              </div>
                            )}
                            {r.actual.matchedSkills.length > 0 && (
                              <div>
                                <span className="text-neutral-500">Matched: </span>
                                {r.actual.matchedSkills.map((s) => (
                                  <span
                                    key={s}
                                    className={`inline-block mr-1 mb-1 px-1.5 py-0.5 rounded border ${
                                      r.actual!.matchStrength[s] === "partial"
                                        ? "bg-amber-50 border-amber-300 text-amber-900"
                                        : "bg-green-50 border-green-300 text-green-900"
                                    }`}
                                  >
                                    {s}
                                    {r.actual!.matchStrength[s] === "partial" && " (partial)"}
                                  </span>
                                ))}
                              </div>
                            )}
                            {r.actual.missingSkills.length > 0 && (
                              <div>
                                <span className="text-neutral-500">Missing: </span>
                                {r.actual.missingSkills.join(" · ")}
                              </div>
                            )}
                            {r.actual.fitReasoning && (
                              <div className="text-neutral-700 border-l-2 border-sky-300 pl-2">
                                <span className="text-neutral-500">Model&apos;s reasoning: </span>
                                {r.actual.fitReasoning}
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
