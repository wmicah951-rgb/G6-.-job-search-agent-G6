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

import {
  evaluateFitWithLlm,
  isLlmConfigured,
  draftApplicationMaterials,
  assessPostingWithLlm,
} from "./llmEvaluator";
import { verifyDraft, type DraftVerification } from "./draftVerifier";
import { DEFAULT_SETTINGS, type HarnessSettings } from "./harnessSettings";

export type WorkArrangement = "remote" | "hybrid" | "onsite" | "unknown";

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
  // Where the injection verdict came from: "regex", "llm", or both.
  injectionSources: string[];
  // Work arrangement the agent worked out for the posting (LLM inference when
  // available, regex cues otherwise). "unknown" only when nothing hints at it.
  workArrangement: WorkArrangement;
  // Minimum fit (0-1) below which the job is auto-rejected. Read from the
  // candidate's preferences.md ("Minimum fit: 60%"), default 0.6.
  minFit?: number;
  fitScore: number | null;
  matchedSkills: string[];
  missingSkills: string[];
  // Subset of missingSkills the posting only asked for as a nice-to-have, so
  // the UI can label "a plus" gaps differently from hard requirements.
  missingPreferredSkills?: string[];
  // Per matched requirement: "full" = real hands-on experience, "partial" =
  // internship / coursework / "basics" level (scored at half credit rather
  // than being thrown away as a miss).
  matchStrength?: Record<string, "full" | "partial">;
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
  // Only populated when the LLM drafted the materials (see draftApplication()
  // below): one entry per missingSkills item, reporting exactly how (or
  // whether) that gap was handled in the cover letter/resume, so the UI can
  // tell the human what the AI actually did instead of leaving them to guess.
  gapNotes: { skill: string; status: string; note: string }[];
  // Deterministic "trust but verify" pass over the generated material (see
  // src/lib/draftVerifier.ts). Populated only when an LLM actually drafted
  // something. Every claim is classified against resume.md and the human's
  // edit note; anything containing an unsourced hard fact is flagged for the
  // human rather than silently removed.
  draftVerification: DraftVerification | null;
  coverLetterVerification: DraftVerification | null;
  // The agent marking its own work: the same fit evaluation re-run against the
  // TAILORED resume, so the human can see whether the rewrite actually improved
  // coverage or only the wording. `unearned` lists any newly-matched requirement
  // that rests on a sentence the verifier could not trace back to the resume —
  // a score gain that should not be trusted.
  rescore: {
    before: number;
    after: number;
    newlyMatched: string[];
    unearned: string[];
    stillMissing: string[];
    method: "llm" | "deterministic";
  } | null;
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
  const stated = resumeText.match(
    /(\d+(?:\.\d+)?)\+?\s*years?\s+(?:of\s+)?(?:professional\s+|work\s+)?experience/i
  );
  if (stated) return parseFloat(stated[1]);
  return yearsFromDateRanges(resumeText);
}

