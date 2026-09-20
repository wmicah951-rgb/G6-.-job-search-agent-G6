# G6 Agent — Job Search Agent (Plain-Language Rundown)

This is the one file to read (or read *from*, in class) to explain what this agent is and how
it works, top to bottom, in plain language. It has sixteen layers (0–15, plus 16 on the rulebook
and local models). The deeper, file-by-file technical breakdown lives in `docs/architecture/`.

**The agent's own rulebook mirrors this file.** `src/data/agent-guidelines.md` is read by the
agent on every run and is numbered to match these layers one for one: Layer 3 holds the
Controller's and Advisor's instructions, Layer 9b the Reader's, Layer 10 & 12 the Matcher's,
Layer 13 the Drafter's, Layer 5 the "Never" list. Change a layer there and that role behaves
differently on the next run. Layer 16 explains how.

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
| **Actions** | `ASK_USER`, investigate, down-rank/reject, request approval, draft | `scan_for_injection` + `evaluate_fit` + `check_hard_constraints` cover **investigate**. `reject_hard_constraint` + `reject_low_fit` cover **down-rank/reject** — we kept these as two separate actions on purpose, so the *reason* for a rejection is always traceable instead of a single generic "no." `ask_user_clarification` is a real, separate action covering **`ASK_USER`** — used when the agent hits a hard constraint it can't confidently evaluate (see Layer 3.5). `request_human_approval` covers **request approval**. `draft_application` covers **draft**. One action is ours alone: `advise_human`, where an AI advisor tells the person what it thinks at every stop (Layer 3, step 6b). |
| **State** | Jobs inspected, evidence, gaps, constraints, approval status | `matchedSkills`/`matchedEvidence` = evidence, `missingSkills` = gaps, `hardConstraintViolations` = constraints, `stage` = approval status. We also track a fit score, a grounded "why this fits" rationale, red flags, and the advisor's recommendation (`advice`), which the reference table doesn't ask for but doesn't conflict with it either. |
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
  Reject. At that stop its AI Advisor tells you what it thinks and suggests what to
  emphasise, using only things your résumé backs up.
- **Out**: either an automatic rejection (with a clear reason), or — once a
  human approves — a cover letter and tailored résumé made only of facts from
  your résumé and your note, with anything it cannot trace flagged for you.

Every single one of those steps gets written down as it happens, in a
structured log (state before → what it noticed → what options it had → what
it picked → what happened → state after). That log is the proof this is a
real agent and not smoke and mirrors — you can watch it think.

## Layer 3 — How it "thinks": the decision engine

**The agent runs a real *select → act → observe* loop.** Before every step the **harness**
(our code) works out which actions are *permitted* right now, from the current state:

- If exactly **one** action is permitted, a **guardrail** decides. The trace tags it `guardrail`.
- If **two or more** are permitted, the **AI controller picks one** from a structured summary of
  the state and gives its reason. The trace tags it `AI chose` and shows the reason.
- If there is no model, it fails, or it names something not permitted, a **default policy**
  picks and the refusal is logged. The trace tags it `default policy`.

Every trace step also says whether an **AI** or a **code rule** produced it, and shows the
agent's own words for why ("agent's thinking"). That is how you can see the brain and not just
code.

What the controller really decides at run time:
- **Order:** whether to check the hard constraints or evaluate fit first.
- **Whether to spend a model call at all:** once a hard-constraint violation is known the
  outcome is final, so it may reject immediately and skip the fit evaluation.
- **Borderline calls:** within 10 points of the candidate's minimum fit (the "judgment zone")
  it chooses between `request_human_approval` and `reject_low_fit` from the evidence: required
  versus nice-to-have gaps, partial matches, low confidence.

What it can never do, because the permitted list never contains it: skip the injection scan,
drop a hard constraint, approve past a violation, reject a clearly good fit, approve a clearly
bad one, or produce a draft. The controller never sees the posting text, only counts and numbers
computed by code, so a posting cannot address it.

