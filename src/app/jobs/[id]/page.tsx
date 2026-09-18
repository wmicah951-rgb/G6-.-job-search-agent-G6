"use client";

import { useEffect, useState, use as usePromise } from "react";

type TraceStep = {
  step: number;
  stateBefore: any;
  observation: string;
  availableActions: string[];
  selectedAction: string;
  result: string;
  stateAfter: any;
};

type Evaluation = {
  stage: string;
  fitScore: number | null;
  matchedSkills: string[];
  missingSkills: string[];
  fitRationale: string[];
  fitMethod: "llm" | "deterministic";
  fitReasoning: string | null;
  clarificationQuestion: string | null;
  hardConstraintViolations: string[];
  injectionDetected: boolean;
  injectionSnippets: string[];
  approvalNote: string | null;
  draft: string | null;
  coverLetter: string | null;
  tailoredResume: string | null;
  profileName: string | null;
  trace: TraceStep[];
};

const STAGE_LABEL: Record<string, string> = {
  awaiting_clarification: "Agent has a question for you",
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

// Same tiers the agent itself decides on (see LOW_FIT_THRESHOLD in agent.ts):
// >= 70% strong match, >= 34% (the auto-reject threshold) is borderline,
// below that is what the agent actually auto-rejects on.
function fitScoreColor(score: number): string {
  if (score >= 0.7) return "text-green-700";
  if (score >= 0.45) return "text-amber-700";
  return "text-red-700";
}

type JobDetail = {
  job: { id: string; title: string; rawText: string; sourceUrl: string | null; createdAt: string };
  evaluation: Evaluation | null;
};

export default function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const [data, setData] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editNote, setEditNote] = useState("");
  const [deciding, setDeciding] = useState(false);
  const [showTrace, setShowTrace] = useState(false);

  // In-place editing of drafted materials
  const [coverLetterText, setCoverLetterText] = useState("");
  const [tailoredResumeText, setTailoredResumeText] = useState("");
  const [editingCoverLetter, setEditingCoverLetter] = useState(false);
  const [editingResume, setEditingResume] = useState(false);
  const [savingCoverLetter, setSavingCoverLetter] = useState(false);
  const [savingResume, setSavingResume] = useState(false);
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/jobs/${id}`);
    const d = await res.json();
    setData(d);
    if (d.evaluation) {
      setCoverLetterText(d.evaluation.coverLetter || "");
      setTailoredResumeText(d.evaluation.tailoredResume || "");

      // If awaiting approval and edit box is empty, prefill with smart suggested draft directions
      if (d.evaluation.stage === "awaiting_approval" && !editNote) {
        const points: string[] = [];
        if (d.evaluation.matchedSkills && d.evaluation.matchedSkills.length > 0) {
          points.push(`- Emphasize matched skills: ${d.evaluation.matchedSkills.join(", ")}`);
        }
        if (d.evaluation.fitRationale && d.evaluation.fitRationale.length > 0) {
          points.push(`- Highlight fit: ${d.evaluation.fitRationale[0].replace(/^[-*]\s*/, "")}`);
        }
        points.push(`- Align candidate project accomplishments with ${d.job.title}`);
        setEditNote(points.join("\n"));
      }
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [id]);

  async function decide(decision: "approve" | "edit" | "reject") {
    setDeciding(true);
    try {
      await fetch("/api/agent/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: id, decision, editNote: decision === "edit" ? editNote : null }),
      });
      await load();
    } finally {
      setDeciding(false);
    }
  }

  async function clarify(answer: "compatible" | "violation") {
    setDeciding(true);
    try {
      await fetch("/api/agent/clarify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: id, answer }),
      });
      await load();
    } finally {
      setDeciding(false);
    }
  }

  async function saveCoverLetter() {
    setSavingCoverLetter(true);
    try {
      await fetch(`/api/jobs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coverLetter: coverLetterText }),
      });
      setEditingCoverLetter(false);
      await load();
    } finally {
      setSavingCoverLetter(false);
    }
  }

  async function saveTailoredResume() {
    setSavingResume(true);
    try {
      await fetch(`/api/jobs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tailoredResume: tailoredResumeText }),
      });
      setEditingResume(false);
      await load();
    } finally {
      setSavingResume(false);
    }
  }

  function copyToClipboard(text: string, section: string) {
    navigator.clipboard.writeText(text);
    setCopiedSection(section);
    setTimeout(() => setCopiedSection(null), 2000);
  }


  if (loading || !data) return <p className="text-sm text-neutral-500">Loading…</p>;
  if (!data.evaluation) return <p className="text-sm text-red-600">No evaluation found.</p>;

  const ev = data.evaluation;

  return (
    <div className="max-w-3xl">
      <a href="/" className="text-sm text-neutral-500 hover:underline">
        ← back to dashboard
      </a>
      <h1 className="text-xl font-semibold mt-1 mb-1">{data.job.title}</h1>
      {data.job.sourceUrl && (
        <p className="text-xs text-neutral-500 mb-1">Source: {data.job.sourceUrl}</p>
      )}
      {ev.profileName && (
        <p className="text-xs text-neutral-500 mb-1">
          Evaluated against profile: <span className="font-medium">{ev.profileName}</span>
        </p>
      )}
      <p className="text-xs text-neutral-500 mb-4">
        Skill matching engine:{" "}
        <span className="font-medium">
          {ev.fitMethod === "llm" ? "LLM semantic matching" : "Deterministic keyword matching"}
        </span>
      </p>

      {/* Shows what the model actually concluded, in its own words — the "AI
          thinking" visibility, distinct from the deterministic trace below. */}
      {ev.fitMethod === "llm" && ev.fitReasoning && (
        <div className="border border-sky-200 bg-sky-50 rounded-lg p-3 mb-4 text-sm text-sky-900">
          <div className="font-medium mb-1">Model's reasoning</div>
          <p>{ev.fitReasoning}</p>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="border border-neutral-200 bg-white rounded-lg p-3">
          <div className="text-xs text-neutral-500">Fit score</div>
          <div className={`text-lg font-semibold ${ev.fitScore !== null ? fitScoreColor(ev.fitScore) : "text-neutral-900"}`}>
            {ev.fitScore !== null ? `${Math.round(ev.fitScore * 100)}%` : "—"}
          </div>
        </div>
        <div className="border border-neutral-200 bg-white rounded-lg p-3">
          <div className="text-xs text-neutral-500">Stage</div>
          <div className="mt-0.5">
            <span
              className={`inline-block text-sm font-semibold px-2 py-0.5 rounded-full ${STAGE_COLOR[ev.stage] ?? "bg-neutral-100 text-neutral-900"}`}
            >
              {STAGE_LABEL[ev.stage] ?? ev.stage}
            </span>
          </div>
        </div>
        <div className="border border-neutral-200 bg-white rounded-lg p-3">
          <div className="text-xs text-neutral-500">Matched skills</div>
          <div className="text-sm text-neutral-900">{ev.matchedSkills.join(", ") || "none"}</div>
        </div>
        <div className="border border-neutral-200 bg-white rounded-lg p-3">
          <div className="text-xs text-neutral-500">Missing skills</div>
          <div className="text-sm text-neutral-900">{ev.missingSkills.join(", ") || "none"}</div>
        </div>
      </div>

      {/* Why this fits — distinct from the missing-skills gap list above: a grounded,
          positive-framed explanation, every line traceable to resume.md/preferences.md.
          Also gated on the job NOT being auto-rejected, so this positive panel can never
          contradict the agent's own verdict (e.g. showing "this fits" on a job the agent
          itself just rejected for low fit or a hard-constraint conflict). */}
      {ev.fitRationale.length > 0 &&
        ev.stage !== "rejected_low_fit" &&
        ev.stage !== "rejected_hard_constraint" && (
        <div className="border border-emerald-200 bg-emerald-50 rounded-lg p-4 mb-6">
          <div className="font-medium mb-2 text-emerald-900">Why this role fits you</div>
          <ul className="list-disc list-inside space-y-1 text-sm text-emerald-900">
            {ev.fitRationale.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      {ev.hardConstraintViolations.length > 0 && (
        <div className="border border-red-200 bg-red-50 rounded-lg p-3 mb-4 text-sm text-red-800">
          <div className="font-medium mb-1">Hard constraint violation(s)</div>
          <ul className="list-disc list-inside">
            {ev.hardConstraintViolations.map((v, i) => (
              <li key={i}>{v}</li>
            ))}
          </ul>
        </div>
      )}

      {ev.injectionDetected && (
        <div className="border border-purple-200 bg-purple-50 rounded-lg p-3 mb-4 text-sm text-purple-900">
          <div className="font-medium mb-1">Prompt injection detected and refused</div>
          <p className="mb-2">
            This posting contained embedded text trying to instruct the agent directly
            (auto-approve, skip review, print the resume, etc.). It was treated as data,
            logged, and NOT obeyed. Evaluation proceeded normally on the actual content.
          </p>
          <ul className="list-disc list-inside font-mono text-xs">
            {ev.injectionSnippets.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      {/* ASK_USER — the agent stopped mid-evaluation because it hit a genuine
          ambiguity it shouldn't guess on, distinct from the approval gate below
          (which only ever asks "proceed or not?" after a full evaluation). */}
      {ev.stage === "awaiting_clarification" && (
        <div className="border border-sky-300 bg-sky-50 rounded-lg p-4 mb-6">
          <div className="font-medium mb-2 text-sky-900">Agent needs a clarification before it can continue</div>
          <p className="text-sm text-sky-900 mb-3">{ev.clarificationQuestion}</p>
          <div className="flex gap-2">
            <button
              disabled={deciding}
              onClick={() => clarify("compatible")}
              className="text-sm bg-sky-700 text-white px-3 py-1.5 rounded-md disabled:opacity-50"
            >
              Treat as compatible
            </button>
            <button
              disabled={deciding}
              onClick={() => clarify("violation")}
              className="text-sm bg-neutral-700 text-white px-3 py-1.5 rounded-md disabled:opacity-50"
            >
              Treat as a violation
            </button>
          </div>
        </div>
      )}

      {/* HITL gate */}
      {ev.stage === "awaiting_approval" && (
        <div className="border border-amber-300 bg-amber-50 rounded-xl p-5 mb-6 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <div className="font-semibold text-amber-950 text-base">
              Human Approval Required Before Drafting
            </div>
            <span className="text-xs bg-amber-200 text-amber-900 font-medium px-2 py-0.5 rounded">
              Awaiting Decision
            </span>
          </div>
          <p className="text-xs text-amber-800 mb-3 leading-relaxed">
            The agent has matched your skills and verified constraints. Review or customize the draft instructions below before generation. Clicking <strong>Edit &amp; Approve</strong> applies your custom notes directly to the LLM when creating the Cover Letter and Tailored Resume.
          </p>
          <label className="block text-xs font-semibold text-amber-900 mb-1">
            Draft Instructions &amp; Focus Points (Editable):
          </label>
          <textarea
            value={editNote}
            onChange={(e) => setEditNote(e.target.value)}
            placeholder="e.g., Emphasize SQL & Python reporting; highlight my 2 years of dashboard experience..."
            className="w-full border border-amber-300 rounded-lg px-3 py-2 text-sm mb-4 bg-white text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-amber-500 shadow-inner"
            rows={3}
          />
          <div className="flex flex-wrap gap-2.5">
            <button
              disabled={deciding}
              onClick={() => decide("approve")}
              className="text-sm bg-green-700 hover:bg-green-800 text-white font-medium px-4 py-2 rounded-lg disabled:opacity-50 transition-colors shadow-sm cursor-pointer"
            >
              ✓ Approve (Standard)
            </button>
            <button
              disabled={deciding}
              onClick={() => decide("edit")}
              className="text-sm bg-blue-700 hover:bg-blue-800 text-white font-medium px-4 py-2 rounded-lg disabled:opacity-50 transition-colors shadow-sm cursor-pointer"
            >
              ✏️ Edit &amp; Approve (Use Custom Notes)
            </button>
            <button
              disabled={deciding}
              onClick={() => decide("reject")}
              className="text-sm bg-neutral-600 hover:bg-neutral-700 text-white font-medium px-3.5 py-2 rounded-lg disabled:opacity-50 transition-colors cursor-pointer"
            >
              ✕ Reject Job
            </button>
          </div>
        </div>
      )}

      {ev.draft && (
        <div className="border border-green-200 bg-green-50 rounded-xl p-4 mb-4 shadow-sm">
          <div className="flex justify-between items-center mb-2">
            <div className="font-semibold text-green-950">Grounded Evidence (Deterministic Resume Matches)</div>
            <button
              onClick={() => copyToClipboard(ev.draft!, "evidence")}
              className="text-xs bg-green-100 hover:bg-green-200 text-green-800 font-medium px-2.5 py-1 rounded transition-colors cursor-pointer"
            >
              {copiedSection === "evidence" ? "✓ Copied" : "Copy"}
            </button>
          </div>
          <pre className="whitespace-pre-wrap text-xs font-mono text-neutral-900 bg-white/60 p-3 rounded border border-green-100">{ev.draft}</pre>
        </div>
      )}

      {ev.coverLetter && (
        <div className="border border-blue-200 bg-blue-50 rounded-xl p-4 mb-4 shadow-sm">
          <div className="flex justify-between items-center mb-3">
            <div className="font-semibold text-blue-950 flex items-center gap-1.5">
              <span>📝</span> Cover Letter (AI-Drafted &amp; Grounded)
            </div>
            <div className="flex items-center gap-2">
              {editingCoverLetter ? (
                <>
                  <button
                    disabled={savingCoverLetter}
                    onClick={saveCoverLetter}
                    className="text-xs bg-blue-700 hover:bg-blue-800 text-white font-medium px-2.5 py-1 rounded transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {savingCoverLetter ? "Saving..." : "💾 Save"}
                  </button>
                  <button
                    onClick={() => {
                      setCoverLetterText(ev.coverLetter || "");
                      setEditingCoverLetter(false);
                    }}
                    className="text-xs bg-neutral-200 hover:bg-neutral-300 text-neutral-800 px-2.5 py-1 rounded transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setEditingCoverLetter(true)}
                    className="text-xs bg-blue-100 hover:bg-blue-200 text-blue-800 font-medium px-2.5 py-1 rounded transition-colors cursor-pointer"
                  >
                    ✏️ Edit
                  </button>
                  <button
                    onClick={() => copyToClipboard(coverLetterText, "coverLetter")}
                    className="text-xs bg-blue-100 hover:bg-blue-200 text-blue-800 font-medium px-2.5 py-1 rounded transition-colors cursor-pointer"
                  >
                    {copiedSection === "coverLetter" ? "✓ Copied" : "Copy"}
                  </button>
                </>
              )}
            </div>
          </div>
          {editingCoverLetter ? (
            <textarea
              value={coverLetterText}
              onChange={(e) => setCoverLetterText(e.target.value)}
              className="w-full border border-blue-300 rounded-lg p-3 text-sm bg-white text-neutral-900 leading-relaxed font-sans focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-inner"
              rows={10}
            />
          ) : (
            <div className="whitespace-pre-wrap text-sm text-neutral-900 leading-relaxed bg-white/70 p-3 rounded-lg border border-blue-100">
              {coverLetterText}
            </div>
          )}
        </div>
      )}

      {ev.tailoredResume && (
        <div className="border border-purple-200 bg-purple-50 rounded-xl p-4 mb-6 shadow-sm">
          <div className="flex justify-between items-center mb-3">
            <div className="font-semibold text-purple-950 flex items-center gap-1.5">
              <span>📄</span> Tailored Resume (AI-Rewritten for 100% Match)
            </div>
            <div className="flex items-center gap-2">
              {editingResume ? (
                <>
                  <button
                    disabled={savingResume}
                    onClick={saveTailoredResume}
                    className="text-xs bg-purple-700 hover:bg-purple-800 text-white font-medium px-2.5 py-1 rounded transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {savingResume ? "Saving..." : "💾 Save"}
                  </button>
                  <button
                    onClick={() => {
                      setTailoredResumeText(ev.tailoredResume || "");
                      setEditingResume(false);
                    }}
                    className="text-xs bg-neutral-200 hover:bg-neutral-300 text-neutral-800 px-2.5 py-1 rounded transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setEditingResume(true)}
                    className="text-xs bg-purple-100 hover:bg-purple-200 text-purple-800 font-medium px-2.5 py-1 rounded transition-colors cursor-pointer"
                  >
                    ✏️ Edit
                  </button>
                  <button
                    onClick={() => copyToClipboard(tailoredResumeText, "tailoredResume")}
                    className="text-xs bg-purple-100 hover:bg-purple-200 text-purple-800 font-medium px-2.5 py-1 rounded transition-colors cursor-pointer"
                  >
                    {copiedSection === "tailoredResume" ? "✓ Copied" : "Copy"}
                  </button>
                </>
              )}
            </div>
          </div>
          {editingResume ? (
            <textarea
              value={tailoredResumeText}
              onChange={(e) => setTailoredResumeText(e.target.value)}
              className="w-full border border-purple-300 rounded-lg p-3 text-xs font-mono bg-white text-neutral-900 leading-relaxed focus:outline-none focus:ring-2 focus:ring-purple-500 shadow-inner"
              rows={14}
            />
          ) : (
            <pre className="whitespace-pre-wrap text-xs font-mono text-neutral-900 bg-white/70 p-3 rounded-lg border border-purple-100">
              {tailoredResumeText}
            </pre>
          )}
        </div>
      )}


      {/* Trace viewer — the evidence artifact */}
      <button
        onClick={() => setShowTrace((s) => !s)}
        className="text-sm text-neutral-700 underline mb-3"
      >
        {showTrace ? "Hide" : "Show"} full decision trace ({ev.trace.length} steps)
      </button>

      {showTrace && (
        <div className="space-y-3 mb-8">
          {ev.trace.map((t) => (
            <div key={t.step} className="border border-neutral-200 bg-white rounded-lg p-3 text-xs">
              <div className="font-mono font-semibold mb-1">
                Step {t.step} — selected_action: {t.selectedAction}
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <div>
                  <span className="text-neutral-500">state_before.stage:</span>{" "}
                  {t.stateBefore.stage}
                </div>
                <div>
                  <span className="text-neutral-500">state_after.stage:</span> {t.stateAfter.stage}
                </div>
              </div>
              <div className="mt-1">
                <span className="text-neutral-500">observation:</span> {t.observation}
              </div>
              <div className="mt-1">
                <span className="text-neutral-500">available_actions:</span>{" "}
                [{t.availableActions.join(", ")}]
              </div>
              <div className="mt-1">
                <span className="text-neutral-500">result:</span> {t.result}
              </div>
            </div>
          ))}
        </div>
      )}

      <details className="mb-8">
        <summary className="text-sm text-neutral-500 cursor-pointer">Raw posting text</summary>
        <pre className="whitespace-pre-wrap text-xs mt-2 border border-neutral-200 bg-white text-neutral-900 rounded-lg p-3">
          {data.job.rawText}
        </pre>
      </details>
    </div>
  );
}
