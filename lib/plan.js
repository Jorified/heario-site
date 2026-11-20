// Trial / subscription rules.
const PAID = new Set(["active", "trialing", "past_due"]); // past_due = Stripe is still retrying the card

export const monthlyLimit = () => Number(process.env.PLAN_MONTHLY_MESSAGES) || 3000;

export function planState(account, now = new Date()) {
  const paid = PAID.has(account.subscription_status);
  const trialEnds = new Date(account.trial_ends_at);
  const trialActive = trialEnds > now;
  const trialDaysLeft = trialActive ? Math.ceil((trialEnds - now) / 86400000) : 0;
  return {
    active: paid || trialActive,
    paid,
    status: paid ? "subscribed" : trialActive ? "trial" : "expired",
    trialDaysLeft,
    subscriptionStatus: account.subscription_status,
  };
}

export const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);
