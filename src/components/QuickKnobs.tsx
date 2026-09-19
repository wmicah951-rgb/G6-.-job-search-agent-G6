"use client";

import { readKnobs, writeKnob, type Knobs } from "@/lib/preferenceKnobs";

/**
 * Job-filter style controls over the candidate's preferences.
 *
 * Deliberately NOT its own state: the knobs are derived from the markdown every render
 * and every change rewrites the markdown. That makes it structurally impossible for the
 * controls and the raw text below them to disagree.
 */
export default function QuickKnobs({
  preferencesText,
  onChange,
}: {
  preferencesText: string;
  onChange: (next: string) => void;
}) {
  const k = readKnobs(preferencesText);
  const set = <K extends keyof Knobs>(key: K, value: Knobs[K]) =>
    onChange(writeKnob(preferencesText, key, value));

  return (
    <div className="border border-neutral-200 bg-white rounded-2xl p-4 sm:p-5 mb-4 shadow-xs">
      <h2 className="font-bold text-neutral-900 text-sm sm:text-base mb-0.5">
        Quick match settings
      </h2>
      <p className="text-xs text-neutral-500 mb-4">
        The filters the agent screens every posting against. These edit your
        preferences.md directly — the text below updates as you change them.
      </p>

      {/* fit bar */}
      <div className="mb-4">
        <div className="flex items-baseline justify-between mb-1">
          <label className="text-sm font-semibold text-neutral-800">Minimum match</label>
          <span className="text-sm font-bold text-neutral-900">{k.minFitPct ?? 60}%</span>
        </div>
        <input
          type="range"
          min={10}
          max={90}
          step={5}
          value={k.minFitPct ?? 60}
          onChange={(e) => set("minFitPct", parseInt(e.target.value, 10))}
          className="w-full cursor-pointer accent-neutral-900"
        />
        <p className="text-xs text-neutral-500 mt-0.5">
          Jobs scoring below this are auto-rejected. Lower it to see more, raise it to be
          pickier. You can still override any rejection on the job&apos;s page.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* work location */}
        <div>
          <label className="block text-sm font-semibold text-neutral-800 mb-1.5">
            Work location
          </label>
          <div className="flex flex-col gap-1">
            {(
              [
                ["remote_only", "Remote only"],
                ["remote_or_hybrid", "Remote or hybrid"],
                ["any", "Anything, including on-site"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 text-sm text-neutral-800 cursor-pointer">
                <input
                  type="radio"
                  name="locationRule"
                  checked={k.locationRule === value}
                  onChange={() => set("locationRule", value)}
                  className="cursor-pointer"
                />
                {label}
              </label>
            ))}
          </div>
          <p className="text-xs text-neutral-500 mt-1">
            A posting that breaks this is rejected however well the skills match.
          </p>
        </div>

        {/* years + clearance */}
        <div>
          <label className="block text-sm font-semibold text-neutral-800 mb-1.5">
            Experience ceiling
          </label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-neutral-700">Skip roles asking for</span>
            <input
              type="number"
              min={1}
              max={20}
              value={k.maxYears ?? 5}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (Number.isFinite(n)) set("maxYears", n);
              }}
              className="w-16 border border-neutral-300 rounded-lg px-2 py-1 text-sm bg-white text-neutral-900"
            />
            <span className="text-sm text-neutral-700">+ years</span>
          </div>
          <label className="flex items-center gap-2 text-sm text-neutral-800 cursor-pointer mt-2">
            <input
              type="checkbox"
              checked={k.clearanceExcluded}
              onChange={(e) => set("clearanceExcluded", e.target.checked)}
              className="w-4 h-4 cursor-pointer"
            />
            Skip roles needing a security clearance
          </label>
        </div>

        {/* titles */}
        <div>
          <label className="block text-sm font-semibold text-neutral-800 mb-1.5">
            Preferred titles
          </label>
          <input
            type="text"
            value={k.preferredTitles.join(", ")}
            onChange={(e) =>
              set(
                "preferredTitles",
                e.target.value
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean)
              )
            }
            placeholder="Analyst, Junior"
            className="w-full border border-neutral-300 rounded-lg px-3 py-1.5 text-sm bg-white text-neutral-900 placeholder:text-neutral-400"
          />
          <p className="text-xs text-neutral-500 mt-1">
            Comma separated. A soft preference — it explains fit, it never rejects.
          </p>
        </div>

        {/* size + salary */}
        <div>
          <label className="block text-sm font-semibold text-neutral-800 mb-1.5">
            Company size &amp; pay
          </label>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm text-neutral-700">Under</span>
            <input
              type="number"
              min={10}
              step={50}
              value={k.companySizeCap ?? 2000}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (Number.isFinite(n)) set("companySizeCap", n);
              }}
              className="w-24 border border-neutral-300 rounded-lg px-2 py-1 text-sm bg-white text-neutral-900"
            />
            <span className="text-sm text-neutral-700">employees</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-neutral-700">Target $</span>
            <input
              type="number"
              min={10}
              step={5}
              value={k.salaryTargetK ?? 65}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (Number.isFinite(n)) set("salaryTargetK", n);
              }}
              className="w-20 border border-neutral-300 rounded-lg px-2 py-1 text-sm bg-white text-neutral-900"
            />
            <span className="text-sm text-neutral-700">k+</span>
          </div>
          <p className="text-xs text-neutral-500 mt-1">
            Both are soft preferences. Salary is recorded for you — the agent does not
            filter on it.
          </p>
        </div>
      </div>

      <p className="text-xs text-neutral-500 mt-4 pt-3 border-t border-neutral-200">
        Remember to press <strong>Save</strong> below. Changes apply to the next posting
        you evaluate, not to jobs already on the board.
      </p>
    </div>
  );
}
