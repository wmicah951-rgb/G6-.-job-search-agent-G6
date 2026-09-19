import { makeOpenAiCompatProvider } from "./openaiCompatProvider";

// DeepSeek is just an OpenAI-compatible endpoint. deepseek-chat (non-reasoning)
// is the default: every call here is a short structured extraction.
export const deepseekProvider = makeOpenAiCompatProvider({
  name: "deepseek",
  isConfigured: () => !!process.env.DEEPSEEK_API_KEY,
  apiKey: () => process.env.DEEPSEEK_API_KEY ?? "",
  baseURL: () => "https://api.deepseek.com",
  model: () => process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
});

// Any other OpenAI-compatible model, configured purely by env vars:
//   LLM_BASE_URL (e.g. https://api.openai.com/v1, https://api.groq.com/openai/v1,
//   http://localhost:11434/v1 for Ollama), LLM_API_KEY, LLM_MODEL.
// Select with LLM_PROVIDER=custom.
//
// LOCAL MODELS NEED NO API KEY. Ollama and llama.cpp ignore it entirely, so requiring
// one here meant the natural Ollama config (base URL + model, no key) left the agent
// reporting "not configured" and silently falling back to keyword matching while the
// status panel still showed the model name — connected-looking and not connected.
// A base URL plus a model is therefore sufficient; the placeholder key below exists
// only because the OpenAI SDK refuses to construct a client without a non-empty string.
export const customProvider = makeOpenAiCompatProvider({
  name: "custom",
  isConfigured: () =>
    !!process.env.LLM_MODEL && (!!process.env.LLM_API_KEY || !!process.env.LLM_BASE_URL),
  apiKey: () => process.env.LLM_API_KEY || "not-needed-for-local-models",
  baseURL: () => process.env.LLM_BASE_URL ?? "https://api.openai.com/v1",
  model: () => process.env.LLM_MODEL ?? "",
});
