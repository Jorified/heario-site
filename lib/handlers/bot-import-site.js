// POST /api/bot/import-site { url } -> reads the owner's website and returns a DRAFT of their
// business information. Nothing is saved: the dashboard shows it for review first.
import { parseOrigins } from "../bot.js";
import { one } from "../db.js";
import { guard } from "../guard.js";
import { planState } from "../plan.js";
import { crawlSite, normalizeSiteUrl, packPages, summarise } from "../siteimport.js";
import { json, rateLimit } from "../util.js";

export async function POST(request) {
  const g = await guard(request, { mutating: true });
  if (g.response) return g.response;
  if (!planState(g.account).active) {
    return json({ error: "Your free trial has ended. Subscribe to keep using Heario." }, 403);
  }

  const body = await request.json().catch(() => null);
  const url = String(body?.url ?? "").trim();
  if (!url) return json({ error: "Enter your website address first." }, 400);

  if (!(await rateLimit(`import:${g.account.id}`, 5, 3600)) || !(await rateLimit(`import-day:${g.account.id}`, 15, 86400))) {
    return json({ error: "You've read your website a few times already. Please try again later." }, 429);
  }

  // Only the customer's own websites (the ones listed under "Your website") can be read.
  const bot = await one("SELECT business_name, allowed_origins FROM bots WHERE account_id = $1", [g.account.id]);
  const target = normalizeSiteUrl(url);
  const bare = (h) => h.replace(/^www\./, "").toLowerCase();
  if (target && !parseOrigins(bot?.allowed_origins).some((o) => bare(new URL(o).hostname) === bare(target.hostname))) {
    return json({ error: "That website isn't in your list. Add it under \"3. Your website\", click Save, then try again." }, 400);
  }

  const { pages, error } = await crawlSite(url);
  if (error) return json({ error }, 400);
  const packed = packPages(pages);
  if (packed.replace(/<[^>]+>/g, "").trim().length < 80) {
    return json({ error: "We opened your website but found almost no text. It may be built in a way we can't read yet, so please type your information in instead." }, 422);
  }

  try {
    const knowledge = await summarise(packed, bot?.business_name);
    if (!knowledge) throw new Error("empty summary");
    return json({ ok: true, knowledge, pages: pages.map((p) => p.url) });
  } catch (err) {
    console.error("site import failed:", err.message);
    return json({ error: "We read your website but couldn't write the draft. Please try again in a minute." }, 502);
  }
}
