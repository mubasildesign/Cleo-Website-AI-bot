import { PROVIDER_IDS, detectProvider, providerById } from "./providers.js";
import { LENGTHS, PERSONA_IDS, TONES } from "./personas.js";

export const FIELDS = {
  name: { type: "text", max: 80, value: "" },
  provider: { type: "enum", options: PROVIDER_IDS, value: "openai" },
  baseUrl: { type: "baseUrl", value: "https://api.openai.com/v1" },
  model: { type: "text", max: 120, value: "gpt-4o-mini" },
  fallbackModel: { type: "text", max: 120, value: "" },

  persona: { type: "enum", options: PERSONA_IDS, value: "general" },
  companyName: { type: "text", max: 80, value: "" },
  tone: { type: "enum", options: TONES.map((item) => item.id), value: "friendly" },
  length: { type: "enum", options: LENGTHS.map((item) => item.id), value: "balanced" },
  language: { type: "text", max: 40, value: "auto", fallback: true },
  instructions: { type: "text", max: 3000, value: "" },
  restrictToSite: { type: "bool", value: true },
  ctaLabel: { type: "text", max: 40, value: "" },
  ctaUrl: { type: "url", value: "" },

  agentName: { type: "text", max: 40, value: "Cleo", fallback: true },
  agentRole: { type: "text", max: 60, value: "AI assistant" },
  avatarUrl: { type: "url", value: "" },
  greeting: { type: "text", max: 160, value: "Hi there. What can I help you find?", fallback: true },
  intro: { type: "text", max: 300, value: "Ask me anything about this site. I have read every page." },
  suggestions: { type: "list", max: 80, count: 6, value: ["What do you do?", "Who is this for?", "How do I get started?"] },
  primaryColor: { type: "color", value: "#18181b" },
  theme: { type: "enum", options: ["light", "dark", "auto"], value: "light" },
  position: { type: "enum", options: ["right", "left"], value: "right" },
  launcherStyle: { type: "enum", options: ["icon", "label"], value: "icon" },
  launcherLabel: { type: "text", max: 30, value: "Ask us anything", fallback: true },
  corners: { type: "enum", options: ["round", "soft", "sharp"], value: "round" },
  font: { type: "enum", options: ["system", "site"], value: "system" },
  nudge: { type: "text", max: 140, value: "" },
  nudgeDelay: { type: "int", min: 0, max: 120, value: 8 },
  showSources: { type: "bool", value: true },
  showBranding: { type: "bool", value: true },

  extraKnowledge: { type: "text", max: 30000, value: "", multiline: true },
  maxPages: { type: "int", min: 5, max: 300, value: 80 }
};

export const WIDGET_FIELDS = [
  "agentName",
  "agentRole",
  "avatarUrl",
  "greeting",
  "intro",
  "suggestions",
  "primaryColor",
  "theme",
  "position",
  "launcherStyle",
  "launcherLabel",
  "corners",
  "font",
  "nudge",
  "nudgeDelay",
  "showSources",
  "showBranding",
  "ctaLabel",
  "ctaUrl"
];

function clone(value) {
  return Array.isArray(value) ? [...value] : value;
}

export function defaults() {
  return Object.fromEntries(Object.entries(FIELDS).map(([key, field]) => [key, clone(field.value)]));
}

function cleanUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}

export function cleanBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let url;
  try {
    url = new URL(raw);
  } catch {
    return "";
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !local) return "";
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

function sanitizeField(field, value, current) {
  switch (field.type) {
    case "text": {
      const text = field.multiline
        ? String(value ?? "").slice(0, field.max)
        : String(value ?? "").replace(/\s+/g, " ").trim().slice(0, field.max);
      return !text.trim() && field.fallback ? clone(field.value) : text;
    }
    case "enum":
      return field.options.includes(value) ? value : current ?? field.value;
    case "bool":
      return Boolean(value);
    case "int": {
      const number = Math.round(Number(value));
      if (!Number.isFinite(number)) return current ?? field.value;
      return Math.min(field.max, Math.max(field.min, number));
    }
    case "color":
      return /^#[0-9a-fA-F]{6}$/.test(String(value)) ? String(value).toLowerCase() : current ?? field.value;
    case "url":
      return cleanUrl(value);
    case "baseUrl":
      return cleanBaseUrl(value) || current || field.value;
    case "list": {
      const source = Array.isArray(value) ? value : String(value || "").split("\n");
      return source
        .map((item) => String(item || "").replace(/\s+/g, " ").trim().slice(0, field.max))
        .filter(Boolean)
        .slice(0, field.count);
    }
    default:
      return current;
  }
}

export function applyPatch(site, input) {
  for (const [key, field] of Object.entries(FIELDS)) {
    if (input[key] === undefined) continue;
    site[key] = sanitizeField(field, input[key], site[key]);
  }
  return site;
}

export function withDefaults(site) {
  const next = { ...defaults(), ...site };
  if (!site.agentName || site.agentName === "Axon") next.agentName = "Cleo";
  if (!site.provider) {
    const detected = detectProvider(site.apiKey);
    if (detected && detected !== "openai") {
      const preset = providerById(detected);
      next.provider = detected;
      if (!site.baseUrl || site.baseUrl === "https://api.openai.com/v1") next.baseUrl = preset.baseUrl;
      if (!site.model || site.model === "gpt-4o-mini") next.model = preset.model;
      if (!site.fallbackModel && preset.fallbackModel) next.fallbackModel = preset.fallbackModel;
    }
  }
  return next;
}

export function widgetSettings(site) {
  return Object.fromEntries(WIDGET_FIELDS.map((key) => [key, site[key]]));
}
