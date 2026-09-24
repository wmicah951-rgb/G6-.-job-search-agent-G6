// The assignment, answered on the live site.
//
// A grader should be able to check every deliverable without cloning the repo: each row below
// says where the thing lives in this app (or, for documents, in the repository) and how to see
// it for themselves. docs/submission/DELIVERABLES.md is the same map in markdown.

import { sampleProfilesWithText } from "@/lib/samples";

const REPO = "https://github.com/wmicah951-rgb/G6-.-job-search-agent-G6/blob/main";

type Row = { n: string; what: string; where: React.ReactNode; how: React.ReactNode };

const ROWS: Row[] = [
  {
    n: "1",
    what: "Working prototype",
    where: <>This site</>,
    how: (
      <>
        On the <a href="/">Dashboard</a>, press <em>Run the agent on these</em> with the class kit selected,
        or use the <a href="/demo">Live Demo</a> to run any candidate on a real job link or pasted posting.
      </>
    ),
  },
  {
    n: "2",
    what: "Architecture diagram",
    where: (
      <>
        <a href="/harness">Harness</a> (the layers, live) and{" "}
        <a href={`${REPO}/docs/architecture/02-architecture-diagram.md`}>02-architecture-diagram.md</a>
      </>
    ),
    how: <>The Harness screen shows each layer, which parts are AI and which are code.</>,
  },
  {
    n: "3",
    what: "Tool / action inventory",
    where: <a href={`${REPO}/docs/architecture/04-tool-action-inventory.md`}>04-tool-action-inventory.md</a>,
    how: <>Includes the mapping to the class kit&apos;s action names (ASK_USER, RECOMMEND, REJECT, …).</>,
  },
  {
    n: "4",
    what: "An implemented guardrail",
    where: (
      <>
        Every posting is scanned for instructions aimed at an AI; hard constraints are code, not prompts
      </>
    ),
    how: (
      <>
        Test Lab → <em>KIT-J004</em>: the injection is flagged and refused, the AWS gap is kept, nothing is sent.
      </>
    ),
  },
  {
    n: "5",
    what: "Real human-in-the-loop checkpoint",
    where: <>Approve / Edit / Reject on every job that clears the bar</>,
    how: <>Open any job in &ldquo;Awaiting your approval&rdquo;. No draft exists until you click.</>,
  },
  {
    n: "6",
    what: "Ranked job output",
    where: <a href="/">Dashboard</a>,
    how: <>Run the class kit set; the board ranks all six, with rejections and their reasons listed separately.</>,
  },
  {
    n: "7",
    what: "Approved application draft",
    where: <>The job page, after Approve or Edit</>,
    how: <>Cover letter and tailored résumé, each line checked against the résumé, downloadable as a PDF.</>,
  },
  {
    n: "8",
    what: "Four required test results",
    where: <a href="/testlab">Test Lab</a>,
    how: <>&ldquo;Run all tests&rdquo; — the four required cases, the class kit&apos;s six, and the branching, injection and control cases.</>,
  },
  {
    n: "9",
    what: "Runtime branching evidence",
    where: <a href="/testlab">Test Lab</a>,
    how: <>Each case shows the executed action sequence; different postings take different paths through the same code.</>,
  },
  {
    n: "10",
    what: "Two detailed traces",
    where: <>&ldquo;Agent Decision Trace&rdquo; on any job page</>,
    how: (
      <>
        Every step: state before → observation → permitted actions → chosen action (and who chose it) → result →
        state after. Also <a href={`${REPO}/outputs/trace_J001.json`}>trace_J001.json</a> and{" "}
        <a href={`${REPO}/outputs/trace_J004.json`}>trace_J004.json</a>.
      </>
    ),
  },
  {
    n: "—",
    what: "Agent-vs-workflow reflection",
    where: <a href={`${REPO}/docs/submission/REFLECTION.md`}>REFLECTION.md</a>,
    how: <>With the runtime evidence it rests on.</>,
  },
];

