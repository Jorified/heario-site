// Trial / subscription rules.
const PAID = new Set(["active", "trialing", "past_due"]); // past_due = Stripe is still retrying the card

// Heario's own demo chatbot on heario.ai is the shop window, so it gets bigger limits than a customer plan.
// HOUSE_EMBED_KEYS (comma-separated embed keys) overrides which bots count; set it to "" to turn this off.
const DEFAULT_HOUSE_KEYS = "hb_f307f807bdebb7339ec7ca27";
export const isHouseBot = (key) =>
  !!key && String(process.env.HOUSE_EMBED_KEYS ?? DEFAULT_HOUSE_KEYS).split(",").map((k) => k.trim()).filter(Boolean).includes(key);

// Pass the bot row (or just its embed key). bots.message_limit, when set, raises (or lowers) one customer's allowance.
export const monthlyLimit = (bot) => {
  const key = typeof bot === "string" ? bot : bot?.embed_key;
  const custom = Number(typeof bot === "object" && bot ? bot.message_limit : 0);
  if (Number.isInteger(custom) && custom > 0) return custom;
  return isHouseBot(key) ? Number(process.env.HOUSE_MONTHLY_MESSAGES) || 10000 : Number(process.env.PLAN_MONTHLY_MESSAGES) || 3000;
};

// The 80% warning goes out on the message that reaches 80%; the "limit reached" one on the first message past the limit.
export const usageWarningAt = (limit) => ({ near: Math.ceil(limit * 0.8), over: limit + 1 });

// First day of next month (UTC), when the allowance resets.
export const resetDate = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
export const hourlyLimit = (key) =>
  isHouseBot(key) ? Number(process.env.HOUSE_HOURLY_MESSAGES) || 600 : Number(process.env.BOT_HOURLY_MESSAGES) || 300;

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
