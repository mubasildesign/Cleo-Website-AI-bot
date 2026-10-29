import {
  createSite,
  deleteSite,
  findById,
  findByKey,
  listSites,
  loadKnowledge,
  originAllowed,
  publicSite,
  saveKnowledge,
  setKnowledgeMeta,
  updateSite
} from "./store.js";
import {
  applyCors,
  clearCookie,
  clientIp,
  isAuthed,
  json,
  limited,
  passwordsMatch,
  preflight,
  query,
  readBody,
  requestHost,
  requestOrigin,
  sessionCookie
} from "./http.js";
import { crawlSite } from "./crawl.js";
import { notesKnowledge, search } from "./search.js";
import { buildPrompt, pageContext } from "./prompt.js";
import { complete, listModels, stream } from "./model.js";
import { cleanBaseUrl, widgetSettings } from "./schema.js";
import { providerById } from "./providers.js";

const UNAVAILABLE = "Sorry, I cannot answer right now. Please try again in a moment.";

function method(req) {
  return String(req.method || "GET").toUpperCase();
}

function clip(value, max) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function hostName(value) {
  const raw = String(value || "").split(",")[0].trim();
  if (!raw) return "";
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return raw.split(":")[0].toLowerCase();
  }
}

function fromDashboard(req) {
  if (!isAuthed(req)) return false;
  const origin = requestOrigin(req);
  if (!origin) return true;
  const apiHost = hostName(requestHost(req));
  return Boolean(apiHost) && hostName(origin) === apiHost;
}

function requestAllowed(req, site) {
  return originAllowed(requestOrigin(req), site.domain) || fromDashboard(req);
}

