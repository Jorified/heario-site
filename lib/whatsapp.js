// WhatsApp Cloud API sender. One Heario number sends to every customer's owner number
// using ONE approved Utility template with 4 body variables:
//   "New website enquiry for {{1}}. Name: {{2}}. Contact: {{3}}. Message: {{4}}"
import { oneLine } from "./util.js";

const GRAPH = "https://graph.facebook.com/v21.0";

// Accepts "+353 85 123 4567", "00353851234567", "(353) 85-123-4567". Returns digits only, or null.
// Numbers without an international prefix (e.g. "085 123 4567") are rejected on purpose:
// guessing the country would send alerts to the wrong person.
export function normalizeNumber(input) {
  let s = String(input ?? "").trim();
  if (!s) return "";
  const hadPlus = s.startsWith("+");
  s = s.replace(/[^\d]/g, "");
  if (s.startsWith("00")) s = s.slice(2);
  else if (!hadPlus && s.startsWith("0")) return null;
  return /^[1-9]\d{7,14}$/.test(s) ? s : null;
}

export async function sendEnquiryAlert({ to, business, name, contact, message }) {
  const { WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID } = process.env;
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) throw new Error("WhatsApp is not configured");
  const res = await fetch(`${GRAPH}/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: process.env.WHATSAPP_TEMPLATE_NAME || "new_enquiry",
        language: { code: process.env.WHATSAPP_TEMPLATE_LANG || "en" },
        components: [
          {
            type: "body",
            parameters: [oneLine(business, 80) || "your business", oneLine(name, 80), oneLine(contact, 120), oneLine(message, 500)].map(
              (text) => ({ type: "text", text: text || "-" })
            ),
          },
        ],
      },
    }),
  });
  if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${(await res.text()).slice(0, 300)}`);
}
