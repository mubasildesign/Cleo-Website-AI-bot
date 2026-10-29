import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE = "axon_session";

export function adminPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  if (process.env.VERCEL) return "";
  return "axon";
}

function secret() {
  return adminPassword() || "axon-dev-session";
}

function digest(value) {
  return createHmac("sha256", secret()).update(String(value)).digest("hex");
}

export function passwordsMatch(input) {
  const expected = adminPassword();
  if (!expected) return false;
  const left = Buffer.from(digest(`pw:${input}`));
  const right = Buffer.from(digest(`pw:${expected}`));
  return timingSafeEqual(left, right);
}

export function sessionCookie() {
  const exp = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const token = `${exp}.${digest(exp)}`;
  const secure = process.env.VERCEL ? "; Secure" : "";
  return `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800${secure}`;
}

export function clearCookie() {
  const secure = process.env.VERCEL ? "; Secure" : "";
  return `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`;
}

export function isAuthed(req) {
  const cookie = req.headers.cookie || "";
  const match = cookie.match(new RegExp(`${COOKIE}=([0-9]+)\\.([a-f0-9]+)`));
  if (!match) return false;
  const exp = Number(match[1]);
  if (!exp || exp < Date.now()) return false;
  const expected = digest(match[1]);
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(match[2]));
  } catch {
    return false;
  }
}

export function requestHost(req) {
  return req.headers["x-forwarded-host"] || req.headers.host || "";
}

export function requestOrigin(req) {
  return req.headers.origin || "";
}

export function json(res, status, body, headers = {}) {
  if (res.writableEnded) return;
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  res.end(JSON.stringify(body));
}

export function applyCors(req, res) {
  const origin = requestOrigin(req);
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "600");
  if (req.headers["access-control-request-private-network"]) {
    res.setHeader("Access-Control-Allow-Private-Network", "true");
  }
}

export function preflight(res) {
  res.statusCode = 204;
  res.end();
}

export function query(req) {
  return new URL(req.url || "/", "http://local").searchParams;
}

export function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
}

export function readBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return Promise.resolve(req.body);
  }
  if (typeof req.body === "string") {
    try {
      return Promise.resolve(req.body ? JSON.parse(req.body) : {});
    } catch {
      return Promise.reject(new Error("Invalid JSON"));
    }
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 80_000) {
        reject(new Error("Body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

const hits = new Map();

export function limited(key, max = 30, windowMs = 60_000) {
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((time) => now - time < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  return false;
}
