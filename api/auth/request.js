// POST /api/auth/request  { email }  -> emails a one-time login link. Also creates the account on first login.
import { query } from "../../lib/db.js";
import { sendEmail } from "../../lib/email.js";
import { baseUrl, clientIp, esc, isSameOrigin, json, randomHex, rateLimit, sha256 } from "../../lib/util.js";

export async function POST(request) {
  if (!isSameOrigin(request)) return json({ error: "Bad origin" }, 403);
  const body = await request.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return json({ error: "Enter a valid email address." }, 400);
  }

  // Always answer "ok" so this endpoint can't be used to discover who has an account.
  const okIp = await rateLimit(`login-ip:${clientIp(request)}`, 20, 3600);
  const okEmail = await rateLimit(`login-email:${email}`, 5, 3600);
  if (!okIp || !okEmail) return json({ ok: true });

  const token = randomHex(32);
  await query(
    `INSERT INTO login_tokens (token_hash, email, expires_at) VALUES ($1, $2, now() + interval '15 minutes')`,
    [sha256(token), email]
  );

  // The token travels in the URL fragment, so email link scanners that fetch the URL can't use it up.
  const link = `${baseUrl(request)}/login.html#token=${token}`;
  try {
    await sendEmail({
      to: email,
      subject: "Your Heario login link",
      text: `Log in to Heario: ${link}\n\nThis link works once and expires in 15 minutes. If you didn't ask for it, ignore this email.`,
      html: `<p>Click to log in to Heario:</p><p><a href="${esc(link)}">Log in to Heario</a></p><p style="color:#666">This link works once and expires in 15 minutes. If you didn't ask for it, you can ignore this email.</p>`,
    });
  } catch (err) {
    console.error("login email failed:", err.message);
    return json({ error: "We couldn't send the email. Please try again shortly." }, 502);
  }
  return json({ ok: true });
}
