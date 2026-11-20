import crypto from "node:crypto";
import { query } from "./db.js";

// The address this request was made to (works on production and on Vercel preview deployments).
export function selfOrigin(request) {
  const first = (v) => String(v || "").split(",")[0].trim();
  const proto = first(request.headers.get("x-forwarded-proto")) || "https";
  const host = first(request.headers.get("x-forwarded-host")) || first(request.headers.get("host")) || new URL(request.url).host;
  return `${proto}://${host}`.toLowerCase();
}

// Site base URL for links in emails and Stripe redirects. APP_URL wins when set.
export const baseUrl = (request) => (process.env.APP_URL || selfOrigin(request)).replace(/\/+$/, "");

// True when the Origin header is our own site (dashboard, or the widget preview inside it).
export function isOwnOrigin(origin, request) {
  const o = String(origin || "").toLowerCase();
  return !!o && (o === selfOrigin(request) || o === String(process.env.APP_URL || "").replace(/\/+$/, "").toLowerCase());
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

export const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
export const randomHex = (bytes = 32) => crypto.randomBytes(bytes).toString("hex");

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function clientIp(request) {
  const xff = request.headers.get("x-forwarded-for") || "";
  return xff.split(",")[0].trim() || request.headers.get("x-real-ip") || "unknown";
}

// Cookie-authenticated, state-changing requests must come from our own site.
export function isSameOrigin(request) {
  return isOwnOrigin(request.headers.get("origin"), request);
}

// Fixed-window rate limit stored in Postgres. Returns true when the call is allowed.
export async function rateLimit(key, limit, windowSeconds) {
  const rows = await query(
    `INSERT INTO rate_limits (k, window_start, n) VALUES ($1, now(), 1)
     ON CONFLICT (k) DO UPDATE SET
       n = CASE WHEN rate_limits.window_start < now() - ($2::double precision * interval '1 second')
                THEN 1 ELSE rate_limits.n + 1 END,
       window_start = CASE WHEN rate_limits.window_start < now() - ($2::double precision * interval '1 second')
                           THEN now() ELSE rate_limits.window_start END
     RETURNING n`,
    [key, windowSeconds]
  );
  return Number(rows[0].n) <= limit;
}

// Escape text for safe use inside HTML emails.
export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Collapse whitespace and trim: WhatsApp template parameters may not contain newlines or tabs.
export const oneLine = (s, max = 300) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
