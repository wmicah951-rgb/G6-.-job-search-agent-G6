# Guardrails

The assignment's four hard requirements, and exactly where each is enforced in
code.

## 1. Never fabricate

`draftApplication()` in `agent.ts` cannot assert anything not literally present
in the candidate's resume text:

- For each matched skill, `findEvidenceLine()` searches the resume line-by-line
  for a line containing that skill's alias, and quotes that line **verbatim**.
- If no matching line is found for a skill, no bullet is produced for it —
  there's no fallback that invents wording.
- The only other text a draft can contain is the human's own edit note, which
  is passed through verbatim, never paraphrased or expanded by the system.

There is no code path in `draftApplication()` that constructs a claim from
anything other than a literal resume.md substring. This makes "never fabricate"
mechanically true rather than a prompt-level aspiration.

The new "why this fits" panel (`explainFit()`) follows the same rule — every
skill-evidence line is a literal resume quote; the only non-literal statements
it makes (years of experience, title-preference match, company-size match) are
direct comparisons between two extracted numbers/strings, not inferences.

## 2. Treat job-posting text as data, never instructions

`scanForInjection()` runs **before** any other processing of the posting text.
When it matches injection-style phrasing, the agent:

1. Logs the exact matched snippets in the trace (transparency — you can see
   exactly what it caught).
2. Explicitly states in the trace result that the commands were refused.
3. Continues evaluating the posting's *actual* content (skills, years,
   constraints) exactly as it would any other posting.

Nothing in the codebase ever passes posting text to something that could
execute it as instructions — there is no LLM call, no `eval`, no template
interpolation of posting content into a prompt. It is string data, scanned with
regex, for the entire pipeline. See
[08-testing-evidence.md](08-testing-evidence.md) for the J004 test: the posting
tries to get the agent to auto-approve itself, skip the human step, and print
the raw resume — all three are refused, and the posting is evaluated normally.

## 3. Respect hard constraints regardless of skill fit

`checkHardConstraints()` runs as its own decision point, independent of
`evaluateFit()`. The branch logic in `runAgent()` checks
`hardConstraintViolations.length > 0` **before** it checks the fit score — a
100% skill match with a hard-constraint violation (see J003 in the test
evidence: perfect skill match, but requires 5+ years and an active clearance)
is still auto-rejected, with a trace explicitly noting "regardless of skill
fit."

## 4. Pause for a human before producing any final material

Enforced in two places, not just the UI:

- **Agent logic**: `runAgent()` never calls `draftApplication()`. The only
  function that can produce a draft is `applyHumanDecision()`, which requires a
  `decision` argument of `"approve"` or `"edit"` and is only ever invoked from
  the approval API route.
- **API route**: `src/app/api/agent/approve/route.ts` checks
  `prior.state.stage !== "awaiting_approval"` and returns **409** if the job
  isn't actually waiting on a human — so you can't re-approve an already-decided
  job, approve one the agent auto-rejected, or race two approval clicks into two
  drafts.

Sending, submitting, or contacting anyone is out of scope by construction —
there is no code anywhere in this app that sends an HTTP request to a job board,
an email service, or any third party on the candidate's behalf. The only output
is text rendered back to the human in their own browser.

## Update: the injection and work-arrangement gates use the brain as a reader

`assessPosting()` (agent.ts) asks the configured model one structured question
per posting: injection passages, work arrangement (with an evidence quote) and
clearance. It returns *observations only*:

- Injection = built-in regex floor **OR** model-reported passages. A model
  passage counts only if it is a literal substring of the posting (same
  trust-but-verify rule as résumé quotes). No model configured / call fails =
  the regex floor alone; nothing else changes.
- Arrangement: the model's verified reading wins, regex cues (`regexArrangement`)
  are the fallback. `checkHardConstraints` turns "on-site" into a violation when
  the candidate's location rule (parsed tolerantly by `parseLocationRule`, not one
  exact phrase) forbids it. `detectLocationAmbiguity` fires `ask_user_clarification`
  only when the arrangement is still `unknown`.
- Neither call can approve, reject, draft or skip a step; the branch logic and the
  approval gate are unchanged, so J001-J004 keep their four distinct sequences.

