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
// The LLM is used at THREE points, and only ever as a reader that reports
// observations:
//   1. assessPosting()   - reads the posting for injection attempts, work
//                          arrangement and clearance (agent.ts, decision point 1)
//   2. performFitEvaluation() - matches resume against the posting's requirements
//   3. draftApplication() - writes the cover letter and tailored resume, after a
//                          human has approved
//
// What the LLM can NEVER do: approve, reject, skip a step, or decide anything. Every
// branch - reject on a hard constraint, reject on low fit, pause for a human, ask a
// clarifying question - is plain deterministic code below, untouched by whatever the
// model returns. Every model claim is verified before it is trusted: resume quotes must
// be literal substrings of the resume (performFitEvaluation), injection snippets must be
// literal substrings of the posting (assessPosting), and generated application text is
// checked by src/lib/draftVerifier.ts, which flags anything it cannot trace.
//
// With no model configured at all the agent still runs end to end on a deterministic
// keyword matcher and a regex injection floor, and still produces the four required
// action sequences.

import {
  evaluateFitWithLlm,
  isLlmConfigured,
  draftApplicationMaterials,
  assessPostingWithLlm,
  chooseActionWithLlm,
  adviseHumanWithLlm,
  completeJsonWithLlm,
  rewriteBulletsWithLlm,
  isSmallModel,
} from "./llmEvaluator";
import { ADVISE_SYSTEM_PROMPT, postingVocabulary, type AdviceMode, type LlmFitResult } from "./llm/types";
import { loadGuidelines, DEFAULT_JUDGMENT_MARGIN, withRole, type Guidelines } from "./guidelines";
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
  // Set at the start of each run from agent-guidelines.md: the width of the judgment zone,
  // and which version of the file the controller read.
  judgmentMargin?: number;
  guidelines?: string;
  // The advisor's recommendation to the person (see the advisor section below).
  advice?: Advice | null;
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
  // Set when too few requirements could be read from the posting for the score to
  // be meaningful — surfaced in the UI so a truncated or failed scrape is obvious
  // rather than looking like a perfect match.
  lowConfidence?: boolean;
  requirementCount?: number;
  // Requirement bullets the posting states that the model's extraction did not account for
  // in EITHER matchedSkills or missingSkills. Found by a deterministic re-read of the
  // posting (findUnassessedRequirements), because requirement extraction is a sampled model
  // call and occasionally skips a line — usually an optional "bonus points" one. These are
  // shown to the human as "check these yourself" rather than folded into the score: the
  // candidate may well have the skill, so counting it as a gap would wrongly cut the score,
  // but staying silent would hide something they need to know about.
  unassessedRequirements?: string[];
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
    // False when the re-check did not reproduce the original requirement list, which
    // makes the before/after difference unsound. The UI then withholds the delta.
    comparable?: boolean;
    requirementsCompared?: number;
  } | null;
}

// Who picked the action at this step. "model" = the controller chose among two or more
// actions the harness permitted; "harness" = only one action was permitted, so a
// guardrail (not a choice) decided; "policy" = the built-in default policy chose because
// no model is configured, the model failed, or it proposed something not permitted.
export type ChosenBy = "model" | "harness" | "policy";
export interface StepMeta {
  chosenBy: ChosenBy;
  modelReasoning?: string;
  // Set when the model proposed something the harness refused.
  overruled?: string;
  // Which version of agent-guidelines.md the controller was reading when it chose.
  guidelines?: string;
  // "ai" = an AI produced this step's output; "code" = a deterministic rule did.
  brain?: "ai" | "code";
  // The agent's own explanation for the step, in words (the AI's reasoning, or what it read).
  thinking?: string;
}

