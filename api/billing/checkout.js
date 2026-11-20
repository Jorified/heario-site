// POST /api/billing/checkout -> Stripe Checkout URL for the monthly plan.
import { guard } from "../../lib/guard.js";
import { currencyForCountry, getPrices } from "../../lib/pricing.js";
import { planState } from "../../lib/plan.js";
import { stripe } from "../../lib/stripe.js";
import { baseUrl, json } from "../../lib/util.js";

export async function POST(request) {
  const g = await guard(request, { mutating: true });
  if (g.response) return g.response;
  const { account } = g;

  if (!process.env.STRIPE_PRICE_ID) return json({ error: "Billing isn't set up yet. Please contact support." }, 503);
  if (planState(account).paid) return json({ error: "You're already subscribed. Use Manage billing." }, 409);

  const prices = await getPrices();
  if (!prices) return json({ error: "Billing isn't available right now. Please contact support." }, 503);

  // A Stripe customer can only ever pay in one currency, so once someone has paid, that currency is fixed.
  const body = await request.json().catch(() => ({}));
  const asked = String(body?.currency ?? "").toLowerCase();
  const currency = account.billing_currency || asked || currencyForCountry(request.headers.get("x-vercel-ip-country"));
  if (!prices.amounts[currency]) {
    return json({ error: "That currency isn't available. Please choose another or contact support." }, 400);
  }

  try {
    const session = await stripe("POST", "/checkout/sessions", {
      mode: "subscription",
      currency: currency === prices.default ? undefined : currency,
      line_items: { 0: { price: process.env.STRIPE_PRICE_ID, quantity: 1 } },
      success_url: `${baseUrl(request)}/dashboard.html?billing=success`,
      cancel_url: `${baseUrl(request)}/dashboard.html?billing=cancelled`,
      client_reference_id: account.id,
      customer: account.stripe_customer_id || undefined,
      customer_email: account.stripe_customer_id ? undefined : account.email,
      subscription_data: { metadata: { account_id: account.id } },
      allow_promotion_codes: "true",
    });
    return json({ url: session.url });
  } catch (err) {
    console.error("checkout failed:", err.message);
    return json({ error: "Couldn't start checkout. Please try again." }, 502);
  }
}
