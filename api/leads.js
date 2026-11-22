// GET /api/leads -> the customer's most recent enquiries.
// GET/POST /api/whatsapp/webhook (via ?action=wa-webhook) -> Meta delivery reports, see lib/handlers/wa-webhook.js.
// GET /api/leads?r=<code> (via /r/<code>) -> the signed "Reply on WhatsApp" link, see lib/handlers/lead-reply.js.
import { query } from "../lib/db.js";
import { guard } from "../lib/guard.js";
import { json } from "../lib/util.js";
import { replyRedirect } from "../lib/handlers/lead-reply.js";
import { receive, verify } from "../lib/handlers/wa-webhook.js";
import { actionOf } from "../lib/route.js";

// Vercel may hand the function either the original URL (/r/<code>, /api/whatsapp/webhook) or the
// rewritten one (/api/leads?r=<code>, ?action=wa-webhook), so accept both.
const isWebhook = (request) => actionOf(request) === "wa-webhook" || new URL(request.url).pathname.replace(/\/+$/, "") === "/api/whatsapp/webhook";
const replyCodeOf = (request) => {
  const u = new URL(request.url);
  const m = /^\/r\/([^/]+)\/?$/.exec(u.pathname);
  return m ? decodeURIComponent(m[1]) : u.searchParams.get("r");
};

export async function GET(request) {
  if (isWebhook(request)) return verify(request);
  const r = replyCodeOf(request);
  if (r !== null) return replyRedirect(request, r);
  const g = await guard(request);
  if (g.response) return g.response;
  const leads = await query(
    `SELECT l.id, l.name, l.contact, l.enquiry, l.whatsapp_status, l.created_at
     FROM leads l JOIN bots b ON b.id = l.bot_id
     WHERE b.account_id = $1 ORDER BY l.created_at DESC LIMIT 100`,
    [g.account.id]
  );
  return json({ leads });
}

export async function POST(request) {
  if (isWebhook(request)) return receive(request);
  return json({ error: "Not found" }, 404);
}
