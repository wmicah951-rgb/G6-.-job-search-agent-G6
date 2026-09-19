# Screens

## `/` — Dashboard (`src/app/page.tsx`)

Lists every evaluated posting: title, source (pasted or a URL), stage (color-
coded — green tones for approved/drafted, amber for awaiting approval, red for
a hard-constraint auto-rejection, neutral gray for a low-fit auto-rejection or
human rejection), fit score (color-coded to the same tiers the agent itself
decides on — green ≥ 70%, amber ≥ 60%, red below it),
and an "injection flagged" badge when relevant. Backed by `GET /api/jobs`.

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
  — the specific question the agent needs answered, with "Treat as compatible"
  / "Treat as a violation" buttons. Distinct from the approval gate below: this
  one appears *during* evaluation, before the agent has reached a verdict at all
- The Approve / Edit & Approve / Reject buttons (only shown while
  `stage === "awaiting_approval"`)
- The draft, once one exists
- A toggle to show the full structured decision trace — the literal evidence
  artifact for the assignment's testing requirement
- The raw posting text, collapsed by default

Backed by `GET /api/jobs/[id]`, `POST /api/agent/clarify`, and
`POST /api/agent/approve`.

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
