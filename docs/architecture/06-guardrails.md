# Guardrails

The assignment's four hard requirements, and exactly where each is enforced in
code.

## 1. Never fabricate

The agent produces two kinds of material, and they are guarded differently
because they are different things.

**The deterministic evidence bullets.** `draftApplication()` builds one bullet per
matched skill, each a verbatim `resume.md` line found by `findEvidenceLine()`. If
no line matches, no bullet is produced — there is no fallback that invents
wording. For this path "never fabricate" is mechanically true.

**The cover letter and tailored résumé.** These are written by a model that is
explicitly asked to rephrase for flow, so literal-substring checking is impossible
— an honest rewrite would fail it. Requiring one here would be a guarantee we
could not keep.

`src/lib/draftVerifier.ts` closes that gap with a deterministic pass over every
generated sentence, run as its own `verify_draft` trace step. Its rule is
asymmetric on purpose:

> **Fuzzy similarity may only EXONERATE. Only an unsourced HARD FACT may ACCUSE.**

A sentence is never flagged for being worded differently. It is flagged when it
contains a number, proper noun, tool name or credential that appears in neither
resume.md nor the human's edit note — precisely what a model fabricates, and
precisely what needs no fuzziness to detect. Each sentence is classified
`grounded`, `reworded`, `from_your_note`, `disclaimed` (it names a skill in order
to say the candidate lacks it), `subjective`, or `unsupported`.

Flagged lines are surfaced to the human and **never silently removed** — the same
"warn loudly and continue" stance the injection gate takes. The guarantee is
therefore: *every factual claim is either traceable to the candidate's own
material, or visibly flagged as untraceable.* It is not "the model cannot write
an unsourced sentence"; it is "an unsourced sentence cannot reach the human
unmarked."

Verified by `npx tsx scripts/verify-tests.ts`, whose hardest fixture is a heavily
but honestly reworded résumé that must produce **zero** flags — a verifier that
cries wolf on paraphrase gets ignored, and an ignored warning is worse than none.

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

Posting text **is** passed to the model — that is what the AI reader is for, and
`llm/types.ts` interpolates the posting into three prompts. The guarantee is not
"the text is never shown to a model"; it is that **nothing the posting says can
change what the agent does**:

- Every prompt frames the posting explicitly as untrusted data to analyse, never
  as instructions to follow.
- The model returns *observations only* — a structured record of what it saw. It
  has no field with which to approve, reject, skip a step or set a stage.
- Every branch (reject on a hard constraint, reject on low fit, pause for a human,
  ask a clarifying question) is deterministic code that reads those observations.
- Every snippet the model reports must be a literal substring of the posting, or
  it is discarded.
- There is no `eval`, and no code path anywhere that executes text.

So a posting can make the model *say* anything; it still cannot make the agent
*do* anything. See
[08-testing-evidence.md](08-testing-evidence.md) for the J004 test: the posting
tries to get the agent to auto-approve itself, skip the human step, and print
the raw resume — all three are refused, and the posting is evaluated normally.

### How the AI reader fits into this gate

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
