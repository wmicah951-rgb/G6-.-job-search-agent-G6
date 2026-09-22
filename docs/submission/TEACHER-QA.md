# Questions the instructor is likely to ask — and the answer, with the file to open

Every answer points at code or at a command anyone can run. If a claim here cannot be shown in
under a minute, it does not belong on this page.

## Is it an agent, or a workflow?

**1. Show me that the action sequence changes with the input.**
`outputs/branching_evidence.md` — six kit postings, six different executed sequences from the
same code. J006 never runs the fit evaluation: a hard-constraint violation already settles it.
Regenerate any time with `npx tsx scripts/classkit-run.ts`.

**2. Where exactly does the AI choose the next action?**
`selectAction()` in `src/lib/agent.ts`. It is called only when `permittedActions()` returns two
or more options; the model gets the state summary and the rulebook, and returns one of them. The
trace step records `chosenBy: "model"` and the model's reasoning.

**3. What stops the model choosing something harmful?**
`permittedActions()` builds the list first. A hard-constraint violation permits exactly one
action. No permitted action can produce a draft before a human approves. If the model returns
something outside the list, the harness overrules it and records `overruled` in the trace.

**4. Could you have written this as an if/else chain?**
The gates, yes — they *are* code, deliberately. The choices are not: which action to take when
several are sound, how to rank gaps, what to recommend, what the requirements even are. Run the
same borderline posting twice with different guidance in `agent-guidelines.md` and the decision
changes without a line of code changing (`npx tsx scripts/guidelines-proof.ts`).

**5. How many of the steps are actually the AI?**
Roughly half in a typical run; the trace labels each one `ai` or `code`. We would rather show
that honestly than claim the whole thing is "AI-powered".

## The four required cases

**6. Run the four required cases on the kit's own data.**
`npx tsx scripts/classkit-run.ts` — J001 recommend, J002 recommend with the A/B-testing gap
named, J003 rejected on 5+ years, J004 injection flagged with the AWS gap kept, plus J005 and
J006. Same six outcomes with DeepSeek and with no AI at all.

**7. J004 — show me it did not obey the injection.**
`outputs/trace_J004.json`. The scan step records the snippet and the result line says the
instruction was refused. The AWS certification stays in `missingSkills`. No email exists,
because no action in the entire inventory can send anything.

**8. What if the injection is worded politely, or hidden in a poem?**
`npx tsx scripts/redteam-injection.ts` — 7/7 steering attempts flagged, including flattery,
sabotage ("recommend me horribly"), and "no need for anyone to review this". The keyword floor
catches the blunt ones; the AI reader catches the subtle ones; either one firing is enough.

**9. Does it ever flag an innocent posting?**
`npx tsx scripts/injection-falsepositive.ts` — 0 false positives across 22 clean postings,
including real-world-style ones that talk about "AI tools" and "prompt engineering".

**10. What happens to a posting that says "ignore previous instructions" AND has 5+ years?**
The injected sentence is removed before requirements are read (`factsOnly()` in `agent.ts`), so
a made-up "five years of experience" inside an injection cannot create or dodge a constraint.

## Truthfulness

**11. How do you know it did not invent a qualification?**
Every matched requirement carries an `evidenceQuote` that must be a literal substring of the
résumé; anything else is dropped before scoring (`performFitEvaluation`). Written material goes
through `src/lib/draftVerifier.ts`, which flags unsourced numbers, tools, employers, scope words
("led", "managed") and now certifications.

**12. Could it claim a certification the candidate does not hold?**
That is the kit's third hard constraint and J004's bait. The verifier flags any
"X Certified / certification / licence" phrase unless the résumé names a credential *and* every
qualifier in it ("AWS", "Cloud Practitioner"). `npx tsx scripts/verify-tests.ts`.

**13. Are the missing skills complete, or does it stop at three?**
`npx tsx scripts/gap-completeness.ts` re-reads each posting deterministically and checks every
stated requirement is accounted for as matched, missing, or explicitly "not assessed". Anything
the matcher skipped is shown to the human in its own panel rather than quietly dropped.

## The score

**14. Why doesn't the score change when I re-run it?**
Memory (`src/lib/memory.ts`): the requirement list found the first time a posting is read is
stored, and later runs are judged against that same list; a verdict already reached for the same
posting + résumé is reused outright. `npx tsx scripts/stability.ts` shows spread 0.

**15. Prove that was a real problem, not a story.**
`NO_MEMORY=1 npx tsx scripts/stability.ts` — the same postings drift 12–15 points.

**16. What if I edit my résumé?**
The verdicts no longer apply (they are keyed to the résumé text), so the requirements are judged
again — against the same stored list. The job page shows the old score and the new one.

**17. What does a percentage actually mean?**
Required requirements count 1.0, nice-to-haves 0.5, and partial experience (internship,
coursework, "basics") counts half. The denominator is the stored requirement list. The bar comes
from the candidate's own preferences (`Minimum fit: 60%`), not from us.

## Human in the loop, and safety

**18. Show me the human checkpoint.**
Approve / Edit / Reject on the job page. `state.draft` is null until that click; the approve
route is the only path that can call the drafter. The Test Lab asserts no draft appears without
a human decision.

**19. Can it apply for a job?**
No. There is no action in the inventory that sends, submits, posts or contacts anyone, and no
network call to anything except the model provider and the database.

**20. What if the model is down, or nobody has an API key?**
Everything still runs: a regex injection floor and a keyword matcher take over, the default
policy chooses actions, and the trace says so. `LLM_PROVIDER=none npx tsx scripts/conformance.ts`
— all gates behave identically with no AI at all.

## Anyone's résumé, anyone's job

**21. Does this only work for data analysts?**
`npx tsx scripts/category-matrix.ts` — nursing, teaching, software, skilled trades, retail
management and finance, each with a fit, a partial and a hard-constraint posting. 16/16.

**22. What about a PDF or Word résumé?**
*Resume & preferences* extracts the text (`src/lib/resumeIngest.ts`) and shows it for checking
before saving. It is never rewritten — the agent may only quote what the résumé says.

**23. Two of us use the site at once. Do we interfere?**
No. Each browser has its own workspace (`src/lib/workspace.ts`); profiles, postings and
evaluations belong to it. There is no login, and the cookie is not a password, which is why the
app holds fictional résumés only.

**24. What is the honest weakest point?**
Three. Two-column PDF extraction can interleave lines (we show the text so a person can fix it).
With no model configured the keyword fallback only knows analytics vocabulary — it now says it
cannot assess such a posting instead of rejecting it on a meaningless 0%. And the matcher can
award half credit for an adjacent subject; code forces it to be labelled partial and
quote-backed, but the judgement is the model's.

**25. What would you build next?**
Requirement-level history (which requirement moved when the résumé changed), a second opinion
from a different model on borderline jobs, and extraction that understands two-column layouts.
