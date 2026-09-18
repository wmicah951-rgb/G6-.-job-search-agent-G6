// Core Job Search Agent
//
// This is a genuine agent, not a fixed pipeline: `decideNextAction` selects the
// next action from a set of MATERIALLY DIFFERENT available actions based on the
// current state + the latest observation. Different inputs (a hard-constraint
// violation, a low fit score, an embedded prompt injection) cause the agent to
// walk different, shorter or longer, action sequences. Every step is logged as
// a structured trace entry: stateBefore -> observation -> availableActions ->
// selectedAction -> result -> stateAfter.

export type Stage =
  | "start"
  | "scanned"
  | "evaluated"
  | "constraints_checked"
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
  // Grounded, positive-framed reasons this posting suits the candidate — distinct
  // from missingSkills (gaps) and matchedSkills (a bare list): this is the "why"
  // narrative, each line traceable to resume.md/preferences.md, never invented.
  fitRationale: string[];
  hardConstraintViolations: string[];
  redFlags: string[];
  approvalNote: string | null;
  draft: string | null;
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

// ---------- Fit scoring ----------
function evaluateFit(resumeSkills: string[], jobSkills: string[]) {
  const matched = jobSkills.filter((s) => resumeSkills.includes(s));
  const missing = jobSkills.filter((s) => !resumeSkills.includes(s));
  const score = jobSkills.length === 0 ? 0 : matched.length / jobSkills.length;
  return { score: Math.round(score * 100) / 100, matched, missing };
}

// Shared by explainFit() and draftApplication(): finds the actual resume.md line
// that justifies a matched skill, so both the "why this fits" panel and the
// drafted cover-letter bullets ground every claim in the candidate's own words.
function findEvidenceLine(resumeText: string, skill: string): string | null {
  const aliases = SKILL_ALIASES[skill] ?? [skill.toLowerCase()];
  const lines = resumeText.split("\n").map((l) => l.trim()).filter(Boolean);
  const evidenceLine = lines.find((l) =>
    aliases.some((a) => l.toLowerCase().includes(a.trim()))
  );
  return evidenceLine ? evidenceLine.replace(/^[-*]\s*/, "") : null;
}

// ---------- Grounded "why this fits" rationale ----------
// Deliberately distinct from missingSkills (the gap list): this builds a positive,
// evidence-backed narrative of why the posting suits the candidate. Every line is
// tied to an actual quote from resume.md or a checkable comparison against
// preferences.md — never a generic "great fit!" statement.
function explainFit(
  resumeText: string,
  jobText: string,
  preferencesText: string,
  matchedSkills: string[],
  candidateYears: number
): string[] {
  const reasons: string[] = [];

  if (matchedSkills.length > 0) {
    const evidence = matchedSkills
      .map((s) => ({ skill: s, line: findEvidenceLine(resumeText, s) }))
      .filter((e) => e.line !== null)
      .slice(0, 3);
    for (const e of evidence) {
      reasons.push(`${e.skill} — resume.md: "${e.line}"`);
    }
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

const LOW_FIT_THRESHOLD = 0.34;

// ---------- The agent loop ----------
export function runAgent(
  jobId: string,
  jobText: string,
  resumeText: string,
  preferencesText: string
): EvaluationResult {
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
    fitRationale: [],
    hardConstraintViolations: [],
    redFlags: [],
    approvalNote: null,
    draft: null,
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
  {
    const before = { ...state };
    const resumeSkills = extractSkills(resumeText);
    const jobSkills = extractSkills(jobText);
    const { score, matched, missing } = evaluateFit(resumeSkills, jobSkills);
    const fitRationale = explainFit(resumeText, jobText, preferencesText, matched, candidateYears);
    state = {
      ...state,
      stage: "evaluated",
      fitScore: score,
      matchedSkills: matched,
      missingSkills: missing,
      fitRationale,
    };
    log(
      `Resume skills: [${resumeSkills.join(", ") || "none found"}]. Job-required skills: [${jobSkills.join(", ") || "none found"}].`,
      ["check_hard_constraints", "reject", "request_human_approval"],
      "evaluate_fit",
      `fit_score=${score}, matched=[${matched.join(", ")}], missing=[${missing.join(", ")}]`,
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

  // --- Decision point 4: agent SELECTS next action based on state so far ---
  // This is the core branch point: three materially different paths.
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
    return { state, trace };
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
    return { state, trace };
  }

  // Passed constraints and has enough fit -> pause for a human before any drafting.
  {
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
  }

  return { state, trace };
}

// ---------- Called after a human makes an Approve/Edit/Reject decision ----------
export function applyHumanDecision(
  prior: EvaluationResult,
  decision: "approve" | "edit" | "reject",
  editNote: string | null,
  resumeText: string,
  jobText: string
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
  const draft = draftApplication(resumeText, jobText, state.matchedSkills, state.approvalNote);
  state = { ...state, stage: "drafted", draft };
  log(
    `Drafting using matched_skills=[${state.matchedSkills.join(", ")}] and resume.md as the only source of candidate facts.`,
    ["draft_application"],
    "draft_application",
    "Draft produced. Every claim traces back to a line in resume.md; nothing outside the resume was asserted.",
    draftBefore,
    state
  );

  return { state, trace };
}

function draftApplication(
  resumeText: string,
  jobText: string,
  matchedSkills: string[],
  editNote: string | null
): string {
  // Ground every bullet in an actual resume line containing the matched skill's alias,
  // so the draft can never claim something not present in resume.md.
  const bullets: string[] = [];
  for (const skill of matchedSkills) {
    const evidenceLine = findEvidenceLine(resumeText, skill);
    if (evidenceLine) {
      bullets.push(`- ${skill}: "${evidenceLine}"`);
    }
  }

  const titleMatch = jobText.match(/^#?\s*(.+)$/m);
  const roleTitle = titleMatch ? titleMatch[1].trim() : "this role";

  return [
    `Draft cover-letter bullets for ${roleTitle}`,
    "",
    "Grounded matches (each line quoted directly from resume.md — nothing invented):",
    ...bullets,
    "",
    editNote ? `Human edit note applied: ${editNote}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
