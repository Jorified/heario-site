// GET /api/pricing -> the monthly price in each currency, the optional one-off setup fee (or null), and the currency suggested for this visitor.
import { currencyForCountry, formatMoney, getPrices, getSetupPrice } from "../lib/pricing.js";
import { json } from "../lib/util.js";

export async function GET(request) {
  const suggested = currencyForCountry(request.headers.get("x-vercel-ip-country"));
  const prices = await getPrices();
  if (!prices) return json({ prices: null, currency: suggested });

  const out = {};
  for (const [cur, minor] of Object.entries(prices.amounts)) out[cur] = { amount: minor, display: formatMoney(minor, cur) };
  const currency = out[suggested] ? suggested : out[prices.default] ? prices.default : Object.keys(out)[0];
  const setup = await getSetupPrice();
  let setupOut = null;
  if (setup) {
    setupOut = {};
    for (const [cur, minor] of Object.entries(setup.amounts)) setupOut[cur] = { amount: minor, display: formatMoney(minor, cur) };
  }
  return json({ prices: out, currency, interval: "month", setup: setupOut });
}
