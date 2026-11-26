// Validation and shaping for a customer's chatbot settings.
import { normalizeNumber } from "./whatsapp.js";
import { parseHoursInput, readHours } from "./hours.js";

// A booking page (Calendly, Acuity, Square, Fresha...). Full https address only.
export function normalizeBookingUrl(input) {
  const s = String(input ?? "").trim();
  if (!s) return "";
  if (s.length > 300 || /\s/.test(s)) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : "https://" + s);
    if (u.protocol !== "https:" || u.username || u.password || !u.hostname.includes(".")) return null;
    return u.href;
  } catch {
    return null;
  }
}

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
  const booking = normalizeBookingUrl(body.booking_url);
  if (booking === null) return { error: "The booking link doesn't look right. Use the full address, e.g. https://calendly.com/yourname." };
  const hours = parseHoursInput(body.opening_hours);
  if (hours.error) return { error: hours.error };

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
      greeting_style: ["personal", "business", "custom"].includes(body.greeting_style) ? body.greeting_style : "personal",
      teaser_on: body.teaser_on === true,
      teaser_title: str(body.teaser_title, 60).replace(/\n/g, " "),
      teaser_text: str(body.teaser_text, 120).replace(/\n/g, " "),
      color,
      allowed_origins: origins.join(","),
      owner_whatsapp: number || "",
      enabled: body.enabled !== false,
      email_copy: body.email_copy === true,
      confirm_visitor: body.confirm_visitor !== false,
      booking_url: booking,
      opening_hours: hours.value,
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
  greeting_style: greetingStyle(bot),
  teaser_on: !!bot.teaser_on,
  teaser_title: bot.teaser_title || "",
  teaser_text: bot.teaser_text || "",
  color: bot.color,
  allowed_origins: bot.allowed_origins.split(",").filter(Boolean),
  owner_whatsapp: bot.owner_whatsapp ? "+" + bot.owner_whatsapp : "",
  whatsapp_consent: !!bot.whatsapp_consent_at,
  email_copy: !!bot.email_copy,
  confirm_visitor: bot.confirm_visitor !== false,
  booking_url: bot.booking_url || "",
  opening_hours: readHours(bot.opening_hours),
});

// The chat's opening message when the owner hasn't written their own. "personal" uses their first name, so visitors
// know a real person gets their message: "Hi! I'm Sean's AI assistant at Murphy Plumbing. ... Sean will get back to you."
// "business" leaves the name out. (Its pop-up uses the same wording as heario.ai's own pop-up.)
export const firstName = (owner) => String(owner || "").trim().split(/\s+/)[0] || "";
export const defaultGreeting = (business, owner, style = "personal") => {
  const first = style === "business" ? "" : firstName(owner);
  if (first && business) return `Hi! I'm ${first}'s AI assistant at ${business}. Ask me anything, or leave your details and ${first} will get back to you.`;
  if (first) return `Hi! I'm ${first}'s AI assistant. Ask me anything, or leave your details and ${first} will get back to you.`;
  return `Hi! I'm the AI assistant for ${business || "this business"}. Ask me anything, or leave your details and we'll get back to you.`;
};
// Older chatbots have no style saved: a written greeting means "custom", otherwise "personal".
export const greetingStyle = (bot) =>
  ["personal", "business", "custom"].includes(bot.greeting_style) ? bot.greeting_style : bot.greeting ? "custom" : "personal";
export const greetingFor = (bot) => {
  const style = greetingStyle(bot);
  return style === "custom" && bot.greeting ? bot.greeting : defaultGreeting(bot.business_name, bot.owner_name, style);
};

// The optional pop-up next to the chat bubble: [headline, line]. Empty fields use these suggestions.
export const defaultTeaser = (business, owner, style = "personal") => {
  const first = style === "business" ? "" : firstName(owner);
  return [
    business ? `Hi 👋 Got a question for ${business}?` : "Hi 👋 Got a question?",
    first
      ? `Ask me anything. If I can't help, I'll pass your message on to ${first} and we'll be in touch.`
      : "Ask me anything. If I can't help, I'll automatically pass on your message and we'll be in touch.",
  ];
};
export const teaserFor = (bot) => {
  if (!bot.teaser_on) return "";
  const [t, l] = defaultTeaser(bot.business_name, bot.owner_name, greetingStyle(bot));
  return `${(bot.teaser_title || t).replace(/\|/g, "/")}|${(bot.teaser_text || l).replace(/\|/g, "/")}`;
};
