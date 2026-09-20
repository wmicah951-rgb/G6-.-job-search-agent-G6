# Architecture Diagram

This is the assignment's required "inputs, tools, state, decision point(s),
approval gate, outputs" diagram, in text form so it stays in sync with the code
(feel free to redraw it by hand from this — that's explicitly allowed by the
assignment, and this text version is the source of truth either way).

> **Update (20 Sep 2026):** the agent is now a select → act → observe loop, not
> a fixed 4-step pipeline. The order of `evaluate_fit` / `check_hard_constraints`
> and the reject-vs-pause call near the fit bar are chosen at run time by an AI
> **controller**, from a list of actions the harness computes as *permitted*.
> This diagram reflects that; the code lives in `runAgent()` in `agent.ts`.

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
 └──────────┬───────────┘                  │   fit rationale, red      │
            │                              │   flags, hard-constraint  │
 ┌──────────▼───────────┐                  │   violations, injection   │
 │ Rulebook               │◄────reads──────┤   flags, the AI advisor's │
 │  src/data/             │  (every run)    │   recommendation, the     │
 │  agent-guidelines.md   │                  │   RESUME SNAPSHOT used   │
 │  (per-role sections;   │                  │   at evaluation time,    │
 │   judgment-zone width) │                  │   full decision trace)   │
 └──────────┬───────────┘                  ├───────────────────────────┤
            │                              │ harness_settings          │
            │                              │  (per-profile overrides:  │
            │                              │   thresholds, editable    │
            │                              │   prompt prose — sparse,  │
            │                              │   default = no row)       │
            │                              └───────────────────────────┘
            ▼
 ┌─────────────────────────────────────────────────────────────────────┐
 │           THE AGENT — runAgent() in agent.ts: SELECT → ACT → OBSERVE │
 │                                                                       │
 │   FIVE AI ROLES (each its own section of agent-guidelines.md):       │
 │     Reader (assessPosting)     Matcher (performFitEvaluation)        │
 │     Controller (selectAction)  Advisor (produceAdvice)                │
 │     Drafter (draftApplication)                                        │
 │                                                                       │
 │   TOOLS / CODE (deterministic; see 04-tool-action-inventory.md):     │
 │     scanForInjection()   extractSkills()   checkHardConstraints()    │
 │     extractCandidateYears()   explainFit()   permittedActions()      │
 │     permittedDecisions()   computeRedFlags()   draftVerifier.ts      │
 │                                                                       │
 │   EACH TURN OF THE LOOP:                                             │
 │     1. permittedActions(state) computes what is ALLOWED right now    │
 │        (the guardrail layer — see 06-guardrails.md)                  │
 │     2. If exactly one action is permitted, a GUARDRAIL executes it.  │
 │        If two or more are permitted, the CONTROLLER (AI) picks one   │
 │        from a state summary that NEVER includes the posting text,   │
 │        and its one-sentence reason is logged. No model / a          │
 │        forbidden pick / a failed call → the default POLICY picks    │
 │        (reproduces the original fixed order) and the refusal is     │
 │        logged.                                                       │
 │     3. The chosen action runs and a full trace step is recorded,     │
 │        tagged with who chose it (model / harness / policy) and       │
 │        whether an AI or code rule produced the result.               │
 │                                                                       │
 │   scan_for_injection (always first — never a choice)                 │
 │     observation: raw posting text (untrusted data, never executed);  │
 │     read by the Reader (if a model is configured) + the regex floor  │
 │     ┌─ injection found ──► flag_injection_and_continue (only path    │
 │     │                       this step exists on; logged, refused)    │
 │     └─ none found ──────► continue                                  │
 │                                                                       │
 │   evaluate_fit  ⇄  check_hard_constraints  (CONTROLLER picks the     │
 │   order; may skip evaluate_fit entirely once a violation is final)   │
 │     evaluate_fit:   Matcher vs. résumé → fit_score, matched[],        │
 │                     missing[], fit_rationale[] (see 06-guardrails)   │
 │     check_hard_constraints: years / clearance / relocation / on-site │
 │                     → hardConstraintViolations[]                     │
 │                                                                       │
 │   ask_user_clarification (only if a location rule exists and the     │
 │   arrangement is still unknown after both checks)                    │
 │                                                                       │
 │   THE DECISION — permittedDecisions(state) computes which of these   │
 │   are allowed, then a guardrail or the controller picks one:         │
 │                                                                       │
 │     hardConstraintViolations.length > 0                              │
 │        └──► reject_hard_constraint   (STOP — only option; final)     │
 │                                                                       │
 │     fitScore below (bar − judgment margin)                           │
 │        └──► reject_low_fit           (STOP — only option here)       │
 │                                                                       │
 │     fitScore above (bar + judgment margin)                           │
 │        └──► request_human_approval   (PAUSE — only option here)      │
 │                                                                       │
 │     fitScore WITHIN the judgment margin of the bar (both allowed)    │
 │        └──► CONTROLLER chooses reject_low_fit OR                     │
 │             request_human_approval, from required- vs. nice-to-have  │
 │             gaps, partial matches, and confidence                    │
 │                                                                       │
 │   advise_human (only when the run just stopped for a person) — the   │
 │   Advisor reads the evaluation facts + résumé (never the posting)    │
 │   and produces a recommendation, ranked gaps, and drafting presets,  │
 │   each verified against the résumé/real gaps before being shown      │
 └─────────────────────────────────────┬─────────────────────────────────┘
                                        │
                                        ▼
                     ┌──────────────────────────────────────┐
                     │   HUMAN-IN-THE-LOOP APPROVAL GATE     │
                     │   (jobs/[id] page — Approve/Edit/     │
                     │    Reject buttons, plus the Advisor's │
                     │    recommendation and presets)        │
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
                    │ (Drafter — grounded │   │ (no draft      │
                    │  ONLY in the RESUME │   │  produced)     │
                    │  SNAPSHOT from      │   └──────────────┘
                    │  evaluation time)   │
                    └──────────┬──────────┘
                               │
                               ▼
                    verify_draft (code checks every claim)
                               │
                               ▼
                    rescore_tailored_resume (same yardstick,
                    before → after; unsourced gains flagged)
                               │
                               ▼
                          OUTPUT: cover letter + tailored résumé,
                          shown back to the human — never sent anywhere.

 EVERY step above is logged as a structured trace entry:
   state_before → observation → available_actions → selected_action → result → state_after
   (+ chosenBy, brain, thinking, guidelines)
 (this is what the trace viewer on the job detail page renders, tagged
  🧠 AI thinking / ⚙ code rule, and what scripts/run-tests.ts and
  scripts/controller-demo.ts print for the required test evidence.)
```