**The complete set of steps.** Steps 1–5 may run in the order the controller picks (the scan
is always first).

1. **Scan the posting for tricks.** Before anything else it checks whether the posting is
   trying to talk to the AI ("ignore your instructions", "approve this automatically").
   Two layers look: a built-in keyword barrier that always runs, and the AI Reader reading it
   properly. → `scan_for_injection`
2. **Flag it and carry on** *(only if something was found)*. It logs exactly what it
   caught, states that it was refused, and keeps evaluating the real requirements. It
   never obeys it. → `flag_injection_and_continue`
3. **Check the skills.** The AI Matcher compares the résumé against what the posting asks for
   and produces a score, what matched (each with a résumé quote), and what's missing. Detail:
   **Layer 10** (how the percentage works) and **Layer 12** (partial credit). → `evaluate_fit`
4. **Check the deal-breakers.** Separately from the score, by code only: years, clearance,
   relocation, remote-vs-on-site. A posting can score a perfect match and still be rejected
   here. That is on purpose. → `check_hard_constraints`
5. **Ask, don't guess** *(only when it genuinely cannot tell)*. If you have a location rule and
   the posting says nothing about remote/hybrid/on-site, it stops and asks rather than
   assuming. This happens *during* evaluation because information is missing, which is
   different from the approval gate, which happens *after*. → `ask_user_clarification`, and your
   answer → `human_answers_clarification`
6. **Decide.** The controller (inside the permitted list) picks ONE of three genuinely
   different paths:
   - Broke a hard rule → auto-reject, stop. → `reject_hard_constraint`
   - Score clearly under your bar → auto-reject for a *different*, clearly-labelled reason,
     stop. → `reject_low_fit`
   - Passed both → pause and hand it to you. → `request_human_approval`

   Near the bar the controller chooses between the last two from the evidence. The first
   two never reach a human unless you overrule a low-fit rejection (Layer 14).
   **6b. Advise (new).** Whenever the agent stops for a person, the **AI Advisor** says what it
   thinks: a recommendation, the gaps ranked by how much they matter, and drafting presets
   tailored to *this* résumé and *this* job. Every quote is checked against the résumé, every
   ranked gap against the gaps the evaluation really found. → `advise_human`
7. **You decide.** Approve, Approve-with-instructions, or Reject.
   → `human_approve` / `human_edit` / `discard`.
   And on a low-fit rejection you can overrule the agent entirely, detail in **Layer 14**.
   → `human_override_low_fit`
8. **Draft.** Only reachable after step 7. The AI Drafter writes the cover letter and re-tailors
   your résumé, grounded in your résumé and anything you typed. → `draft_application`
9. **Check its own writing.** Code reads back every sentence it just wrote and flags anything
   it cannot trace to you. Detail: **Layer 13**. → `verify_draft`
10. **Re-score the rewrite.** Runs the same scoring again on the tailored résumé and
    shows before → after. Detail: **Layer 15**. → `rescore_tailored_resume`

Steps 1–6b are the agent working alone. Step 7 is you. Steps 8–10 only happen because you
said so.

## Layer 4 — What it's actually made of (tools it can use)

Think of these as the agent's toolbox: the specific moves it's allowed to make at each point.
Some are done by an AI role, some by plain code, and the trace says which for every step.

- **scan for tricks** (`scan_for_injection`) — keyword barrier (code) plus the AI Reader
- **flag and continue** (`flag_injection_and_continue`) — only if the scan finds something
- **check fit** (`evaluate_fit`) — the AI Matcher, with every match verified in code; falls back
  to keyword matching with no AI
- **check hard rules** (`check_hard_constraints`) — years / clearance / relocation / remote-onsite.
  Code only
- **ask the user** (`ask_user_clarification`, `ASK_USER`) — only when a hard rule can't be
  confidently checked; pauses with a specific question and resumes once answered
