// WhatsApp Cloud API sender. One Heario number sends to every customer's owner number
// using approved Utility templates that share the same body (4 variables):
//   new_enquiry        -> button: "See all enquiries" (static URL to the dashboard)
//   new_enquiry_phone  -> buttons: "Reply on WhatsApp" (https://heario.ai/r/{{1}}), "See all enquiries"
// Meta rejects templates that link straight to wa.me, so the reply button goes to a signed Heario
// link (/r/<code>) that looks up the enquiry and forwards the owner to the visitor's WhatsApp chat.
// The phone version is used when the visitor left a mobile number we can turn into an international
// one; otherwise (email, landline, or a number we can't place) the plain one is used.
import crypto from "node:crypto";
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

// Finds a phone number in the visitor's contact text and returns it in international digits,
// or null. A local number ("087 111 2222") is read using the owner's own country's format, because
// the visitor is almost always local to the business: Ireland, the UK, North America and the
// European countries listed in MOBILE below. Elsewhere only numbers with a country code work.
export function replyNumber(contact, ownerNumber) {
  const m = String(contact ?? "").match(/(\+|00)?\d[\d\s().-]{6,18}\d/);
  if (!m) return null;
  const raw = m[0];
  const digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+") || raw.startsWith("00")) {
    const n = normalizeNumber(raw);
    return n && isMobileOrUnknown(n) ? n : null;
  }
  const owner = String(ownerNumber ?? "");
  let full = null;
  if (digits.startsWith("0") && (owner.startsWith("353") || owner.startsWith("44"))) {
    full = (owner.startsWith("353") ? "353" : "44") + digits.slice(1);
  } else if (/^[2-9]\d{9}$/.test(digits) && owner.startsWith("1")) {
    full = "1" + digits;  } else if (!owner.startsWith("353") && !owner.startsWith("44") && !owner.startsWith("1")) {
    full = fromLocal(digits, owner);
  }
  return full && /^[1-9]\d{9,14}$/.test(full) && isMobileOrUnknown(full) ? full : null;
}

// WhatsApp only works on mobiles. We can tell landlines apart in Ireland (mobiles are 08x) and the UK
// (mobiles are 07x); for other countries we can't, so the number is allowed through.
function isMobileOrUnknown(n) {
  if (n.startsWith("353")) return /^3538/.test(n);
  if (n.startsWith("44")) return /^447/.test(n);
  const cc = countryOf(n);
  return cc ? MOBILE[cc].mobile.test(n.slice(cc.length)) : true;
}

// Other European countries: how a local number is written (the "trunk" prefix dropped when adding the
// country code) and what a mobile looks like after the country code. Only clear mobile ranges are
// listed, so a landline or an unusual number gets no reply button rather than a wrong one.
// Countries not listed (e.g. Denmark, where mobiles and landlines can't be told apart) keep the old
// behaviour: international numbers pass through, local ones get no button.
const MOBILE = {
  49: { trunk: ["0"], mobile: /^1[5-7]\d{8,9}$/ }, // Germany 015x/016x/017x
  33: { trunk: ["0"], mobile: /^[67]\d{8}$/ }, // France 06/07
  31: { trunk: ["0"], mobile: /^6\d{8}$/ }, // Netherlands 06
  32: { trunk: ["0"], mobile: /^4[5-9]\d{7}$/ }, // Belgium 045x-049x
  43: { trunk: ["0"], mobile: /^6[5-9]\d{6,10}$/ }, // Austria 065x-069x
  46: { trunk: ["0"], mobile: /^7[02369]\d{7}$/ }, // Sweden 070/072/073/076/079
  358: { trunk: ["0"], mobile: /^(4\d|50)\d{4,8}$/ }, // Finland 04x/050
  41: { trunk: ["0"], mobile: /^7[5-9]\d{7}$/ }, // Switzerland 075-079
  421: { trunk: ["0"], mobile: /^9\d{8}$/ }, // Slovakia 09xx
  40: { trunk: ["0"], mobile: /^7\d{8}$/ }, // Romania 07xx
  359: { trunk: ["0"], mobile: /^(87|88|89|98)\d{7}$/ }, // Bulgaria
  385: { trunk: ["0"], mobile: /^9[1-9]\d{6,7}$/ }, // Croatia 09x
  386: { trunk: ["0"], mobile: /^(3[01]|4[01]|5[01]|6[4589]|7[01])\d{6}$/ }, // Slovenia
  370: { trunk: ["0", "8"], mobile: /^6\d{7}$/ }, // Lithuania 06/86
  36: { trunk: ["06"], mobile: /^(20|30|31|50|70)\d{7}$/ }, // Hungary 06 20/30/31/50/70
  34: { trunk: [""], mobile: /^[67]\d{8}$/ }, // Spain 6/7
  351: { trunk: [""], mobile: /^9[1236]\d{7}$/ }, // Portugal 91/92/93/96
  39: { trunk: [""], mobile: /^3\d{8,9}$/ }, // Italy 3xx
  30: { trunk: [""], mobile: /^69\d{8}$/ }, // Greece 69
  48: { trunk: [""], mobile: /^[4-8]\d{8}$/ }, // Poland
  420: { trunk: [""], mobile: /^(6\d|7[2-9])\d{7}$/ }, // Czechia 6xx/72x-79x
  371: { trunk: [""], mobile: /^2\d{7}$/ }, // Latvia 2x
  372: { trunk: [""], mobile: /^5\d{6,7}$/ }, // Estonia 5x
  352: { trunk: [""], mobile: /^6\d{8}$/ }, // Luxembourg 6x1
  356: { trunk: [""], mobile: /^(7[79]|9[89])\d{6}$/ }, // Malta
  357: { trunk: [""], mobile: /^9[4-79]\d{6}$/ }, // Cyprus 9x
  47: { trunk: [""], mobile: /^[49]\d{7}$/ }, // Norway 4x/9x
};

