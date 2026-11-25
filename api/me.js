// GET /api/me -> everything the dashboard needs in one call.
import { botView } from "../lib/bot.js";
import { one } from "../lib/db.js";
import { guard } from "../lib/guard.js";
import { monthKey, monthlyLimit, planState, resetDate } from "../lib/plan.js";
import { json } from "../lib/util.js";

export async function GET(request) {
  const g = await guard(request);
  if (g.response) return g.response;
  const { account } = g;

  const bot = await one("SELECT * FROM bots WHERE account_id = $1", [account.id]);
  if (!bot) return json({ error: "Account is missing its chatbot. Contact support." }, 500);
  const usage = await one("SELECT messages FROM usage WHERE bot_id = $1 AND month = $2", [bot.id, monthKey()]);

  return json({
    email: account.email,
    plan: { ...planState(account), hasBilling: !!account.stripe_customer_id, billingCurrency: account.billing_currency || null },
    usage: { messages: usage?.messages ?? 0, limit: monthlyLimit(bot), resets: resetDate().toISOString().slice(0, 10) },
    bot: botView(bot),
  });
}
