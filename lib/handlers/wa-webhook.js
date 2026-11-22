// Meta WhatsApp webhook: /api/whatsapp/webhook (rewritten to /api/leads?action=wa-webhook).
// GET  -> Meta's one-time subscription check (hub.verify_token must match WHATSAPP_VERIFY_TOKEN).
// POST -> delivery reports, signed with the Meta app secret (WHATSAPP_APP_SECRET).
//   delivered / read -> shown on the enquiry in the dashboard.
//   failed           -> the enquiry is emailed to the owner (once), so a late WhatsApp failure is never silent.
import crypto from "node:crypto";
import { one, query } from "../db.js";
import { emailEnquiry } from "../enquiry-email.js";

const same = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export function verify(request) {
  const p = new URL(request.url).searchParams;
  const token = process.env.WHATSAPP_VERIFY_TOKEN;
  if (token && p.get("hub.mode") === "subscribe" && same(p.get("hub.verify_token") || "", token)) {
    return new Response(p.get("hub.challenge") || "", { status: 200, headers: { "content-type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

// Rank so a late or repeated report never moves an enquiry backwards (e.g. "read" then "delivered").
const RANK = { sent: 1, delivered: 2, read: 3 };

async function onFailed(id, errors) {
  const code = errors?.[0]?.code;
  console.error("whatsapp delivery failed:", id, code, errors?.[0]?.title || "");
  // Claim the lead for emailing exactly once, even if Meta sends the report more than once.
  const lead = await one(
    `UPDATE leads l SET emailed_at = now() FROM bots b JOIN accounts a ON a.id = b.account_id
     WHERE l.bot_id = b.id AND l.wa_message_id = $1 AND l.emailed_at IS NULL
     RETURNING l.id, l.name, l.contact, l.enquiry, b.business_name, a.email`,
    [id]
  );
  if (!lead) {
    await query("UPDATE leads SET whatsapp_status = 'failed_emailed' WHERE wa_message_id = $1 AND emailed_at IS NOT NULL", [id]);
    return true;
  }
  try {
    await emailEnquiry({ to: lead.email, business: lead.business_name, name: lead.name, contact: lead.contact, enquiry: lead.enquiry, reason: "fallback" });
    await query("UPDATE leads SET whatsapp_status = 'failed_emailed' WHERE id = $1", [lead.id]);
  } catch (err) {
    console.error("email after whatsapp failure failed:", err.message);
    await query("UPDATE leads SET whatsapp_status = 'failed', emailed_at = NULL WHERE id = $1", [lead.id]);
    return false;
  }
  return true;
}

export async function receive(request) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  const raw = await request.text();
  const sig = request.headers.get("x-hub-signature-256") || "";
  if (!secret) return new Response("Not configured", { status: 503 });
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  if (!same(sig, expected)) return new Response("Bad signature", { status: 401 });

  let data;
  try { data = JSON.parse(raw); } catch { return new Response("ok"); }
  let retry = false;
  for (const entry of data?.entry || []) {
    for (const change of entry?.changes || []) {
      for (const st of change?.value?.statuses || []) {
        const id = String(st?.id || "");
        if (!id) continue;
        try {
          if (st.status === "failed") { if (!(await onFailed(id, st.errors))) retry = true; }
          else if (RANK[st.status]) {
            const lower = Object.keys(RANK).filter((k) => RANK[k] < RANK[st.status]);
            await query(
              "UPDATE leads SET whatsapp_status = $2 WHERE wa_message_id = $1 AND whatsapp_status = ANY($3::text[])",
              [id, st.status, lower]
            );
          }
        } catch (err) {
          console.error("whatsapp status update failed:", err.message);
          retry = true;
        }
      }
    }
  }
  // 500 makes Meta send the report again later (it retries for several days); every step above is safe
  // to repeat. Otherwise 200, so Meta doesn't keep retrying.
  return retry ? new Response("retry", { status: 500 }) : new Response("ok");
}
