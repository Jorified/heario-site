// POST /api/stripe/webhook  (add this URL in Stripe > Developers > Webhooks)
// Events: checkout.session.completed, customer.subscription.created/updated/deleted
import { notifyAdmin } from "../../lib/admin-email.js";
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

  // The owner gets one email per change: each update only "returns" a row when the status actually changes,
  // so Stripe's retries of the same event don't send duplicates.
  const who = `(SELECT business_name FROM bots WHERE bots.account_id = accounts.id) AS business`;

  if (event.type === "checkout.session.completed" && obj.mode === "subscription" && obj.client_reference_id) {
    const rows = await query(
      `WITH prev AS (SELECT subscription_status FROM accounts WHERE id = $1)
       UPDATE accounts SET stripe_customer_id = $2, stripe_subscription_id = $3, subscription_status = 'active',
         billing_currency = COALESCE($4::text, billing_currency)
       WHERE id = $1
       RETURNING email, ${who}, (SELECT subscription_status FROM prev) AS was`,
      [obj.client_reference_id, obj.customer, obj.subscription, obj.currency ? String(obj.currency).toLowerCase() : null]
    );
    const r = rows[0];
    if (r && !["active", "trialing", "past_due"].includes(r.was)) {
      await notifyAdmin("paid", { email: r.email, business: r.business, amount: obj.amount_total, currency: obj.currency });
    }
  } else if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated") {
    await query(
      `UPDATE accounts SET subscription_status = $2, stripe_subscription_id = $3 WHERE stripe_customer_id = $1`,
      [obj.customer, obj.status, obj.id]
    );
    // Cancelled in the billing portal: the plan runs to the end of the paid month, then Stripe ends it.
    // Older Stripe API versions flag this with cancel_at_period_end; newer ones set a cancel_at date. Handle both,
    // and only when this event is the one that switched cancellation on (so retries and other edits don't re-send).
    const prev = event.data?.previous_attributes ?? {};
    const nowCancelling = obj.cancel_at_period_end === true || !!obj.cancel_at;
    const justCancelled = ("cancel_at_period_end" in prev && !prev.cancel_at_period_end) || ("cancel_at" in prev && !prev.cancel_at);
    if (event.type === "customer.subscription.updated" && nowCancelling && justCancelled) {
      const rows = await query(`SELECT email, ${who} FROM accounts WHERE stripe_customer_id = $1`, [obj.customer]);
      const endsAt = (typeof obj.cancel_at === "number" && obj.cancel_at) || obj.items?.data?.[0]?.current_period_end || obj.current_period_end;
      if (rows[0]) await notifyAdmin("cancelling", { email: rows[0].email, business: rows[0].business, endsAt });
    }
  } else if (event.type === "customer.subscription.deleted") {
    const rows = await query(
      `UPDATE accounts SET subscription_status = 'canceled' WHERE stripe_customer_id = $1 AND subscription_status IS DISTINCT FROM 'canceled'
       RETURNING email, ${who}`,
      [obj.customer]
    );
    if (rows[0]) await notifyAdmin("ended", { email: rows[0].email, business: rows[0].business });
  }
  // Events for customers we don't know (e.g. the old desktop-app subscriptions) simply match no rows.
  return json({ received: true });
}
