# Job Search Agent — Architecture Documentation

This folder is the complete, editable breakdown of how this agent works — written
for the class submission (architecture diagram, tool/action inventory, decision
engine, guardrails, data model, testing evidence, reflection) and for you to
actually understand and modify the system, not just hand it in.

Every file here is plain Markdown. Edit any of it directly — nothing here is
generated output you have to re-derive from a tool; it's the primary source.

## Reading order

1. [01-overview.md](01-overview.md) — what this system is and isn't
2. [02-architecture-diagram.md](02-architecture-diagram.md) — inputs, tools, state, decision points, approval gate, outputs
3. [03-decision-engine.md](03-decision-engine.md) — the actual state machine and branching logic, with code line references
4. [04-tool-action-inventory.md](04-tool-action-inventory.md) — every action the agent can select, and why it exists
5. [05-data-model.md](05-data-model.md) — database schema (profiles, jobs, evaluations)
6. [06-guardrails.md](06-guardrails.md) — HITL gate, injection defense, non-fabrication, hard constraints
7. [07-screens.md](07-screens.md) — what each screen does and which API routes back it
8. [08-testing-evidence.md](08-testing-evidence.md) — the four required tests + two contrasting traces
9. [09-reflection.md](09-reflection.md) — draft reflection (½ page) — **edit this to make it your own analysis**
10. [10-setup-and-deployment.md](10-setup-and-deployment.md) — running locally, deploying to Vercel + Turso, and why no AI API key is needed

Submission-facing pages live one folder up in [`docs/submission/`](../submission/):

- [DELIVERABLES.md](../submission/DELIVERABLES.md) — the ten required deliverables, each with the file or screen that holds it
- [REFLECTION.md](../submission/REFLECTION.md) — agent vs workflow, with the runtime evidence
- [TEACHER-QA.md](../submission/TEACHER-QA.md) — 25 likely questions, each answered with a file or a command

## One-sentence summary of the system

An agent reads a job posting and a candidate's resume in a select → act → observe loop: the
harness computes which actions are permitted, an AI controller picks among them (or a guardrail
decides when only one is allowed), and different inputs walk different-length paths (skill fit,
hard-constraint conflicts, embedded prompt injection). When it stops it asks a human for an
Approve/Edit/Reject decision, with an AI advisor's recommendation, before producing any
application material, and logs every step as a structured trace
(`state_before → observation → available_actions → selected_action → result → state_after`, plus who
chose the step and the agent's own reasoning).

The AI plays five roles — Reader, Matcher, Controller, Advisor and Drafter — each following its
own layer of `src/data/agent-guidelines.md`, which the agent reads on every run. The Controller
picks only from actions the harness permits; the AI cannot approve, skip a guardrail, set a stage
or draft without a human. Every claim the model makes is verified before it is trusted, and the
Controller and Advisor never see the posting text. With no model configured at all the agent
still runs end to end and still produces the four required action sequences. See
[10-setup-and-deployment.md](10-setup-and-deployment.md).
