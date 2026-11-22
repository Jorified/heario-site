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
const { normalizeNumber } = await import("../lib/whatsapp.js");
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
