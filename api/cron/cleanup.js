// GET /api/cron/cleanup  (daily Vercel cron, see vercel.json). Enforces the retention periods in the privacy policy.
import { query } from "../../lib/db.js";
import { isHouseBot } from "../../lib/plan.js";
import { getPrices } from "../../lib/pricing.js";
import { sendTrialEmail } from "../../lib/trial-email.js";
import { json } from "../../lib/util.js";

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return json({ error: "Unauthorized" }, 401);
  }
  const days = Number(process.env.LEAD_RETENTION_DAYS) || 90;
  const leads = await query(`DELETE FROM leads WHERE created_at < now() - ($1::int * interval '1 day') RETURNING 1`, [days]);
  const questions = await query(`DELETE FROM questions WHERE last_asked_at < now() - ($1::int * interval '1 day') RETURNING 1`, [days]);
  const tokens = await query(`DELETE FROM login_tokens WHERE expires_at < now() - interval '1 day' RETURNING 1`);
  const limits = await query(`DELETE FROM rate_limits WHERE window_start < now() - interval '2 days' RETURNING 1`);
  const usage = await query(`DELETE FROM usage WHERE month < to_char(now() - interval '13 months', 'YYYY-MM') RETURNING 1`);
  // Trial emails run separately, so a problem there never stops the clean-up above.
  let trial = { reminders: 0, ended: 0 };
  try { trial = await sendTrialEmails(); } catch (err) { console.error("trial emails failed:", err.message); }
  return json({ leads: leads.length, questions: questions.length, tokens: tokens.length, limits: limits.length, usage: usage.length, trial });
}

const PAID = "('active', 'trialing', 'past_due')";
const DETAILS = `a.id, a.email, a.trial_ends_at, b.embed_key, b.business_name, b.owner_name, b.knowledge, b.allowed_origins, b.owner_whatsapp, b.site_seen_at,
  (SELECT COALESCE(SUM(u.messages), 0) FROM usage u WHERE u.bot_id = b.id)::int AS messages,
  (SELECT COUNT(*) FROM leads l WHERE l.bot_id = b.id)::int AS leads`;

// Each customer gets each email once: the row is claimed (column set) before sending, and released if sending fails
// so tomorrow's run tries again. At most 200 of each per run.
async function sendTrialEmails() {
  const due = {
    reminder: await query(
      `SELECT ${DETAILS} FROM accounts a JOIN bots b ON b.account_id = a.id
       WHERE a.subscription_status NOT IN ${PAID} AND a.trial_reminder_sent_at IS NULL
         AND a.trial_ends_at > now() AND a.trial_ends_at <= now() + interval '3 days'
       ORDER BY a.trial_ends_at LIMIT 200`),
    ended: await query(
      `SELECT ${DETAILS} FROM accounts a JOIN bots b ON b.account_id = a.id
       WHERE a.subscription_status NOT IN ${PAID} AND a.trial_ended_sent_at IS NULL
         AND a.trial_ends_at <= now() AND a.trial_ends_at > now() - interval '7 days'
       ORDER BY a.trial_ends_at LIMIT 200`),
  };
  const col = { reminder: "trial_reminder_sent_at", ended: "trial_ended_sent_at" };
  const prices = await getPrices();
  const sent = { reminders: 0, ended: 0 };
  for (const kind of ["reminder", "ended"]) {
    for (const r of due[kind]) {
      if (isHouseBot(r.embed_key)) continue; // Heario's own demo chatbot isn't a customer
      const claimed = await query(`UPDATE accounts SET ${col[kind]} = now() WHERE id = $1 AND ${col[kind]} IS NULL RETURNING 1`, [r.id]);
      if (!claimed.length) continue;
      try {
        await sendTrialEmail(kind, {
          email: r.email, trialEndsAt: r.trial_ends_at, business: r.business_name, owner: r.owner_name,
          knowledge: !!(r.knowledge || "").trim(), site: String(r.allowed_origins || "").split(/[\s,]+/).filter(Boolean)[0] || "",
          whatsapp: !!r.owner_whatsapp, live: !!r.site_seen_at, messages: r.messages, leads: r.leads, prices,
        });
        sent[kind === "reminder" ? "reminders" : "ended"]++;
      } catch (err) {
        console.error(`trial ${kind} email failed:`, err.message);
        await query(`UPDATE accounts SET ${col[kind]} = NULL WHERE id = $1`, [r.id]);
      }
    }
  }
  return sent;
}
