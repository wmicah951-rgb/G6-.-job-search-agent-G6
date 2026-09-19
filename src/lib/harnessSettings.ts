// The harness's tunable settings — what the /harness tab edits.
//
// TWO RULES MAKE THIS SAFE TO EXPOSE:
//
// 1. The DATABASE STORES ONLY OVERRIDES. Defaults live in code (below, referencing the
//    prompt constants in llm/types.ts). "Reset" is a DELETE, not a copy — so improving a
//    default in code automatically reaches every profile that has not overridden it, and
//    an empty table means "everything default".
//
// 2. ONLY FREE PROSE IS EDITABLE. The tool names and JSON schemas the model must fill in
//    are NOT exposed. A person can change what the model is told, never the shape of what
//    it must return — so a bad edit can degrade wording but cannot break parsing. And if
//    a prompt is bad enough that the model errors, performFitEvaluation() already falls
//    back to the deterministic keyword matcher (agent.ts), so the app keeps working.

import {
  ASSESS_SYSTEM_PROMPT,
  FIT_SYSTEM_PROMPT,
  DRAFT_SYSTEM_PROMPT,
  MAX_INPUT_CHARS,
  TIMEOUT_MS,
} from "./llm/types";

export interface HarnessSettings {
  /** Fallback fit bar, used ONLY when preferences.md has no "Minimum fit: N%" line. */
  lowFitThresholdDefault: number;
  /** Let the model read the posting for injection + work arrangement. */
  llmAssessmentEnabled: boolean;
  /** Allow the ASK_USER pause when the work arrangement cannot be determined. */
  askUserEnabled: boolean;
  /** Run the deterministic check over generated material. */
  draftVerificationEnabled: boolean;
  /** Similarity at/above which a drafted sentence counts as "from your resume". */
  verifyHighThreshold: number;
  /** Similarity at/above which a drafted sentence counts as "reworded". */
  verifyLowThreshold: number;
  llmTimeoutMs: number;
  llmMaxInputChars: number;
  prompts: {
    assess: string;
    fit: string;
    draft: string;
  };
}

export const DEFAULT_SETTINGS: HarnessSettings = {
  lowFitThresholdDefault: 0.6,
  llmAssessmentEnabled: true,
  askUserEnabled: true,
  draftVerificationEnabled: true,
  verifyHighThreshold: 0.72,
  verifyLowThreshold: 0.4,
  llmTimeoutMs: TIMEOUT_MS,
  llmMaxInputChars: MAX_INPUT_CHARS,
  prompts: {
    assess: ASSESS_SYSTEM_PROMPT,
    fit: FIT_SYSTEM_PROMPT,
    draft: DRAFT_SYSTEM_PROMPT,
  },
};

type Overrides = Record<string, unknown>;

/** Deep-merges stored overrides over the code defaults. */
export function resolveSettings(overrides: Overrides | null | undefined): HarnessSettings {
  if (!overrides) return DEFAULT_SETTINGS;
  const p = (overrides.prompts ?? {}) as Partial<HarnessSettings["prompts"]>;
  return {
    ...DEFAULT_SETTINGS,
    ...overrides,
    prompts: { ...DEFAULT_SETTINGS.prompts, ...p },
  } as HarnessSettings;
}

export interface ValidationOutcome {
  sanitized: Overrides;
  errors: string[];
  warnings: string[];
}

const NUMERIC_RANGES: Record<string, [number, number]> = {
  lowFitThresholdDefault: [0.1, 0.9],
  verifyHighThreshold: [0.3, 0.95],
  verifyLowThreshold: [0.1, 0.8],
  llmTimeoutMs: [3000, 60000],
  llmMaxInputChars: [2000, 40000],
};

/**
 * Clamps rather than rejects wherever it can — matching parseMinFit's existing
 * philosophy that a typo must not be able to disable a gate. Only a genuinely unusable
 * prompt (empty, or absurdly long) is refused outright, and Reset is always available.
 */
export function validateSettings(candidate: unknown): ValidationOutcome {
  const errors: string[] = [];
  const warnings: string[] = [];
  const sanitized: Overrides = {};
  if (!candidate || typeof candidate !== "object") {
    return { sanitized, errors: ["Settings must be an object."], warnings };
  }
  const input = candidate as Record<string, unknown>;

  for (const [key, [min, max]] of Object.entries(NUMERIC_RANGES)) {
    if (input[key] === undefined) continue;
    const n = Number(input[key]);
    if (!Number.isFinite(n)) {
      errors.push(`${key} must be a number.`);
      continue;
    }
    const clamped = Math.min(max, Math.max(min, n));
    if (clamped !== n) warnings.push(`${key} was clamped to ${clamped} (allowed ${min}–${max}).`);
    sanitized[key] = clamped;
  }

  for (const key of [
    "llmAssessmentEnabled",
    "askUserEnabled",
    "draftVerificationEnabled",
  ]) {
    if (input[key] !== undefined) sanitized[key] = !!input[key];
  }

  if (input.prompts && typeof input.prompts === "object") {
    const prompts: Record<string, string> = {};
    for (const [key, value] of Object.entries(input.prompts as Record<string, unknown>)) {
      if (!["assess", "fit", "draft"].includes(key)) continue;
      const text = String(value ?? "");
      if (!text.trim()) {
        errors.push(`The ${key} instructions cannot be empty. Use Reset to restore the default.`);
        continue;
      }
      if (text.length > 20000) {
        errors.push(`The ${key} instructions are too long (${text.length} characters, max 20000).`);
        continue;
      }
      if (text.trim() !== DEFAULT_SETTINGS.prompts[key as "assess" | "fit" | "draft"].trim()) {
        prompts[key] = text;
      }
    }
    if (Object.keys(prompts).length) sanitized.prompts = prompts;
  }

  // Cross-field sanity: "reworded" must be a lower bar than "from your resume".
  const hi = (sanitized.verifyHighThreshold ?? DEFAULT_SETTINGS.verifyHighThreshold) as number;
  const lo = (sanitized.verifyLowThreshold ?? DEFAULT_SETTINGS.verifyLowThreshold) as number;
  if (lo >= hi) {
    errors.push(
      `The "reworded" threshold (${lo}) must be below the "from your resume" threshold (${hi}).`
    );
  }

  return { sanitized, errors, warnings };
}

/** Which fields differ from the shipped defaults — drives the "modified" badges. */
export function modifiedKeys(overrides: Overrides | null | undefined): string[] {
  if (!overrides) return [];
  const out: string[] = [];
  for (const k of Object.keys(overrides)) {
    if (k === "prompts") {
      const p = overrides.prompts as Record<string, string>;
      for (const pk of Object.keys(p ?? {})) out.push(`prompts.${pk}`);
    } else {
      out.push(k);
    }
  }
  return out;
}
