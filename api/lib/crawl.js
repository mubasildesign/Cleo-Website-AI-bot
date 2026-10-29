import { createHash } from "node:crypto";

const UA = "Mozilla/5.0 (compatible; CleoBot/1.0; site knowledge sync)";
const SKIP = /\.(pdf|jpe?g|png|gif|webp|avif|svg|ico|css|js|mjs|json|xml|gz|zip|rar|mp4|mp3|mov|webm|wav|woff2?|ttf|otf|eot|txt|csv|docx?|xlsx?|pptx?|rss|atom)$/i;
const SKIP_PATH = /\/(wp-admin|wp-json|cart|checkout|account|login|signin|sign-in|logout|search|tag|author|feed)(\/|$)/i;
const MAX_TEXT_PER_PAGE = 20_000;
const MAX_TOTAL_TEXT = 800_000;
const CHUNK = 1100;

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', hellip: "...", mdash: "-", ndash: "-", copy: "(c)", reg: "(r)", trade: "(tm)", middot: "-", bull: "-" };

function decode(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeChar(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => safeChar(Number(num)))
    .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match);
}

function safeChar(code) {
  try {
    return String.fromCodePoint(code);
  } catch {
    return " ";
  }
}

function stripTags(html) {
  return decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function hostMatches(host, domain) {
  const clean = host.toLowerCase().replace(/^www\./, "");
  return clean === domain || clean.endsWith(`.${domain}`);
}

export function normalizeUrl(href, base, domain) {
  let url;
  try {
    url = new URL(href, base);
  } catch {
    return "";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "";
  if (!hostMatches(url.hostname, domain)) return "";
  if (SKIP.test(url.pathname) || SKIP_PATH.test(url.pathname)) return "";
  url.hash = "";
  url.search = "";
  url.hostname = url.hostname.toLowerCase();
  let pathname = url.pathname.replace(/\/{2,}/g, "/");
  if (pathname.length > 1) pathname = pathname.replace(/\/+$/, "");
  url.pathname = pathname;
  return url.href;
}

async function fetchText(url, accept = "text/html,application/xhtml+xml", timeout = 9000) {
  const response = await fetch(url, {
    headers: { "User-Agent": UA, Accept: accept },
    redirect: "follow",
    signal: AbortSignal.timeout(timeout)
  });
  const type = response.headers.get("content-type") || "";
  const text = response.ok ? await response.text() : "";
  return { ok: response.ok, status: response.status, type, text: text.slice(0, 2_500_000), url: response.url || url };
}

function faqFromJsonLd(html) {
  const out = [];
  const scripts = html.match(/<script[^>]+application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi) || [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node["@type"] === "Question" && node.name) {
      const answer = node.acceptedAnswer?.text || node.acceptedAnswer?.[0]?.text || "";
      out.push(`Q: ${stripTags(String(node.name))}\nA: ${stripTags(String(answer))}`);
    }
    Object.values(node).forEach(walk);
  };
  for (const script of scripts) {
    try {
      walk(JSON.parse(script.replace(/^<script[^>]*>|<\/script>$/gi, "")));
    } catch {
      continue;
    }
  }
  return out;
}

export function parsePage(html, url, domain) {
  const title = stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  const description = decode(
    html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1] ||
    html.match(/<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']*)["']/i)?.[1] ||
    ""
  ).trim();
  const noindex = /<meta[^>]+name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html);
  const faqs = faqFromJsonLd(html);

  const links = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)) {
    const next = normalizeUrl(decode(match[1]), url, domain);
    if (next) links.push(next);
  }

  let body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|canvas|head|select)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|footer)\b[\s\S]*?<\/\1>/gi, " ");
  const main = body.match(/<main\b[\s\S]*?<\/main>/i)?.[0];
  if (main && stripTags(main).length > 400) body = main;

  const headings = [...body.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)]
    .map((match) => stripTags(match[2]))
    .filter(Boolean)
    .slice(0, 30);

  const text = decode(
    body
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "\n- ")
      .replace(/<\/(p|div|section|article|li|h[1-6]|tr|ul|ol|table|blockquote|details|summary|dd|dt|figcaption|header|aside|label|button)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line && line !== "-" && line.length > 1)
    .join("\n")
    .slice(0, MAX_TEXT_PER_PAGE);

  return { url, title, description, headings, text: faqs.length ? `${text}\n${faqs.join("\n")}` : text, links, noindex };
}

