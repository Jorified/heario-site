// POST /api/billing/portal -> Stripe customer portal URL (update card, view invoices, cancel).
import { guard } from "../../lib/guard.js";
import { stripe } from "../../lib/stripe.js";
import { baseUrl, json } from "../../lib/util.js";

export async function POST(request) {
  const g = await guard(request, { mutating: true });
  if (g.response) return g.response;
  if (!g.account.stripe_customer_id) return json({ error: "No billing account yet." }, 400);
  try {
    const session = await stripe("POST", "/billing_portal/sessions", {
      customer: g.account.stripe_customer_id,
      return_url: `${baseUrl(request)}/dashboard.html`,
    });
    return json({ url: session.url });
  } catch (err) {
    console.error("portal failed:", err.message);
    return json({ error: "Couldn't open billing. Please try again." }, 502);
  }
}
