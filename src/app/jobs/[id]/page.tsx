"use client";

import { useEffect, useState, use as usePromise } from "react";
import { renderMarkdownPdf, type PdfKind } from "@/lib/pdfRender";
import VerificationPanel from "@/components/VerificationPanel";

type TraceStep = {
  step: number;
  stateBefore: any;
  observation: string;
  availableActions: string[];
  selectedAction: string;
  result: string;
  stateAfter: any;
  chosenBy?: "model" | "harness" | "policy";
  modelReasoning?: string;
  overruled?: string;
  brain?: "ai" | "code";
  thinking?: string;
  guidelines?: string;
};

type Advice = {
  source: "model" | "policy";
  mode: "approval" | "rejected_low_fit" | "clarification";
  headline: string;
  recommendation: string;
  recommendationWhy: string;
  strengths: { requirement: string; evidenceQuote: string }[];
  rankedGaps: { gap: string; importance: "critical" | "helpful" | "minor" | "unranked"; why: string; bridgeQuestion: string }[];
  draftPresets: { label: string; instruction: string; evidenceQuote: string }[];
  overruled?: string;
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
  missingPreferredSkills: string[];
  matchStrength: Record<string, "full" | "partial">;
  draftVerification: DraftVerification | null;
  coverLetterVerification: DraftVerification | null;
  minFit: number | null;
  lowConfidence: boolean;
  requirementCount: number | null;
  rescore: {
    before: number;
    after: number;
    newlyMatched: string[];
    unearned: string[];
    stillMissing: string[];
    method: string;
    comparable?: boolean;
    requirementsCompared?: number;
  } | null;
  state?: { matchedEvidence?: Record<string, string>; advice?: Advice | null; guidelines?: string } | null;
  profileName: string | null;
  trace: TraceStep[];
};

type VerifiedClaim = {
  id: number;
  text: string;
  verdict:
    | "structural"
    | "grounded"
    | "reworded"
    | "from_your_note"
    | "disclaimed"
    | "subjective"
    | "unsupported";
  score: number;
  provenance: string;
  sourceQuote: string | null;
  unsupportedFacts: string[];
  reason: string;
};

