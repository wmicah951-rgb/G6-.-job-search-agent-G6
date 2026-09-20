"use client";

import { useEffect, useState } from "react";

type JobRow = {
  id: string;
  title: string;
  source_url: string | null;
  created_at: string;
  stage: string | null;
  fit_score: number | null;
  injection_detected: number | null;
  profile_name: string | null;
};

const STAGE_LABEL: Record<string, string> = {
  awaiting_clarification: "Agent has a question",
  awaiting_approval: "Awaiting your approval",
  drafted: "Draft ready",
  rejected_low_fit: "Auto-rejected — low fit",
  rejected_hard_constraint: "Auto-rejected — hard constraint",
  rejected_by_human: "Rejected by you",
  approved: "Approved",
  edited: "Edited",
};

const STAGE_COLOR: Record<string, string> = {
  awaiting_clarification: "bg-sky-100 text-sky-800",
  awaiting_approval: "bg-amber-100 text-amber-800",
  drafted: "bg-green-100 text-green-800",
  rejected_low_fit: "bg-neutral-200 text-neutral-700",
  rejected_hard_constraint: "bg-red-100 text-red-800",
  rejected_by_human: "bg-neutral-200 text-neutral-700",
  approved: "bg-green-100 text-green-800",
  edited: "bg-green-100 text-green-800",
};

// Fit score colours follow the agent's own tiers: green is a comfortable match,
// amber is at or just above the default 60% bar, red is below it — i.e. what the
// agent auto-rejects. Note the bar itself is per profile ("Minimum fit: N%" in
// preferences.md), so a red score on a profile with a lower bar may still have
// passed; the stage badge next to it is the authoritative verdict.
function fitScoreColor(score: number): string {
  if (score >= 0.7) return "bg-green-100 text-green-800";
  if (score >= 0.6) return "bg-amber-100 text-amber-800";
  return "bg-red-100 text-red-800";
}

type SystemStatus = {
  database: { ok: boolean; mode: "turso" | "local-file"; message: string };
  llm: { configured: boolean; model: string };
  scraper: { available: boolean };
};

type LlmTestResult = { ok: boolean; message: string } | null;

// Small colored-dot badge shared by every row in the status panel — green for
// a confirmed-working state, neutral gray for an intentionally-off state
// (e.g. LLM simply not configured), red for configured-but-failing.
function StatusDot({ color }: { color: "green" | "gray" | "red" }) {
  const bg = color === "green" ? "bg-green-500" : color === "red" ? "bg-red-500" : "bg-neutral-400";
  return <span className={`inline-block w-2 h-2 rounded-full ${bg}`} />;
}

