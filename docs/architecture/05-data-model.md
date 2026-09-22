# Data Model

Database: Turso (libSQL) in production, or a local file (`local.db`) when no
`TURSO_DATABASE_URL` env var is set — identical schema and code path either way.
Schema is created automatically on first request (`ensureSchema()` in
[`src/lib/db.ts`](../../src/lib/db.ts)) — no manual migration step.

## `profiles`

One row per named candidate profile (resume + preferences pair), belonging to one
**workspace** — the browser that created it (see `workspace_state` below). Which profile is
active is per workspace, not global: before this, one visitor switching profile changed what
every other visitor's runs were scored against.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `name` | TEXT | e.g. "Profile 1", "Profile 2 - PM track" |
| `resume_text` | TEXT | the full resume.md contents |
| `preferences_text` | TEXT | the full preferences.md contents |
| `is_active` | INTEGER | legacy column, no longer read — the active profile lives in `workspace_state` |
| `workspace_id` | TEXT | which browser owns this profile |
| `created_at`, `updated_at` | TEXT | |

Seeded automatically the first time a browser uses the app, with the **official class kit's**
profile (Jordan Lee) from `src/data/classkit/resume.md` and `preferences.md`. Any further
profile — a different candidate, a different job sector — is created by the user.

## `jobs`

One row per submitted posting (pasted or scraped).

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `title` | TEXT | |
| `raw_text` | TEXT | the full posting text, exactly as submitted |
| `source_url` | TEXT, nullable | set when scraped from a URL |
| `created_at` | TEXT | |

## `evaluations`

One row per job (1:1 with `jobs`), holding the agent's full output.

| Column | Type | Notes |
|---|---|---|
| `job_id` | TEXT PK, FK → jobs.id | |
| `stage` | TEXT | current `Stage` value — see [03-decision-engine.md](03-decision-engine.md) |
| `fit_score` | REAL | |
| `matched_skills`, `missing_skills` | TEXT (JSON array) | |
| `fit_rationale` | TEXT (JSON array) | the grounded "why this fits" lines |
| `hard_constraint_violations` | TEXT (JSON array) | |
| `injection_detected` | INTEGER | 0/1 |
| `injection_snippets` | TEXT (JSON array) | |
| `approval_note` | TEXT, nullable | the human's edit note, if any |
| `draft` | TEXT, nullable | null until a human approves/edits |
| `cover_letter` | TEXT, nullable | added by a migration; the AI-drafted letter |
| `tailored_resume` | TEXT, nullable | added by a migration; the AI-tailored résumé |
| `profile_id` | TEXT | which profile evaluated this job |
| `profile_name` | TEXT | **denormalized** copy of the profile's name at evaluation time, so it still displays correctly even if that profile is later renamed or deleted |
| `resume_snapshot` | TEXT | **the exact resume text used at evaluation time** |
| `trace_json` | TEXT (JSON) | the full structured decision trace — every step, who chose it (`chosenBy`), whether an AI or code rule produced it (`brain`), and the agent's own reasoning (`thinking`) |
| `state_json` | TEXT (JSON) | the full `AgentState` object, including `redFlags`, `guidelines` (which version of the rulebook this run read), `judgmentMargin`, and `advice` (the AI advisor's recommendation, ranked gaps and drafting presets) |
| `updated_at` | TEXT | |

## `harness_settings`

Per-profile overrides for the tunable settings on the `/harness` screen —
thresholds and the editable *prose* portions of each AI role's prompt (never
the JSON schema a role must reply in, so a bad edit can degrade wording but
cannot break parsing).

| Column | Type | Notes |
|---|---|---|
| `profile_id` | TEXT | part of the composite PK |
| `key` | TEXT | part of the composite PK — which setting |
| `value` | TEXT | |
| `updated_at` | TEXT | |

Sparse by design: a row exists **only** for a setting someone actually changed.
An empty table means "every profile uses the shipped defaults," so improving a
default in code (or in `src/data/agent-guidelines.md`, which is not stored here
at all — it is read from disk on every run) reaches every profile that has not
overridden it, and "Reset" on the Harness screen is a `DELETE`, not a copy.

### Why `resume_snapshot` exists

Once multiple profiles can exist and the active one can change at any time, a
job that's `awaiting_approval` needs to keep pointing at the *exact* resume text
it was evaluated against — not "whatever profile happens to be active right
now." Without this, switching profiles between evaluation and approval could
silently change what an already-decided job's draft is grounded in, which would
break the non-fabrication guarantee (see
[06-guardrails.md](06-guardrails.md)). `src/app/api/agent/approve/route.ts`
reads `resume_snapshot`, never the live active profile, when building a draft.

## Entity relationship

```
profiles (many, one active)          jobs (many)
                                        │ 1
                                        │
                                        │ 1
                                  evaluations
                                  (references profile_id + profile_name +
                                   resume_snapshot as they were AT
                                   EVALUATION TIME, independent of the
                                   profiles table's current state)
```

## `workspace_state`

One row per browser (see [`src/lib/workspace.ts`](../../src/lib/workspace.ts)). The id is a
random value in an http-only cookie; it is an account without a password, not a security
boundary, which is why the app only ever holds fictional résumés.

| Column | Type | Notes |
|---|---|---|
| `workspace_id` | TEXT PK | the cookie value |
| `active_profile_id` | TEXT | which profile this browser is working as |
| `created_at`, `updated_at` | TEXT | |

`jobs` and `evaluations` also carry `workspace_id`, and every route filters on it. `jobs` carries
`content_hash` as well, so pasting the same posting twice reopens the first job instead of
creating a second one with its own (differing) answer.

## Memory tables

Written and read by [`src/lib/memory.ts`](../../src/lib/memory.ts). These are what stop the fit
score drifting between runs; nothing here can change a decision.

| Table | Key | Holds |
|---|---|---|
| `requirement_ledgers` | `job_hash` | The requirement list (text + priority) found the **first** time a posting was read. Written with `INSERT OR IGNORE` — a yardstick, not a cache |
| `fit_cache` | `job_hash` + `fit_key` | The whole fit evaluation for one posting × résumé × matcher prompt × model. Reused outright, so a re-run returns the identical score with no model call |
| `eval_history` | `job_hash` | Every score this posting has been given, with the profile and timestamp — shown on the job page as "Evaluation history" |
