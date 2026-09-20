# Screens

## `/` — Dashboard (`src/app/page.tsx`)

Lists every evaluated posting: title, source (pasted or a URL), stage (color-
coded — green tones for approved/drafted, amber for awaiting approval, red for
a hard-constraint auto-rejection, neutral gray for a low-fit auto-rejection or
human rejection), fit score (color-coded to the same tiers the agent itself
decides on — green ≥ 70%, amber ≥ 60%, red below it),
and an "injection flagged" badge when relevant. Backed by `GET /api/jobs`.

**Ranked by default** ("Ranked: best fit first", toggle to "Newest first"):
active jobs sorted by fit score, low-fit rejections next, hard-constraint
rejections last regardless of skill fit — a job the agent rejected on a rule
is down-ranked even at a 100% skill match, and (since the controller may have
skipped the fit evaluation for it) may show no score at all. `#1`, `#2`... rank
badges are shown next to each title while sorted this way.

## `/jobs/new` — Add a posting (`src/app/jobs/new/page.tsx`)

Two modes:
- **Paste text** — always works, any source.
- **Scrape from URL** — best-effort server-side fetch (`POST
  /api/jobs/scrape`), which extracts the largest readable text block from the
  page. Known failure modes it actively detects rather than silently returning
  garbage for: sites that redirect a dead/filled posting to a generic listings
  page, and pages that say the posting is no longer available. Either way it
  surfaces a clear error and drops back to paste-mode.

Submitting calls `POST /api/jobs`, which runs the full agent immediately against
the currently active profile and redirects to the job's detail page.

## `/jobs/[id]` — Job detail (`src/app/jobs/[id]/page.tsx`)

The main evaluation view. Shows, in order:
- Which profile this job was evaluated against
- Fit score (color-coded) and stage (color-coded badge)
- Matched / missing skills
- **Why this role fits you** — the grounded, positive-framed rationale, kept
  visually and structurally distinct from the missing-skills list above it
- Hard-constraint violations, if any (red panel)
- Prompt-injection notice, if any (purple panel) — what was found and that it
  was refused
- **ASK_USER panel** (blue), only shown while `stage === "awaiting_clarification"`
  — the specific question the agent needs answered, **with the AI advisor's
  recommended answer and reasoning**, and "Treat as compatible" / "Treat as a
  violation" buttons (the recommended one tagged "agent recommends"). Distinct
  from the approval gate below: this one appears *during* evaluation, before
  the agent has reached a verdict at all
- **"Apply anyway" panel** (only shown at `stage === "rejected_low_fit"`) — the
  AI advisor's recommendation on whether to override the agent's own
  rejection, the gaps re-ranked by the advisor, and a box to explain why you
  want it anyway (passed to the draft as a bridging note); does not change the
  score or hide the gaps, and records that the *person* overrode the agent
- **The Human Approval Gate** (only shown while `stage === "awaiting_approval"`):
  **"The agent's recommendation"** — the AI advisor's headline, recommended
  button (tagged), and up to three résumé-backed strengths — then
  **"AI-recommended additions"**, drafting-instruction presets built from this
  résumé and this job (each preset's tooltip shows the résumé line behind it;
  none are fixed text), then the editable instructions box and the Approve /
  Edit & Approve / Reject buttons
- The draft, once one exists, plus the draft-verification panel (which claims
  traced, which didn't) and the re-score panel (before → after, unearned gains
  called out)
- A toggle to show the full structured decision trace — the literal evidence
  artifact for the assignment's testing requirement. Every step shows a
  🧠 **AI thinking** / ⚙ **code rule** badge, who chose it (AI chose / guardrail
  / default policy), the permitted options when there was a choice, and the
  agent's own reasoning in its own words
- The raw posting text, collapsed by default

Backed by `GET /api/jobs/[id]`, `POST /api/agent/clarify`,
`POST /api/agent/approve`, and `POST /api/agent/override`.

## `/testlab` — Test Lab (`src/app/testlab/page.tsx`)

19 built-in test cases (the four the assignment requires, four rebuilt from
the class Week 2 "Evaluate" page descriptions — K001-K004 — plus branching,
injection-escalation and false-positive-control cases), grouped and run
against the **real agent** via `POST /api/testlab`. Each result shows expected
vs. actual, the agent's brain step by step (same AI-thinking/code-rule/who-
chose-it detail as the job detail trace), and the advisor's recommendation.
Nothing here is saved to the job board. "Run all" runs them sequentially so a
live pass/fail tally is meaningful.

## `/harness` — Harness (`src/app/harness/page.tsx`)

Every layer of the agent in plain English, the settings it actually uses
(thresholds, timeouts, judgment-zone-adjacent knobs), and the editable *prose*
portion of each AI role's prompt — per profile, with Reset. Only free prose is
editable; the JSON schema a role must reply in is fixed, so a bad edit can
degrade wording but cannot break parsing.

## `/upload` — Resume & Preferences / Profiles (`src/app/upload/page.tsx`)

Manages one or more named profiles (see [05-data-model.md](05-data-model.md)):

- A dropdown to switch which profile you're viewing/editing
- "Make active" to change which profile new job evaluations use
- "+ New profile (copy current)" — forks whatever's currently on screen into a
  new named profile, so you can try a different resume framing without losing
  the original
- "Delete profile" (disabled when it's the only one left)
- The resume.md / preferences.md text areas and a Save button, which save to
  whichever profile is currently selected — not necessarily the active one, so
  you can edit a profile you're not using yet

This is the only screen that writes candidate facts — everything the agent ever
asserts about the candidate traces back to text saved here.
