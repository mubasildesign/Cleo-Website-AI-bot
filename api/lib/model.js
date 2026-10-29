import { providerById } from "./providers.js";

const FIRST_BYTE_MS = 25_000;
const TOTAL_MS = 55_000;

export class ProviderError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function endpoint(site) {
  const base = String(site.baseUrl || providerById(site.provider).baseUrl || "").replace(/\/+$/, "");
  if (!base) throw new ProviderError(0, "Add a base URL for this provider.");
  return base;
}

function headers(site) {
  const out = {
    Authorization: `Bearer ${site.apiKey}`,
    "Content-Type": "application/json"
  };
  if (site.provider === "openrouter") {
    out["HTTP-Referer"] = `https://${site.domain}`;
    out["X-Title"] = "Cleo";
  }
  return out;
}

function payload(site, model, messages, streaming) {
  const preset = providerById(site.provider);
  return JSON.stringify({
    model,
    temperature: 0.4,
    messages,
    ...(preset.extra || {}),
    ...(streaming ? { stream: true } : {})
  });
}

function models(site) {
  return [...new Set([site.model, site.fallbackModel].map((item) => String(item || "").trim()).filter(Boolean))];
}

function retryable(error) {
  return error instanceof ProviderError && [0, 404, 408, 429, 500, 502, 503, 504].includes(error.status);
}

async function readError(response) {
  const raw = await response.text().catch(() => "");
  let message = "";
  try {
    const data = JSON.parse(raw);
    const node = Array.isArray(data) ? data[0] : data;
    message = node?.error?.message || node?.message || node?.error || "";
  } catch {
    message = raw;
  }
  message = String(message || response.statusText || "Request failed").replace(/\s+/g, " ").trim().slice(0, 400);
  const hints = {
    401: "The API key was rejected.",
    403: "The API key does not have access to this model.",
    404: "The model or base URL was not found.",
    429: "The provider is rate limiting or the quota is used up.",
    503: "The model is overloaded right now."
  };
  return new ProviderError(response.status, `${hints[response.status] ? `${hints[response.status]} ` : ""}${message}`);
}

export function cleanDashes(text) {
  return String(text || "").replace(/\s*[\u2014\u2013]\s*/g, ", ");
}

function timedSignal(outer) {
  const controller = new AbortController();
  let reason = null;
  const abort = (error) => {
    reason = error;
    controller.abort();
  };
  const firstByte = setTimeout(() => abort(new ProviderError(504, "The model took too long to respond.")), FIRST_BYTE_MS);
  const total = setTimeout(() => abort(new ProviderError(504, "The model took too long to finish.")), TOTAL_MS);
  const onOuter = () => abort(null);
  outer?.addEventListener("abort", onOuter);
  return {
    signal: controller.signal,
    started: () => clearTimeout(firstByte),
    reason: () => reason,
    done: () => {
      clearTimeout(firstByte);
      clearTimeout(total);
      outer?.removeEventListener("abort", onOuter);
    }
  };
}

async function request(site, model, messages, streaming, timer) {
  try {
    const response = await fetch(`${endpoint(site)}/chat/completions`, {
      method: "POST",
      headers: headers(site),
      body: payload(site, model, messages, streaming),
      signal: timer.signal
    });
    if (!response.ok) throw await readError(response);
    return response;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (timer.reason()) throw timer.reason();
    if (timer.signal.aborted) throw error;
    throw new ProviderError(0, `Could not reach the provider. ${error.message || ""}`.trim());
  }
}

function textOf(content) {
  return Array.isArray(content) ? content.map((part) => part.text || "").join("") : content || "";
}

async function completeOnce(site, model, messages, outer) {
  const timer = timedSignal(outer);
  try {
    const response = await request(site, model, messages, false, timer);
    timer.started();
    const data = await response.json();
    return cleanDashes(textOf(data.choices?.[0]?.message?.content)).trim();
  } catch (error) {
    if (timer.reason()) throw timer.reason();
    throw error;
  } finally {
    timer.done();
  }
}

async function streamOnce(site, model, messages, onDelta, outer) {
  const timer = timedSignal(outer);
  let full = "";
  try {
    const response = await request(site, model, messages, true, timer);
    if (!response.body) {
      timer.started();
      const data = await response.json();
      full = cleanDashes(textOf(data.choices?.[0]?.message?.content));
      if (full) onDelta(full);
      return full;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") return full;
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }
        if (parsed.error) throw new ProviderError(500, parsed.error.message || "The model stream failed.");
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          timer.started();
          const clean = cleanDashes(delta);
          full += clean;
          onDelta(clean);
        }
      }
    }
    return full;
  } catch (error) {
    if (timer.reason()) throw timer.reason();
    throw error;
  } finally {
    timer.done();
  }
}

export async function complete(site, messages, { signal } = {}) {
  let last;
  for (const model of models(site)) {
    try {
      return await completeOnce(site, model, messages, signal);
    } catch (error) {
      last = error;
      if (signal?.aborted || !retryable(error)) throw error;
    }
  }
  throw last || new ProviderError(0, "Choose a model first.");
}

export async function stream(site, messages, onDelta, { signal } = {}) {
  let last;
  for (const model of models(site)) {
    let sent = false;
    try {
      return await streamOnce(site, model, messages, (delta) => {
        sent = true;
        onDelta(delta);
      }, signal);
    } catch (error) {
      last = error;
      if (sent || signal?.aborted || !retryable(error)) throw error;
    }
  }
  throw last || new ProviderError(0, "Choose a model first.");
}

export async function listModels(site) {
  try {
    const response = await fetch(`${endpoint(site)}/models`, {
      headers: headers(site),
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) return [];
    const data = await response.json();
    const items = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];
    return items
      .map((item) => String(item.id || item.name || "").replace(/^models\//, ""))
      .filter(Boolean)
      .sort()
      .slice(0, 400);
  } catch {
    return [];
  }
}
