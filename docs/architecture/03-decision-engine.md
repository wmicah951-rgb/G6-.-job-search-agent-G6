# Decision Engine

The whole agent lives in one function: `runAgent()` in
[`src/lib/agent.ts`](../../src/lib/agent.ts) (plus `applyHumanDecision()` for what
happens after the human responds at the approval gate). This file walks through
it decision point by decision point, with the actual line numbers as of this
writing so you can jump straight to the code.

## State shape

```ts
interface AgentState {
  jobId: string;
  stage: Stage;                          // start | scanned | evaluated | constraints_checked
                                          // | awaiting_approval | approved | edited
                                          // | rejected_by_human | drafted
                                          // | rejected_low_fit | rejected_hard_constraint | discarded
  injectionDetected: boolean;
  injectionSnippets: string[];
  fitScore: number | null;
  matchedSkills: string[];
  missingSkills: string[];
  fitRationale: string[];                // grounded "why this fits" narrative — see 06-guardrails.md
  hardConstraintViolations: string[];
  redFlags: string[];
  approvalNote: string | null;
  draft: string | null;
}
```

This whole object is what "state" means throughout the assignment's required
`state_before → ... → state_after` trace format.

## Decision point 1 — scan for injection (`agent.ts` ~L248)

**Observation**: the raw job posting text, treated as untrusted data.
**Tool called**: `scanForInjection()` — matches the text against a list of
injection-style regex patterns (`agent.ts` ~L120).
**Branch**:
- No match → state moves to `scanned`, continue directly to decision point 2.
- Match found → an *extra* trace step (`flag_injection_and_continue`) is logged
  before continuing. This is the part that makes an injected posting take a
  **materially longer action sequence** than a clean one — the branch isn't
  cosmetic, it's a real extra decision the agent makes and logs.

The patterns were deliberately narrowed during QA after real job postings
false-positived on ordinary phrasing (e.g. "you will act as a critical backend
engine" is not an injection attempt) — see the git history / QA notes in
`agent.ts` comments for the specifics on `act as`, `system:`, and `you are/must
now`.

## Decision point 2 — evaluate fit (`agent.ts` ~L285)

**Observation**: how well the resume demonstrates what the posting asks for.
**Tool called**: `performFitEvaluation()` — this is the one step in the whole
agent that may call an LLM (see [10-setup-and-deployment.md](10-setup-and-deployment.md)
for the full design), and it decides that itself, per call:

- **If `ANTHROPIC_API_KEY` is configured**: calls `evaluateFitWithLlm()`
  (`llmEvaluator.ts`), which asks Claude Haiku to identify matched/missing
  requirements as a structured tool call. Every proposed match is then
  verified — kept only if its evidence quote is a literal substring of the
  resume text — before being trusted. `fitScore = matched / (matched + missing)`.
- **Otherwise, or if that call fails/times out**: falls back to
  `extractSkills()` + `evaluateFit()`, the original fixed-dictionary
  (`SKILL_ALIASES`) keyword matcher, `fitScore = matched.length / jobSkills.length`.

Either way, the result is the same shape (`score`, `matched`, `missing`,
`matchedEvidence`) flowing into the exact same decision point 4 branch logic
below — the LLM changes how requirements are identified, never how the agent
decides what to do about them.

**Also computed here**: `explainFit()` builds the grounded `fitRationale[]`
from `matchedEvidence` — this does NOT change the trace's `selectedAction`
(still `evaluate_fit`), it's extra state produced by the same step, kept out of
the trace text so the documented/required-test action sequences stay stable
across UI iterations.

## Decision point 3 — check hard constraints (`agent.ts` ~L308)

**Observation**: candidate years of experience (`extractCandidateYears()`,
reading resume.md's "Total professional experience" line) vs. years required by
the posting (`extractRequiredYears()`), plus clearance and remote/hybrid
requirements, checked against `preferences.md`'s hard-constraints section.
**Tool called**: `checkHardConstraints()`.

`extractRequiredYears()` deliberately does **not** just grab the first "N years"
number anywhere in the posting — early testing against real job boards found
that naive approach misreading unrelated numbers (e.g. "a 20+ year tech
services expert" describing the *company's* age, not a requirement) as a hard
requirement. It only matches years tied to actual experience-requirement
phrasing ("N years of experience", "requires N years", "N–M+ years", etc.), and
for a range like "3–5+ years" uses the lower bound — the actual minimum a
candidate needs to clear.

## Decision point 4 — the real branch (`agent.ts` ~L308–350)

This is the one the assignment's rubric is actually checking for: **three
materially different next actions**, chosen from accumulated state, not a fixed
next step.

```ts
if (state.hardConstraintViolations.length > 0) {
  // → reject_hard_constraint. STOPS HERE. No human approval step at all —
  //    there's nothing to review once a hard constraint is violated,
  //    regardless of how good the skill fit was.
}

if ((state.fitScore ?? 0) < LOW_FIT_THRESHOLD) {
  // → reject_low_fit. STOPS HERE too, for a DIFFERENT reason (skill gap,
  //    not a hard constraint) — this is why the two rejection paths are
  //    logged with different result text, so a grader (or you) can tell
  //    them apart in the trace, not just see "rejected" twice.
}

// otherwise:
// → request_human_approval. PAUSES. No draft exists yet.
```

## After the pause — `applyHumanDecision()` (`agent.ts` ~L356)

Only reachable when `stage === "awaiting_approval"` (enforced again server-side
in `src/app/api/agent/approve/route.ts`, which 409s if you try to
approve/reject a job that isn't in that stage — e.g. one already decided, or one
the agent auto-rejected).

- **Reject** → `discard`. No draft produced. Full stop.
- **Approve** or **Edit** → `draft_application`, which calls the grounded
  `draftApplication()` builder — see [06-guardrails.md](06-guardrails.md) for
  exactly how it can never fabricate a claim.

## Why the trace format matters

Every one of the steps above is logged through the same `log()` helper as:

```
state_before → observation → available_actions → selected_action → result → state_after
```

`available_actions` is the actual list of options the agent had at that point —
not just the one it picked. That's what proves this is a genuine choice among
alternatives rather than a hard-coded next line of code. See
[08-testing-evidence.md](08-testing-evidence.md) for real generated examples.
