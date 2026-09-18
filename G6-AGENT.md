# G6 Agent — Job Search Agent (Plain-Language Rundown)

This is the one file to read (or read *from*, in class) to explain what this
agent is and how it works, top to bottom, in plain language. The deeper,
file-by-file technical breakdown still lives in `docs/architecture/` if you
need to point to exact code or want more depth on any one piece — this file
is the simple version that covers all nine layers of it in one place.

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
- **reject (hard rule)** / **reject (low fit)** — two different "no"s, kept
  separate so you always know *why*
- **ask a human** — pause and wait, nothing happens until someone responds
- **write the draft** — only reachable after a human says yes, and only
  allowed to use facts that are literally quoted from the résumé
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
  and a button to see the full step-by-step trace.
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
