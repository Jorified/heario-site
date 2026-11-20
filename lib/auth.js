import crypto from "node:crypto";
import { one } from "./db.js";
import { parseCookies } from "./util.js";

const COOKIE = "hs";
const DAYS = 30;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set to a random string of 32+ characters");
  return s;
}

const sign = (payload) => crypto.createHmac("sha256", secret()).update(payload).digest("base64url");

export function signSession(accountId, days = DAYS) {
  const payload = Buffer.from(
    JSON.stringify({ a: accountId, e: Math.floor(Date.now() / 1000) + days * 86400 })
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifySession(token) {
  const [payload, sig] = String(token || "").split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!data.a || data.e < Math.floor(Date.now() / 1000)) return null;
    return data.a;
  } catch {
    return null;
  }
}

export const sessionCookie = (accountId) =>
  `${COOKIE}=${signSession(accountId)}; Path=/; Max-Age=${DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`;

export const clearCookie = () => `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

// Returns the logged-in account row or null.
export async function currentAccount(request) {
  const id = verifySession(parseCookies(request.headers.get("cookie"))[COOKIE]);
  if (!id) return null;
  return one("SELECT * FROM accounts WHERE id = $1", [id]);
}
