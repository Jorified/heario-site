// GET /api/cron/cleanup  (daily Vercel cron, see vercel.json). Enforces the retention periods in the privacy policy.
import { query } from "../../lib/db.js";
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
  return json({ leads: leads.length, questions: questions.length, tokens: tokens.length, limits: limits.length, usage: usage.length });
}
