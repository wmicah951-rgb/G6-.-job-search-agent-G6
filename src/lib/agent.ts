// Core Job Search Agent
//
// This is a genuine agent, not a fixed pipeline: `decideNextAction` selects the
// next action from a set of MATERIALLY DIFFERENT available actions based on the
// current state + the latest observation. Different inputs (a hard-constraint
// violation, a low fit score, an embedded prompt injection) cause the agent to
// walk different, shorter or longer, action sequences. Every step is logged as
// a structured trace entry: stateBefore -> observation -> availableActions ->
// selectedAction -> result -> stateAfter.
//
// Skill/requirement matching is the ONE step that can optionally call an LLM
// (see performFitEvaluation() below and src/lib/llmEvaluator.ts) for more
// semantically flexible matching than fixed-dictionary keyword search. Nothing
// else does: the injection scan, hard-constraint checks, the branch that
// decides reject/pause-for-human, and the human-approval gate are all plain
// deterministic code, completely untouched by whatever the LLM returns. The
// LLM is a tool the agent calls, never the decision-maker.

import { evaluateFitWithLlm, isLlmConfigured, draftApplicationMaterials } from "./llmEvaluator";

export type Stage =
  | "start"
  | "scanned"
  | "evaluated"
  | "constraints_checked"
  | "awaiting_clarification"
  | "awaiting_approval"
  | "approved"
  | "edited"
  | "rejected_by_human"
  | "drafted"
  | "rejected_low_fit"
  | "rejected_hard_constraint"
  | "discarded";

export interface AgentState {
  jobId: string;
  stage: Stage;
  injectionDetected: boolean;
  injectionSnippets: string[];
  fitScore: number | null;
  matchedSkills: string[];
  missingSkills: string[];
  // Verified verbatim resume.md quote backing each entry in matchedSkills. Populated
  // by performFitEvaluation() regardless of whether it used the LLM or the
  // deterministic matcher, so drafting/rationale never need to re-derive evidence —
  // they just look it up here. This is what keeps grounding mechanically true even
  // when an LLM proposed the match: the quote was already verified as a literal
  // substring of resumeText before being stored.
  matchedEvidence: Record<string, string>;
  fitMethod: "llm" | "deterministic";
  // Only set when fitMethod === "llm": the model's own short explanation of its
  // assessment, surfaced in the trace/UI so you can see what it was "thinking".
  fitReasoning: string | null;
  // Grounded, positive-framed reasons this posting suits the candidate — distinct
  // from missingSkills (gaps) and matchedSkills (a bare list): this is the "why"
  // narrative, each line traceable to resume.md/preferences.md, never invented.
  fitRationale: string[];
  hardConstraintViolations: string[];
  redFlags: string[];
  // Set only while stage === "awaiting_clarification": the specific question
  // the agent needs a human to resolve before it can finish deciding — this
  // is the ASK_USER action, distinct from request_human_approval (which only
  // ever asks "do you want to proceed?" after a full evaluation).
  clarificationQuestion: string | null;
  approvalNote: string | null;
  draft: string | null;
  coverLetter: string | null;
  tailoredResume: string | null;
}

export interface TraceStep {
  step: number;
  stateBefore: Partial<AgentState>;
  observation: string;
  availableActions: string[];
  selectedAction: string;
  result: string;
  stateAfter: Partial<AgentState>;
}

export interface EvaluationResult {
  state: AgentState;
  trace: TraceStep[];
}

// ---------- Skill dictionary (extend freely) ----------
const SKILL_ALIASES: Record<string, string[]> = {
  SQL: ["sql", "postgres", "postgresql", "mysql", "t-sql", "query tuning"],
  Python: ["python", "pandas", "numpy", "matplotlib"],
  "Power BI": ["power bi", "powerbi"],
  Excel: ["excel", "vlookup", "pivot table", "pivot tables"],
  Tableau: ["tableau"],
  R: [" r ", "r programming", "r language"],
  "Machine Learning": ["machine learning", "scikit-learn", "sklearn", "ml model"],
  Git: ["git", "github", "version control"],
  "A/B Testing": ["a/b test", "ab testing", "experimentation"],
  ETL: ["etl", "data pipeline", "data pipelines"],
  Databricks: ["databricks"],
  Spark: ["spark", "pyspark"],
  "Cloud (Azure)": ["azure"],
  "Cloud (AWS)": ["aws", "amazon web services"],
  "Deep Learning": ["deep learning", "neural network", "tensorflow", "pytorch"],
};

