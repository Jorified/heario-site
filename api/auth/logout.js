import { clearCookie } from "../../lib/auth.js";
import { isSameOrigin, json } from "../../lib/util.js";

export async function POST(request) {
  if (!isSameOrigin(request)) return json({ error: "Bad origin" }, 403);
  return json({ ok: true }, 200, { "set-cookie": clearCookie() });
}
