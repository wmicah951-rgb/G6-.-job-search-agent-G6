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

## One-sentence summary of the system

A deterministic, rule-based agent reads a job posting and a candidate's resume,
walks through a small state machine that branches differently depending on what
it finds (skill fit, hard-constraint conflicts, embedded prompt injection), stops
and waits for a human Approve/Edit/Reject decision before producing any
application material, and logs every step as a structured trace
(`state_before → observation → available_actions → selected_action → result → state_after`).

No LLM/AI API is called anywhere in this pipeline — see
[10-setup-and-deployment.md](10-setup-and-deployment.md) for why that's a design
choice, not a limitation.
