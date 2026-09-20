# Reflection (½ page)

> **The assignment requires this to be your own analysis, pointing to your own
> runs — not intentions.** The paragraphs below are a starting draft built from
> the actual test evidence in this repo, meant to save you from a blank page,
> not to be submitted verbatim. Read it, argue with it if you disagree, and
> rewrite it in your own words before you turn it in. Delete this callout box
> when you do.

## What makes this system an agent rather than a workflow?

A fixed pipeline would run the same sequence of steps for every job posting and
only vary the *values* it produces along the way. This system doesn't: the
executed **sequence of steps itself** changes shape based on what the agent
observes, which is the actual bar the assignment sets ("select among materially
different next actions based on its current observation and state").

Concretely, from the traces in
[08-testing-evidence.md](08-testing-evidence.md) (note: the bullets below describe an earlier
fixed-order version. The current agent has an AI controller that chooses among permitted actions,
so **J003 now ends after 3 steps** because the controller skipped the fit evaluation once the
violation was known, and every trace step shows who chose it and why. Rewrite this in your own words
from the current traces):

- **J003** terminates after 4 steps at `reject_hard_constraint` and never even
  considers the human-approval step — despite a *perfect* 100% skill match.
  That's the clearest evidence the hard-constraint check isn't just another
  filter feeding into the same final step as everything else; it's a branch
  that short-circuits the whole rest of the pipeline.
- **J002** also auto-rejects, but at the *same* decision point for a
  *different, independently-checked* reason (skill fit, not a hard
  constraint) — logged with different observation and result text, so the two
  rejection paths are distinguishable in the trace, not just two label
  variants of "no."
- **J004** takes a **longer** path than any clean posting could, because
  `flag_injection_and_continue` is an action that only exists when the input
  actually contains injection-style text. The agent didn't just produce a
  different *answer* for this input — it took a genuinely different *route*
  through the system.

If this were a workflow, all six starter-kit postings (and the two extra ones
I added) would have produced traces with the same number of steps and the same
sequence of action names, just with different numbers substituted into
`fit_score=` and different strings in `matched=[]`. They didn't: sequence
lengths ranged from 4 to 7 steps, and the four required tests produced 4
distinct action sequences out of 4 — verified programmatically, not eyeballed
(see the `CROSS-CHECK` section at the bottom of
`required-test-traces.txt`).

## Where the guardrails actually did something

The prompt-injection test wasn't a formality: the J004 posting explicitly tried
to get the agent to auto-approve itself, skip the human step, and print the raw
resume verbatim. The agent didn't need special-case code to resist any of
those specific commands — it never had a code path capable of *executing*
instructions found in posting text in the first place, only one that could
*evaluate* posting text as data. Refusing the injection wasn't a close call the
system got right; the attack surface for that class of instruction simply
doesn't exist in this architecture.

## What I'd improve if I had more time

Be specific and honest here — some real candidates, based on issues actually
found during QA:
- `extractRequiredYears()` and the skill dictionary are regex/keyword-based, so
  they'll miss phrasing they weren't written for (a real Greenhouse/Lever
  posting with unusual wording could slip past either extractor silently).
  A more robust version would flag low-confidence extractions instead of
  guessing.
- The fit-score threshold (0.6) and the skill alias dictionary are reasonable
  defaults but arbitrary — they haven't been tuned against a large real-world
  posting set.