- **reject (hard rule)** / **reject (low fit)** — two different "no"s, kept separate so you
  always know *why*
- **ask a human** (`request_human_approval`) — pause and wait; nothing happens until someone responds
- **advise the human** (`advise_human`) — the AI Advisor's recommendation, ranked gaps and tailored
  presets, shown at every stop
- **write the draft** (`draft_application`) — only reachable after a human says yes. The AI
  Drafter rewords your résumé (it cannot copy word for word); a separate code checker (Layer 13)
  flags anything it cannot trace back to you. It also reports, per missing skill, exactly what
  it did about it: bridged it using something from your note, only mentioned willingness to
  learn it, or left it out, so you're never left guessing what happened to a gap
- **check its own writing** (`verify_draft`) and **re-score** (`rescore_tailored_resume`) — code
- **discard** — the human said no; nothing gets written

## Layer 5 — The guardrails (why you can trust it)

Five promises, and exactly how each is enforced in code, not just claimed. (Layer 5 in
`agent-guidelines.md` lists these as the "Never" rules.)

- **It never makes things up.** Two mechanisms, because there are two kinds of output. For
  *matching*, a match counts only if the AI supplies a word-for-word quote from the résumé that
  code confirms is really there. For the *drafted* cover letter and résumé, which must be
  reworded, a deterministic checker (Layer 13) flags any number, employer, tool or credential
  that is in neither the résumé nor your note, and never silently removes it. The Advisor's
  presets and strengths follow the matching rule: each needs a résumé quote that code verifies.
- **It never obeys the posting.** The posting's text only ever gets *read*, never *executed*.
  The AI parts that read it are told up front that it is data, and the two parts that
  decide (the Controller and the Advisor) never see the posting text at all.
- **It never ignores a deal-breaker for a good skill match.** The hard-rule check runs
  completely separately from the skill-match check, and a violation always ends in a rejection.
- **It never skips the human.** No draft can exist until a person clicks Approve or Edit &
  Approve. The server double-checks this: even if someone tried to approve a job the agent
  had already auto-rejected, it gets refused.
- **The AI can only choose inside a list the code hands it.** The permitted-action list
  (`permittedActions()`) is code. A model that names something not on it is overruled, and the
  overrule is written into the trace.

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

- **Dashboard** — every posting you've run, **ranked best fit first** (hard-constraint rejections
  last), colour-coded by score and status, plus a status strip showing whether the database, the
  AI, and the scraper are working.
