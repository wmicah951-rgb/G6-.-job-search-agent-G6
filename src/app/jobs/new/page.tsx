"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewJobPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"paste" | "url">("paste");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [rawText, setRawText] = useState("");
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [scraping, setScraping] = useState(false);
  const [submitting, setSubmitting] = useState(false);
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

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || !rawText.trim()}
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

