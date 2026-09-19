# Where everything is — start here

A map of every document in this repo, who each one is for, and what it answers.
Hand this to a teammate and they can find their way in without asking.

---

## Read in this order

| # | File | Who it's for | What it answers |
|---|---|---|---|
| 1 | **[PROJECT-BREAKDOWN.md](PROJECT-BREAKDOWN.md)** | Everyone. **Start here.** | The whole system in 14 sections, one per slide. What it does, why it counts as an agent, every guardrail, how scoring works, the evidence. |
| 2 | **[G6-AGENT.md](G6-AGENT.md)** | Presenting in class | The same system in plain language, layer by layer. No code. This is the one to have open while talking. |
| 3 | **[TESTING-GUIDE.md](TESTING-GUIDE.md)** | Anyone verifying it works | Click-through script: what to click, what you should see, and what should **not** happen. |
| 4 | **[HANDOFF.md](HANDOFF.md)** | Whoever picks this up next | What is done, what is open, and the traps to avoid before you change anything. |
| 5 | **[docs/architecture/](docs/architecture/00-index.md)** | Anyone reading the code | File-by-file technical writeup: decision engine, tool inventory, data model, guardrails, testing evidence, reflection. |
| 6 | **[README.md](README.md)** | Setting it up | Install, environment variables, running it locally, deploying. |

---

## The code, in the order the agent runs

Read these four files and you understand the whole thing.

| File | What lives there |
|---|---|
| **`src/lib/agent.ts`** | The harness. Every decision the agent makes: the injection scan, fit scoring, hard constraints, the ask-user pause, the branch that rejects or pauses, drafting, verification and the re-score. If you only read one file, read this one. |
| **`src/lib/draftVerifier.ts`** | The checker that reads back what the AI wrote and flags anything it cannot trace to your résumé. Deterministic, no model call. |
| **`src/lib/llm/types.ts`** | Every instruction sent to the AI, and the exact JSON shape it must reply in. This is "what the brain is told". |
| **`src/lib/llmEvaluator.ts`** | The swappable-brain dispatcher. Nothing else in the app talks to a model directly. |

Supporting: `src/lib/harnessSettings.ts` (tunable settings), `src/lib/preferenceKnobs.ts`
(the Quick match settings, as a view over preferences.md), `src/lib/testCases.ts` (the
shared definition of every test), `src/lib/db.ts` (schema).

---

## How to prove it works

Every command, what it proves, and roughly how long it takes.

| Command | Proves | Time |
|---|---|---|
| `npx tsx scripts/run-tests.ts` | 16 postings with full decision traces; the four required sequences are distinct | ~2 min |
| `npx tsx scripts/conformance.ts` | 13/13 gates on the configured model | ~2 min |
| `LLM_PROVIDER=none DEEPSEEK_API_KEY= npx tsx scripts/conformance.ts` | 8/8 gates with **no AI at all** — the app never depends on the model | ~5 s |
| **`npx tsx scripts/stress-suite.ts`** | **59 checks across 7 dimensions — see below** | ~6 min |
| `npx tsx scripts/verify-tests.ts` | 19 draft-verification checks, including zero false alarms on honest rewording | ~5 s |
| `npx tsx scripts/knob-tests.ts` | 15 checks that every Quick-match knob round-trips and edits exactly one line | ~5 s |
| `npx tsx scripts/profile-matrix.ts` | Accuracy diagnostic: every résumé against every posting, requirement by requirement | ~4 min |
| `node scripts/local-e2e.mjs` | 48 checks over real HTTP (needs the server running) | ~4 min |
| `node scripts/harness-tests.mjs` | 16 checks that settings persist, clamp, refuse bad input and reach the agent | ~1 min |
| `node scripts/stress-draft.mjs` | Résumés are actually submittable and honest drafts raise no flags | ~2 min |

There is also a **Test Lab** tab in the app that runs any case live and shows expected
vs actual — the easiest way to demo this.

### What the stress suite covers

`scripts/stress-suite.ts` is the one that answers "is the agent really working?". Seven
dimensions, because each catches a failure the others miss:

1. **Coverage** — every requirement the agent finds is reported exactly once. A silently
   dropped requirement is the worst failure, because the score still looks plausible.
2. **Arithmetic** — the reported percentage actually equals the weighted maths.
3. **Monotonicity** — more gaps must score lower; a résumé covering more of the *same*
   posting must score higher.
4. **Discrimination** — each résumé scores highest on a posting from its own field.
5. **Stability** — the same input scores the same across repeated runs (models are sampled,
   so this is not free).
6. **Edge cases** — empty résumé, empty posting, a posting that is only a title, a 60,000
   character posting, and a posting that is nothing but an injection.
7. **Post-draft** — the re-score ran, verification ran, every missing skill got a gap note,
   the work history survived verbatim, and the trace records draft/verify/re-score as
   distinct steps.

---

## Test data

| Where | What |
|---|---|
| `src/data/resume.md`, `preferences.md` | The built-in demo profile (Jordan Ellis, data analyst). Fictional. |
| `src/data/profiles/` | Realistic fictional profiles for other careers: `finance-entry` (Priya, FP&A co-op) and `marketing-ops` (Marcus, HubSpot/Salesforce). Used to prove the agent discriminates between fields. |
| `src/data/jobs/` | The J-series test postings — J001–J004 are the four the assignment requires, the rest cover branching, injection and the false-positive control. |
| `src/data/jobs/realistic/` | Long, messy, realistic postings written the way real job ads are, for accuracy testing. |

**All of it is fictional.** The deployed site is public, so never put real personal
information in a profile.

---

## Two things worth knowing before you change anything

- **Run `conformance.ts` before and after touching `agent.ts`.** The four required action
  sequences are the assignment. Breaking one is the only unrecoverable mistake here.
- **The verifier's hardest requirement is silence, not detection.** Before "improving" it,
  run `verify-tests.ts` — one fixture is a heavily reworded but entirely honest résumé that
  must produce **zero** flags. A checker that cries wolf gets ignored, and an ignored
  warning is worse than none.
