// DELETE /api/account  { confirm: "DELETE" } -> cancels billing and erases the account and all its data.
import { clearCookie } from "../lib/auth.js";
import { query } from "../lib/db.js";
import { guard } from "../lib/guard.js";
import { stripe } from "../lib/stripe.js";
import { json } from "../lib/util.js";

export async function DELETE(request) {
  const g = await guard(request, { mutating: true });
  if (g.response) return g.response;
  const body = await request.json().catch(() => ({}));
  if (body.confirm !== "DELETE") return json({ error: 'Type DELETE to confirm.' }, 400);

  const { account } = g;
  if (account.stripe_subscription_id && ["active", "trialing", "past_due"].includes(account.subscription_status)) {
    try {
      await stripe("DELETE", `/subscriptions/${account.stripe_subscription_id}`);
    } catch (err) {
      // Don't delete the account while we might still be billing it.
      console.error("cancel subscription failed:", err.message);
      return json({ error: "We couldn't cancel your subscription, so your account wasn't deleted. Please contact support." }, 502);
    }
  }
  await query("DELETE FROM accounts WHERE id = $1", [account.id]); // cascades to bot, leads, usage
  return json({ ok: true }, 200, { "set-cookie": clearCookie() });
}