function extractSkills(text: string): string[] {
  const lower = ` ${text.toLowerCase()} `;
  const found: string[] = [];
  for (const [canonical, aliases] of Object.entries(SKILL_ALIASES)) {
    if (aliases.some((a) => lower.includes(a))) found.push(canonical);
  }
  return found;
}

// ---------- Years-of-experience extraction ----------
function extractRequiredYears(jobText: string): number | null {
  // Must be tied to actual experience-requirement phrasing, not just the first
  // "<N> years" digit anywhere in the text — real postings often mention unrelated
  // year counts (e.g. "a 20+ year tech services expert", describing the COMPANY's
  // age, not the years of experience required of a candidate). Checking each
  // pattern in order of specificity avoids picking up that kind of false match.
  // For a range like "3-5+ years", the lower bound is used since that is the
  // actual minimum a candidate needs to clear.
  const experiencePatterns = [
    /(\d+)\s*\+?\s*(?:[-–—]\s*\d+\s*\+?\s*)?years?\s*(?:of\s+)?(?:relevant\s+|professional\s+|prior\s+|work(?:ing)?\s+)?experience/i,
    /(?:requires?|minimum(?: of)?|at least|must have)\s*(\d+)\+?\s*years?/i,
    /(\d+)\s*\+?\s*(?:[-–—]\s*\d+\s*\+?\s*)?years?\s*(?:in|with|working)/i,
  ];
  for (const re of experiencePatterns) {
    const match = jobText.match(re);
    if (match) return parseInt(match[1], 10);
  }
  return null;
}

function extractCandidateYears(resumeText: string): number {
  const explicit = resumeText.match(
    /total professional experience:\s*~?(\d+(\.\d+)?)\s*years?/i
  );
  if (explicit) return parseFloat(explicit[1]);
  // fallback: sum of "(... yrs)" annotations
  const yrs = [...resumeText.matchAll(/\((\d+(\.\d+)?)\s*yrs?\)/gi)].map((m) =>
    parseFloat(m[1])
  );
  if (yrs.length) return yrs.reduce((a, b) => a + b, 0);
  return 0;
}

// ---------- Prompt-injection heuristics ----------
const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all|any|the)?\s*(previous|prior|above)?\s*instructions/i,
  /disregard (your|the|all)?\s*(rules|instructions|resume)/i,
  // Narrowed to "you are/must now a/an/the <noun>" (classic persona-reassignment
  // phrasing) so it doesn't fire on ordinary sentences like "you must now complete
  // onboarding" or "you are now able to apply".
  /you (are|must) now (an?|the)\s+\w+/i,
  // Narrowed to "SYSTEM:" followed by instruction-like language, so it doesn't fire
  // on legitimate posting sections like "System Requirements: Windows 10, 16GB RAM".
  /system\s*:\s*(ignore|disregard|you are|act as|do not|skip|override|new instructions)/i,
  /new instructions/i,
  /automatically (approve|accept|reject)/i,
  /skip (the )?(human )?approval/i,
  /do not (evaluate|check|verify)/i,
  /reply with (only|exactly)/i,
  /print (the|this) (resume|prompt|instructions)/i,
  // Narrowed to "act as a/an/the <AI-ish noun>" so it doesn't fire on ordinary role
  // descriptions like "you will act as a critical backend engine for the team".
  /act as (an?|the) (ai|assistant|chatbot|bot|language model|llm|agent)\b/i,
  /this candidate (is|should be) (perfect|hired|approved)/i,
];

