import Anthropic from "@anthropic-ai/sdk";
import {
  REWRITE_JSON_SCHEMA,
  REWRITE_SYSTEM_PROMPT,
  REWRITE_TOOL_DESCRIPTION,
  REWRITE_TOOL_NAME,
  rewriteUserPrompt,
  type LlmBulletRewrite,
  ADVISE_JSON_SCHEMA,
  ADVISE_SYSTEM_PROMPT,
  ADVISE_TOOL_DESCRIPTION,
  ADVISE_TOOL_NAME,
  type LlmAdvice,
  CONTROL_JSON_SCHEMA,
  CONTROL_SYSTEM_PROMPT,
  CONTROL_TOOL_DESCRIPTION,
  CONTROL_TOOL_NAME,
  type LlmActionChoice,
  ASSESS_JSON_SCHEMA,
  ASSESS_SYSTEM_PROMPT,
  ASSESS_TOOL_DESCRIPTION,
  ASSESS_TOOL_NAME,
  assessUserPrompt,
  type LlmPostingAssessment,
  FIT_JSON_SCHEMA,
  FIT_SYSTEM_PROMPT,
  FIT_TOOL_DESCRIPTION,
  FIT_TOOL_NAME,
  DRAFT_JSON_SCHEMA,
  DRAFT_SYSTEM_PROMPT,
  DRAFT_TOOL_DESCRIPTION,
  DRAFT_TOOL_NAME,
  draftUserPrompt,
  MAX_INPUT_CHARS,
  TIMEOUT_MS,
  userPrompt,
  type LlmFitResult,
  type LlmDraftResult,
  type LlmProvider,
} from "./types";

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    // Org-level admin API keys aren't scoped to one workspace and are rejected
    // unless the request names which workspace to use. A standard
    // workspace-scoped developer key (the normal kind you get from a
    // Workspace's "API Keys" tab rather than the org-wide Admin API Keys page)
    // doesn't need this at all — ANTHROPIC_WORKSPACE_ID is optional.
    const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;
    client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      defaultHeaders: workspaceId ? { "anthropic-workspace-id": workspaceId } : undefined,
    });
  }
  return client;
}

