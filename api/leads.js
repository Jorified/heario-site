// GET /api/leads -> the customer's most recent enquiries.
// GET /api/leads?r=<code> (via /r/<code>) -> the signed "Reply on WhatsApp" link, see lib/handlers/lead-reply.js.
import { query } from "../lib/db.js";
import { guard } from "../lib/guard.js";
import { json } from "../lib/util.js";
import { replyRedirect } from "../lib/handlers/lead-reply.js";

export async function GET(request) {
  const r = new URL(request.url).searchParams.get("r");
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
