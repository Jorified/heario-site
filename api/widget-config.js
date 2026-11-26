// GET /api/widget-config?key=hb_...  -> look and feel for the embedded widget (public, origin-checked).
import { greetingFor, originAllowed, teaserFor } from "../lib/bot.js";
import { one, query } from "../lib/db.js";
import { isOwnOrigin, json } from "../lib/util.js";

export async function GET(request) {
  // Browsers omit the Origin header on same-origin GETs (e.g. the widget on heario.ai itself),
  // so fall back to the browser-set Sec-Fetch-Site header, which page scripts cannot forge.
  const sameSite = request.headers.get("sec-fetch-site") === "same-origin";
  const origin = request.headers.get("origin") || (sameSite ? new URL(request.url).origin : null);
  const key = new URL(request.url).searchParams.get("key") ?? "";
  const bot = /^hb_[a-f0-9]{24}$/.test(key) ? await one("SELECT * FROM bots WHERE embed_key = $1", [key]) : null;
  if (!bot) return json({ error: "Unknown chatbot." }, 404);

  const allowed = origin && (isOwnOrigin(origin, request) || originAllowed(bot.allowed_origins, origin));
  if (!allowed) return json({ error: "Not allowed." }, 403);

  // Note that the chat is live on the customer's own website (not just our dashboard preview). At most once an hour.
  if (!isOwnOrigin(origin, request) && (!bot.site_seen_at || Date.now() - new Date(bot.site_seen_at) > 3600_000)) {
    await query("UPDATE bots SET site_seen_at = now() WHERE id = $1", [bot.id]).catch((err) => console.error("site_seen_at failed:", err.message));
  }

  return json(
    {
      title: bot.business_name ? `Chat with ${bot.business_name}` : "Chat with us",
      greeting: greetingFor(bot),
      teaser: teaserFor(bot),
      color: bot.color,
      booking_url: bot.booking_url || "",
    },
    200,
    { "access-control-allow-origin": origin, vary: "Origin" }
  );
}
