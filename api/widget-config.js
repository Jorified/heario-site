// GET /api/widget-config?key=hb_...  -> look and feel for the embedded widget (public, origin-checked).
import { defaultGreeting, originAllowed } from "../lib/bot.js";
import { one } from "../lib/db.js";
import { isOwnOrigin, json } from "../lib/util.js";

export async function GET(request) {
  const origin = request.headers.get("origin");
  const key = new URL(request.url).searchParams.get("key") ?? "";
  const bot = /^hb_[a-f0-9]{24}$/.test(key) ? await one("SELECT * FROM bots WHERE embed_key = $1", [key]) : null;
  if (!bot) return json({ error: "Unknown chatbot." }, 404);

  const allowed = origin && (isOwnOrigin(origin, request) || originAllowed(bot.allowed_origins, origin));
  if (!allowed) return json({ error: "Not allowed." }, 403);

  return json(
    {
      title: bot.business_name ? `Chat with ${bot.business_name}` : "Chat with us",
      greeting: bot.greeting || defaultGreeting(bot.business_name),
      color: bot.color,
    },
    200,
    { "access-control-allow-origin": origin, vary: "Origin" }
  );
}
