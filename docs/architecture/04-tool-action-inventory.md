# Tool / Action Inventory

Every action the agent can select, what it does, and why it exists as its own
distinct action rather than being folded into another step. For how this set
of actions maps onto CIS 4394's own reference architecture table
(`ASK_USER`, investigate, down-rank/reject, request approval, draft), see
[`../../G6-AGENT.md`](../../G6-AGENT.md) — Layer 0.

| Action | What it does | Why it's a separate action |
|---|---|---|
| `advise_human` | An AI advisor tells the person what it thinks when the agent stops for them (approval gate, low-fit rejection, ASK_USER): a recommendation, gaps ranked by importance, and drafting presets tailored to this résumé and job. It never sees the posting text; every quote is checked against the résumé and every ranked gap against the real gaps. No model: a deterministic default fills the same panel | The person needs the agent's reasoning at the moment they decide, and the presets and gap order must come from the agent rather than fixed UI text |
| `scan_for_injection` | Scans the posting for text aimed at an AI screener. **Two layers merged:** a built-in regex floor (`scanForInjection()`, 17 patterns, always runs) OR passages reported by the AI reader (`assessPosting()`), each verified as a literal substring of the posting. `injectionSources` records which layer caught it | Must happen before anything else touches the posting text, so nothing downstream can be steered by it |
| `flag_injection_and_continue` | Logs the exact injection snippets found, explicitly states they were refused, then lets normal evaluation proceed on the real content | Only exists on the injected-posting path — its presence/absence is exactly what makes that path's action sequence longer and different from a clean posting's |
| `evaluate_fit` | Compares resume vs. posting requirements via `performFitEvaluation()` — an LLM call if `isLlmConfigured()` (any provider), otherwise/on-failure the deterministic `extractSkills()`+`evaluateFit()` keyword matcher — then builds the grounded `fitRationale` (`explainFit()`) | The core matching step; everything downstream branches on its output. Which method ran is itself logged in the trace and shown in the UI |
| `check_hard_constraints` | Compares years/clearance/remote-hybrid requirements against `preferences.md`'s hard constraints (`checkHardConstraints()`, `extractCandidateYears()`, `extractRequiredYears()`) | Hard constraints are checked independently of skill fit on purpose — a perfect skill match still gets rejected if it violates one, which is exactly the assignment's required behavior |
| `ask_user_clarification` | This is the `ASK_USER` action from the class's reference table. Fires only when `hardConstraintViolations` is empty AND `detectLocationAmbiguity()` finds the posting never mentions remote/hybrid/on-site at all while the candidate has a "remote or hybrid only" rule — pauses at `awaiting_clarification` with a specific question, and `applyClarificationAnswer()` resumes evaluation once a human answers | Distinct from `request_human_approval`: this fires *during* evaluation because the agent is missing information, not *after* evaluation to get a go/no-go. Never fires on a posting that states its work arrangement — none of the four required tests trigger it |
| `reject_hard_constraint` | Terminates the run at `rejected_hard_constraint`; no draft, no human step | Distinct from `reject_low_fit` so the *reason* for rejection is traceable — a hard-constraint rejection means "don't bother re-evaluating even if the skills improve," a low-fit rejection doesn't |
| `reject_low_fit` | Terminates the run at `rejected_low_fit`; no draft, no human step | See above — different reason, different terminal state, different downstream meaning |
| `request_human_approval` | Pauses the run at `awaiting_approval`; nothing else happens until a human responds | This is the mandatory HITL gate — the assignment prohibits producing any application material without it |
| `human_approve` | Records that the person chose Approve. Sets stage `approved`; no material exists yet | The person's decision is its own step, distinct from the agent's drafting that follows — otherwise the trace shows the same action twice and reads like a loop |
| `human_edit` | Records that the person chose Edit and supplied drafting instructions. Sets stage `edited`, stores the note | As above; also makes the note's presence visible in the trace, since it changes what the draft may claim |
| `human_answers_clarification` | Records the person's answer to an `ask_user_clarification` question, then re-enters the shared `decideAfterConstraints()` branch | Distinct from the agent *asking*. Logging both under one name made the ASK_USER path show the same action twice consecutively |
| `human_override_low_fit` | The person overrules the agent's automatic low-fit rejection ("Apply anyway"). Moves `rejected_low_fit` → `awaiting_approval`, leaving the score and gap list untouched (`applyLowFitOverride()`) | Records that a *person* overrode the agent, never that the agent lowered its own bar. Not available on a hard-constraint rejection |
| `draft_application` | Produces the application material (`draftApplication()`): deterministic evidence bullets always, plus an LLM-written cover letter and tailored résumé when a model is configured | Only reachable after a human Approve/Edit decision — never on any other path |
| `verify_draft` | Deterministic pass over the generated material (`src/lib/draftVerifier.ts`). Classifies every sentence and flags any containing a number, employer, tool or credential found in neither the résumé nor the human's note | The model writes; separate code checks. Flagged lines are surfaced, never silently removed |
| `rescore_tailored_resume` | Re-runs the same fit evaluation against the tailored résumé, scored on a canonical list of the requirements the original evaluation found, and reports before → after (`comparable` is false when that list could not be reproduced, and the delta is then withheld) | Lets the human see whether the rewrite improved coverage or only wording. Gains resting on an unverified sentence are reported as `unearned` rather than counted |
| `discard` | Terminates at `rejected_by_human`; no draft | The human's Reject choice — kept distinct from the agent's own auto-rejections so it's clear a person made this call, not the agent |

