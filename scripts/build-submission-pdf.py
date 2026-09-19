# -*- coding: utf-8 -*-
"""Builds G6_Job_Search_Agent_Submission.pdf.

Every trace in this PDF is read from docs/submission/traces.json, which is written by
scripts/export-traces.ts running the real agent. Nothing in the trace sections is typed
by hand -- an earlier version was, and it drifted (old threshold, old action names).

    set -a && source .env.local && set +a && npx tsx scripts/export-traces.ts
    python3 scripts/build-submission-pdf.py
"""
import json
import os
import textwrap
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (HRFlowable, PageBreak, Paragraph, Preformatted,
                                SimpleDocTemplate, Spacer, Table, TableStyle)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "G6_Job_Search_Agent_Submission.pdf")
DATA = json.load(open(os.path.join(ROOT, "docs", "submission", "traces.json"), encoding="utf-8"))
RUNS = DATA["runs"]

ss = getSampleStyleSheet()
title = ParagraphStyle("T", parent=ss["Title"], fontSize=20, spaceAfter=6)
sub = ParagraphStyle("S", parent=ss["Normal"], fontSize=12, textColor=colors.HexColor("#444"), alignment=TA_CENTER, spaceAfter=4)
h1 = ParagraphStyle("H1", parent=ss["Heading1"], fontSize=15, spaceBefore=14, spaceAfter=8)
h2 = ParagraphStyle("H2", parent=ss["Heading2"], fontSize=12.5, spaceBefore=10, spaceAfter=6)
body = ParagraphStyle("B", parent=ss["Normal"], fontSize=10, leading=14, spaceAfter=7)
bul = ParagraphStyle("BL", parent=body, leftIndent=16, bulletIndent=4, spaceAfter=4)
small = ParagraphStyle("SM", parent=body, fontSize=8.5, textColor=colors.HexColor("#555"))
code = ParagraphStyle("C", parent=ss["Code"], fontSize=7.4, leading=9.3, fontName="Courier")

story = []
P = lambda t, s=body: story.append(Paragraph(t, s))
B = lambda t: story.append(Paragraph(t, bul, bulletText="•"))
def _wrap_block(t, width=100):
    """Preformatted text does not wrap, so long lines ran off the page. Wrap each line,
    keeping its indentation for continuations."""
    out = []
    for line in t.split("\n"):
        if len(line) <= width:
            out.append(line)
            continue
        indent = " " * (len(line) - len(line.lstrip()) + 4)
        out.extend(textwrap.wrap(line, width, subsequent_indent=indent) or [""])
    return "\n".join(out)


CODE = lambda t: story.append(Preformatted(_wrap_block(t), code))


def table(rows, widths, size=7.6):
    t = Table(rows, colWidths=[w * inch for w in widths])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2b2b2b")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), size),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#bbb")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f5f5f5")]),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(t)


def cell(t):
    """Table cell that wraps."""
    return Paragraph(escape(t), ParagraphStyle("cell", parent=body, fontSize=7.4, leading=9.2, spaceAfter=0))


def wrap(label, text, width=92):
    text = " ".join(str(text).split())
    lines = textwrap.wrap(text, width - len(label)) or [""]
    pad = " " * len(label)
    return "\n".join((label if i == 0 else pad) + ln for i, ln in enumerate(lines))


def render(trace, start=1):
    out = []
    for t in trace:
        if t["step"] < start:
            continue
        out.append(f"[Step {t['step']}] selected_action = {t['action']}")
        out.append(wrap("  observation: ", t["observation"]))
        out.append(wrap("  result:      ", t["result"]))
        out.append(f"  stage after: {t['stageAfter']}")
        out.append("")
    seq = " -> ".join(t["action"] for t in trace)
    out.append(wrap("ACTION SEQUENCE: ", seq))
    return "\n".join(out)