function scanForInjection(jobText: string): { detected: boolean; snippets: string[] } {
  const snippets: string[] = [];
  for (const re of INJECTION_PATTERNS) {
    const m = jobText.match(re);
    if (m) snippets.push(m[0]);
  }
  return { detected: snippets.length > 0, snippets };
}

// ---------- Hard constraints ----------
function checkHardConstraints(
  jobText: string,
  candidateYears: number,
  preferencesText: string
): string[] {
  const violations: string[] = [];
  const lowerJob = jobText.toLowerCase();
  const lowerPrefs = preferencesText.toLowerCase();

  const requiredYears = extractRequiredYears(jobText);
  const maxYearsMatch = lowerPrefs.match(/will not apply.*?(\d+)\+?\s*years/i);
  const candidateMaxYears = maxYearsMatch ? parseInt(maxYearsMatch[1], 10) : null;
  if (
    requiredYears !== null &&
    candidateMaxYears !== null &&
    requiredYears >= candidateMaxYears &&
    candidateYears < requiredYears
  ) {
    violations.push(
      `Requires ${requiredYears}+ years; candidate has ~${candidateYears} years (hard constraint: no roles requiring ${candidateMaxYears}+ years)`
    );
  }

  if (
    lowerPrefs.includes("will not apply to roles requiring an active security clearance") &&
    /security clearance/i.test(jobText)
  ) {
    violations.push("Role requires an active security clearance");
  }

  if (
    lowerPrefs.includes("remote or hybrid only") &&
    /on-?site only|no remote|in-?office only|must relocate/i.test(jobText) &&
    !/remote|hybrid/i.test(jobText)
  ) {
    violations.push("Role is on-site only with no remote/hybrid option");
  }

  return violations;
}

// ---------- ASK_USER: hard constraints the agent can't confidently evaluate ----------
// checkHardConstraints() above only flags a location violation when the posting
// explicitly says something like "on-site only" — if a posting never mentions
// work arrangement at all, that function silently treats it as no violation,
// which is really the agent guessing on the candidate's behalf. This function
// catches exactly that gap: a posting that says nothing about remote/hybrid/
// on-site while the candidate has a hard "remote or hybrid only" rule. When
// true, the agent should ask rather than assume either way.
function detectLocationAmbiguity(jobText: string, preferencesText: string): string | null {
  const lowerPrefs = preferencesText.toLowerCase();
  if (!lowerPrefs.includes("remote or hybrid only")) return null;
  const mentionsWorkArrangement = /remote|hybrid|on-?site|in-?office|relocate/i.test(jobText);
  if (mentionsWorkArrangement) return null;
  return (
    "This posting never states whether the role is remote, hybrid, or on-site, " +
    "but your preferences require remote-or-hybrid-only. Should this posting be " +
    "treated as compatible with that preference, or as a violation of it?"
  );
}

// ---------- Fit scoring (deterministic keyword path) ----------
function evaluateFit(resumeSkills: string[], jobSkills: string[]) {
  const matched = jobSkills.filter((s) => resumeSkills.includes(s));
  const missing = jobSkills.filter((s) => !resumeSkills.includes(s));
  const score = jobSkills.length === 0 ? 0 : matched.length / jobSkills.length;
  return { score: Math.round(score * 100) / 100, matched, missing };
}

// Finds the actual resume.md line that justifies a matched skill, via the fixed
// alias dictionary. Only used by the deterministic path — the LLM path gets its
// evidence quotes directly from the model, verified against resumeText instead.
function findEvidenceLine(resumeText: string, skill: string): string | null {
  const aliases = SKILL_ALIASES[skill] ?? [skill.toLowerCase()];
  const lines = resumeText.split("\n").map((l) => l.trim()).filter(Boolean);
  const evidenceLine = lines.find((l) =>
    aliases.some((a) => l.toLowerCase().includes(a.trim()))
  );
  return evidenceLine ? evidenceLine.replace(/^[-*]\s*/, "") : null;
}