## Supporting (non-branching) tools

These are called by the actions above but don't themselves appear as
`selectedAction` values in the trace — they're the actual logic each action
uses:

| Function | Purpose |
|---|---|
| `performFitEvaluation(resumeText, jobText)` | Orchestrates the LLM-vs-deterministic choice described above; always returns the same shape (`score`, `matched`, `missing`, `matchedEvidence`, `method`, `reasoning`) regardless of which path ran |
| `evaluateFitWithLlm(...)` (`llmEvaluator.ts`) | Sends resume + posting text (each capped at `MAX_INPUT_CHARS` = 16,000) to whichever provider is configured via a structured tool call, falling back to JSON mode for models without tool support; the posting text is explicitly framed as untrusted data in the system prompt, same principle as `scanForInjection` |
| `extractSkills(text)` | Deterministic path only: matches text against `SKILL_ALIASES`, a fixed dictionary of skill names → alias phrases (e.g. `"Power BI"` matches `"power bi"`, `"powerbi"`) |
| `extractRequiredYears(jobText)` | Finds years-of-experience requirements tied to actual requirement phrasing, not just any number near the word "years" |
| `extractCandidateYears(resumeText)` | Works out total years of experience: an explicit total if stated, else a "N years of experience" phrase, else the union of the date ranges on the résumé's roles (`yearsFromDateRanges()`), so overlapping jobs are not double-counted |
| `findEvidenceLine(resumeText, skill)` | Deterministic path only: finds the actual resume.md line that justifies a matched skill via the alias dictionary. The LLM path gets its evidence quotes directly from the model instead, verified as literal resume substrings by `performFitEvaluation()` before being trusted |
| `explainFit(matchedEvidence, ...)` | Builds the positive, evidence-backed "why this fits" narrative (skill evidence, years match, title/company-size preference alignment) — reads evidence from `matchedEvidence`, so it works identically regardless of which matching method produced it |
| `detectLocationAmbiguity(arrangement, preferencesText)` | Returns a clarification question when the posting is silent on work arrangement while the candidate requires remote/hybrid, else `null` |
| `assessPosting(jobText, settings)` | One structured model call returning injection passages, work arrangement (+ evidence quote) and clearance. Every quote verified against the posting before use. Returns `null` when no model is configured or `llmAssessmentEnabled` is off |
| `verifyDraft(text, resume, note, opts)` (`draftVerifier.ts`) | The `verify_draft` logic. `kind: "letter"` lets a cover letter cite the employer and team from the posting on any clause that is not a first-person claim; `kind: "resume"` gets no such exemption |
| `parseMinFit(prefsText, fallback)` | Reads the per-profile `Minimum fit: N%` line from preferences.md, clamped 10–90. This, not `LOW_FIT_THRESHOLD`, is the bar the agent actually uses |
| `normRequirement(s)` | Normalised key used to de-duplicate requirements before scoring — models routinely return the same requirement twice, and each duplicate silently dragged the score down |
| `decideAfterConstraints(state, log)` | The shared decision-point-4 branch logic (reject-hard-constraint vs. reject-low-fit vs. request-approval). Called by both `runAgent()` and `applyClarificationAnswer()` so the resume-after-ASK_USER path runs through the exact same tested logic, not a copy |

## Why this is a tool/action *inventory* and not just a function list

Each row above corresponds to something that shows up as `selectedAction` in a
real trace (see [08-testing-evidence.md](08-testing-evidence.md)) — this is the
literal set of choices the agent had available, taken directly from the
`availableActions` arrays logged alongside every trace step.

**This list is checked by a test.** `npx tsx scripts/doc-check.ts` extracts every
`selectedAction` string from `agent.ts` and fails if this table does not list all
of them. That exists because this table previously drifted three actions behind
the code while still claiming to be complete.

## Added supporting tools

| Function | Purpose |
|---|---|
| `assessPosting(jobText)` -> `assessPostingWithLlm` | One structured model call returning injection passages, work arrangement (+ quote) and clearance. Every quote is verified against the posting before use |
| `regexArrangement(jobText)` / `parseLocationRule(prefs)` | Deterministic fallbacks for the work-arrangement gate and tolerant parsing of the candidate's remote/hybrid rule |
| `makeOpenAiCompatProvider(cfg)` (`llm/openaiCompatProvider.ts`) | One implementation for every OpenAI-compatible model (DeepSeek preset, `custom` via env). Forced tool-calling with a JSON-mode fallback so any brain behaves the same |
| `renderMarkdownPdf(text, name, kind)` (`lib/pdfRender.ts`) | Typesets the drafted résumé / cover letter into a formatted PDF |

