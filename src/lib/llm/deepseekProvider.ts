import OpenAI from "openai";
import {
  FIT_JSON_SCHEMA,
  FIT_SYSTEM_PROMPT,
  FIT_TOOL_DESCRIPTION,
  FIT_TOOL_NAME,
  DRAFT_JSON_SCHEMA,
  DRAFT_SYSTEM_PROMPT,
  DRAFT_TOOL_DESCRIPTION,
  DRAFT_TOOL_NAME,
  draftUserPrompt,
  userPrompt,
  MAX_INPUT_CHARS,
  TIMEOUT_MS,
  type LlmFitResult,
  type LlmDraftResult,
  type LlmProvider,
} from "./types";

// DeepSeek's API is OpenAI-compatible, so the official `openai` SDK works
// unmodified — just pointed at DeepSeek's base URL with a DeepSeek key.
// deepseek-chat (V3, non-reasoning) is used by default rather than
// deepseek-reasoner, since this is a single structured-extraction call with
// no need for extended chain-of-thought.
const MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: "https://api.deepseek.com",
    });
  }
  return client;
}

export const deepseekProvider: LlmProvider = {
  name: "deepseek",
  model: MODEL,

  isConfigured() {
    return !!process.env.DEEPSEEK_API_KEY;
  },

  async evaluateFit(resumeText, jobText) {
    const resume = resumeText.slice(0, MAX_INPUT_CHARS);
    const job = jobText.slice(0, MAX_INPUT_CHARS);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await getClient().chat.completions.create(
        {
          model: MODEL,
          max_tokens: 700,
          messages: [
            { role: "system", content: FIT_SYSTEM_PROMPT },
            { role: "user", content: userPrompt(resume, job) },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: FIT_TOOL_NAME,
                description: FIT_TOOL_DESCRIPTION,
                parameters: FIT_JSON_SCHEMA,
              },
            },
          ],
          tool_choice: { type: "function", function: { name: FIT_TOOL_NAME } },
        },
        { signal: controller.signal }
      );

      const toolCall = response.choices[0]?.message?.tool_calls?.[0];
      if (!toolCall || toolCall.type !== "function") {
        throw new Error("DeepSeek response did not include the expected structured tool call.");
      }
      return JSON.parse(toolCall.function.arguments) as LlmFitResult;
    } finally {
      clearTimeout(timeout);
    }
  },

  async draftApplicationMaterials(matchedEvidence, missingSkills, jobText, resumeText, editNote) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // drafting can take longer
    try {
      const response = await getClient().chat.completions.create(
        {
          model: MODEL,
          max_tokens: 2500,
          messages: [
            { role: "system", content: DRAFT_SYSTEM_PROMPT },
            { role: "user", content: draftUserPrompt(matchedEvidence, missingSkills, jobText, resumeText, editNote) },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: DRAFT_TOOL_NAME,
                description: DRAFT_TOOL_DESCRIPTION,
                parameters: DRAFT_JSON_SCHEMA,
              },
            },
          ],
          tool_choice: { type: "function", function: { name: DRAFT_TOOL_NAME } },
        },
        { signal: controller.signal }
      );

      const toolCall = response.choices[0]?.message?.tool_calls?.[0];
      if (!toolCall || toolCall.type !== "function") {
        throw new Error("DeepSeek response did not include the expected structured draft tool call.");
      }
      return JSON.parse(toolCall.function.arguments) as LlmDraftResult;
    } finally {
      clearTimeout(timeout);
    }
  },

  async testConnection() {
    if (!this.isConfigured()) return { ok: false, message: "No DEEPSEEK_API_KEY configured." };
    try {
      await getClient().chat.completions.create({
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
