// GET /r/<code> (rewritten to /api/leads?r=<code>) -> the "Reply on WhatsApp" button in the alert.
// Looks up the enquiry, then sends the owner to a WhatsApp chat with that visitor, with a friendly
// opening line filled in. Anything wrong (bad code, no mobile number) goes to the dashboard instead.
import { one } from "../db.js";
import { oneLine, rateLimit, clientIp } from "../util.js";
import { parseReplyCode, replyNumber } from "../whatsapp.js";

const back = (to) =>
  new Response(null, { status: 302, headers: { Location: to, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });

export async function replyRedirect(request, code) {
  const dash = new URL("/dashboard.html", request.url).toString();
  if (!(await rateLimit(`reply:${clientIp(request)}`, 60, 60))) return back(dash);
  const id = parseReplyCode(code);
  if (!id) return back(dash);
  const row = await one(
    `SELECT l.name, l.contact, b.business_name, b.owner_whatsapp
     FROM leads l JOIN bots b ON b.id = l.bot_id WHERE l.id = $1`,
    [id]
  );
  const number = row && replyNumber(row.contact, row.owner_whatsapp);
  if (!number) return back(dash);
  const first = oneLine(row.name, 40).split(" ")[0] || "there";
  const text = `Hi ${first}, it's ${oneLine(row.business_name, 60) || "us"}. Thanks for your enquiry through our website.`;
  return back(`https://wa.me/${number}?text=${encodeURIComponent(text)}`);
}