export interface TraceStep {
  guidelines?: string;
  brain?: "ai" | "code";
  thinking?: string;
  chosenBy?: ChosenBy;
  modelReasoning?: string;
  overruled?: string;
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
  // Conditional address to the reader-as-machine: "if you are an AI reviewing this",
  // "should you be a language model processing applications". Added to the floor after
  // the model proved unreliable at catching this shape on its own - detection by a
  // sampled model is probabilistic, and a defence that works four times in five is not
  // a defence. The subtler phrasings (J009-J011) still need the AI reader.
  /\b(?:if|should|in case|when)\s+you(?:'re|\s+are|\s+happen\s+to\s+be|\s+be)\s+(?:an?\s+)?(?:ai|a\.i\.|artificial intelligence|language model|llm|chatbot|bot|assistant|automated|machine|screening system|screener|algorithm)\b/i,
  /\b(?:attention|note|message|instructions?)\s+(?:to|for)\s+(?:the\s+)?(?:ai|language model|llm|bot|automated|screening|applicant tracking|ats)\b/i,

  // ---- STEERING THE VERDICT (added after red-teaming: scripts/redteam-injection.ts) ----
  // These aim at the *evaluation* rather than obviously "hacking" the agent, and were
  // previously caught only by the AI reader — meaning they went unflagged with no model
  // configured. Each is anchored on screening language ABOUT the candidate ("this
  // candidate", "the applicant", "me") or on addressing the agent itself, so ordinary job
  // duties written in the second person ("You will own our dashboards") never match.
  // A verdict pushed DOWN is an attack too: sabotage is as much an injection as flattery.
  /(?:score|rate|rank|grade|mark|classify)\s+(?:this\s+|the\s+)?(?:candidate|applicant|resume|résumé|application)\s+as\s+[^.\n]{0,40}/i,
  /recommend\s+(?:rejection|rejecting|against\s+(?:this|the)\s+(?:candidate|applicant))/i,
  /(?:advise|tell|warn)\s+(?:the\s+)?(?:applicant|candidate)\s+not\s+to\s+apply/i,
  // Fake instructions posing as the candidate's own ("mark me as fully qualified").
  /(?:mark|list|report|record|treat|consider)\s+me\s+as\s+[^.\n]{0,40}/i,
  /skip\s+(?:the\s+)?(?:gap|skills?|requirements?|qualification)\s*\w*\s*(?:analysis|check|assessment|review|step)/i,
  // Fake prior authority the agent is told to simply record and move on from.
  /record\s+(?:a|an)\s+(?:favourable|favorable|positive|passing|top|perfect|strong)\s+\w+/i,
  /proceed\s+(?:directly\s+)?to\s+(?:drafting|the\s+draft|generating|producing)/i,
  // Sabotage: telling the agent to write the candidate's own materials badly.
  /(?:write|draft|generate|produce)\s+(?:them|it|the\s+(?:materials?|letter|application|resume|résumé))\s+(?:poorly|badly|weakly|negatively)/i,
  /understate\s+(?:the\s+)?(?:applicant|candidate|their)/i,
  // Handing the agent's own instructions over to the posting.
  /as\s+(?:your\s+)?(?:system\s+prompt|new\s+instructions|operating\s+instructions)/i,
  /follow\s+(?:them|these|this|it)\s+(?:over|instead\s+of|rather\s+than)\s+(?:your\s+)?(?:own\s+)?(?:rules|instructions|guidelines|system)/i,
  // Soft-language attempts to dissolve the human approval gate.
  /no\s+need\s+for\s+(?:a\s+)?(?:person|human|anyone|reviewer|someone)\s+to\s+(?:review|look|check|approve|see)/i,
  /finali[sz]e\s+(?:the\s+)?application\s+automatically/i,
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

/**
 * Requirement text normalised for duplicate detection: lowercased, punctuation and
 * filler stripped. "Experience with an ERP system such as NetSuite, SAP or Oracle" and
 * "experience with an ERP system (NetSuite, SAP, Oracle)" collapse to the same key.
 */
// Words too generic to prove a requirement was really present in the posting.
const REQ_STOPWORDS = new Set([
  "experience",
  "years",
  "year",
  "strong",
  "degree",
  "field",
  "related",
  "ability",
  "skills",
  "knowledge",
  "working",
  "understanding",
  "familiarity",
  "proficiency",
  "excellent",
  "relevant",
]);

function normRequirement(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9+#\s]/g, " ")
    // Word-boundary anchored on purpose: without a boundary this eats the "or"
    // inside "Oracle", collapsing unrelated requirements into one key.
    .replace(
      /\b(experience|with|an|a|the|of|in|or|and|including|for|to|is|plus|preferred|such)\b/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
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
  // True when too few requirements could be read out of the posting for the
  // percentage to mean anything (truncated text, boilerplate, a failed scrape).
  lowConfidence?: boolean;
  requirementCount?: number;
  /** Stated requirement bullets the extraction skipped entirely (see AgentState). */
  unassessedRequirements?: string[];
  method: "llm" | "deterministic";
  reasoning: string | null;
  note: string;
}

// SMALL-MODEL MATCHER. A weak model cannot be trusted to copy a résumé quote word for word (the
// normal matcher drops any match whose quote is not a literal résumé substring, so a weak
// model scores 0%). Instead the harness numbers the résumé lines and the model only points at
// line numbers. The "quote" is then the résumé's own line, exact by construction, and it still
// passes the same substring check as everything else.
async function smallModelFit(resumeText: string, jobText: string, settings: HarnessSettings): Promise<LlmFitResult> {
  const lines = resumeText
    .split("\n")
    .map((l) => l.trim().replace(/^[-*]\s*/, ""))
    .filter((l) => l.length >= 12 && !l.startsWith("#"))
    .slice(0, 60);
  const numbered = lines.map((l, i) => `${i + 1}. ${l}`).join("\n");
  const guide = loadGuidelines();
  const system = withRole(
    "You compare a candidate's résumé to a job posting. List only real screening requirements (skills, tools, degrees, certifications, years of experience). Do NOT list job duties, soft skills, the company blurb or benefits. Never claim the résumé shows something it does not.",
    guide.roles.matcher
  ).slice(0, 3000);
  const user =
    `JOB POSTING:\n${jobText.slice(0, settings.llmMaxInputChars)}\n\nRESUME LINES:\n${numbered}\n\n` +
    `For each requirement give: "requirement" (short), "priority" ("required", or "preferred" if it is a nice-to-have), ` +
    `"lines" (the résumé line NUMBERS that prove it, or [] if none), "strength" ("full", or "partial" if only internship/coursework/basics).\n` +
    `Reply as JSON: {"requirements":[{"requirement":"...","priority":"required","lines":[1],"strength":"full"}],"summary":"<one sentence on the overall fit>"}`;
  const raw = (await completeJsonWithLlm(system, user, 900, settings.llmTimeoutMs)) as {
    requirements?: { requirement?: string; priority?: string; lines?: unknown; strength?: string }[];
    summary?: string;
  };
  const matched: LlmFitResult["matchedRequirements"] = [];
  const missingRequirements: string[] = [];
  const missingPreferredRequirements: string[] = [];
  for (const r of Array.isArray(raw.requirements) ? raw.requirements : []) {
    const name = String(r.requirement ?? "").trim().slice(0, 120);
    if (!name) continue;
    const priority = r.priority === "preferred" ? "preferred" : "required";
    const pointed = (Array.isArray(r.lines) ? r.lines : []).map((n) => parseInt(String(n), 10)).find((n) => n >= 1 && n <= lines.length);
    // Verify-or-repair: a weak model often points at the wrong line. The line must share a
    // distinctive word with the requirement; if it does not, the harness looks for the résumé
    // line that does, and if there is none the requirement counts as missing.
    const words = (t: string) =>
      t.toLowerCase().split(/[^a-z0-9+#/]+/).filter((w) => w.length >= 3 && !REQ_STOPWORDS.has(w) && !["and", "the", "for", "with", "that", "from"].includes(w));
    const want = words(name);
    const overlap = (line: string) => {
      const have = new Set(words(line));
      return want.filter((w) => have.has(w)).length;
    };
    let idx: number | undefined;
    if (pointed && overlap(lines[pointed - 1]) > 0) idx = pointed;
    else if (want.length > 0) {
      let best = 0;
      lines.forEach((l, i) => {
        const o = overlap(l);
        if (o > best) {
          best = o;
          idx = i + 1;
        }
      });
    }
    if (idx) {
      matched.push({ requirement: name, evidenceQuote: lines[idx - 1], priority, strength: r.strength === "partial" ? "partial" : "full" });
    } else if (priority === "preferred") missingPreferredRequirements.push(name);
    else missingRequirements.push(name);
  }
  return {
    matchedRequirements: matched,
    missingRequirements,
    missingPreferredRequirements,
    reasoning: String(raw.summary ?? "").slice(0, 400) || "Small-model matcher: pointed at résumé lines for each requirement.",
  };
}

// ---------- Completeness backstop for requirement extraction ----------
//
// Requirement extraction is a sampled model call, so it occasionally skips a stated bullet
// (measured: 1-2 of ~10 on a long posting, varying run to run — scripts/gap-completeness.ts).
// A skipped requirement is the quietest possible failure: the score still looks reasonable
// while the gap list is silently short, so the candidate never learns what to add. These
// helpers re-read the posting deterministically and report anything the model left out.

/** Headings whose bullets are DUTIES, not screening requirements — the matcher ignores these. */
const DUTY_HEADING =
  /^#{0,3}\s*(what you'?l*l?\s*(be\s*)?(do|doing)|responsibilities|the role|role overview|about the role|day[- ]to[- ]day)/i;
/** Headings that introduce real requirement bullets, optional sections included. */
const REQ_HEADING =
  /^#{0,3}\s*(requirements?|qualifications|what you'?l*l?\s*need|you (?:will )?(?:need|bring)|must have|preferred|nice to have|bonus points|a plus)/i;
/** Soft skills the matcher is instructed to exclude, so they are not "missing" either. */
const SOFT_REQUIREMENT =
  /\b(communication|communicat|interpersonal|collaborat|team player|attention to detail|self[- ]starter|organi[sz]ed|problem[- ]solving|presenting|presentation skills|work ethic|curiosity|proactive)\b/i;

// Glue words that make unrelated requirements look alike ("Python OR R FOR analysis AND
// automation" vs "Data analysis AND BI reporting"); ignored when judging coverage.
const COMPLETENESS_FILLER = new Set([
  "and", "for", "the", "with", "from", "into", "our", "you", "your", "such", "similar", "related",
  "data", "analysis", "reporting", "tool", "tools", "using", "use", "plus", "team", "role", "work",
]);

function statedRequirementBullets(jobText: string): string[] {
  const out: string[] = [];
  let inReq = false;
  for (const raw of jobText.split("\n")) {
    const l = raw.trim();
    if (DUTY_HEADING.test(l)) {
      inReq = false;
      continue;
    }
    if (REQ_HEADING.test(l)) {
      inReq = true;
      continue;
    }
    if (inReq && l && !l.startsWith("-") && !l.startsWith("*") && /^[A-Z#]/.test(l) && l.length < 60) inReq = false;
    if (inReq && (l.startsWith("- ") || l.startsWith("* "))) {
      const t = l.replace(/^[-*]\s*/, "").trim();
      if (t.length >= 4 && !SOFT_REQUIREMENT.test(t)) out.push(t);
    }
  }
  return out;
}

/** Stated bullets not represented in anything the model reported. */
function findUnassessedRequirements(jobText: string, reported: string[]): string[] {
  const toks = (t: string) =>
    new Set(
      t
        .toLowerCase()
        .split(/[^a-z0-9+#/]+/)
        .filter((w) => w.length >= 3 && !REQ_STOPWORDS.has(w) && !COMPLETENESS_FILLER.has(w))
    );
  const reportedSets = reported.map(toks);
  return statedRequirementBullets(jobText).filter((bullet) => {
    const want = [...toks(bullet)];
    if (!want.length) return false;
    const need = Math.max(1, Math.ceil(want.length * 0.34));
    return !reportedSets.some((got) => want.filter((w) => got.has(w)).length >= need);
  });
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
      const llmResult = isSmallModel()
        ? await smallModelFit(resumeText, jobText, settings)
        : await evaluateFitWithLlm(resumeText, jobText, {
            systemPrompt: settings.prompts.fit,
            timeoutMs: settings.llmTimeoutMs,
            maxInputChars: settings.llmMaxInputChars,
          });
      const lowerResume = resumeText.toLowerCase();
      const matchedEvidence: Record<string, string> = {};
      const matched: string[] = [];
      const matchStrength: Record<string, "full" | "partial"> = {};
      let droppedCount = 0;
      // Denominator contribution of a dropped (proposed-but-unverifiable) match, weighted the
      // SAME way a genuinely missing requirement is (required=1, preferred=0.5). Before this,
      // every dropped match added a flat 1 regardless of priority, so a proposed-but-unverified
      // PREFERRED match deflated the score more than if the model had just honestly called it
      // missing (missing preferred only costs 0.5) — a model that tried and failed verification
      // was penalized harder than one that gave up outright. Verified by scripts/verify-tests.ts.
      let droppedWeight = 0;
      let matchedWeight = 0;
      let partialCount = 0;

      const seenMatched = new Set<string>();
      for (const m of llmResult.matchedRequirements) {
        // Same requirement proposed twice: count it once.
        if (seenMatched.has(normRequirement(m.requirement))) continue;
        seenMatched.add(normRequirement(m.requirement));
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
          droppedWeight += m.priority === "preferred" ? 0.5 : 1;
        }
      }

      // DEDUPLICATE before scoring. Models routinely return the same requirement in
      // both missing lists, or list one twice with slightly different wording, and
      // every duplicate inflates the denominator and silently DRAGS THE SCORE DOWN.
      // Precedence: something already matched is never also "missing"; a required
      // miss outranks a nice-to-have miss.
      const seen = new Set(matched.map(normRequirement));
      const missingRequired: string[] = [];
      for (const m of llmResult.missingRequirements) {
        const k = normRequirement(m);
        if (seen.has(k)) continue;
        seen.add(k);
        missingRequired.push(m);
      }
      const missingPreferred: string[] = [];
      for (const m of llmResult.missingPreferredRequirements ?? []) {
        const k = normRequirement(m);
        if (seen.has(k)) continue;
        seen.add(k);
        missingPreferred.push(m);
      }
      const missing = [...missingRequired, ...missingPreferred];
      const total =
        matchedWeight + droppedWeight + missingRequired.length + 0.5 * missingPreferred.length;
      const score = total === 0 ? 0 : Math.round((matchedWeight / total) * 100) / 100;

      // CONFIDENCE GUARD. If barely any requirements could be read out of the posting,
      // the percentage is arithmetically fine and practically meaningless: one matched
      // requirement out of one reads as "100% match". That happens on a scrape that
      // captured only the header, or a posting whose requirements sit past the input
      // cap. Reporting a confident perfect score there is worse than reporting nothing.
      const requirementCount = matched.length + missing.length;

      // GROUND THE REQUIREMENTS THEMSELVES against the posting — the same trust-but-
      // verify rule used for résumé quotes, pointed the other way. Given only a title
      // ("# Data Analyst") a model will happily invent seven plausible requirements and
      // score the candidate 100% against its own invention. A real requirement shares at
      // least one distinctive word with the text the model was actually shown.
      const seenText = norm(jobText.slice(0, settings.llmMaxInputChars));
      const ungrounded = [...matched, ...missing].filter((req) => {
        const tokens = norm(req)
          .split(" ")
          .filter((t) => t.length >= 4 && !REQ_STOPWORDS.has(t));
        if (tokens.length === 0) return false; // nothing distinctive to check
        return !tokens.some((t) => seenText.includes(t));
      });
      const lowConfidence =
        requirementCount < 3 || ungrounded.length > Math.max(1, requirementCount * 0.4);

      // Deterministic backstop: did the extraction skip any stated requirement bullet?
      const unassessedRequirements = findUnassessedRequirements(jobText, [...matched, ...missing]);

      const notes: string[] = ["LLM semantic matching."];
      if (lowConfidence) {
        notes.push(
          requirementCount < 3
            ? `LOW CONFIDENCE: only ${requirementCount} requirement(s) could be read from this posting, so the percentage is not meaningful. The posting may be truncated, mostly boilerplate, or a failed scrape.`
            : `LOW CONFIDENCE: ${ungrounded.length} of ${requirementCount} requirement(s) do not appear in the posting text the agent was given (e.g. ${ungrounded.slice(0, 3).join("; ")}), which means they were inferred from the job title rather than read. The posting is probably truncated or incomplete.`
        );
      }
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
      if (unassessedRequirements.length > 0) {
        notes.push(
          `${unassessedRequirements.length} stated requirement(s) were NOT assessed by the matcher and are surfaced separately for the human: ${unassessedRequirements.join("; ")}.`
        );
      }

      return {
        score,
        matched,
        missing,
        missingPreferred,
        matchedEvidence,
        matchStrength,
        lowConfidence,
        requirementCount,
        unassessedRequirements,
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
  after: AgentState,
  meta?: StepMeta
) => void;

// Red flags: the things a reader should notice before trusting this evaluation. Derived
// ONLY from state the agent already observed (never from model prose), so it cannot be
// steered by the posting: injection attempts, broken hard constraints, an unreadable
// work arrangement, and a score the agent itself does not stand behind.
function computeRedFlags(state: AgentState): string[] {
  const flags: string[] = [];
  for (const sn of state.injectionSnippets) {
    flags.push(`Prompt injection in posting (refused): "${sn.length > 90 ? sn.slice(0, 90) + "..." : sn}"`);
  }
  for (const v of state.hardConstraintViolations) flags.push(`Hard constraint: ${v}`);
  if (state.workArrangement === "unknown") {
    flags.push("Posting never states whether the role is remote, hybrid or on-site");
  }
  if (state.lowConfidence) flags.push("Fit score is low-confidence: too few requirements could be read from the posting");
  for (const u of state.unassessedRequirements ?? []) {
    flags.push(`Requirement not assessed (check it yourself): ${u.length > 90 ? u.slice(0, 90) + "..." : u}`);
  }
  const requiredGaps = state.missingSkills.filter((m) => !(state.missingPreferredSkills ?? []).includes(m));
  if (requiredGaps.length > 0) flags.push(`Required qualification(s) not evidenced in resume: ${requiredGaps.join("; ")}`);
  return flags;
}

// Width of the "judgment zone" around the candidate's minimum fit. Outside it the outcome
// is not a judgment call (a clear pass goes to the human, a clear fail is rejected) so the
// harness permits only that action. Inside it BOTH request_human_approval and
// reject_low_fit are permitted and the controller chooses from the evidence.
export const JUDGMENT_MARGIN = DEFAULT_JUDGMENT_MARGIN;

// The decision actions. The state alone determines which of them are PERMITTED; which of
// the permitted ones runs is the controller's choice when there is more than one.
function applyDecision(state: AgentState, action: string, permitted: string[], log: LogFn, meta?: StepMeta): AgentState {
  const minFit = state.minFit ?? LOW_FIT_THRESHOLD;
  const score = state.fitScore ?? 0;
  const before = { ...state };

  if (action === "reject_hard_constraint") {
    state = { ...state, stage: "rejected_hard_constraint" };
    log(
      `State shows hard constraint violation(s): ${before.hardConstraintViolations.join("; ")}` +
        (before.fitScore === null ? " (fit was not evaluated: the outcome was already determined)" : ""),
      permitted,
      "reject_hard_constraint",
      "Job rejected automatically on a HARD constraint (years/clearance/location), regardless of skill fit. No draft will be produced. Human approval step skipped (nothing to approve).",
      before,
      state,
      meta
    );
    return state;
  }

  if (action === "reject_low_fit") {
    state = { ...state, stage: "rejected_low_fit" };
    log(
      score < minFit
        ? `Fit score ${score} is below the low-fit threshold (${minFit}).`
        : `Fit score ${score} clears the bar (${minFit}) but sits in the judgment zone; the controller judged the gaps disqualifying.`,
      permitted,
      "reject_low_fit",
      "Job down-ranked and rejected automatically for low skill fit (constraints were fine). No draft produced.",
      before,
      state,
      meta
    );
    return state;
  }

  state = { ...state, stage: "awaiting_approval" };
  log(
    score >= minFit
      ? `Constraints passed. fit_score=${score} >= threshold ${minFit}.`
      : `Constraints passed. fit_score=${score} is below the bar (${minFit}) but inside the judgment zone; the controller let the human decide instead of auto-rejecting.`,
    permitted,
    "request_human_approval",
    "Evaluation surfaced to human for Approve / Edit / Reject. Agent paused — no draft produced yet.",
    before,
    state,
    meta
  );
  return state;
}

// Which decision actions the state permits (guardrails expressed as code, not prose).
function permittedDecisions(state: AgentState): string[] {
  if (state.hardConstraintViolations.length > 0) return ["reject_hard_constraint"];
  const minFit = state.minFit ?? LOW_FIT_THRESHOLD;
  const gap = (state.fitScore ?? 0) - minFit;
  const margin = state.judgmentMargin ?? JUDGMENT_MARGIN;
  // Strictly outside the zone the outcome is not a judgment call. (With margin 0 the
  // exact-bar case defaults to the policy: at or above the bar goes to the human.)
  if (margin === 0) return gap >= 0 ? ["request_human_approval"] : ["reject_low_fit"];
  if (gap >= margin) return ["request_human_approval"];
  if (gap <= -margin) return ["reject_low_fit"];
  return ["request_human_approval", "reject_low_fit"];
}

// The built-in policy: what the agent does when no model is choosing (no model
// configured, a failed call, or a proposal the harness refused). It reproduces the
// original fixed pipeline, so a run with no AI behaves exactly as the pre-controller agent.
function policyChoice(permitted: string[], state: AgentState): string {
  const order = [
    "scan_for_injection",
    "flag_injection_and_continue",
    "evaluate_fit",
    "check_hard_constraints",
    "ask_user_clarification",
    "reject_hard_constraint",
  ];
  for (const a of order) if (permitted.includes(a)) return a;
  const minFit = state.minFit ?? LOW_FIT_THRESHOLD;
  return (state.fitScore ?? 0) >= minFit ? "request_human_approval" : "reject_low_fit";
}

// Kept for applyClarificationAnswer(): resuming after ASK_USER goes through the SAME
// decision logic as a fresh run, never a copy of it.
function decideAfterConstraints(state: AgentState, log: LogFn): AgentState {
  state = { ...state, redFlags: computeRedFlags(state) };
  const permitted = permittedDecisions(state);
  return applyDecision(state, policyChoice(permitted, state), permitted, log, { chosenBy: "harness" });
}

// ---------- The advisor: the agent's recommendation to the person ----------
//
// Whenever the agent stops for a human (approval gate, a low-fit rejection they may
// overrule, or an ASK_USER question) an AI advisor tells them what it thinks: a
// recommendation, the gaps ranked by how much they matter, and drafting presets tailored to
// THIS résumé and THIS job. The UI shows exactly this, so the person sees the agent's
// thinking and not canned buttons.
//
// The advisor never sees the posting text. Everything it returns is verified before it is
// shown: quotes must be literal résumé text, ranked gaps must be gaps the evaluation really
// found, and the recommendation must be one of the options that exist in this mode.
// With no model the same panel is filled by a deterministic default (source: "policy").
export type AdviceRecommendation =
  | "approve"
  | "edit"
  | "reject"
  | "override"
  | "answer_compatible"
  | "answer_violation"
  | "none";

export interface Advice {
  source: "model" | "policy";
  mode: AdviceMode;
  headline: string;
  recommendation: AdviceRecommendation;
  recommendationWhy: string;
  strengths: { requirement: string; evidenceQuote: string }[];
  rankedGaps: {
    gap: string;
    importance: "critical" | "helpful" | "minor" | "unranked";
    why: string;
    bridgeQuestion: string;
  }[];
  draftPresets: { label: string; instruction: string; evidenceQuote: string }[];
  // Set when part of the model's answer was refused (e.g. a quote not found in the résumé).
  overruled?: string;
}

const ALLOWED_RECOMMENDATIONS: Record<AdviceMode, AdviceRecommendation[]> = {
  approval: ["approve", "edit", "reject"],
  rejected_low_fit: ["reject", "override"],
  clarification: ["answer_compatible", "answer_violation"],
};

function adviceModeFor(state: AgentState): AdviceMode | null {
  if (state.stage === "awaiting_approval") return "approval";
  if (state.stage === "rejected_low_fit") return "rejected_low_fit";
  if (state.stage === "awaiting_clarification") return "clarification";
  return null;
}

const squash = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();

function defaultAdvice(state: AgentState, mode: AdviceMode): Advice {
  const missingPreferred = state.missingPreferredSkills ?? [];
  const requiredMissing = state.missingSkills.filter((m) => !missingPreferred.includes(m));
  const pct = state.fitScore === null ? "n/a" : `${Math.round(state.fitScore * 100)}%`;
  const strengths = state.matchedSkills
    .filter((m) => state.matchedEvidence[m])
    .slice(0, 3)
    .map((m) => ({ requirement: m, evidenceQuote: state.matchedEvidence[m] }));
  const rankedGaps = [...requiredMissing, ...missingPreferred].map((g) => ({
    gap: g,
    importance: "unranked" as const,
    why: missingPreferred.includes(g) ? "Listed as a nice-to-have." : "Listed as required.",
    bridgeQuestion: `Do you have real experience with "${g}"? If so add it below; if not it stays an honest gap.`,
  }));
  const draftPresets = state.matchedSkills
    .filter((m) => state.matchedEvidence[m])
    .slice(0, 4)
    .map((m) => ({
      label: `Emphasize ${m.length > 34 ? m.slice(0, 32) + "…" : m}`,
      instruction: `- Emphasize ${m}, drawing on: "${state.matchedEvidence[m]}"`,
      evidenceQuote: state.matchedEvidence[m],
    }));
  let recommendation: AdviceRecommendation = "none";
  let headline = `Default policy (no AI advisor): fit ${pct}.`;
  if (mode === "approval") {
    recommendation = requiredMissing.length > 1 ? "edit" : "approve";
    headline += requiredMissing.length
      ? ` ${requiredMissing.length} required requirement(s) are not evidenced; consider bridging them before drafting.`
      : " No required requirement is missing.";
  } else if (mode === "rejected_low_fit") {
    recommendation = "reject";
    headline += " The score is under your bar. You can still apply anyway.";
  } else {
    headline = "Default policy (no AI advisor): the posting does not say whether the role is remote, hybrid or on-site.";
  }
  return {
    source: "policy",
    mode,
    headline,
    recommendation,
    recommendationWhy: "Chosen by the built-in default policy, not by an AI.",
    strengths,
    rankedGaps,
    draftPresets,
  };
}

// SMALL-MODEL advisor. A weak model is not asked to write presets or rank free text. The
// harness builds the candidate presets from the résumé evidence and the list of real gaps, and
// the model only chooses among them: a recommendation, an order for the gaps, which presets to
// offer, and a headline. Everything it can pick is already grounded, so nothing it says can be a
// fabrication; a malformed answer falls back to the default panel.
async function produceAdviceSmall(state: AgentState, mode: AdviceMode, fallback: Advice, guide: Guidelines): Promise<Advice> {
  const opts = ALLOWED_RECOMMENDATIONS[mode];
  const gaps = fallback.rankedGaps.map((g) => g.gap);
  const presets = state.matchedSkills.filter((m) => state.matchedEvidence[m]).slice(0, 6);
  const pct = state.fitScore === null ? "unknown" : `${Math.round(state.fitScore * 100)}%`;
  const bar = `${Math.round((state.minFit ?? 0.6) * 100)}%`;
  const user =
    `Fit score ${pct}; the candidate's minimum bar is ${bar}.\n` +
    `Recommendation options: ${opts.map((o, i) => `${i + 1}=${o}`).join(", ")}\n` +
    `Gaps (missing requirements): ${gaps.length ? gaps.map((g, i) => `${i + 1}=${g}`).join("; ") : "none"}\n` +
    `Strengths that could be emphasised: ${presets.length ? presets.map((p, i) => `${i + 1}=${p}`).join("; ") : "none"}\n\n` +
    `Reply as JSON: {"recommendation": <number>, "headline": "<one sentence>", "why": "<one sentence>", ` +
    `"gapOrder": [<gap numbers, most important first>], "emphasise": [<strength numbers to lead with, best first>]}`;
  try {
    const raw = (await completeJsonWithLlm(
      withRole("You are an advisor helping a job seeker decide what to do next. Be direct and short. Only use the numbers you were given.", guide.roles.advisor).slice(0, 3000),
      user, 300, 240000)) as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === "number" ? v : parseInt(String(v), 10));
    const rec = opts[num(raw.recommendation) - 1];
    const order = (Array.isArray(raw.gapOrder) ? raw.gapOrder : []).map(num).filter((n) => n >= 1 && n <= gaps.length);
    const rankedGaps: Advice["rankedGaps"] = [];
    order.forEach((n, i) => {
      const g = fallback.rankedGaps[n - 1];
      if (g && !rankedGaps.some((x) => x.gap === g.gap)) {
        rankedGaps.push({ ...g, importance: i === 0 ? "critical" : i < 2 ? "helpful" : "minor" });
      }
    });
    for (const g of fallback.rankedGaps) if (!rankedGaps.some((x) => x.gap === g.gap)) rankedGaps.push(g);
    const pick = (Array.isArray(raw.emphasise) ? raw.emphasise : []).map(num).filter((n) => n >= 1 && n <= presets.length);
    const chosen = [...new Set(pick)].map((n) => presets[n - 1]);
    const draftPresets = chosen.length
      ? chosen.slice(0, 4).map((m) => ({
          label: `Emphasize ${m.length > 34 ? m.slice(0, 32) + "…" : m}`,
          instruction: `- Emphasize ${m}, drawing on: "${state.matchedEvidence[m]}"`,
          evidenceQuote: state.matchedEvidence[m],
        }))
      : fallback.draftPresets;
    return {
      ...fallback,
      source: "model",
      headline: String(raw.headline ?? "").slice(0, 300) || fallback.headline,
      recommendation: rec ?? fallback.recommendation,
      recommendationWhy: String(raw.why ?? "").slice(0, 300),
      rankedGaps,
      draftPresets,
      ...(rec ? {} : { overruled: "the small model's recommendation number was not valid; default used" }),
    };
  } catch (err) {
    return { ...fallback, overruled: `AI advisor unavailable (${String(err).slice(0, 80)}); default used` };
  }
}

async function produceAdvice(
  state: AgentState,
  mode: AdviceMode,
  resumeText: string | null,
  jobTitle: string,
  settings: HarnessSettings,
  guide: Guidelines
): Promise<Advice> {
  const fallback = defaultAdvice(state, mode);
  if (!isLlmConfigured() || process.env.AGENT_CONTROL === "policy" || !resumeText) return fallback;

  const missingPreferred = state.missingPreferredSkills ?? [];
  const situation = JSON.stringify(
    {
      mode,
      allowedRecommendations: ALLOWED_RECOMMENDATIONS[mode],
      jobTitle,
      fitScorePercent: state.fitScore === null ? null : Math.round(state.fitScore * 100),
      minimumFitPercent: Math.round((state.minFit ?? 0.6) * 100),
      fitVersusBar:
        state.fitScore === null
          ? "not evaluated"
          : state.fitScore >= (state.minFit ?? 0.6)
          ? "at or above the bar"
          : "below the bar",
      workArrangement: state.workArrangement,
      injectionWasFlagged: state.injectionDetected,
      question: mode === "clarification" ? state.clarificationQuestion : undefined,
      matchedRequirements: state.matchedSkills.map((m) => ({
        requirement: m,
        evidenceQuote: state.matchedEvidence[m] ?? "",
        strength: state.matchStrength?.[m] ?? "full",
      })),
      missingRequirements: state.missingSkills.map((m) => ({
        requirement: m,
        priority: missingPreferred.includes(m) ? "nice-to-have" : "required",
      })),
      candidateResume: resumeText.slice(0, settings.llmMaxInputChars),
    },
    null,
    2
  );

  if (isSmallModel()) return produceAdviceSmall(state, mode, fallback, guide);

  try {
    const a = await adviseHumanWithLlm(situation, {
      systemPrompt: withRole(ADVISE_SYSTEM_PROMPT, guide.roles.advisor),
      timeoutMs: Math.max(settings.llmTimeoutMs, 30000),
    });
    const notes: string[] = [];
    const resumeSquashed = squash(resumeText);
    const quoteOk = (q: unknown) => typeof q === "string" && q.trim().length > 3 && resumeSquashed.includes(squash(q));

    const strengths = (Array.isArray(a.strengths) ? a.strengths : [])
      .filter((x) => quoteOk(x?.evidenceQuote))
      .slice(0, 3)
      .map((x) => ({ requirement: String(x.requirement ?? "").slice(0, 120), evidenceQuote: String(x.evidenceQuote) }));

    const droppedPresets = (Array.isArray(a.draftPresets) ? a.draftPresets : []).filter((x) => !quoteOk(x?.evidenceQuote)).length;
    let draftPresets = (Array.isArray(a.draftPresets) ? a.draftPresets : [])
      .filter((x) => quoteOk(x?.evidenceQuote) && x.instruction && x.label)
      .slice(0, 4)
      .map((x) => ({
        label: String(x.label).slice(0, 40),
        instruction: String(x.instruction).slice(0, 300),
        evidenceQuote: String(x.evidenceQuote),
      }));
    if (droppedPresets) notes.push(`${droppedPresets} preset(s) dropped: their résumé quote was not found in the résumé`);
    if (draftPresets.length === 0) draftPresets = fallback.draftPresets;

    // Ranked gaps must be gaps the evaluation actually found. Anything the model ranks
    // that is not on that list is discarded; unranked real gaps are appended.
    const realGaps = state.missingSkills;
    const ranked: Advice["rankedGaps"] = [];
    for (const g of Array.isArray(a.rankedGaps) ? a.rankedGaps : []) {
      const name = String(g?.gap ?? "");
      const real = realGaps.find((r) => normRequirement(r) === normRequirement(name) || squash(r) === squash(name));
      if (!real || ranked.some((x) => x.gap === real)) continue;
      const imp = g.importance === "critical" || g.importance === "helpful" || g.importance === "minor" ? g.importance : "unranked";
      ranked.push({
        gap: real,
        importance: imp,
        why: String(g.why ?? "").slice(0, 200),
        bridgeQuestion: String(g.bridgeQuestion ?? "").slice(0, 200) || `Do you have real experience with "${real}"?`,
      });
    }
    for (const g of fallback.rankedGaps) if (!ranked.some((x) => x.gap === g.gap)) ranked.push(g);

    let recommendation = a.recommendation as AdviceRecommendation;
    if (!ALLOWED_RECOMMENDATIONS[mode].includes(recommendation)) {
      notes.push(`recommendation "${String(a.recommendation).slice(0, 30)}" is not an option here; replaced by the default`);
      recommendation = fallback.recommendation;
    }
    return {
      source: "model",
      mode,
      headline: String(a.headline ?? "").slice(0, 400) || fallback.headline,
      recommendation,
      recommendationWhy: String(a.recommendationWhy ?? "").slice(0, 400),
      strengths: strengths.length ? strengths : fallback.strengths,
      rankedGaps: ranked,
      draftPresets,
      ...(notes.length ? { overruled: notes.join("; ") } : {}),
    };
  } catch (err) {
    return { ...fallback, overruled: `AI advisor unavailable (${String(err).slice(0, 80)}); default used` };
  }
}

// Appends one "advise_human" step to a run that has stopped for a person. Idempotent per
// stop: it only runs when the run is at a stop the advisor covers.
async function adviseAndLog(
  result: EvaluationResult,
  resumeText: string | null,
  jobText: string,
  settings: HarnessSettings
): Promise<EvaluationResult> {
  const mode = adviceModeFor(result.state);
  if (!mode) return result;
  const guide = loadGuidelines();
  const titleLine = jobText.match(/^#?\s*(.+)$/m);
  const advice = await produceAdvice(result.state, mode, resumeText, titleLine ? titleLine[1].trim() : "this role", settings, guide);
  const before = { ...result.state };
  const state: AgentState = { ...result.state, advice };
  const fromModel = advice.source === "model";
  const trace = [...result.trace];
  trace.push({
    step: trace.length + 1,
    stateBefore: before,
    observation:
      `The agent is stopping for a person (${result.state.stage}). The advisor reads the evaluation facts and the résumé (never the posting text) and tells the person what to do next.`,
    availableActions: ["advise_human"],
    selectedAction: "advise_human",
    result:
      `${advice.headline} Recommends: ${advice.recommendation}.` +
      ` ${advice.draftPresets.length} tailored preset(s), ${advice.rankedGaps.length} gap(s) ranked.` +
      (advice.overruled ? ` Harness note: ${advice.overruled}.` : ""),
    stateAfter: { ...state },
    chosenBy: fromModel ? "model" : "policy",
    brain: fromModel ? "ai" : "code",
    thinking: `${advice.headline}${advice.recommendationWhy ? "\n" + advice.recommendationWhy : ""}`,
    guidelines: guide.label,
  });
  return { state, trace };
}

interface LoopCtx {
  done: Set<string>;
  locationQuestion: string | null;
}

// What the agent may do RIGHT NOW. This is the guardrail layer: the controller can only
// pick from this list, so it can never skip the injection scan, drop a hard constraint,
// reject a clearly good fit, approve a clearly bad one, or draft anything.
function permittedActions(state: AgentState, ctx: LoopCtx): string[] {
  const { done } = ctx;
  if (!done.has("scan_for_injection")) return ["scan_for_injection"];
  if (state.injectionDetected && !done.has("flag_injection_and_continue")) return ["flag_injection_and_continue"];
  const evaluated = done.has("evaluate_fit");
  const checked = done.has("check_hard_constraints");
  if (!evaluated || !checked) {
    // A hard violation is final, so once it is known the controller may stop early and
    // skip the (model-costing) fit evaluation, or run it to give the human a score.
    if (checked && !evaluated && state.hardConstraintViolations.length > 0) {
      return ["evaluate_fit", "reject_hard_constraint"];
    }
    return ["evaluate_fit", "check_hard_constraints"].filter((a) => !done.has(a));
  }
  if (state.hardConstraintViolations.length > 0) return ["reject_hard_constraint"];
  if (ctx.locationQuestion && !done.has("ask_user_clarification")) return ["ask_user_clarification"];
  return permittedDecisions(state);
}

function isTerminal(state: AgentState): boolean {
  return (
    state.stage === "rejected_hard_constraint" ||
    state.stage === "rejected_low_fit" ||
    state.stage === "awaiting_approval" ||
    state.stage === "awaiting_clarification"
  );
}

// The controller sees a structured summary and NEVER the posting text: nothing in the
// posting can address it. Everything here is a count, flag or number computed by code.
function situationFor(state: AgentState, permitted: string[], ctx: LoopCtx): string {
  const missingPreferred = state.missingPreferredSkills ?? [];
  const missingRequired = state.missingSkills.filter((m) => !missingPreferred.includes(m));
  const partial = Object.values(state.matchStrength ?? {}).filter((v) => v === "partial").length;
  const minFit = state.minFit ?? LOW_FIT_THRESHOLD;
  return JSON.stringify(
    {
      actionsAlreadyDone: [...ctx.done],
      permittedActions: permitted,
      observed: {
        injectionDetected: state.injectionDetected,
        workArrangement: state.workArrangement,
        hardConstraintsChecked: ctx.done.has("check_hard_constraints"),
        hardConstraintViolationsFound: state.hardConstraintViolations.length,
        fitEvaluated: state.fitScore !== null,
        fitScore: state.fitScore,
        minimumFit: minFit,
        distanceFromBar: state.fitScore === null ? null : Math.round((state.fitScore - minFit) * 100) / 100,
        requirementsMatched: state.matchedSkills.length,
        requirementsMissingRequired: missingRequired.length,
        requirementsMissingNiceToHave: missingPreferred.length,
        matchesOnlyPartial: partial,
        scoreIsLowConfidence: !!state.lowConfidence,
      },
    },
    null,
    2
  );
}

async function selectAction(
  permitted: string[],
  state: AgentState,
  ctx: LoopCtx,
  settings: HarnessSettings,
  guide: Guidelines
): Promise<{ action: string; meta: StepMeta }> {
  if (permitted.length === 1) return { action: permitted[0], meta: { chosenBy: "harness", brain: "code" } };
  const fallback = policyChoice(permitted, state);
  const controlOn = isLlmConfigured() && process.env.AGENT_CONTROL !== "policy";
  if (!controlOn) return { action: fallback, meta: { chosenBy: "policy", brain: "code" } };
  try {
    const small = isSmallModel();
    const choice = await chooseActionWithLlm(situationFor(state, permitted, ctx), {
      systemPrompt: guide.controllerPrompt,
      timeoutMs: small ? Math.max(settings.llmTimeoutMs, 120000) : settings.llmTimeoutMs,
      plainMenu: small ? permitted : undefined,
    });
    const proposed = String(choice.action ?? "").trim();
    const reasoning = String(choice.reasoning ?? "").slice(0, 300);
    if (permitted.includes(proposed)) {
      return { action: proposed, meta: { chosenBy: "model", modelReasoning: reasoning, guidelines: guide.label, brain: "ai", thinking: reasoning } };
    }
    return {
      action: fallback,
      meta: { chosenBy: "policy", overruled: `model proposed "${proposed.slice(0, 60)}", which is not permitted here`, guidelines: guide.label },
    };
  } catch {
    return { action: fallback, meta: { chosenBy: "policy", brain: "code" } };
  }
}

// Adds each role's section of agent-guidelines.md to that role's own prompt. The core prompt
// (including the rules about never inventing facts) always comes first and is never removed.
// Small-model mode: give a slow local model far more time and a shorter document to read.
function smallModelSettings(settings: HarnessSettings): HarnessSettings {
  return {
    ...settings,
    llmTimeoutMs: Math.max(settings.llmTimeoutMs, 240000),
    llmMaxInputChars: Math.min(settings.llmMaxInputChars, 7000),
  };
}

function withGuidelines(settings: HarnessSettings, guide: Guidelines): HarnessSettings {
  return {
    ...settings,
    prompts: {
      assess: withRole(settings.prompts.assess, guide.roles.reader),
      fit: withRole(settings.prompts.fit, guide.roles.matcher),
      draft: withRole(settings.prompts.draft, guide.roles.drafter),
    },
  };
}

// ---------- The agent loop ----------
//
// SELECT -> ACT -> OBSERVE, repeated until the agent reaches a terminal or paused state.
// Each turn: the harness computes which actions are permitted from the current state
// (permittedActions), the controller picks one (selectAction), the harness executes it
// and records a full trace step. The order of steps, whether an expensive evaluation
// runs, and what happens near the fit bar are therefore decided at run time from the
// observations so far, not fixed in code. What can NOT vary is enforced by the permitted
// list: the injection scan comes first, hard constraints are final, clear passes and
// fails are not judgment calls, and no path leads to a draft without a human.
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

  const log: LogFn = (observation, availableActions, selectedAction, result, before, after, meta) => {
    step += 1;
    trace.push({
      step,
      stateBefore: { ...before },
      observation,
      availableActions,
      selectedAction,
      result,
      stateAfter: { ...after },
      ...(meta ?? {}),
    });
  };

  // The rulebook is re-read on every run, so an edit to agent-guidelines.md takes effect next run.
  const guide = loadGuidelines();
  settings = withGuidelines(settings, guide);
  if (isSmallModel()) settings = smallModelSettings(settings);
  state = { ...state, judgmentMargin: guide.judgmentMargin, guidelines: guide.label };
  const ctx: LoopCtx = { done: new Set<string>(), locationQuestion: null };
  let assessment: PostingAssessment | null = null;
  const MAX_STEPS = 12;

  // ---- action executors: each does exactly one thing and logs one trace step ----
  async function doScan(permitted: string[], meta: StepMeta) {
    // The brain reads the posting ONCE (injection cues, work arrangement, clearance).
    // It only observes; the gates decide.
    assessment = await assessPosting(jobText, settings);
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
      permitted,
      "scan_for_injection",
      detected
        ? `Embedded instruction-like text detected (${sources.join(" + ")}) — logging and continuing normal evaluation, NOT obeying it.`
        : "No embedded instructions detected.",
      before,
      state,
      {
        ...meta,
        brain: assessment ? "ai" : "code",
        thinking: assessment
          ? `The AI reader saw: work arrangement "${assessment.arrangement}"` +
            (assessment.arrangementQuote ? ` (quote: "${assessment.arrangementQuote}")` : "") +
            `; clearance ${assessment.clearanceRequired ? "required" : "not required"}; ` +
            `${llmSnippets.length} instruction-like passage(s) aimed at an AI. The keyword barrier then ran independently and found ${regexHit.snippets.length}.`
          : `No AI reader available. The keyword barrier alone scanned the text and found ${regexHit.snippets.length} instruction-like passage(s).`,
      }
    );
  }

  function doFlag(permitted: string[], meta: StepMeta) {
    const before = { ...state };
    log(
      `Injected instructions found: ${state.injectionSnippets.join(" | ")}`,
      permitted,
      "flag_injection_and_continue",
      "Flag recorded in state. Evaluation proceeds on the ACTUAL resume/job data only — the embedded commands to auto-approve, skip human review, or print resume.md verbatim were all refused.",
      before,
      state,
      meta
    );
  }

  async function doEvaluate(permitted: string[], meta: StepMeta) {
    const before = { ...state };
    const fit = await performFitEvaluation(resumeText, jobText, settings);
    const fitRationale = explainFit(fit.matchedEvidence, jobText, preferencesText, fit.matched, candidateYears);
    state = {
      ...state,
      stage: "evaluated",
      fitScore: fit.score,
      matchedSkills: fit.matched,
      missingSkills: fit.missing,
      missingPreferredSkills: fit.missingPreferred ?? [],
      matchedEvidence: fit.matchedEvidence,
      matchStrength: fit.matchStrength ?? {},
      lowConfidence: fit.lowConfidence ?? false,
      requirementCount: fit.requirementCount ?? fit.matched.length + fit.missing.length,
      unassessedRequirements: fit.unassessedRequirements ?? [],
      fitMethod: fit.method,
      fitReasoning: fit.reasoning,
      fitRationale,
    };
    log(
      `${fit.note} Requirements checked against resume.md.` +
        (fit.reasoning ? ` Model's reasoning: "${fit.reasoning}"` : ""),
      permitted,
      "evaluate_fit",
      `fit_score=${fit.score}, matched=[${fit.matched.join(", ")}], missing=[${fit.missing.join(", ")}]`,
      before,
      state,
      {
        ...meta,
        brain: fit.method === "llm" ? "ai" : "code",
        thinking: fit.reasoning ?? "Keyword matcher (no AI): counted the skills named in both the posting and the résumé.",
      }
    );
  }

  function doCheckConstraints(permitted: string[], meta: StepMeta) {
    const before = { ...state };
    // The AI model's reading of the arrangement wins; regex cues are the fallback.
    const arrangement: WorkArrangement =
      assessment && assessment.arrangement !== "unknown" ? assessment.arrangement : regexArrangement(jobText);
    const violations = checkHardConstraints(
      jobText,
      candidateYears,
      preferencesText,
      arrangement,
      assessment?.clearanceRequired ?? false
    );
    state = { ...state, stage: "constraints_checked", hardConstraintViolations: violations, workArrangement: arrangement };
    log(
      `Candidate years of experience: ~${candidateYears}. Preferences hard constraints checked against posting. Work arrangement read as "${arrangement}"` +
        (assessment?.arrangementQuote ? ` (evidence: "${assessment.arrangementQuote}").` : "."),
      permitted,
      "check_hard_constraints",
      violations.length ? `VIOLATION(S): ${violations.join("; ")}` : "No hard constraint violations.",
      before,
      state,
      meta
    );
    ctx.locationQuestion =
      violations.length === 0 && settings.askUserEnabled
        ? detectLocationAmbiguity(state.workArrangement, preferencesText)
        : null;
  }

  function doAsk(permitted: string[], meta: StepMeta) {
    // ASK_USER: only permitted when nothing has decided the job's fate and the posting is
    // genuinely silent on something a hard constraint depends on. Guessing would mean
    // silently deciding for the candidate instead of asking them.
    const clarificationQuestion = ctx.locationQuestion!;
    const before = { ...state };
    state = { ...state, stage: "awaiting_clarification", clarificationQuestion };
    state = { ...state, redFlags: computeRedFlags(state) };
    log(
      "Hard constraint depends on information the posting never states.",
      permitted,
      "ask_user_clarification",
      `Agent paused to ask: "${clarificationQuestion}"`,
      before,
      state,
      meta
    );
  }

  // ---- the loop ----
  while (step < MAX_STEPS && !isTerminal(state)) {
    const permitted = permittedActions(state, ctx);
    if (permitted.length === 0) break;
    const { action, meta } = await selectAction(permitted, state, ctx, settings, guide);
    ctx.done.add(action);
    if (action === "scan_for_injection") await doScan(permitted, meta);
    else if (action === "flag_injection_and_continue") doFlag(permitted, meta);
    else if (action === "evaluate_fit") await doEvaluate(permitted, meta);
    else if (action === "check_hard_constraints") doCheckConstraints(permitted, meta);
    else if (action === "ask_user_clarification") doAsk(permitted, meta);
    else {
      state = { ...state, redFlags: computeRedFlags(state) };
      state = applyDecision(state, action, permitted, log, meta);
    }
  }
  // The agent has stopped. If it stopped for a person, its advisor now tells them what it thinks.
  return adviseAndLog({ state, trace }, resumeText, jobText, settings);
}

// ---------- Called after a human resolves an ASK_USER clarification ----------
// Resumes exactly where the agent paused, using the human's answer to settle
// the one ambiguous hard constraint, then runs through the SAME
// decideAfterConstraints() branch logic runAgent() itself uses — not a copy.
export async function applyClarificationAnswer(
  prior: EvaluationResult,
  answer: "compatible" | "violation",
  // Needed only so the advisor can speak again if the run lands back at the approval gate.
  ctx: { resumeText: string | null; jobText: string; settings?: HarnessSettings } = { resumeText: null, jobText: "" }
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
    ["human_answers_clarification"],
    "human_answers_clarification",
    "Clarification resolved. Resuming evaluation with the human's answer incorporated.",
    before,
    state
  );

  state = decideAfterConstraints(state, log);
  return adviseAndLog({ state, trace }, ctx.resumeText, ctx.jobText, ctx.settings ?? DEFAULT_SETTINGS);
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
export async function applyLowFitOverride(
  prior: EvaluationResult,
  reason: string | null,
  ctx: { resumeText: string | null; jobText: string; settings?: HarnessSettings } = { resumeText: null, jobText: "" }
): Promise<EvaluationResult> {
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

  // The job is back at the approval gate, so the advisor speaks again (this time to advise
  // on drafting, with presets tailored to the job).
  return adviseAndLog({ state, trace }, ctx.resumeText, ctx.jobText, ctx.settings ?? DEFAULT_SETTINGS);
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
  settings = withGuidelines(settings, loadGuidelines());
  if (isSmallModel()) settings = smallModelSettings(settings);

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
      ["human_approve", "human_edit", "discard"],
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
      ["human_edit", "human_approve", "discard"],
      "human_edit",
      "Human edited the evaluation notes and approved drafting to proceed with the edit applied.",
      before,
      state
    );
  } else {
    state = { ...state, stage: "approved" };
    log(
      "Human selected: Approve.",
      ["human_approve", "human_edit", "discard"],
      "human_approve",
      "Human approved. Proceeding to draft application material grounded only in resume.md.",
      before,
      state
    );
  }

  // Draft, grounded ONLY in facts extracted from resume.md — never fabricated.
  const draftBefore = { ...state };
  const { draft, coverLetter, tailoredResume, gapNotes, bulletsRetailored } = await draftApplication(
    state.matchedEvidence, state.missingSkills, jobText, state.matchedSkills, state.approvalNote, resumeText, settings
  );
  state = { ...state, stage: "drafted", draft, coverLetter, tailoredResume, gapNotes };
  log(
    `Drafting using matched_skills=[${state.matchedSkills.join(", ")}] and resume.md as the only source of candidate facts.${coverLetter ? " LLM-powered cover letter and tailored resume generated." : " Deterministic bullet-point draft (no LLM configured)."}`,
    ["draft_application"],
    "draft_application",
    "Draft produced from resume.md and the human's note." +
      (coverLetter
        ? " Full cover letter and tailored resume included — both now go to verification." +
          (bulletsRetailored
            ? ` Second tailoring pass rewrote ${bulletsRetailored} bullet(s) the drafter had copied verbatim (same numbers kept; verified below).`
            : "")
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
      // SCORE BOTH SIDES ON THE SAME YARDSTICK.
      //
      // The obvious implementation — re-run the normal evaluation against the tailored
      // resume and the original posting — is WRONG, and produced swings of -34 points
      // on drafts that had invented nothing and lost nothing. Each evaluation
      // independently asks the model to extract requirements from the posting, and the
      // model does not return the same list twice: it merges, splits and re-words. Two
      // percentages computed over two different denominators are not comparable, so the
      // delta was measuring the model's phrasing rather than the rewrite.
      //
      // Instead the re-score is run against a canonical list of the requirements the
      // ORIGINAL evaluation actually found. Same requirements, same weights, same
      // denominator — so the difference can only come from the resume.
      const originalRequirements = [...state.matchedSkills, ...state.missingSkills];
      const yardstick =
        `# ${(jobText.match(/^#?\s*(.+)$/m) ?? [, "Role"])[1]}\n\n` +
        `Requirements:\n${originalRequirements.map((r) => `- ${r}`).join("\n")}\n`;

      const after = await performFitEvaluation(tailoredResume, yardstick, settings);

      // If the model still did not reproduce the same list, the comparison is not
      // sound and we say so rather than print a confident wrong number.
      const afterCount = after.matched.length + after.missing.length;
      const comparable =
        originalRequirements.length > 0 &&
        Math.abs(afterCount - originalRequirements.length) <= Math.max(1, originalRequirements.length * 0.25);

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
          comparable,
          requirementsCompared: originalRequirements.length,
        },
      };

      const delta = Math.round((after.score - scoreBefore) * 100);
      log(
        `Re-scoring the TAILORED resume against the SAME ${originalRequirements.length} requirement(s) the original evaluation found, so the before/after difference can only come from the rewrite.`,
        ["rescore_tailored_resume"],
        "rescore_tailored_resume",
        (!comparable
          ? `Re-check could not reproduce the original requirement list (${originalRequirements.length} -> ${afterCount}); the before/after comparison is NOT reliable and is being withheld. `
          : "") +
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
  bulletsRetailored?: number;
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
      { systemPrompt: settings.prompts.draft, maxInputChars: settings.llmMaxInputChars, timeoutMs: isSmallModel() ? 600000 : undefined }
    );
    if (llmDraft) {
      const retailored = await retailorVerbatimBullets(llmDraft.tailoredResume, resumeText, jobText, roleTitle, settings);
      return {
        draft,
        coverLetter: llmDraft.coverLetter,
        tailoredResume: retailored.resume,
        gapNotes: llmDraft.addressedGaps ?? [],
        bulletsRetailored: retailored.rewritten,
      };
    }
  }

  return { draft, coverLetter: null, tailoredResume: null, gapNotes: [] };
}

// ---------- Second tailoring pass ----------
//
// The drafter is told to reword achievement bullets toward the posting, and often copies them
// through verbatim anyway (measured on real runs: 1 of 7, 1 of 12). This pass finds the bullets
// that came back word-for-word and asks for a one-for-one rewrite of just those. The model does
// the language; the harness decides what survives: a rewrite is kept ONLY if it carries exactly
// the same set of numbers as the original bullet (no figure added, none dropped), and the whole
// tailored resume still goes through verify_draft afterwards, which flags any new tool,
// employer, credential or inflated scope ("led", "coordinated") it introduced.
const bulletKey = (t: string) =>
  t.toLowerCase().replace(/\([^)]*yrs?\)/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const numbersIn = (t: string) => (t.match(/\d+(?:\.\d+)?/g) ?? []).sort().join(",");
const NEAR_VERBATIM = 0.15;
/** 0 = same words, 1 = no words in common (multiset Dice distance over words of 3+ letters). */
function wordDistance(a: string, b: string): number {
  const A = a.split(" ").filter((w) => w.length >= 3);
  const B = b.split(" ").filter((w) => w.length >= 3);
  if (!A.length && !B.length) return 0;
  const count = new Map<string, number>();
  for (const w of A) count.set(w, (count.get(w) ?? 0) + 1);
  let shared = 0;
  for (const w of B) {
    const n = count.get(w) ?? 0;
    if (n > 0) {
      shared += 1;
      count.set(w, n - 1);
    }
  }
  return 1 - (2 * shared) / (A.length + B.length);
}

async function retailorVerbatimBullets(
  tailored: string,
  resumeText: string,
  jobText: string,
  roleTitle: string,
  settings: HarnessSettings
): Promise<{ resume: string; rewritten: number }> {
  const originals = resumeText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- ") && l.length > 25)
    .map((l) => bulletKey(l.slice(2)));
  // "Nearly verbatim", not just identical: measured drafts dodge an exact-match check with a
  // one-word tweak ("paid channels" -> "paid marketing channels"), which is not tailoring.
  // A bullet sharing 85%+ of its words with an original line counts as copied.
  const lines = tailored.split("\n");
  const idxs: number[] = [];
  lines.forEach((l, i) => {
    const t = l.trim();
    if (!t.startsWith("- ") || t.length <= 25) return;
    const key = bulletKey(t.slice(2));
    if (originals.some((o) => wordDistance(o, key) < NEAR_VERBATIM)) idxs.push(i);
  });
  if (idxs.length < 2) return { resume: tailored, rewritten: 0 };
  const bullets = idxs.map((i) => lines[i].trim().slice(2));
  try {
    const res = await rewriteBulletsWithLlm(bullets, roleTitle, postingVocabulary(jobText, resumeText), {
      timeoutMs: Math.max(settings.llmTimeoutMs, 30000),
    });
    const out = Array.isArray(res.bullets) ? res.bullets : [];
    if (out.length !== bullets.length) return { resume: tailored, rewritten: 0 };
    let rewritten = 0;
    idxs.forEach((lineIdx, k) => {
      const proposed = String(out[k] ?? "").replace(/^[-*]\s*/, "").trim();
      if (!proposed || proposed.length > 300) return;
      if (numbersIn(proposed) !== numbersIn(bullets[k])) return; // a figure changed: refuse
      // Only accept it if it actually moved further from the original than what we had.
      if (wordDistance(bulletKey(proposed), bulletKey(bullets[k])) < NEAR_VERBATIM) return;
      const indent = lines[lineIdx].match(/^\s*/)?.[0] ?? "";
      lines[lineIdx] = `${indent}- ${proposed}`;
      rewritten += 1;
    });
    return { resume: lines.join("\n"), rewritten };
  } catch {
    return { resume: tailored, rewritten: 0 };
  }
}
