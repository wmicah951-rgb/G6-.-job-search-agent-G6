# Tool / Action Inventory

Every action the agent can select, what it does, and why it exists as its own
distinct action rather than being folded into another step.

| Action | What it does | Why it's a separate action |
|---|---|---|
| `scan_for_injection` | Regex-scans the raw posting text for embedded instruction-like phrasing (`scanForInjection()`) | Must happen before anything else touches the posting text, so nothing downstream can be steered by it |
| `flag_injection_and_continue` | Logs the exact injection snippets found, explicitly states they were refused, then lets normal evaluation proceed on the real content | Only exists on the injected-posting path — its presence/absence is exactly what makes that path's action sequence longer and different from a clean posting's |
| `evaluate_fit` | Compares resume vs. posting requirements via `performFitEvaluation()` — an LLM call (Claude Haiku) if `ANTHROPIC_API_KEY` is set, otherwise/on-failure the deterministic `extractSkills()`+`evaluateFit()` keyword matcher — then builds the grounded `fitRationale` (`explainFit()`) | The core matching step; everything downstream branches on its output. Which method ran is itself logged in the trace and shown in the UI |
| `check_hard_constraints` | Compares years/clearance/remote-hybrid requirements against `preferences.md`'s hard constraints (`checkHardConstraints()`, `extractCandidateYears()`, `extractRequiredYears()`) | Hard constraints are checked independently of skill fit on purpose — a perfect skill match still gets rejected if it violates one, which is exactly the assignment's required behavior |
| `reject_hard_constraint` | Terminates the run at `rejected_hard_constraint`; no draft, no human step | Distinct from `reject_low_fit` so the *reason* for rejection is traceable — a hard-constraint rejection means "don't bother re-evaluating even if the skills improve," a low-fit rejection doesn't |
| `reject_low_fit` | Terminates the run at `rejected_low_fit`; no draft, no human step | See above — different reason, different terminal state, different downstream meaning |
| `request_human_approval` | Pauses the run at `awaiting_approval`; nothing else happens until a human responds | This is the mandatory HITL gate — the assignment prohibits producing any application material without it |
| `draft_application` | Builds cover-letter bullets, one per matched skill, each a literal quote from the resume-snapshot text (`draftApplication()`) | Only reachable after a human Approve/Edit decision — never on any other path |
| `discard` | Terminates at `rejected_by_human`; no draft | The human's Reject choice — kept distinct from the agent's own auto-rejections so it's clear a person made this call, not the agent |

## Supporting (non-branching) tools

These are called by the actions above but don't themselves appear as
`selectedAction` values in the trace — they're the actual logic each action
uses:

| Function | Purpose |
|---|---|
| `performFitEvaluation(resumeText, jobText)` | Orchestrates the LLM-vs-deterministic choice described above; always returns the same shape (`score`, `matched`, `missing`, `matchedEvidence`, `method`, `reasoning`) regardless of which path ran |
| `evaluateFitWithLlm(...)` (`llmEvaluator.ts`) | Sends resume + posting text (each capped at 6,000 chars) to Claude Haiku via a single structured tool call; the posting text is explicitly framed as untrusted data in the system prompt, same principle as `scanForInjection` |
| `extractSkills(text)` | Deterministic path only: matches text against `SKILL_ALIASES`, a fixed dictionary of skill names → alias phrases (e.g. `"Power BI"` matches `"power bi"`, `"powerbi"`) |
| `extractRequiredYears(jobText)` | Finds years-of-experience requirements tied to actual requirement phrasing, not just any number near the word "years" |
| `extractCandidateYears(resumeText)` | Reads the candidate's stated total years of experience from resume.md |
| `findEvidenceLine(resumeText, skill)` | Deterministic path only: finds the actual resume.md line that justifies a matched skill via the alias dictionary. The LLM path gets its evidence quotes directly from the model instead, verified as literal resume substrings by `performFitEvaluation()` before being trusted |
| `explainFit(matchedEvidence, ...)` | Builds the positive, evidence-backed "why this fits" narrative (skill evidence, years match, title/company-size preference alignment) — reads evidence from `matchedEvidence`, so it works identically regardless of which matching method produced it |

## Why this is a tool/action *inventory* and not just a function list

Each row above corresponds to something that shows up as `selectedAction` in a
real trace (see [08-testing-evidence.md](08-testing-evidence.md)) — this is the
literal set of choices `runAgent()` had available at each decision point, taken
directly from the `availableActions` arrays logged alongside every trace step.
