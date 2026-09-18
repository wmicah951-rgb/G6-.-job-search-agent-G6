# Architecture Diagram

This is the assignment's required "inputs, tools, state, decision point(s),
approval gate, outputs" diagram, in text form so it stays in sync with the code
(feel free to redraw it by hand from this — that's explicitly allowed by the
assignment, and this text version is the source of truth either way).

```
 INPUTS                                   PERSISTENT STATE (Turso/libSQL)
 ───────────────────────────              ──────────────────────────────
 ┌─────────────────────┐                  ┌───────────────────────────┐
 │ Job posting text     │                  │ profiles                  │
 │  - pasted directly   │                  │  (multiple named resume + │
 │  - OR scraped from a │                  │   preferences profiles,   │
 │    URL (best-effort) │                  │   exactly one "active")   │
 └──────────┬───────────┘                  ├───────────────────────────┤
            │                              │ jobs                      │
 ┌──────────▼───────────┐                  │  (raw posting text +      │
 │ Candidate profile     │◄─────reads──────┤   source URL)             │
 │  - resume.md          │                  ├───────────────────────────┤
 │  - preferences.md     │                  │ evaluations               │
 │  (whichever profile   │                  │  (stage, fit score,       │
 │   is marked active)   │                  │   matched/missing skills, │
 └──────────┬───────────┘                  │   fit rationale, hard-    │
            │                              │   constraint violations,  │
            │                              │   injection flags, the    │
            │                              │   RESUME SNAPSHOT used at │
            │                              │   evaluation time, full   │
            │                              │   decision trace JSON)    │
            │                              └───────────────────────────┘
            ▼
 ┌─────────────────────────────────────────────────────────────────────┐
 │                    THE AGENT — runAgent() in agent.ts                │
 │                                                                       │
 │   TOOLS (pure functions the agent calls; see 04-tool-action-        │
 │   inventory.md for the full list):                                   │
 │     scanForInjection()   extractSkills()   evaluateFit()             │
 │     checkHardConstraints()   extractCandidateYears()   explainFit()  │
 │                                                                       │
 │   DECISION POINT 1 — scan_for_injection                             │
 │     observation: raw posting text (untrusted data, never executed)   │
 │     ┌─ injection patterns found ──► flag_injection_and_continue      │
 │     │                                (longer path; logged, refused,  │
 │     │                                 evaluation continues on the    │
 │     │                                 REAL content only)             │
 │     └─ none found ──────────────► continue directly                 │
 │                                                                       │
 │   DECISION POINT 2 — evaluate_fit                                   │
 │     observation: resume skills vs. job-required skills               │
 │     produces: fit_score, matched[], missing[], fit_rationale[]       │
 │     (fit_rationale is a POSITIVE, grounded "why this fits" narrative,│
 │      distinct from missing[] — see 06-guardrails.md)                 │
 │                                                                       │
 │   DECISION POINT 3 — check_hard_constraints                         │
 │     observation: years required vs. candidate years; clearance;      │
 │                  remote/hybrid vs. on-site-only                      │
 │     produces: hardConstraintViolations[]                             │
 │                                                                       │
 │   DECISION POINT 4 — the actual branch (three MATERIALLY DIFFERENT   │
 │   next actions, chosen from state so far):                           │
 │                                                                       │
 │     hardConstraintViolations.length > 0                              │
 │        └──► reject_hard_constraint   (STOP — no human step at all)   │
 │                                                                       │
 │     fitScore < LOW_FIT_THRESHOLD (0.45)                              │
 │        └──► reject_low_fit           (STOP — no human step at all)   │
 │                                                                       │
 │     otherwise                                                        │
 │        └──► request_human_approval   (PAUSE for the approval gate)   │
 └─────────────────────────────────────┬─────────────────────────────────┘
                                        │
                                        ▼
                     ┌──────────────────────────────────────┐
                     │   HUMAN-IN-THE-LOOP APPROVAL GATE     │
                     │   (jobs/[id] page — Approve/Edit/     │
                     │    Reject buttons)                    │
                     │                                        │
                     │   No draft exists until a human        │
                     │   clicks one of these three buttons.   │
                     └──────┬─────────┬─────────┬────────────┘
                            │         │         │
                        Approve     Edit      Reject
                            │         │         │
                            ▼         ▼         ▼
                    ┌────────────────────┐   ┌──────────────┐
                    │ draft_application   │   │ discard       │
                    │ (grounded ONLY in   │   │ (no draft      │
                    │  the RESUME SNAPSHOT│   │  produced)     │
                    │  from evaluation    │   └──────────────┘
                    │  time — see         │
                    │  06-guardrails.md)  │
                    └──────────┬──────────┘
                               │
                               ▼
                          OUTPUT: draft cover-letter bullets,
                          each one a literal quote from resume.md,
                          shown back to the human — never sent anywhere.

 EVERY step above is logged as a structured trace entry:
   state_before → observation → available_actions → selected_action → result → state_after
 (this is what the trace viewer on the job detail page renders, and what
  scripts/run-tests.ts prints for the required test evidence.)
```