export default function AssignmentPage() {
  // Read from the same files the agent and the tests use, so what is shown here is exactly what
  // every test runs against — not a copy that could drift.
  const candidates = sampleProfilesWithText();
  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-semibold mb-1">The assignment, on this site</h1>
      <p className="text-sm text-neutral-600 mb-5 leading-relaxed">
        CIS 4394 Agentic AI · Group 6 · Path C (code). Every deliverable the assignment asks for, and where to
        check it yourself. The data is the <strong>official class starter kit</strong> — Jordan Lee&apos;s résumé,
        the kit&apos;s preferences and hard constraints, and its <code>jobs.json</code> J001–J006 — run unchanged
        through the real agent.
      </p>

      <div className="overflow-x-auto border border-neutral-200 rounded-xl bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
            <tr>
              <th className="px-3 py-2 w-8">#</th>
              <th className="px-3 py-2">Deliverable</th>
              <th className="px-3 py-2">Where</th>
              <th className="px-3 py-2">How to check it</th>
            </tr>
          </thead>
          <tbody className="[&_a]:underline [&_a]:text-sky-800">
            {ROWS.map((r) => (
              <tr key={r.what} className="border-t border-neutral-100 align-top">
                <td className="px-3 py-2 text-neutral-500">{r.n}</td>
                <td className="px-3 py-2 font-medium text-neutral-900">{r.what}</td>
                <td className="px-3 py-2 text-neutral-700">{r.where}</td>
                <td className="px-3 py-2 text-neutral-700">{r.how}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="text-base font-semibold mt-8 mb-2">The lesson&apos;s agent loop, where you can see it</h2>
      <ul className="text-sm text-neutral-700 space-y-1.5 list-disc pl-5 leading-relaxed [&_a]:underline [&_a]:text-sky-800">
        <li>
          Open any job: its <strong>Agent Decision Trace</strong> is laid out in the lesson&apos;s exact order — state
          before → observation → available actions → selected action → result → state after → next decision — with
          each row labelled OBSERVE, DECIDE, ACT, RECORD or UPDATE STATE.
        </li>
        <li>
          Each step says who made the call: the <strong>AI</strong> choosing among several permitted actions, a{" "}
          <strong>guardrail</strong> when only one action was allowed, or a result <strong>recalled from memory</strong>{" "}
          (the lesson&apos;s &ldquo;prior results&rdquo;).
        </li>
        <li>
          Each step also carries the starter kit&apos;s action name: ASK_USER, CONTINUE_INVESTIGATION, RECOMMEND,
          DOWN_RANK, REJECT, REQUEST_DRAFT_APPROVAL, DRAFT, FINISH.
        </li>
        <li>
          Every requirement in the lesson is also checked in code, on the kit&apos;s own data, by{" "}
          <a href={`${REPO}/scripts/class-requirements-check.ts`}>scripts/class-requirements-check.ts</a>.
        </li>
      </ul>

      <h2 className="text-base font-semibold mt-8 mb-2">Using it yourself</h2>
      <ul className="text-sm text-neutral-700 space-y-1.5 list-disc pl-5 leading-relaxed [&_a]:underline [&_a]:text-sky-800">
        <li>
          There is no login. Your browser gets its own private workspace, so your profiles and postings are yours and
          do not change anyone else&apos;s.
        </li>
        <li>
          On the <a href="/">Dashboard</a> you can switch to a ready-made candidate from another field — nursing,
          teaching, software, skilled trades, retail, finance, marketing — and run postings written for them.
        </li>
        <li>
          On <a href="/upload">Resume &amp; Preferences</a> you can add your own candidate, from a PDF, a Word file or
          pasted text. Use fictional details only.
        </li>
        <li>
          The agent never sends, submits or contacts anyone. It stops for a person before any application material
          is written.
        </li>
      </ul>

      <h2 className="text-base font-semibold mt-8 mb-2">The candidates we test against</h2>
      <p className="text-sm text-neutral-600 mb-3 leading-relaxed">
        Every test and every sample posting is judged against one of these fictional candidates. The résumé is the only
        source of facts the agent may use; the preferences hold the candidate&apos;s hard rules (years, location,
        clearance) and fit bar. The first is the <strong>official class starter kit&apos;s</strong> Jordan Lee, unchanged.
        Try any of them on a real posting in the <a href="/demo" className="underline text-sky-800">Live Demo</a>.
      </p>
      <div className="space-y-2">
        {candidates.map((c) => (
          <details key={c.key} className="border border-neutral-200 rounded-xl bg-white">
            <summary className="cursor-pointer px-3 py-2 text-sm">
              <span className="font-medium text-neutral-900">{c.name}</span>
              <span className="text-neutral-500"> — {c.field}</span>
            </summary>
            <div className="px-3 pb-3">
              <p className="text-xs text-neutral-500 mb-2">{c.blurb}</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-neutral-500 mb-1">Résumé</div>
                  <pre className="text-[11px] whitespace-pre-wrap break-words bg-neutral-50 border border-neutral-200 rounded-lg p-2 max-h-80 overflow-y-auto">
                    {c.resumeText}
                  </pre>
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-medium text-neutral-500 mb-1">Preferences and hard rules</div>
                  <pre className="text-[11px] whitespace-pre-wrap break-words bg-neutral-50 border border-neutral-200 rounded-lg p-2 max-h-80 overflow-y-auto">
                    {c.preferencesText}
                  </pre>
                </div>
              </div>
            </div>
          </details>
        ))}
      </div>

      <h2 className="text-base font-semibold mt-8 mb-2">More</h2>
      <ul className="text-sm text-neutral-700 space-y-1.5 list-disc pl-5 [&_a]:underline [&_a]:text-sky-800">
        <li>
          <a href={`${REPO}/G6-AGENT.md`}>G6-AGENT.md</a> — how the agent works, layer by layer, in plain language
        </li>
        <li>
          <a href={`${REPO}/docs/submission/TEACHER-QA.md`}>TEACHER-QA.md</a> — likely questions, each answered with a file
          or a command
        </li>
        <li>
          <a href={`${REPO}/TESTING-GUIDE.md`}>TESTING-GUIDE.md</a> — every test suite and what it proves
        </li>
      </ul>
    </div>
  );
}
