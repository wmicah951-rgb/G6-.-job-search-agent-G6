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
};

const STAGE_LABEL: Record<string, string> = {
  awaiting_approval: "Awaiting your approval",
  drafted: "Draft ready",
  rejected_low_fit: "Auto-rejected — low fit",
  rejected_hard_constraint: "Auto-rejected — hard constraint",
  rejected_by_human: "Rejected by you",
  approved: "Approved",
  edited: "Edited",
};

const STAGE_COLOR: Record<string, string> = {
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
  if (score >= 0.34) return "bg-amber-100 text-amber-800";
  return "bg-red-100 text-red-800";
}

export default function Dashboard() {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/jobs")
      .then((r) => r.json())
      .then((d) => setJobs(d.jobs ?? []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Evaluated postings</h1>
        <a
          href="/jobs/new"
          className="text-sm bg-neutral-900 text-white px-3 py-1.5 rounded-md hover:bg-neutral-700"
        >
          + Add a posting
        </a>
      </div>

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
