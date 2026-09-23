"use client";

// The decision trace, laid out exactly as the class asks for it.
//
// The CIS 4394 lesson defines the agent loop as OBSERVE → DECIDE → ACT → RECORD → UPDATE STATE,
// and the trace format as: state before → observation → available actions → selected action →
// result → state after → next decision. Every step below is shown in that order, with those
// labels, so a grader can read a trace against the lesson without translating anything. Each
// step also carries the starter kit's action name (ASK_USER, RECOMMEND, REJECT, ...) and says
// who made the call: the AI controller, a guardrail, or the default policy.

type Step = {
  step: number;
  stateBefore: Record<string, unknown>;
  observation: string;
  availableActions: string[];
  selectedAction: string;
  result: string;
  stateAfter: Record<string, unknown>;
  chosenBy?: "model" | "harness" | "policy";
  modelReasoning?: string;
  overruled?: string;
  brain?: "ai" | "code" | "memory";
  thinking?: string;
  classAction?: string;
};

const pct = (v: unknown) => (typeof v === "number" ? `${Math.round(v * 100)}%` : "—");

/** The handful of state fields a person cares about, in plain words. */
function stateSummary(s: Record<string, unknown>): string {
  const bits = [`stage: ${String(s.stage ?? "start")}`];
  if (typeof s.fitScore === "number") bits.push(`fit ${pct(s.fitScore)}`);
  const v = Array.isArray(s.hardConstraintViolations) ? s.hardConstraintViolations.length : 0;
  if (v) bits.push(`${v} hard-constraint violation${v === 1 ? "" : "s"}`);
  if (s.injectionDetected) bits.push("injection flagged");
  if (s.clarificationQuestion) bits.push("question pending");
  if (s.draft || s.coverLetter) bits.push("draft written");
  return bits.join(" · ");
}

/** What this step changed in the agent's state. */
function stateChanges(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (before.stage !== after.stage) out.push(`stage ${String(before.stage ?? "start")} → ${String(after.stage)}`);
  if (before.fitScore !== after.fitScore && typeof after.fitScore === "number") {
    out.push(`fit score ${pct(before.fitScore)} → ${pct(after.fitScore)}`);
  }
  const bv = Array.isArray(before.hardConstraintViolations) ? before.hardConstraintViolations.length : 0;
  const av = Array.isArray(after.hardConstraintViolations) ? after.hardConstraintViolations.length : 0;
  if (bv !== av) out.push(`hard-constraint violations ${bv} → ${av}`);
  if (!before.injectionDetected && after.injectionDetected) out.push("injection flag set");
  const bm = Array.isArray(before.missingSkills) ? before.missingSkills.length : 0;
  const am = Array.isArray(after.missingSkills) ? after.missingSkills.length : 0;
  if (bm !== am) out.push(`gaps recorded: ${am}`);
  if (!before.clarificationQuestion && after.clarificationQuestion) out.push("question for you recorded");
  if (!before.advice && after.advice) out.push("recommendation for you recorded");
  if (!before.draft && after.draft) out.push("draft recorded");
  if (!before.workArrangement || before.workArrangement !== after.workArrangement) {
    if (after.workArrangement && after.workArrangement !== "unknown") out.push(`work arrangement: ${String(after.workArrangement)}`);
  }
  return out.length ? out : ["no change to the decision state (the step was recorded)"];
}

function nextDecision(steps: Step[], i: number): string {
  const next = steps[i + 1];
  if (next) return `${next.selectedAction}${next.classAction ? ` (${next.classAction})` : ""}`;
  const stage = String(steps[i].stateAfter.stage ?? "");
  if (stage === "awaiting_approval") return "none — the agent stops and waits for your Approve / Edit / Reject";
  if (stage === "awaiting_clarification") return "none — the agent stops and waits for your answer";
  if (stage.startsWith("rejected")) return "none — finished (you can still overrule a low-fit rejection)";
  if (stage === "drafted") return "none — finished; nothing is sent anywhere";
  return "none — finished";
}

function WhoBadge({ t }: { t: Step }) {
  if (t.chosenBy === "model")
    return <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 font-semibold">AI chose</span>;
  if (t.chosenBy === "harness")
    return <span className="px-2 py-0.5 rounded-full bg-neutral-200 text-neutral-700 font-semibold">guardrail (only option)</span>;
  if (t.chosenBy === "policy")
    return <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-semibold">default policy</span>;
  return null;
}

