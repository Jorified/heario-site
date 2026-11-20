// GET /api/pricing -> the monthly price in each currency, plus the currency suggested for this visitor.
import { currencyForCountry, formatMoney, getPrices } from "../lib/pricing.js";
import { json } from "../lib/util.js";

export async function GET(request) {
  const suggested = currencyForCountry(request.headers.get("x-vercel-ip-country"));
  const prices = await getPrices();
  if (!prices) return json({ prices: null, currency: suggested });

  const out = {};
  for (const [cur, minor] of Object.entries(prices.amounts)) out[cur] = { amount: minor, display: formatMoney(minor, cur) };
  const currency = out[suggested] ? suggested : out[prices.default] ? prices.default : Object.keys(out)[0];
  return json({ prices: out, currency, interval: "month" });
}
