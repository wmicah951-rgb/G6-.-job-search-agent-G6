# Overview

## The goal

Evaluate job postings against a candidate's résumé, identify gaps truthfully, and
draft application materials — only after a human explicitly approves.

## What makes this an agent, not a workflow

A fixed pipeline runs the same steps in the same order for every input. This
system does not: at each decision point, `runAgent()` in
[`src/lib/agent.ts`](../../src/lib/agent.ts) picks the next action from a set of
*materially different* available actions, based on the state accumulated so far
and the latest observation. Different postings genuinely walk different,
different-length action sequences:

| Input | Action sequence |
|---|---|
| Obvious fit, no issues | `scan → evaluate → check_constraints → request_human_approval` |
| Partial skill match | `scan → evaluate → check_constraints → reject_low_fit` |
| Hard-constraint conflict (e.g. requires 5+ years) | `scan → evaluate → check_constraints → reject_hard_constraint` |
| Embedded prompt injection | `scan → flag_injection_and_continue → evaluate → check_constraints → request_human_approval` |

The hard-constraint and low-fit paths **stop early** — they never reach
`request_human_approval` at all, because there's nothing left worth a human's
time once a job is rejected outright. The injection path is **longer** than a
clean posting's path, because handling the injection is itself a real,
consequential branch. See [08-testing-evidence.md](08-testing-evidence.md) for
the full generated traces proving this.

## What this system explicitly does NOT do

- It never calls an external AI/LLM API. All parsing (skills, years of
  experience, prompt-injection detection, constraint checks) is deterministic
  regex/string logic in `agent.ts`. See
  [10-setup-and-deployment.md](10-setup-and-deployment.md) for why.
- It never sends, submits, or contacts anyone. Drafting only ever produces text
  shown back to the human in the browser.
- It never fabricates a candidate fact. Every drafted bullet is a literal quote
  pulled from `resume.md` — see [06-guardrails.md](06-guardrails.md).
- It never obeys instructions embedded in a job posting, even when a posting
  explicitly tries to command it (auto-approve, skip review, print the resume
  verbatim, etc.) — that content is treated as **data to evaluate**, never as
  instructions to follow.

## Tech stack

- **Frontend/backend**: Next.js 16 (App Router), TypeScript, Tailwind CSS 4
- **Database**: Turso (libSQL) in production, a local file-based libSQL DB
  (`local.db`) automatically when no Turso credentials are set — same code path
  either way
- **Agent core**: plain TypeScript, zero external API dependencies
  (`src/lib/agent.ts`)
- **Scraping**: server-side fetch + Cheerio, best-effort (many boards block
  automated fetches or render client-side; the UI always falls back to
  paste-the-text)
