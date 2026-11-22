// Validation and shaping for a customer's chatbot settings.
import { normalizeNumber } from "./whatsapp.js";

// "example.com", "https://www.example.com/path" -> "https://example.com" (scheme://host[:port]).
export function normalizeOrigin(input) {
  let s = String(input ?? "").trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try {
    const u = new URL(s);
    if (!u.hostname.includes(".") && u.hostname !== "localhost") return null;
    return u.origin.toLowerCase();
  } catch {
    return null;
  }
}

export function parseOrigins(text) {
  const out = [];
  for (const piece of String(text ?? "").split(/[\s,]+/)) {
    const o = normalizeOrigin(piece);
    if (o && !out.includes(o)) out.push(o);
  }
  return out;
}

const stripWww = (origin) => origin.replace("://www.", "://");

// Does the request's Origin header match one of the bot's allowed sites (www and non-www both count)?
export function originAllowed(allowedText, origin) {
  if (!origin) return false;
  const want = stripWww(String(origin).toLowerCase());
  return parseOrigins(allowedText).some((o) => stripWww(o) === want);
}

const str = (v, max) => String(v ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);

// Returns { values } or { error }.
export function validateBotInput(body, current) {
  const origins = parseOrigins(body.allowed_origins);
  if (origins.length > 10) return { error: "You can add up to 10 websites." };
  const rawWebsites = String(body.allowed_origins ?? "").split(/[\s,]+/).filter(Boolean);
  if (rawWebsites.length !== origins.length && rawWebsites.some((w) => !normalizeOrigin(w))) {
    return { error: "One of the website addresses doesn't look right. Use the form example.com." };
  }

  const color = String(body.color ?? "#4f8ef7").trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return { error: "Choose a colour in the form #RRGGBB." };

  const number = normalizeNumber(body.owner_whatsapp);
  if (number === null) {
    return { error: "WhatsApp number must include the country code, e.g. +353 85 123 4567." };
  }
  const consent = body.whatsapp_consent === true;
  if (number && !consent) {
    return { error: "Please confirm that you agree to receive enquiry alerts on WhatsApp." };
  }

  return {
    values: {
      business_name: str(body.business_name, 100),
      owner_name: str(body.owner_name, 60),
      knowledge: str(body.knowledge, 8000),
      response_time: str(body.response_time, 100),
      greeting: str(body.greeting, 200),
      color,
      allowed_origins: origins.join(","),
      owner_whatsapp: number || "",
      enabled: body.enabled !== false,
      email_copy: body.email_copy === true,
      confirm_visitor: body.confirm_visitor !== false,
      // keep the original consent timestamp; clear it if they withdraw
      consent_now: !!number && consent && !current.whatsapp_consent_at,
      consent_clear: !number || !consent,
    },
  };
}

export const botView = (bot) => ({
  embed_key: bot.embed_key,
  enabled: bot.enabled,
  business_name: bot.business_name,
  owner_name: bot.owner_name,
  knowledge: bot.knowledge,
  response_time: bot.response_time,
  greeting: bot.greeting,
  color: bot.color,
  allowed_origins: bot.allowed_origins.split(",").filter(Boolean),
  owner_whatsapp: bot.owner_whatsapp ? "+" + bot.owner_whatsapp : "",
  whatsapp_consent: !!bot.whatsapp_consent_at,
  email_copy: !!bot.email_copy,
  confirm_visitor: bot.confirm_visitor !== false,
});

export const defaultGreeting = (name) =>
  `Hi! I'm the AI assistant for ${name || "this business"}. Ask me anything, or leave an enquiry and we'll get back to you.`;