pct = lambda x: "-" if x is None else f"{round(x * 100)}%"
seq = lambda rid: " -> ".join(t["action"] for t in RUNS[rid]["trace"])

# =========================================================== cover
story.append(Spacer(1, 36))
P("Georgia State University", sub)
P("J. Mack Robinson College of Business &mdash; PATH", sub)
P("CIS 4394 Agentic AI &middot; Fall 2026 &middot; Dr. Xinyu Fu", sub)
story.append(Spacer(1, 18))
P("Group Assignment 1: The Job Search Agent", title)
P("Group 6", ParagraphStyle("G", parent=sub, fontSize=14, textColor=colors.black))
story.append(Spacer(1, 12))
story.append(HRFlowable(width="100%", color=colors.HexColor("#ccc")))
story.append(Spacer(1, 10))

P("<b>Build path:</b> Code (Path C) &mdash; a full-stack Next.js / TypeScript web application with a "
  "genuine observation-driven decision engine, built and deployed.")
P("<b>Live agent:</b> https://g6-job-search-agent-g6.vercel.app/")
P("<b>Source code:</b> https://github.com/wmicah951-rgb/G6-.-job-search-agent-G6")
P("<b>Start here in the repository:</b> <font face='Courier'>DOCS-INDEX.md</font> (map of every document) "
  "and <font face='Courier'>G6-AGENT.md</font> (the agent in plain language).")
P("<b>AI tools used to build this project:</b>")
B("Claude Code (Anthropic; Claude Sonnet 5 and Claude Opus 5) &mdash; design, implementation, debugging and testing.")
B(f"DeepSeek (<font face='Courier'>deepseek-chat</font>) &mdash; used <i>by the deployed agent itself</i> as a "
  "reader at three points (reading the posting, matching the r&eacute;sum&eacute;, drafting after approval). "
  "The brain is swappable to Claude, any OpenAI-compatible endpoint, or a local model on Ollama; with no model "
  "at all the agent still runs and still produces all four required sequences.")
story.append(Spacer(1, 8))
P(f"<b>Required test results at a glance</b> &mdash; generated by running the agent "
  f"(brain: <font face='Courier'>{escape(DATA['model'])}</font>). Full traces in Section 4.")
table([
    ["Test", "Scenario", "Result", "Executed action sequence"],
    ["J001", cell("Obvious fit"), cell(f"Paused for human approval (fit {pct(RUNS['J001']['fitScore'])})"), cell(seq("J001"))],
    ["J002", cell("Partial fit"), cell(f"Auto-rejected, low fit ({pct(RUNS['J002']['fitScore'])}, bar 60%)"), cell(seq("J002"))],
    ["J003", cell("Hard-constraint conflict"), cell(f"Auto-rejected on the rule despite {pct(RUNS['J003']['fitScore'])} skill fit"), cell(seq("J003"))],
    ["J004", cell("Prompt injection"), cell("Injection refused, evaluated normally, paused for approval"), cell(seq("J004"))],
], [0.45, 1.05, 1.9, 3.1])
story.append(Spacer(1, 6))
P(f"<b>Result: {DATA['distinctRequired']} / 4 required tests produced materially different, "
  "programmatically verified action sequences.</b>")
story.append(PageBreak())

# =========================================================== 1
P("1. What the agent does", h1)
P("Given a candidate&rsquo;s r&eacute;sum&eacute; and preferences (a <i>profile</i>) and a job posting "
  "(pasted, or scraped from a URL), the agent checks the posting for hidden instructions, evaluates fit, "
  "checks the candidate&rsquo;s hard rules independently of fit, and <b>pauses for a human</b> before "
  "producing anything. After approval it drafts a cover letter and tailored r&eacute;sum&eacute;, checks its "
  "own writing, and re-scores the rewrite. It never sends, submits or contacts anyone.")