// The listed country code a full international number starts with, if any (longest match first).
function countryOf(n) {
  for (const len of [3, 2]) if (Object.hasOwn(MOBILE, n.slice(0, len))) return n.slice(0, len);
  return null;
}

// A visitor's local number, read using the owner's country's rules. Null unless it is clearly a mobile.
function fromLocal(digits, owner) {
  const cc = countryOf(owner);
  if (!cc) return null;
  for (const t of MOBILE[cc].trunk) {
    if (!digits.startsWith(t)) continue;
    const nsn = digits.slice(t.length);
    if (t === "" && nsn.startsWith("0")) continue;
    if (MOBILE[cc].mobile.test(nsn)) return cc + nsn;
  }
  return null;
}

// Signed code for the reply link: "<leadId>.<16-char HMAC>". Only Heario can mint one, and it exposes
// nothing about the visitor.
function replySig(leadId) {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set");
  return crypto.createHmac("sha256", s).update(`wa-reply:${leadId}`).digest("base64url").slice(0, 16);
}
export const replyCode = (leadId) => `${leadId}.${replySig(leadId)}`;
export function parseReplyCode(code) {
  const m = /^(\d{1,18})\.([A-Za-z0-9_-]{16})$/.exec(String(code ?? ""));
  if (!m) return null;
  const a = Buffer.from(m[2]), b = Buffer.from(replySig(m[1]));
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? m[1] : null;
}

// Keeps the whole alert comfortably under WhatsApp's template body limit.
const clip = (s, max) => {
  const t = oneLine(s, 10000);
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "\u2026" : t;
};

function payload(to, name, lang, body, reply) {
  const components = [{ type: "body", parameters: body.map((text) => ({ type: "text", text: text || "-" })) }];
  if (reply) components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: reply }] });
  return { messaging_product: "whatsapp", to, type: "template", template: { name, language: { code: lang }, components } };
}

export async function sendEnquiryAlert({ to, business, name, contact, message, leadId }) {
  const { WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID } = process.env;
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) throw new Error("WhatsApp is not configured");
  const lang = process.env.WHATSAPP_TEMPLATE_LANG || "en";
  const plain = process.env.WHATSAPP_TEMPLATE_NAME || "new_enquiry";
  const withReply = process.env.WHATSAPP_TEMPLATE_PHONE_NAME || "new_enquiry_phone";
  const body = [clip(business, 60) || "your business", clip(name, 50), clip(contact, 60), clip(message, 200)];
  const reply = leadId && replyNumber(contact, to) ? replyCode(leadId) : null;

  const post = (data) =>
    fetch(`${GRAPH}/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

  const messageId = async (res) => (await res.json().catch(() => null))?.messages?.[0]?.id || null;
  if (reply) {
    const res = await post(payload(to, withReply, lang, body, reply));
    if (res.ok) return messageId(res);
    // If the reply-button template is missing or not approved yet, still get the alert out.
    console.error(`whatsapp reply template failed (${res.status}), using plain template:`, (await res.text()).slice(0, 200));
  }
  const res = await post(payload(to, plain, lang, body, null));
  if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${(await res.text()).slice(0, 300)}`);
  // Meta's message id. Delivery reports for it arrive later at /api/whatsapp/webhook.
  return messageId(res);
}
