import OpenAI from "openai";
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
  type LlmActionChoice,
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
    timeoutMs: number,
    temperature = 0
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
            temperature,
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
          temperature,
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

    assessPosting(jobText, opts) {
      return callStructured<LlmPostingAssessment>(
        opts?.systemPrompt ?? ASSESS_SYSTEM_PROMPT,
        assessUserPrompt(jobText, opts?.maxInputChars),
        ASSESS_TOOL_NAME,
        ASSESS_TOOL_DESCRIPTION,
        ASSESS_JSON_SCHEMA,
        600,
        opts?.timeoutMs ?? TIMEOUT_MS
      );
    },

    evaluateFit(resumeText, jobText, opts) {
      const cap = opts?.maxInputChars ?? MAX_INPUT_CHARS;
      return callStructured<LlmFitResult>(
        opts?.systemPrompt ?? FIT_SYSTEM_PROMPT,
        userPrompt(resumeText.slice(0, cap), jobText.slice(0, cap)),
        FIT_TOOL_NAME,
        FIT_TOOL_DESCRIPTION,
        FIT_JSON_SCHEMA,
        1200,
        opts?.timeoutMs ?? TIMEOUT_MS
      );
    },

    rewriteBullets(bullets, jobTitle, mirror, opts) {
      return callStructured<LlmBulletRewrite>(
        opts?.systemPrompt ?? REWRITE_SYSTEM_PROMPT,
        rewriteUserPrompt(bullets, jobTitle, mirror),
        REWRITE_TOOL_NAME,
        REWRITE_TOOL_DESCRIPTION,
        REWRITE_JSON_SCHEMA,
        1500,
        opts?.timeoutMs ?? 30000,
        // A little sampling here only: at temperature 0 this model returns near-copies. Facts
        // stay protected by the harness's numbers check and the draft verifier, not by 0.
        0.6
      );
    },

    adviseHuman(situation, opts) {
      return callStructured<LlmAdvice>(
        opts?.systemPrompt ?? ADVISE_SYSTEM_PROMPT,
        situation,
        ADVISE_TOOL_NAME,
        ADVISE_TOOL_DESCRIPTION,
        ADVISE_JSON_SCHEMA,
        1400,
        opts?.timeoutMs ?? 30000
      );
    },

    async completeJson(system, user, maxTokens, timeoutMs) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const r = await client().chat.completions.create(
          {
            model: cfg.model(),
            max_tokens: maxTokens,
            temperature: 0,
            messages: [
              { role: "system", content: system + "\n\nRespond with ONLY a JSON object. No prose, no code fences." },
              { role: "user", content: user },
            ],
            response_format: { type: "json_object" },
          },
          { signal: controller.signal }
        );
        return parseJsonLoose<unknown>(r.choices[0]?.message?.content);
      } finally {
        clearTimeout(timeout);
      }
    },

    async chooseAction(situation, opts) {
      // SMALL-MODEL MODE. A weak local model is unreliable at tool calls but fine at picking a
      // number from a short list, so show a numbered menu and read back one digit.
      if (opts?.plainMenu && opts.plainMenu.length > 0) {
        const menu = opts.plainMenu;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? TIMEOUT_MS);
        try {
          const r = await client().chat.completions.create(
            {
              model: cfg.model(),
              max_tokens: 60,
              temperature: 0,
              messages: [
                { role: "system", content: (opts.systemPrompt ?? CONTROL_SYSTEM_PROMPT).slice(0, 3500) },
                {
                  role: "user",
                  content:
                    `${situation}\n\nPick the next action. Options:\n` +
                    menu.map((m, i) => `${i + 1}) ${m}`).join("\n") +
                    `\n\nReply with ONLY the option number, then a dash, then one short reason.`,
                },
              ],
            },
            { signal: controller.signal }
          );
          const text = r.choices[0]?.message?.content ?? "";
          const n = parseInt((text.match(/\d+/) ?? ["0"])[0], 10);
          const action = menu[n - 1];
          if (!action) throw new Error(`Model reply did not contain a valid option number: ${text.slice(0, 60)}`);
          return { action, reasoning: text.replace(/^\s*\d+\s*[).:-]?\s*[-–:]?\s*/, "").trim() };
        } finally {
          clearTimeout(timeout);
        }
      }
      return callStructured<LlmActionChoice>(
        opts?.systemPrompt ?? CONTROL_SYSTEM_PROMPT,
        situation,
        CONTROL_TOOL_NAME,
        CONTROL_TOOL_DESCRIPTION,
        CONTROL_JSON_SCHEMA,
        200,
        opts?.timeoutMs ?? TIMEOUT_MS
      );
    },

    draftApplicationMaterials(matchedEvidence, missingSkills, jobText, resumeText, editNote, opts) {
      return callStructured<LlmDraftResult>(
        opts?.systemPrompt ?? DRAFT_SYSTEM_PROMPT,
        draftUserPrompt(matchedEvidence, missingSkills, jobText, resumeText, editNote),
        DRAFT_TOOL_NAME,
        DRAFT_TOOL_DESCRIPTION,
        DRAFT_JSON_SCHEMA,
        3000,
        opts?.timeoutMs ?? 45000
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