export const anthropicProvider: LlmProvider = {
  name: "anthropic",
  model: MODEL,

  isConfigured() {
    return !!process.env.ANTHROPIC_API_KEY;
  },

  async assessPosting(jobText, opts) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await getClient().messages.create(
        {
          model: MODEL,
          max_tokens: 2000,
          temperature: 0,
          system: opts?.systemPrompt ?? ASSESS_SYSTEM_PROMPT,
          tools: [
            { name: ASSESS_TOOL_NAME, description: ASSESS_TOOL_DESCRIPTION, input_schema: ASSESS_JSON_SCHEMA },
          ],
          tool_choice: { type: "tool", name: ASSESS_TOOL_NAME },
          messages: [{ role: "user", content: assessUserPrompt(jobText) }],
        },
        { signal: controller.signal }
      );
      const toolUse = response.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );
      if (!toolUse) throw new Error("Anthropic response did not include the expected assessment tool call.");
      return toolUse.input as LlmPostingAssessment;
    } finally {
      clearTimeout(timeout);
    }
  },

  async rewriteBullets(bullets, jobTitle, mirror, opts) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 30000);
    try {
      const response = await getClient().messages.create(
        {
          model: MODEL,
          max_tokens: 4000,
          temperature: 0.6,
          system: opts?.systemPrompt ?? REWRITE_SYSTEM_PROMPT,
          tools: [{ name: REWRITE_TOOL_NAME, description: REWRITE_TOOL_DESCRIPTION, input_schema: REWRITE_JSON_SCHEMA }],
          tool_choice: { type: "tool", name: REWRITE_TOOL_NAME },
          messages: [{ role: "user", content: rewriteUserPrompt(bullets, jobTitle, mirror) }],
        },
        { signal: controller.signal }
      );
      const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (!toolUse) throw new Error("Anthropic response did not include the expected rewrite tool call.");
      return toolUse.input as LlmBulletRewrite;
    } finally {
      clearTimeout(timeout);
    }
  },

  async adviseHuman(situation, opts) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 30000);
    try {
      const response = await getClient().messages.create(
        {
          model: MODEL,
          max_tokens: 3000,
          temperature: 0,
          system: opts?.systemPrompt ?? ADVISE_SYSTEM_PROMPT,
          tools: [{ name: ADVISE_TOOL_NAME, description: ADVISE_TOOL_DESCRIPTION, input_schema: ADVISE_JSON_SCHEMA }],
          tool_choice: { type: "tool", name: ADVISE_TOOL_NAME },
          messages: [{ role: "user", content: situation }],
        },
        { signal: controller.signal }
      );
      const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (!toolUse) throw new Error("Anthropic response did not include the expected advice tool call.");
      return toolUse.input as LlmAdvice;
    } finally {
      clearTimeout(timeout);
    }
  },

  async chooseAction(situation, opts) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts?.timeoutMs ?? TIMEOUT_MS);
    try {
      const response = await getClient().messages.create(
        {
          model: MODEL,
          max_tokens: 200,
          temperature: 0,
          system: opts?.systemPrompt ?? CONTROL_SYSTEM_PROMPT,
          tools: [
            { name: CONTROL_TOOL_NAME, description: CONTROL_TOOL_DESCRIPTION, input_schema: CONTROL_JSON_SCHEMA },
          ],
          tool_choice: { type: "tool", name: CONTROL_TOOL_NAME },
          messages: [{ role: "user", content: situation }],
        },
        { signal: controller.signal }
      );
      const toolUse = response.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );
      if (!toolUse) throw new Error("Anthropic response did not include the expected action tool call.");
      return toolUse.input as LlmActionChoice;
    } finally {
      clearTimeout(timeout);
    }
  },

  async evaluateFit(resumeText, jobText, opts) {
    const cap = opts?.maxInputChars ?? MAX_INPUT_CHARS;
    const resume = resumeText.slice(0, cap);
    const job = jobText.slice(0, cap);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await getClient().messages.create(
        {
          model: MODEL,
          max_tokens: 2000,
          system: opts?.systemPrompt ?? FIT_SYSTEM_PROMPT,
          tools: [
            {
              name: FIT_TOOL_NAME,
              description: FIT_TOOL_DESCRIPTION,
              input_schema: FIT_JSON_SCHEMA,
            },
          ],
          tool_choice: { type: "tool", name: FIT_TOOL_NAME },
          messages: [{ role: "user", content: userPrompt(resume, job) }],
        },
        { signal: controller.signal }
      );

      const toolUse = response.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );
      if (!toolUse) throw new Error("Anthropic response did not include the expected structured tool call.");
      return toolUse.input as LlmFitResult;
    } finally {
      clearTimeout(timeout);
    }
  },

  async draftApplicationMaterials(matchedEvidence, missingSkills, jobText, resumeText, editNote, opts) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await getClient().messages.create(
        {
          model: MODEL,
          max_tokens: 4000,
          system: opts?.systemPrompt ?? DRAFT_SYSTEM_PROMPT,
          tools: [
            {
              name: DRAFT_TOOL_NAME,
              description: DRAFT_TOOL_DESCRIPTION,
              input_schema: DRAFT_JSON_SCHEMA,
            },
          ],
          tool_choice: { type: "tool", name: DRAFT_TOOL_NAME },
          messages: [{ role: "user", content: draftUserPrompt(matchedEvidence, missingSkills, jobText, resumeText, editNote) }],
        },
        { signal: controller.signal }
      );

      const toolUse = response.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );
      if (!toolUse) throw new Error("Anthropic response did not include the expected structured draft tool call.");
      return toolUse.input as LlmDraftResult;
    } finally {
      clearTimeout(timeout);
    }
  },

  async testConnection() {
    if (!this.isConfigured()) return { ok: false, message: "No ANTHROPIC_API_KEY configured." };
    try {
      await getClient().messages.create({
        model: MODEL,
        max_tokens: 5,
        messages: [{ role: "user", content: "Reply with: OK" }],
      });
      return { ok: true, message: `Connected (${MODEL}).` };
    } catch (err) {
      return { ok: false, message: String(err).slice(0, 200) };
    }
  },
};
