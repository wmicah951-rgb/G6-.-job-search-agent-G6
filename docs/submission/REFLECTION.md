# Agent, not workflow — and how we can tell

The class's test is blunt and useful: **when the observation changes, the executed action
sequence should change.** A system that runs the same steps in the same order for every input
is a workflow no matter how much intelligence sits inside each step.

## What the runtime actually does

Three postings, the same candidate, the same code, one run each (with DeepSeek configured):

| Posting | What the agent observed | Executed sequence |
|---|---|---|
| Kit J001 (Junior Data Analyst, Atlanta) | nothing embedded; no constraint broken; 85% against a 60% bar | `scan_for_injection > check_hard_constraints > evaluate_fit > request_human_approval` |
| Kit J004 (Cloud Data Analyst, with an injection) | instructions aimed at an AI inside the posting; AWS certification missing | `scan_for_injection > flag_injection_and_continue > check_hard_constraints > evaluate_fit > reject_low_fit` |
| Kit J006 (Marketing Content Creator, New York) | a hard constraint broken before any scoring | `scan_for_injection > check_hard_constraints > reject_hard_constraint` |

Different lengths, different steps, different endings. J006 never runs the fit evaluation at
all — the controller sees that a hard-constraint violation already settles the job and does not
spend a model call proving what cannot change the outcome. That is a decision, and it is
visible in the trace as `chosenBy: model` with the model's own reasoning attached.

The order is not fixed either. With no model configured the default policy scores first; with a
model, the controller usually checks the deal-breakers first. Same code, different sequences —
which is exactly the property the rubric asks for.

## Where the agency actually lives — and where it deliberately does not

The honest version of this claim matters more than the flattering one.

**The AI chooses** the next action whenever the harness permits two or more materially
different ones, and it explains why. It also reads the posting, matches the résumé, ranks the
gaps, writes the recommendation and drafts the material.

**Code decides, always** whether an action is permitted at all. A hard-constraint violation
permits exactly one action: reject. A job that clears the fit bar by more than the judgment
zone cannot be rejected. Nothing can produce a draft before a human clicks Approve or Edit. A
fit percentage that could not actually be computed cannot reject anything. The model is not
asked for permission to break these; it is never offered the option.

So the trace labels each step honestly: `model` when the AI chose among real alternatives,
`harness` when only one action was permitted (a guardrail, not a choice), `policy` when the
built-in default chose because no model was configured or the model failed. Roughly half the
steps in a typical run are `harness` — and that is the point. An agent that could be argued
into anything is not more agentic, it is less trustworthy.

## What we got wrong first, and what fixed it

**The score wandered.** The same posting and résumé scored 42% one run and 58% the next. The
cause was not sloppiness in the prompt: every run asked the model to re-read the posting's
requirements, and a model never returns the same list twice, so the denominator moved. We gave
the agent memory — the requirement list is written down the first time a posting is read and
every later run is judged against that same list. Spread went from 12–15 points to 0
(`scripts/stability.ts`). The lesson generalises: *if you want a number to be comparable across
runs, the thing it is measured against has to be stored, not re-derived.*

**We had been grading ourselves on our own homework.** We built and tested on our own fixtures
and our own demo résumé. When we finally ran the instructor's actual starter kit, two of its
six postings behaved wrongly — not because the agent was weak, but because our constraint
parsers only understood *our* phrasing ("Will NOT apply to roles requiring 5+ years") and not
the kit's ("No jobs requiring 5 or more years", "No relocation outside the preferred region").
Testing on data you wrote yourself proves your assumptions agree with themselves.

**One person's profile change moved everyone else's results.** "Active profile" was a single
global flag on a public site. Each browser now has its own workspace. Multi-user behaviour is
not something to leave until auth exists; shared mutable state is a bug with or without logins.

## What we would do next

Extraction from two-column PDFs can interleave lines — we show the extracted text for the
person to correct rather than pretend it is always clean. Without an AI model the keyword
fallback only understands analytics roles; it now says so instead of scoring 0% and rejecting.
And the matcher can still award half credit for an adjacent subject (a maths teacher against a
physics requirement); code guarantees it is labelled partial and quote-backed, but the judgement
itself is the model's, and a human reads it. Those are the limits we would work on next, and
they are written down here rather than left for a grader to find.
