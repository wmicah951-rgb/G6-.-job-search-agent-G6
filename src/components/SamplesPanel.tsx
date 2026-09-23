"use client";

// One-click sample data for anyone opening the live site: pick a ready-made candidate (the
// official class kit's Jordan Lee, our demo candidate, or someone from nursing, teaching,
// software, trades, retail, finance or marketing) and run the agent on a matching set of
// postings. Everything it creates is ordinary data in this browser's own workspace.

import { useEffect, useState } from "react";

type SampleProfile = { key: string; name: string; field: string; blurb: string; postingSet: string };
type PostingSet = { key: string; label: string; description: string; count: number };
type RunResult = { title: string; id: string; stage?: string; fitScore?: number | null; duplicate?: boolean; error?: string };

export default function SamplesPanel({
  prominent,
  onProfileChanged,
  onPostingsLoaded,
}: {
  prominent: boolean;
  onProfileChanged: (name: string) => void;
  onPostingsLoaded: () => void;
}) {
  const [profiles, setProfiles] = useState<SampleProfile[]>([]);
  const [sets, setSets] = useState<PostingSet[]>([]);
  const [profileKey, setProfileKey] = useState("classkit");
  const [setKey, setSetKey] = useState("classkit");
  const [busy, setBusy] = useState<null | "profile" | "postings">(null);
  const [message, setMessage] = useState<string | null>(null);
  const [results, setResults] = useState<RunResult[]>([]);
  const [open, setOpen] = useState(prominent);

  useEffect(() => {
    fetch("/api/samples")
      .then((r) => r.json())
      .then((d) => {
        setProfiles(d.profiles ?? []);
        setSets(d.postingSets ?? []);
      })
      .catch(() => {});
  }, []);
  // Open itself for an empty board, but never snap shut mid-run once postings start arriving.
  useEffect(() => {
    if (prominent) setOpen(true);
  }, [prominent]);

  const chosenProfile = profiles.find((p) => p.key === profileKey);
  const chosenSet = sets.find((s) => s.key === setKey);
  const postingCount = chosenSet?.count ?? 0;
  const [progress, setProgress] = useState(0);

  async function useProfile() {
    setBusy("profile");
    setMessage(null);
    try {
      const res = await fetch("/api/samples", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "profile", key: profileKey }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Could not load that candidate.");
      onProfileChanged(d.name);
      setSetKey(d.postingSet);
      setMessage(`${d.reused ? "Switched to" : "Added and switched to"} ${d.name}. New postings are now scored for this candidate.`);
    } catch (e) {
      setMessage(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
    }
  }

  async function runPostings() {
    setBusy("postings");
    setMessage(null);
    setResults([]);
    setProgress(0);
    // One posting per request: a whole set in one call can outlast a serverless time limit, and
    // this way each result appears as soon as the agent finishes it.
    const collected: RunResult[] = [];
    try {
      for (let i = 0; i < postingCount; i++) {
        const res = await fetch("/api/samples", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "postings", set: setKey, index: i }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) {
          collected.push({ title: `Posting ${i + 1}`, id: "", error: d.error ?? `HTTP ${res.status}` });
        } else {
          collected.push(...(d.results ?? []));
        }
        setResults([...collected]);
        setProgress(i + 1);
        onPostingsLoaded();
      }
      const fresh = collected.filter((r) => !r.duplicate && !r.error).length;
      const dupes = collected.filter((r) => r.duplicate).length;
      setMessage(
        `The agent evaluated ${fresh} posting${fresh === 1 ? "" : "s"}` +
          (dupes ? ` (${dupes} already on your board for this candidate, left as they were)` : "") +
          ". They are ranked on the board below — open any one to see its full decision trace."
      );
      onPostingsLoaded();
    } catch (e) {
      setMessage(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className={`rounded-2xl mb-5 bg-white ${
        prominent ? "border-2 border-sky-200 p-5" : "border border-neutral-200 p-4"
      }`}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-2 text-left cursor-pointer"
      >
        <span className="font-bold text-sm text-neutral-900">
          {prominent ? "Try it with ready-made data" : "Sample candidates and postings"}
        </span>
        <span className="text-xs text-neutral-500 shrink-0">{open ? "Hide" : "Show"}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-4">
          <p className="text-xs text-neutral-600 leading-relaxed">
            Everything here is fictional and loads into <strong>your browser&apos;s own workspace</strong> —
            nobody else sees it or can change it. The postings are run through the real agent, the same
            way as pasting one in, so what lands on the board is genuine agent output with a full trace.
          </p>

          <div>
            <label className="block text-xs font-medium text-neutral-500 mb-1">1. Candidate</label>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={profileKey}
                onChange={(e) => setProfileKey(e.target.value)}
                disabled={!!busy}
                className="border border-neutral-300 rounded-md px-2 py-1.5 text-sm bg-white text-neutral-900 min-w-0 max-w-full"
              >
                {profiles.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                onClick={useProfile}
                disabled={!!busy || profiles.length === 0}
                className="text-sm bg-neutral-900 text-white px-3 py-1.5 rounded-md disabled:opacity-50 whitespace-nowrap"
              >
                {busy === "profile" ? "Loading…" : "Use this candidate"}
              </button>
            </div>
            {chosenProfile && (
              <p className="text-xs text-neutral-500 mt-1 break-words">
                {chosenProfile.field} — {chosenProfile.blurb}
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-500 mb-1">2. Postings to run</label>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={setKey}
                onChange={(e) => setSetKey(e.target.value)}
                disabled={!!busy}
                className="border border-neutral-300 rounded-md px-2 py-1.5 text-sm bg-white text-neutral-900 min-w-0 max-w-full"
              >
                {sets.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
              <button
                onClick={runPostings}
                disabled={!!busy || sets.length === 0}
                className="text-sm bg-sky-700 text-white px-3 py-1.5 rounded-md disabled:opacity-50 whitespace-nowrap"
              >
                {busy === "postings" ? "The agent is working…" : "Run the agent on these"}
              </button>
            </div>
            {chosenSet && <p className="text-xs text-neutral-500 mt-1 break-words">{chosenSet.description}</p>}
            {busy === "postings" && (
              <p className="text-xs text-sky-800 mt-2">
                The agent has finished {progress} of {postingCount}. Each posting takes roughly 10–20 seconds; keep
                this tab open.
              </p>
            )}
          </div>

          {message && <p className="text-xs text-neutral-800 bg-neutral-50 border border-neutral-200 rounded-md px-3 py-2">{message}</p>}

          {results.length > 0 && (
            <ul className="text-xs text-neutral-700 space-y-1">
              {results.map((r) => (
                <li key={`${r.title}-${r.id}`} className="flex flex-wrap gap-x-2 break-words">
                  {r.id ? (
                    <a href={`/jobs/${r.id}`} className="underline font-medium">
                      {r.title}
                    </a>
                  ) : (
                    <span className="font-medium">{r.title}</span>
                  )}
                  <span className="text-neutral-500">
                    {r.error
                      ? `error: ${r.error}`
                      : r.duplicate
                        ? "already on your board"
                        : `${r.stage}${r.fitScore === null || r.fitScore === undefined ? "" : ` · ${Math.round(r.fitScore * 100)}%`}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
