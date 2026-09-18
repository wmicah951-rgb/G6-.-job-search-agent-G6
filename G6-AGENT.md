# G6 Agent — Job Search Agent (Plain-Language Rundown)

This is the one file to read (or read *from*, in class) to explain what this
agent is and how it works, top to bottom, in plain language. The deeper,
file-by-file technical breakdown still lives in `docs/architecture/` if you
need to point to exact code or want more depth on any one piece — this file
is the simple version that covers all nine layers of it in one place, plus an
upfront mapping (Layer 0) showing exactly how it lines up against the class's
own reference architecture.

---

## Layer 0 — How this maps to the class's own architecture table

CIS 4394's own "Transfer" exercise asks you to fill in a table mapping a
coding-agent's shape (Codex) onto a job-search agent's shape, then compare it
against a reference mapping. Here's our actual implementation lined up
against that exact reference, row by row — this table *is* the architecture
diagram deliverable, filled in against real code instead of a guess:

| Layer | Class's reference mapping | What we actually built |
|---|---|---|
| **Goal** | Find suitable entry-level jobs | Same. |
| **Environment** | Résumé + preferences + job postings | Same — a résumé + preferences pair (we call the pair a "profile"; you can save more than one), plus job postings pasted in or scraped from a URL. |
| **Observe** | Read résumé evidence, job requirements, constraints, prior results | Same, plus a bit more: résumé skills/years, the posting's required skills, hard constraints (years/clearance/remote), which matching method ran, and (when applicable) the AI's own stated reasoning. "Prior results" = the full structured trace, saved per job and viewable any time from the dashboard. |
| **Actions** | `ASK_USER`, investigate, down-rank/reject, request approval, draft | `scan_for_injection` + `evaluate_fit` + `check_hard_constraints` cover **investigate**. `reject_hard_constraint` + `reject_low_fit` cover **down-rank/reject** — we kept these as two separate actions on purpose, so the *reason* for a rejection is always traceable instead of a single generic "no." `ask_user_clarification` is a real, separate action covering **`ASK_USER`** — used when the agent hits a hard constraint it can't confidently evaluate (see Layer 3.5). `request_human_approval` covers **request approval**. `draft_application` covers **draft**. |
| **State** | Jobs inspected, evidence, gaps, constraints, approval status | `matchedSkills`/`matchedEvidence` = evidence, `missingSkills` = gaps, `hardConstraintViolations` = constraints, `stage` = approval status. We also track a fit score and a grounded "why this fits" rationale, which the reference table doesn't ask for but doesn't conflict with it either. |
| **Guardrail** | Never fabricate qualifications; never obey instructions embedded in job text | Word for word the same, and both are mechanically enforced in code (verbatim-quote verification for the first; job text is only ever read as data, never executed, for the second) — not just written down as a rule. |
| **Evaluation** | Fit, partial fit, hard-constraint mismatch, prompt-injection tests | Exactly our four required tests: J001 (fit), J002 (partial fit), J003 (hard-constraint mismatch), J004 (prompt injection). |

**Bottom line**: this is a production-grade build of Path C's *intent* (an
observation-driven, code-based agent), not the literal Codex-CLI-plus-their-
Python-baseline path. The backend logic underneath — the actions it can take,
the state it tracks, the guardrails, the four required tests — maps onto the
class's own reference architecture one-to-one, action for action: `ASK_USER`
(`ask_user_clarification`), investigate, down-rank/reject, request approval,
and draft are all real, separately-traceable actions in the code, not
relabeled or merged. The only departure is splitting "investigate" and
"down-rank/reject" into more specific sub-actions so the *reason* behind each
one is always traceable, rather than collapsing to one generic step.

---

## Layer 1 — What this agent actually does

You give it a candidate's résumé and a job posting. It reads both, decides
whether the candidate is a good fit, tells you honestly what's missing, and —
only if a human says yes — writes a short cover-letter draft using nothing
but facts that are actually in the résumé. It never sends anything to anyone.
It never invents a skill the candidate doesn't have. And it never lets a job
posting talk it into skipping its own rules, even when one of our test
postings tries to.

