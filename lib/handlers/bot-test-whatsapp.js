// POST /api/bot/test-whatsapp -> sends a sample enquiry alert to the saved WhatsApp number.
import { one } from "../db.js";
import { guard } from "../guard.js";
import { json, rateLimit } from "../util.js";
import { sendEnquiryAlert } from "../whatsapp.js";

export async function POST(request) {
  const g = await guard(request, { mutating: true });
  if (g.response) return g.response;

  const bot = await one("SELECT * FROM bots WHERE account_id = $1", [g.account.id]);
  if (!bot.owner_whatsapp || !bot.whatsapp_consent_at) {
    return json({ error: "Save your WhatsApp number and tick the consent box first." }, 400);
  }
  if (!(await rateLimit(`wa-test:${g.account.id}`, 5, 3600))) {
    return json({ error: "Too many test messages. Try again in an hour." }, 429);
  }
  try {
    await sendEnquiryAlert({
      to: bot.owner_whatsapp,
      business: bot.business_name,
      name: "Test visitor",
      contact: "test@example.com",
      message: "This is a test enquiry from your Heario dashboard.",
    });
  } catch (err) {
    console.error("whatsapp test failed:", err.message);
    return json({ error: "WhatsApp couldn't deliver the test message. Check the number, then contact support if it keeps failing." }, 502);
  }
  return json({ ok: true });
}
