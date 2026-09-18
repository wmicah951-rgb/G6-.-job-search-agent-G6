# Job Search Agent — Web App

A real agentic Job Search Agent (Group Assignment 1, Path C — code) built as a
Next.js app, deployable to Vercel with Turso (libSQL) as the database.

**👉 Read [`G6-AGENT.md`](G6-AGENT.md) first** — one plain-language file
covering everything the agent does, in nine simple sections. That's the one
to have open when explaining this in class.

For the full file-by-file technical writeup (diagram, tool/action inventory,
decision engine, guardrails, data model, testing evidence, reflection draft),
see [`docs/architecture/`](docs/architecture/00-index.md).

## What makes this an agent, not a workflow

`src/lib/agent.ts` implements a genuine decision engine: at each step it selects
the next action from a set of materially different available actions, based on
the current state and the latest observation. Verified branching (see
`scripts/run-tests.ts`):

| Test | Posting | Action sequence |
|---|---|---|
| J001 | obvious fit | scan → evaluate → check_constraints → **request_human_approval** |
| J002 | partial fit | scan → evaluate → check_constraints → **reject_low_fit** |
| J003 | hard-constraint conflict | scan → evaluate → check_constraints → **reject_hard_constraint** |
| J004 | prompt injection embedded | scan → **flag_injection_and_continue** → evaluate → check_constraints → request_human_approval |

All four required tests produce distinct executed action sequences. No draft is
ever produced without a human Approve/Edit/Reject decision (`applyHumanDecision`
in `agent.ts`), and every drafted bullet is a literal quote pulled from the
candidate's own resume text — nothing is invented.

## Screens

- `/` — dashboard of evaluated postings (color-coded stage badge, color-coded
  fit score, injection flag)
- `/jobs/new` — add a posting by pasting text or scraping a URL
- `/jobs/[id]` — full evaluation, a grounded "why this role fits you" panel
  (distinct from the missing-skills list), hard-constraint/injection
  call-outs, the Approve / Edit & Approve / Reject gate, the resulting draft,
  and a toggle to view the full structured decision trace (state_before →
  observation → available_actions → selected_action → result → state_after)
- `/upload` — manage one or more named candidate profiles (resume.md /
  preferences.md pairs) — create, switch which one is active, edit, or delete.
  New postings are always evaluated against whichever profile is active; an
  already-evaluated job keeps using the exact resume snapshot it was evaluated
  against even if you later switch or edit profiles.

See [`docs/architecture/07-screens.md`](docs/architecture/07-screens.md) for
the full breakdown of each screen and the API routes behind it.

## Local run

```bash
npm install
npm run build && npm run start   # or: npm run dev
```

With no env vars set, it uses a local file DB (`local.db`) automatically — no
Turso account needed to try it out.

## Deploying for real (Vercel + Turso)

1. Create a Turso database: `turso db create job-search-agent`
2. Get the URL and an auth token: `turso db show job-search-agent --url` and
   `turso db tokens create job-search-agent`
3. In Vercel project settings → Environment Variables, set:
   - `TURSO_DATABASE_URL`
   - `TURSO_AUTH_TOKEN`
4. Deploy: `vercel deploy` (or connect the GitHub repo in the Vercel dashboard)
5. Schema is created automatically on first request (`ensureSchema()` in
   `src/lib/db.ts`) — no manual migration step needed.

## Job-posting scraping — known limits

`src/app/api/jobs/scrape/route.ts` does a best-effort server-side fetch + text
extraction (cheerio) of a posting URL. This will NOT work on every site:
- Many boards (LinkedIn, Indeed, and others) block server-side/automated
  fetches or require login.
- Sites that render the posting client-side via JavaScript won't have the text
  in the raw HTML a server fetch receives.
- Some sites' terms of service prohibit scraping outright — check before
  pointing this at a real job board in production.

When a scrape fails, the UI surfaces the error and drops back to "paste the
text yourself," which always works regardless of the source site.

## Grounding / no-fabrication

`draftApplication()` never generates free-text claims about the candidate. It
only emits `skill: "<exact line copied from resume.md>"` bullets for skills
that were actually matched, plus the human's edit note verbatim if one was
given. This makes "never fabricate" mechanically true rather than aspirational
— there's no code path that can assert something not present in resume.md.

## Files

- `src/lib/agent.ts` — the agent (skills extraction, constraint checks,
  injection detection, decision engine, HITL, drafting)
- `src/lib/db.ts` — Turso/libSQL client + schema
- `src/app/api/**` — candidate profile, jobs (create/list/detail), scrape,
  approve
- `src/app/**/page.tsx` — the four screens above
- `src/data/` — starter kit: `resume.md`, `preferences.md`, `jobs/J001-J006.md`
  (J004 has the required embedded prompt injection)
- `scripts/run-tests.ts` — runs the agent directly against all six postings
  and prints full structured traces (`npx tsx scripts/run-tests.ts`)
