# Job Search Agent — Web App

A real agentic Job Search Agent (Group Assignment 1, Path C — code) built as a
Next.js app, deployable to Vercel with Turso (libSQL) as the database.

**👉 New here? Read [`DOCS-INDEX.md`](DOCS-INDEX.md)** — a map of every document,
who each is for, every command that proves the agent works, and where the four
files worth reading in the code are.

**👉 Read [`G6-AGENT.md`](G6-AGENT.md)** — one plain-language file
covering everything the agent does, in nine simple sections. That's the one
to have open when explaining this in class.

For the full file-by-file technical writeup (diagram, tool/action inventory,
decision engine, guardrails, data model, testing evidence, reflection draft),
see [`docs/architecture/`](docs/architecture/00-index.md).

## What makes this an agent, not a workflow

`src/lib/agent.ts` runs a **select -> act -> observe loop**. Before each step the harness
computes which actions are *permitted* from the current state (`permittedActions()`); if
several are, an AI controller **chooses** one from a structured state summary (it never sees
the posting text) and its reason is logged; if only one is permitted a guardrail decides;
with no model the built-in default policy chooses. Every step records who chose it
(`chosenBy`: model / harness / policy).

What the model decides at run time: the order of checks, whether to skip the costly fit
evaluation once a hard violation makes the outcome final, and borderline calls within 10
points of the candidate's minimum fit. What it can never do, because those actions are not on
its list: skip the injection scan, drop a hard constraint, approve past a violation, reject a
clearly good fit, or produce a draft (only `applyHumanDecision` can, after a human decision).

Typical live runs (`npx tsx scripts/controller-demo.ts`; the model may order steps differently):

| Test | Posting | Action sequence (deepseek-chat controller) |
|---|---|---|
| J001 | obvious fit | scan -> check_hard_constraints -> evaluate_fit -> **request_human_approval** |
| J002 | partial fit (in the judgment zone) | ... -> evaluate_fit -> **request_human_approval** or **reject_low_fit**, chosen from the evidence |
| J003 | hard-constraint conflict | scan -> check_hard_constraints -> **reject_hard_constraint** (fit evaluation skipped: outcome already final) |
| J004 | prompt injection embedded | scan -> **flag_injection_and_continue** -> check_hard_constraints -> evaluate_fit -> request_human_approval |

With no model (or `AGENT_CONTROL=policy`) the default policy reproduces the original fixed
order exactly. A hostile controller is tested in `scripts/hostile-model-test.mjs`. No draft is
ever produced without a human Approve/Edit/Reject decision. Every factual claim in the
generated material either traces back to the candidate's own résumé (or the note they typed)
or is **visibly flagged** by `src/lib/draftVerifier.ts`.

## The agent's AI roles, and what you see on screen

Five AI roles, each with its own section in `src/data/agent-guidelines.md`: **Reader** (what the
posting says), **Matcher** (résumé vs requirements, every match quoted), **Controller** (picks
the next action from the permitted list), **Advisor** (tells the person what it thinks) and
**Drafter** (writes only after a human approves). Two things stay pure code: the hard rules and
the draft checker.

Nothing on the approval screen is fixed text any more. When the agent stops for you, the
**Advisor** writes a recommendation, ranks the missing skills by how much they matter, and builds
the "AI-recommended additions" presets from *your* résumé (each backed by a résumé quote, checked
by code). The trace shows, for every step, whether an **AI** or a **code rule** produced it, who
chose it, and the agent's own thinking. The Test Lab shows the same per test, plus the advisor's
recommendation.

**Local models (Ollama).** Set `LLM_PROVIDER=custom` with a local `LLM_BASE_URL` and small-model
mode turns on automatically (`LLM_SMALL=1/0` to force). A weak model is given easier questions:
a numbered menu for the Controller, numbered résumé lines to point at for the Matcher, and
harness-built choices to rank for the Advisor. Slower, but the same guardrails and the same premise.

## The agent reads a markdown rulebook on every run

`src/data/agent-guidelines.md` is loaded by `src/lib/guidelines.ts` at the start of **every**
run (no caching) and becomes the controller's instructions, plus the width of its judgment
zone (`Judgment zone: 10 points`). Edit the guidance and the next run decides differently;
every trace records which version it read (`guidelines: agent-guidelines.md@<hash>`, also in
`state.guidelines`). Proof: `npx tsx scripts/guidelines-proof.ts` runs the same borderline
postings under a strict, a lenient and a zero-discretion version of the file, then under a
file that tells the agent to switch its guardrails off, which changes nothing.