function messages(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((item) => item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
    .slice(-10)
    .map((item) => ({ role: item.role, content: item.content.trim().slice(0, 2000) }))
    .filter((item) => item.content);
}

function requireAdmin(req, res) {
  if (isAuthed(req)) return true;
  json(res, 401, { error: "Sign in required." });
  return false;
}

export async function login(req, res) {
  if (method(req) !== "POST") return json(res, 405, { error: "POST only." });
  try {
    const body = await readBody(req);
    if (limited(`login:${clientIp(req)}`, 10)) return json(res, 429, { error: "Too many attempts. Wait a minute." });
    if (!passwordsMatch(body.password || "")) return json(res, 401, { error: "Wrong password." });
    json(res, 200, { ok: true }, { "Set-Cookie": sessionCookie() });
  } catch (error) {
    json(res, 400, { error: error.message || "Could not sign in." });
  }
}

export async function logout(req, res) {
  if (method(req) !== "POST") return json(res, 405, { error: "POST only." });
  json(res, 200, { ok: true }, { "Set-Cookie": clearCookie() });
}

export async function session(req, res) {
  json(res, 200, { ok: isAuthed(req) });
}

export async function sites(req, res) {
  if (!requireAdmin(req, res)) return;
  try {
    if (method(req) === "GET") {
      const all = await listSites();
      return json(res, 200, { sites: all.map(publicSite) });
    }
    const body = await readBody(req);
    if (method(req) === "POST") return json(res, 201, { site: publicSite(await createSite(body)) });
    if (method(req) === "PATCH") return json(res, 200, { site: publicSite(await updateSite(body.id, body)) });
    if (method(req) === "DELETE") {
      await deleteSite(body.id);
      return json(res, 200, { ok: true });
    }
    return json(res, 405, { error: "Method not allowed." });
  } catch (error) {
    return json(res, 400, { error: error.message || "Could not save the site." });
  }
}

export async function crawl(req, res) {
  if (!requireAdmin(req, res)) return;
  if (method(req) !== "POST") return json(res, 405, { error: "POST only." });
  let id = "";
  try {
    const body = await readBody(req);
    id = body.id;
    const site = await findById(id);
    if (!site) return json(res, 404, { error: "Site not found." });
    await setKnowledgeMeta(id, { status: "syncing", startedAt: new Date().toISOString(), error: "" });
    const result = await crawlSite(site.domain, { maxPages: site.maxPages || 80 });
    if (!result.pages.length) throw new Error(`No readable pages found on ${site.domain}. Sites that render only with JavaScript cannot be read yet.`);
    await saveKnowledge(id, { pages: result.pages, chunks: result.chunks, origin: result.origin });
    const updated = await setKnowledgeMeta(id, {
      status: "ready",
      pages: result.pages.length,
      chunks: result.chunks.length,
      chars: result.stats.chars,
      ms: result.stats.ms,
      updatedAt: new Date().toISOString(),
      error: ""
    });
    return json(res, 200, { site: publicSite(updated), pages: result.pages, stats: result.stats });
  } catch (error) {
    if (id) await setKnowledgeMeta(id, { status: "error", error: error.message }).catch(() => {});
    return json(res, 400, { error: error.message || "Could not read the site." });
  }
}

export async function knowledge(req, res) {
  if (!requireAdmin(req, res)) return;
  const id = query(req).get("id");
  const site = await findById(id);
  if (!site) return json(res, 404, { error: "Site not found." });
  const kb = await loadKnowledge(id);
  return json(res, 200, { pages: kb.pages || [], meta: site.knowledge || null });
}

export async function testAi(req, res) {
  if (!requireAdmin(req, res)) return;
  if (method(req) !== "POST") return json(res, 405, { error: "POST only." });
  try {
    const body = await readBody(req);
    const saved = await findById(body.id);
    if (!saved) return json(res, 404, { error: "Site not found." });
    const provider = body.provider || saved.provider;
    const draft = {
      ...saved,
      provider,
      apiKey: String(body.apiKey || "").trim() || saved.apiKey,
      baseUrl: cleanBaseUrl(body.baseUrl) || saved.baseUrl || providerById(provider).baseUrl,
      model: clip(body.model, 120) || saved.model,
      fallbackModel: body.fallbackModel !== undefined ? clip(body.fallbackModel, 120) : saved.fallbackModel
    };
    if (!draft.apiKey) return json(res, 200, { ok: false, error: "Paste an API key first." });
    const started = Date.now();
    const [reply, models] = await Promise.all([
      complete(draft, [{ role: "user", content: "Reply with one short friendly sentence confirming you are connected." }]).catch((error) => error),
      listModels(draft)
    ]);
    if (reply instanceof Error) {
      return json(res, 200, { ok: false, status: reply.status || 0, error: reply.message, models });
    }
    return json(res, 200, { ok: true, ms: Date.now() - started, reply, models });
  } catch (error) {
    return json(res, 200, { ok: false, error: error.message || "Test failed." });
  }
}

export async function bootstrap(req, res) {
  applyCors(req, res);
  if (method(req) === "OPTIONS") return preflight(res);
  if (method(req) !== "POST") return json(res, 405, { error: "POST only." });
  try {
    const body = await readBody(req);
    const site = await findByKey(clip(body.siteKey, 80));
    if (!site) return json(res, 404, { error: "Unknown site." });
    if (!requestAllowed(req, site)) return json(res, 403, { error: "This widget is not allowed on this site." });
    return json(res, 200, { settings: widgetSettings(site), ready: Boolean(site.apiKey) });
  } catch (error) {
    return json(res, 400, { error: error.message || "Could not load the widget." });
  }
}

async function contextFor(site, history) {
  const kb = await loadKnowledge(site.id);
  const userTurns = history.filter((item) => item.role === "user").slice(-2).map((item) => item.content);
  const queryText = userTurns.join(" ");
  let hits = search(kb, queryText, 6);
  if (!hits.length && userTurns.length > 1) hits = search(kb, userTurns[userTurns.length - 1], 6);
  if (site.extraKnowledge) {
    const notes = search(notesKnowledge(site.extraKnowledge), queryText, 3);
    hits = [...notes, ...hits].slice(0, 8);
  }
  const pages = (kb.pages || []).slice(0, 60);
  return { hits, pages };
}

export async function chat(req, res) {
  applyCors(req, res);
  if (method(req) === "OPTIONS") return preflight(res);
  if (method(req) !== "POST") return json(res, 405, { text: UNAVAILABLE });

  let body;
  try {
    body = await readBody(req);
  } catch {
    return json(res, 400, { text: UNAVAILABLE });
  }
  const siteKey = clip(body.siteKey, 80);
  if (limited(`chat:${siteKey}:${clientIp(req)}`, 20) || limited(`chat:${siteKey}`, 400)) {
    return json(res, 429, { text: "Give me a moment, then try again." });
  }
  const site = await findByKey(siteKey).catch(() => null);
  if (!site || !requestAllowed(req, site)) return json(res, 403, { text: UNAVAILABLE, detail: "This site key is not allowed on this domain." });
  const history = messages(body.messages);
  if (!history.some((item) => item.role === "user")) return json(res, 400, { text: UNAVAILABLE });
  const debug = fromDashboard(req);
  if (!site.apiKey) {
    return json(res, 200, { text: UNAVAILABLE, detail: debug ? "No API key saved for this site." : undefined });
  }

  const { hits, pages } = await contextFor(site, history);
  const system = buildPrompt(site, { hits, pages, page: pageContext(body.page) });
  const prompt = [{ role: "system", content: system }, ...history];
  const sources = [];
  const seen = new Set();
  for (const hit of hits) {
    if (!hit.url || seen.has(hit.url)) continue;
    seen.add(hit.url);
    sources.push({ url: hit.url, title: hit.title });
    if (sources.length >= 3) break;
  }

  if (!body.stream) {
    try {
      const text = await complete(site, prompt);
      return json(res, 200, { text: text || UNAVAILABLE, sources });
    } catch (error) {
      console.error("[axon] model error:", error.message);
      return json(res, 200, { text: UNAVAILABLE, detail: debug ? error.message : undefined });
    }
  }

  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Accel-Buffering", "no");
  const send = (event) => {
    if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
  };
  send({ type: "sources", items: sources });
  try {
    let total = "";
    await stream(site, prompt, (delta) => {
      total += delta;
      send({ type: "delta", text: delta });
    }, { signal: controller.signal });
    if (!total.trim()) send({ type: "error", text: UNAVAILABLE, detail: debug ? "The model returned an empty reply." : undefined });
    send({ type: "done" });
  } catch (error) {
    if (!controller.signal.aborted) {
      console.error("[axon] model error:", error.message);
      send({ type: "error", text: UNAVAILABLE, detail: debug ? error.message : undefined });
    }
  } finally {
    res.end();
  }
}

export async function route(req, res) {
  const pathname = String(req.url || "").split("?")[0];
  const routes = {
    "/api/login": login,
    "/api/logout": logout,
    "/api/session": session,
    "/api/sites": sites,
    "/api/crawl": crawl,
    "/api/knowledge": knowledge,
    "/api/test-ai": testAi,
    "/api/bootstrap": bootstrap,
    "/api/chat": chat
  };
  const handler = routes[pathname];
  if (!handler) return json(res, 404, { error: "Not found." });
  return handler(req, res);
}
