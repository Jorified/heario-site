// Runs the real API handlers against an in-memory Postgres (PGlite). External services are stubbed.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

process.env.APP_URL = "https://heario.ai";
process.env.SESSION_SECRET = "x".repeat(40);
process.env.BREVO_API_KEY = "brevo";
process.env.EMAIL_FROM = "hello@heario.ai";
process.env.ANTHROPIC_API_KEY = "ant";
process.env.WHATSAPP_TOKEN = "wa";
process.env.WHATSAPP_PHONE_NUMBER_ID = "123";
process.env.WHATSAPP_APP_SECRET = "app-secret-for-tests";
process.env.WHATSAPP_VERIFY_TOKEN = "verify-me";
process.env.STRIPE_SECRET_KEY = "sk_test";
process.env.STRIPE_PRICE_ID = "price_1";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";

const db = new PGlite();
globalThis.__heario_query = async (text, params) => (await db.query(text, params)).rows;

let calls; // every outbound fetch the handlers make
let claudeScript; // queue of fake Anthropic responses
let stripePrice; // what the fake Stripe returns for the price lookup (null = Stripe fails)
let setupPrice; // same, for the optional setup-fee price (price_setup)
const PRICE = () => ({
  id: "price_1", active: true, currency: "eur", unit_amount: 2900, recurring: { interval: "month", interval_count: 1 },
  currency_options: { gbp: { unit_amount: 2500 }, usd: { unit_amount: 3100 } },
});
globalThis.fetch = async (url, init = {}) => {
  const body = init.body ? (init.headers?.["content-type"]?.includes("json") || init.headers?.["Content-Type"]?.includes("json") ? JSON.parse(init.body) : init.body) : null;
  calls.push({ url: String(url), body });
  const ok = (data) => new Response(JSON.stringify(data), { status: 200 });
  if (String(url).includes("brevo")) return ok({});
  if (String(url).includes("graph.facebook")) return ok({ messages: [{ id: "wamid" }] });
  if (String(url).includes("anthropic")) return ok(claudeScript.shift());
  if (String(url).includes("api.stripe.com/v1/prices/price_setup")) return setupPrice ? ok(setupPrice) : new Response("{}", { status: 500 });
  if (String(url).includes("api.stripe.com/v1/prices/")) return stripePrice ? ok(stripePrice) : new Response("{}", { status: 500 });
  if (String(url).includes("stripe.com")) return ok({ url: "https://checkout.stripe.com/c/test" });
  const site = fakeSite[String(url)];
  if (site) return new Response(site.body ?? "", { status: site.status ?? 200, headers: site.headers ?? { "content-type": "text/html; charset=utf-8" } });
  throw new Error("unexpected fetch " + url);
};
// Fake websites for the "read my website" feature, and fake DNS for them.
let fakeSite = {};
globalThis.__heario_pagefetch = (u) => globalThis.fetch(u.href, { redirect: "manual" });
const fakeDns = { "murphyplumbing.ie": "93.184.216.34", "www.murphyplumbing.ie": "93.184.216.34", "sneaky.example": "169.254.169.254", "intranet.example": "10.0.0.5" };
globalThis.__heario_lookup = async (host) => { if (!fakeDns[host]) throw new Error("ENOTFOUND"); return [{ address: fakeDns[host], family: 4 }]; };

const h = {
  request: await import("../lib/handlers/auth-request.js"),
  verify: await import("../lib/handlers/auth-verify.js"),
  me: await import("../api/me.js"),
  bot: await import("../api/bot.js"),
  testWa: await import("../lib/handlers/bot-test-whatsapp.js"),
  leads: await import("../api/leads.js"),
  chat: await import("../api/chat.js"),
  widget: await import("../api/widget-config.js"),
  checkout: await import("../lib/handlers/billing-checkout.js"),
  webhook: await import("../api/stripe/webhook.js"),
  account: await import("../api/account.js"),
  cron: await import("../api/cron/cleanup.js"),
  pricing: await import("../api/pricing.js"),
  authRoute: await import("../api/auth.js"),
  billingRoute: await import("../api/billing.js"),
  botRoute: await import("../api/bot.js"),
  importSite: await import("../lib/handlers/bot-import-site.js"),
};
const site = await import("../lib/siteimport.js");
const { normalizeNumber, replyNumber, replyCode, parseReplyCode } = await import("../lib/whatsapp.js");
const { verifyStripeSignature } = await import("../lib/stripe.js");
const { originAllowed, parseOrigins } = await import("../lib/bot.js");
const { currencyForCountry, formatMoney, resetPriceCache } = await import("../lib/pricing.js");

const SITE = "https://heario.ai";
const req = (path, { method = "POST", body, cookie, origin = SITE } = {}) =>
  new Request(SITE + path, {
    method,
    headers: { "content-type": "application/json", ...(origin && { origin }), ...(cookie && { cookie }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function login(email = "owner@example.com") {
  calls = [];
  await h.request.POST(req("/api/auth/request", { body: { email } }));
  const mail = calls.find((c) => c.url.includes("brevo"));
  const token = mail.body.textContent.match(/token=([a-f0-9]{64})/)[1];
  const res = await h.verify.POST(req("/api/auth/verify", { body: { token } }));
  assert.equal(res.status, 200);
  return { cookie: res.headers.get("set-cookie").split(";")[0], token };
}

const settings = (over = {}) => ({
  business_name: "Murphy Plumbing", owner_name: "Sean", knowledge: "We fix boilers. Call-out is 80 euro.",
  response_time: "within 2 hours", greeting: "", color: "#4f8ef7", allowed_origins: "murphyplumbing.ie",
  owner_whatsapp: "+353 85 123 4567", whatsapp_consent: true, enabled: true, ...over,
});

before(async () => { await db.exec(fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8")); });
beforeEach(async () => {
  calls = []; claudeScript = []; stripePrice = PRICE(); resetPriceCache(); fakeSite = {};
  setupPrice = { id: "price_setup", active: true, currency: "eur", unit_amount: 1999, currency_options: { gbp: { unit_amount: 1699 }, usd: { unit_amount: 2299 } } };
  delete process.env.STRIPE_SETUP_PRICE_ID;
  await db.exec("TRUNCATE accounts, login_tokens, rate_limits CASCADE");
});

test("login link works once, creates account + chatbot, and starts a trial", async () => {
  const { cookie, token } = await login();
  const me = await (await h.me.GET(req("/api/me", { method: "GET", cookie, origin: null }))).json();
  assert.equal(me.email, "owner@example.com");
  assert.equal(me.plan.status, "trial");
  assert.equal(me.plan.trialDaysLeft, 14);
  assert.match(me.bot.embed_key, /^hb_[a-f0-9]{24}$/);
  const again = await h.verify.POST(req("/api/auth/verify", { body: { token } }));
  assert.equal(again.status, 400, "token must be single-use");
});

test("rejects cross-site POSTs and unauthenticated access", async () => {
  const bad = await h.request.POST(req("/api/auth/request", { body: { email: "a@b.co" }, origin: "https://evil.com" }));
  assert.equal(bad.status, 403);
  const anon = await h.me.GET(req("/api/me", { method: "GET", origin: null }));
  assert.equal(anon.status, 401);
  const forged = await h.me.GET(req("/api/me", { method: "GET", cookie: "hs=abc.def", origin: null }));
  assert.equal(forged.status, 401);
});

test("settings validation and consent handling", async () => {
  const { cookie } = await login();
  const put = (b) => h.bot.PUT(req("/api/bot", { method: "PUT", cookie, body: b }));
  assert.equal((await put(settings({ owner_whatsapp: "085 123 4567" }))).status, 400, "needs country code");
  assert.equal((await put(settings({ whatsapp_consent: false }))).status, 400, "needs consent");
  assert.equal((await put(settings({ color: "red" }))).status, 400);
  const ok = await (await put(settings())).json();
  assert.equal(ok.bot.owner_whatsapp, "+353851234567");
  assert.equal(ok.bot.whatsapp_consent, true);
  assert.deepEqual(ok.bot.allowed_origins, ["https://murphyplumbing.ie"]);
  const cleared = await (await put(settings({ owner_whatsapp: "", whatsapp_consent: false }))).json();
  assert.equal(cleared.bot.whatsapp_consent, false);
});

test("chat: blocked from other sites, answers on the customer's site, and a real enquiry saves a lead + WhatsApps the owner", async () => {
  const { cookie } = await login();
  await h.bot.PUT(req("/api/bot", { method: "PUT", cookie, body: settings() }));
  const key = (await (await h.me.GET(req("/api/me", { method: "GET", cookie, origin: null }))).json()).bot.embed_key;
  const chat = (origin, messages = [{ role: "user", content: "hi" }]) =>
    h.chat.POST(req("/api/chat", { body: { key, messages }, origin }));

  assert.equal((await chat("https://evil.com")).status, 403);
  assert.equal((await chat(null)).status, 403);

  claudeScript = [{ stop_reason: "end_turn", content: [{ type: "text", text: "Call-out is 80 euro." }] }];
  const r1 = await chat("https://www.murphyplumbing.ie");
  assert.equal(r1.status, 200);
  assert.equal((await r1.json()).reply, "Call-out is 80 euro.");
  assert.match(calls.find((c) => c.url.includes("anthropic")).body.system, /Murphy Plumbing/);

  calls = [];
  claudeScript = [
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "notify_owner", input: { name: "Ann", contact: "0871112222", enquiry: "Boiler\nnot working" } }] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "Sean will be in touch within 2 hours." }] },
  ];
  const r2 = await (await chat("https://murphyplumbing.ie", [{ role: "user", content: "my boiler is broken, I'm Ann 0871112222" }])).json();
  assert.equal(r2.notified, true);
  const wa = calls.find((c) => c.url.includes("graph.facebook"));
  assert.equal(wa.body.to, "353851234567");
  assert.deepEqual(wa.body.template.components[0].parameters.map((p) => p.text), ["Murphy Plumbing", "Ann", "0871112222", "Boiler not working"]);
  assert.equal(wa.body.template.name, "new_enquiry_phone", "phone contact gets the reply-button template");
  const btn = wa.body.template.components[1];
  assert.equal(btn.sub_type, "url");
  assert.match(btn.parameters[0].text, /^\d+\.[A-Za-z0-9_-]{16}$/, "button carries a signed code, never a wa.me link or a phone number");
  assert.ok(!JSON.stringify(wa.body).includes("wa.me"));
  // Tapping the button: signed code -> WhatsApp chat with the visitor, prefilled; tampering -> dashboard.
  const tap = (code) => h.leads.GET(req(`/api/leads?r=${code}`, { method: "GET", origin: null }));
  const ok = await tap(btn.parameters[0].text);
  assert.equal(ok.status, 302);
  const loc = new URL(ok.headers.get("location"));
  assert.equal(loc.origin + loc.pathname, "https://wa.me/353871112222");
  assert.match(loc.searchParams.get("text"), /^Hi Ann, it's Murphy Plumbing\./);
  const bad = await tap(btn.parameters[0].text.replace(/.$/, (c) => (c === "a" ? "b" : "a")));
  assert.match(bad.headers.get("location"), /\/dashboard\.html$/);
  assert.match((await tap("1.AAAAAAAAAAAAAAAA")).headers.get("location"), /\/dashboard\.html$/);
  assert.match((await tap("garbage")).headers.get("location"), /\/dashboard\.html$/);
  const leads = await (await h.leads.GET(req("/api/leads", { method: "GET", cookie, origin: null }))).json();
  assert.equal(leads.leads.length, 1);
  assert.equal(leads.leads[0].whatsapp_status, "sent");
  assert.ok(!calls.some((c) => c.url.includes("brevo")), "no email fallback when WhatsApp succeeded");
});

test("chat: WhatsApp failure falls back to email and still records the lead", async () => {
  const { cookie } = await login();
  await h.bot.PUT(req("/api/bot", { method: "PUT", cookie, body: settings() }));
  const key = (await (await h.me.GET(req("/api/me", { method: "GET", cookie, origin: null }))).json()).bot.embed_key;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => url.includes("graph.facebook") ? new Response("boom", { status: 500 }) : realFetch(url, init);
  claudeScript = [
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "notify_owner", input: { name: "Bo", contact: "bo@x.ie", enquiry: "Quote please" } }] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "Done" }] },
  ];
  await h.chat.POST(req("/api/chat", { body: { key, messages: [{ role: "user", content: "x" }] }, origin: "https://murphyplumbing.ie" }));
  globalThis.fetch = realFetch;
  assert.ok(calls.some((c) => c.url.includes("brevo")), "email fallback sent");
  const lead = (await db.query("SELECT whatsapp_status FROM leads")).rows[0];
  assert.equal(lead.whatsapp_status, "failed_emailed");
});

