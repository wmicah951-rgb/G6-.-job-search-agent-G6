import OpenAI from "openai";
import {
  ASSESS_JSON_SCHEMA,
  ASSESS_SYSTEM_PROMPT,
  ASSESS_TOOL_DESCRIPTION,
  ASSESS_TOOL_NAME,
  assessUserPrompt,
  DRAFT_JSON_SCHEMA,
  DRAFT_SYSTEM_PROMPT,
  DRAFT_TOOL_DESCRIPTION,
  DRAFT_TOOL_NAME,
  draftUserPrompt,
  FIT_JSON_SCHEMA,
  FIT_SYSTEM_PROMPT,
  FIT_TOOL_DESCRIPTION,
  FIT_TOOL_NAME,
  MAX_INPUT_CHARS,
  TIMEOUT_MS,
  userPrompt,
  type LlmDraftResult,
  type LlmFitResult,
  type LlmPostingAssessment,
  type LlmProvider,
} from "./types";

// One implementation for EVERY OpenAI-compatible chat API (DeepSeek, OpenAI,
// Groq, Together, OpenRouter, local Ollama/LM Studio, ...). A provider is just
// a name, a base URL, a key and a model — so swapping the "brain" is env vars,
// never code. Structured output uses forced tool-calling, and falls back to
// JSON mode for models that don't support it, so the agent behaves the same.

export interface CompatConfig {
  name: string;
  isConfigured: () => boolean;
  apiKey: () => string;
  baseURL: () => string;
  model: () => string;
}

function parseJsonLoose<T>(content: string | null | undefined): T {
  if (!content) throw new Error("Model returned an empty response.");
  const cleaned = content.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Model response contained no JSON object.");
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}

export function makeOpenAiCompatProvider(cfg: CompatConfig): LlmProvider {
  function client(): OpenAI {
    return new OpenAI({ apiKey: cfg.apiKey() || "none", baseURL: cfg.baseURL() });
  }

  async function callStructured<T>(
    system: string,
    user: string,
    toolName: string,
    toolDescription: string,
    schema: object,
    maxTokens: number,
    timeoutMs: number
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const c = client();
    try {
      try {
        const r = await c.chat.completions.create(
          {
            model: cfg.model(),
            max_tokens: maxTokens,
            temperature: 0,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
            tools: [
              {
                type: "function",
                function: { name: toolName, description: toolDescription, parameters: schema as Record<string, unknown> },
              },
            ],
            tool_choice: { type: "function", function: { name: toolName } },
          },
          { signal: controller.signal }
        );
        const msg = r.choices[0]?.message;
        const call = msg?.tool_calls?.[0];
        if (call && call.type === "function") return JSON.parse(call.function.arguments) as T;
        if (msg?.content) return parseJsonLoose<T>(msg.content);
      } catch (err) {
        if (controller.signal.aborted) throw err;
        // fall through to JSON mode
      }
      const r2 = await c.chat.completions.create(
        {
          model: cfg.model(),
          max_tokens: maxTokens,
          temperature: 0,
          messages: [
            {
              role: "system",
              content:
                system +
                "\n\nRespond with ONLY a JSON object (no prose, no code fences) matching this JSON Schema:\n" +
                JSON.stringify(schema),
            },
            { role: "user", content: user },
          ],
          response_format: { type: "json_object" },
        },
        { signal: controller.signal }
      );
      return parseJsonLoose<T>(r2.choices[0]?.message?.content);
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    name: cfg.name,
    get model() {
      return cfg.model();
    },

    isConfigured: cfg.isConfigured,

    assessPosting(jobText) {
      return callStructured<LlmPostingAssessment>(
        ASSESS_SYSTEM_PROMPT,
        assessUserPrompt(jobText),
        ASSESS_TOOL_NAME,
        ASSESS_TOOL_DESCRIPTION,
        ASSESS_JSON_SCHEMA,
        600,
        TIMEOUT_MS
      );
    },

    evaluateFit(resumeText, jobText) {
      return callStructured<LlmFitResult>(
        FIT_SYSTEM_PROMPT,
        userPrompt(resumeText.slice(0, MAX_INPUT_CHARS), jobText.slice(0, MAX_INPUT_CHARS)),
        FIT_TOOL_NAME,
        FIT_TOOL_DESCRIPTION,
        FIT_JSON_SCHEMA,
        1200,
        TIMEOUT_MS
      );
    },

    draftApplicationMaterials(matchedEvidence, missingSkills, jobText, resumeText, editNote) {
      return callStructured<LlmDraftResult>(
        DRAFT_SYSTEM_PROMPT,
        draftUserPrompt(matchedEvidence, missingSkills, jobText, resumeText, editNote),
        DRAFT_TOOL_NAME,
        DRAFT_TOOL_DESCRIPTION,
        DRAFT_JSON_SCHEMA,
        3000,
        45000
      );
    },

    async testConnection() {
      if (!cfg.isConfigured()) return { ok: false, message: `${cfg.name}: not configured.` };
      try {
        await client().chat.completions.create({
          model: cfg.model(),
          max_tokens: 5,
          messages: [{ role: "user", content: "Reply with: OK" }],
        });
        return { ok: true, message: `Connected (${cfg.model()}).` };
      } catch (err) {
        return { ok: false, message: String(err).slice(0, 200) };
      }
    },
  };
}
