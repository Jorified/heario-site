// POST /api/stripe/webhook  (add this URL in Stripe > Developers > Webhooks)
// Events: checkout.session.completed, customer.subscription.created/updated/deleted
import { query } from "../../lib/db.js";
import { verifyStripeSignature } from "../../lib/stripe.js";
import { json } from "../../lib/util.js";

export async function POST(request) {
  const raw = await request.text(); // raw body is required for signature verification
  if (!verifyStripeSignature(raw, request.headers.get("stripe-signature"), process.env.STRIPE_WEBHOOK_SECRET)) {
    return json({ error: "Invalid signature" }, 400);
  }
  const event = JSON.parse(raw);
  const obj = event.data?.object ?? {};

  if (event.type === "checkout.session.completed" && obj.mode === "subscription" && obj.client_reference_id) {
    await query(
      `UPDATE accounts SET stripe_customer_id = $2, stripe_subscription_id = $3, subscription_status = 'active'
       WHERE id = $1`,
      [obj.client_reference_id, obj.customer, obj.subscription]
    );
  } else if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated") {
    await query(
      `UPDATE accounts SET subscription_status = $2, stripe_subscription_id = $3 WHERE stripe_customer_id = $1`,
      [obj.customer, obj.status, obj.id]
    );
  } else if (event.type === "customer.subscription.deleted") {
    await query(`UPDATE accounts SET subscription_status = 'canceled' WHERE stripe_customer_id = $1`, [obj.customer]);
  }
  // Events for customers we don't know (e.g. the old desktop-app subscriptions) simply match no rows.
  return json({ received: true });
}
