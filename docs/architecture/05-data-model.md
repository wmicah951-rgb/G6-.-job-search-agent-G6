# Data Model

Database: Turso (libSQL) in production, or a local file (`local.db`) when no
`TURSO_DATABASE_URL` env var is set — identical schema and code path either way.
Schema is created automatically on first request (`ensureSchema()` in
[`src/lib/db.ts`](../../src/lib/db.ts)) — no manual migration step.

## `profiles`

One row per named candidate profile (resume + preferences pair). Exactly one
row has `is_active = 1` at any time — that's the profile new job evaluations run
against.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `name` | TEXT | e.g. "Profile 1", "Profile 2 - PM track" |
| `resume_text` | TEXT | the full resume.md contents |
| `preferences_text` | TEXT | the full preferences.md contents |
| `is_active` | INTEGER | 0/1, exactly one row is 1 |
| `created_at`, `updated_at` | TEXT | |

Seeded automatically with one profile ("Profile 1") from the starter-kit
`src/data/resume.md` / `preferences.md` files the first time the app runs
against an empty database.

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
