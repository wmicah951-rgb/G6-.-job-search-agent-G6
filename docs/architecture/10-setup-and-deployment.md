# Setup, Deployment, and Why No API Key Is Needed

## Why this needs no AI/LLM API key

This is a deliberate design choice, not a missing integration: **nothing in
this codebase calls an external AI model.** Skill extraction, years-of-
experience parsing, prompt-injection detection, and hard-constraint checking
are all plain deterministic TypeScript — regexes and string matching in
[`src/lib/agent.ts`](../../src/lib/agent.ts). Search the codebase for
`fetch(` and you'll find exactly one external call: the best-effort job-posting
scraper (`src/app/api/jobs/scrape/route.ts`), which fetches the posting page
itself, not an AI API.

Practically, this means:
- No `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or any other AI provider key is
  ever read or required, anywhere in the app.
- The agent behaves identically offline (aside from the URL-scrape feature,
  which obviously needs network access to the job board itself) as it does
  deployed.
- There's no per-request AI cost and no rate limit tied to an external
  provider — the only external dependency at runtime is the database (Turso,
  or the local file DB fallback).

## Running locally

```bash
npm install
npm run build && npm run start   # or: npm run dev for hot reload
```

With no environment variables set, `src/lib/db.ts` automatically falls back to
a local file database (`local.db`) — no Turso account, no signup, nothing to
configure. The schema is created and a default profile is seeded automatically
on first request.

To see the agent's raw decision traces without starting the server at all:

```bash
npx tsx scripts/run-tests.ts
```

## Deploying for real (Vercel + Turso)

1. Create a Turso database: `turso db create job-search-agent`
2. Get the URL and an auth token:
   `turso db show job-search-agent --url` and
   `turso db tokens create job-search-agent`
3. In Vercel project settings → Environment Variables, set:
   - `TURSO_DATABASE_URL`
   - `TURSO_AUTH_TOKEN`
4. Deploy: `vercel deploy` (or connect the GitHub repo in the Vercel
   dashboard)
5. Schema is created automatically on first request (`ensureSchema()` in
   `src/lib/db.ts`) — no manual migration step needed, and the default profile
   seeds itself the same way it does locally.

No additional secrets are needed beyond those two Turso values — there is no
AI provider key to add.

## Known limitation: job-posting scraping

`src/app/api/jobs/scrape/route.ts` does a best-effort server-side fetch + text
extraction (Cheerio) of a posting URL. This will not work on every site:

- Many boards (LinkedIn, Indeed, and others) block server-side/automated
  fetches or require login.
- Sites that render the posting client-side via JavaScript won't have the text
  in the raw HTML a server fetch receives.
- Some boards (confirmed against real Greenhouse listings during QA) redirect
  a dead or filled posting to a generic "all openings" page instead of
  returning an error — the scraper actively detects this (a redirect that
  drops the specific job ID from the URL, or page text saying the posting is
  no longer available) and reports a clear failure instead of silently
  evaluating the wrong content.

When a scrape fails for any reason, the UI surfaces the error and drops back to
"paste the text yourself," which always works regardless of the source site.