test("chat: expired trial and disabled bots return the unavailable message without calling Claude", async () => {
  const { cookie } = await login();
  await h.bot.PUT(req("/api/bot", { method: "PUT", cookie, body: settings() }));
  const key = (await (await h.me.GET(req("/api/me", { method: "GET", cookie, origin: null }))).json()).bot.embed_key;
  await db.query("UPDATE accounts SET trial_ends_at = now() - interval '1 day'");
  calls = [];
  const r = await (await h.chat.POST(req("/api/chat", { body: { key, messages: [{ role: "user", content: "hi" }] }, origin: "https://murphyplumbing.ie" }))).json();
  assert.match(r.reply, /isn't available/);
  assert.ok(!calls.some((c) => c.url.includes("anthropic")));
  await db.query("UPDATE accounts SET subscription_status = 'active'");
  claudeScript = [{ stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] }];
  assert.equal((await (await h.chat.POST(req("/api/chat", { body: { key, messages: [{ role: "user", content: "hi" }] }, origin: "https://murphyplumbing.ie" }))).json()).reply, "ok");
});

test("chat: per-visitor rate limit", async () => {
  const { cookie } = await login();
  await h.bot.PUT(req("/api/bot", { method: "PUT", cookie, body: settings() }));
  const key = (await (await h.me.GET(req("/api/me", { method: "GET", cookie, origin: null }))).json()).bot.embed_key;
  let last;
  for (let i = 0; i < 22; i++) {
    claudeScript = [{ stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] }];
    last = await h.chat.POST(req("/api/chat", { body: { key, messages: [{ role: "user", content: "hi" }] }, origin: "https://murphyplumbing.ie" }));
  }
  assert.equal(last.status, 429);
});

test("chat: per-chatbot hourly caps hold even when requests come from many different visitors", async () => {
  process.env.BOT_HOURLY_MESSAGES = "2";
  process.env.BOT_HOURLY_ENQUIRIES = "1";
  try {
    const { cookie } = await login();
    await h.bot.PUT(req("/api/bot", { method: "PUT", cookie, body: settings() }));
    const key = (await (await h.me.GET(req("/api/me", { method: "GET", cookie, origin: null }))).json()).bot.embed_key;
    const from = (ip, text = "hi") =>
      h.chat.POST(new Request(SITE + "/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://murphyplumbing.ie", "x-forwarded-for": ip },
        body: JSON.stringify({ key, messages: [{ role: "user", content: text }] }),
      }));
    const enquiry = { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t", name: "notify_owner", input: { name: "A", contact: "a@b.ie", enquiry: "quote" } }] };
    const done = { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] };

    claudeScript = [enquiry, done];
    assert.equal((await (await from("1.1.1.1")).json()).notified, true);
    calls = [];
    claudeScript = [enquiry, { stop_reason: "end_turn", content: [{ type: "text", text: "Please contact them directly." }] }];
    const second = await (await from("2.2.2.2")).json();
    assert.equal(second.notified, false, "second enquiry in the hour is refused");
    assert.equal((await db.query("SELECT count(*)::int n FROM leads")).rows[0].n, 1);
    assert.ok(!calls.some((c) => c.url.includes("graph.facebook")), "no extra WhatsApp sent");

    claudeScript = [done, done, done];
    const busy = await (await from("3.3.3.3")).json();
    assert.match(busy.reply, /very busy/);
    assert.equal(claudeScript.length, 3, "Claude was not called once the cap was hit");
  } finally {
    delete process.env.BOT_HOURLY_MESSAGES;
    delete process.env.BOT_HOURLY_ENQUIRIES;
  }
});

test("widget config is origin-checked", async () => {
  const { cookie } = await login();
  await h.bot.PUT(req("/api/bot", { method: "PUT", cookie, body: settings() }));
  const key = (await (await h.me.GET(req("/api/me", { method: "GET", cookie, origin: null }))).json()).bot.embed_key;
  const get = (origin, extra = {}) => h.widget.GET(new Request(`${SITE}/api/widget-config?key=${key}`, { headers: { ...(origin ? { origin } : {}), ...extra } }));
  assert.equal((await get("https://evil.com")).status, 403);
  assert.equal((await get(null)).status, 403, "no origin and not same-origin is refused");
  assert.equal((await get(null, { "sec-fetch-site": "same-origin" })).status, 200, "same-origin GET without Origin header works");
  assert.equal((await get(null, { "sec-fetch-site": "cross-site" })).status, 403);
  const cfg = await (await get("https://murphyplumbing.ie")).json();
  assert.equal(cfg.title, "Chat with Murphy Plumbing");
  assert.match(cfg.greeting, /AI assistant/);
});