The file guides **judgment**. Its "Never" section documents rules the harness enforces in code
(`permittedActions()`), so they hold even if the file is edited badly. If the file is missing
the agent falls back to a built-in default and says so in the trace.

## Screens

- `/` — dashboard of evaluated postings (color-coded stage badge, color-coded
  fit score, injection flag, status filters and title search)
- `/testlab` — every built-in test case, what it proves, and a Run button that
  executes it against the real agent showing expected vs actual
- `/harness` — every layer of the agent in plain English with the settings it
  actually uses, including the editable prompt text, per profile
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

`draftApplication()` produces two kinds of material, guarded differently. The
deterministic evidence bullets are literal `resume.md` quotes — nothing else can
be emitted there. The cover letter and tailored résumé are written by a model
that is asked to rephrase, so they are checked afterwards by
`src/lib/draftVerifier.ts`: any sentence containing a number, employer, tool or
credential found in neither the résumé nor the human's note is flagged for the
human. Flagged lines are shown, never silently removed. See
[`docs/architecture/06-guardrails.md`](docs/architecture/06-guardrails.md).

## Files

- `src/lib/agent.ts` — the agent (skills extraction, constraint checks,
  injection detection, decision engine, HITL, drafting)
- `src/lib/db.ts` — Turso/libSQL client + schema
- `src/app/api/**` — candidate profile, jobs (create/list/detail), scrape,
  approve
- `src/app/**/page.tsx` — the screens above
- `src/data/` — starter kit: `resume.md`, `preferences.md`, `jobs/J001-J006.md`
  (J004 has the required embedded prompt injection)
- `scripts/run-tests.ts` — runs the agent directly against all six postings
  and prints full structured traces (`npx tsx scripts/run-tests.ts`)

## Running the official class starter kit

The instructor's own files live unchanged in `src/data/classkit/` (Jordan Lee's résumé, the
preferences, `jobs.json` J001–J006). To run all six through the real agent and produce the
assignment's deliverables:

```bash
set -a && source .env.local && set +a && npx tsx scripts/classkit-run.ts
```

It writes `outputs/ranked_jobs.md`, `outputs/test_results.md`, `outputs/trace_J001.json`,
`outputs/trace_J004.json` and `outputs/branching_evidence.md`. The same six cases are in the
Test Lab as KIT-J001 … KIT-J006. See **Layer 20** in `G6-AGENT.md`.

## The score does not move any more

The same posting and résumé now always produce the same percentage: the requirement list a
posting is judged against is stored the first time it is read and reused after that
(`src/lib/memory.ts`). Check it yourself:

```bash
npx tsx scripts/stability.ts             # spread 0 on every posting
NO_MEMORY=1 npx tsx scripts/stability.ts # 12-15 point drift, the old behaviour
```

## Several people at once

There is no login. Each browser gets a workspace cookie, and profiles, postings and evaluations
belong to that workspace, so two people can use the site side by side without changing each
other's results. The profile dropdown on *Resume & preferences* is that browser's own account
switcher. A first visit seeds the class-kit profile. Fictional résumés only — the site is
public and the cookie is not a password.

## Résumé files

*Resume & preferences* reads a PDF, Word `.docx`, Markdown or plain-text résumé and shows you
the extracted text to check before saving. Nothing is rewritten: the agent may only quote what
your résumé actually says.

## Trying it on the live site

https://g6-job-search-agent-g6.vercel.app — no login. Each browser gets its own workspace.

- **Dashboard → "Try it with ready-made data"**: pick one of nine fictional candidates (the class
  kit's Jordan Lee, the demo candidate, or someone in nursing, teaching, software, skilled
  trades, retail, finance or marketing) and run the agent on a matching set of postings —
  including the kit's J001–J006. Each posting goes through the real agent, so the board is real,
  ranked agent output with a full trace per job.
- **Live Demo** (top nav): pick a candidate — the class kit's Jordan Lee, Jordan Ellis, or any of
  the others — then paste a job link (LinkedIn or any posting) or the job text and run the agent
  in front of the class. Links are read only when the page is public: the class rule is not to
  scrape login-protected job boards, and the agent never signs in, so a sign-in wall gets a clear
  "paste the text instead" message.
- **Assignment** (top nav): each of the ten deliverables, where to check it on the site, and the
  full résumé and preferences of every candidate the tests run against.
- **Test Lab**: every test case, run live on the server.

`node scripts/live-verify.mjs` checks the deployed site end to end: database saving, model
configured, every sample candidate and posting through the agent, the class kit's expected
outcomes, and every Test Lab case.
