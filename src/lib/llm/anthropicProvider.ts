import Anthropic from "@anthropic-ai/sdk";
import {
  FIT_JSON_SCHEMA,
  FIT_SYSTEM_PROMPT,
  FIT_TOOL_DESCRIPTION,
  FIT_TOOL_NAME,
  MAX_INPUT_CHARS,
  TIMEOUT_MS,
  userPrompt,
  type LlmFitResult,
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

  async evaluateFit(resumeText, jobText) {
    const resume = resumeText.slice(0, MAX_INPUT_CHARS);
    const job = jobText.slice(0, MAX_INPUT_CHARS);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await getClient().messages.create(
        {
          model: MODEL,
          max_tokens: 700,
          system: FIT_SYSTEM_PROMPT,
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
