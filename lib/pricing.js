// Price comes from ONE Stripe Price (set in STRIPE_PRICE_ID) that has EUR, GBP and USD amounts.
// The site never hard-codes an amount, so what visitors see is what Stripe charges.
import { stripe } from "./stripe.js";

export const CURRENCIES = ["eur", "gbp", "usd"];
const LOCALES = { eur: "en-IE", gbp: "en-GB", usd: "en-US" };

// UK -> pounds, US -> dollars, everyone else (Ireland, the EU and the rest of the world) -> euro.
export function currencyForCountry(country) {
  const c = String(country || "").toUpperCase();
  if (c === "GB") return "gbp";
  if (c === "US") return "usd";
  return "eur";
}

export function formatMoney(minorUnits, currency) {
  const major = minorUnits / 100;
  return new Intl.NumberFormat(LOCALES[currency] || "en-IE", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: Number.isInteger(major) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(major);
}

let cache = null; // { at, ttl, data }
let setupCache = null;
export const resetPriceCache = () => { cache = null; setupCache = null; };

// Reads the amounts of a Stripe Price in every currency we offer.
function amountsOf(p) {
  const amounts = {};
  if (CURRENCIES.includes(p.currency) && Number.isInteger(p.unit_amount)) amounts[p.currency] = p.unit_amount;
  for (const [cur, opt] of Object.entries(p.currency_options ?? {})) {
    if (CURRENCIES.includes(cur) && Number.isInteger(opt?.unit_amount)) amounts[cur] = opt.unit_amount;
  }
  return Object.keys(amounts).length ? { default: p.currency, amounts } : null;
}

// Optional one-off setup fee, offered as an add-on at checkout. STRIPE_SETUP_PRICE_ID is optional:
// unset (or not a valid active one-time price) means no add-on is offered. Returns the same shape as getPrices().
export async function getSetupPrice() {
  const id = process.env.STRIPE_SETUP_PRICE_ID;
  if (!id) return null;
  if (setupCache && Date.now() - setupCache.at < setupCache.ttl) return setupCache.data;

  let data = null;
  let ttl = 30_000;
  try {
    const p = await stripe("GET", `/prices/${encodeURIComponent(id)}?expand%5B%5D=currency_options`);
    if (!p.active || p.recurring) {
      console.error("STRIPE_SETUP_PRICE_ID must be an active one-time price");
    } else {
      data = amountsOf(p);
      if (data) ttl = 300_000;
    }
  } catch (err) {
    console.error("setup price lookup failed:", err.message);
  }
  setupCache = { at: Date.now(), ttl, data };
  return data;
}

// Returns { default: "eur", amounts: { eur: 2900, gbp: 2500, usd: 3100 } } or null when billing isn't usable.
export async function getPrices() {
  const id = process.env.STRIPE_PRICE_ID;
  if (!id) return null;
  if (cache && Date.now() - cache.at < cache.ttl) return cache.data;

  let data = null;
  let ttl = 30_000; // failures are retried soon, without hammering Stripe
  try {
    const p = await stripe("GET", `/prices/${encodeURIComponent(id)}?expand%5B%5D=currency_options`);
    const monthly = p.recurring?.interval === "month" && (p.recurring.interval_count ?? 1) === 1;
    if (!p.active || !monthly) {
      console.error("STRIPE_PRICE_ID must be an active price billed every 1 month");
    } else {
      data = amountsOf(p);
      if (data) ttl = 300_000;
    }
  } catch (err) {
    console.error("price lookup failed:", err.message);
  }
  cache = { at: Date.now(), ttl, data };
  return data;
}