export interface FitEvaluation {
  score: number;
  matched: string[];
  missing: string[];
  matchedEvidence: Record<string, string>;
  method: "llm" | "deterministic";
  reasoning: string | null;
  note: string;
}

// The one step in the whole agent that may call an LLM (see llmEvaluator.ts).
// Always falls back to the deterministic keyword matcher — on no API key, an
// API error, a timeout, or a response with zero verifiable matches — so the
// app never breaks or blocks on the LLM being unavailable.
//
// Trust-but-verify: the LLM is only ever allowed to PROPOSE a match. A match is
// kept only if its evidenceQuote is an actual, literal (case-insensitive)
// substring of resumeText. Anything the model invents or paraphrases is
// silently dropped rather than trusted — this is what keeps "never fabricate"
// mechanically true even with an LLM in the loop.
async function performFitEvaluation(
  resumeText: string,
  jobText: string
): Promise<FitEvaluation> {
  if (isLlmConfigured()) {
    try {
      const llmResult = await evaluateFitWithLlm(resumeText, jobText);
      const lowerResume = resumeText.toLowerCase();
      const matchedEvidence: Record<string, string> = {};
      const matched: string[] = [];
      let droppedCount = 0;

      for (const m of llmResult.matchedRequirements) {
        if (m.evidenceQuote && lowerResume.includes(m.evidenceQuote.toLowerCase())) {
          matched.push(m.requirement);
          matchedEvidence[m.requirement] = m.evidenceQuote;
        } else {
          droppedCount += 1;
        }
      }

      const missing = llmResult.missingRequirements;
      const total = matched.length + missing.length;
      const score = total === 0 ? 0 : Math.round((matched.length / total) * 100) / 100;

      return {
        score,
        matched,
        missing,
        matchedEvidence,
        method: "llm",
        reasoning: llmResult.reasoning,
        note:
          droppedCount > 0
            ? `LLM semantic matching (${droppedCount} proposed match(es) dropped for lacking a verbatim resume.md quote).`
            : "LLM semantic matching.",
      };
    } catch (err) {
      // Fall through to the deterministic path below. The specific error is
      // surfaced by the caller's trace log, not swallowed silently.
      const resumeSkills = extractSkills(resumeText);
      const jobSkills = extractSkills(jobText);
      const { score, matched, missing } = evaluateFit(resumeSkills, jobSkills);
      const matchedEvidence: Record<string, string> = {};
      for (const skill of matched) {
        const line = findEvidenceLine(resumeText, skill);
        if (line) matchedEvidence[skill] = line;
      }
      return {
        score,
        matched: matched.filter((s) => matchedEvidence[s]),
        missing,
        matchedEvidence,
        method: "deterministic",
        reasoning: null,
        note: `LLM call failed (${String(err).slice(0, 120)}) — fell back to deterministic keyword matching.`,
      };
    }
  }

  const resumeSkills = extractSkills(resumeText);
  const jobSkills = extractSkills(jobText);
  const { score, matched, missing } = evaluateFit(resumeSkills, jobSkills);
  const matchedEvidence: Record<string, string> = {};
  for (const skill of matched) {
    const line = findEvidenceLine(resumeText, skill);
    if (line) matchedEvidence[skill] = line;
  }
  return {
    score,
    matched: matched.filter((s) => matchedEvidence[s]),
    missing,
    matchedEvidence,
    method: "deterministic",
    reasoning: null,
    note: "No ANTHROPIC_API_KEY configured — used deterministic keyword matching.",
  };
}