function SystemStatusPanel() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [llmTest, setLlmTest] = useState<LlmTestResult>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    fetch("/api/system-status")
      .then((r) => r.json())
      .then(setStatus)
      .finally(() => setLoading(false));
  }, []);

  async function testLlm() {
    setTesting(true);
    setLlmTest(null);
    try {
      const res = await fetch("/api/system-status/test-llm", { method: "POST" });
      setLlmTest(await res.json());
    } finally {
      setTesting(false);
    }
  }

  if (loading || !status) {
    return <div className="border border-neutral-200 bg-white rounded-lg p-3 mb-4 text-xs text-neutral-500">Checking system status…</div>;
  }

  return (
    <div className="border border-neutral-200 bg-white rounded-lg p-3 mb-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <div className="flex items-center gap-2">
          <StatusDot color={status.database.ok ? "green" : "red"} />
          <span className="text-neutral-900">
            Database: {status.database.mode === "turso" ? "Turso" : "Local file"}
          </span>
          <span className="text-xs text-neutral-500">({status.database.message})</span>
        </div>

        <div className="flex items-center gap-2">
          <StatusDot color={llmTest ? (llmTest.ok ? "green" : "red") : "gray"} />
          <span className="text-neutral-900">
            LLM matching: {status.llm.configured ? status.llm.model : "not configured (deterministic matching)"}
          </span>
          {status.llm.configured && (
            <button
              onClick={testLlm}
              disabled={testing}
              className="text-xs text-blue-700 underline disabled:opacity-50"
            >
              {testing ? "Testing…" : "Test connection"}
            </button>
          )}
          {llmTest && (
            <span className={`text-xs ${llmTest.ok ? "text-green-700" : "text-red-700"}`}>
              {llmTest.message}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <StatusDot color={status.scraper.available ? "green" : "red"} />
          <span className="text-neutral-900">Job-posting scraper: available (best-effort)</span>
        </div>
      </div>
    </div>
  );
}

function formatSourceUrl(urlStr: string | null): string {
  if (!urlStr) return "Pasted text";
  try {
    const parsed = new URL(urlStr);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return urlStr.length > 25 ? urlStr.slice(0, 25) + "…" : urlStr;
  }
}

export default function Dashboard() {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  // Board filter. Rejected postings pile up fast and bury the ones actually waiting
  // on you, which is the only group with anything to do.
  const [filter, setFilter] = useState<"all" | "todo" | "drafted" | "rejected" | "flagged">("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"rank" | "newest">("rank");
  const [loading, setLoading] = useState(true);
  const [activeProfileName, setActiveProfileName] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/jobs")
      .then((r) => r.json())
      .then((d) => setJobs(d.jobs ?? []))
      .finally(() => setLoading(false));
    fetch("/api/profiles")
      .then((r) => r.json())
      .then((d) => setActiveProfileName(d.profiles?.find((p: { isActive: boolean; name: string }) => p.isActive)?.name ?? null));
  }, []);

  async function deleteJob(e: React.MouseEvent, id: string, title: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(`Delete "${title}"? This removes the posting and its evaluation.`)) return;
    const res = await fetch(`/api/jobs/${id}`, { method: "DELETE" });
    if (res.ok) setJobs((prev) => prev.filter((j) => j.id !== id));
    else window.alert("Could not delete that posting.");
  }

  // "Needs you" is the only group with an outstanding action — the agent has stopped
  // and is waiting on a human, either to approve a draft or to answer a question.
  function inGroup(j: JobRow, key: typeof filter): boolean {
    // A row can exist with no evaluation (e.g. a run that failed part way), so never
    // assume stage is present.
    const stage = j.stage ?? "";
    switch (key) {
      case "todo":
        return stage === "awaiting_approval" || stage === "awaiting_clarification";
      case "drafted":
        return stage === "drafted" || stage === "approved" || stage === "edited";
      case "rejected":
        return stage.startsWith("rejected");
      case "flagged":
        return !!j.injection_detected;
      default:
        return true;
    }
  }

  const countFor = (key: typeof filter) => jobs.filter((j) => inGroup(j, key)).length;

  // Ranking: jobs still worth pursuing first, best fit at the top; auto-rejected on a
  // low score next; hard-constraint rejections last (they are down-ranked regardless of
  // skill fit, e.g. a 82% match that needs 5+ years and a clearance).
  function rankTier(j: JobRow): number {
    if (j.stage === "rejected_hard_constraint") return 2;
    if (j.stage === "rejected_low_fit" || j.stage === "rejected_by_human") return 1;
    return 0;
  }
  const visibleJobs = jobs
    .filter(
      (j) =>
        inGroup(j, filter) &&
        (!query.trim() || j.title.toLowerCase().includes(query.trim().toLowerCase()))
    )
    .sort((a, b) =>
      sort === "newest"
        ? (b.created_at ?? "").localeCompare(a.created_at ?? "")
        : rankTier(a) - rankTier(b) ||
          (b.fit_score ?? -1) - (a.fit_score ?? -1) ||
          (b.created_at ?? "").localeCompare(a.created_at ?? "")
    );

  return (
    <div className="w-full max-w-6xl mx-auto font-sans">
      <SystemStatusPanel />

      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Evaluated Job Postings</h1>
        <a
          href="/jobs/new"
          className="text-sm bg-neutral-900 text-white font-semibold px-4 py-2 rounded-xl hover:bg-neutral-800 transition-colors shadow-xs"
        >
          + Add a Posting
        </a>
      </div>
      <p className="text-xs text-neutral-500 mb-5">
        New postings will be scanned as:{" "}
        <span className="font-semibold text-neutral-900">{activeProfileName ?? "…"}</span>{" "}
        (<a href="/upload" className="underline hover:text-neutral-900">change profile</a>)
      </p>

      {loading && <p className="text-sm text-neutral-500">Loading postings…</p>}

      {!loading && jobs.length === 0 && (
        <div className="border border-dashed border-neutral-300 rounded-2xl p-12 text-center text-neutral-500 bg-white">
          No postings evaluated yet. Click "+ Add a Posting" to see the agent run.
        </div>
      )}

      {!loading && jobs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {(
            [
              ["all", "All"],
              ["todo", "Needs you"],
              ["drafted", "Drafted"],
              ["rejected", "Rejected"],
              ["flagged", "Injection caught"],
            ] as const
          ).map(([key, label]) => {
            const n = countFor(key);
            const active = filter === key;
            return (
              <button
                key={key}
                onClick={() => setFilter(key)}
                disabled={n === 0 && key !== "all"}
                className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                  active
                    ? "bg-neutral-900 text-white border-neutral-900"
                    : "bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50"
                }`}
              >
                {label}
                <span className={active ? "ml-1.5 text-neutral-300" : "ml-1.5 text-neutral-400"}>
                  {n}
                </span>
              </button>
            );
          })}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as "rank" | "newest")}
            className="ml-auto border border-neutral-300 rounded-lg px-2 py-1.5 text-xs bg-white text-neutral-900"
            aria-label="Sort postings"
          >
            <option value="rank">Ranked: best fit first</option>
            <option value="newest">Newest first</option>
          </select>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search titles…"
            className="w-44 border border-neutral-300 rounded-lg px-3 py-1.5 text-xs bg-white text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-800"
          />
        </div>
      )}

      {!loading && jobs.length > 0 && visibleJobs.length === 0 && (
        <div className="border border-dashed border-neutral-300 rounded-2xl p-8 text-center text-sm text-neutral-500 bg-white">
          Nothing matches that filter.{" "}
          <button
            onClick={() => {
              setFilter("all");
              setQuery("");
            }}
            className="underline cursor-pointer"
          >
            Show everything
          </button>
        </div>
      )}

      {/* min-w-0 on the grid so its single implicit column isn't held to the "auto" default
          of min-width: auto (a card's un-wrappable content, e.g. the truncated title, would
          otherwise force the whole track — and with it the page — wider than the viewport). */}
      <div className="grid gap-3 min-w-0">
        {visibleJobs.map((j) => (
          <a
            key={j.id}
            href={`/jobs/${j.id}`}
            // min-w-0: same reason — a grid item defaults to min-width: auto too.
            className="block min-w-0 border border-neutral-200 bg-white rounded-xl p-4 sm:p-5 hover:border-neutral-400 hover:shadow-xs transition"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-neutral-900 text-base truncate">
                  {sort === "rank" && (
                    <span className="text-neutral-400 font-mono text-sm mr-2">#{visibleJobs.indexOf(j) + 1}</span>
                  )}
                  {j.title}
                </div>
                <div className="text-xs text-neutral-500 mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  {j.source_url ? (
                    <span
                      className="inline-flex items-center gap-1 bg-neutral-100 text-neutral-700 px-2 py-0.5 rounded font-mono text-xs truncate max-w-[220px]"
                      title={j.source_url}
                    >
                      🔗 {formatSourceUrl(j.source_url)}
                    </span>
                  ) : (
                    <span className="text-neutral-500">📄 Pasted text</span>
                  )}
                  <span>· {new Date(j.created_at).toLocaleDateString()}</span>
                  {j.profile_name && (
                    <span>
                      · scanned as <span className="font-medium text-neutral-700">{j.profile_name}</span>
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {!!j.injection_detected && (
                  <span className="text-xs bg-purple-600 text-white font-bold px-2.5 py-1 rounded-full">
                    ⚠ prompt injection caught
                  </span>
                )}
                {j.fit_score !== null && (
                  <span
                    className={`text-xs px-2.5 py-1 rounded-full font-bold ${fitScoreColor(
                      j.fit_score ?? 0
                    )}`}
                  >
                    fit {Math.round((j.fit_score ?? 0) * 100)}%
                  </span>
                )}
                {j.stage && (
                  <span
                    className={`text-xs px-2.5 py-1 rounded-full font-medium ${STAGE_COLOR[j.stage] ?? "bg-neutral-100 text-neutral-800"}`}
                  >
                    {STAGE_LABEL[j.stage] ?? j.stage}
                  </span>
                )}
                <button
                  type="button"
                  onClick={(e) => deleteJob(e, j.id, j.title)}
                  title="Delete this posting"
                  aria-label={`Delete ${j.title}`}
                  className="text-xs text-red-700 hover:bg-red-50 border border-red-200 px-2 py-1 rounded-lg cursor-pointer"
                >
                  🗑 Delete
                </button>
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

