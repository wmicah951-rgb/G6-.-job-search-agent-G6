// Draft verification — the "trust but verify" pass for generated application material.
//
// WHY THIS EXISTS
// Fit matching (agent.ts) can demand that every evidenceQuote be a LITERAL substring of
// the resume, because there the model is quoting. Drafting is different: the model is
// asked to rephrase for flow, so literal matching would flag every honest sentence.
//
// THE RULE THAT MAKES THIS WORK:
//
//     Fuzzy similarity may only EXONERATE. Only an unsourced HARD FACT may ACCUSE.
//
// A sentence is never flagged for being worded differently. It is flagged when it
// contains a hard fact — a number, a proper noun, a tool name, a credential — that
// appears nowhere in the candidate's own resume or their edit note. Those are exactly
// what a model fabricates, and exactly what needs no fuzziness to detect.
//
// This asymmetry is deliberate. A verifier that cries wolf on honest paraphrasing gets
// ignored after two uses, and an ignored warning is worse than no warning.
//
// Everything here is deterministic and offline: no model call, reproducible, free. The
// model proposes the draft; this code decides what is trustworthy.

export type ClaimVerdict =
  | "structural" // headings, contact line, sign-offs — nothing to verify
  | "grounded" // strongly matches a line in the resume
  | "reworded" // recognisably the same content, rephrased, no new hard facts
  | "from_your_note" // traces to what the human typed in the edit note
  | "disclaimed" // names a skill in order to say the candidate LACKS it
  | "subjective" // opinion//enthusiasm with no factual claim in it
  | "unsupported"; // contains a hard fact found in neither source

export interface VerifiedClaim {
  id: number;
  text: string;
  verdict: ClaimVerdict;
  /** 0-1 similarity to the best-matching source line. Diagnostic only. */
  score: number;
  provenance: "resume" | "edit_note" | "none";
  /** The closest line from the source, so the UI can show "this came from that". */
  sourceQuote: string | null;
  /** The exact facts that could not be found. Empty unless verdict is "unsupported". */
  unsupportedFacts: string[];
  /** One plain-English sentence for the UI. */
  reason: string;
}

export interface DraftVerification {
  method: "deterministic";
  checkedAt: string;
  totals: {
    claims: number;
    grounded: number;
    reworded: number;
    fromNote: number;
    disclaimed: number;
    subjective: number;
    unsupported: number;
  };
  claims: VerifiedClaim[];
  /** Lines from the original resume that did not survive into the draft. */
  droppedFromOriginal: string[];
  thresholdsUsed: { high: number; low: number; minTokens: number };
}

export interface VerifyOptions {
  /**
   * The posting's job title. A cover letter legitimately repeats it ("I'm writing to
   * apply for the Data Analyst role") and those words will not be in the resume. Title
   * words are exempted ONLY inside application-framing sentences, so a fabricated
   * skill claim elsewhere is still caught even when the posting names that skill.
   */
  jobTitle?: string;
  /**
   * Which document this is. A cover letter and a resume have different rules about
   * what counts as an outside fact:
   *  - "resume": everything is a claim about the candidate. The posting is NOT a source.
   *  - "letter": naming the employer, product or team you are writing TO is normal and
   *    correct. Those names come from the posting and will never be on the resume.
   */
  kind?: "resume" | "letter";
  /**
   * The posting text. Used ONLY for kind "letter", and ONLY on sentences that are not
   * first-person experience claims — so "I'd love to join Northwind Commerce" is fine
   * while "I built Tableau dashboards" is still flagged even when the posting says
   * Tableau. Without that split, quoting the posting would become a laundering route
   * for fabricated experience.
   */
  jobText?: string;
  /** At/above this similarity a claim counts as "grounded". */
  highThreshold?: number;
  /** At/above this similarity a claim counts as "reworded". */
  lowThreshold?: number;
  /** Units with fewer content tokens than this are treated as structural. */
  minTokens?: number;
}

const DEFAULTS = { highThreshold: 0.72, lowThreshold: 0.4, minTokens: 4 };

/**
 * "I am writing to apply for the X role", "regarding the X position". Sentences of this
 * shape name the job, not the candidate's experience — they assert nothing checkable
 * about the person, so repeating the posting's own title in them is not fabrication.
 */
/**
 * Does this sentence assert something the CANDIDATE did or has? Those are the sentences
 * a hiring manager can check against a reference, and the only ones where an outside
 * name must not be borrowed from the job posting.
 *
 * "I built Power BI dashboards at Meridian"      -> yes, an experience claim.
 * "Northwind's focus on experimentation appeals" -> no, it is about the employer.
 */