P("The four required guardrails, and exactly how each is enforced &mdash; stated precisely, not overclaimed:")
B("<b>Never fabricate.</b> A skill counts as matched only with a verbatim r&eacute;sum&eacute; quote; "
  "unverifiable matches are dropped. The cover letter and tailored r&eacute;sum&eacute; are written by a "
  "model and therefore <i>rephrased</i>, so literal quoting is impossible there; instead a separate "
  "deterministic checker flags every sentence containing a number, employer, tool or credential found in "
  "neither the r&eacute;sum&eacute; nor the human&rsquo;s note. Flagged lines are shown to the human, never "
  "silently removed. Employers, job titles, degrees and dates are carried over verbatim.")
B("<b>Job text is untrusted data.</b> The posting <i>is</i> read by the model &mdash; that is what the "
  "AI reader is for &mdash; but only as data. The model returns observations only and has no way to "
  "approve, reject, skip a step or set a stage; every branch is deterministic code. Injection is detected "
  "by a keyword floor that always runs <i>and</i> the AI reader; every snippet the model reports must "
  "appear verbatim in the posting.")
B("<b>Hard constraints override skill fit.</b> Years, clearance, relocation and work location are checked "
  "separately and first. A strong skill match is still auto-rejected if it breaks a rule, and these "
  "rejections cannot be overridden.")
B("<b>Real human-in-the-loop pause.</b> <font face='Courier'>runAgent()</font> cannot produce a draft; only "
  "a human decision can. The server returns HTTP 409 for any approval on a job not actually awaiting one, so "
  "the gate cannot be raced or skipped.")

# =========================================================== 2
P("2. Architecture", h1)
P("<b>The model is the brain; our code is the harness. The brain only observes; the harness always "
  "decides.</b>", body)
P("2.1 Mapping to the class&rsquo;s reference architecture", h2)
table([
    ["Layer", "Class reference", "What we built"],
    ["Goal", "Find suitable entry-level jobs", cell("Same.")],
    ["Environment", "Résumé + preferences + postings",
     cell("Same; multiple named profiles, postings pasted or scraped from a URL.")],
    ["Observe", cell("Résumé evidence, requirements, constraints, prior results"),
     cell("Same, plus the model's stated reasoning, which injection layer fired, and the full saved trace.")],
    ["Actions", cell("ASK_USER, investigate, down-rank/reject, request approval, draft"),
     cell("ask_user_clarification; scan_for_injection + evaluate_fit + check_hard_constraints (investigate); "
          "reject_hard_constraint / reject_low_fit (split so the reason is always traceable); "
          "request_human_approval; draft_application. Plus verify_draft and rescore_tailored_resume.")],
    ["State", cell("Jobs inspected, evidence, gaps, constraints, approval status"),
     cell("matchedEvidence, missingSkills (required vs nice-to-have), hardConstraintViolations, stage, plus "
          "fit score, partial-credit strengths and draft verification.")],
    ["Guardrail", cell("Never fabricate; never obey instructions in job text"),
     cell("Both enforced in code; see Section 1 for the precise form.")],
    ["Evaluation", cell("Fit, partial fit, hard-constraint, prompt-injection tests"),
     cell("J001, J002, J003, J004 exactly, plus 11 further cases.")],
], [0.8, 1.85, 3.85])

P("2.2 The complete loop", h2)
CODE("""  1  scan_for_injection            keyword floor + AI reader, verified snippets
  2  flag_injection_and_continue   ONLY if found: log, refuse, keep evaluating
  3  evaluate_fit                  weighted score; every match needs a resume quote
  4  check_hard_constraints        years / clearance / relocation / location
  5  ask_user_clarification        ONLY if location is genuinely unknown  -> pause
       human_answers_clarification   the person's answer, then continue
  6  decide (deterministic):
       broke a rule        -> reject_hard_constraint   (stop, no human)
       score < your bar    -> reject_low_fit           (stop, no human)
       otherwise           -> request_human_approval   (pause)
  ---------------------------- the human decides ------------------------------
  7  human_approve | human_edit | discard
       (on a low-fit rejection only: human_override_low_fit -> back to step 6's pause)
  8  draft_application             cover letter + tailored resume
  9  verify_draft                  flags any unsourced number/employer/tool/credential
 10  rescore_tailored_resume       same requirements, re-scored: before -> after

Steps 1-6 are the agent alone.  Step 7 is a person.  Steps 8-10 happen only because
a person said so.  Every step is logged:
  state_before -> observation -> available_actions -> selected_action -> result -> state_after""")