test("Stripe: checkout URL, signed webhook activates the plan, bad signature is rejected", async () => {
  const { cookie } = await login();
  const co = await (await h.checkout.POST(req("/api/billing/checkout", { cookie }))).json();
  assert.match(co.url, /^https:\/\/checkout\.stripe\.com/);

  const id = (await db.query("SELECT id FROM accounts")).rows[0].id;
  const event = JSON.stringify({ type: "checkout.session.completed", data: { object: { mode: "subscription", client_reference_id: id, customer: "cus_1", subscription: "sub_1" } } });
  const sign = (raw, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${crypto.createHmac("sha256", "whsec_test").update(`${t}.${raw}`).digest("hex")}`;
  const wh = (raw, sig) => h.webhook.POST(new Request(SITE + "/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": sig }, body: raw }));

  assert.equal((await wh(event, "t=1,v1=bad")).status, 400);
  assert.equal((await wh(event, sign(event, 1000))).status, 400, "old timestamp rejected");
  assert.equal((await wh(event, sign(event))).status, 200);
  const me = await (await h.me.GET(req("/api/me", { method: "GET", cookie, origin: null }))).json();
  assert.equal(me.plan.status, "subscribed");
  assert.equal(me.plan.hasBilling, true);

  const cancel = JSON.stringify({ type: "customer.subscription.deleted", data: { object: { customer: "cus_1" } } });
  await wh(cancel, sign(cancel));
  assert.equal((await db.query("SELECT subscription_status s FROM accounts")).rows[0].s, "canceled");
  const unknown = JSON.stringify({ type: "customer.subscription.updated", data: { object: { customer: "cus_old_app", status: "active", id: "sub_x" } } });
  assert.equal((await wh(unknown, sign(unknown))).status, 200, "unknown customers are ignored");
});

test("account deletion erases everything", async () => {
  const { cookie } = await login();
  assert.equal((await h.account.DELETE(req("/api/account", { method: "DELETE", cookie, body: { confirm: "nope" } }))).status, 400);
  assert.equal((await h.account.DELETE(req("/api/account", { method: "DELETE", cookie, body: { confirm: "DELETE" } }))).status, 200);
  for (const t of ["accounts", "bots"]) assert.equal((await db.query(`SELECT count(*)::int n FROM ${t}`)).rows[0].n, 0);
});

test("cron cleanup needs the secret and removes old leads", async () => {
  process.env.CRON_SECRET = "s3cret";
  assert.equal((await h.cron.GET(new Request(SITE + "/api/cron/cleanup"))).status, 401);
  const { cookie } = await login();
  await h.bot.PUT(req("/api/bot", { method: "PUT", cookie, body: settings() }));
  const botId = (await db.query("SELECT id FROM bots")).rows[0].id;
  await db.query("INSERT INTO leads (bot_id,name,contact,enquiry,created_at) VALUES ($1,'a','b','c', now() - interval '100 days'), ($1,'d','e','f', now())", [botId]);
  const res = await (await h.cron.GET(new Request(SITE + "/api/cron/cleanup", { headers: { authorization: "Bearer s3cret" } }))).json();
  assert.equal(res.leads, 1);
});

test("helpers: phone numbers, origins, Stripe signature", () => {
  assert.equal(normalizeNumber("+353 85 123 4567"), "353851234567");
  assert.equal(normalizeNumber("00353851234567"), "353851234567");
  assert.equal(normalizeNumber("085 123 4567"), null);
  assert.equal(normalizeNumber("12"), null);
  assert.equal(normalizeNumber(""), "");
  assert.deepEqual(parseOrigins("Example.com, https://www.foo.ie/page nonsense"), ["https://example.com", "https://www.foo.ie"]);
  assert.equal(originAllowed("https://foo.ie", "https://www.foo.ie"), true);
  assert.equal(originAllowed("https://foo.ie", "http://foo.ie"), false);
  assert.equal(originAllowed("", "https://foo.ie"), false);
  assert.equal(verifyStripeSignature("{}", null, "s"), false);
});

const priceFrom = (country) =>
  h.pricing.GET(new Request(SITE + "/api/pricing", { headers: country ? { "x-vercel-ip-country": country } : {} })).then((r) => r.json());

test("pricing: currency by country (UK pounds, US dollars, everyone else euro) with amounts straight from Stripe", async () => {
  assert.equal(currencyForCountry("GB"), "gbp");
  assert.equal(currencyForCountry("gb"), "gbp");
  assert.equal(currencyForCountry("US"), "usd");
  for (const c of ["IE", "DE", "FR", "PL", "SE", "CA", "AU", "", undefined]) assert.equal(currencyForCountry(c), "eur", String(c));

  const ie = await priceFrom("IE");
  assert.equal(ie.currency, "eur");
  assert.deepEqual(Object.fromEntries(Object.entries(ie.prices).map(([k, v]) => [k, v.display])), { eur: "€29", gbp: "£25", usd: "$31" });
  assert.equal((await priceFrom("GB")).currency, "gbp");
  assert.equal((await priceFrom("US")).currency, "usd");
  assert.equal((await priceFrom(null)).currency, "eur");
  assert.equal(formatMoney(2950, "eur"), "€29.50");
});

test("pricing: only the currencies Stripe actually has a price for are offered", async () => {
  stripePrice = { ...PRICE(), currency_options: { gbp: { unit_amount: 2500 }, cad: { unit_amount: 4000 } } };
  const r = await priceFrom("US");
  assert.deepEqual(Object.keys(r.prices).sort(), ["eur", "gbp"]);
  assert.equal(r.currency, "eur", "US visitors fall back to the default when there is no dollar price");
});

test("pricing: if Stripe is unreachable or the price is wrong, the page gets prices:null instead of an error or a made-up number", async () => {
  stripePrice = null;
  const down = await priceFrom("IE");
  assert.equal(down.prices, null);
  assert.equal(down.currency, "eur");
  resetPriceCache();
  stripePrice = { ...PRICE(), recurring: { interval: "year", interval_count: 1 } };
  assert.equal((await priceFrom("IE")).prices, null, "yearly price is rejected");
  resetPriceCache();
  const saved = process.env.STRIPE_PRICE_ID;
  delete process.env.STRIPE_PRICE_ID;
  assert.equal((await priceFrom("IE")).prices, null);
  process.env.STRIPE_PRICE_ID = saved;
});

test("checkout: charges in the chosen currency, defaults by region, rejects unsupported currencies", async () => {
  const { cookie } = await login();
  const checkout = (body, country) =>
    h.checkout.POST(new Request(SITE + "/api/billing/checkout", {
      method: "POST",
      headers: { "content-type": "application/json", origin: SITE, cookie, ...(country && { "x-vercel-ip-country": country }) },
      body: JSON.stringify(body),
    }));
  const stripeBody = () => decodeURIComponent(calls.filter((c) => c.url.includes("/checkout/sessions")).at(-1).body);

  calls = [];
  assert.equal((await checkout({ currency: "gbp" })).status, 200);
  assert.match(stripeBody(), /currency=gbp/);
  assert.match(stripeBody(), /price_1/);

  calls = [];
  await checkout({ currency: "eur" });
  assert.doesNotMatch(stripeBody(), /currency=/, "the price's own currency needs no override");

  calls = [];
  await checkout({}, "US");
  assert.match(stripeBody(), /currency=usd/, "no choice made: region decides");

  assert.equal((await checkout({ currency: "jpy" })).status, 400);
  stripePrice = null; resetPriceCache();
  assert.equal((await checkout({ currency: "gbp" })).status, 503, "no checkout when the price can't be confirmed");
});

test("checkout: a subscriber's currency is locked after their first payment (Stripe allows one currency per customer)", async () => {
  const { cookie } = await login();
  const id = (await db.query("SELECT id FROM accounts")).rows[0].id;
  const event = JSON.stringify({ type: "checkout.session.completed", data: { object: { mode: "subscription", client_reference_id: id, customer: "cus_9", subscription: "sub_9", currency: "GBP" } } });
  const t = Math.floor(Date.now() / 1000);
  const sig = `t=${t},v1=${crypto.createHmac("sha256", "whsec_test").update(`${t}.${event}`).digest("hex")}`;
  await h.webhook.POST(new Request(SITE + "/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": sig }, body: event }));
  assert.equal((await db.query("SELECT billing_currency c FROM accounts")).rows[0].c, "gbp");
  const me = await (await h.me.GET(req("/api/me", { method: "GET", cookie, origin: null }))).json();
  assert.equal(me.plan.billingCurrency, "gbp");

  // They cancel, then come back wanting dollars: still pounds.
  await db.query("UPDATE accounts SET subscription_status = 'canceled'");
  calls = [];
  const res = await h.checkout.POST(req("/api/billing/checkout", { cookie, body: { currency: "usd" } }));
  assert.equal(res.status, 200);
  const sent = decodeURIComponent(calls.filter((c) => c.url.includes("/checkout/sessions")).at(-1).body);
  assert.match(sent, /currency=gbp/);
  assert.doesNotMatch(sent, /currency=usd/);
});

test("combined routes dispatch by ?action= and by path, and reject unknown actions", async () => {
  // The rewrites in vercel.json send /api/auth/request to /api/auth?action=request; both forms must work.
  const viaQuery = await h.authRoute.POST(req("/api/auth?action=request", { body: { email: "not-an-email" } }));
  assert.equal(viaQuery.status, 400);
  const viaPath = await h.authRoute.POST(req("/api/auth/request", { body: { email: "not-an-email" } }));
  assert.equal(viaPath.status, 400);
  const logout = await h.authRoute.POST(req("/api/auth?action=logout", { body: {} }));
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie") || "", /Max-Age=0|Expires=/i);

  assert.equal((await h.authRoute.POST(req("/api/auth", { body: {} }))).status, 404);
  assert.equal((await h.authRoute.POST(req("/api/auth?action=constructor", { body: {} }))).status, 404);

  // Billing needs a login; unknown actions are 404, known ones reach the real handler (401 without a cookie).
  assert.equal((await h.billingRoute.POST(req("/api/billing?action=checkout", { body: {} }))).status, 401);
  assert.equal((await h.billingRoute.POST(req("/api/billing/portal", { body: {} }))).status, 401);
  assert.equal((await h.billingRoute.POST(req("/api/billing?action=nope", { body: {} }))).status, 404);

  // /api/bot/test-whatsapp is rewritten to /api/bot, whose POST is the test-alert handler.
  assert.equal((await h.botRoute.POST(req("/api/bot", { body: {} }))).status, 401);
});

test("setup fee: offered as an optional checkout add-on to first-time subscribers only, in the chosen currency", async () => {
  process.env.STRIPE_SETUP_PRICE_ID = "price_setup";
  const { cookie } = await login();
  const checkout = (body) => h.checkout.POST(req("/api/billing/checkout", { cookie, body }));
  const sent = () => decodeURIComponent(calls.filter((c) => c.url.includes("/checkout/sessions")).at(-1).body);

  // The pricing API shows the amounts so the site can mention it.
  const info = await priceFrom("IE");
  assert.deepEqual(Object.fromEntries(Object.entries(info.setup).map(([k, v]) => [k, v.display])), { eur: "€19.99", gbp: "£16.99", usd: "$22.99" });

  calls = [];
  assert.equal((await checkout({ currency: "gbp" })).status, 200);
  assert.match(sent(), /optional_items\[0\]\[price\]=price_setup/);
  assert.match(sent(), /optional_items\[0\]\[adjustable_quantity\]\[maximum\]=1/);
  assert.match(sent(), /optional_items\[0\]\[adjustable_quantity\]\[minimum\]=0/);
  assert.match(sent(), /line_items\[0\]\[price\]=price_1/, "the subscription is still the required line item");

  // Not offered once the person has a Stripe customer (already billed before).
  await db.query("UPDATE accounts SET stripe_customer_id = 'cus_1', subscription_status = 'canceled'");
  calls = [];
  assert.equal((await checkout({ currency: "eur" })).status, 200);
  assert.doesNotMatch(sent(), /optional_items/);
});

test("setup fee: no add-on when unset, invalid, or missing the chosen currency, and checkout still works", async () => {
  const { cookie } = await login();
  const checkout = (body) => h.checkout.POST(req("/api/billing/checkout", { cookie, body }));
  const sent = () => decodeURIComponent(calls.filter((c) => c.url.includes("/checkout/sessions")).at(-1).body);

  calls = [];
  assert.equal((await checkout({ currency: "eur" })).status, 200);
  assert.doesNotMatch(sent(), /optional_items/, "unset = off");
  assert.equal((await priceFrom("IE")).setup, null);

  process.env.STRIPE_SETUP_PRICE_ID = "price_setup";
  setupPrice = { ...setupPrice, recurring: { interval: "month", interval_count: 1 } };
  resetPriceCache(); calls = [];
  assert.equal((await checkout({ currency: "eur" })).status, 200);
  assert.doesNotMatch(sent(), /optional_items/, "a recurring price is not a valid setup fee");

  setupPrice = null; resetPriceCache(); calls = [];
  assert.equal((await checkout({ currency: "eur" })).status, 200, "Stripe failing on the add-on must not block the subscription");
  assert.doesNotMatch(sent(), /optional_items/);

  setupPrice = { id: "price_setup", active: true, currency: "eur", unit_amount: 1999 }; // euro only
  resetPriceCache(); calls = [];
  assert.equal((await checkout({ currency: "gbp" })).status, 200);
  assert.doesNotMatch(sent(), /optional_items/, "no sterling price for the fee, so it isn't offered in sterling");
});

test("Heario's own demo bot gets bigger limits than a customer plan", async () => {
  const { hourlyLimit, isHouseBot, monthlyLimit } = await import("../lib/plan.js");
  const house = "hb_f307f807bdebb7339ec7ca27";
  const customer = "hb_" + "c".repeat(24);
  assert.equal(isHouseBot(house), true);
  assert.equal(isHouseBot(customer), false);
  assert.equal(monthlyLimit(customer), 3000);
  assert.ok(monthlyLimit(house) > monthlyLimit(customer));
  assert.ok(hourlyLimit(house) > hourlyLimit(customer));
  process.env.HOUSE_EMBED_KEYS = "";
  try {
    assert.equal(isHouseBot(house), false, "can be switched off");
  } finally {
    delete process.env.HOUSE_EMBED_KEYS;
  }
});


test("site import: address checks block private and odd addresses", () => {
  for (const bad of ["", "localhost", "http://127.0.0.1", "https://[::1]/", "http://10.0.0.5", "https://router.local", "ftp://x.ie", "https://user:pw@x.ie", "https://x.ie:8080"]) {
    assert.equal(site.normalizeSiteUrl(bad), null, bad);
  }
  assert.equal(site.normalizeSiteUrl("murphyplumbing.ie/about#x").href, "https://murphyplumbing.ie/about");
  for (const ip of ["10.1.2.3", "172.20.0.1", "192.168.1.1", "127.0.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) {
    assert.equal(site.isPublicAddress(ip), false, ip);
  }
  for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700::1111"]) assert.equal(site.isPublicAddress(ip), true, ip);
});

test("site import: text extraction and same-site links", () => {
  const html = `<html><head><title>Murphy &amp; Sons</title><meta name="description" content="Plumbers in Cork"><style>.x{}</style></head>
    <body><nav><a href="/about">About</a><a href="/blog/2020">Blog</a><a href="https://www.murphyplumbing.ie/prices">Prices</a>
    <a href="https://other.ie/x">Other</a><a href="/brochure.pdf">PDF</a><a href="/wp-admin/">Admin</a><a href="#top">Top</a></nav>
    <script>var secret=1</script><h1>Boiler repairs &rarr; Se&aacute;n &Oacute; Briain</h1><p>Call-out &euro;80</p><ul><li>Cork city</li></ul></body></html>`;
  const t = site.htmlToText(html);
  assert.equal(t.title, "Murphy & Sons");
  assert.equal(t.description, "Plumbers in Cork");
  assert.match(t.text, /Boiler repairs → Seán Ó Briain/);
  assert.match(t.text, /Call-out €80/);
  assert.match(t.text, /- Cork city/);
  assert.doesNotMatch(t.text, /secret|\.x\{/);
  const links = site.extractLinks(html, new URL("https://murphyplumbing.ie/")).map((u) => u.pathname);
  assert.deepEqual(links, ["/about", "/prices", "/blog/2020"], "same-site pages only, useful ones first");
});

test("site import: reads the site and returns a draft without saving it", async () => {
  const { cookie } = await login();
  await h.bot.PUT(req("/api/bot", { method: "PUT", cookie, body: settings({ knowledge: "old text" }) }));
  const page = (title, body, links = "") => `<html><head><title>${title}</title></head><body><nav>${links}</nav><main>${body}</main><footer>Murphy Plumbing, Cork. Call 021 123 4567</footer></body></html>`;
  const nav = `<a href="/services">Services</a><a href="/contact">Contact</a><a href="http://internal.example/">x</a>`;
  fakeSite = {
    "https://murphyplumbing.ie/": { status: 301, headers: { location: "https://www.murphyplumbing.ie/" } },
    "https://www.murphyplumbing.ie/": { body: page("Murphy Plumbing", "<h1>Emergency plumbers in Cork</h1><p>Open 8am to 6pm, Monday to Saturday.</p>", nav) },
    "https://www.murphyplumbing.ie/services": { body: page("Services", "<h2>Boiler servicing</h2><p>Boiler service from €95. Call-out €80.</p>", nav) },
    "https://www.murphyplumbing.ie/contact": { body: page("Contact", "<p>Email hello@murphyplumbing.ie for a free quote.</p>", nav) },
  };
  claudeScript = [{ stop_reason: "end_turn", content: [{ type: "text", text: "**What we do:**\n# Emergency plumbers in Cork.\nPrices:\n- Boiler service from €95" }] }];
  const res = await h.importSite.POST(req("/api/bot/import-site", { cookie, body: { url: "murphyplumbing.ie" } }));
  const d = await res.json();
  assert.equal(res.status, 200, JSON.stringify(d));
  assert.equal(d.knowledge, "What we do:\nEmergency plumbers in Cork.\nPrices:\n- Boiler service from €95", "markdown symbols are stripped");
  assert.deepEqual(d.pages, ["https://www.murphyplumbing.ie/", "https://www.murphyplumbing.ie/services", "https://www.murphyplumbing.ie/contact"]);
  const sent = calls.find((c) => c.url.includes("anthropic")).body.messages[0].content;
  assert.match(sent, /Boiler service from €95/);
  assert.match(sent, /hello@murphyplumbing\.ie/);
  assert.equal(sent.match(/021 123 4567/g).length, 1, "footer repeated on every page is sent once");
  assert.ok(!calls.some((c) => c.url.includes("internal.example")), "other sites are never fetched");
  const bot = await db.query("SELECT knowledge FROM bots");
  assert.equal(bot.rows[0].knowledge, "old text", "nothing is saved by the import");
});

test("site import: refuses private addresses, redirects to them, and unauthenticated or cross-site calls", async () => {
  const { cookie } = await login();
  await h.bot.PUT(req("/api/bot", { method: "PUT", cookie, body: settings({ allowed_origins: "murphyplumbing.ie, sneaky.example" }) }));
  const post = (url, opts = {}) => h.importSite.POST(req("/api/bot/import-site", { cookie, body: { url }, ...opts }));
  assert.equal((await post("sneaky.example")).status, 400, "host resolving to cloud metadata IP is refused");
  fakeSite = { "https://murphyplumbing.ie/": { status: 302, headers: { location: "https://intranet.example/admin" } } };
  assert.equal((await post("murphyplumbing.ie")).status, 400, "redirect to a private host is refused");
  assert.ok(!calls.some((c) => c.url.includes("intranet.example")));
  assert.equal((await post("")).status, 400);
  assert.equal((await post("murphyplumbing.ie", { cookie: undefined })).status, 401);
  assert.equal((await post("murphyplumbing.ie", { origin: "https://evil.com" })).status, 403);
  assert.ok(!calls.some((c) => c.url.includes("anthropic")), "no AI call when nothing was read");
});

test("site import: rate limited per account", async () => {
  const { cookie } = await login();
  const codes = [];
  for (let i = 0; i < 6; i++) codes.push((await h.importSite.POST(req("/api/bot/import-site", { cookie, body: { url: "sneaky.example" } }))).status);
  assert.deepEqual(codes, [400, 400, 400, 400, 400, 429]);
});

test("bot route sends import-site and test-whatsapp to the right handler", async () => {
  const { cookie } = await login();
  const r = await h.botRoute.POST(req("/api/bot?action=import-site", { cookie, body: { url: "" } }));
  assert.equal((await r.json()).error, "Enter your website address first.");
  const w = await h.botRoute.POST(req("/api/bot?action=test-whatsapp", { cookie, body: {} }));
  assert.match((await w.json()).error, /WhatsApp/);
});

test("site import: only websites listed in the account can be read", async () => {
  const { cookie } = await login();
  await h.bot.PUT(req("/api/bot", { method: "PUT", cookie, body: settings() }));
  fakeSite = { "https://competitor.ie/": { body: "<html><body>" + "Competitor prices and secrets. ".repeat(10) + "</body></html>" } };
  const res = await h.importSite.POST(req("/api/bot/import-site", { cookie, body: { url: "competitor.ie" } }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /isn't in your list/);
  assert.ok(!calls.some((c) => c.url.includes("competitor.ie") || c.url.includes("anthropic")), "nothing is fetched or sent to the AI");
  claudeScript = [{ stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] }];
  fakeSite = { "https://murphyplumbing.ie/": { body: "<html><body>" + "We fix boilers in Cork. ".repeat(10) + "</body></html>" } };
  for (const u of ["murphyplumbing.ie", "https://www.murphyplumbing.ie/about", "http://MurphyPlumbing.ie"]) {
    const r = await (await h.importSite.POST(req("/api/bot/import-site", { cookie, body: { url: u } }))).json();
    assert.doesNotMatch(r.error ?? "", /isn't in your list/, u);
  }
});

test("site import: the connection itself only goes to public addresses", async () => {
  const lookup = (host, opts) => new Promise((resolve, reject) => site.guardedLookup(host, opts, (err, a, f) => (err ? reject(err) : resolve([a, f]))));
  await assert.rejects(lookup("sneaky.example", {}), /blocked address/);
  await assert.rejects(lookup("intranet.example", { all: true }), /blocked address/);
  await assert.rejects(lookup("nope.example", {}), /ENOTFOUND/);
  assert.deepEqual(await lookup("murphyplumbing.ie", {}), ["93.184.216.34", 4]);
  const all = await lookup("murphyplumbing.ie", { all: true });
  assert.equal(all[0][0].address, "93.184.216.34");
  const real = globalThis.__heario_pagefetch;
  delete globalThis.__heario_pagefetch;
  try {
    await assert.rejects(site.pinnedFetch(new URL("http://sneaky.example/")), /blocked address/);
  } finally { globalThis.__heario_pagefetch = real; }
});

test("replyNumber turns a visitor's phone into an international WhatsApp number, or gives up safely", () => {
  assert.equal(replyNumber("087 111 2222", "353851234567"), "353871112222");
  assert.equal(replyNumber("Call me on (087) 111-2222 after 5", "353851234567"), "353871112222");
  assert.equal(replyNumber("+44 7700 900123", "353851234567"), "447700900123");
  assert.equal(replyNumber("0044 7700 900123", "353851234567"), "447700900123");
  assert.equal(replyNumber("07700 900123", "447700900000"), "447700900123");
  assert.equal(replyNumber("(415) 555-0123", "14155550000"), "14155550123");
  assert.equal(replyNumber("087 111 2222", "4915112345678"), null, "won't guess a country it doesn't know");
  assert.equal(replyNumber("ann@example.com", "353851234567"), null);
  assert.equal(replyNumber("", "353851234567"), null);
});

test("WhatsApp alert: email contact uses the plain template; a missing reply template falls back to plain", async () => {
  const { sendEnquiryAlert } = await import("../lib/whatsapp.js");
  const realFetch = globalThis.fetch;
  const sent = [];
  try {
    globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); };
    await sendEnquiryAlert({ to: "353851234567", business: "Murphy Plumbing", name: "Ann", contact: "ann@example.com", message: "Leak" });
    assert.equal(sent[0].template.name, "new_enquiry");
    assert.equal(sent[0].template.components.length, 1, "no button parameters for the plain template");

    sent.length = 0;
    globalThis.fetch = async (url, init) => {
      const b = JSON.parse(init.body); sent.push(b);
      return b.template.name === "new_enquiry_phone" ? new Response('{"error":{"code":132001}}', { status: 404 }) : new Response("{}", { status: 200 });
    };
    await sendEnquiryAlert({ to: "353851234567", business: "Murphy Plumbing", name: "Ann", contact: "087 111 2222", message: "Leak", leadId: "9" });
    assert.deepEqual(sent.map((b) => b.template.name), ["new_enquiry_phone", "new_enquiry"]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("reply links: landlines get no reply button, long enquiries are clipped, codes can't be forged", async () => {
  assert.equal(replyNumber("01 234 5678", "353851234567"), null, "Irish landline");
  assert.equal(replyNumber("020 7946 0958", "447700900000"), null, "UK landline");
  assert.equal(replyNumber("+353 1 234 5678", "447700900000"), null, "international Irish landline");
  assert.equal(replyNumber("+49 151 12345678", "353851234567"), "4915112345678", "other countries pass through");
  assert.equal(parseReplyCode(replyCode("42")), "42");
  assert.equal(parseReplyCode("42." + replyCode("43").split(".")[1]), null);
  assert.equal(parseReplyCode("42"), null);

  const { sendEnquiryAlert } = await import("../lib/whatsapp.js");
  const realFetch = globalThis.fetch;
  let sent;
  try {
    globalThis.fetch = async (url, init) => { sent = JSON.parse(init.body); return new Response("{}", { status: 200 }); };
    await sendEnquiryAlert({ to: "353851234567", business: "B".repeat(200), name: "N".repeat(200), contact: "087 111 2222", message: "x ".repeat(400), leadId: "7" });
    const vars = sent.template.components[0].parameters.map((p) => p.text);
    assert.ok(vars[3].length <= 200 && vars[3].endsWith("\u2026"));
    assert.ok(vars[0].length <= 60 && vars[1].length <= 50);
    assert.ok(vars.join("").length + 150 < 550, "whole alert stays under the 550-character body limit");
    await sendEnquiryAlert({ to: "353851234567", business: "B", name: "N", contact: "087 111 2222", message: "m" });
    assert.equal(sent.template.name, "new_enquiry", "no lead id, no reply button");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("reply links: European local mobiles are read in the owner's own country format; landlines and unclear numbers aren't", () => {
  const DE = "4915112345678", FR = "33612345678", ES = "34612345678", IT = "393471234567", HU = "36201234567", PL = "48512345678", NL = "31612345678";
  assert.equal(replyNumber("0151 2345 6789", DE), "4915123456789");
  assert.equal(replyNumber("030 1234567", DE), null, "Berlin landline");
  assert.equal(replyNumber("06 12 34 56 78", FR), "33612345678");
  assert.equal(replyNumber("01 23 45 67 89", FR), null, "Paris landline");
  assert.equal(replyNumber("06-12345678", NL), "31612345678");
  assert.equal(replyNumber("612 345 678", ES), "34612345678");
  assert.equal(replyNumber("91 123 45 67", ES), null, "Madrid landline");
  assert.equal(replyNumber("347 123 4567", IT), "393471234567");
  assert.equal(replyNumber("06 1234 5678", IT), null, "Rome landline");
  assert.equal(replyNumber("06 20 123 4567", HU), "36201234567");
  assert.equal(replyNumber("512 345 678", PL), "48512345678");
  assert.equal(replyNumber("087 111 2222", DE), null, "an Irish-looking local number isn't forced into German");
  assert.equal(replyNumber("+49 30 1234567", "353851234567"), null, "international German landline");
  assert.equal(replyNumber("+33 6 12 34 56 78", "353851234567"), "33612345678");
  assert.equal(replyNumber("12345678", "4512345678"), null, "Denmark isn't listed: local numbers get no button");
  assert.equal(replyNumber("+45 12 34 56 78", "353851234567"), "4512345678", "unlisted countries' international numbers pass through as before");
  // Ireland, UK and North America are unchanged.
  assert.equal(replyNumber("087 111 2222", "353851234567"), "353871112222");
  assert.equal(replyNumber("07700 900123", "447700900000"), "447700900123");
  assert.equal(replyNumber("(415) 555-0123", "14155550000"), "14155550123");
});

// Makes one real enquiry through the chat endpoint; returns the dashboard cookie.
async function makeEnquiry(over = {}) {
  const { cookie } = await login();
  await h.bot.PUT(req("/api/bot", { method: "PUT", cookie, body: settings(over) }));
  const key = (await (await h.me.GET(req("/api/me", { method: "GET", cookie, origin: null }))).json()).bot.embed_key;
  calls = [];
  claudeScript = [
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "notify_owner", input: { name: "Ann", contact: "0871112222", enquiry: "Boiler not working" } }] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "Thanks." }] },
  ];
  await h.chat.POST(req("/api/chat", { body: { key, messages: [{ role: "user", content: "boiler" }] }, origin: "https://murphyplumbing.ie" }));
  return cookie;
}
const leadRow = async () => (await db.query("SELECT whatsapp_status, wa_message_id, emailed_at FROM leads")).rows[0];
const hook = (payload, secret = process.env.WHATSAPP_APP_SECRET) => {
  const raw = JSON.stringify(payload);
  const sig = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  return h.leads.POST(new Request(SITE + "/api/leads?action=wa-webhook", { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": sig }, body: raw }));
};
const statusReport = (status, extra = {}) => ({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { statuses: [{ id: "wamid", status, ...extra }] } }] }] });

test("email copy is off by default, and on when the owner ticks it", async () => {
  let cookie = await makeEnquiry();
  assert.ok(!calls.some((c) => c.url.includes("brevo")), "no email when WhatsApp sent and copy is off");
  let me = await (await h.me.GET(req("/api/me", { method: "GET", cookie, origin: null }))).json();
  assert.equal(me.bot.email_copy, false);
  assert.equal((await leadRow()).wa_message_id, "wamid");

  await db.exec("TRUNCATE accounts, login_tokens, rate_limits CASCADE");
  cookie = await makeEnquiry({ email_copy: true });
  const mail = calls.find((c) => c.url.includes("brevo"));
  assert.ok(mail, "copy emailed");
  assert.match(mail.body.textContent, /A copy of your WhatsApp alert[\s\S]*Name: Ann[\s\S]*dashboard\.html/);
  const row = await leadRow();
  assert.equal(row.whatsapp_status, "sent");
  assert.ok(row.emailed_at);
  me = await (await h.me.GET(req("/api/me", { method: "GET", cookie, origin: null }))).json();
  assert.equal(me.bot.email_copy, true);
});

test("WhatsApp webhook: Meta's check, signatures, delivered/read, and a late failure emails the enquiry once", async () => {
  const get = (q) => h.leads.GET(new Request(SITE + "/api/leads?action=wa-webhook&" + q, { method: "GET" }));
  const okv = await get("hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345");
  assert.equal(okv.status, 200);
  assert.equal(await okv.text(), "12345");
  assert.equal((await get("hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1")).status, 403);

  await makeEnquiry();
  assert.equal((await hook(statusReport("failed"), "not-the-secret")).status, 401, "unsigned reports are refused");
  assert.equal((await leadRow()).whatsapp_status, "sent");

  await hook(statusReport("read"));
  assert.equal((await leadRow()).whatsapp_status, "read");
  await hook(statusReport("delivered"));
  assert.equal((await leadRow()).whatsapp_status, "read", "a late 'delivered' doesn't move it backwards");

  calls = [];
  const failed = statusReport("failed", { errors: [{ code: 131026, title: "Message undeliverable" }] });
  assert.equal((await hook(failed)).status, 200);
  assert.equal(calls.filter((c) => c.url.includes("brevo")).length, 1);
  assert.match(calls.find((c) => c.url.includes("brevo")).body.textContent, /couldn't deliver this enquiry to your WhatsApp[\s\S]*Ann/);
  assert.equal((await leadRow()).whatsapp_status, "failed_emailed");
  await hook(failed);
  assert.equal(calls.filter((c) => c.url.includes("brevo")).length, 1, "a repeated report doesn't email twice");

  await hook({ entry: [{ changes: [{ value: { statuses: [{ id: "unknown", status: "failed" }] } }] }] });
  assert.equal((await hook({ hello: "world" })).status, 200, "odd payloads are ignored");
});

test("WhatsApp webhook: copy already emailed -> no second email on failure; email outage -> marked failed and retried next time", async () => {
  await makeEnquiry({ email_copy: true });
  calls = [];
  await hook(statusReport("failed"));
  assert.equal(calls.filter((c) => c.url.includes("brevo")).length, 0, "they already have it by email");
  assert.equal((await leadRow()).whatsapp_status, "failed_emailed");

  await db.exec("TRUNCATE accounts, login_tokens, rate_limits CASCADE");
  await makeEnquiry();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => (String(url).includes("brevo") ? new Response("down", { status: 500 }) : realFetch(url, init));
  let first;
  try { first = await hook(statusReport("failed")); } finally { globalThis.fetch = realFetch; }
  assert.equal(first.status, 500, "asks Meta to retry when the backup email couldn't be sent");
  let row = await leadRow();
  assert.equal(row.whatsapp_status, "failed");
  assert.equal(row.emailed_at, null);
  calls = [];
  await hook(statusReport("failed"));
  assert.equal(calls.filter((c) => c.url.includes("brevo")).length, 1, "Meta's retry gets it emailed");
  assert.equal((await leadRow()).whatsapp_status, "failed_emailed");
});

test("reply link and webhook work whether Vercel passes the original or the rewritten URL", async () => {
  await makeEnquiry();
  const code = calls.find((c) => c.url.includes("graph.facebook")).body.template.components[1].parameters[0].text;
  const viaPath = await h.leads.GET(new Request(SITE + "/r/" + code, { method: "GET" }));
  assert.match(viaPath.headers.get("location"), /^https:\/\/wa\.me\/353871112222\?text=/);
  const v = await h.leads.GET(new Request(SITE + "/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=777", { method: "GET" }));
  assert.equal(await v.text(), "777");
  const raw = JSON.stringify(statusReport("delivered"));
  const sig = "sha256=" + crypto.createHmac("sha256", process.env.WHATSAPP_APP_SECRET).update(raw).digest("hex");
  const p = await h.leads.POST(new Request(SITE + "/api/whatsapp/webhook", { method: "POST", headers: { "x-hub-signature-256": sig }, body: raw }));
  assert.equal(p.status, 200);
  assert.equal((await leadRow()).whatsapp_status, "delivered");
});

test("a failure report that lands before the chat finishes still finds the enquiry, and isn't overwritten", async () => {
  // Meta's 'failed' report arrives while the chat is still sending the copy email, before its final update.
  const realFetch = globalThis.fetch;
  try {
    const cookie = await (async () => {
      const { cookie } = await login();
      await h.bot.PUT(req("/api/bot", { method: "PUT", cookie, body: settings({ email_copy: true }) }));
      return cookie;
    })();
    const key = (await (await h.me.GET(req("/api/me", { method: "GET", cookie, origin: null }))).json()).bot.embed_key;
    let reported = false;
    const emailFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      // The copy email is the step after WhatsApp; Meta's failure report arrives first.
      if (String(url).includes("brevo") && !reported) { reported = true; await hook(statusReport("failed")); }
      return emailFetch(url, init);
    };
    calls = [];
    claudeScript = [
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "notify_owner", input: { name: "Ann", contact: "0871112222", enquiry: "Boiler" } }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Thanks." }] },
    ];
    await h.chat.POST(req("/api/chat", { body: { key, messages: [{ role: "user", content: "boiler" }] }, origin: "https://murphyplumbing.ie" }));
    const row = await leadRow();
    assert.ok(reported);
    assert.equal(row.whatsapp_status, "failed_emailed", "the chat's own update doesn't put it back to 'sent'");
    assert.ok(row.emailed_at);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// One enquiry through the chat with any notify_owner input; returns { cookie, chatOut }.
async function enquire(input, over = {}) {
  const { cookie } = await login();
  await h.bot.PUT(req("/api/bot", { method: "PUT", cookie, body: settings(over) }));
  const key = (await (await h.me.GET(req("/api/me", { method: "GET", cookie, origin: null }))).json()).bot.embed_key;
  calls = [];
  claudeScript = [
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "notify_owner", input }] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "Thanks." }] },
  ];
  await h.chat.POST(req("/api/chat", { body: { key, messages: [{ role: "user", content: "help" }] }, origin: "https://murphyplumbing.ie" }));
  return { cookie };
}

test("urgent enquiries are flagged in WhatsApp, email and the dashboard; the prompt sends danger to emergency services", async () => {
  const { cookie } = await enquire({ name: "Ann", contact: "0871112222", enquiry: "Water pouring through the ceiling", urgent: true });
  const wa = calls.find((c) => c.url.includes("graph.facebook"));
  assert.equal(wa.body.template.components[0].parameters[3].text, "\u{1F6A8} URGENT: Water pouring through the ceiling");
  const claude = calls.find((c) => c.url.includes("anthropic")).body;
  assert.ok(claude.tools[0].input_schema.properties.urgent);
  assert.match(claude.system, /emergency services/);
  const leads = await (await h.leads.GET(req("/api/leads", { method: "GET", cookie, origin: null }))).json();
  assert.equal(leads.leads[0].urgent, true);
  assert.equal(leads.leads[0].stage, "new");

  await db.exec("TRUNCATE accounts, login_tokens, rate_limits CASCADE");
  await enquire({ name: "Ann", contact: "0871112222", enquiry: "Leak", urgent: true }, { owner_whatsapp: "", whatsapp_consent: false });
  const mail = calls.find((c) => c.url.includes("brevo") && c.body.to[0].email === "owner@example.com");
  assert.match(mail.body.subject, /^URGENT: New website enquiry from Ann/);
  assert.match(mail.body.textContent, /URGENT: they need help today/);

  await db.exec("TRUNCATE accounts, login_tokens, rate_limits CASCADE");
  await enquire({ name: "Ann", contact: "0871112222", enquiry: "Quote for a bathroom" });
  assert.equal(calls.find((c) => c.url.includes("graph.facebook")).body.template.components[0].parameters[3].text, "Quote for a bathroom");
});

test("visitor confirmation: sent in the business's name with replies to the owner, can be switched off, and can't be used to spam", async () => {
  await enquire({ name: "Ann Byrne", contact: "ann@example.com", enquiry: "Boiler service" });
  const conf = calls.find((c) => c.url.includes("brevo") && c.body.to[0].email === "ann@example.com");
  assert.ok(conf, "visitor got a confirmation");
  assert.equal(conf.body.sender.name, "Murphy Plumbing via Heario");
  assert.deepEqual(conf.body.replyTo, { email: "owner@example.com" });
  assert.match(conf.body.textContent, /^Hi Ann,[\s\S]*Sean will be in touch within 2 hours[\s\S]*Your enquiry: Boiler service/);
  const toolResult = calls.filter((c) => c.url.includes("anthropic"))[1].body.messages.at(-1).content[0].content;
  assert.match(toolResult, /confirmation email has been sent to the visitor/);

  // Phone only -> nothing to confirm to.
  await db.exec("TRUNCATE accounts, login_tokens, rate_limits CASCADE");
  await enquire({ name: "Ann", contact: "087 111 2222", enquiry: "Leak" });
  assert.ok(!calls.some((c) => c.url.includes("brevo")));

  // Owner switched it off.
  await db.exec("TRUNCATE accounts, login_tokens, rate_limits CASCADE");
  const { cookie } = await enquire({ name: "Ann", contact: "ann@example.com", enquiry: "Leak" }, { confirm_visitor: false });
  assert.ok(!calls.some((c) => c.url.includes("brevo") && c.body.to[0].email === "ann@example.com"));
  const me = await (await h.me.GET(req("/api/me", { method: "GET", cookie, origin: null }))).json();
  assert.equal(me.bot.confirm_visitor, false);

  // Same address, many enquiries: at most 2 confirmations a day.
  await db.exec("TRUNCATE accounts, login_tokens, rate_limits CASCADE");
  let sent = 0;
  const { cookie: c2 } = await login();
  await h.bot.PUT(req("/api/bot", { method: "PUT", cookie: c2, body: settings() }));
  const key = (await (await h.me.GET(req("/api/me", { method: "GET", cookie: c2, origin: null }))).json()).bot.embed_key;
  const realFetch = globalThis.fetch;
  let n = 0;
  globalThis.fetch = (url, init) => String(url).includes("graph.facebook") ? Promise.resolve(new Response(JSON.stringify({ messages: [{ id: "wamid-" + n++ }] }))).then((r) => { calls.push({ url: String(url), body: JSON.parse(init.body) }); return r; }) : realFetch(url, init);
  for (let i = 0; i < 4; i++) {
    calls = [];
    claudeScript = [
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t" + i, name: "notify_owner", input: { name: "X", contact: "victim@example.com", enquiry: "hi " + i } }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] },
    ];
    await h.chat.POST(new Request(SITE + "/api/chat", { method: "POST", headers: { "content-type": "application/json", origin: "https://murphyplumbing.ie", "x-forwarded-for": "10.0.0." + i }, body: JSON.stringify({ key, messages: [{ role: "user", content: "hi" }] }) }));
    sent += calls.filter((c) => c.url.includes("brevo") && c.body.to[0].email === "victim@example.com").length;
  }
  globalThis.fetch = realFetch;
  assert.equal(sent, 2);
});

test("enquiry status and notes: owner can update their own, not anyone else's; bad input refused", async () => {
  const { cookie } = await enquire({ name: "Ann", contact: "0871112222", enquiry: "Leak" });
  const id = (await (await h.leads.GET(req("/api/leads", { method: "GET", cookie, origin: null }))).json()).leads[0].id;
  const patch = (body, opts = {}) => h.leads.PATCH(req("/api/leads", { method: "PATCH", cookie, body, ...opts }));

  let r = await patch({ id, stage: "contacted", note: "  Called, coming Tuesday  " });
  assert.equal(r.status, 200);
  const lead = (await r.json()).lead;
  assert.equal(lead.stage, "contacted");
  assert.equal(lead.note, "Called, coming Tuesday");
  r = await patch({ id, stage: "won" });
  assert.equal((await r.json()).lead.note, "Called, coming Tuesday", "changing status keeps the note");
  assert.equal((await patch({ id, stage: "maybe" })).status, 400);
  assert.equal((await patch({ id: "1; DROP TABLE leads", stage: "won" })).status, 400);
  assert.equal((await patch({ id, note: "x".repeat(900) })).status, 200);
  assert.equal((await db.query("SELECT length(note) AS n FROM leads")).rows[0].n, 500);
  assert.equal((await patch({ id, stage: "lost" }, { origin: "https://evil.com" })).status, 403);
  assert.equal((await h.leads.PATCH(req("/api/leads", { method: "PATCH", body: { id, stage: "lost" } }))).status, 401);

  const other = await login("someone-else@example.com");
  assert.equal((await h.leads.PATCH(req("/api/leads", { method: "PATCH", cookie: other.cookie, body: { id, stage: "lost" } }))).status, 404);
  assert.equal((await db.query("SELECT stage FROM leads")).rows[0].stage, "won");
});

test("spreadsheet export uses the owner's time zone, falls back to UTC, and refuses without login", async () => {
  const { cookie } = await enquire({ name: "Zone", contact: "087 111 2222", enquiry: "Time zone check" });
  await db.query("UPDATE leads SET created_at = '2026-07-01T12:30:00Z'");
  const get = async (q) => (await h.leads.GET(req("/api/leads?format=csv" + q, { method: "GET", cookie, origin: null }))).text();
  const dub = (await get("&tz=Europe/Dublin")).split("\r\n");
  assert.ok(dub[0].includes('"Date (Europe/Dublin)"'));
  assert.ok(dub[1].startsWith('"2026-07-01 13:30"'), dub[1]);
  const bad = (await get("&tz=Not/AZone")).split("\r\n");
  assert.ok(bad[0].includes('"Date (UTC)"') && bad[1].startsWith('"2026-07-01 12:30"'));
  assert.equal((await h.leads.GET(req("/api/leads?format=csv", { method: "GET", origin: null }))).status, 401);
});

test("spreadsheet export: the owner's enquiries only, Excel-friendly, formulas defused", async () => {
  const { cookie } = await enquire({ name: "=HYPERLINK(\"http://evil\")", contact: "+353 87 111 2222", enquiry: "Needs \"urgent\" help, today", urgent: true });
  const id = (await (await h.leads.GET(req("/api/leads", { method: "GET", cookie, origin: null }))).json()).leads[0].id;
  await h.leads.PATCH(req("/api/leads", { method: "PATCH", cookie, body: { id, stage: "contacted", note: "@sean call back" } }));
  const res = await h.leads.GET(req("/api/leads?format=csv", { method: "GET", cookie, origin: null }));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /^text\/csv/);
  assert.match(res.headers.get("content-disposition"), /attachment; filename="heario-enquiries-\d{4}-\d{2}-\d{2}\.csv"/);
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], "BOM so Excel reads euro signs and fadas");
  const text = new TextDecoder().decode(bytes);
  assert.ok(text.startsWith('"Date (UTC)","Name"'));
  const row = text.split("\r\n")[1];
  assert.match(row, /,"'=HYPERLINK\(""http:\/\/evil""\)",/, "formula defused and quotes escaped");
  assert.match(row, /,"\+353 87 111 2222",/, "phone numbers left alone");
  assert.match(row, /"Yes","Contacted","'@sean call back"/);
  const other = await login("someone-else@example.com");
  const theirs = await (await h.leads.GET(req("/api/leads?format=csv", { method: "GET", cookie: other.cookie, origin: null }))).text();
  assert.equal(theirs.split("\r\n").filter(Boolean).length, 1, "another account sees only the header row");
});

// A chat turn where the AI logs a question it couldn't answer; returns { cookie, key, reply }.
async function askUnknown(question, { cookie, key } = {}) {
  if (!cookie) {
    ({ cookie } = await login());
    await h.bot.PUT(req("/api/bot", { method: "PUT", cookie, body: settings() }));
    key = (await (await h.me.GET(req("/api/me", { method: "GET", cookie, origin: null }))).json()).bot.embed_key;
  }
  calls = [];
  claudeScript = [
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "q1", name: "log_unanswered_question", input: { question } }] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "I'm not sure, but I can pass that on." }] },
  ];
  const res = await h.chat.POST(req("/api/chat", { body: { key, messages: [{ role: "user", content: question }] }, origin: "https://murphyplumbing.ie" }));
  return { cookie, key, reply: (await res.json()).reply };
}
const openQuestions = async (cookie) => (await (await h.botRoute.GET(req("/api/bot/questions", { method: "GET", cookie, origin: null }))).json()).questions;

test("unanswered questions: recorded from the chat, personal details scrubbed, repeats counted, the visitor still gets a reply", async () => {
  const a = await askUnknown("Do you work on Sundays?");
  assert.equal(a.reply, "I'm not sure, but I can pass that on.");
  const sys = calls.find((c) => c.url.includes("anthropic")).body;
  assert.ok(sys.tools.some((t) => t.name === "log_unanswered_question"));
  assert.match(sys.system, /log_unanswered_question/);
  await askUnknown("do you work on sundays?", a);
  await askUnknown("Can Ann at ann@x.ie or 087 123 4567 get a discount for 2 jobs?", a);
  const qs = await openQuestions(a.cookie);
  assert.equal(qs.length, 2);
  assert.equal(qs[0].question, "Do you work on Sundays?");
  assert.equal(qs[0].times, 2);
  assert.equal(qs[1].question, "Can Ann at [email] or [number] get a discount for 2 jobs?");
  const other = await login("someone-else@example.com");
  assert.equal((await openQuestions(other.cookie)).length, 0, "another account sees none");
  assert.equal((await h.botRoute.GET(req("/api/bot/questions", { method: "GET", origin: null }))).status, 401);
});

test("unanswered questions: limited per visitor so the list can't be flooded", async () => {
  let a = null;
  for (let i = 0; i < 8; i++) a = await askUnknown("Question number " + "abcdefgh"[i] + "?", a || undefined);
  assert.equal((await openQuestions(a.cookie)).length, 5);
});

test("Add an answer appends Q/A to the business information, goes live in the prompt, and can't be done twice or by others", async () => {
  const a = await askUnknown("Do you work on Sundays?");
  const [q] = await openQuestions(a.cookie);
  const post = (action, body, cookie = a.cookie) => h.botRoute.POST(req("/api/bot/" + action, { body, cookie }));
  assert.equal((await post("answer-question", { id: q.id, answer: "  " })).status, 400);
  assert.equal((await post("answer-question", { id: q.id, answer: "x".repeat(1001) })).status, 400);
  const other = await login("someone-else@example.com");
  assert.equal((await post("answer-question", { id: q.id, answer: "Yes" }, other.cookie)).status, 404);
  const res = await (await post("answer-question", { id: q.id, answer: "Yes, 10am to 4pm, at the normal rate." })).json();
  assert.equal(res.added, "Q: Do you work on Sundays?\nA: Yes, 10am to 4pm, at the normal rate.");
  assert.equal(res.knowledge, "We fix boilers. Call-out is 80 euro.\n\n" + res.added);
  assert.equal((await post("answer-question", { id: q.id, answer: "Again" })).status, 404, "double click doesn't add it twice");
  assert.equal((await openQuestions(a.cookie)).length, 0);
  await askUnknown("Anything else?", a);
  assert.ok(calls.find((c) => c.url.includes("anthropic")).body.system.includes("A: Yes, 10am to 4pm"), "the assistant now knows");
  assert.equal((await h.botRoute.POST(req("/api/bot/answer-question", { body: { id: q.id, answer: "x" }, cookie: a.cookie, origin: "https://evil.com" }))).status, 403);
});

test("Add an answer refuses when the business information is full, and leaves the question open; dismiss hides it", async () => {
  const a = await askUnknown("Do you do gas certs?");
  await db.query("UPDATE bots SET knowledge = $1", ["k".repeat(7990)]);
  const [q] = await openQuestions(a.cookie);
  const r = await h.botRoute.POST(req("/api/bot/answer-question", { body: { id: q.id, answer: "Yes we do, 120 euro." }, cookie: a.cookie }));
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /full/);
  assert.equal((await openQuestions(a.cookie)).length, 1, "still open");
  assert.equal((await db.query("SELECT length(knowledge) n FROM bots")).rows[0].n, 7990);
  assert.equal((await h.botRoute.POST(req("/api/bot/dismiss-question", { body: { id: q.id }, cookie: a.cookie }))).status, 200);
  assert.equal((await openQuestions(a.cookie)).length, 0);
  await askUnknown("Do you do gas certs?", a);
  assert.equal((await openQuestions(a.cookie)).length, 1, "asked again later -> shows again");
});

test("cron cleanup removes old questions too", async () => {
  process.env.CRON_SECRET = "s3cret";
  const a = await askUnknown("Old question?");
  await db.query("UPDATE questions SET last_asked_at = now() - interval '100 days'");
  const res = await (await h.cron.GET(new Request(SITE + "/api/cron/cleanup", { headers: { authorization: "Bearer s3cret" } }))).json();
  assert.equal(res.questions, 1);
  assert.equal((await openQuestions(a.cookie)).length, 0);
});

test("Add an answer: the owner can tidy the question wording first; edited wording is still scrubbed", async () => {
  const a = await askUnknown("do u do sundays??");
  const [q] = await openQuestions(a.cookie);
  const post = (body) => h.botRoute.POST(req("/api/bot/answer-question", { body: { id: q.id, ...body }, cookie: a.cookie }));
  assert.equal((await post({ question: "  ", answer: "Yes" })).status, 400);
  const res = await (await post({ question: "Do you work on Sundays? Call 087 123 4567", answer: "Yes, 10am to 4pm." })).json();
  assert.equal(res.added, "Q: Do you work on Sundays? Call [number]\nA: Yes, 10am to 4pm.");
});

const hoursLib = await import("../lib/hours.js");
const WEEKDAYS = { mon: ["09:00", "17:30"], tue: ["09:00", "17:30"], wed: ["09:00", "17:30"], thu: ["09:00", "17:30"], fri: ["09:00", "17:30"], sat: ["10:00", "14:00"], sun: null };

test("opening hours: validation", () => {
  const p = hoursLib.parseHoursInput;
  assert.deepEqual(p(null), { value: "" });
  assert.match(p({ tz: "Mars/Base", days: WEEKDAYS }).error, /time zone/);
  assert.match(p({ tz: "Europe/Dublin", days: { mon: ["17:00", "09:00"] } }).error, /Monday.*after/);
  assert.match(p({ tz: "Europe/Dublin", days: { mon: ["9am", "5pm"] } }).error, /Monday/);
  assert.match(p({ tz: "Europe/Dublin", days: {} }).error, /at least one day/);
  const ok = JSON.parse(p({ tz: "Europe/Dublin", days: { ...WEEKDAYS, junk: ["x"] } }).value);
  assert.deepEqual(Object.keys(ok.days), hoursLib.DAYS, "only real days are kept");
});

test("opening hours: open/closed and when we next open, in the business's own time zone", () => {
  const h = { tz: "Europe/Dublin", days: WEEKDAYS };
  const at = (iso) => hoursLib.hoursStatus(h, new Date(iso));
  assert.equal(at("2026-11-23T10:00:00Z").open, true, "Monday 10am");
  assert.deepEqual([at("2026-11-23T07:00:00Z").next, at("2026-11-23T07:00:00Z").nextDated], ["later today at 9am", "today at 9am"]);
  assert.equal(at("2026-11-23T17:30:00Z").next, "tomorrow at 9am", "closing time itself counts as closed");
  assert.equal(at("2026-11-28T15:00:00Z").next, "on Monday at 9am", "Saturday after 2pm skips closed Sunday");
  assert.equal(at("2026-11-28T15:00:00Z").nextDated, "on Monday at 9am");
  assert.equal(at("2026-11-27T18:00:00Z").next, "tomorrow at 10am", "Friday evening -> Saturday");
  assert.equal(at("2026-07-06T08:30:00Z").open, true, "summer time: 8:30 UTC is 9:30 in Dublin");
  const ny = hoursLib.hoursStatus({ tz: "America/New_York", days: WEEKDAYS }, new Date("2026-11-23T10:00:00Z"));
  assert.deepEqual([ny.open, ny.next], [false, "later today at 9am"], "10:00 UTC is 5am in New York");
  assert.equal(hoursLib.clock("17:30"), "5:30pm");
  assert.equal(hoursLib.clock("00:00"), "12am");
  assert.equal(hoursLib.hoursStatus(null), null);
});

test("booking link and opening hours: saved, validated, shown in the dashboard and the widget config", async () => {
  const { cookie } = await login();
  const put = (over) => h.bot.PUT(req("/api/bot", { method: "PUT", cookie, body: settings(over) }));
  assert.equal((await put({ booking_url: "http://calendly.com/sean" })).status, 400, "https only");
  assert.equal((await put({ booking_url: "javascript:alert(1)" })).status, 400);
  assert.equal((await put({ opening_hours: { tz: "Europe/Dublin", days: { mon: ["18:00", "09:00"] } } })).status, 400);
  const saved = await (await put({ booking_url: "calendly.com/murphy-plumbing", opening_hours: { tz: "Europe/Dublin", days: WEEKDAYS } })).json();
  assert.equal(saved.bot.booking_url, "https://calendly.com/murphy-plumbing");
  assert.equal(saved.bot.opening_hours.tz, "Europe/Dublin");
  assert.deepEqual(saved.bot.opening_hours.days.sat, ["10:00", "14:00"]);
  const me = await (await h.me.GET(req("/api/me", { method: "GET", cookie, origin: null }))).json();
  const cfg = await (await h.widget.GET(new Request(`${SITE}/api/widget-config?key=${me.bot.embed_key}`, { headers: { origin: "https://murphyplumbing.ie" } }))).json();
  assert.equal(cfg.booking_url, "https://calendly.com/murphy-plumbing");
  const cleared = await (await put({ booking_url: "", opening_hours: null })).json();
  assert.deepEqual([cleared.bot.booking_url, cleared.bot.opening_hours], ["", null]);
});

test("the prompt: booking link offered; outside hours no 'within 2 hours' promise; during hours unchanged", async () => {
  const bot = { business_name: "Murphy Plumbing", owner_name: "Sean", response_time: "within 2 hours", knowledge: "x",
    booking_url: "https://calendly.com/murphy", opening_hours: JSON.stringify({ tz: "Europe/Dublin", days: WEEKDAYS }) };
  const closed = h.chat.systemPrompt(bot, new Date("2026-11-27T21:00:00Z"));
  assert.match(closed, /calendly\.com\/murphy/);
  assert.match(closed, /Sean will be in touch when Murphy Plumbing opens tomorrow at 10am/);
  assert.match(closed, /It is now Friday 9pm there, so Murphy Plumbing is closed/);
  assert.match(closed, /Don't promise a reply within 2 hours/);
  const open = h.chat.systemPrompt(bot, new Date("2026-11-27T11:00:00Z"));
  assert.match(open, /Sean will be in touch within 2 hours/);
  assert.match(open, /is open\./);
  const plain = h.chat.systemPrompt({ ...bot, booking_url: "", opening_hours: "" });
  assert.ok(!/BOOKING|OPENING HOURS/.test(plain), "nothing added when not set");
  assert.equal(h.chat.replyWhen(bot, new Date("2026-11-27T21:00:00Z"), true).when, "when Murphy Plumbing opens on Saturday at 10am", "emails name the day");
});

test("holiday closures: validation, and closed-until / reopening worked out around them", () => {
  const p = hoursLib.parseHoursInput;
  assert.match(p({ tz: "Europe/Dublin", days: null, closed: [["2026-12-25", "2026-12-24"]] }).error, /on or after/);
  assert.match(p({ tz: "Europe/Dublin", days: null, closed: [["2026-02-30", "2026-03-01"]] }).error, /start and end date/);
  assert.match(p({ tz: "Europe/Dublin", days: null, closed: Array(21).fill(["2026-12-25", "2026-12-25"]) }).error, /up to 20/);
  assert.deepEqual(p({ tz: "Europe/Dublin", days: null, closed: [["", ""]] }), { value: "" }, "empty rows are ignored");
  const xmas = [["2026-12-24", "2027-01-02"], ["2027-01-03", "2027-01-03"]];
  const withHours = hoursLib.readHours(p({ tz: "Europe/Dublin", days: WEEKDAYS, closed: xmas }).value);
  const s = hoursLib.hoursStatus(withHours, new Date("2026-12-25T12:00:00Z"));
  assert.equal(s.open, false);
  assert.equal(s.holiday, true);
  assert.equal(s.until, "Sunday 3 January", "back-to-back closures are joined");
  assert.equal(s.next, "on Monday 4 January at 9am");
  const eve = hoursLib.hoursStatus(withHours, new Date("2026-12-23T18:00:00Z"));
  assert.equal(eve.next, "on Monday 4 January at 9am", "evening before a closure skips it");
  assert.equal(hoursLib.hoursStatus(withHours, new Date("2026-12-23T12:00:00Z")).open, true);
  const datesOnly = hoursLib.readHours(p({ tz: "America/New_York", days: null, closed: [["2026-11-26", "2026-11-27"]] }).value);
  const t = hoursLib.hoursStatus(datesOnly, new Date("2026-11-26T15:00:00Z"));
  assert.deepEqual([t.open, t.next, t.until], [false, "on Saturday, November 28", "Friday, November 27"], "no weekly hours: back the day after, US date style");
  assert.equal(hoursLib.hoursStatus(datesOnly, new Date("2026-11-25T15:00:00Z")).unknown, true, "outside closures with no weekly hours, nothing is claimed");
});

test("the prompt: holidays announced and listed; weekly hours override the business information", async () => {
  const bot = { business_name: "Murphy Plumbing", owner_name: "Sean", response_time: "within 2 hours", knowledge: "Open 8 to 8",
    opening_hours: JSON.stringify({ tz: "Europe/Dublin", days: WEEKDAYS, closed: [["2026-12-24", "2027-01-02"]] }) };
  const xmas = h.chat.systemPrompt(bot, new Date("2026-12-27T10:00:00Z"));
  assert.match(xmas, /closed for a holiday \(the last closed day is Saturday 2 January\)/);
  assert.match(xmas, /Sean will be in touch when Murphy Plumbing opens on Monday 4 January at 9am/);
  assert.match(xmas, /HOLIDAY CLOSURES \(closed all day\): Thursday 24 December to Saturday 2 January/);
  assert.match(xmas, /if the business information says otherwise, go by these/);
  const nov = h.chat.systemPrompt(bot, new Date("2026-11-23T10:00:00Z"));
  assert.match(nov, /HOLIDAY CLOSURES/, "upcoming closure is mentioned so visitors can ask about Christmas");
  assert.match(nov, /Sean will be in touch within 2 hours/);
  const datesOnly = { ...bot, opening_hours: JSON.stringify({ tz: "Europe/Dublin", days: null, closed: [["2026-12-24", "2027-01-02"]] }) };
  const plain = h.chat.systemPrompt(datesOnly, new Date("2026-11-23T10:00:00Z"));
  assert.ok(!/OPENING HOURS|It is now/.test(plain), "no weekly hours and not closed: no claims about being open");
  assert.match(h.chat.systemPrompt(datesOnly, new Date("2026-12-30T10:00:00Z")), /opens again on Sunday 3 January/);
});

test("closures save through the dashboard API and come back", async () => {
  const { cookie } = await login();
  const res = await (await h.bot.PUT(req("/api/bot", { method: "PUT", cookie, body: settings({ opening_hours: { tz: "Europe/Dublin", days: null, closed: [["2026-12-24", "2027-01-02"]] } }) }))).json();
  assert.deepEqual(res.bot.opening_hours, { tz: "Europe/Dublin", days: null, closed: [["2026-12-24", "2027-01-02"]] });
});
