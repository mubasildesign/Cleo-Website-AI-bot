import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyPatch, defaults, withDefaults } from "./schema.js";

const DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DIR, "sites.json");
const KEY = "axon:sites";

let queue = Promise.resolve();
const knowledgeCache = new Map();

function useKv() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

function enqueue(task) {
  const run = queue.then(task, task);
  queue = run.then(() => {}, () => {});
  return run;
}

async function kv(command) {
  const response = await fetch(process.env.KV_REST_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command)
  });
  if (!response.ok) throw new Error("Could not reach the site store.");
  const data = await response.json();
  return data.result;
}

async function readJson(kvKey, file) {
  try {
    const raw = useKv() ? await kv(["GET", kvKey]) : await readFile(file, "utf8");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function writeJson(kvKey, file, data) {
  const body = JSON.stringify(data);
  if (useKv()) {
    await kv(["SET", kvKey, body]);
    return;
  }
  if (process.env.VERCEL) {
    throw new Error("Set KV_REST_API_URL and KV_REST_API_TOKEN to save data on Vercel.");
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, body);
}

async function readStore() {
  const data = await readJson(KEY, FILE);
  const sites = Array.isArray(data?.sites) ? data.sites : [];
  return { sites: sites.map(withDefaults) };
}

function writeStore(data) {
  return writeJson(KEY, FILE, data);
}

export function normalizeDomain(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withProtocol).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function originAllowed(origin, domain) {
  if (!origin || !domain) return false;
  let host = "";
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host.replace(/^www\./, "") === domain.toLowerCase().replace(/^www\./, "");
}

export function publicSite(site) {
  const { apiKey, ...rest } = site;
  return {
    ...rest,
    hasKey: Boolean(apiKey),
    keyHint: apiKey ? `••••${apiKey.slice(-4)}` : ""
  };
}

export async function listSites() {
  return (await readStore()).sites;
}

export async function findByKey(publicKey) {
  const sites = await listSites();
  return sites.find((site) => site.publicKey === publicKey) || null;
}

export async function findById(id) {
  const sites = await listSites();
  return sites.find((site) => site.id === id) || null;
}

export async function createSite(input) {
  const domain = normalizeDomain(input.domain);
  if (!domain) throw new Error("Enter a site URL or domain.");
  return enqueue(async () => {
    const store = await readStore();
    if (store.sites.some((site) => site.domain === domain)) {
      throw new Error("That domain is already added.");
    }
    const site = {
      ...defaults(),
      id: randomUUID(),
      domain,
      publicKey: `axon_${randomBytes(12).toString("hex")}`,
      apiKey: "",
      createdAt: new Date().toISOString()
    };
    applyPatch(site, { name: input.name || domain });
    if (!site.name) site.name = domain;
    store.sites.unshift(site);
    await writeStore(store);
    return site;
  });
}

export async function updateSite(id, input) {
  return enqueue(async () => {
    const store = await readStore();
    const site = store.sites.find((item) => item.id === id);
    if (!site) throw new Error("Site not found.");
    if (input.domain != null) {
      const domain = normalizeDomain(input.domain);
      if (!domain) throw new Error("Enter a site URL or domain.");
      if (store.sites.some((item) => item.domain === domain && item.id !== id)) {
        throw new Error("That domain is already added.");
      }
      site.domain = domain;
    }
    applyPatch(site, input);
    if (!site.name) site.name = site.domain;
    if (typeof input.apiKey === "string" && input.apiKey.trim()) site.apiKey = input.apiKey.trim().slice(0, 400);
    if (input.clearKey) site.apiKey = "";
    await writeStore(store);
    return site;
  });
}

export async function setKnowledgeMeta(id, meta) {
  return enqueue(async () => {
    const store = await readStore();
    const site = store.sites.find((item) => item.id === id);
    if (!site) throw new Error("Site not found.");
    site.knowledge = { ...(site.knowledge || {}), ...meta };
    await writeStore(store);
    return site;
  });
}

export async function deleteSite(id) {
  await enqueue(async () => {
    const store = await readStore();
    const next = store.sites.filter((site) => site.id !== id);
    if (next.length === store.sites.length) throw new Error("Site not found.");
    await writeStore({ sites: next });
  });
  knowledgeCache.delete(id);
  if (useKv()) await kv(["DEL", `axon:kb:${id}`]).catch(() => {});
  else await rm(path.join(DIR, "kb", `${id}.json`), { force: true }).catch(() => {});
}

export async function saveKnowledge(id, data) {
  await writeJson(`axon:kb:${id}`, path.join(DIR, "kb", `${id}.json`), data);
  knowledgeCache.set(id, { data, at: Date.now() });
}

export async function loadKnowledge(id) {
  const cached = knowledgeCache.get(id);
  if (cached && Date.now() - cached.at < 60_000) return cached.data;
  const data = (await readJson(`axon:kb:${id}`, path.join(DIR, "kb", `${id}.json`))) || { pages: [], chunks: [] };
  knowledgeCache.set(id, { data, at: Date.now() });
  return data;
}
