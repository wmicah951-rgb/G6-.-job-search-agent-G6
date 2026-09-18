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
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold mb-1">Add a job posting</h1>
      <p className="text-sm text-neutral-500 mb-4">
        Scrape a URL or paste the text. Either way, the agent treats this content as{" "}
        <strong>data to evaluate</strong>, never as instructions to follow.
      </p>

      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setMode("url")}
          className={`text-sm px-3 py-1.5 rounded-md border ${
            mode === "url" ? "bg-neutral-900 text-white border-neutral-900" : "border-neutral-300"
          }`}
        >
          Scrape from URL
        </button>
        <button
          onClick={() => setMode("paste")}
          className={`text-sm px-3 py-1.5 rounded-md border ${
            mode === "paste" ? "bg-neutral-900 text-white border-neutral-900" : "border-neutral-300"
          }`}
        >
          Paste text
        </button>
      </div>

      {mode === "url" && (
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">Posting URL</label>
          <div className="flex gap-2">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://company.com/careers/data-analyst"
              className="flex-1 border border-neutral-300 rounded-md px-3 py-2 text-sm bg-white text-neutral-900 placeholder:text-neutral-400"
            />
            <button
              onClick={handleScrape}
              disabled={scraping || !url}
              className="text-sm bg-neutral-900 text-white px-3 py-2 rounded-md disabled:opacity-50"
            >
              {scraping ? "Fetching…" : "Fetch"}
            </button>
          </div>
          <p className="text-xs text-neutral-500 mt-1">
            Many job boards (LinkedIn, Indeed, sites that require login or heavy
            JavaScript) block server-side fetches or violate their own terms of service
            if scraped. If a fetch fails, paste the text instead — that always works.
          </p>
        </div>
      )}

      {mode === "paste" && (
        <>
          <div className="mb-3">
            <label className="block text-sm font-medium mb-1">Title (optional)</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Data Analyst @ Acme Co"
              className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm bg-white text-neutral-900 placeholder:text-neutral-400"
            />
          </div>
          <div className="mb-3">
            <label className="block text-sm font-medium mb-1">Posting text</label>
            <textarea
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              rows={14}
              placeholder="Paste the full job posting here…"
              className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm font-mono bg-white text-neutral-900 placeholder:text-neutral-400"
            />
          </div>
        </>
      )}

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      <button
        onClick={handleSubmit}
        disabled={submitting || !rawText.trim()}
        className="text-sm bg-neutral-900 text-white px-4 py-2 rounded-md disabled:opacity-50"
      >
        {submitting ? "Evaluating…" : "Evaluate with agent"}
      </button>
    </div>
  );
}
