// Optional LLM-backed semantic skill/requirement matching. This module is
// deliberately isolated from the rest of the agent: it is a TOOL the agent can
// call for one specific sub-task (identifying which posting requirements the
// resume demonstrates), never a decision-maker. It has no ability to approve,
// reject, draft, or skip any step — those remain deterministic code in
// agent.ts, untouched by anything this module returns.
//
// The actual model ("brain") is swappable via the LLM_PROVIDER env var
// ("anthropic", "deepseek", or "custom" = any OpenAI-compatible endpoint) without touching agent.ts or any API
// route — they only ever call the functions exported from this file, never a
// provider file directly. See src/lib/llm/types.ts for the shared contract
// every provider implements.
//
// If no provider is configured, or the call fails/times out for any reason,
// callers are expected to fall back to the deterministic keyword matcher —
// see performFitEvaluation() in agent.ts. The app must keep working with zero
// LLM calls, exactly as it did before this file existed.

import { anthropicProvider } from "./llm/anthropicProvider";
import { customProvider, deepseekProvider } from "./llm/deepseekProvider";
import type { LlmCallOptions, LlmFitResult, LlmPostingAssessment, LlmProvider } from "./llm/types";

export type { LlmFitResult, LlmMatch } from "./llm/types";
export type { LlmDraftResult, LlmGapNote } from "./llm/types";

const PROVIDERS: Record<string, LlmProvider> = {
  anthropic: anthropicProvider,
  deepseek: deepseekProvider,
  custom: customProvider,
};

// LLM_PROVIDER picks explicitly (set it to switch the "brain" at any time,
// e.g. LLM_PROVIDER=deepseek or LLM_PROVIDER=anthropic). With no explicit
// choice, whichever provider has an API key present wins, checked in this
// order — so setting exactly one key "just works" with no other config.
const AUTO_DETECT_ORDER = ["deepseek", "anthropic", "custom"];

function selectProvider(): LlmProvider | null {
  const explicit = process.env.LLM_PROVIDER?.toLowerCase();
  if (explicit) {
    const provider = PROVIDERS[explicit];
    if (provider) return provider;
  }
  for (const name of AUTO_DETECT_ORDER) {
    if (PROVIDERS[name].isConfigured()) return PROVIDERS[name];
  }
  return null;
}

export function isLlmConfigured(): boolean {
  const provider = selectProvider();
  return !!provider && provider.isConfigured();
}

export function getModelName(): string {
  const provider = selectProvider();
  return provider ? `${provider.name}:${provider.model}` : "none";
}

// Observations about the posting itself (injection attempts, work arrangement,
// clearance). The agent's gates decide; this only reports, and callers verify
// every quote against the posting text before trusting it.
export async function assessPostingWithLlm(
  jobText: string,
  opts?: LlmCallOptions
): Promise<LlmPostingAssessment> {
  const provider = selectProvider();
  if (!provider) throw new Error("No LLM provider configured.");
  return provider.assessPosting(jobText, opts);
}

export async function evaluateFitWithLlm(
  resumeText: string,
  jobText: string,
  opts?: LlmCallOptions
): Promise<LlmFitResult> {
  const provider = selectProvider();
  if (!provider) throw new Error("No LLM provider configured.");
  return provider.evaluateFit(resumeText, jobText, opts);
}

// A minimal call used ONLY when a human explicitly clicks "Test connection" on
// the system-status panel — never automatically on page load, so simply
// viewing the dashboard never spends a token.
export async function testLlmConnection(): Promise<{ ok: boolean; message: string }> {
  const provider = selectProvider();
  if (!provider) return { ok: false, message: "No LLM provider configured (set ANTHROPIC_API_KEY or DEEPSEEK_API_KEY)." };
  return provider.testConnection();
}

// Called ONLY after human Approve/Edit — drafts a real cover letter and
// tailored resume grounded in the evidence quotes already verified against
// resume.md. Falls back to null if no LLM is configured, so the agent
// code can still produce the old deterministic bullet-point draft.
export async function draftApplicationMaterials(
  matchedEvidence: Record<string, string>,
  missingSkills: string[],
  jobText: string,
  resumeText: string,
  editNote: string | null,
  opts?: LlmCallOptions
): Promise<import("./llm/types").LlmDraftResult | null> {
  const provider = selectProvider();
  if (!provider) return null;
  try {
    return await provider.draftApplicationMaterials(matchedEvidence, missingSkills, jobText, resumeText, editNote, opts);
  } catch (err) {
    console.error("[LLM Draft] Failed, falling back to deterministic draft:", err);
    return null;
  }
}
