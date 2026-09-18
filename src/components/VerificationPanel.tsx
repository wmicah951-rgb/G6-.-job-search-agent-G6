"use client";

import { useState } from "react";

export type VerifiedClaim = {
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

export type DraftVerification = {
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

const VERDICT_STYLE: Record<string, { label: string; chip: string }> = {
  grounded: { label: "From your resume", chip: "bg-green-100 text-green-900 border-green-300" },
  reworded: { label: "Reworded", chip: "bg-green-50 text-green-800 border-green-200" },
  from_your_note: { label: "From your note", chip: "bg-blue-100 text-blue-900 border-blue-300" },
  disclaimed: { label: "States a gap", chip: "bg-neutral-100 text-neutral-700 border-neutral-300" },
  subjective: { label: "Opinion", chip: "bg-neutral-100 text-neutral-600 border-neutral-300" },
  unsupported: { label: "Check this", chip: "bg-red-100 text-red-900 border-red-300" },
};

/**
 * "How this draft was built" — the receipts for the tailored resume / cover letter.
 *
 * The agent never silently edits or removes anything the model wrote. When a sentence
 * contains a number or a name that appears in neither the resume nor the human's note,
 * it is shown here, loudly, and the human decides. That is the same "warn and continue"
 * stance the injection gate takes.
 */
export default function VerificationPanel({
  verification,
  title,
  accent = "purple",
}: {
  verification: DraftVerification;
  title: string;
  accent?: "purple" | "blue";
}) {
  const [open, setOpen] = useState(false);
  const [showDropped, setShowDropped] = useState(false);
  const t = verification.totals;
  const flagged = verification.claims.filter((c) => c.verdict === "unsupported");
  const ok = flagged.length === 0;

  const traced = t.grounded + t.reworded + t.fromNote;
  const border = accent === "blue" ? "border-blue-200" : "border-purple-200";
  const bg = accent === "blue" ? "bg-blue-50/60" : "bg-purple-50/60";

  return (
    <div className={`border ${ok ? border : "border-red-300"} ${ok ? bg : "bg-red-50/70"} rounded-2xl p-4 sm:p-5 mb-4 shadow-xs`}>
      {/* --- headline verdict --- */}
      {ok ? (
        <div className="flex items-start gap-2">
          <span className="text-green-700 text-base leading-none mt-0.5">✓</span>
          <div className="min-w-0">
            <p className="font-bold text-sm text-neutral-900">
              {title}: every factual claim traces back to you
            </p>
            <p className="text-xs text-neutral-600 mt-0.5">
              {t.claims} claim{t.claims === 1 ? "" : "s"} checked · {traced} traced to your
              resume or note
              {t.disclaimed > 0 && ` · ${t.disclaimed} honestly states a gap`}
              {t.subjective > 0 && ` · ${t.subjective} opinion/framing`}. Nothing was
              invented.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <span className="text-red-700 text-base leading-none mt-0.5">⚠</span>
          <div className="min-w-0">
            <p className="font-bold text-sm text-red-900">
              Check {flagged.length} line{flagged.length === 1 ? "" : "s"} before you send
              this
            </p>
            <p className="text-xs text-red-800 mt-0.5">
              {flagged.length === 1 ? "This line contains" : "These lines contain"} a number
              or name that is in neither your resume nor your note. It was{" "}
              <strong>not removed</strong> — you decide whether it is true.
            </p>
          </div>
        </div>
      )}

      {/* --- the flagged lines, always expanded: this is the point of the panel --- */}
      {flagged.length > 0 && (
        <ul className="mt-3 space-y-2">
          {flagged.map((c) => (
            <li key={c.id} className="bg-white border border-red-200 rounded-xl p-3">
              <p className="text-sm text-neutral-900 leading-relaxed">“{c.text}”</p>
              <p className="text-xs text-red-800 mt-1.5 font-medium">{c.reason}</p>
              {c.sourceQuote && (
                <p className="text-xs text-neutral-500 mt-1">
                  Closest line in your resume: “{c.sourceQuote}”
                </p>
              )}
              <p className="text-xs text-neutral-500 mt-1.5">
                If it is true, add it to your resume on the Resume &amp; Preferences page so
                it can be verified next time. If not, edit it out of the draft below.
              </p>
            </li>
          ))}
        </ul>
      )}

      {/* --- full line-by-line breakdown --- */}
      <button
        onClick={() => setOpen(!open)}
        className="mt-3 text-xs font-medium text-neutral-700 hover:text-neutral-900 hover:underline cursor-pointer"
      >
        {open ? "Hide" : "Show"} where every line came from ({t.claims})
      </button>

      {open && (
        <div className="mt-2 space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
          {verification.claims
            .filter((c) => c.verdict !== "structural")
            .map((c) => {
              const s = VERDICT_STYLE[c.verdict] ?? VERDICT_STYLE.subjective;
              return (
                <div
                  key={c.id}
                  className="bg-white/80 border border-neutral-200 rounded-lg p-2.5 text-xs"
                >
                  <div className="flex items-start gap-2">
                    <span
                      className={`shrink-0 px-1.5 py-0.5 rounded border text-[10px] font-semibold ${s.chip}`}
                    >
                      {s.label}
                    </span>
                    <span className="text-neutral-900 leading-relaxed">{c.text}</span>
                  </div>
                  {c.sourceQuote && c.verdict !== "grounded" && (
                    <p className="text-neutral-500 mt-1 pl-1 border-l-2 border-neutral-200 ml-1">
                      from: “{c.sourceQuote}”
                    </p>
                  )}
                </div>
              );
            })}
        </div>
      )}

      {/* --- what got left out --- */}
      {verification.droppedFromOriginal.length > 0 && (
        <div className="mt-3 pt-3 border-t border-neutral-200/70">
          <button
            onClick={() => setShowDropped(!showDropped)}
            className="text-xs font-medium text-neutral-700 hover:text-neutral-900 hover:underline cursor-pointer"
          >
            {showDropped ? "Hide" : "Show"} {verification.droppedFromOriginal.length} line
            {verification.droppedFromOriginal.length === 1 ? "" : "s"} from your original
            resume that did not make it in
          </button>
          {showDropped && (
            <ul className="mt-2 space-y-1">
              {verification.droppedFromOriginal.map((line, i) => (
                <li key={i} className="text-xs text-neutral-600 bg-white/70 rounded-lg px-2.5 py-1.5 border border-neutral-200">
                  {line}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