async function sitemapUrls(origin, domain) {
  const found = new Set();
  const candidates = new Set([`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`]);
  try {
    const robots = await fetchText(`${origin}/robots.txt`, "text/plain", 6000);
    for (const match of robots.text.matchAll(/^\s*sitemap:\s*(\S+)/gim)) candidates.add(match[1]);
  } catch {
    // robots.txt is optional
  }
  const queue = [...candidates];
  const seen = new Set();
  while (queue.length && seen.size < 20) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      const res = await fetchText(url, "application/xml,text/xml", 8000);
      if (!res.ok) continue;
      const locs = [...res.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((match) => decode(match[1]));
      if (/<sitemapindex/i.test(res.text)) {
        queue.push(...locs);
        continue;
      }
      for (const loc of locs) {
        let next = normalizeUrl(loc, origin, domain);
        if (!next) {
          try {
            const foreign = new URL(loc);
            next = normalizeUrl(`${foreign.pathname}`, origin, domain);
          } catch {
            next = "";
          }
        }
        if (next) found.add(next);
      }
    } catch {
      continue;
    }
  }
  return [...found];
}

function hash(text) {
  return createHash("sha1").update(text.toLowerCase()).digest("hex").slice(0, 16);
}

function chunkText(text) {
  const chunks = [];
  let current = "";
  for (const line of text.split("\n")) {
    if (current && current.length + line.length > CHUNK) {
      chunks.push(current.trim());
      current = "";
    }
    if (line.length > CHUNK) {
      for (let i = 0; i < line.length; i += CHUNK) chunks.push(line.slice(i, i + CHUNK));
      continue;
    }
    current += `${line}\n`;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter((chunk) => chunk.length > 40);
}

export async function crawlSite(domain, { maxPages = 80, budgetMs = 50_000, concurrency = 6 } = {}) {
  const started = Date.now();
  let origin = `https://${domain}`;
  try {
    const home = await fetchText(`${origin}/`);
    if (!home.ok) throw new Error(String(home.status));
    origin = new URL(home.url).origin;
  } catch {
    try {
      const home = await fetchText(`https://www.${domain}/`);
      if (home.ok) origin = new URL(home.url).origin;
    } catch {
      throw new Error(`Could not reach ${domain}. Check that the site is public.`);
    }
  }

  const fromSitemap = await sitemapUrls(origin, domain);
  const queue = [normalizeUrl("/", origin, domain), ...fromSitemap].filter(Boolean);
  const queued = new Set(queue);
  const pages = [];
  let failed = 0;
  let skipped = 0;

  async function worker() {
    while (queue.length && pages.length < maxPages && Date.now() - started < budgetMs) {
      const url = queue.shift();
      try {
        const res = await fetchText(url);
        if (!res.ok || !res.type.includes("html")) {
          if (res.status >= 500 || res.status === 0) failed += 1;
          else skipped += 1;
          continue;
        }
        const finalUrl = normalizeUrl(res.url, origin, domain) || url;
        const page = parsePage(res.text, finalUrl, domain);
        for (const link of page.links) {
          if (!queued.has(link) && queued.size < maxPages * 6) {
            queued.add(link);
            queue.push(link);
          }
        }
        if (page.noindex || page.text.length < 80) continue;
        if (pages.some((item) => item.url === finalUrl)) continue;
        if (pages.length < maxPages) pages.push(page);
      } catch {
        failed += 1;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));

  const lineCounts = new Map();
  for (const page of pages) {
    for (const line of new Set(page.text.split("\n"))) {
      if (line.length > 12) lineCounts.set(line, (lineCounts.get(line) || 0) + 1);
    }
  }
  const threshold = Math.max(3, Math.ceil(pages.length * 0.4));

  const outPages = [];
  const chunks = [];
  const seen = new Set();
  let total = 0;
  pages.forEach((page) => {
    const text = page.text
      .split("\n")
      .filter((line) => (lineCounts.get(line) || 0) < threshold || pages.length < 4)
      .join("\n");
    const index = outPages.length;
    outPages.push({ url: page.url, title: page.title || page.headings[0] || page.url, description: page.description });
    const header = [page.description].filter(Boolean).join("\n");
    for (const chunk of chunkText(header ? `${header}\n${text}` : text)) {
      const key = hash(chunk);
      if (seen.has(key) || total > MAX_TOTAL_TEXT) continue;
      seen.add(key);
      total += chunk.length;
      chunks.push({ p: index, t: chunk });
    }
  });

  return {
    origin,
    pages: outPages,
    chunks,
    stats: {
      discovered: queued.size,
      sitemap: fromSitemap.length,
      crawled: pages.length,
      failed,
      skipped,
      chars: total,
      ms: Date.now() - started
    }
  };
}