type DraftVerification = {
  method: string;
  checkedAt: string;
  totals: {
    claims: number;
    grounded: number;
    reworded: number;
    fromNote: number;
    disclaimed: number;
    subjective: number;
    unsupported: number;
  };
  claims: VerifiedClaim[];
  droppedFromOriginal: string[];
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
  const [overrideReason, setOverrideReason] = useState("");
  const [overriding, setOverriding] = useState(false);
  // Which gaps the human has already pushed into the draft instructions, so the
  // button can grey out instead of silently adding the same line twice.
  const [addedSkills, setAddedSkills] = useState<string[]>([]);

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
    // The AI advisor's tailored presets come first; the old derived text is only a fallback.
    const advised = ev.state?.advice?.draftPresets ?? [];
    if (advised.length > 0) return advised.slice(0, 3).map((p) => p.instruction).join("\n");
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

  // Human overrules the agent's automatic low-fit rejection. The agent's verdict and
  // score are unchanged; this only reopens the job at the approval gate and records
  // who made that call.
  async function applyAnyway() {
    setOverriding(true);
    try {
      const res = await fetch("/api/agent/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: id, reason: overrideReason.trim() || null }),
      });
      if (!res.ok) {
        const d = await res.json();
        window.alert(d.error ?? "Could not reopen this job.");
        return;
      }
      await load();
      triggerToast("Reopened — the decision is yours now.");
      document.getElementById("approval-section")?.scrollIntoView({ behavior: "smooth" });
    } finally {
      setOverriding(false);
    }
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

  function addMissingSkillToDraft(skill: string, bridgeQuestion?: string) {
    setAddedSkills((prev) => (prev.includes(skill) ? prev : [...prev, skill]));
    const addition = `- Experience with ${skill} (or equivalent): [answer honestly, then delete these brackets — ${bridgeQuestion ?? "describe your hands-on work or similar tool/project"}]`;
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


  // The agent's own words: what its advisor thinks, why, and what it recommends you do.
  function AdvicePanel({ a, tone }: { a: Advice; tone: "amber" | "sky" | "neutral" }) {
    const fromAi = a.source === "model";
    const rec: Record<string, string> = {
      approve: "Approve and draft",
      edit: "Approve with instructions (bridge the gaps first)",
      reject: "Reject / leave it",
      override: "Apply anyway",
      answer_compatible: "Treat as compatible",
      answer_violation: "Treat as a violation",
      none: "No recommendation",
    };
    return (
      <div className={`rounded-xl border p-3.5 mb-4 bg-white ${tone === "sky" ? "border-sky-300" : tone === "amber" ? "border-amber-300" : "border-neutral-300"}`}>
        <div className="flex flex-wrap items-center gap-2 mb-1.5">
          <span className="font-bold text-neutral-900 text-sm">🧠 The agent&apos;s recommendation</span>
          <span
            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${fromAi ? "bg-indigo-100 text-indigo-800" : "bg-amber-100 text-amber-800"}`}
            title={fromAi ? "Written by the AI advisor for this résumé and this job" : "No AI available: filled by the built-in default policy"}
          >
            {fromAi ? "AI advisor" : "default policy (no AI)"}
          </span>
        </div>
        <p className="text-sm text-neutral-900 leading-relaxed">{a.headline}</p>
        {a.recommendation !== "none" && (
          <p className="text-sm mt-1.5">
            <span className="font-semibold text-indigo-900">Recommends: {rec[a.recommendation] ?? a.recommendation}.</span>{" "}
            <span className="text-neutral-700">{a.recommendationWhy}</span>
          </p>
        )}
        {a.strengths.length > 0 && (
          <div className="mt-2">
            <p className="text-xs font-semibold text-neutral-600 mb-1">Strengths it would lead with (each backed by your résumé):</p>
            <ul className="text-xs text-neutral-700 space-y-1">
              {a.strengths.map((st, i) => (
                <li key={i}>
                  <span className="font-medium">{st.requirement}</span>
                  <span className="text-neutral-500"> — “{st.evidenceQuote}”</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {a.overruled && <p className="text-[11px] text-red-700 mt-2">Harness note: {a.overruled}.</p>}
      </div>
    );
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

  // Gaps ordered by how badly this employer needs them: hard requirements first,
  // "nice to have" after. That ordering is what tells you where to spend your effort.
  const preferredSet = new Set((ev.missingPreferredSkills ?? []).map((s) => s.toLowerCase()));
  const advice = ev.state?.advice ?? null;
  const advisedGap = (skill: string) =>
    advice?.rankedGaps.find((g) => g.gap.trim().toLowerCase() === skill.trim().toLowerCase());
  const IMPORTANCE_ORDER: Record<string, number> = { critical: 0, helpful: 1, minor: 2, unranked: 3 };
  const rankedMissing = ev.missingSkills
    .map((skill) => ({ skill, required: !preferredSet.has(skill.toLowerCase()), advised: advisedGap(skill) }))
    .sort((a, b) =>
      advice && advice.source === "model"
        ? (IMPORTANCE_ORDER[a.advised?.importance ?? "unranked"] ?? 3) - (IMPORTANCE_ORDER[b.advised?.importance ?? "unranked"] ?? 3)
        : Number(b.required) - Number(a.required)
    );

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
              Writing the cover letter and re-tailoring your resume from resume.md, then verifying every claim against it (~10–20s).
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
              {ev.fitScore === null ? "Skills check skipped (a hard rule already decided this)" : ev.fitMethod === "llm" ? "LLM semantic matching" : "Deterministic keyword matching"}
            </strong>
          </span>
        </div>
      </div>

      {ev.lowConfidence && (
        <div className="border-2 border-orange-300 bg-orange-50 rounded-2xl p-4 mb-5 shadow-xs">
          <p className="font-bold text-sm text-orange-900">
            Treat this percentage as unreliable
          </p>
          <p className="text-xs text-orange-900 mt-1 leading-relaxed">
            Only {ev.requirementCount ?? 0} requirement
            {(ev.requirementCount ?? 0) === 1 ? "" : "s"} could be read out of this posting,
            so the score is arithmetically fine but practically meaningless — one match out
            of one reads as 100%. Usually this means the posting was truncated, is mostly
            boilerplate, or the scrape only captured the header. Scroll down to
            &ldquo;Raw posting text&rdquo; and check what the agent actually received; if
            it is incomplete, paste the full description instead.
          </p>
        </div>
      )}

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
            Each one backed by a word-for-word quote from your resume.{" "}
            <span className="text-amber-700 font-medium">Partial</span> means you have it
            at internship, coursework or &quot;basics&quot; level — it counts for half.
          </p>

          {ev.matchedSkills.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {ev.matchedSkills.map((skill) => {
                const partial = ev.matchStrength?.[skill] === "partial";
                return (
                  <span
                    key={skill}
                    title={ev.state?.matchedEvidence?.[skill] ?? undefined}
                    className={`text-xs px-2 py-1 rounded-lg border ${
                      partial
                        ? "bg-amber-50 text-amber-900 border-amber-300"
                        : "bg-green-50 text-green-900 border-green-300"
                    }`}
                  >
                    {skill}
                    {partial && <span className="ml-1 font-semibold">(partial)</span>}
                  </span>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-neutral-500 italic mb-3">{ev.fitScore === null ? "Not evaluated: the agent chose to skip the skills check because a hard rule already decided this job." : "No direct keyword skill matches detected."}</p>
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
            Ranked by how much this employer actually needs it.{" "}
            <span className="text-red-700 font-semibold">Red = required</span>, close these
            first.{" "}
            <span className="text-amber-700 font-semibold">Amber = nice to have</span>.
          </p>

          {ev.missingSkills.length > 0 ? (
            <ul className="divide-y divide-neutral-100 mb-3">
              {rankedMissing.map(({ skill, required, advised }, idx) => {
                const gapNote = ev.gapNotes?.find(
                  (g) => g.skill.trim().toLowerCase() === skill.trim().toLowerCase()
                );
                const added = addedSkills.includes(skill);
                return (
                  <li key={idx} className="py-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span
                        className={`inline-block w-1.5 h-1.5 rounded-full mr-2 align-middle ${
                          required ? "bg-red-600" : "bg-amber-500"
                        }`}
                      />
                      <span
                        className={`text-sm font-medium ${
                          required ? "text-red-900" : "text-amber-900"
                        }`}
                      >
                        {skill}
                      </span>
                      <span
                        className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded border font-semibold ${
                          required
                            ? "bg-red-50 text-red-800 border-red-300"
                            : "bg-amber-50 text-amber-800 border-amber-300"
                        }`}
                      >
                        {required ? "required" : "nice to have"}
                      </span>
                      {advice?.source === "model" && advised && advised.importance !== "unranked" && (
                        <span
                          className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded border font-semibold ${
                            advised.importance === "critical"
                              ? "bg-red-600 text-white border-red-700"
                              : advised.importance === "helpful"
                              ? "bg-indigo-50 text-indigo-800 border-indigo-300"
                              : "bg-neutral-100 text-neutral-600 border-neutral-300"
                          }`}
                          title="Ranked by the AI advisor"
                        >
                          AI: {advised.importance}
                        </span>
                      )}
                      {advice?.source === "model" && advised?.why && (
                        <p className="text-xs text-indigo-800 mt-0.5">🧠 {advised.why}</p>
                      )}
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
                        disabled={added}
                        onClick={() => addMissingSkillToDraft(skill, advised?.bridgeQuestion)}
                        className={`text-xs whitespace-nowrap shrink-0 px-2 py-1 rounded-lg border ${
                          added
                            ? "bg-neutral-100 text-neutral-400 border-neutral-200 cursor-not-allowed"
                            : "bg-white text-amber-800 border-amber-300 hover:bg-amber-50 cursor-pointer"
                        }`}
                        title={
                          added
                            ? "Already added to your draft instructions below"
                            : "Add to draft instructions to explain equivalent experience"
                        }
                      >
                        {added ? "✓ Added" : "+ I have this or similar"}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-neutral-500 mb-3">{ev.fitScore === null ? "Not evaluated: the skills check was skipped, so nothing is known about skill gaps for this job." : "No missing skills identified — full coverage."}</p>
          )}

          {/* Quick custom skill bridge input */}
          {ev.stage === "awaiting_approval" && ev.missingSkills.length > 0 && (
            <div className="mt-auto pt-3 border-t border-neutral-100">
              <label className="block text-xs font-medium text-neutral-700 mb-1">
                Have a similar skill or equivalent tool?
              </label>
              <div className="flex flex-wrap gap-2">
                <input
                  value={customSkillInput}
                  onChange={(e) => setCustomSkillInput(e.target.value)}
                  placeholder="e.g. I have 2 yrs MySQL & Snowflake which is similar to Postgres..."
                  className="flex-1 min-w-0 border border-neutral-300 rounded-lg px-3 py-1.5 text-xs bg-white text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-400"
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
          {advice && <AdvicePanel a={advice} tone="sky" />}
          <div className="flex flex-wrap gap-2.5">
            <button
              disabled={deciding}
              onClick={() => clarify("compatible")}
              className="text-sm bg-sky-700 hover:bg-sky-800 text-white font-medium px-4 py-2 rounded-lg disabled:opacity-50 transition-colors shadow-xs cursor-pointer"
            >
              Treat as compatible{advice?.recommendation === "answer_compatible" ? "  (agent recommends)" : ""}
            </button>
            <button
              disabled={deciding}
              onClick={() => clarify("violation")}
              className="text-sm bg-neutral-700 hover:bg-neutral-800 text-white font-medium px-4 py-2 rounded-lg disabled:opacity-50 transition-colors shadow-xs cursor-pointer"
            >
              Treat as a violation{advice?.recommendation === "answer_violation" ? "  (agent recommends)" : ""}
            </button>
          </div>
        </div>
      )}

      {/* Human override of the agent's own low-fit auto-rejection.
          The agent still rejected it on its own — that branch is untouched. This is a
          separate human decision taken afterwards, recorded as its own trace step. */}
      {ev.stage === "rejected_low_fit" && (
        <div className="border-2 border-neutral-300 bg-white rounded-2xl p-5 sm:p-6 mb-8 shadow-md">
          <div className="font-bold text-neutral-900 text-base sm:text-lg mb-1">
            The agent ruled this out — but you get the final say
          </div>
          <p className="text-sm text-neutral-700 leading-relaxed mb-3">
            It scored{" "}
            <strong>{Math.round((ev.fitScore ?? 0) * 100)}%</strong>, under your{" "}
            <strong>{Math.round((ev.minFit ?? 0.6) * 100)}%</strong> bar, so it was
            auto-rejected without drafting anything. A score is a screening shortcut, not
            a verdict on you — if you have internship, coursework or adjacent experience
            that closes these gaps, say so and carry on.
          </p>

          {advice && <AdvicePanel a={advice} tone="neutral" />}

          {ev.missingSkills.length > 0 && (
            <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-3 mb-3">
              <p className="text-xs font-semibold text-neutral-700 mb-1.5">
                What it says you are missing{advice?.source === "model" ? " (ranked by the AI advisor)" : ""}:
              </p>
              <p className="text-sm text-neutral-800">
                {rankedMissing.map((m) => m.skill).join(" · ")}
              </p>
            </div>
          )}

          <label className="block text-sm font-semibold text-neutral-800 mb-1.5">
            Why you want it anyway (optional — this is passed to the draft)
          </label>
          <textarea
            value={overrideReason}
            onChange={(e) => setOverrideReason(e.target.value)}
            placeholder={
              ev.missingSkills.length
                ? `e.g. I used ${ev.missingSkills[0]} in a university capstone project, and the rest of the role matches what I do now.`
                : "e.g. I have adjacent experience that the posting does not name."
            }
            className="w-full border border-neutral-300 rounded-xl p-3 text-sm bg-white text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-800 shadow-inner resize-y min-h-[90px] mb-3"
          />

          <button
            disabled={overriding}
            onClick={applyAnyway}
            className="text-sm bg-neutral-900 hover:bg-neutral-800 text-white font-bold px-5 py-2.5 rounded-xl disabled:opacity-50 transition-all shadow-sm cursor-pointer"
          >
            {overriding ? "Reopening…" : "Apply anyway — I'll bridge the gaps"}
            {advice?.recommendation === "override" ? "  (agent recommends)" : ""}
          </button>
          <p className="text-xs text-neutral-500 mt-2">
            This does not change the score or hide the gaps. It reopens the job at the
            approval gate and records in the decision trace that <em>you</em> overrode the
            agent, not that the agent changed its mind.
          </p>
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
            The agent has matched your background and verified hard constraints. Review or customize the drafting instructions in the white box below. The LLM uses these focus points to write a cover letter and re-tailor your resume. Every factual claim it produces is then checked back against your resume, and anything it cannot trace is flagged for you — never silently removed.
          </p>

          {advice && <AdvicePanel a={advice} tone="amber" />}

          {/* Presets come from the AI advisor: tailored to THIS résumé and THIS job, each backed by a
              résumé quote. They are never fixed text. */}
          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            <span className="text-xs font-semibold text-amber-950 mr-1">
              {advice?.source === "model" ? "AI-recommended additions:" : "Suggested additions (default, no AI):"}
            </span>
            {(advice?.draftPresets ?? []).map((pr, i) => (
              <button
                key={i}
                type="button"
                title={`Backed by your résumé: “${pr.evidenceQuote}”`}
                onClick={() => setEditNote((prev) => (prev ? `${prev}\n${pr.instruction}` : pr.instruction))}
                className="text-xs bg-white border border-indigo-300 hover:bg-indigo-50 text-indigo-900 px-2 py-1 rounded-md transition-colors cursor-pointer font-medium"
              >
                + {pr.label}
              </button>
            ))}
            {(advice?.draftPresets ?? []).length === 0 && (
              <span className="text-xs text-amber-900">Nothing to suggest yet: no matched evidence to build on.</span>
            )}
            <button
              type="button"
              onClick={() => setEditNote(getSmartSuggestions(ev, data.job.title))}
              className="text-xs bg-amber-200/80 hover:bg-amber-200 text-amber-900 px-2 py-1 rounded-md transition-colors cursor-pointer font-medium ml-auto"
            >
              ↺ Reset to the agent&apos;s suggestion
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

          {/* Action buttons.
              The two drafting buttons differ in ONE way: whether the box above is sent
              to the model. That was previously invisible — both looked like "draft it",
              the box came pre-filled, and the green one silently threw the text away.
              The labels now say which is which, and the green one only offers to ignore
              the box when there is actually something in it. */}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              disabled={deciding}
              onClick={() => decide("edit")}
              className="text-sm bg-green-700 hover:bg-green-800 text-white font-bold px-5 py-2.5 rounded-xl disabled:opacity-50 transition-all shadow-sm hover:shadow-md cursor-pointer flex items-center gap-2"
            >
              <span>✓</span>
              <span>
                {editNote.trim()
                  ? "Approve — use the instructions above"
                  : "Approve & Draft Application"}
              </span>
              {advice && (advice.recommendation === "approve" || advice.recommendation === "edit") && (
                <span className="text-[10px] bg-white/25 px-1.5 py-0.5 rounded-full font-semibold">agent recommends</span>
              )}
            </button>
            {editNote.trim() && (
              <button
                disabled={deciding}
                onClick={() => decide("approve")}
                title="Drafts from your resume and the posting only. The text in the box above is not sent to the model."
                className="text-sm bg-white hover:bg-neutral-100 text-neutral-800 font-semibold px-4 py-2.5 rounded-xl border border-neutral-400 disabled:opacity-50 transition-all cursor-pointer flex items-center gap-2"
              >
                <span>Approve — ignore my instructions</span>
              </button>
            )}
            <button
              disabled={deciding}
              onClick={() => decide("reject")}
              className="text-sm bg-neutral-600 hover:bg-neutral-700 text-white font-medium px-4 py-2.5 rounded-xl disabled:opacity-50 transition-colors cursor-pointer ml-auto"
            >
              ✕ Reject Job{advice?.recommendation === "reject" ? "  (agent recommends)" : ""}
            </button>
          </div>
          <p className="text-xs text-amber-900/80 mt-2">
            {editNote.trim()
              ? "The green button sends the box above to the model as drafting guidance. The plain button drafts from your resume alone."
              : "Nothing is drafted until you click. Add instructions above to steer the draft, or approve to draft straight from your resume."}
          </p>
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

          {/* Verification receipts for the cover letter */}
          {ev.coverLetter && ev.coverLetterVerification && (
            <VerificationPanel
              verification={ev.coverLetterVerification}
              title="Cover letter"
              accent="blue"
            />
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

          {/* The agent marking its own work: same evaluation, re-run on the rewrite. */}
          {ev.rescore && (
            <div
              className={`border-2 rounded-2xl p-4 sm:p-5 mb-4 shadow-xs ${
                ev.rescore.unearned.length > 0
                  ? "border-red-300 bg-red-50/70"
                  : ev.rescore.after > ev.rescore.before
                  ? "border-green-300 bg-green-50/70"
                  : "border-neutral-300 bg-white"
              }`}
            >
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="font-bold text-sm text-neutral-900">
                  Agent re-checked its own rewrite
                </span>
                <span className="text-[10px] font-mono bg-neutral-900 text-white px-1.5 py-0.5 rounded">
                  rescore_tailored_resume
                </span>
              </div>

              {ev.rescore.comparable === false && (
                <div className="bg-white border border-orange-300 rounded-xl p-3 mb-3">
                  <p className="text-sm font-bold text-orange-900">
                    Comparison withheld — it would not be meaningful
                  </p>
                  <p className="text-xs text-orange-900 mt-1">
                    The re-check did not produce the same list of requirements as the
                    original evaluation, so the two percentages were measured against
                    different things and the difference between them would be noise
                    rather than a result. Your draft and its verification below are
                    unaffected.
                  </p>
                </div>
              )}

              <div className="flex items-center gap-3 mb-3 flex-wrap">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs text-neutral-500">Original resume</span>
                  <span className="text-2xl font-bold text-neutral-500">
                    {Math.round(ev.rescore.before * 100)}%
                  </span>
                </div>
                <span className="text-xl text-neutral-400">&rarr;</span>
                <div className="flex items-baseline gap-2">
                  <span className="text-xs text-neutral-500">Tailored resume</span>
                  <span
                    className={`text-3xl font-bold ${
                      ev.rescore.after > ev.rescore.before
                        ? "text-green-700"
                        : ev.rescore.after < ev.rescore.before
                        ? "text-red-700"
                        : "text-neutral-700"
                    }`}
                  >
                    {Math.round(ev.rescore.after * 100)}%
                  </span>
                </div>
                {ev.rescore.comparable !== false && (
                  <span
                    className={`text-sm font-bold px-2 py-0.5 rounded-lg border ${
                      ev.rescore.after >= ev.rescore.before
                        ? "bg-green-100 text-green-900 border-green-300"
                        : "bg-red-100 text-red-900 border-red-300"
                    }`}
                  >
                    {ev.rescore.after >= ev.rescore.before ? "+" : ""}
                    {Math.round((ev.rescore.after - ev.rescore.before) * 100)} pts
                  </span>
                )}
              </div>

              {ev.rescore.newlyMatched.length > 0 ? (
                <p className="text-sm text-neutral-800 mb-2">
                  <span className="font-semibold text-green-800">Now evidenced: </span>
                  {ev.rescore.newlyMatched.join(" · ")}
                </p>
              ) : (
                <p className="text-sm text-neutral-700 mb-2">
                  No previously-missing requirement is now evidenced. The rewrite improved
                  emphasis and wording rather than coverage &mdash; which is the honest
                  outcome when the underlying experience has not changed.
                </p>
              )}

              {ev.rescore.unearned.length > 0 && (
                <div className="bg-white border border-red-300 rounded-xl p-3 mb-2">
                  <p className="text-sm font-bold text-red-900">
                    &#9888; Part of this gain is unearned
                  </p>
                  <p className="text-xs text-red-800 mt-1">
                    <strong>{ev.rescore.unearned.join(", ")}</strong> only counts because of
                    a sentence the verifier could not trace back to your resume. Do not
                    treat that as a real improvement &mdash; fix or remove the flagged line
                    above, and this score will fall back.
                  </p>
                </div>
              )}

              {ev.rescore.stillMissing.length > 0 && (
                <p className="text-xs text-neutral-600">
                  <span className="font-semibold">Still missing: </span>
                  {ev.rescore.stillMissing.join(" · ")}
                </p>
              )}

              <p className="text-xs text-neutral-500 mt-2 pt-2 border-t border-neutral-200">
                Both numbers are scored against the same{" "}
                {ev.rescore.requirementsCompared ?? 0} requirement
                {(ev.rescore.requirementsCompared ?? 0) === 1 ? "" : "s"} the original
                evaluation found, so the difference can only come from the rewrite.
                Rewriting cannot invent experience, so no change at all is a normal and
                honest result.
              </p>
            </div>
          )}

          {/* Verification receipts for the tailored resume — rendered ABOVE the draft
              so the human sees what to check before they read the polished version. */}
          {ev.tailoredResume && ev.draftVerification && (
            <VerificationPanel
              verification={ev.draftVerification}
              title="Tailored resume"
              accent="purple"
            />
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
                  <span>3. 📄 Tailored Resume (rewritten from YOUR resume for this role)</span>
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
                  {t.brain && (
                    <span
                      className={`text-[10px] font-sans font-semibold px-2 py-0.5 rounded-full mr-1 ${
                        t.brain === "ai" ? "bg-indigo-600 text-white" : "bg-neutral-300 text-neutral-800"
                      }`}
                      title={t.brain === "ai" ? "An AI produced this step's output" : "A deterministic code rule produced this step (no AI)"}
                    >
                      {t.brain === "ai" ? "🧠 AI thinking" : "⚙ code rule"}
                    </span>
                  )}
                  {t.chosenBy && (
                    <span
                      className={`text-[10px] font-sans font-semibold px-2 py-0.5 rounded-full ${
                        t.chosenBy === "model"
                          ? "bg-indigo-100 text-indigo-800"
                          : t.chosenBy === "harness"
                          ? "bg-neutral-200 text-neutral-700"
                          : "bg-amber-100 text-amber-800"
                      }`}
                      title={
                        t.chosenBy === "model"
                          ? "The AI controller chose this from the actions the harness permitted"
                          : t.chosenBy === "harness"
                          ? "Only one action was permitted here, so a guardrail decided"
                          : "The built-in policy chose (no AI controller, or it failed / proposed a forbidden action)"
                      }
                    >
                      {t.chosenBy === "model" ? "AI chose" : t.chosenBy === "harness" ? "guardrail" : "default policy"}
                    </span>
                  )}
                </div>
                {t.availableActions.length > 1 && (
                  <div className="text-neutral-500 mb-1">
                    <span className="text-neutral-400 font-mono">permitted:</span> {t.availableActions.join(" | ")}
                  </div>
                )}
                {(t.thinking || t.modelReasoning) && (
                  <div className="text-indigo-900 bg-indigo-50 border border-indigo-200 rounded-lg px-2.5 py-1.5 mb-1.5 whitespace-pre-line">
                    <span className="text-indigo-500 font-mono">agent&apos;s thinking:</span> {t.thinking || t.modelReasoning}
                  </div>
                )}
                {t.overruled && (
                  <div className="text-red-700 mb-1">
                    <span className="font-mono">harness overruled:</span> {t.overruled}
                  </div>
                )}
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