function BrainBadge({ brain }: { brain?: Step["brain"] }) {
  if (brain === "ai") return <span className="px-2 py-0.5 rounded-full bg-indigo-600 text-white font-semibold">🧠 AI did this step</span>;
  if (brain === "memory")
    return (
      <span
        className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 font-semibold"
        title="The agent recalled a judgment an AI made about this posting and résumé on an earlier run"
      >
        🗂 recalled from memory
      </span>
    );
  if (brain === "code") return <span className="px-2 py-0.5 rounded-full bg-neutral-300 text-neutral-800 font-semibold">⚙ code rule</span>;
  return null;
}

function Row({ phase, label, children }: { phase: string; label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] sm:grid-cols-[8.5rem_1fr] gap-x-2 py-1 border-t border-neutral-100 first:border-t-0">
      <div className="text-[10px] leading-tight pt-0.5">
        <div className="font-bold text-sky-800 tracking-wide">{phase}</div>
        <div className="text-neutral-500">{label}</div>
      </div>
      <div className="text-neutral-800 min-w-0 break-words">{children}</div>
    </div>
  );
}

export default function ClassTrace({ trace }: { trace: Step[] }) {
  const aiChoices = trace.filter((t) => t.chosenBy === "model").length;
  const aiSteps = trace.filter((t) => t.brain === "ai").length;
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-950">
        <div className="font-bold mb-1">The agent loop, as taught in class</div>
        <div className="font-mono text-[11px] mb-2">OBSERVE → DECIDE → ACT → RECORD → UPDATE STATE → (observe again, or stop for a human)</div>
        <div className="mb-1">
          <span className="font-semibold">This posting&apos;s path, in the class&apos;s action names:</span>{" "}
          {trace.map((t, i) => (
            <span key={t.step}>
              <span className="font-mono">{t.classAction ?? t.selectedAction}</span>
              {i < trace.length - 1 ? " → " : ""}
            </span>
          ))}
        </div>
        <div className="text-sky-900">
          {trace.length} steps. The AI chose the action at {aiChoices} of them and did the work at {aiSteps}; the
          rest were guardrails or recalled results. A different posting produces a different path — compare cases in
          the <a href="/testlab" className="underline">Test Lab</a>.
        </div>
      </div>

      {trace.map((t, i) => (
        <div key={t.step} className="border border-neutral-200 bg-white rounded-xl p-3 text-xs">
          <div className="flex flex-wrap items-center gap-1.5 mb-2 text-[10px]">
            <span className="font-mono font-bold text-sm text-neutral-900 mr-1">Step {t.step}</span>
            {t.classAction && (
              <span className="px-2 py-0.5 rounded-full bg-sky-100 text-sky-900 font-semibold" title="The starter kit's name for this action">
                {t.classAction}
              </span>
            )}
            <WhoBadge t={t} />
            <BrainBadge brain={t.brain} />
          </div>

          <Row phase="STATE" label="before">
            {stateSummary(t.stateBefore)}
          </Row>
          <Row phase="OBSERVE" label="observation">
            {t.observation}
          </Row>
          <Row phase="DECIDE" label="available actions">
            {t.availableActions.length > 1 ? (
              <>
                <span className="font-mono">{t.availableActions.join(" | ")}</span>
                <span className="text-neutral-500"> — {t.availableActions.length} options, so this was a real choice</span>
              </>
            ) : (
              <>
                <span className="font-mono">{t.availableActions[0] ?? t.selectedAction}</span>
                <span className="text-neutral-500"> — the only action the guardrails allowed here</span>
              </>
            )}
          </Row>
          <Row phase="DECIDE" label="selected action">
            <span className="font-mono font-semibold">{t.selectedAction}</span>
            {t.modelReasoning && (
              <div className="mt-1 text-indigo-900 bg-indigo-50 border border-indigo-200 rounded-lg px-2 py-1 whitespace-pre-line">
                <span className="text-indigo-500 font-mono">why the AI chose it: </span>
                {t.modelReasoning}
              </div>
            )}
            {t.thinking && (
              <div className="mt-1 text-neutral-800 bg-neutral-50 border border-neutral-200 rounded-lg px-2 py-1 whitespace-pre-line">
                <span className="text-neutral-500 font-mono">
                  {t.brain === "memory" ? "recalled: " : t.brain === "ai" ? "what the AI found: " : "how: "}
                </span>
                {t.thinking}
              </div>
            )}
            {t.overruled && <div className="mt-1 text-red-700">Guardrail overruled the AI: {t.overruled}</div>}
          </Row>
          <Row phase="ACT → RECORD" label="result">
            {t.result}
          </Row>
          <Row phase="UPDATE STATE" label="state after">
            <div>{stateSummary(t.stateAfter)}</div>
            <div className="text-neutral-500">changed: {stateChanges(t.stateBefore, t.stateAfter).join("; ")}</div>
          </Row>
          <Row phase="NEXT" label="next decision">
            {nextDecision(trace, i)}
          </Row>
        </div>
      ))}
    </div>
  );
}