// Real resumes list jobs as "Jan 2021 - Mar 2023" / "2019 - Present". Count
// the months covered by the UNION of those ranges (overlapping jobs are not
// double-counted), so a normal resume is not read as "0 years".
function yearsFromDateRanges(text: string): number {
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const now = new Date();
  const nowIdx = now.getFullYear() * 12 + now.getMonth();
  const mon = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?,?\\s+";
  const re = new RegExp(
    `(?:${mon})?((?:19|20)\\d{2})\\s*(?:-|–|—|to)\\s*(?:(?:${mon})?((?:19|20)\\d{2})|(present|current|now))`,
    "gi"
  );
  const ranges: [number, number][] = [];
  for (const m of text.matchAll(re)) {
    const start = parseInt(m[2], 10) * 12 + (m[1] ? MONTHS.indexOf(m[1].toLowerCase()) : 0);
    const end = m[5]
      ? nowIdx
      : parseInt(m[4], 10) * 12 + (m[3] ? MONTHS.indexOf(m[3].toLowerCase()) : 11);
    if (end >= start && end - start <= 12 * 50) ranges.push([start, end]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  let months = 0;
  let curEnd = -Infinity;
  for (const [a, b] of ranges) {
    if (a > curEnd) months += b - a;
    else if (b > curEnd) months += b - curEnd;
    curEnd = Math.max(curEnd, b);
  }
  return Math.round((months / 12) * 10) / 10;
}

// ---------- Prompt-injection heuristics (the regex FLOOR) ----------
// The LLM assessment (see assessPosting below) is the primary detector; these
// patterns are the floor that still catches the obvious attacks when no LLM is
// configured or the call fails. Aimed at text that addresses an AI/screener,
// not ordinary job-ad language.
const INJECTION_PATTERNS: RegExp[] = [
  /(?:ignore|disregard|forget|override)\s+(?:all|any|the|your|every)?\s*(?:previous|prior|above|earlier|preceding|system)?\s*(?:instructions?|rules?|prompts?|guidelines?|directions?|context)/i,
  /(?:new|updated|revised)\s+(?:instructions|rules|system prompt)/i,
  /you\s+(?:are|must|will)\s+(?:now|henceforth)\s+(?:an?|the|act|behave|ignore|only|always)\b[^.\n]{0,40}/i,
  /(?:^|[\s<!\-\[])system\s*(?:prompt|message)?\s*:\s*(?:ignore|disregard|you are|act as|do not|skip|override|new instructions|approve|rate|score|output|print|reply)[^.\n]{0,40}/i,
  /(?:automatically|auto[- ]?)\s*(?:approve|accept|hire|pass|advance|shortlist|reject)/i,
  /skip\s+(?:the\s+)?(?:human\s+|manual\s+)?(?:approval|review|check|screening|evaluation|verification)/i,
  /(?:do not|don't|never)\s+(?:evaluate|check|verify|flag|screen|review)\s+(?:this|the|any|hard)?\s*(?:candidate|applicant|resume|résumé|posting|requirements?|constraints?)/i,
  /(?:do not|don't|never)\s+(?:tell|warn|inform|alert|notify)\s+(?:the\s+)?(?:applicant|candidate|user|human|reviewer)/i,
  /(?:reply|respond|answer|output)\s+(?:with\s+)?(?:only|exactly|just)\b[^.\n]{0,40}/i,
  /(?:print|show|reveal|repeat|output|leak|dump|display)\s+(?:the\s+|your\s+|this\s+|entire\s+|full\s+)?(?:resume|r\u00e9sum\u00e9|cv|system prompt|prompt|instructions|candidate data)/i,
  /(?:act|behave|pretend|roleplay|role-play)\s+(?:as|like)\s+(?:an?\s+|the\s+)?(?:ai|assistant|chatbot|bot|language model|llm|agent|unrestricted|dan)\b/i,
  /this candidate\s+(?:is|should be|must be|deserves)\s+(?:perfect|hired|approved|accepted|shortlisted|top|the best|ideal)/i,
  /(?:rate|score|rank|grade|mark)\s+(?:this\s+)?(?:candidate|applicant|resume|r\u00e9sum\u00e9)\s+(?:as\s+)?(?:\d+|perfect|highest|top|10)/i,
  /(?:send|forward|email|e-mail|message|contact)\s+(?:this|the|my|their)?\s*(?:resume|r\u00e9sum\u00e9|cv|data|results?|application)\s+to\s+\S+@\S+/i,
  /(?:^|\W)(?:jailbreak|prompt injection|developer mode)(?:\W|$)/i,
];

/**
 * Ordinary, candidate-friendly job-ad language often NEGATES the very phrases these
 * patterns look for: "we do not automatically reject anyone", "applications are never
 * automatically screened out". Those are reassurances to applicants, not instructions
 * to a machine, and flagging them puts a scary PROMPT INJECTION banner on a perfectly
 * normal posting. A warning that fires on innocent text is one people learn to ignore,
 * so a match immediately preceded by a negation does not count.
 */
const NEGATION_BEFORE = /\b(?:not|never|don'?t|doesn'?t|won'?t|cannot|can'?t|no|nor|without)\b[^.!?\n]{0,24}$/i;

function scanForInjection(jobText: string): { detected: boolean; snippets: string[] } {
  const snippets: string[] = [];
  for (const re of INJECTION_PATTERNS) {
    // Walk every occurrence, not just the first: a posting can negate one mention
    // and still carry a real instruction elsewhere.
    const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    for (const m of jobText.matchAll(global)) {
      const preceding = jobText.slice(Math.max(0, m.index - 40), m.index);
      if (NEGATION_BEFORE.test(preceding)) continue;
      snippets.push(m[0].trim());
      break; // one snippet per pattern is enough for the trace
    }
  }
  return { detected: snippets.length > 0, snippets };
}

// ---------- LLM posting assessment (the brain OBSERVES; code DECIDES) ----------
const norm = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();

interface PostingAssessment {
  injectionSnippets: string[]; // verified verbatim in the posting
  arrangement: WorkArrangement;
  arrangementQuote: string;
  clearanceRequired: boolean;
}

// Any snippet/quote the model returns is kept ONLY if it literally appears in
// the posting (same trust-but-verify rule as the resume quotes).
async function assessPosting(
  jobText: string,
  settings: HarnessSettings = DEFAULT_SETTINGS
): Promise<PostingAssessment | null> {
  // The harness can turn the AI reader off entirely; the regex floor then carries the
  // injection gate on its own, exactly as it does when no model is configured.
  if (!settings.llmAssessmentEnabled) return null;
  if (!isLlmConfigured()) return null;
  try {
    const a = await assessPostingWithLlm(jobText, {
      systemPrompt: settings.prompts.assess,
      timeoutMs: settings.llmTimeoutMs,
      maxInputChars: settings.llmMaxInputChars,
    });
    const hay = norm(jobText);
    const snippets = (a.injection?.snippets ?? []).filter((sn) => sn && hay.includes(norm(sn)));
    const quote = a.workArrangement?.evidenceQuote ?? "";
    let arrangement: WorkArrangement = a.workArrangement?.value ?? "unknown";
    if (arrangement !== "unknown" && quote && !hay.includes(norm(quote))) arrangement = "unknown";
    return {
      injectionSnippets: a.injection?.detected ? snippets : [],
      arrangement,
      arrangementQuote: arrangement === "unknown" ? "" : quote,
      clearanceRequired: !!a.clearanceRequired && /clearance/i.test(jobText),
    };
  } catch {
    return null;
  }
}

// ---------- Work arrangement (regex cues; the LLM's reading takes priority) ----------
function regexArrangement(jobText: string): WorkArrangement {
  if (
    /no\s+(?:remote|hybrid)|not\s+(?:a\s+)?(?:remote|hybrid)|on-?site only|in-?office only|100%\s*(?:on-?site|in[- ]office)|must relocate|no work[- ]from[- ]home/i.test(
      jobText
    )
  )
    return "onsite";
  if (
    /hybrid|\b(?:[1-4]|one|two|three|four)\s*days?\s*(?:a|per|\/|each)\s*week\b[^.\n]{0,40}(?:office|on-?site|in[- ]person)|(?:office|on-?site|in[- ]person)[^.\n]{0,40}\b(?:[1-4]|one|two|three|four)\s*days?\s*(?:a|per|\/|each)\s*week/i.test(
      jobText
    )
  )
    return "hybrid";
  if (/remote|work from home|work-from-home|\bwfh\b|distributed team|telecommut/i.test(jobText)) return "remote";
  if (/on-?site|in[- ]office|in[- ]person|in our [A-Z][a-z]+ office/i.test(jobText)) return "onsite";
  return "unknown";
}

// The candidate's location rule, parsed tolerantly from preferences (not only
// the exact phrase "remote or hybrid only").
function parseLocationRule(preferencesText: string): "remote_or_hybrid" | "remote_only" | null {
  const p = preferencesText.toLowerCase();
  if (/remote[- ]only|fully remote only|only remote/.test(p) && !/hybrid/.test(p)) return "remote_only";
  if (
    /remote\s*(?:or|\/|,|and)\s*hybrid|hybrid\s*(?:or|\/|,|and)\s*remote|no\s+(?:roles?\s+(?:that\s+are\s+)?)?(?:100%\s*)?on-?site|not\s+(?:be\s+)?on-?site|no in-?office/.test(
      p
    )
  )
    return "remote_or_hybrid";
  return null;
}

// ---------- Hard constraints ----------
function checkHardConstraints(
  jobText: string,
  candidateYears: number,
  preferencesText: string,
  arrangement: WorkArrangement,
  clearanceRequired: boolean
): string[] {
  const violations: string[] = [];
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

  // Clearance rule: matched tolerantly so a reworded preferences line still counts.
  if (
    /will not apply[^.\n]*security clearance/i.test(preferencesText) &&
    (/security clearance/i.test(jobText) || clearanceRequired)
  ) {
    violations.push("Role requires an active security clearance");
  }

  // Relocation: the other deal-breaker candidates hit constantly. Only fires on an
  // explicit requirement ("must relocate", "relocation required"), never on a company
  // merely OFFERING relocation assistance, which is a perk rather than a condition.
  if (
    /will not apply[^.\n]*relocat/i.test(preferencesText) &&
    /(?:must|required to|willing to|expected to)\s+relocate|relocation\s+(?:is\s+)?required/i.test(
      jobText
    ) &&
    !/relocation\s+(?:assistance|package|support|help|reimburse)/i.test(jobText)
  ) {
    violations.push("Role requires relocation");
  }

  const rule = parseLocationRule(preferencesText);
  if (rule && (arrangement === "onsite" || (rule === "remote_only" && arrangement === "hybrid"))) {
    violations.push(
      arrangement === "onsite"
        ? "Role is on-site only with no remote/hybrid option"
        : "Role is hybrid, but your preferences require fully remote"
    );
  }

  return violations;
}

// ---------- ASK_USER: hard constraints the agent can't confidently evaluate ----------
// Asks ONLY when the candidate has a location rule AND neither the LLM nor the
// regex cues can work out the posting's arrangement at all. Anything that can
// be inferred is decided by the gate, not by bothering the user.
function detectLocationAmbiguity(arrangement: WorkArrangement, preferencesText: string): string | null {
  if (!parseLocationRule(preferencesText)) return null;
  if (arrangement !== "unknown") return null;
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
  // The subset of `missing` that the posting only listed as nice-to-have, kept
  // separate so the UI can label a "a plus" gap differently from a hard one.
  missingPreferred?: string[];
  matchedEvidence: Record<string, string>;
  // Per matched requirement: "full" real experience vs "partial" (internship /
  // coursework / "basics" level, scored at half credit).
  matchStrength?: Record<string, "full" | "partial">;
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
  jobText: string,
  settings: HarnessSettings = DEFAULT_SETTINGS
): Promise<FitEvaluation> {
  if (isLlmConfigured()) {
    try {
      const llmResult = await evaluateFitWithLlm(resumeText, jobText, {
        systemPrompt: settings.prompts.fit,
        timeoutMs: settings.llmTimeoutMs,
        maxInputChars: settings.llmMaxInputChars,
      });
      const lowerResume = resumeText.toLowerCase();
      const matchedEvidence: Record<string, string> = {};
      const matched: string[] = [];
      const matchStrength: Record<string, "full" | "partial"> = {};
      let droppedCount = 0;
      let matchedWeight = 0;
      let partialCount = 0;

      for (const m of llmResult.matchedRequirements) {
        if (m.evidenceQuote && lowerResume.includes(m.evidenceQuote.toLowerCase())) {
          const strength = m.strength === "partial" ? "partial" : "full";
          matched.push(m.requirement);
          matchedEvidence[m.requirement] = m.evidenceQuote;
          matchStrength[m.requirement] = strength;
          // Weight table: required+full 1.0, required+partial 0.5,
          // preferred+full 0.5, preferred+partial 0.25. Partial experience
          // (internship, coursework, "basics") earns half credit instead of
          // being scored as a flat miss.
          matchedWeight +=
            (m.priority === "preferred" ? 0.5 : 1) * (strength === "partial" ? 0.5 : 1);
          if (strength === "partial") partialCount += 1;
        } else {
          droppedCount += 1;
        }
      }

      // A dropped (unverifiable) match counts as a miss, not as free credit.
      const missingRequired = llmResult.missingRequirements;
      const missingPreferred = llmResult.missingPreferredRequirements ?? [];
      const missing = [...missingRequired, ...missingPreferred];
      const total =
        matchedWeight + droppedCount + missingRequired.length + 0.5 * missingPreferred.length;
      const score = total === 0 ? 0 : Math.round((matchedWeight / total) * 100) / 100;

      const notes: string[] = ["LLM semantic matching."];
      if (partialCount > 0) {
        notes.push(
          `${partialCount} requirement(s) matched at PARTIAL strength (internship/coursework/basics level) and scored at half credit.`
        );
      }
      if (droppedCount > 0) {
        notes.push(
          `${droppedCount} proposed match(es) dropped for lacking a verbatim resume.md quote.`
        );
      }

      return {
        score,
        matched,
        missing,
        missingPreferred,
        matchedEvidence,
        matchStrength,
        method: "llm",
        reasoning: llmResult.reasoning,
        note: notes.join(" "),
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
// swings the ratio further. 0.6 ("well under half the named requirements
// met") reproduces the correct reject/pass split for the required test set
// under BOTH the deterministic and LLM matchers.
const LOW_FIT_THRESHOLD = 0.6;

// Editable from preferences.md, e.g. a line "Minimum fit: 50%". Anything
// outside 10-90% is ignored so a typo can't disable the gate.
export function parseMinFit(prefsText: string, fallback: number = LOW_FIT_THRESHOLD): number {
  const m = prefsText.match(/minimum\s+fit[^0-9\n]*(\d{1,3})\s*%/i);
  const pct = m ? parseInt(m[1], 10) : NaN;
  return pct >= 10 && pct <= 90 ? pct / 100 : fallback;
}

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

  const minFit = state.minFit ?? LOW_FIT_THRESHOLD;
  if ((state.fitScore ?? 0) < minFit) {
    const before = { ...state };
    state = { ...state, stage: "rejected_low_fit" };
    log(
      `Fit score ${state.fitScore} is below the low-fit threshold (${minFit}).`,
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
    `Constraints passed. fit_score=${state.fitScore} >= threshold ${minFit}.`,
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
  preferencesText: string,
  // Optional per-profile harness overrides (see harnessSettings.ts). Omitted =
  // shipped defaults, which is what every existing caller and test script relies on.
  settings: HarnessSettings = DEFAULT_SETTINGS
): Promise<EvaluationResult> {
  const trace: TraceStep[] = [];
  let step = 0;

  let state: AgentState = {
    jobId,
    stage: "start",
    injectionDetected: false,
    injectionSnippets: [],
    injectionSources: [],
    workArrangement: "unknown",
    draftVerification: null,
    coverLetterVerification: null,
    rescore: null,
    minFit: parseMinFit(preferencesText, settings.lowFitThresholdDefault),
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
    gapNotes: [],
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

  // The brain reads the posting ONCE (injection cues, work arrangement,
  // clearance). It only observes — the gates below decide.
  const assessment = await assessPosting(jobText, settings);

  // --- Decision point 1: scan for injection (treat job text as DATA, never instructions) ---
  {
    const before = { ...state };
    const regexHit = scanForInjection(jobText);
    const llmSnippets = assessment?.injectionSnippets ?? [];
    const seen = new Set<string>();
    const snippets = [...regexHit.snippets, ...llmSnippets].filter((sn) => {
      const k = norm(sn);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const sources = [regexHit.detected ? "regex" : "", llmSnippets.length ? "llm" : ""].filter(Boolean);
    const detected = snippets.length > 0;
    state = {
      ...state,
      stage: "scanned",
      injectionDetected: detected,
      injectionSnippets: snippets,
      injectionSources: sources,
    };
    log(
      `Raw job posting text received (${jobText.length} chars). Treated as untrusted data only.` +
        (assessment ? " Read by the AI model and the regex floor." : " Read by the regex floor (no AI model available)."),
      ["scan_for_injection", "evaluate_fit", "check_hard_constraints", "reject_hard_constraint", "reject_low_fit", "request_human_approval", "draft_application"],
      "scan_for_injection",
      detected
        ? `Embedded instruction-like text detected (${sources.join(" + ")}) — logging and continuing normal evaluation, NOT obeying it.`
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
    const fit = await performFitEvaluation(resumeText, jobText, settings);
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
      missingPreferredSkills: fit.missingPreferred ?? [],
      matchedEvidence: fit.matchedEvidence,
      matchStrength: fit.matchStrength ?? {},
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
    // The AI model's reading of the arrangement wins; regex cues are the fallback.
    const arrangement: WorkArrangement =
      assessment && assessment.arrangement !== "unknown"
        ? assessment.arrangement
        : regexArrangement(jobText);
    const violations = checkHardConstraints(
      jobText,
      candidateYears,
      preferencesText,
      arrangement,
      assessment?.clearanceRequired ?? false
    );
    state = {
      ...state,
      stage: "constraints_checked",
      hardConstraintViolations: violations,
      workArrangement: arrangement,
    };
    log(
      `Candidate years of experience: ~${candidateYears}. Preferences hard constraints checked against posting. Work arrangement read as "${arrangement}"` +
        (assessment?.arrangementQuote ? ` (evidence: "${assessment.arrangementQuote}").` : "."),
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
    const clarificationQuestion = settings.askUserEnabled
      ? detectLocationAmbiguity(state.workArrangement, preferencesText)
      : null;
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

// ---------- Human overrules the agent's own low-fit auto-rejection ----------
//
// The agent rejecting a below-threshold posting is CORRECT and stays exactly as it is —
// that auto-reject is one of the four required action sequences, and it still runs on
// every posting without asking anyone. This is a separate, explicitly human action taken
// AFTER the agent has finished and stated its verdict.
//
// It exists because a fit score is a screening heuristic, not a judgement about a
// person. A candidate with internship or coursework experience can be a reasonable
// applicant at 45% while the score still correctly says "most requirements unmet". The
// human is the one allowed to make that call, and the trace records that they did — the
// agent never silently lowers its own bar.
export function applyLowFitOverride(
  prior: EvaluationResult,
  reason: string | null
): EvaluationResult {
  const trace = [...prior.trace];
  let step = trace.length;
  let state = { ...prior.state };

  const before = { ...state };
  state = { ...state, stage: "awaiting_approval", approvalNote: reason };
  step += 1;
  trace.push({
    step,
    stateBefore: { ...before },
    observation:
      `Human reviewed the agent's low-fit rejection (fit_score=${before.fitScore}, ` +
      `threshold=${before.minFit ?? LOW_FIT_THRESHOLD}) and chose to pursue the role anyway.` +
      (reason ? ` Stated reason: "${reason}"` : " No reason given."),
    availableActions: ["human_override_low_fit", "keep_rejected"],
    selectedAction: "human_override_low_fit",
    result:
      "Agent's automatic low-fit rejection OVERRIDDEN BY HUMAN. The fit score is " +
      "unchanged and the gaps still stand — the job simply moves to the approval gate " +
      "so the human can decide what to draft. No draft exists yet.",
    stateAfter: { ...state },
  });

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
  resumeText: string | null,
  settings: HarnessSettings = DEFAULT_SETTINGS
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
  const { draft, coverLetter, tailoredResume, gapNotes } = await draftApplication(
    state.matchedEvidence, state.missingSkills, jobText, state.matchedSkills, state.approvalNote, resumeText, settings
  );
  state = { ...state, stage: "drafted", draft, coverLetter, tailoredResume, gapNotes };
  log(
    `Drafting using matched_skills=[${state.matchedSkills.join(", ")}] and resume.md as the only source of candidate facts.${coverLetter ? " LLM-powered cover letter and tailored resume generated." : " Deterministic bullet-point draft (no LLM configured)."}`,
    ["draft_application"],
    "draft_application",
    "Draft produced from resume.md and the human's note." +
      (coverLetter
        ? " Full cover letter and tailored resume included — both now go to verification."
        : " Deterministic bullets only: each is a literal resume.md quote, so it needs no further verification."),
    draftBefore,
    state
  );

  // --- Verification: the model wrote it, deterministic code checks it ---------
  // Only meaningful for LLM-generated prose. The deterministic bullet draft is
  // built from literal resume quotes, so there is nothing to catch there.
  if (settings.draftVerificationEnabled && resumeText && (tailoredResume || coverLetter)) {
    const verifyBefore = { ...state };
    // The posting's title, so an "applying for the X role" sentence is not flagged
    // for repeating words that are naturally absent from the resume.
    const titleLine = jobText.match(/^#?\s*(.+)$/m);
    const verifyOpts = {
      jobTitle: titleLine ? titleLine[1].trim() : "",
      highThreshold: settings.verifyHighThreshold,
      lowThreshold: settings.verifyLowThreshold,
    };
    const draftVerification = tailoredResume
      ? verifyDraft(tailoredResume, resumeText, state.approvalNote, {
          ...verifyOpts,
          kind: "resume",
        })
      : null;
    const coverLetterVerification = coverLetter
      ? verifyDraft(coverLetter, resumeText, state.approvalNote, {
          ...verifyOpts,
          kind: "letter",
          jobText,
        })
      : null;
    state = { ...state, draftVerification, coverLetterVerification };

    const flagged =
      (draftVerification?.totals.unsupported ?? 0) +
      (coverLetterVerification?.totals.unsupported ?? 0);
    const checked =
      (draftVerification?.totals.claims ?? 0) + (coverLetterVerification?.totals.claims ?? 0);
    const dropped = draftVerification?.droppedFromOriginal.length ?? 0;

    log(
      `Checking every factual claim in the generated material against resume.md${
        state.approvalNote ? " and the human's note" : ""
      }. Rewording is allowed; unsourced specifics are not.`,
      ["verify_draft"],
      "verify_draft",
      flagged === 0
        ? `${checked} claim(s) checked — all trace to the resume or the human's note. ${dropped} original line(s) not carried into the tailored resume.`
        : `${checked} claim(s) checked — ${flagged} contain a number or name found in NEITHER the resume nor the human's note. Flagged for the human; the draft was NOT silently altered.`,
      verifyBefore,
      state
    );
  }

  // --- The agent goes back and marks its own work -----------------------------
  //
  // Re-runs the SAME fit evaluation against the tailored resume it just produced, and
  // reports before -> after. This is the loop closing: draft, verify, then re-measure.
  //
  // The integrity rule is what makes the new number worth anything. A tailored resume
  // can always be made to "score higher" by inventing skills, so every requirement that
  // newly counts as matched is cross-checked against the verification pass. If its
  // supporting sentence was flagged as unsourced, the gain is reported as UNEARNED and
  // called out separately rather than folded into the headline score.
  if (tailoredResume && state.stage === "drafted") {
    const rescoreBefore = { ...state };
    const scoreBefore = state.fitScore ?? 0;
    const missingBefore = new Set(state.missingSkills.map((s) => s.toLowerCase()));

    try {
      const after = await performFitEvaluation(tailoredResume, jobText, settings);

      // Which previously-missing requirements now count as met?
      const newlyMatched = after.matched.filter((m) => missingBefore.has(m.toLowerCase()));

      // Any of those resting on a claim the verifier could not source?
      const unsupportedText = (state.draftVerification?.claims ?? [])
        .filter((c) => c.verdict === "unsupported")
        .map((c) => c.text.toLowerCase())
        .join(" \n ");
      const unearned = newlyMatched.filter((m) => {
        const quote = (after.matchedEvidence[m] ?? "").toLowerCase();
        return quote.length > 0 && unsupportedText.includes(quote.slice(0, 40));
      });

      state = {
        ...state,
        rescore: {
          before: scoreBefore,
          after: after.score,
          newlyMatched,
          unearned,
          stillMissing: after.missing,
          method: after.method,
        },
      };

      const delta = Math.round((after.score - scoreBefore) * 100);
      log(
        `Re-running the same fit evaluation against the TAILORED resume to measure whether the rewrite actually helped.`,
        ["rescore_tailored_resume"],
        "rescore_tailored_resume",
        `Fit ${Math.round(scoreBefore * 100)}% -> ${Math.round(after.score * 100)}% (${
          delta >= 0 ? "+" : ""
        }${delta} points).` +
          (newlyMatched.length
            ? ` Now evidenced: ${newlyMatched.join(", ")}.`
            : " No previously-missing requirement is now evidenced — the rewrite improved emphasis and wording, not coverage.") +
          (unearned.length
            ? ` WARNING: ${unearned.join(", ")} only count because of sentence(s) the verifier could NOT trace to the resume. Treat that gain as unearned.`
            : "") +
          (after.missing.length ? ` Still missing: ${after.missing.join(", ")}.` : ""),
        rescoreBefore,
        state
      );
    } catch (err) {
      // Never let the scoreboard break the draft the human already has.
      log(
        "Attempted to re-score the tailored resume.",
        ["rescore_tailored_resume"],
        "rescore_tailored_resume",
        `Re-score unavailable (${String(err).slice(0, 120)}). The draft and its verification are unaffected.`,
        rescoreBefore,
        state
      );
    }
  }

  return { state, trace };
}

async function draftApplication(
  matchedEvidence: Record<string, string>,
  missingSkills: string[],
  jobText: string,
  matchedSkills: string[],
  editNote: string | null,
  resumeText: string | null,
  settings: HarnessSettings = DEFAULT_SETTINGS
): Promise<{
  draft: string;
  coverLetter: string | null;
  tailoredResume: string | null;
  gapNotes: { skill: string; status: string; note: string }[];
}> {
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
      matchedEvidence, missingSkills, jobText, resumeText, editNote,
      { systemPrompt: settings.prompts.draft, maxInputChars: settings.llmMaxInputChars }
    );
    if (llmDraft) {
      return {
        draft,
        coverLetter: llmDraft.coverLetter,
        tailoredResume: llmDraft.tailoredResume,
        gapNotes: llmDraft.addressedGaps ?? [],
      };
    }
  }

  return { draft, coverLetter: null, tailoredResume: null, gapNotes: [] };
}
