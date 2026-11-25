// POST /api/auth/verify  { token }  -> consumes the login token and sets the session cookie.
import { sessionCookie } from "../auth.js";
import { notifyAdmin } from "../admin-email.js";
import { query } from "../db.js";
import { isSameOrigin, json, randomHex, sha256 } from "../util.js";

export async function POST(request) {
  if (!isSameOrigin(request)) return json({ error: "Bad origin" }, 403);
  const body = await request.json().catch(() => ({}));
  const token = String(body.token ?? "");
  if (!/^[a-f0-9]{64}$/.test(token)) return json({ error: "This login link isn't valid." }, 400);

  // Single atomic statement: a token can only be used once.
  const used = await query(
    `UPDATE login_tokens SET used_at = now()
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
     RETURNING email`,
    [sha256(token)]
  );
  if (!used.length) return json({ error: "This login link has expired or was already used. Request a new one." }, 400);

  const days = Number(process.env.TRIAL_DAYS) || 14;
  const acct = await query(
    `INSERT INTO accounts (email, trial_ends_at) VALUES ($1, now() + ($2::int * interval '1 day'))
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
     RETURNING id, (xmax = 0) AS created`,
    [used[0].email, days]
  );
  const accountId = acct[0].id;
  await query(
    `INSERT INTO bots (account_id, embed_key) VALUES ($1, $2) ON CONFLICT (account_id) DO NOTHING`,
    [accountId, "hb_" + randomHex(12)]
  );

  if (acct[0].created) await notifyAdmin("trial", { email: used[0].email, days });

  return json({ ok: true }, 200, { "set-cookie": sessionCookie(accountId) });
}
