"use client";

import { useEffect, useState } from "react";

type Settings = {
  lowFitThresholdDefault: number;
  llmAssessmentEnabled: boolean;
  askUserEnabled: boolean;
  draftVerificationEnabled: boolean;
  verifyHighThreshold: number;
  verifyLowThreshold: number;
  llmTimeoutMs: number;
  llmMaxInputChars: number;
  prompts: { assess: string; fit: string; draft: string };
};

type Layer = {
  key: string;
  n: number;
  title: string;
  what: string;
  decides: string;
  locked?: string;
  promptKey?: "assess" | "fit" | "draft";
  promptLabel?: string;
  knobs: {
    key: keyof Settings;
    label: string;
    help: string;
    type: "percent" | "number" | "bool" | "ratio";
    min?: number;
    max?: number;
  }[];
};

const LAYERS: Layer[] = [
  {
    key: "scan",
    n: 1,
    title: "Scan for prompt injection",
    what: "Reads the posting looking for text aimed at an AI screener rather than a human applicant. Two layers: a built-in keyword list that always runs, plus the AI reading it properly.",
    decides: "If found: logs it, refuses it, and keeps evaluating the real requirements. It never obeys it, and a human is still required.",
    locked:
      "The keyword floor cannot be turned off, and the posting is always treated as data rather than instructions. Those are the guardrail.",
    promptKey: "assess",
    promptLabel: "What the AI is told when reading a posting",
    knobs: [
      {
        key: "llmAssessmentEnabled",
        label: "Let the AI read the posting",
        help: "Off = the keyword list alone. The four subtle injections (J009-J012) will stop being caught, which you can prove in the Test Lab.",
        type: "bool",
      },
    ],
  },
  {
    key: "fit",
    n: 2,
    title: "Score the fit",
    what: "Lists only real screening requirements (skills, tools, degrees, years), marks each required or 'a plus', and each match full or partial. Every match needs a word-for-word quote from your resume.",
    decides: "Produces a percentage. Below your bar, the job is auto-rejected as low fit.",
    locked:
      "The evidence-quote rule is not optional: no verbatim quote, no match. That is what stops the score being invented.",
    promptKey: "fit",
    promptLabel: "What the AI is told when comparing a resume to a posting",
    knobs: [
      {
        key: "lowFitThresholdDefault",
        label: "Fallback minimum fit",
        help: "Used only when your preferences.md has no 'Minimum fit: N%' line. That line always wins — edit it on the Resume & Preferences page.",
        type: "percent",
        min: 10,
        max: 90,
      },
      {
        key: "llmMaxInputChars",
        label: "Max characters read per document",
        help: "Long postings are truncated to this. Higher costs more per call.",
        type: "number",
        min: 2000,
        max: 40000,
      },
      {
        key: "llmTimeoutMs",
        label: "AI call timeout (ms)",
        help: "If the model takes longer, the agent falls back to keyword matching rather than hanging.",
        type: "number",
        min: 3000,
        max: 60000,
      },
    ],
  },
  {
    key: "constraints",
    n: 3,
    title: "Check your hard rules",
    what: "Years of experience, security clearance and work location, read from your preferences.md.",
    decides: "A broken rule auto-rejects the job no matter how good the skill match is.",
    locked:
      "These live in preferences.md, not here, because they are statements about you rather than engine settings. Edit them on the Resume & Preferences page. A hard-rule rejection is also the one thing 'Apply anyway' cannot override.",
    knobs: [],
  },
  {
    key: "ask",
    n: 4,
    title: "Ask you when it genuinely cannot tell",
    what: "If the posting never says remote, hybrid or on-site, and you have a location rule, the agent stops and asks instead of guessing.",
    decides: "Pauses mid-evaluation. Your answer resumes it.",
    knobs: [
      {
        key: "askUserEnabled",
        label: "Allow the agent to ask",
        help: "Off = it stops asking and carries on without a location verdict. Test case J007 will change behaviour.",
        type: "bool",
      },
    ],
  },
  {
    key: "approve",
    n: 5,
    title: "The human approval gate",
    what: "The agent pauses and hands the decision to you: Approve, Approve with instructions, or Reject.",
    decides: "Nothing is drafted until you click.",
    locked:
      "Not tunable, by design. The agent cannot produce a draft on its own, and the API returns 409 if a job is not actually waiting on you. This is the assignment's core requirement.",
    knobs: [],
  },
  {
    key: "draft",
    n: 6,
    title: "Draft the application",
    what: "Writes a cover letter and re-tailors your resume for the role, grounded only in your resume and any instructions you typed.",
    decides: "Produces text. Employers, job titles, degrees and dates are copied exactly; only wording, grouping and emphasis change.",
    locked:
      "Work-history facts are never rewritten. Retitling a job is resume fraud and a reference check catches it.",
    promptKey: "draft",
    promptLabel: "What the AI is told when writing your application",
    knobs: [],
  },
  {
    key: "verify",
    n: 7,
    title: "Check the AI's own work",
    what: "Reads back every sentence it wrote. Rewording can only clear a sentence; only an unsourced hard fact (a number, employer, tool or credential) can flag one.",
    decides: "Flags untraceable claims for you. It never silently deletes anything.",
    locked:
      "A cover letter may name the employer and its team; a resume may not. Flagged lines are always shown rather than removed.",
    knobs: [
      {
        key: "draftVerificationEnabled",
        label: "Run the check",
        help: "Turning this off means nothing checks what the AI wrote. Not recommended.",
        type: "bool",
      },
      {
        key: "verifyHighThreshold",
        label: "'From your resume' threshold",
        help: "How close a sentence must be to one of your resume lines to count as directly grounded.",
        type: "ratio",
        min: 0.3,
        max: 0.95,
      },
      {
        key: "verifyLowThreshold",
        label: "'Reworded' threshold",
        help: "Below this, a sentence with no checkable fact is treated as opinion. Must be lower than the setting above.",
        type: "ratio",
        min: 0.1,
        max: 0.8,
      },
    ],
  },
];

