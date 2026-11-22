// Transactional email through Brevo's HTTP API (https://developers.brevo.com).
export async function sendEmail({ to, subject, html, text, senderName = "Heario", replyTo }) {
  const key = process.env.BREVO_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) throw new Error("BREVO_API_KEY and EMAIL_FROM must be set");
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": key, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { name: senderName, email: from },
      ...(replyTo && { replyTo: { email: replyTo } }),
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text,
    }),
  });
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 300)}`);
}