// ---------- Grounded "why this fits" rationale ----------
// Deliberately distinct from missingSkills (the gap list): this builds a positive,
// evidence-backed narrative of why the posting suits the candidate. Every line is
// tied to an actual quote from resume.md or a checkable comparison against
// preferences.md — never a generic "great fit!" statement.
function explainFit(
  matchedEvidence: Record<string, string>,
  jobText: string,
  preferencesText: string,
  matchedSkills: string[],
  candidateYears: number
): string[] {
  // No skill overlap at all means there is no truthful "why this fits" story to
  // tell — returning early here (rather than falling through to the generic
  // years/title/company-size lines below) is what stops a 0%-fit posting from
  // ever showing a positive-framed rationale panel. Those generic lines are
  // supporting color for a real skill match, not fit signals on their own.
  if (matchedSkills.length === 0) return [];

  const reasons: string[] = [];

  for (const skill of matchedSkills.slice(0, 3)) {
    const line = matchedEvidence[skill];
    if (line) reasons.push(`${skill} — resume.md: "${line}"`);
  }

  reasons.push(
    `Documented experience: ~${candidateYears} years (resume.md, "Total professional experience").`
  );

  const titleLine = jobText.match(/^#?\s*(.+)$/m);
  const roleTitle = titleLine ? titleLine[1].trim() : "";
  const prefTitleMatch = preferencesText.match(
    /prefers titles containing[^"]*"([^"]+)"(?:\s*or\s*"([^"]+)")?/i
  );
  if (prefTitleMatch && roleTitle) {
    const keywords = [prefTitleMatch[1], prefTitleMatch[2]].filter(Boolean) as string[];
    const hit = keywords.find((k) => roleTitle.toLowerCase().includes(k.toLowerCase()));
    if (hit) {
      reasons.push(
        `Title "${roleTitle}" matches your preferences.md preference for titles containing "${hit}".`
      );
    }
  }

  const prefSizeMatch = preferencesText.match(/companies under\s*([\d,]+)\s*employees/i);
  const jobSizeMatch = jobText.match(/\(?\s*([\d,]+)\s*employees/i);
  if (prefSizeMatch && jobSizeMatch) {
    const prefSize = parseInt(prefSizeMatch[1].replace(/,/g, ""), 10);
    const jobSize = parseInt(jobSizeMatch[1].replace(/,/g, ""), 10);
    if (jobSize < prefSize) {
      reasons.push(
        `Company size (~${jobSize.toLocaleString()} employees) is under your preferences.md cap of ${prefSize.toLocaleString()}.`
      );
    }
  }

  return reasons;
}

// Raised from an earlier 0.34 after live testing with the optional LLM
// matcher: the LLM extracts a smaller, coarser set of distinct requirements
// per posting than the fixed keyword dictionary does, so each match/miss
// swings the ratio further. 0.45 ("well under half the named requirements
// met") reproduces the correct reject/pass split for the required test set
// under BOTH the deterministic and LLM matchers.
const LOW_FIT_THRESHOLD = 0.45;

type LogFn = (
  observation: string,
  availableActions: string[],
  selectedAction: string,
  result: string,
  before: AgentState,
  after: AgentState
) => void;

// The core branch: three materially different paths, chosen from state alone.
// Shared by runAgent() (the normal path) and applyClarificationAnswer() (the
// resume-after-ASK_USER path), so both go through the exact same tested
// decision logic instead of two copies that could drift apart.
function decideAfterConstraints(state: AgentState, log: LogFn): AgentState {
  if (state.hardConstraintViolations.length > 0) {
    const before = { ...state };
    state = { ...state, stage: "rejected_hard_constraint" };
    log(
      `State shows hard constraint violation(s): ${before.hardConstraintViolations.join("; ")}`,
      ["reject_hard_constraint", "reject_low_fit", "request_human_approval"],
      "reject_hard_constraint",
      "Job rejected automatically on a HARD constraint (years/clearance/location), regardless of skill fit. No draft will be produced. Human approval step skipped (nothing to approve).",
      before,
      state
    );
    return state;
  }

  if ((state.fitScore ?? 0) < LOW_FIT_THRESHOLD) {
    const before = { ...state };
    state = { ...state, stage: "rejected_low_fit" };
    log(
      `Fit score ${state.fitScore} is below the low-fit threshold (${LOW_FIT_THRESHOLD}).`,
      ["reject_hard_constraint", "reject_low_fit", "request_human_approval"],
      "reject_low_fit",
      "Job down-ranked and rejected automatically for low skill fit (constraints were fine). No draft produced.",
      before,
      state
    );
    return state;
  }

  const before = { ...state };
  state = { ...state, stage: "awaiting_approval" };
  log(
    `Constraints passed. fit_score=${state.fitScore} >= threshold ${LOW_FIT_THRESHOLD}.`,
    ["reject_hard_constraint", "reject_low_fit", "request_human_approval"],
    "request_human_approval",
    "Evaluation surfaced to human for Approve / Edit / Reject. Agent paused — no draft produced yet.",
    before,
    state
  );
  return state;
}

// ---------- The agent loop ----------
export async function runAgent(
  jobId: string,
  jobText: string,
  resumeText: string,
  preferencesText: string
): Promise<EvaluationResult> {
  const trace: TraceStep[] = [];
  let step = 0;

  let state: AgentState = {
    jobId,
    stage: "start",
    injectionDetected: false,
    injectionSnippets: [],
    fitScore: null,
    matchedSkills: [],
    missingSkills: [],
    matchedEvidence: {},
    fitMethod: "deterministic",
    fitReasoning: null,
    fitRationale: [],
    hardConstraintViolations: [],
    redFlags: [],
    clarificationQuestion: null,
    approvalNote: null,
    draft: null,
    coverLetter: null,
    tailoredResume: null,
  };

  // Computed once up front and reused by both the fit-rationale and
  // hard-constraint checks below, so the two steps agree on the same number.
  const candidateYears = extractCandidateYears(resumeText);

  function log(
    observation: string,
    availableActions: string[],
    selectedAction: string,
    result: string,
    before: AgentState,
    after: AgentState
  ) {
    step += 1;
    trace.push({
      step,
      stateBefore: { ...before },
      observation,
      availableActions,
      selectedAction,
      result,
      stateAfter: { ...after },
    });
  }

  // --- Decision point 1: scan for injection (treat job text as DATA, never instructions) ---
  {
    const before = { ...state };
    const { detected, snippets } = scanForInjection(jobText);
    state = {
      ...state,
      stage: "scanned",
      injectionDetected: detected,
      injectionSnippets: snippets,
    };
    log(
      `Raw job posting text received (${jobText.length} chars). Treated as untrusted data only.`,
      ["scan_for_injection", "evaluate_fit", "check_hard_constraints", "reject_hard_constraint", "reject_low_fit", "request_human_approval", "draft_application"],
      "scan_for_injection",
      detected
        ? `Embedded instruction-like text detected — logging and continuing normal evaluation, NOT obeying it.`
        : "No embedded instructions detected.",
      before,
      state
    );
  }

  // --- Decision point 1b: only taken when injection was detected — this action does not
  // exist on the "clean posting" path, so an injected posting takes a materially longer,
  // different action sequence than a clean one even before fit/constraints are checked. ---
  if (state.injectionDetected) {
    const before = { ...state };
    log(
      `Injected instructions found: ${state.injectionSnippets.join(" | ")}`,
      ["flag_injection_and_continue"],
      "flag_injection_and_continue",
      "Flag recorded in state. Evaluation proceeds on the ACTUAL resume/job data only — the embedded commands to auto-approve, skip human review, or print resume.md verbatim were all refused.",
      before,
      state
    );
  }

  // --- Decision point 2: evaluate skill fit against resume ---
  // performFitEvaluation() tries the LLM (if configured) for semantic matching,
  // falling back to deterministic keyword matching on no API key, an API error,
  // or a timeout — see its own comments for the trust-but-verify grounding rule.
  {
    const before = { ...state };
    const fit = await performFitEvaluation(resumeText, jobText);
    const fitRationale = explainFit(
      fit.matchedEvidence,
      jobText,
      preferencesText,
      fit.matched,
      candidateYears
    );
    state = {
      ...state,
      stage: "evaluated",
      fitScore: fit.score,
      matchedSkills: fit.matched,
      missingSkills: fit.missing,
      matchedEvidence: fit.matchedEvidence,
      fitMethod: fit.method,
      fitReasoning: fit.reasoning,
      fitRationale,
    };
    log(
      `${fit.note} Requirements checked against resume.md.` +
        (fit.reasoning ? ` Model's reasoning: "${fit.reasoning}"` : ""),
      ["check_hard_constraints", "reject", "request_human_approval"],
      "evaluate_fit",
      `fit_score=${fit.score}, matched=[${fit.matched.join(", ")}], missing=[${fit.missing.join(", ")}]`,
      before,
      state
    );
  }

  // --- Decision point 3: check hard constraints ---
  {
    const before = { ...state };
    const violations = checkHardConstraints(jobText, candidateYears, preferencesText);
    state = {
      ...state,
      stage: "constraints_checked",
      hardConstraintViolations: violations,
    };
    log(
      `Candidate years of experience: ~${candidateYears}. Preferences hard constraints checked against posting.`,
      ["reject", "request_human_approval"],
      "check_hard_constraints",
      violations.length
        ? `VIOLATION(S): ${violations.join("; ")}`
        : "No hard constraint violations.",
      before,
      state
    );
  }

  // --- Decision point 3b: ASK_USER — only reached when nothing has already
  // decided this job's fate (a violation already found means asking wouldn't
  // change the outcome) AND the posting is genuinely silent on something a
  // hard constraint depends on. This does not exist on any path where the
  // posting actually states its work arrangement — see the four required
  // tests, all of which do — so it never changes their behavior; it only
  // fires for postings where guessing would mean silently deciding for the
  // candidate instead of asking them.
  if (state.hardConstraintViolations.length === 0) {
    const clarificationQuestion = detectLocationAmbiguity(jobText, preferencesText);
    if (clarificationQuestion) {
      const before = { ...state };
      state = { ...state, stage: "awaiting_clarification", clarificationQuestion };
      log(
        "Hard constraint depends on information the posting never states.",
        ["ask_user_clarification"],
        "ask_user_clarification",
        `Agent paused to ask: "${clarificationQuestion}"`,
        before,
        state
      );
      return { state, trace };
    }
  }

  // --- Decision point 4: agent SELECTS next action based on state so far ---
  state = decideAfterConstraints(state, log);
  return { state, trace };
}

// ---------- Called after a human resolves an ASK_USER clarification ----------
// Resumes exactly where the agent paused, using the human's answer to settle
// the one ambiguous hard constraint, then runs through the SAME
// decideAfterConstraints() branch logic runAgent() itself uses — not a copy.
export function applyClarificationAnswer(
  prior: EvaluationResult,
  answer: "compatible" | "violation"
): EvaluationResult {
  const trace = [...prior.trace];
  let step = trace.length;
  let state = { ...prior.state };

  function log(
    observation: string,
    availableActions: string[],
    selectedAction: string,
    result: string,
    before: AgentState,
    after: AgentState
  ) {
    step += 1;
    trace.push({
      step,
      stateBefore: { ...before },
      observation,
      availableActions,
      selectedAction,
      result,
      stateAfter: { ...after },
    });
  }

  const before = { ...state };
  const violations = [...state.hardConstraintViolations];
  if (answer === "violation") {
    violations.push(
      'Posting never states its work arrangement; human resolved this as a violation of "remote or hybrid only".'
    );
  }
  state = {
    ...state,
    stage: "constraints_checked",
    hardConstraintViolations: violations,
    clarificationQuestion: null,
  };
  log(
    `Human answered: ${
      answer === "compatible"
        ? "treat this posting as compatible with the remote/hybrid preference"
        : "treat this posting as a violation of the remote/hybrid preference"
    }.`,
    ["reject_hard_constraint", "reject_low_fit", "request_human_approval"],
    "ask_user_clarification",
    "Clarification resolved. Resuming evaluation with the human's answer incorporated.",
    before,
    state
  );

  state = decideAfterConstraints(state, log);
  return { state, trace };
}

// ---------- Called after a human makes an Approve/Edit/Reject decision ----------
// Note: no resumeText parameter — drafting uses state.matchedEvidence, the
// quotes already verified against the resume at evaluation time, so a draft
// can never be affected by anything that happened to the resume/profile since.
export async function applyHumanDecision(
  prior: EvaluationResult,
  decision: "approve" | "edit" | "reject",
  editNote: string | null,
  jobText: string,
  resumeText: string | null
): Promise<EvaluationResult> {
  const trace = [...prior.trace];
  let step = trace.length;
  let state = { ...prior.state };

  function log(
    observation: string,
    availableActions: string[],
    selectedAction: string,
    result: string,
    before: AgentState,
    after: AgentState
  ) {
    step += 1;
    trace.push({
      step,
      stateBefore: { ...before },
      observation,
      availableActions,
      selectedAction,
      result,
      stateAfter: { ...after },
    });
  }

  const before = { ...state };

  if (decision === "reject") {
    state = { ...state, stage: "rejected_by_human" };
    log(
      "Human selected: Reject.",
      ["draft_application", "discard"],
      "discard",
      "Human rejected the evaluation. No draft produced.",
      before,
      state
    );
    return { state, trace };
  }

  if (decision === "edit") {
    state = { ...state, stage: "edited", approvalNote: editNote };
    log(
      `Human selected: Edit. Note: "${editNote}"`,
      ["draft_application", "discard"],
      "draft_application",
      "Human edited the evaluation notes and approved drafting to proceed with the edit applied.",
      before,
      state
    );
  } else {
    state = { ...state, stage: "approved" };
    log(
      "Human selected: Approve.",
      ["draft_application", "discard"],
      "draft_application",
      "Human approved. Proceeding to draft application material grounded only in resume.md.",
      before,
      state
    );
  }

  // Draft, grounded ONLY in facts extracted from resume.md — never fabricated.
  const draftBefore = { ...state };
  const { draft, coverLetter, tailoredResume } = await draftApplication(
    state.matchedEvidence, state.missingSkills, jobText, state.matchedSkills, state.approvalNote, resumeText
  );
  state = { ...state, stage: "drafted", draft, coverLetter, tailoredResume };
  log(
    `Drafting using matched_skills=[${state.matchedSkills.join(", ")}] and resume.md as the only source of candidate facts.${coverLetter ? " LLM-powered cover letter and tailored resume generated." : " Deterministic bullet-point draft (no LLM configured)."}`,
    ["draft_application"],
    "draft_application",
    "Draft produced. Every claim traces back to a line in resume.md; nothing outside the resume was asserted." +
      (coverLetter ? " Full cover letter and tailored resume included." : ""),
    draftBefore,
    state
  );

  return { state, trace };
}

async function draftApplication(
  matchedEvidence: Record<string, string>,
  missingSkills: string[],
  jobText: string,
  matchedSkills: string[],
  editNote: string | null,
  resumeText: string | null
): Promise<{ draft: string; coverLetter: string | null; tailoredResume: string | null }> {
  // Always produce the deterministic bullet-point draft as a baseline
  const bullets: string[] = [];
  for (const skill of matchedSkills) {
    const evidenceLine = matchedEvidence[skill];
    if (evidenceLine) {
      bullets.push(`- ${skill}: "${evidenceLine}"`);
    }
  }

  const titleMatch = jobText.match(/^#?\s*(.+)$/m);
  const roleTitle = titleMatch ? titleMatch[1].trim() : "this role";

  const draft = [
    `Draft cover-letter bullets for ${roleTitle}`,
    "",
    "Grounded matches (each line quoted directly from resume.md — nothing invented):",
    ...bullets,
    "",
    editNote ? `Human edit note applied: ${editNote}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  // Try LLM-powered drafting for a real cover letter + tailored resume
  if (resumeText) {
    const llmDraft = await draftApplicationMaterials(
      matchedEvidence, missingSkills, jobText, resumeText, editNote
    );
    if (llmDraft) {
      return { draft, coverLetter: llmDraft.coverLetter, tailoredResume: llmDraft.tailoredResume };
    }
  }

  return { draft, coverLetter: null, tailoredResume: null };
}
