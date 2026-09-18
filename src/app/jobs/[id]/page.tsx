"use client";

import { useEffect, useState, use as usePromise } from "react";
import { renderMarkdownPdf, type PdfKind } from "@/lib/pdfRender";

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
  injectionSources: string[];
  workArrangement: string;
  approvalNote: string | null;
  draft: string | null;
  coverLetter: string | null;
  tailoredResume: string | null;
  gapNotes: { skill: string; status: string; note: string }[];
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
  awaiting_clarification: "bg-sky-100 text-sky-800 border-sky-200",
  awaiting_approval: "bg-amber-100 text-amber-900 border-amber-300",
  drafted: "bg-green-100 text-green-900 border-green-300",
  rejected_low_fit: "bg-neutral-200 text-neutral-700 border-neutral-300",
  rejected_hard_constraint: "bg-red-100 text-red-900 border-red-300",
  rejected_by_human: "bg-neutral-200 text-neutral-700 border-neutral-300",
  approved: "bg-green-100 text-green-900 border-green-300",
  edited: "bg-green-100 text-green-900 border-green-300",
};

function fitScoreColor(score: number): string {
  if (score >= 0.7) return "text-green-700";
  if (score >= 0.6) return "text-amber-700";
  return "text-red-700";
}

function formatSourceUrl(urlStr: string | null): string {
  if (!urlStr) return "";
  try {
    const parsed = new URL(urlStr);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return urlStr.length > 25 ? urlStr.slice(0, 25) + "…" : urlStr;
  }
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
  const [decidingLabel, setDecidingLabel] = useState("");
  const [customSkillInput, setCustomSkillInput] = useState("");

  // In-place editing states
  const [evidenceText, setEvidenceText] = useState("");
  const [coverLetterText, setCoverLetterText] = useState("");
  const [tailoredResumeText, setTailoredResumeText] = useState("");
  const [editingEvidence, setEditingEvidence] = useState(false);
  const [editingCoverLetter, setEditingCoverLetter] = useState(false);
  const [editingResume, setEditingResume] = useState(false);
  const [savingEvidence, setSavingEvidence] = useState(false);
  const [savingCoverLetter, setSavingCoverLetter] = useState(false);
  const [savingResume, setSavingResume] = useState(false);
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const [saveToast, setSaveToast] = useState<string | null>(null);

  // Collapsible toggle states for long boxes
  const [collapsedEvidence, setCollapsedEvidence] = useState(false);
  const [collapsedCoverLetter, setCollapsedCoverLetter] = useState(false);
  const [collapsedResume, setCollapsedResume] = useState(false);
  const [collapsedReasoning, setCollapsedReasoning] = useState(false);
  const [collapsedRationale, setCollapsedRationale] = useState(false);
  const [collapsedTrace, setCollapsedTrace] = useState(true);
  const [collapsedRawText, setCollapsedRawText] = useState(true);

  // Full-height vs internal scroll toggle for long boxes
  const [fullHeightEvidence, setFullHeightEvidence] = useState(false);
  const [fullHeightCoverLetter, setFullHeightCoverLetter] = useState(false);
  const [fullHeightResume, setFullHeightResume] = useState(false);

  // Scroll to top
  const [showScrollTop, setShowScrollTop] = useState(false);

  function getSmartSuggestions(ev: Evaluation, title: string): string {
    const points: string[] = [];
    if (ev.matchedSkills && ev.matchedSkills.length > 0) {
      points.push(`- Emphasize matched skills: ${ev.matchedSkills.slice(0, 5).join(", ")}`);
    }
    if (ev.fitRationale && ev.fitRationale.length > 0) {
      const cleanRationale = ev.fitRationale[0].replace(/^[-*]\s*/, "");
      points.push(`- Highlight fit: ${cleanRationale}`);
    }
    points.push(`- Tailor application specifically to ${title} and quantify impact`);
    return points.join("\n");
  }

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/jobs/${id}`);
    const d = await res.json();
    setData(d);
    if (d.evaluation) {
      setEvidenceText(d.evaluation.draft || "");
      setCoverLetterText(d.evaluation.coverLetter || "");
      setTailoredResumeText(d.evaluation.tailoredResume || "");

      if (d.evaluation.stage === "awaiting_approval" && !editNote) {
        setEditNote(getSmartSuggestions(d.evaluation, d.job.title));
      }
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [id]);

  useEffect(() => {
    function handleScroll() {
      setShowScrollTop(window.scrollY > 350);
    }
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  function triggerToast(msg: string) {
    setSaveToast(msg);
    setTimeout(() => setSaveToast(null), 3000);
  }

  async function decide(decision: "approve" | "edit" | "reject") {
    setDeciding(true);
    setDecidingLabel(
      decision === "reject"
        ? "Rejecting job..."
        : decision === "edit"
        ? "Applying your custom instructions & drafting with LLM..."
        : "Drafting Cover Letter & Tailored Resume with LLM..."
    );
    try {
      await fetch("/api/agent/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: id,
          decision,
          editNote: decision !== "reject" && editNote.trim() ? editNote.trim() : null,
        }),
      });
      await load();
      triggerToast(decision === "reject" ? "Job rejected." : "Application materials drafted successfully!");
    } finally {
      setDeciding(false);
    }
  }

  async function clarify(answer: "compatible" | "violation") {
    setDeciding(true);
    setDecidingLabel("Processing clarification with agent...");
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

  async function saveEvidence() {
    setSavingEvidence(true);
    try {
      await fetch(`/api/jobs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft: evidenceText }),
      });
      setEditingEvidence(false);
      triggerToast("Grounded evidence updated!");
      await load();
    } finally {
      setSavingEvidence(false);
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
      triggerToast("Cover letter saved successfully!");
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
      triggerToast("Tailored resume saved successfully!");
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

  function downloadAsPdf(text: string, filename: string, kind: PdfKind = "plain") {
    renderMarkdownPdf(text, filename, kind);
  }

  function safeFilename(base: string): string {
    return base.replace(/[^a-z0-9\- ]/gi, "").trim().replace(/\s+/g, "-").slice(0, 80) || "document";
  }

  function toggleAllMaterials(expand: boolean) {
    setCollapsedEvidence(!expand);
    setCollapsedCoverLetter(!expand);
    setCollapsedResume(!expand);
  }

  function addMissingSkillToDraft(skill: string) {
    const addition = `- Experience with ${skill} (or equivalent): I have related experience in [describe your hands-on work or similar tool/project]`;
    setEditNote((prev) => (prev ? `${prev}\n${addition}` : addition));
    triggerToast(`Added "${skill}" to draft instructions!`);
    const el = document.getElementById("draft-instructions-box");
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.focus();
    }
  }

  function addCustomBridgeToDraft(skill: string, customExp: string) {
    if (!customExp.trim()) return;
    const addition = skill
      ? `- For ${skill} requirement: ${customExp.trim()}`
      : `- Additional relevant qualification: ${customExp.trim()}`;
    setEditNote((prev) => (prev ? `${prev}\n${addition}` : addition));
    triggerToast("Added custom experience to draft instructions!");
    const el = document.getElementById("draft-instructions-box");
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-4 border-neutral-800 border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-sm font-medium text-neutral-600">Loading job evaluation...</p>
        </div>
      </div>
    );
  }

  if (!data.evaluation) {
    return (
      <div className="max-w-xl mx-auto py-12 text-center">
        <p className="text-sm font-medium text-red-600 mb-2">No evaluation found for this posting.</p>
        <a href="/" className="text-xs text-neutral-600 underline">Return to dashboard</a>
      </div>
    );
  }

  const ev = data.evaluation;
  const hasDraftMaterials = !!(ev.draft || ev.coverLetter || ev.tailoredResume);

  return (
    <div className="w-full max-w-5xl mx-auto pb-24 font-sans">
      {/* Toast notification */}
      {saveToast && (
        <div className="fixed top-5 right-5 z-50 bg-neutral-900 text-white px-4 py-2.5 rounded-xl shadow-xl text-sm flex items-center gap-2 border border-neutral-700 animate-in fade-in slide-in-from-top-2">
          <span>✓</span>
          <span>{saveToast}</span>
        </div>
      )}

      {/* Loading overlay during LLM drafting */}
      {deciding && (
        <div className="fixed inset-0 bg-neutral-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-neutral-200 rounded-2xl p-6 sm:p-8 max-w-md w-full shadow-2xl text-center">
            <div className="animate-spin w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4" />
            <h3 className="font-bold text-lg text-neutral-900 mb-2">AI Agent at Work</h3>
            <p className="text-sm text-neutral-700 mb-3">{decidingLabel}</p>
            <p className="text-xs text-neutral-400">
              Generating tailored cover letter and rewriting resume to a 100% fit (~10–15s).
            </p>
          </div>
        </div>
      )}

      {/* Sticky Top Bar / Breadcrumb */}
      <div className="sticky top-0 z-30 bg-neutral-50/95 backdrop-blur-md py-2.5 mb-4 border-b border-neutral-200/80 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs">
          <a href="/" className="text-neutral-500 hover:text-neutral-900 font-medium">
            ← Dashboard
          </a>
          <span className="text-neutral-300">/</span>
          <span className="font-semibold text-neutral-800 truncate max-w-[280px] sm:max-w-md">
            {data.job.title}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-neutral-400 mr-1 hidden sm:inline">Jump to:</span>
          <a
            href="#status-section"
            className="px-2 py-1 rounded bg-white border border-neutral-200 text-neutral-600 hover:text-neutral-900 hover:border-neutral-400 transition-colors"
          >
            Status
          </a>
          <a
            href="#skills-section"
            className="px-2 py-1 rounded bg-white border border-neutral-200 text-neutral-600 hover:text-neutral-900 hover:border-neutral-400 transition-colors"
          >
            Skills Breakdown
          </a>
          {ev.stage === "awaiting_approval" && (
            <a
              href="#approval-section"
              className="px-2 py-1 rounded bg-amber-100 border border-amber-300 text-amber-900 font-medium hover:bg-amber-200 transition-colors"
            >
              Approval Box
            </a>
          )}
          {hasDraftMaterials && (
            <a
              href="#materials-section"
              className="px-2 py-1 rounded bg-green-100 border border-green-300 text-green-900 font-medium hover:bg-green-200 transition-colors"
            >
              Drafts
            </a>
          )}
          <a
            href="#trace-section"
            className="px-2 py-1 rounded bg-white border border-neutral-200 text-neutral-600 hover:text-neutral-900 hover:border-neutral-400 transition-colors"
          >
            Trace
          </a>
        </div>
      </div>

      {/* Header */}
      <div className="mb-6" id="status-section">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-neutral-900">
              {data.job.title}
            </h1>
            {data.job.sourceUrl && (
              <p className="text-xs text-neutral-500 mt-1 flex items-center gap-1.5 flex-wrap">
                <span>Source:</span>
                <a
                  href={data.job.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-600 hover:underline font-mono bg-neutral-100 px-2 py-0.5 rounded text-xs truncate max-w-sm inline-block"
                  title={data.job.sourceUrl}
                >
                  🔗 {formatSourceUrl(data.job.sourceUrl)}
                </a>
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span
              className={`inline-flex items-center text-sm font-semibold px-3 py-1 rounded-full border ${
                STAGE_COLOR[ev.stage] ?? "bg-neutral-100 text-neutral-900"
              }`}
            >
              {STAGE_LABEL[ev.stage] ?? ev.stage}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-500">
          {ev.profileName && (
            <span>
              Profile: <strong className="text-neutral-700">{ev.profileName}</strong>
            </span>
          )}
          <span>
            Engine:{" "}
            <strong className="text-neutral-700">
              {ev.fitMethod === "llm" ? "LLM semantic matching" : "Deterministic keyword matching"}
            </strong>
          </span>
        </div>
      </div>

      {/* AI Thinking / Model's Reasoning with toggle arrow */}
      {ev.fitMethod === "llm" && ev.fitReasoning && (
        <div className="border border-sky-200 bg-sky-50/90 rounded-2xl p-4 mb-6 shadow-xs">
          <div
            onClick={() => setCollapsedReasoning(!collapsedReasoning)}
            className="flex items-center justify-between cursor-pointer select-none"
          >
            <div className="font-semibold text-sm text-sky-950 flex items-center gap-2">
              <span
                className={`inline-block text-xs text-sky-600 transition-transform duration-200 ${
                  collapsedReasoning ? "-rotate-90" : "rotate-0"
                }`}
              >
                ▼
              </span>
              <span>Model Reasoning &amp; Assessment</span>
            </div>
            <span className="text-xs text-sky-700 font-medium hover:underline">
              {collapsedReasoning ? "Expand" : "Collapse"}
            </span>
          </div>
          {!collapsedReasoning && (
            <p className="mt-2.5 text-sm text-sky-900 leading-relaxed pl-5 border-l-2 border-sky-300">
              {ev.fitReasoning}
            </p>
          )}
        </div>
      )}

      {/* Top High-Level Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mb-6">
        <div className="border border-neutral-200 bg-white rounded-xl p-4 shadow-xs">
          <div className="text-xs font-medium text-neutral-500 mb-1">Fit Score</div>
          <div
            className={`text-2xl font-bold ${
              ev.fitScore !== null ? fitScoreColor(ev.fitScore) : "text-neutral-900"
            }`}
          >
            {ev.fitScore !== null ? `${Math.round(ev.fitScore * 100)}%` : "—"}
          </div>
        </div>
        <div className="border border-neutral-200 bg-white rounded-xl p-4 shadow-xs">
          <div className="text-xs font-medium text-neutral-500 mb-1">Current Stage</div>
          <div className="text-sm font-semibold text-neutral-900 truncate">
            {STAGE_LABEL[ev.stage] ?? ev.stage}
          </div>
        </div>
        <div className="border border-neutral-200 bg-white rounded-xl p-4 shadow-xs">
          <div className="text-xs font-medium text-neutral-500 mb-1">Matched Skills</div>
          <div className="text-lg font-bold text-green-700">
            {ev.matchedSkills.length} Verified
          </div>
        </div>
        <div className="border border-neutral-200 bg-white rounded-xl p-4 shadow-xs">
          <div className="text-xs font-medium text-neutral-500 mb-1">Missing / Gap Skills</div>
          <div className="text-lg font-bold text-amber-700">
            {ev.missingSkills.length} Identified
          </div>
        </div>
      </div>

      {/* SKILLS EVALUATION SECTION — kept plain and text-first on purpose */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6" id="skills-section">
        {/* Matched Skills */}
        <div className="border border-neutral-200 bg-white rounded-xl p-4 sm:p-5 flex flex-col">
          <h3 className="font-semibold text-neutral-900 text-sm sm:text-base mb-1">
            Matched Skills ({ev.matchedSkills.length})
          </h3>
          <p className="text-xs text-neutral-500 mb-3">
            Directly matched to a verified quote from your resume.
          </p>

          {ev.matchedSkills.length > 0 ? (
            <p className="text-sm text-neutral-800 leading-relaxed mb-3">
              {ev.matchedSkills.join(" · ")}
            </p>
          ) : (
            <p className="text-sm text-neutral-500 italic mb-3">No direct keyword skill matches detected.</p>
          )}

          {ev.stage === "awaiting_approval" && ev.matchedSkills.length > 0 && (
            <button
              type="button"
              onClick={() => {
                const addition = `- Emphasize verified strengths: ${ev.matchedSkills.join(", ")}`;
                setEditNote((prev) => (prev ? `${prev}\n${addition}` : addition));
                triggerToast("Added verified skills to draft instructions!");
              }}
              className="mt-auto text-xs text-neutral-600 hover:text-neutral-900 underline underline-offset-2 cursor-pointer text-left"
            >
              + Emphasize all matched skills in draft instructions
            </button>
          )}
        </div>

        {/* Missing Skills — with interactive bridging + post-draft gap feedback */}
        <div className="border border-neutral-200 bg-white rounded-xl p-4 sm:p-5 flex flex-col">
          <h3 className="font-semibold text-neutral-900 text-sm sm:text-base mb-1">
            Missing Skills &amp; Gaps ({ev.missingSkills.length})
          </h3>
          <p className="text-xs text-neutral-500 mb-3">
            Mentioned in the posting but not found on your resume. If you have similar experience, add it below so the agent can bridge the gap.
          </p>

          {ev.missingSkills.length > 0 ? (
            <ul className="divide-y divide-neutral-100 mb-3">
              {ev.missingSkills.map((skill, idx) => {
                const gapNote = ev.gapNotes?.find(
                  (g) => g.skill.trim().toLowerCase() === skill.trim().toLowerCase()
                );
                return (
                  <li key={idx} className="py-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-sm text-neutral-900">{skill}</span>
                      {gapNote && (
                        <p className="text-xs text-neutral-500 mt-0.5">
                          {gapNote.status === "not_addressed" ? "Not addressed in draft: " : "In draft: "}
                          {gapNote.note}
                        </p>
                      )}
                    </div>
                    {ev.stage === "awaiting_approval" && (
                      <button
                        type="button"
                        onClick={() => addMissingSkillToDraft(skill)}
                        className="text-xs text-amber-800 hover:underline whitespace-nowrap cursor-pointer shrink-0"
                        title="Add to draft instructions to explain equivalent experience"
                      >
                        + I have this or similar
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-neutral-500 mb-3">No missing skills identified — full coverage.</p>
          )}

          {/* Quick custom skill bridge input */}
          {ev.stage === "awaiting_approval" && ev.missingSkills.length > 0 && (
            <div className="mt-auto pt-3 border-t border-neutral-100">
              <label className="block text-xs font-medium text-neutral-700 mb-1">
                Have a similar skill or equivalent tool?
              </label>
              <div className="flex gap-2">
                <input
                  value={customSkillInput}
                  onChange={(e) => setCustomSkillInput(e.target.value)}
                  placeholder="e.g. I have 2 yrs MySQL & Snowflake which is similar to Postgres..."
                  className="flex-1 border border-neutral-300 rounded-lg px-3 py-1.5 text-xs bg-white text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-400"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && customSkillInput.trim()) {
                      addCustomBridgeToDraft("", customSkillInput);
                      setCustomSkillInput("");
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (customSkillInput.trim()) {
                      addCustomBridgeToDraft("", customSkillInput);
                      setCustomSkillInput("");
                    }
                  }}
                  className="text-xs bg-neutral-800 hover:bg-neutral-900 text-white font-medium px-3 py-1.5 rounded-lg transition-colors cursor-pointer shrink-0"
                >
                  + Add to Draft
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Why This Fits — collapsible card */}
      {ev.fitRationale.length > 0 &&
        ev.stage !== "rejected_low_fit" &&
        ev.stage !== "rejected_hard_constraint" && (
          <div className="border border-emerald-200 bg-emerald-50/80 rounded-2xl p-4 sm:p-5 mb-6 shadow-xs" id="why-fits">
            <div
              onClick={() => setCollapsedRationale(!collapsedRationale)}
              className="flex items-center justify-between cursor-pointer select-none mb-1"
            >
              <div className="font-semibold text-sm sm:text-base text-emerald-950 flex items-center gap-2">
                <span
                  className={`inline-block text-xs text-emerald-600 transition-transform duration-200 ${
                    collapsedRationale ? "-rotate-90" : "rotate-0"
                  }`}
                >
                  ▼
                </span>
                <span>Why This Role Fits You ({ev.fitRationale.length} points)</span>
              </div>
              <span className="text-xs text-emerald-700 hover:underline font-medium">
                {collapsedRationale ? "Expand" : "Collapse"}
              </span>
            </div>
            {!collapsedRationale && (
              <ul className="mt-3 list-disc list-inside space-y-1.5 text-sm text-emerald-900 pl-2">
                {ev.fitRationale.map((r, i) => (
                  <li key={i} className="leading-relaxed">{r}</li>
                ))}
              </ul>
            )}
          </div>
        )}

      {/* Hard constraint violations */}
      {ev.hardConstraintViolations.length > 0 && (
        <div className="border border-red-200 bg-red-50 rounded-2xl p-4 mb-6 text-sm text-red-800 shadow-xs">
          <div className="font-semibold text-red-950 mb-1.5">Hard constraint violation(s)</div>
          <ul className="list-disc list-inside space-y-1">
            {ev.hardConstraintViolations.map((v, i) => (
              <li key={i}>{v}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Injection Refusal — loud on purpose: this is a security gate firing */}
      {ev.injectionDetected && (
        <div className="border-2 border-purple-500 bg-purple-50 rounded-2xl p-5 mb-6 text-sm text-purple-950 shadow-md" role="alert">
          <div className="font-bold text-purple-950 text-base mb-1 flex items-center gap-2">
            <span>⚠️</span>
            <span>PROMPT INJECTION CAUGHT — instructions in this posting were NOT followed</span>
          </div>
          <p className="mb-3 text-xs leading-relaxed text-purple-900">
            This posting contains text aimed at an AI/screening system instead of at applicants. It was treated strictly
            as data. The evaluation below used only the real requirements, and a human decision is still required
            before anything is drafted.
            {ev.injectionSources && ev.injectionSources.length > 0 && (
              <> Detected by: <strong>{ev.injectionSources.join(" + ")}</strong>.</>
            )}
          </p>
          <div className="text-xs font-semibold mb-1">Refused text:</div>
          <ul className="space-y-1">
            {ev.injectionSnippets.map((s, i) => (
              <li key={i} className="font-mono text-xs bg-white border border-purple-200 rounded-lg px-3 py-1.5 break-words">
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ASK_USER Clarification */}
      {ev.stage === "awaiting_clarification" && (
        <div className="border border-sky-300 bg-sky-50 rounded-2xl p-5 mb-6 shadow-sm">
          <div className="font-semibold text-sky-950 mb-1.5">Clarification needed before proceeding</div>
          <p className="text-sm text-sky-900 mb-4">{ev.clarificationQuestion}</p>
          <div className="flex flex-wrap gap-2.5">
            <button
              disabled={deciding}
              onClick={() => clarify("compatible")}
              className="text-sm bg-sky-700 hover:bg-sky-800 text-white font-medium px-4 py-2 rounded-lg disabled:opacity-50 transition-colors shadow-xs cursor-pointer"
            >
              Treat as compatible
            </button>
            <button
              disabled={deciding}
              onClick={() => clarify("violation")}
              className="text-sm bg-neutral-700 hover:bg-neutral-800 text-white font-medium px-4 py-2 rounded-lg disabled:opacity-50 transition-colors shadow-xs cursor-pointer"
            >
              Treat as a violation
            </button>
          </div>
        </div>
      )}

      {/* HITL Approval Gate with BIGGER DRAFT WHITE BOX and PRESETS */}
      {ev.stage === "awaiting_approval" && (
        <div
          className="border-2 border-amber-300 bg-amber-50/90 rounded-2xl p-5 sm:p-6 mb-8 shadow-md"
          id="approval-section"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <div className="font-bold text-amber-950 text-lg flex items-center gap-2">
              <span>🛡️</span>
              <span>Human Approval Gate: Ready to Draft Application</span>
            </div>
            <span className="text-xs bg-amber-200 text-amber-900 font-bold px-2.5 py-1 rounded-full border border-amber-300">
              Awaiting Your Decision
            </span>
          </div>
          <p className="text-xs sm:text-sm text-amber-900 mb-4 leading-relaxed">
            The agent has matched your background and verified hard constraints. Review or customize the drafting instructions in the white box below. The LLM uses these focus points to craft your tailored Cover Letter and rewrite your Resume for a 100% match.
          </p>

          {/* Quick preset buttons to quickly populate/modify instructions */}
          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            <span className="text-xs font-semibold text-amber-950 mr-1">Quick additions:</span>
            <button
              type="button"
              onClick={() =>
                setEditNote((prev) =>
                  prev ? `${prev}\n- Focus heavily on SQL, Postgres, and Python data pipelines` : "- Focus heavily on SQL, Postgres, and Python data pipelines"
                )
              }
              className="text-xs bg-white border border-amber-300 hover:bg-amber-100 text-amber-900 px-2 py-1 rounded-md transition-colors cursor-pointer font-medium"
            >
              + SQL/Python Focus
            </button>
            <button
              type="button"
              onClick={() =>
                setEditNote((prev) =>
                  prev ? `${prev}\n- Highlight leadership and executive reporting experience` : "- Highlight leadership and executive reporting experience"
                )
              }
              className="text-xs bg-white border border-amber-300 hover:bg-amber-100 text-amber-900 px-2 py-1 rounded-md transition-colors cursor-pointer font-medium"
            >
              + Executive Reporting
            </button>
            <button
              type="button"
              onClick={() =>
                setEditNote((prev) =>
                  prev ? `${prev}\n- Quantify measurable impact and efficiency improvements` : "- Quantify measurable impact and efficiency improvements"
                )
              }
              className="text-xs bg-white border border-amber-300 hover:bg-amber-100 text-amber-900 px-2 py-1 rounded-md transition-colors cursor-pointer font-medium"
            >
              + Quantify Impact
            </button>
            <button
              type="button"
              onClick={() => setEditNote(getSmartSuggestions(ev, data.job.title))}
              className="text-xs bg-amber-200/80 hover:bg-amber-200 text-amber-900 px-2 py-1 rounded-md transition-colors cursor-pointer font-medium ml-auto"
            >
              ↺ Reset to Default Suggestions
            </button>
          </div>

          {/* BIGGER WHITE DRAFT INSTRUCTIONS BOX */}
          <div className="mb-4">
            <label className="block text-xs font-bold text-amber-950 mb-1.5">
              Draft Instructions &amp; Custom Focus Points (Editable White Box):
            </label>
            <textarea
              id="draft-instructions-box"
              value={editNote}
              onChange={(e) => setEditNote(e.target.value)}
              placeholder="e.g. Emphasize SQL & Python experience, mention interest in Northbridge Analytics, highlight dashboard projects..."
              className="w-full border-2 border-amber-300 rounded-xl p-4 text-sm sm:text-base leading-relaxed bg-white text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-amber-500 shadow-inner resize-y min-h-[170px]"
              rows={7}
            />
            <div className="flex justify-between text-xs text-amber-800 mt-1">
              <span>These instructions guide the LLM when rewriting your resume and drafting your cover letter.</span>
              <span>{editNote.length} characters</span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              disabled={deciding}
              onClick={() => decide("approve")}
              className="text-sm bg-green-700 hover:bg-green-800 text-white font-bold px-5 py-2.5 rounded-xl disabled:opacity-50 transition-all shadow-sm hover:shadow-md cursor-pointer flex items-center gap-2"
            >
              <span>✓</span>
              <span>Approve &amp; Draft Application</span>
            </button>
            <button
              disabled={deciding}
              onClick={() => decide("edit")}
              className="text-sm bg-blue-700 hover:bg-blue-800 text-white font-bold px-5 py-2.5 rounded-xl disabled:opacity-50 transition-all shadow-sm hover:shadow-md cursor-pointer flex items-center gap-2"
            >
              <span>✏️</span>
              <span>Edit &amp; Draft with My Instructions</span>
            </button>
            <button
              disabled={deciding}
              onClick={() => decide("reject")}
              className="text-sm bg-neutral-600 hover:bg-neutral-700 text-white font-medium px-4 py-2.5 rounded-xl disabled:opacity-50 transition-colors cursor-pointer ml-auto"
            >
              ✕ Reject Job
            </button>
          </div>
        </div>
      )}

      {/* APPLICATION MATERIALS SECTION (DRAFTS) WITH TOGGLES & INTERNAL SCROLL */}
      {hasDraftMaterials && (
        <div className="mb-10" id="materials-section">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-2 border-b border-neutral-200">
            <div>
              <h2 className="text-xl font-bold text-neutral-900">Application Materials</h2>
              <p className="text-xs text-neutral-500">
                AI-drafted and verified against your resume. Click headers or toggle arrows to collapse/expand boxes.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => toggleAllMaterials(true)}
                className="text-xs bg-neutral-100 hover:bg-neutral-200 text-neutral-800 font-medium px-2.5 py-1.5 rounded-lg border border-neutral-300 transition-colors cursor-pointer"
              >
                Expand All
              </button>
              <button
                onClick={() => toggleAllMaterials(false)}
                className="text-xs bg-neutral-100 hover:bg-neutral-200 text-neutral-800 font-medium px-2.5 py-1.5 rounded-lg border border-neutral-300 transition-colors cursor-pointer"
              >
                Collapse All
              </button>
            </div>
          </div>

          {/* 1. Grounded Evidence Bullets Card */}
          {ev.draft && (
            <div className="border border-green-200 bg-green-50/70 rounded-2xl p-4 sm:p-5 mb-5 shadow-xs transition-all">
              <div className="flex items-center justify-between mb-2">
                <div
                  onClick={() => setCollapsedEvidence(!collapsedEvidence)}
                  className="font-bold text-green-950 text-sm sm:text-base flex items-center gap-2 cursor-pointer select-none flex-1"
                >
                  <span
                    className={`inline-block text-xs text-green-700 transition-transform duration-200 ${
                      collapsedEvidence ? "-rotate-90" : "rotate-0"
                    }`}
                  >
                    ▼
                  </span>
                  <span>1. Grounded Evidence (Deterministic Matches)</span>
                </div>
                <div className="flex items-center gap-2">
                  {!collapsedEvidence && (
                    <>
                      <button
                        onClick={() => setFullHeightEvidence(!fullHeightEvidence)}
                        className="text-xs text-green-800 hover:underline font-medium px-1 cursor-pointer hidden sm:inline"
                      >
                        {fullHeightEvidence ? "Scroll Box" : "Full Height"}
                      </button>
                      {editingEvidence ? (
                        <>
                          <button
                            disabled={savingEvidence}
                            onClick={saveEvidence}
                            className="text-xs bg-green-700 hover:bg-green-800 text-white font-medium px-3 py-1 rounded-lg transition-colors cursor-pointer"
                          >
                            {savingEvidence ? "Saving..." : "💾 Save"}
                          </button>
                          <button
                            onClick={() => {
                              setEvidenceText(ev.draft || "");
                              setEditingEvidence(false);
                            }}
                            className="text-xs bg-neutral-200 hover:bg-neutral-300 text-neutral-800 px-2 py-1 rounded-lg transition-colors cursor-pointer"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setEditingEvidence(true)}
                          className="text-xs bg-green-100 hover:bg-green-200 text-green-900 font-medium px-2.5 py-1 rounded-lg border border-green-300 transition-colors cursor-pointer"
                        >
                          ✏️ Edit
                        </button>
                      )}
                    </>
                  )}
                  <button
                    onClick={() => downloadAsPdf(evidenceText, `${safeFilename(data.job.title)}-evidence.pdf`)}
                    className="text-xs bg-white hover:bg-green-100 text-green-900 font-medium px-3 py-1 rounded-lg border border-green-300 transition-colors cursor-pointer"
                  >
                    Download PDF
                  </button>
                  <button
                    onClick={() => copyToClipboard(evidenceText, "evidence")}
                    className="text-xs bg-green-700 hover:bg-green-800 text-white font-medium px-3 py-1 rounded-lg transition-colors cursor-pointer shadow-xs"
                  >
                    {copiedSection === "evidence" ? "✓ Copied" : "Copy"}
                  </button>
                </div>
              </div>

              {!collapsedEvidence && (
                <div className="mt-3">
                  {editingEvidence ? (
                    <textarea
                      value={evidenceText}
                      onChange={(e) => setEvidenceText(e.target.value)}
                      className="w-full border border-green-300 rounded-xl p-3.5 text-xs font-mono bg-white text-neutral-900 leading-relaxed focus:outline-none focus:ring-2 focus:ring-green-500 shadow-inner resize-y min-h-[160px]"
                      rows={8}
                    />
                  ) : (
                    <pre
                      className={`whitespace-pre-wrap text-xs font-mono text-neutral-900 bg-white/90 p-4 rounded-xl border border-green-200/80 shadow-inner ${
                        fullHeightEvidence ? "max-h-none" : "max-h-[320px] overflow-y-auto"
                      }`}
                    >
                      {evidenceText}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 2. Cover Letter Card */}
          {ev.coverLetter && (
            <div className="border border-blue-200 bg-blue-50/70 rounded-2xl p-4 sm:p-5 mb-5 shadow-xs transition-all">
              <div className="flex items-center justify-between mb-2">
                <div
                  onClick={() => setCollapsedCoverLetter(!collapsedCoverLetter)}
                  className="font-bold text-blue-950 text-sm sm:text-base flex items-center gap-2 cursor-pointer select-none flex-1"
                >
                  <span
                    className={`inline-block text-xs text-blue-700 transition-transform duration-200 ${
                      collapsedCoverLetter ? "-rotate-90" : "rotate-0"
                    }`}
                  >
                    ▼
                  </span>
                  <span>2. 📝 Cover Letter (AI-Drafted &amp; Grounded)</span>
                </div>
                <div className="flex items-center gap-2">
                  {!collapsedCoverLetter && (
                    <>
                      <button
                        onClick={() => setFullHeightCoverLetter(!fullHeightCoverLetter)}
                        className="text-xs text-blue-800 hover:underline font-medium px-1 cursor-pointer hidden sm:inline"
                      >
                        {fullHeightCoverLetter ? "Scroll Box" : "Full Height"}
                      </button>
                      {editingCoverLetter ? (
                        <>
                          <button
                            disabled={savingCoverLetter}
                            onClick={saveCoverLetter}
                            className="text-xs bg-blue-700 hover:bg-blue-800 text-white font-medium px-3 py-1 rounded-lg transition-colors cursor-pointer"
                          >
                            {savingCoverLetter ? "Saving..." : "💾 Save"}
                          </button>
                          <button
                            onClick={() => {
                              setCoverLetterText(ev.coverLetter || "");
                              setEditingCoverLetter(false);
                            }}
                            className="text-xs bg-neutral-200 hover:bg-neutral-300 text-neutral-800 px-2 py-1 rounded-lg transition-colors cursor-pointer"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setEditingCoverLetter(true)}
                          className="text-xs bg-blue-100 hover:bg-blue-200 text-blue-900 font-medium px-2.5 py-1 rounded-lg border border-blue-300 transition-colors cursor-pointer"
                        >
                          ✏️ Edit
                        </button>
                      )}
                    </>
                  )}
                  <button
                    onClick={() => downloadAsPdf(coverLetterText, `${safeFilename(data.job.title)}-cover-letter.pdf`, "letter")}
                    className="text-xs bg-white hover:bg-blue-100 text-blue-900 font-medium px-3 py-1 rounded-lg border border-blue-300 transition-colors cursor-pointer"
                  >
                    Download PDF
                  </button>
                  <button
                    onClick={() => copyToClipboard(coverLetterText, "coverLetter")}
                    className="text-xs bg-blue-700 hover:bg-blue-800 text-white font-medium px-3 py-1 rounded-lg transition-colors cursor-pointer shadow-xs"
                  >
                    {copiedSection === "coverLetter" ? "✓ Copied" : "Copy"}
                  </button>
                </div>
              </div>

              {!collapsedCoverLetter && (
                <div className="mt-3">
                  {editingCoverLetter ? (
                    <textarea
                      value={coverLetterText}
                      onChange={(e) => setCoverLetterText(e.target.value)}
                      className="w-full border border-blue-300 rounded-xl p-4 text-sm leading-relaxed bg-white text-neutral-900 font-sans focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-inner resize-y min-h-[260px]"
                      rows={12}
                    />
                  ) : (
                    <div
                      className={`whitespace-pre-wrap text-sm text-neutral-900 leading-relaxed bg-white/90 p-4 sm:p-5 rounded-xl border border-blue-200/80 shadow-inner font-sans ${
                        fullHeightCoverLetter ? "max-h-none" : "max-h-[380px] overflow-y-auto"
                      }`}
                    >
                      {coverLetterText}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 3. Tailored Resume Card */}
          {ev.tailoredResume && (
            <div className="border border-purple-200 bg-purple-50/70 rounded-2xl p-4 sm:p-5 mb-5 shadow-xs transition-all">
              <div className="flex items-center justify-between mb-2">
                <div
                  onClick={() => setCollapsedResume(!collapsedResume)}
                  className="font-bold text-purple-950 text-sm sm:text-base flex items-center gap-2 cursor-pointer select-none flex-1"
                >
                  <span
                    className={`inline-block text-xs text-purple-700 transition-transform duration-200 ${
                      collapsedResume ? "-rotate-90" : "rotate-0"
                    }`}
                  >
                    ▼
                  </span>
                  <span>3. 📄 Tailored Resume (AI-Rewritten for 100% Fit)</span>
                </div>
                <div className="flex items-center gap-2">
                  {!collapsedResume && (
                    <>
                      <button
                        onClick={() => setFullHeightResume(!fullHeightResume)}
                        className="text-xs text-purple-800 hover:underline font-medium px-1 cursor-pointer hidden sm:inline"
                      >
                        {fullHeightResume ? "Scroll Box" : "Full Height"}
                      </button>
                      {editingResume ? (
                        <>
                          <button
                            disabled={savingResume}
                            onClick={saveTailoredResume}
                            className="text-xs bg-purple-700 hover:bg-purple-800 text-white font-medium px-3 py-1 rounded-lg transition-colors cursor-pointer"
                          >
                            {savingResume ? "Saving..." : "💾 Save"}
                          </button>
                          <button
                            onClick={() => {
                              setTailoredResumeText(ev.tailoredResume || "");
                              setEditingResume(false);
                            }}
                            className="text-xs bg-neutral-200 hover:bg-neutral-300 text-neutral-800 px-2 py-1 rounded-lg transition-colors cursor-pointer"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setEditingResume(true)}
                          className="text-xs bg-purple-100 hover:bg-purple-200 text-purple-900 font-medium px-2.5 py-1 rounded-lg border border-purple-300 transition-colors cursor-pointer"
                        >
                          ✏️ Edit
                        </button>
                      )}
                    </>
                  )}
                  <button
                    onClick={() => downloadAsPdf(tailoredResumeText, `${safeFilename(data.job.title)}-tailored-resume.pdf`, "resume")}
                    className="text-xs bg-white hover:bg-purple-100 text-purple-900 font-medium px-3 py-1 rounded-lg border border-purple-300 transition-colors cursor-pointer"
                  >
                    Download PDF
                  </button>
                  <button
                    onClick={() => copyToClipboard(tailoredResumeText, "tailoredResume")}
                    className="text-xs bg-purple-700 hover:bg-purple-800 text-white font-medium px-3 py-1 rounded-lg transition-colors cursor-pointer shadow-xs"
                  >
                    {copiedSection === "tailoredResume" ? "✓ Copied" : "Copy"}
                  </button>
                </div>
              </div>

              {!collapsedResume && (
                <div className="mt-3">
                  {editingResume ? (
                    <textarea
                      value={tailoredResumeText}
                      onChange={(e) => setTailoredResumeText(e.target.value)}
                      className="w-full border border-purple-300 rounded-xl p-4 text-xs font-mono bg-white text-neutral-900 leading-relaxed focus:outline-none focus:ring-2 focus:ring-purple-500 shadow-inner resize-y min-h-[350px]"
                      rows={16}
                    />
                  ) : (
                    <pre
                      className={`whitespace-pre-wrap text-xs font-mono text-neutral-900 bg-white/90 p-4 sm:p-5 rounded-xl border border-purple-200/80 shadow-inner ${
                        fullHeightResume ? "max-h-none" : "max-h-[420px] overflow-y-auto"
                      }`}
                    >
                      {tailoredResumeText}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Decision Trace with toggle arrow */}
      <div className="border border-neutral-200 bg-white rounded-2xl p-4 sm:p-5 mb-5 shadow-xs" id="trace-section">
        <div
          onClick={() => setCollapsedTrace(!collapsedTrace)}
          className="flex items-center justify-between cursor-pointer select-none"
        >
          <div className="font-bold text-neutral-900 text-sm sm:text-base flex items-center gap-2">
            <span
              className={`inline-block text-xs text-neutral-500 transition-transform duration-200 ${
                collapsedTrace ? "-rotate-90" : "rotate-0"
              }`}
            >
              ▼
            </span>
            <span>Agent Decision Trace ({ev.trace.length} verified steps)</span>
          </div>
          <span className="text-xs text-neutral-600 hover:underline font-medium">
            {collapsedTrace ? "Show Trace" : "Hide Trace"}
          </span>
        </div>

        {!collapsedTrace && (
          <div className="space-y-3 mt-4 max-h-[460px] overflow-y-auto pr-1">
            {ev.trace.map((t) => (
              <div key={t.step} className="border border-neutral-200 bg-neutral-50/70 rounded-xl p-3.5 text-xs">
                <div className="font-mono font-bold text-neutral-900 mb-1 flex items-center justify-between">
                  <span>Step {t.step}: {t.selectedAction}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 mb-1 text-neutral-600">
                  <div><span className="text-neutral-400">Before:</span> {t.stateBefore.stage}</div>
                  <div><span className="text-neutral-400">After:</span> {t.stateAfter.stage}</div>
                </div>
                <div className="mt-1 text-neutral-700">
                  <span className="text-neutral-400 font-mono">observation:</span> {t.observation}
                </div>
                <div className="mt-1 text-neutral-700">
                  <span className="text-neutral-400 font-mono">result:</span> {t.result}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Raw posting text with toggle arrow */}
      <div className="border border-neutral-200 bg-white rounded-2xl p-4 sm:p-5 shadow-xs" id="raw-posting">
        <div
          onClick={() => setCollapsedRawText(!collapsedRawText)}
          className="flex items-center justify-between cursor-pointer select-none"
        >
          <div className="font-semibold text-neutral-800 text-sm flex items-center gap-2">
            <span
              className={`inline-block text-xs text-neutral-500 transition-transform duration-200 ${
                collapsedRawText ? "-rotate-90" : "rotate-0"
              }`}
            >
              ▼
            </span>
            <span>Raw Job Posting Text</span>
          </div>
          <span className="text-xs text-neutral-600 hover:underline font-medium">
            {collapsedRawText ? "Show" : "Hide"}
          </span>
        </div>
        {!collapsedRawText && (
          <pre className="whitespace-pre-wrap text-xs font-mono mt-3 border border-neutral-200 bg-neutral-50 p-4 rounded-xl text-neutral-800 max-h-[350px] overflow-y-auto">
            {data.job.rawText}
          </pre>
        )}
      </div>

      {/* Floating Scroll to Top Button */}
      {showScrollTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-6 right-6 z-40 bg-neutral-900/90 hover:bg-neutral-900 text-white w-11 h-11 rounded-full flex items-center justify-center shadow-lg border border-neutral-700 transition-all cursor-pointer"
          title="Scroll to top"
        >
          ↑
        </button>
      )}
    </div>
  );
}
