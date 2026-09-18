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

// Fit score is color-coded to the same tiers the agent itself decides on:
// >= 70% reads as a strong match (green), between the low-fit threshold (34%)
// and 70% is a partial/borderline match (amber), below the threshold is what
// the agent actually auto-rejects on (red) — so the color always matches what
// the agent decided, not just an arbitrary gradient.
function fitScoreColor(score: number): string {
  if (score >= 0.7) return "bg-green-100 text-green-800";
  if (score >= 0.45) return "bg-amber-100 text-amber-800";
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

export default function Dashboard() {
  const [jobs, setJobs] = useState<JobRow[]>([]);
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

  return (
    <div>
      <SystemStatusPanel />

      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-semibold">Evaluated postings</h1>
        <a
          href="/jobs/new"
          className="text-sm bg-neutral-900 text-white px-3 py-1.5 rounded-md hover:bg-neutral-700"
        >
          + Add a posting
        </a>
      </div>
      <p className="text-xs text-neutral-500 mb-4">
        New postings will be scanned as:{" "}
        <span className="font-medium text-neutral-900">{activeProfileName ?? "…"}</span>{" "}
        (<a href="/upload" className="underline">change profile</a>)
      </p>

      {loading && <p className="text-sm text-neutral-500">Loading…</p>}

      {!loading && jobs.length === 0 && (
        <div className="border border-dashed border-neutral-300 rounded-lg p-8 text-center text-neutral-500">
          No postings evaluated yet. Add one to see the agent run.
        </div>
      )}

      <div className="grid gap-3">
        {jobs.map((j) => (
          <a
            key={j.id}
            href={`/jobs/${j.id}`}
            className="block border border-neutral-200 bg-white rounded-lg p-4 hover:border-neutral-400 transition"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">{j.title}</div>
                <div className="text-xs text-neutral-500">
                  {j.source_url ? j.source_url : "Pasted text"} · {new Date(j.created_at).toLocaleString()}
                  {j.profile_name && (
                    <>
                      {" "}
                      · scanned as{" "}
                      <span className="font-medium text-neutral-700">{j.profile_name}</span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {!!j.injection_detected && (
                  <span className="text-xs bg-purple-100 text-purple-800 px-2 py-0.5 rounded-full">
                    injection flagged
                  </span>
                )}
                {j.fit_score !== null && (
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${fitScoreColor(
                      j.fit_score ?? 0
                    )}`}
                  >
                    fit {Math.round((j.fit_score ?? 0) * 100)}%
                  </span>
                )}
                {j.stage && (
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${STAGE_COLOR[j.stage] ?? "bg-neutral-100"}`}
                  >
                    {STAGE_LABEL[j.stage] ?? j.stage}
                  </span>
                )}
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