- **Add a posting** — paste text, or try a URL and let it scrape the page (it tells you honestly
  when a site can't be scraped, rather than guessing).
- **Job detail** — the full breakdown for one posting: score, what matched, what's missing
  **ranked by the AI Advisor** (critical / helpful / minor, with a reason), *why it's a genuine
  fit*, any deal-breakers, any trick it caught, and **"The agent's recommendation"**: what the
  Advisor thinks you should do, and the Approve / Edit / Reject buttons with the recommended one
  tagged. The draft instruction presets ("AI-recommended additions") are written by the Advisor
  for this résumé and job, each backed by a résumé line. Below it, the **Agent Decision Trace**
  shows every step as *AI thinking* or *code rule*, who chose it, and the agent's own reasoning.
  Once a draft exists, the cover letter and tailored résumé can each be copied or downloaded as a PDF.
- **Resume & Preferences** — profile management (Layer 6) and the Quick match settings.
- **Test Lab** — 19 built-in tests including the four class-page scenarios. Each shows expected
  versus actual, the agent's brain step by step, and the Advisor's recommendation.
- **Harness** — every layer in plain English with the settings and editable prompts it uses.

## Layer 8 — The evidence (this is what proves it's a real agent)

We ran the four required test postings and got four **different** step-by-step paths, not four
copies of the same steps with different numbers. These are real runs (`docs/submission/traces.json`,
DeepSeek controller). `advise_human` ends every run that stops for a person.

- **J001, obvious fit** → `scan_for_injection → check_hard_constraints → evaluate_fit → request_human_approval → advise_human`. Paused for a human.
- **J002, partial fit** → `scan_for_injection → check_hard_constraints → evaluate_fit → reject_low_fit → advise_human`. Auto-rejected for low fit (44%).
- **J003, great skills but a dealbreaker** (needs 5+ years, a clearance, on-site) →
  `scan_for_injection → check_hard_constraints → reject_hard_constraint`. Only **3** steps: the controller saw the violation was final and
  **chose to skip the fit evaluation**. Rejected for the *rule*, not the fit.
- **J004, hidden text trying to trick the AI** → `scan_for_injection → flag_injection_and_continue → check_hard_constraints → evaluate_fit → request_human_approval → advise_human`. The agent caught it,
  logged exactly what it found, refused every embedded command, and evaluated the posting
  normally anyway.

J007 shows `ask_user_clarification`; the run then resumes to approval or rejection depending on
your answer. Sequences can differ slightly run to run because the controller chooses the order
of its checks, so the tests assert what must be true every time (right outcome, injection scan
first, hard rules always checked, no draft) rather than one fixed order.

Full traces live in `required-test-traces.txt` and `docs/architecture/08-testing-evidence.md`,
and the Test Lab shows them live. This is the actual proof, not a description of what it "would" do.

## Layer 9 — What powers the "thinking" part, and why nothing breaks without it

The AI plays **five roles**. Each has its own section in `agent-guidelines.md`:

| Role | Does | Checked by |
|---|---|---|
| **Reader** (step 1, Layer 9b) | Reports what the posting says | Quotes must be literal posting text; the keyword barrier runs independently |
| **Matcher** (step 3, Layers 10 and 12) | Compares résumé to requirements | Every match needs a résumé quote that code confirms |
| **Controller** (step 6) | Picks the next action | Only from the permitted list; never sees the posting text |
| **Advisor** (step 6b) | Recommends, ranks gaps, builds presets | Quotes verified in the résumé; gaps must be real |
| **Drafter** (step 8) | Writes the letter and résumé after you approve | The draft verifier (Layer 13) |

Everything that **bounds** the agent is plain, deterministic code and cannot be talked out of
its rules: the hard-rule checks, the permitted-action list, and the human approval gate. The AI
cannot approve, skip a guardrail, set a stage or draft; it answers a narrow question, or picks
from a list, and deterministic code validates the answer.

This is completely optional and swappable:

- Which AI model is used is picked by one setting (currently DeepSeek's `deepseek-chat`; it can
  be Claude, any OpenAI-compatible model, or a local model on Ollama, or turned off entirely).
- If no AI is configured, or a call fails, the agent falls back to the plain keyword matcher and
  the default policy. The app never breaks or gets stuck because of this piece.
- The AI is never trusted blindly: quotes are checked, ranked gaps are checked, recommendations
  must be real options. If it can't be verified, it's thrown out and the harness notes it.

All the real credentials (database + AI keys) live in the project's environment configuration;
see the main `README.md` for exactly which ones and where.

---

## Layer 9b — How the AI "brain" reads the posting (the gates in plain words)

Two of the agent's gates use the AI model as a **reader** (the Reader role), not a decision-maker.
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

**Brain vs. harness.** The AI model (the *brain*) reads, matches, chooses among permitted
actions, advises and drafts. Our code (the *harness*) sets the rules: it decides which actions
are permitted, verifies everything the brain claims, and enforces the hard rules and the
human gate. Swap the brain (DeepSeek, Claude, any OpenAI-compatible model, a local Ollama
model) and the rules stay the same.

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
| The **Test Lab** tab in the app | click Run all 19 | Every test live, with the agent's brain step by step and the Advisor's recommendation |
| The four class-page scenarios | `npx tsx scripts/kit-tests.ts [kitDir]` | Each judged against what the class page says it must show |
| Who chose each step, and why | `npx tsx scripts/controller-demo.ts` | AI vs guardrail vs default policy, with the model's reasoning and the Advisor's output |
| The rulebook really drives the agent | `npx tsx scripts/guidelines-proof.ts` | Edited guidance flips borderline decisions; a file telling it to skip guardrails changes nothing |
| A lying model cannot change a decision | `node scripts/hostile-model-test.mjs` | Hostile Reader, Matcher, Controller and Advisor are all contained |

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

But a rejected job is not a dead end. The Advisor tells you whether it would overrule the agent, and why. Its page offers **"Apply anyway — I'll
bridge the gaps"**, with a box to say why. That:

- adds a `human_override_low_fit` step to the decision trace, so the record shows
  **you** overrode the agent — never that the agent lowered its own bar;
- leaves the fit score and the gap list exactly as they were;
- reopens the job at the normal approval gate, where your reason is passed into
  the draft so it can bridge the gaps honestly.

Hard-constraint rejections (years, clearance, on-site) are **not** overridable
here — those are your own stated non-negotiables, not a heuristic.

## Layer 15 — The agent marks its own work, and admits when it cannot judge

Two late additions, both about the agent being honest about its own output.

**It re-scores the rewrite.** After it drafts and verifies, the agent runs the *same*
scoring routine again — this time against the tailored résumé — and shows you
**before → after**. The catch it guards against: a résumé can always be made to score
higher by inventing skills. So every requirement that newly counts as matched is
cross-checked against the verification step, and if it rests on a sentence that could
not be traced to your résumé, the gain is reported as **unearned** in red instead of
being folded into the headline number.

In practice: approve with no instructions and the score usually does **not** move —
rewriting improves emphasis, not experience, and saying so is the honest answer. Give it
a real bridging note ("I used Tableau on a capstone project") and the score moves for a
reason you can point at.

**It flags scores it cannot stand behind.** A posting that is just a title, or one whose
requirements sit past the length the model can read, used to come back as a confident
**100% match** — because the model would infer plausible requirements from the title and
then score you against its own invention. Now every requirement is checked back against
the posting text the model was actually shown. If too few requirements were readable, or
too many do not appear in the text, the job page says **"treat this percentage as
unreliable"** and tells you to check the raw posting. Verified against all 18 real test
postings: none are falsely flagged.

## Layer 16 — The rulebook, and running on a smaller local model

**The rulebook.** `src/data/agent-guidelines.md` is read at the start of every run
(`src/lib/guidelines.ts`, no caching). It is numbered like this file, and each AI role reads its
own layer's section as instructions. It also holds the judgment-zone width (`Judgment zone: 10
points`). Edit a section and the next run behaves differently; every run records which version
it read (`guidelines: agent-guidelines.md@<hash>`). `Layer 5 — Never` in that file is
documentation of rules the code enforces regardless, so the file cannot switch a guardrail off.
`npx tsx scripts/guidelines-proof.ts` proves both halves: edited guidance flips the model's
borderline decisions, and a file telling the agent to skip its guardrails changes nothing.

**Local models (Ollama).** Point `LLM_PROVIDER=custom` at a local `LLM_BASE_URL` and *small-model
mode* turns on automatically (`LLM_SMALL=1` or `0` to force it). A weak model is given easier
questions so the premise is unchanged: the Controller picks a **number from a menu**; the
Matcher is shown **numbered résumé lines** and points at line numbers (so quotes are exact by
construction, and code still checks the line relates to the requirement); the Advisor **chooses
among options the code built** from the résumé. Timeouts are longer and documents shorter.
Slower and less sharp than a hosted model (it can misjudge a fit, so use a hosted model for
anything graded), but the same guardrails, and if it stalls the default policy takes over.