export default function HarnessPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [defaults, setDefaults] = useState<Settings | null>(null);
  const [modified, setModified] = useState<string[]>([]);
  const [profileName, setProfileName] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [openPrompt, setOpenPrompt] = useState<Record<string, boolean>>({});

  async function load() {
    const d = await (await fetch("/api/harness")).json();
    setSettings(d.effective);
    setDefaults(d.defaults);
    setModified(d.modified ?? []);
    setProfileName(d.profileName ?? "");
  }
  useEffect(() => {
    load();
  }, []);

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((s) => (s ? { ...s, [key]: value } : s));
  }
  function setPrompt(key: "assess" | "fit" | "draft", value: string) {
    setSettings((s) => (s ? { ...s, prompts: { ...s.prompts, [key]: value } } : s));
  }

  async function save() {
    if (!settings) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/harness", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      });
      const d = await res.json();
      if (!res.ok) {
        setMsg({ kind: "err", text: (d.errors ?? ["Save failed."]).join(" ") });
        return;
      }
      setSettings(d.effective);
      setModified(d.modified ?? []);
      setMsg({
        kind: "ok",
        text: d.warnings?.length ? `Saved. ${d.warnings.join(" ")}` : "Saved.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function resetAll() {
    if (!window.confirm("Reset every harness setting for this profile back to the shipped defaults?")) return;
    const d = await (await fetch("/api/harness", { method: "DELETE" })).json();
    setSettings(d.effective);
    setModified(d.modified ?? []);
    setMsg({ kind: "ok", text: "Everything reset to defaults." });
  }

  async function resetKey(key: string) {
    const d = await (
      await fetch(`/api/harness?key=${encodeURIComponent(key)}`, { method: "DELETE" })
    ).json();
    setSettings(d.effective);
    setModified(d.modified ?? []);
    setMsg({ kind: "ok", text: `${key} reset to the default.` });
  }

  if (!settings || !defaults) {
    return <p className="text-sm text-neutral-500">Loading the harness…</p>;
  }

  return (
    <div className="w-full max-w-4xl mx-auto pb-24">
      <h1 className="text-2xl font-bold tracking-tight mb-1">The Harness</h1>
      <p className="text-sm text-neutral-600 mb-4 leading-relaxed">
        Every layer the agent runs, in plain English, with the settings it actually uses.
        The AI is the brain; this is the harness around it. Changes apply to the{" "}
        <strong>{profileName || "active"}</strong> profile only.
      </p>

      <div className="border border-neutral-200 bg-white rounded-2xl p-4 mb-5 shadow-xs flex flex-wrap items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="text-sm bg-neutral-900 hover:bg-neutral-800 text-white font-semibold px-4 py-2 rounded-xl disabled:opacity-50 cursor-pointer shadow-xs"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        <button
          onClick={resetAll}
          className="text-sm bg-white hover:bg-neutral-100 text-neutral-800 font-semibold px-3 py-2 rounded-xl border border-neutral-400 cursor-pointer"
        >
          Reset everything
        </button>
        <a
          href="/testlab"
          className="text-sm text-neutral-700 hover:text-neutral-900 underline underline-offset-2"
        >
          Prove nothing broke → Test Lab
        </a>
        {modified.length > 0 && (
          <span className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
            {modified.length} setting{modified.length === 1 ? "" : "s"} changed from default
          </span>
        )}
        {msg && (
          <span
            className={`text-xs ml-auto ${msg.kind === "ok" ? "text-green-700" : "text-red-700"}`}
          >
            {msg.text}
          </span>
        )}
      </div>

      <p className="text-xs text-neutral-600 bg-neutral-100 border border-neutral-200 rounded-xl px-3 py-2 mb-5 leading-relaxed">
        <strong>You cannot permanently break this.</strong> Only the wording sent to the AI
        is editable — the structured format it must reply in is fixed, so a bad edit can
        change what it is told but not break how its answer is read. If a prompt is bad
        enough that the model fails, the agent falls back to keyword matching. Reset is
        always one click away. After any change, run the Test Lab to confirm the gates
        still behave.
      </p>

      {LAYERS.map((layer) => (
        <div key={layer.key} className="border border-neutral-200 bg-white rounded-2xl p-4 sm:p-5 mb-4 shadow-xs">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-xs font-mono bg-neutral-900 text-white px-1.5 py-0.5 rounded">
              {layer.n}
            </span>
            <h2 className="font-bold text-neutral-900">{layer.title}</h2>
          </div>
          <p className="text-sm text-neutral-700 leading-relaxed">{layer.what}</p>
          <p className="text-sm text-neutral-600 leading-relaxed mt-1">
            <span className="font-semibold text-neutral-800">What it decides: </span>
            {layer.decides}
          </p>

          {layer.knobs.length > 0 && (
            <div className="mt-3 space-y-3">
              {layer.knobs.map((k) => {
                const isMod = modified.includes(k.key as string);
                const value = settings[k.key];
                return (
                  <div key={k.key as string} className="bg-neutral-50 border border-neutral-200 rounded-xl p-3">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <label className="text-sm font-semibold text-neutral-800">
                        {k.label}
                        {isMod && (
                          <span className="ml-2 text-[10px] bg-amber-100 text-amber-900 border border-amber-300 px-1.5 py-0.5 rounded font-semibold">
                            changed
                          </span>
                        )}
                      </label>
                      <div className="flex items-center gap-2">
                        {k.type === "bool" ? (
                          <input
                            type="checkbox"
                            checked={!!value}
                            onChange={(e) => set(k.key, e.target.checked as never)}
                            className="w-4 h-4 cursor-pointer"
                          />
                        ) : (
                          <input
                            type="number"
                            step={k.type === "ratio" ? 0.01 : k.type === "percent" ? 1 : 100}
                            value={k.type === "percent" ? Math.round((value as number) * 100) : (value as number)}
                            onChange={(e) => {
                              const raw = parseFloat(e.target.value);
                              if (!Number.isFinite(raw)) return;
                              set(k.key, (k.type === "percent" ? raw / 100 : raw) as never);
                            }}
                            className="w-28 border border-neutral-300 rounded-lg px-2 py-1 text-sm bg-white text-neutral-900"
                          />
                        )}
                        {k.type === "percent" && <span className="text-sm text-neutral-600">%</span>}
                        {isMod && (
                          <button
                            onClick={() => resetKey(k.key as string)}
                            className="text-xs text-neutral-600 hover:text-neutral-900 underline cursor-pointer"
                          >
                            reset
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-neutral-600 mt-1 leading-relaxed">{k.help}</p>
                  </div>
                );
              })}
            </div>
          )}

          {layer.promptKey && (
            <div className="mt-3">
              <button
                onClick={() =>
                  setOpenPrompt((o) => ({ ...o, [layer.key]: !o[layer.key] }))
                }
                className="text-xs font-semibold text-neutral-700 hover:text-neutral-900 hover:underline cursor-pointer"
              >
                {openPrompt[layer.key] ? "Hide" : "Show"} {layer.promptLabel}
                {modified.includes(`prompts.${layer.promptKey}`) && (
                  <span className="ml-2 text-[10px] bg-amber-100 text-amber-900 border border-amber-300 px-1.5 py-0.5 rounded">
                    changed
                  </span>
                )}
              </button>
              {openPrompt[layer.key] && (
                <div className="mt-2">
                  <textarea
                    value={settings.prompts[layer.promptKey]}
                    onChange={(e) => setPrompt(layer.promptKey!, e.target.value)}
                    rows={12}
                    className="w-full border border-neutral-300 rounded-xl px-3 py-2 text-xs font-mono bg-white text-neutral-900 shadow-inner resize-y"
                  />
                  <div className="flex items-center gap-3 mt-1">
                    <button
                      onClick={() => setPrompt(layer.promptKey!, defaults.prompts[layer.promptKey!])}
                      className="text-xs text-neutral-600 hover:text-neutral-900 underline cursor-pointer"
                    >
                      restore the default text
                    </button>
                    <span className="text-xs text-neutral-500">
                      {settings.prompts[layer.promptKey].length} characters
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {layer.locked && (
            <p className="mt-3 text-xs text-neutral-600 bg-neutral-100 border border-neutral-200 rounded-lg px-3 py-2 leading-relaxed">
              <span className="font-semibold">🔒 Not editable: </span>
              {layer.locked}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