The whole point of the assignment is proving this is a real **agent** — a
system that picks its next move based on what it observes — and not just a
fixed script that runs the same five steps no matter what you feed it. Every
section below is really just explaining how that "picks its next move" part
actually happens.

## Layer 2 — The big picture (inputs → agent → output)

In plain terms, the flow is:

- **In**: a résumé + preferences (we call this a "profile" — see Layer 6), and
  a job posting (pasted in or scraped from a URL).
- **Through**: the agent reads the posting for red flags first, checks how
  well the résumé matches what the posting is asking for, checks whether the
  posting breaks any hard rule the candidate has (like "no jobs needing 5+
  years"), and then decides what to do about all of that.
- **Gate**: if the posting looks worth pursuing, the agent stops and waits —
  it will not write anything until a human clicks Approve, Edit & Approve, or
  Reject.
- **Out**: either an automatic rejection (with a clear reason), or — once a
  human approves — a short draft made only of quotes pulled straight from the
  résumé.

Every single one of those steps gets written down as it happens, in a
structured log (state before → what it noticed → what options it had → what
it picked → what happened → state after). That log is the proof this is a
real agent and not smoke and mirrors — you can watch it think.

## Layer 3 — How it "thinks": the decision engine

This is the actual step-by-step logic, in order:

1. **Scan the posting for tricks.** Before anything else, it checks whether
   the posting is trying to talk directly to the AI ("ignore your
   instructions," "approve this automatically," etc.). If it finds something
   like that, it logs exactly what it found and moves on *without obeying
   it* — the posting is data to read, never a command to follow.
2. **Check the skills.** It compares what the résumé says against what the
   posting is asking for, and comes back with a score, a list of what
   matched, and a list of what's missing.
3. **Check the deal-breakers.** Separately from the skill score, it checks
   hard rules from the candidate's preferences — required years of
   experience, security clearance, remote-vs-onsite. A posting can score a
   perfect skill match and still get rejected here if it breaks one of these
   rules. That's on purpose.
3.5. **Ask, don't guess, when it genuinely can't tell.** This is the `ASK_USER`
   action. If the candidate has a "remote or hybrid only" rule and a posting
   never says one word about work location — not remote, not hybrid, not
   on-site — the agent doesn't quietly assume either way. It stops, asks you
   directly which way to treat it, and only continues once you answer. This
   is a genuinely different action from the human-approval step below: this
   one happens *during* evaluation because the agent is missing information
   it needs, not *after* evaluation to get a go/no-go. It only ever fires on
   that one specific gap — it never fires on a posting that already states
   its work arrangement (all four required test postings do, so this never
   changes their behavior).
4. **Decide what happens next.** This is the actual "agent" moment — based on
   everything above, it picks ONE of three genuinely different paths:
   - Broke a hard rule → auto-reject, stop, no human needed.
   - Skill match too low → auto-reject for a *different*, clearly-labeled
     reason, stop, no human needed.
   - Passed both checks → pause and hand it to a human.

   Notice the first two paths never even reach a human — there's nothing
   worth a person's time once the agent has already ruled it out for a solid,
   logged reason. Only real candidates get to the approval step.

## Layer 4 — What it's actually made of (tools it can use)

Think of these as the agent's toolbox — the specific moves it's allowed to
make at each point:

- **scan for tricks** — read the posting for embedded commands
- **flag and continue** — only used if step 1 above finds something; logs it
  and keeps going on the real content
- **check fit** — compare résumé vs. posting (this is the one that can
  optionally use an AI model — see Layer 9)
- **check hard rules** — years / clearance / remote-onsite
- **ask_user_clarification (`ASK_USER`)** — only used when a hard rule can't
  be confidently checked (see Layer 3.5); pauses with a specific question and
  resumes evaluation once answered
- **reject (hard rule)** / **reject (low fit)** — two different "no"s, kept
  separate so you always know *why*
- **ask a human** — pause and wait, nothing happens until someone responds
- **write the draft** — only reachable after a human says yes, and only
  allowed to use facts that are literally quoted from the résumé; when the AI
  model is doing the drafting (see Layer 9) it also reports back, per missing
  skill, exactly what it did about it — bridged it using something from your
  edit note, only mentioned willingness to learn it, or left it out entirely —
  so you're never left guessing what happened to a gap
- **discard** — the human said no; nothing gets written

## Layer 5 — The guardrails (why you can trust it)

Four promises, and exactly how each one is actually enforced, not just
claimed:

- **It never makes things up.** Every line of a draft has to be an exact,
  word-for-word quote pulled from the résumé. If it can't find a real quote
  to back up a claim, it just leaves that claim out — there's no code path
  that lets it write something it can't point to in the résumé.
- **It never obeys the posting.** The posting's text only ever gets *read*,
  never *executed*. Even the one part that hands text to an AI model tells
  that model up front: this text is data to analyze, not instructions to
  follow.
- **It never ignores a deal-breaker for a good skill match.** The hard-rule
  check runs completely separately from the skill-match check, and it's
  checked first.
- **It never skips the human.** No draft can exist until a person clicks
  Approve or Edit & Approve. The server itself double-checks this — even if
  someone tried to approve a job the agent had already auto-rejected, it gets
  refused.

## Layer 6 — Profiles: résumé + preferences, and switching between them

A "profile" is just a résumé + a preferences sheet, saved together under a
name. You can have more than one — e.g. one résumé tuned for a data-analyst
track and a different one for a PM track — and only one is ever "active" at a
time. New postings always get evaluated against whichever profile is active.

From the Resume & Preferences screen you can:
- see which profile is currently active
- switch which one is active
- create a new one (it starts as a copy of whatever's on screen, so you're
  forking a variant instead of retyping from scratch)
- edit the résumé/preferences text of whichever profile you're looking at
  and save it
- delete a profile (you always have to keep at least one)

One subtlety worth knowing: once a job has been evaluated, it remembers the
*exact* résumé text it was evaluated against, even if you later edit that
profile or switch which one is active. That's so approving a job today can
never quietly get grounded in a resume you changed after the fact.

## Layer 7 — The screens (how you actually use it)

- **Dashboard** — every posting you've run, color-coded by score and by
  status, plus a status strip showing whether the database, the AI matching,
  and the scraper are all working.
- **Add a posting** — paste text, or try a URL and let it scrape the page (it
  tells you honestly when a site can't be scraped, rather than guessing).
- **Job detail** — the full breakdown for one posting: score, what matched,
  what's missing, *why it's a genuine fit* (a separate, positive-only
  explanation — not just the same list flipped around), any deal-breakers,
  any trick it caught, the Approve/Edit/Reject buttons, the resulting draft,
  and a button to see the full step-by-step trace. Once a draft exists, the
  cover letter and tailored resume can each be copied or downloaded as a PDF.
- **Resume & Preferences** — profile management, described in Layer 6.

## Layer 8 — The evidence (this is what proves it's a real agent)

We ran the four required test postings and got four **different** step-by-
step paths, not four copies of the same steps with different numbers:

- An obvious-fit posting → paused for a human, like it should.
- A partial-fit posting → auto-rejected for low fit.
- A posting with a great skill match but a dealbreaker (needs 5+ years,
  wants a security clearance) → auto-rejected for the *rule*, not the fit —
  even with a perfect skill score.
- A posting with hidden text trying to trick the AI into auto-approving
  itself, skipping the human step, and printing the résumé out raw → the
  agent caught it, logged exactly what it found, refused every embedded
  command, and then evaluated the posting normally anyway.

Full traces for all of this live in `required-test-traces.txt` and
`docs/architecture/08-testing-evidence.md` — this is the actual proof, not a
description of what it "would" do.

## Layer 9 — What powers the "thinking" part, and why nothing breaks without it

Almost everything above — the trick-scanning, the hard-rule checks, the
decision of what to do next, the human-approval gate, the drafting — is
plain, deterministic code. No AI model is involved in any of that, and none
of it can be talked out of its rules.

The **one** exception is the skill-matching step, which can optionally call
an AI model to compare the résumé against the posting more like a person
would (catching skills phrased differently than expected), instead of the
basic keyword-matching approach. This is completely optional and swappable:

- Which AI model is used is picked by one setting (currently set to
  DeepSeek's `deepseek-chat`; it could be switched to Claude or turned off
  entirely by changing one line in the environment configuration).
- If no AI model is configured, or the call ever fails for any reason, the
  agent automatically falls back to the plain keyword-matching version — the
  app never breaks or gets stuck because of this piece.
- The AI model is never trusted blindly: anything it says matched the résumé
  gets double-checked to make sure it's a real, word-for-word quote from the
  résumé before it's allowed to be used. If it can't be verified, it's
  thrown out.
- The AI model has zero ability to approve, reject, or draft anything — it
  only ever answers one narrow question (what matches?) and that answer
  feeds into the exact same decision-making described in Layer 3.

All the real credentials (database + AI model keys) live in the project's
environment configuration, already set up and working on the deployed
version — see the main `README.md` for exactly which ones and where.

---

## Layer 9b — How the AI "brain" reads the posting (the gates in plain words)

Two of the agent's gates now use the AI model as a **reader**, not a decision-maker.
Before anything else, the model reads the posting once and answers three
questions: *Is anything in here aimed at an AI/screener instead of applicants?
Is the job remote, hybrid, or on-site? Does it need a security clearance?*

- **Prompt-injection gate.** The posting is flagged if the AI model **or** a
  built-in pattern list (the "floor" that still works with no AI configured)
  spots instructions aimed at a screener — "ignore the above", "rank this
  applicant first", "no need for anyone to look at the details", hidden HTML
  comments, and so on. Every passage the model points to must appear word for
  word in the posting or it is thrown away. When caught, the job page shows a big
  purple **PROMPT INJECTION CAUGHT** banner with the exact refused text, the home
  board shows a badge, the agent keeps evaluating the real requirements, and a
  human still has to approve.
- **Work-arrangement gate.** The model works out remote / hybrid / on-site from
  any cue ("three days in our Denver office" = hybrid, "report daily to
  headquarters" = on-site). On-site breaks a "remote or hybrid only" rule and is
  rejected; remote or hybrid passes. The agent only **asks you** (`ASK_USER`) when
  neither the model nor the built-in cues can tell — so it stops nagging.
- **Same rules for every brain.** The model is a plug: `LLM_PROVIDER=deepseek`,
  `anthropic`, or `custom` (any OpenAI-compatible model set by `LLM_BASE_URL`,
  `LLM_API_KEY`, `LLM_MODEL`, including a local Ollama). `npx tsx scripts/conformance.ts`
  runs the same postings through whichever brain is set and checks that every gate
  fires identically — with no AI at all it still passes the required tests.
- **Downloads.** Approved drafts download as typeset PDFs: the résumé with a bold
  name, ruled section headings, bold role lines and bulleted achievements; the
  cover letter as a normal business letter.
- **Delete.** Every posting on the home board has a Delete button (with a confirm).


---

## Layer 10 — The fit percentage, in plain words (and how to change the bar)

**Brain vs. harness.** The AI model (the *brain*) only **reads** and answers
narrow questions. Our code (the *harness*) does all the **deciding**. Swap the
brain (DeepSeek, Claude, any OpenAI-compatible model) and the rules stay the same.

**How the percent is worked out**
1. The brain lists only the real *screening requirements* in the posting: skills,
   tools, domain knowledge, degrees, certifications, years of experience.
   It must **not** count job duties ("build dashboards"), soft skills
   ("good communicator"), the company blurb or benefits.
2. Each requirement is either **required** (counts 1) or **preferred** — "a plus",
   "nice to have", "bonus" (counts ½).
3. For each one it must show a **word-for-word quote from the résumé**. No quote =
   it does not count as matched (and is never used in a draft).
4. `score = points matched ÷ points possible`.

**Where the bar is.** `preferences.md` has a line `Minimum fit: 60%`. Jobs scoring
below it are auto-rejected as *low fit*. Change the number (10–90) to be pickier
or looser. It is per profile, so each teammate can set their own.

**Years of experience.** The résumé is read for "Total professional experience:
~2 years", then "N years of experience", then the date ranges of the jobs
("Jan 2021 – Mar 2023", "2019 – Present"). Overlapping jobs are counted once.

**Swap the brain.** In `.env.local`: `LLM_PROVIDER=deepseek | anthropic | custom`
(custom = `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`). Leave it empty for no AI at all.

## Layer 11 — How to test everything (copy/paste)

| What | Command | Proves |
|---|---|---|
| The 4 required class tests + extras J005–J009 | `npx tsx scripts/run-tests.ts` | Different action sequences per input |
| Same tests on whatever brain is set | `npx tsx scripts/conformance.ts` | Every brain behaves identically |
| Whole app over HTTP (needs `npm run start`) | `node scripts/local-e2e.mjs` | Gates, ASK_USER, Approve / Edit / Reject, the "add skill" bridge, 409 guards, delete |

**Human-in-the-loop, tested:** Reject → no draft, and approving afterwards is
refused (409). Edit with a note → draft made; the note is recorded; a skill
the candidate says they have (via the "add skill" button) is reported
`bridged_from_note`; with no note the gap is **never** claimed as experience.

**Privacy note:** this project is public. Profiles must contain **fictional** information only.

---

## Layer 12 — Partial credit, so internships and coursework count

A requirement used to be all-or-nothing: you either had it or you didn't. That
scored a résumé saying "A/B test reporting basics" as a **total miss** on a job
asking for "A/B testing", which is wrong and pushes real candidates below the bar.

Each matched requirement now carries a **strength**:

| | full | partial | missing |
|---|---|---|---|
| **required** | 1.0 | 0.5 | 0 |
| **preferred** ("a plus") | 0.5 | 0.25 | 0 |

**Partial** means the résumé names *the same* skill at lower depth — internship,
coursework, capstone, "basics", "exposure to", or an assisting rather than owning
role. The job page shows these with an amber `(partial)` tag.

**The strict limit matters as much as the credit.** Partial is only for the same
named skill. A *different* skill is a miss, never a partial. "Basic regression
analysis in R" does **not** partially satisfy "machine learning / deep learning
model building", and Power BI does not partially satisfy Tableau. Without that
limit the score inflates and you walk into an interview defending a stretch.

## Layer 13 — Verifying what the AI wrote (the receipts)

The cover letter and tailored résumé are written by the model, which is asked to
rephrase. So we cannot demand word-for-word quotes there the way we do for skill
matching. Instead, after every draft the agent runs a `verify_draft` step:

> **Rewording can only clear a sentence. Only an unsourced hard fact can flag one.**

A sentence is never flagged for sounding different. It is flagged when it contains
a **number, employer, tool or credential that appears in neither your résumé nor
the note you typed**. Every sentence gets labelled:

- **From your resume** / **Reworded** — traced back to a line you wrote.
- **From your note** — came from the bridging experience you supplied.
- **States a gap** — names a skill in order to say you *don't* have it yet. Honest.
- **Opinion** — framing with no checkable claim.
- **Check this** — red. A specific it cannot source.

Flagged lines are shown to you and **never silently deleted**. You decide. The
panel also lists lines from your original résumé that did **not** make it into the
tailored version, so nothing disappears quietly.

Run `npx tsx scripts/verify-tests.ts` to see this proven. The hardest test is a
heavily reworded but completely honest résumé that must produce **zero** flags —
because a checker that cries wolf is one you stop reading.

## Layer 14 — "Apply anyway": you can overrule the agent

A low score is a screening shortcut, not a verdict on you. The agent still
auto-rejects everything under your bar on its own — that branch is untouched and
is one of the four required class tests.

But a rejected job is no longer a dead end. Its page offers **"Apply anyway — I'll
bridge the gaps"**, with a box to say why. That:

- adds a `human_override_low_fit` step to the decision trace, so the record shows
  **you** overrode the agent — never that the agent lowered its own bar;
- leaves the fit score and the gap list exactly as they were;
- reopens the job at the normal approval gate, where your reason is passed into
  the draft so it can bridge the gaps honestly.

Hard-constraint rejections (years, clearance, on-site) are **not** overridable
here — those are your own stated non-negotiables, not a heuristic.