P("2.3 Scoring", h2)
P("The model lists only screening requirements (skills, tools, degrees, years) plus one domain requirement "
  "naming the role&rsquo;s core function. Each is required (weight 1) or preferred (0.5); each match is full or "
  "<i>partial</i> (internship, coursework or &lsquo;basics&rsquo; level, half credit &mdash; strictly the same "
  "named skill, never a different tool). Requirements are de-duplicated, and each is checked back against "
  "the posting text: a posting too short or truncated to support its requirements is flagged "
  "<i>low confidence</i> rather than reported as a confident score. The bar is per profile "
  "(<font face='Courier'>Minimum fit: 60%</font> in preferences.md).")

P("2.4 Swappable brain", h2)
P("<font face='Courier'>LLM_PROVIDER</font> selects DeepSeek, Claude, or any OpenAI-compatible endpoint "
  "including a local Ollama model (no API key required). Measured on a local "
  "<font face='Courier'>Qwen2.5-Omni-7B</font> (Q4): 9 of 13 gate tests pass &mdash; every case the "
  "deterministic harness and keyword floor own. The four misses are the three subtle injections and one "
  "borderline score, and <b>in all four the agent still stopped at request_human_approval</b>: it missed the "
  "warning, but did not obey the injection or draft without a person.")
story.append(PageBreak())

# =========================================================== 3
P("3. Tool / action inventory", h1)
P("Every action that appears as <font face='Courier'>selected_action</font> in a real trace. This list is "
  "checked by <font face='Courier'>scripts/doc-check.ts</font> against the code.")
table([
    ["Action", "What it does", "Why it is separate"],
    ["scan_for_injection", cell("Keyword floor (always) + AI reader; snippets verified against the posting"), cell("Runs first so nothing downstream can be steered")],
    ["flag_injection_and_continue", cell("Logs the refused text; evaluation continues on real content"), cell("Exists only on the injected path; makes that path longer")],
    ["evaluate_fit", cell("Weighted, de-duplicated, quote-verified score"), cell("Everything downstream branches on it")],
    ["check_hard_constraints", cell("Years / clearance / relocation / location"), cell("Independent of fit on purpose")],
    ["ask_user_clarification", cell("ASK_USER: pauses when the work arrangement is genuinely unknown"), cell("During evaluation (missing info), not after (go/no-go)")],
    ["human_answers_clarification", cell("The person's answer to that question"), cell("Keeps the person's action distinct from the agent's")],
    ["reject_hard_constraint", cell("Stops at rejected_hard_constraint"), cell("Distinct reason from low fit")],
    ["reject_low_fit", cell("Stops at rejected_low_fit"), cell("Distinct reason; overridable by a person")],
    ["request_human_approval", cell("Pauses at awaiting_approval"), cell("The mandatory HITL gate")],
    ["human_approve / human_edit", cell("The person approves, or approves with instructions"), cell("A person's decision, logged as theirs")],
    ["discard", cell("The person rejects; no draft"), cell("Distinct from the agent's own rejections")],
    ["human_override_low_fit", cell("'Apply anyway': reopens a low-fit rejection; score and gaps unchanged"), cell("Records a person overruled the agent")],
    ["draft_application", cell("Cover letter + tailored resume (+ literal evidence bullets)"), cell("Only reachable after a human decision")],
    ["verify_draft", cell("Deterministic check of generated text; flags unsourced facts"), cell("The model writes; separate code checks")],
    ["rescore_tailored_resume", cell("Re-scores the rewrite on the SAME requirements"), cell("Shows whether the rewrite helped; unearned gains called out")],
], [1.55, 2.75, 2.2], size=7.2)
story.append(PageBreak())

