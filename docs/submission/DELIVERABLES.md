# The ten required deliverables — where each one is

CIS 4394 Week 2, Group 6, Path C (code). Every row points at something that exists in this
repo or in the running app, not at a description of it.

| # | Deliverable | Where it is | How to see it |
|---|---|---|---|
| 1 | Working prototype | The whole app | https://g6-job-search-agent-g6.vercel.app — on the Dashboard press *Run the agent on these* with the class kit selected, paste a posting on *Add Posting*, or run the Test Lab. The **Assignment** page in the top nav is this table, on the site |
| 2 | Architecture diagram | `docs/architecture/02-architecture-diagram.md`, plus the class's own mapping table in `G6-AGENT.md` Layer 0 | Read either; the Harness screen shows the same layers live |
| 3 | Tool / action inventory | `docs/architecture/04-tool-action-inventory.md` | `npx tsx scripts/doc-check.ts` fails if the code gains an action the inventory does not list |
| 4 | One implemented guardrail | Several. The clearest: a posting's embedded instructions are data, never commands (`INJECTION_PATTERNS` + the AI reader in `src/lib/agent.ts`; the Controller and Advisor are never shown posting text) | `npx tsx scripts/redteam-injection.ts` — 7/7 steering attempts flagged, none obeyed |
| 5 | Real human-in-the-loop checkpoint | `request_human_approval` → Approve / Edit / Reject on the job page. No draft exists before that click | `npx tsx scripts/kit-tests.ts` asserts no draft is produced without a human |
| 6 | Ranked job output | `outputs/ranked_jobs.md`, and the dashboard ranking in the app | Dashboard → run the class kit set; or `npx tsx scripts/classkit-run.ts` |
| 7 | Approved application draft | Cover letter + tailored résumé on the job page after approval, each line checked by the draft verifier | Approve any job in the app, then open "Application materials" |
| 8 | Four test results | `outputs/test_results.md` (the kit's J001–J006), and the Test Lab's 21 cases in the app | `npx tsx scripts/classkit-run.ts`; Test Lab → Run all |
| 9 | Runtime branching evidence | `outputs/branching_evidence.md` — six postings, six different executed action sequences from the same code | `npx tsx scripts/classkit-run.ts` |
| 10 | Two detailed traces | `outputs/trace_J001.json` (recommend) and `outputs/trace_J004.json` (injection), plus `docs/submission/traces.json` | Open the files, or the "Agent Decision Trace" panel on any job |
| — | Agent-vs-workflow reflection | `docs/submission/REFLECTION.md` and `docs/architecture/09-reflection.md` | Read |

## Trace format

Every trace step carries the class's own shape — state before → observation → available
actions → selected action → result → state after — plus three things the class did not ask for:

- `chosenBy`: `model` (the AI controller chose among two or more permitted actions), `harness`
  (only one action was permitted, so a guardrail decided), or `policy` (the built-in default).
- `brain`: whether an AI or a deterministic rule produced that step.
- `classAction`: the same step named in the kit's vocabulary (`ASK_USER`,
  `CONTINUE_INVESTIGATION`, `RECOMMEND`, `DOWN_RANK`, `REJECT`, `REQUEST_DRAFT_APPROVAL`,
  `DRAFT`, `FINISH`).

## Rubric, and where we think we stand

| Rubric line | Points | What backs it |
|---|---|---|
| Agentic design | 25 | The action is chosen at run time from the permitted set, by an AI controller when there is a real choice. Six postings produce six different sequences (`outputs/branching_evidence.md`), and the order changes too — with a model configured the agent checks hard constraints *before* scoring when that settles the job. Not a fixed sequence. |
| Decision quality | 20 | Every matched requirement carries a literal résumé quote; gaps are never papered over; the score no longer drifts (`scripts/stability.ts`); six fields tested (`scripts/category-matrix.ts`) |
| Tool / action use | 15 | Nine agent actions plus the human ones, each separately traceable, all in the inventory |
| HITL + guardrails | 15 | Approve / Edit / Reject before any draft; injection refusal; hard constraints in code; the draft verifier; nothing is ever sent |
| Evaluation / testing | 15 | The kit's six cases, the Test Lab's 21, and eleven command-line suites (`TESTING-GUIDE.md`) |
| Demo / explanation | 10 | `G6-AGENT.md` (plain-language, layer by layer), the Harness screen, and `docs/submission/TEACHER-QA.md` |

## One command for the whole lesson

`npx tsx scripts/class-requirements-check.ts` checks every requirement from the Week 2 lesson
against the running code on the official kit data — see `TESTING-GUIDE.md`.

## Where the class's trace format is visible in the app

Every job page opens with the **Agent Decision Trace** laid out in the lesson's own order and
words: STATE before → OBSERVE → DECIDE (available actions, selected action and why) → ACT →
RECORD (result) → UPDATE STATE (what changed) → NEXT decision. Above the steps: the loop as taught
(OBSERVE → DECIDE → ACT → RECORD → UPDATE STATE), this posting's path in the kit's action names,
and how many steps the AI chose versus a guardrail. A score recalled from an earlier run is
labelled "recalled from memory" — the lesson's "prior results" — not "code".
