export const PROVIDERS = [
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    keyHint: "sk-...",
    docs: "https://platform.openai.com/api-keys"
  },
  {
    id: "gemini",
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-3.5-flash",
    fallbackModel: "gemini-flash-lite-latest",
    extra: { reasoning_effort: "low" },
    keyHint: "AIza... or AQ...",
    docs: "https://aistudio.google.com/apikey"
  },
  {
    id: "anthropic",
    label: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-haiku-4-5",
    keyHint: "sk-ant-...",
    docs: "https://console.anthropic.com/settings/keys"
  },
  {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
    keyHint: "gsk_...",
    docs: "https://console.groq.com/keys"
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o-mini",
    keyHint: "sk-or-...",
    docs: "https://openrouter.ai/keys"
  },
  {
    id: "mistral",
    label: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    model: "mistral-small-latest",
    keyHint: "",
    docs: "https://console.mistral.ai/api-keys"
  },
  {
    id: "custom",
    label: "Custom",
    baseUrl: "",
    model: "",
    keyHint: "",
    docs: ""
  }
];

export const PROVIDER_IDS = PROVIDERS.map((provider) => provider.id);

export function providerById(id) {
  return PROVIDERS.find((provider) => provider.id === id) || PROVIDERS[0];
}

export function detectProvider(key = "") {
  const value = String(key).trim();
  if (!value) return "";
  if (value.startsWith("sk-ant-")) return "anthropic";
  if (value.startsWith("sk-or-")) return "openrouter";
  if (value.startsWith("gsk_")) return "groq";
  if (value.startsWith("AIza") || value.startsWith("AQ.")) return "gemini";
  if (value.startsWith("sk-")) return "openai";
  return "";
}