function isExperienceClaim(text: string): boolean {
  return (
    /\b(i|we)\s+(?:have\s+|had\s+|has\s+)?(?:also\s+|already\s+|personally\s+|recently\s+)?(built|create[d]?|led|manage[d]?|develop(ed)?|design(ed)?|implement(ed)?|automat(ed|e)|wrote|written|analy[sz]ed|deliver(ed)?|own(ed)?|ship(ped)?|maintain(ed)?|use[d]?|using|work(ed)?|spent|earn(ed)?|hold|held|achiev(ed)?|increas(ed)?|reduc(ed)?|improv(ed)?|support(ed)?|cleaned|merged|migrat(ed)?)\b/i.test(
      text
    ) ||
    /\bmy\s+(experience|work|background|role|time|training|expertise|skills?)\b/i.test(text) ||
    /\b(i\s+am|i'm)\s+(experienced|proficient|skilled|fluent|comfortable|familiar)\b/i.test(text)
  );
}

/**
 * The clause of a sentence that actually contains the given word. Splitting on commas,
 * semicolons, dashes and coordinating conjunctions is crude but enough to stop one
 * clause's "I built..." from making the rest of the sentence strict.
 */
function clauseContaining(text: string, word: string): string {
  const parts = text.split(/[;,]\s+(?:and\s+|but\s+|while\s+)?|\s+[—–-]\s+|\s+(?:and|but|while|whereas)\s+/i);
  const hit = parts.find((p) => p.toLowerCase().includes(word.toLowerCase()));
  return hit && hit.trim().length > 0 ? hit : text;
}

function isApplicationFraming(text: string): boolean {
  return /\b(writing to apply|apply(ing)? for|application for|interest(ed)? in|regarding|in response to|excited to apply|submit(ting)? my|seeking a|seeking the|targeting a|pursuing a)\b/i.test(
    text
  );
}

// ---------------------------------------------------------------- normalising

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\*\*/g, "")
    .replace(/[^\w\s%$./+-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWORDS = new Set(
  ("a an and are as at be been by for from had has have i in into is it its me my of on or " +
    "our so that the their there these they this to was were where which who will with " +
    "you your we us can able across also more most over under using used use while within")
    .split(" ")
);

function contentTokens(s: string): string[] {
  return norm(s)
    .split(" ")
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function shingles(s: string, n = 5): Set<string> {
  const t = norm(s);
  const out = new Set<string>();
  for (let i = 0; i + n <= t.length; i += 1) out.add(t.slice(i, i + n));
  return out;
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0) return 0;
  let hit = 0;
  for (const x of a) if (b.has(x)) hit += 1;
  return hit / a.size;
}

// ---------------------------------------------------------------- hard facts
//
// A "hard fact" is something a human would call a lie if it were not true: a number, a
// named tool or employer, a credential. These are what we actually check.

/** Numbers, percentages, money and durations, normalised so "2" == "2.0" == "~2". */
function extractNumbers(text: string): string[] {
  const out: string[] = [];
  for (const m of norm(text).matchAll(/(\d+(?:\.\d+)?)\s*(%|percent)?/g)) {
    const value = parseFloat(m[1]);
    if (!Number.isFinite(value)) continue;
    // Skip bare small ordinals that are almost always formatting noise.
    out.push(m[2] ? `${value}%` : String(value));
  }
  return [...new Set(out)];
}

/**
 * Entity-looking tokens: capitalised words (not sentence-initial) and all-caps acronyms.
 * Sentence-initial words are skipped because "Built ..." vs "Created ..." is rewording,
 * not fabrication — exactly the false alarm this whole design exists to avoid.
 */
function extractEntities(text: string): string[] {
  const stripped = text.replace(/\*\*/g, "");
  const out: string[] = [];
  // Split into sentence-ish spans so we can skip each one's first word.
  for (const span of stripped.split(/(?<=[.!?:;|])\s+|\n/)) {
    const words = span.trim().split(/\s+/);
    words.forEach((raw, idx) => {
      // Strip surrounding punctuation AND the possessive, so "Commerce's" is
      // recognised as the same name as "Commerce".
      const w = raw
        .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9+#]+$/g, "")
        .replace(/['’]s$/i, "");
      if (w.length < 2) return;
      const isAcronym = /^[A-Z][A-Z0-9+#]{1,}$/.test(w);
      const isCapitalised = /^[A-Z][a-z]+/.test(w);
      if (isAcronym) {
        out.push(w.toLowerCase());
        return;
      }
      // Skip the first word of a span — capitalisation there is grammatical.
      if (idx === 0) return;
      if (isCapitalised) out.push(w.toLowerCase());
    });
  }
  return [...new Set(out)];
}

/**
 * Crude suffix stemmer. Exists so "automation" is recognised as supported by a resume
 * that says "Automated", and "reporting" by "reports". Word-form differences are
 * rewording, not fabrication, and flagging them is the fastest way to make the whole
 * panel worthless.
 */
function stem(w: string): string {
  return w.replace(/(ations?|ation|ising|izing|ised|ized|ings?|ing|ers?|ed|es|s)$/i, "");
}

/**
 * Resume shorthand that a drafting model routinely expands. "State University Econ Dept"
 * legitimately becomes "Economics Department" - the same fact, spelled out. Treating
 * that as a fabricated entity is the kind of false alarm that makes the panel useless.
 */
const ABBREVIATIONS: Record<string, string[]> = {
  dept: ["department", "departmental"],
  econ: ["economics", "economic"],
  univ: ["university"],
  mgmt: ["management"],
  admin: ["administration", "administrative"],
  ops: ["operations", "operational"],
  stats: ["statistics", "statistical"],
  eng: ["engineering", "engineer"],
  tech: ["technology", "technical"],
  corp: ["corporation", "corporate"],
  intl: ["international"],
  sr: ["senior"],
  jr: ["junior"],
  bs: ["bachelor", "bachelors"],
  ms: ["master", "masters"],
  ba: ["bachelor", "bachelors"],
};

/** True when some corpus token is the same word in a different form. */
function morphologicallyPresent(
  word: string,
  corpusStems: Set<string>,
  corpusTokens?: Set<string>
): boolean {
  // Abbreviation in the resume, spelled out in the draft (or the reverse).
  if (corpusTokens) {
    for (const [abbr, expansions] of Object.entries(ABBREVIATIONS)) {
      if (corpusTokens.has(abbr) && expansions.includes(word)) return true;
      if (expansions.some((e) => corpusTokens.has(e)) && word === abbr) return true;
    }
    // NOTE: deliberately NO generic "corpus token is a prefix of the draft token" rule.
    // It looks reasonable and is a trap: a resume saying "reporting table" would make
    // the fabricated skill "Tableau" pass, which is precisely the claim this whole
    // module exists to catch. Abbreviations are handled by the explicit map only.
  }
  const s = stem(word);
  if (s.length < 4) return false;
  if (corpusStems.has(s)) return true;
  // Prefix agreement of 6+ chars covers pairs the suffix list misses.
  for (const c of corpusStems) {
    if (c.length >= 6 && s.length >= 6 && (c.startsWith(s.slice(0, 6)) || s.startsWith(c.slice(0, 6)))) {
      return true;
    }
  }
  return false;
}

/**
 * True when the sentence names a skill in order to DISCLAIM it — "I have not yet worked
 * with Tableau", "no direct experience with Spark, but I'm eager to learn". The drafting
 * prompt explicitly asks for these, so flagging them as fabrication would punish the
 * model for being honest and train the user to ignore the panel.
 */
function isDisclaimer(text: string): boolean {
  // "I have not worked with X", "no direct experience with X"
  const negatedExperience =
    /\b(no|not|never|yet to|little|limited|haven'?t|hasn'?t|don'?t|without)\b[^.!?]{0,60}\b(experience|worked|used|using|exposure|hands-on|background|familiar)\b/i.test(
      text
    ) ||
    /\b(experience|worked|used|exposure|familiar)\b[^.!?]{0,40}\b(is|has been)\s+limited\b/i.test(
      text
    );

  // "eager to learn X", "keen to pick up X", "looking forward to deepening X".
  // DRAFT_SYSTEM_PROMPT explicitly instructs the model to express willingness for
  // missing skills, so this sentence shape is expected output, not fabrication.
  const willingness =
    /\b(eager|excited|keen|willing|ready|motivated|happy|glad|look(ing)?\s+forward|plan|hope|intend)\b[^.!?]{0,40}\bto\s+\w+/i.test(
      text
    ) ||
    /\b(pick(ing)?\s+up|get(ting)?\s+up\s+to\s+speed|ramp(ing)?\s+up|com(e|ing)\s+up\s+to\s+speed|learn(ing)?|deepen(ing)?|expand(ing)?|strengthen(ing)?|grow(ing)?\s+into|develop(ing)?\s+(into|my)|build(ing)?\s+on)\b/i.test(
      text
    );

  return negatedExperience || willingness;
}

/** Common capitalised words that are not entities, to keep noise down. */
const NON_ENTITY = new Set(
  ("i im ive dear sincerely regards hiring manager team role position company summary " +
    "skills experience education certifications projects present current seeking looking " +
    "january february march april may june july august september october november december " +
    "jan feb mar apr jun jul aug sep sept oct nov dec monday friday")
    .split(" ")
);

// ---------------------------------------------------------------- segmenting

interface Unit {
  text: string;
  structural: boolean;
  /**
   * The part of the line that actually asserts something, used for fact extraction.
   * On a skills line like `**Query & Programming:** SQL, Python`, the bolded label is
   * an organising header the model invented — it claims nothing about the candidate.
   * Only what follows the colon is a claim.
   */
  factText: string;
}

function segment(draft: string): Unit[] {
  const units: Unit[] = [];
  for (const rawLine of draft.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    // Markdown headings, horizontal rules and ALL-CAPS section labels.
    if (/^#{1,6}\s/.test(line) || /^-{3,}$/.test(line) || /^[A-Z][A-Z\s&]{3,}$/.test(line)) {
      units.push({ text: line, structural: true, factText: line });
      continue;
    }
    // Contact lines: several fields separated by pipes, or an email/phone/url line.
    if (
      (line.split("|").length >= 3 && line.length < 160) ||
      /@[\w.-]+\.\w+|linkedin\.com|github\.com|^\(?\d{3}\)?[\s.-]?\d{3}/.test(line)
    ) {
      units.push({ text: line, structural: true, factText: line });
      continue;
    }
    // Letter openings and sign-offs.
    if (/^(dear\b|sincerely|best regards|kind regards|warm regards|thank you\b)/i.test(line)) {
      units.push({ text: line, structural: true, factText: line });
      continue;
    }

    const body = line.replace(/^[-*•]\s+/, "");
    // Split long prose into sentences; keep bullets and short lines whole.
    const pieces =
      body.length > 220
        ? body.split(/(?<=[.!?])\s+(?=[A-Z])/).filter(Boolean)
        : [body];
    for (const p of pieces) {
      const t = p.trim();
      // Drop a leading "**Category:**" / "Category:" label before fact extraction.
      const factText = t.replace(/^\*{0,2}[A-Za-z][A-Za-z0-9 &/+-]{0,40}\*{0,2}\s*:\s*/, "");
      units.push({ text: t, structural: false, factText: factText || t });
    }
  }
  return units;
}

/**
 * Source lines worth comparing against. Resume markdown is often hard-wrapped
 * mid-sentence, so continuation lines are re-joined first — otherwise a single resume
 * sentence is split across two "lines", neither of which matches the draft well, and
 * both get reported as "dropped".
 */
function sourceLines(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/^[-*•#]+\s*/, "").trim();
    if (!line) continue;
    const prev = out[out.length - 1];
    const isContinuation =
      prev &&
      !/[.!?:;]$/.test(prev) &&
      !/^#/.test(raw) &&
      !/^[-*•]/.test(raw.trim()) &&
      !/^\*\*/.test(line);
    if (isContinuation) out[out.length - 1] = `${prev} ${line}`;
    else out.push(line);
  }
  return out;
}

// ---------------------------------------------------------------- the pass

export function verifyDraft(
  draftText: string,
  resumeText: string,
  editNote: string | null,
  options: VerifyOptions = {}
): DraftVerification {
  const { highThreshold, lowThreshold, minTokens } = { ...DEFAULTS, ...options };

  const resumeLines = sourceLines(resumeText);
  const noteLines = editNote ? sourceLines(editNote) : [];
  const resumeShingles = resumeLines.map((l) => shingles(l));
  const noteShingles = noteLines.map((l) => shingles(l));

  // Corpus used for hard-fact lookups: the whole of both sources, normalised.
  const resumeCorpus = norm(resumeText);
  const noteCorpus = editNote ? norm(editNote) : "";
  const corpusNumbers = new Set([
    ...extractNumbers(resumeText),
    ...(editNote ? extractNumbers(editNote) : []),
  ]);
  const corpusTokens = new Set([
    ...contentTokens(resumeText),
    ...(editNote ? contentTokens(editNote) : []),
  ]);
  const corpusStems = new Set([...corpusTokens].map(stem));
  // Both the whole lowercased title and its individual words, so a hyphenated or
  // compound token ("Senior-ish", "Full-Stack") matches as well as a bare word.
  const titleNorm = (options.jobTitle ?? "").toLowerCase();
  const titleTokens = new Set(titleNorm.split(/[^a-z0-9+#]+/).filter(Boolean));
  const inJobTitle = (e: string) =>
    titleTokens.has(e) || (titleNorm.length > 0 && titleNorm.includes(e));

  // Cover-letter-only: names taken from the posting (employer, product, team, the
  // role itself). Legitimate to mention when writing TO that employer, but never
  // usable to support a first-person claim about what the candidate has done.
  const isLetter = options.kind === "letter";
  const postingNorm = isLetter ? norm(options.jobText ?? "") : "";
  const postingTokens = new Set(
    postingNorm ? contentTokens(options.jobText ?? "") : []
  );
  const postingNumbers = new Set(postingNorm ? extractNumbers(options.jobText ?? "") : []);

  const claims: VerifiedClaim[] = [];
  const matchedSourceIdx = new Set<number>();
  let id = 0;

  for (const unit of segment(draftText)) {
    id += 1;
    const tokens = contentTokens(unit.text);

    if (unit.structural || tokens.length < minTokens) {
      claims.push({
        id,
        text: unit.text,
        verdict: "structural",
        score: 1,
        provenance: "resume",
        sourceQuote: null,
        unsupportedFacts: [],
        reason: "Formatting or contact detail — nothing to fact-check.",
      });
      continue;
    }

    // --- best fuzzy match against each source, separately ---
    const unitShingles = shingles(unit.text);
    const unitTokenSet = new Set(tokens);

    function best(lines: string[], shingleSets: Set<string>[]) {
      let bestScore = 0;
      let bestLine: string | null = null;
      for (let i = 0; i < lines.length; i += 1) {
        const containment = overlap(unitShingles, shingleSets[i]);
        const srcTokens = new Set(contentTokens(lines[i]));
        let hit = 0;
        for (const t of unitTokenSet) if (srcTokens.has(t)) hit += 1;
        const recall = unitTokenSet.size ? hit / unitTokenSet.size : 0;
        const score = 0.5 * containment + 0.5 * recall;
        if (score > bestScore) {
          bestScore = score;
          bestLine = lines[i];
        }
      }
      return { score: bestScore, line: bestLine };
    }

    const fromResume = best(resumeLines, resumeShingles);
    const fromNote = noteLines.length ? best(noteLines, noteShingles) : { score: 0, line: null };

    if (fromResume.line) {
      const idx = resumeLines.indexOf(fromResume.line);
      if (idx >= 0 && fromResume.score >= lowThreshold) matchedSourceIdx.add(idx);
    }

    // --- hard facts: the ONLY thing allowed to raise a flag ---
    const unsupportedFacts: string[] = [];
    let hardFactCount = 0;

    // Declared up here because the number check needs it too: a cover letter may cite
    // the employer's own published figures ("a 900-person company"), which are in the
    // posting and will never be on the resume.
    const mayCitePosting = isLetter && !isExperienceClaim(unit.text);
    for (const n of extractNumbers(unit.factText)) {
      hardFactCount += 1;
      if (corpusNumbers.has(n)) continue;
      if (mayCitePosting && postingNumbers.has(n)) continue;
      unsupportedFacts.push(n.includes("%") ? n : `the figure ${n}`);
    }
    const framing = isApplicationFraming(unit.text);
    for (const e of extractEntities(unit.factText)) {
      if (NON_ENTITY.has(e)) continue;
      // The posting's own job title, quoted back in an "applying for ..." sentence.
      if (framing && inJobTitle(e)) continue;
      // Compound sentences mix the two kinds: "I hold a B.S. from State University,
      // and your Atlanta office is a short walk from me." The first clause is a claim
      // about the candidate; the second is about the employer. Judge the CLAUSE the
      // name actually sits in, or a single "and" turns the whole sentence strict and
      // the employer's own city gets flagged as an invention.
      if (
        isLetter &&
        (postingTokens.has(e) || postingNorm.includes(e)) &&
        !isExperienceClaim(clauseContaining(unit.text, e))
      ) {
        continue;
      }
      hardFactCount += 1;
      if (corpusTokens.has(e)) continue;
      if (resumeCorpus.includes(e) || (noteCorpus && noteCorpus.includes(e))) continue;
      // Same word, different form ("automation" vs "Automated") is rewording.
      if (morphologicallyPresent(e, corpusStems, corpusTokens)) continue;
      unsupportedFacts.push(`"${e}"`);
    }

    // A sentence that names a skill in order to say the candidate does NOT have it is
    // the honest gap-acknowledgement the drafting prompt asks for — not a claim.
    if (unsupportedFacts.length > 0 && isDisclaimer(unit.text)) {
      claims.push({
        id,
        text: unit.text,
        verdict: "disclaimed",
        score: Math.max(fromResume.score, fromNote.score),
        provenance: "resume",
        sourceQuote: null,
        unsupportedFacts: [],
        reason: `Names ${unsupportedFacts.join(", ")} in order to state you do NOT have it yet — a disclaimer, not a claim of experience.`,
      });
      continue;
    }

    if (unsupportedFacts.length > 0) {
      claims.push({
        id,
        text: unit.text,
        verdict: "unsupported",
        score: Math.max(fromResume.score, fromNote.score),
        provenance: "none",
        sourceQuote: fromResume.line,
        unsupportedFacts,
        reason: `${unsupportedFacts.join(", ")} ${
          unsupportedFacts.length === 1 ? "does" : "do"
        } not appear anywhere in your resume${editNote ? " or your note" : ""}.`,
      });
      continue;
    }

    // --- no unsourced facts: fuzzy similarity now only decides HOW to clear it ---
    const noteWins = fromNote.score > fromResume.score && fromNote.score >= lowThreshold;
    if (noteWins) {
      claims.push({
        id,
        text: unit.text,
        verdict: "from_your_note",
        score: fromNote.score,
        provenance: "edit_note",
        sourceQuote: fromNote.line,
        unsupportedFacts: [],
        reason: "Written from the experience you supplied in your note.",
      });
      continue;
    }

    if (fromResume.score >= highThreshold) {
      claims.push({
        id,
        text: unit.text,
        verdict: "grounded",
        score: fromResume.score,
        provenance: "resume",
        sourceQuote: fromResume.line,
        unsupportedFacts: [],
        reason: "Closely matches a line in your resume.",
      });
      continue;
    }

    if (fromResume.score >= lowThreshold) {
      claims.push({
        id,
        text: unit.text,
        verdict: "reworded",
        score: fromResume.score,
        provenance: "resume",
        sourceQuote: fromResume.line,
        unsupportedFacts: [],
        reason: "Rephrased from your resume — same facts, different wording.",
      });
      continue;
    }

    // Below the rewording threshold. Two very different cases live down here:
    if (hardFactCount > 0) {
      // It DID state checkable facts and every one of them was found in the source.
      // The wording has drifted far from any single resume line (the model merged or
      // heavily restructured it), but nothing in it is unsourced. That is verified
      // content, not an unknown — calling it "subjective" would be a lie.
      claims.push({
        id,
        text: unit.text,
        verdict: "reworded",
        score: fromResume.score,
        provenance: "resume",
        sourceQuote: fromResume.line,
        unsupportedFacts: [],
        reason: `Rewritten in the model's own words, but every specific in it (${hardFactCount} checked) appears in your resume.`,
      });
      continue;
    }

    // Genuinely no checkable fact: enthusiasm, framing, "I am excited by...".
    // Honest-but-generic. Its own quiet bucket, never the red panel.
    claims.push({
      id,
      text: unit.text,
      verdict: "subjective",
      score: fromResume.score,
      provenance: "none",
      sourceQuote: null,
      unsupportedFacts: [],
      reason: "Opinion or framing, not a factual claim — states nothing to verify.",
    });
  }

  // --- what got left behind ---
  const droppedFromOriginal = resumeLines.filter((line, i) => {
    if (matchedSourceIdx.has(i)) return false;
    if (contentTokens(line).length < 5) return false; // headings, labels, short lines
    return true;
  });

  const totals = {
    claims: claims.filter((c) => c.verdict !== "structural").length,
    grounded: claims.filter((c) => c.verdict === "grounded").length,
    reworded: claims.filter((c) => c.verdict === "reworded").length,
    fromNote: claims.filter((c) => c.verdict === "from_your_note").length,
    disclaimed: claims.filter((c) => c.verdict === "disclaimed").length,
    subjective: claims.filter((c) => c.verdict === "subjective").length,
    unsupported: claims.filter((c) => c.verdict === "unsupported").length,
  };

  return {
    method: "deterministic",
    checkedAt: new Date().toISOString(),
    totals,
    claims,
    droppedFromOriginal,
    thresholdsUsed: { high: highThreshold, low: lowThreshold, minTokens },
  };
}
