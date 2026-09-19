"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type TraceStep = {
  step: number;
  selectedAction: string;
  observation: string;
  result: string;
  availableActions: string[];
};

// Plain-English label per action, so the feed reads like a decision rather than a log.
const ACTION_LABEL: Record<string, string> = {
  scan_for_injection: "Checking the posting for hidden instructions",
  flag_injection_and_continue: "Injection found — refusing it and carrying on",
  evaluate_fit: "Matching your resume against the requirements",
  check_hard_constraints: "Checking your hard rules",
  ask_user_clarification: "It needs to ask you something",
  reject_low_fit: "Auto-rejected — too few requirements met",
  reject_hard_constraint: "Auto-rejected — one of your hard rules",
  request_human_approval: "Paused — your decision",
};

export default function NewJobPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"paste" | "url">("paste");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [rawText, setRawText] = useState("");
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [scraping, setScraping] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [replay, setReplay] = useState<TraceStep[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function handleScrape() {
    setError(null);
    setScraping(true);
    try {
      const res = await fetch("/api/jobs/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Scrape failed.");
        setMode("paste");
        return;
      }
      setTitle(data.title);
      setRawText(data.text);
      setSourceUrl(data.sourceUrl);
      setMode("paste"); // let them review/edit the extracted text before submitting
    } catch (e) {
      setError("Network error reaching that URL. Paste the posting text instead.");
      setMode("paste");
    } finally {
      setScraping(false);
    }
  }

  async function handleSubmit() {
    setError(null);
    if (!rawText.trim()) {
      setError("Paste or scrape some posting text first.");
      return;
    }
    setSubmitting(true);
    setReplay([]);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title || "Untitled posting",
          rawText,
          sourceUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to evaluate posting.");
        return;
      }
      // Replay the agent's decision trace step by step before navigating. The text is
      // exactly what the job page's "Agent Decision Trace" shows - same steps, same
      // wording - just surfaced as a running feed instead of a collapsed block, so you
      // can see which path the agent actually took while the result lands.
      const steps: TraceStep[] = data.evaluation?.trace ?? [];
      if (steps.length) {
        setSubmitting(false);
        setReplay([]);
        for (const step of steps) {
          setReplay((prev) => [...prev, step]);
          await new Promise((r) => setTimeout(r, 420));
        }
        await new Promise((r) => setTimeout(r, 700));
      }
      router.push(`/jobs/${data.id}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="w-full max-w-4xl mx-auto pb-16 font-sans">
      <h1 className="text-2xl font-bold text-neutral-900 mb-1">Add a Job Posting</h1>
      <p className="text-sm text-neutral-600 mb-5">
        Scrape a URL or paste the posting text. The agent treats this content strictly as{" "}
        <strong>data to evaluate</strong>, immune to prompt injections.
      </p>

      <div className="flex gap-2 mb-5">
        <button
          type="button"
          onClick={() => setMode("paste")}
          className={`text-sm font-medium px-4 py-2 rounded-xl border transition-colors cursor-pointer ${
            mode === "paste"
              ? "bg-neutral-900 text-white border-neutral-900 shadow-xs"
              : "bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50"
          }`}
        >
          Paste Text
        </button>
        <button
          type="button"
          onClick={() => setMode("url")}
          className={`text-sm font-medium px-4 py-2 rounded-xl border transition-colors cursor-pointer ${
            mode === "url"
              ? "bg-neutral-900 text-white border-neutral-900 shadow-xs"
              : "bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50"
          }`}
        >
          Scrape from URL
        </button>
      </div>

      {mode === "url" && (
        <div className="mb-5 border border-neutral-200 bg-white rounded-2xl p-5 shadow-xs">
          <label className="block text-sm font-semibold text-neutral-800 mb-1.5">Posting URL</label>
          <div className="flex gap-2.5">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://company.com/careers/data-analyst"
              className="flex-1 border border-neutral-300 rounded-xl px-4 py-2.5 text-sm bg-white text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-800"
            />
            <button
              type="button"
              onClick={handleScrape}
              disabled={scraping || !url.trim()}
              className="text-sm font-medium bg-neutral-900 text-white px-5 py-2.5 rounded-xl disabled:opacity-50 hover:bg-neutral-800 transition-colors cursor-pointer"
            >
              {scraping ? "Fetching…" : "Fetch Posting"}
            </button>
          </div>
          <p className="text-xs text-neutral-500 mt-2">
            Many job boards (LinkedIn, Indeed, login portals) block automated fetches. If a fetch fails, paste the text directly instead.
          </p>
        </div>
      )}

      {mode === "paste" && (
        <div className="space-y-4 mb-5 border border-neutral-200 bg-white rounded-2xl p-5 sm:p-6 shadow-xs">
          <div>
            <label className="block text-sm font-semibold text-neutral-800 mb-1.5">Job Title (optional)</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Senior Data Analyst @ Acme Corp"
              className="w-full border border-neutral-300 rounded-xl px-4 py-2.5 text-sm bg-white text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-800"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-neutral-800 mb-1.5">Full Job Posting Text</label>
            <textarea
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              rows={16}
              placeholder="Paste the full job posting description and requirements here…"
              className="w-full border border-neutral-300 rounded-xl p-4 text-xs sm:text-sm font-mono bg-white text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-800 shadow-inner resize-y min-h-[280px]"
            />
            <div className="flex justify-between text-xs text-neutral-400 mt-1">
              <span>Paste the complete job description including qualifications and constraints</span>
              <span>{rawText.length} characters</span>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3.5 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 font-medium">
          {error}
        </div>
      )}

      {(submitting || replay.length > 0) && (
        <div className="border border-neutral-300 bg-neutral-900 text-neutral-100 rounded-2xl p-4 sm:p-5 mb-4 shadow-md font-mono">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs uppercase tracking-widest text-neutral-400">
              Agent working
            </span>
            <span className="text-xs text-neutral-500 ml-auto">
              {replay.length > 0 ? `${replay.length} step${replay.length === 1 ? "" : "s"}` : "reading…"}
            </span>
          </div>
          <div className="space-y-2.5">
            {replay.map((t) => (
              <div key={t.step} className="flex gap-3">
                <span className="text-green-400 shrink-0">✓</span>
                <div className="min-w-0">
                  <div className="text-sm text-neutral-50">
                    {ACTION_LABEL[t.selectedAction] ?? t.selectedAction}
                  </div>
                  <div className="text-[11px] text-neutral-400 mt-0.5 break-words">
                    {t.selectedAction}
                  </div>
                  <div className="text-xs text-neutral-300 mt-1 break-words">{t.result}</div>
                </div>
              </div>
            ))}
            {submitting && (
              <div className="flex gap-3 items-center">
                <div className="animate-spin w-3.5 h-3.5 border-2 border-neutral-500 border-t-transparent rounded-full shrink-0" />
                <span className="text-sm text-neutral-400">
                  Reading the posting and matching your resume…
                </span>
              </div>
            )}
          </div>
          {replay.length > 0 && !submitting && (
            <p className="text-[11px] text-neutral-500 mt-3 pt-3 border-t border-neutral-700">
              Opening the full evaluation… the same steps stay on the job page under
              &ldquo;Agent Decision Trace&rdquo;.
            </p>
          )}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || replay.length > 0 || !rawText.trim()}
          className="text-sm font-bold bg-neutral-900 hover:bg-neutral-800 text-white px-6 py-3 rounded-xl disabled:opacity-50 transition-all shadow-sm cursor-pointer flex items-center gap-2"
        >
          {submitting ? (
            <>
              <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
              <span>Evaluating with Agent...</span>
            </>
          ) : (
            <span>Evaluate with Agent →</span>
          )}
        </button>
      </div>
    </div>
  );
}