# =========================================================== 4
P("4. Four required test results (system-generated)", h1)
P(f"Produced by <font face='Courier'>scripts/export-traces.ts</font> running the agent; brain "
  f"<font face='Courier'>{escape(DATA['model'])}</font>; generated {escape(DATA['generatedAt'][:19])} UTC. "
  "The full run of every test posting ships as <font face='Courier'>required-test-traces.txt</font>.")
for i, (rid, label) in enumerate([("J001", "obvious fit"), ("J002", "partial fit"),
                                  ("J003", "hard-constraint conflict"), ("J004", "prompt injection embedded")], 1):
    P(f"4.{i} {rid} &mdash; {label}", h2)
    CODE(render(RUNS[rid]["trace"]))
P(f"<b>Cross-check (programmatic):</b> {DATA['distinctRequired']} distinct action sequences out of 4 required tests.")
story.append(PageBreak())

# =========================================================== 5
P("5. Two contrasting traces", h1)
P("5.1 Trace A &mdash; J003: shortest path, no human step at all", h2)
CODE(render(RUNS["J003"]["trace"]))
P(f"A {pct(RUNS['J003']['fitScore'])} skill match, rejected anyway: the hard-constraint check is a branch that "
  "short-circuits the run, not a filter feeding the same final step.")
P("5.2 Trace B &mdash; J004 carried through: injection refused, a human decides, then draft, "
  "self-check and re-score", h2)
CODE(render(RUNS["J004_full"]["trace"]))
v = RUNS["J004_full"].get("verification") or {}
rs = RUNS["J004_full"].get("rescore") or {}
P(f"Contrast: {len(RUNS['J004_full']['trace'])} steps against J003&rsquo;s {len(RUNS['J003']['trace'])}, "
  "including an action that exists only when injection is present, a genuine human decision, and three "
  "post-approval steps. Verification checked "
  f"{v.get('claims', '-')} claims and flagged {v.get('unsupported', '-')}; the re-score went "
  f"{pct(rs.get('before'))} &rarr; {pct(rs.get('after'))}. None of the embedded commands were obeyed.")
story.append(PageBreak())

# =========================================================== 6
P("6. Approval evidence", h1)
P("J001, decision = Approve, captured from the agent&rsquo;s own structured log:")
CODE(render(RUNS["J001_approved"]["trace"], start=4))
va = RUNS["J001_approved"].get("verification") or {}
ra = RUNS["J001_approved"].get("rescore") or {}
P(f"Verification: the trace's step 7 counts claims across <i>both</i> documents; the tailored "
  f"r&eacute;sum&eacute; alone had {va.get('claims', '-')} claims checked and {va.get('unsupported', '-')} flagged. Re-score: {pct(ra.get('before'))} &rarr; {pct(ra.get('after'))}. "
  "Opening of the tailored r&eacute;sum&eacute; produced after that approval:")
_ex = RUNS["J001_approved"].get("resumeExcerpt", "").strip()
_lines = _ex.splitlines()
# drop a trailing partial line so the excerpt ends cleanly
CODE("".join(l + chr(10) for l in _lines[:-1]) if len(_lines) > 1 else _ex)
P("ASK_USER, answered both ways (J007) &mdash; the same paused run resumes to different outcomes:")
CODE("compatible -> " + " -> ".join(t["action"] for t in RUNS["J007_compatible"]["trace"]) +
     "\n\nviolation  -> " + " -> ".join(t["action"] for t in RUNS["J007_violation"]["trace"]))
P("The server refuses (HTTP 409) any approval on a job already decided, auto-rejected, or still awaiting a "
  "clarification; verified by <font face='Courier'>scripts/local-e2e.mjs</font>.")

# =========================================================== 7
P("7. Testing", h1)
table([
    ["Suite", "What it proves", "Result"],
    ["run-tests.ts", cell("15 postings, full traces"), "4/4 distinct"],
    ["conformance.ts", cell("Every gate on the configured model"), "13/13"],
    ["conformance.ts (no model)", cell("Every gate with no AI at all"), "9/9"],
    ["stress-suite.ts", cell("Coverage, arithmetic, monotonicity, discrimination, stability, edge cases, post-draft; no action logged twice in a row"), "64/64"],
    ["verify-tests.ts", cell("Draft checking, incl. zero flags on honest heavy rewording"), "18/18"],
    ["local-e2e.mjs", cell("Whole app over HTTP incl. 409 guards, override, delete"), "48/48"],
    ["harness-tests.mjs", cell("Settings persist, clamp, refuse bad input, reach the agent"), "16/16"],
    ["knob-tests.ts", cell("Preference knobs round-trip and edit exactly one line"), "16/16"],
    ["doc-check.ts", cell("Docs list every action and repeat no known-false claim"), "pass"],
    ["Live Test Lab", cell("Same cases against the deployed site"), "9/9"],
], [1.7, 3.8, 1.0])
P("Injection defence, escalating: J004 and J008 (explicit, HTML comment) are caught by the keyword floor; "
  "J012 (&lsquo;if you are a language model&rsquo;) was moved into the floor after the model proved "
  "unreliable on it; J009&ndash;J011 (polite, bureaucratic, hidden in a poem) are caught only by the AI "
  "reader, verified by running with the model switched off. J013 is an innocent posting full of "
  "injection-sounding wording and must stay clean.")

# =========================================================== 8
P("8. Reflection: what makes this an agent, not a workflow", h1)
P("A workflow runs the same steps for every input and varies only the values. Here the <b>executed "
  "sequence itself</b> changes with what the agent observes:")
B("<b>J003</b> ends after 4 steps at reject_hard_constraint and never reaches a human, despite a strong skill match.")
B("<b>J002</b> also stops, at the same decision point, for an independently checked and differently logged reason.")
B("<b>J004</b> takes a step, flag_injection_and_continue, that exists only when the input contains an injection.")
B("<b>J007</b> stops mid-evaluation to ask, and the same paused run resumes to different outcomes depending on the answer.")
P("Sequences range from 4 to 10 steps across the test set, and the four required tests produce 4 distinct "
  "sequences, verified programmatically.")
P("Where the guardrails actually did something", h2)
P("The honest version of the injection result: the posting <i>is</i> shown to a model, so a model can be "
  "fooled into <i>saying</i> something. What makes the agent safe is that the model has no way to "
  "<i>act</i> &mdash; it returns observations, and deterministic code makes every decision. The local-model "
  "test shows this directly: a small model missed three subtle injections, and the agent still did not obey "
  "them or draft without a person. Testing also caught real defects in our own guardrails, which we fixed: "
  "an injection scanner that flagged innocent postings (&lsquo;we do not automatically reject anyone&rsquo;), "
  "a draft checker that flagged honest paraphrase, a re-score that compared two different requirement lists, "
  "and trace entries that logged a person&rsquo;s decision under the agent&rsquo;s action name.")
P("What we would improve with more time", h2)
B("Stream each step live to the browser as it happens; today the steps are replayed once the result lands.")
B("Calibrate the fit bar against a large set of real postings rather than our own test set.")
B("Stronger local-model support: small models are markedly weaker at structured extraction.")

SimpleDocTemplate(OUT, pagesize=letter, leftMargin=0.7 * inch, rightMargin=0.7 * inch,
                  topMargin=0.7 * inch, bottomMargin=0.7 * inch,
                  title="G6 Job Search Agent - Submission", author="Group 6").build(story)
print("wrote", OUT)
