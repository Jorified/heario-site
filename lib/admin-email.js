// Short heads-up emails to the Heario owner (ADMIN_EMAIL) about signups and subscriptions.
// Never blocks or breaks the customer's request: failures are only logged.
import { sendEmail } from "./email.js";
import { esc } from "./util.js";

const money = (amount, currency) => {
  if (!Number.isFinite(amount) || !currency) return "";
  try { return new Intl.NumberFormat("en-IE", { style: "currency", currency: currency.toUpperCase() }).format(amount / 100); }
  catch { return ""; }
};
const day = (unix) => (unix ? new Date(unix * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Dublin" }) : "");

export function adminMessage(kind, d) {
  const who = d.email + (d.business ? ` (${d.business})` : "");
  switch (kind) {
    case "trial":
      return {
        subject: `New free trial: ${d.email}`,
        lines: [`${d.email} just started a ${d.days}-day free trial.`, d.business ? `Business: ${d.business}` : "They haven't filled in their business details yet."],
      };
    case "paid": {
      const amt = money(d.amount, d.currency);
      return { subject: `New paying customer: ${who}`, lines: [`${who} just subscribed${amt ? `, paying ${amt} today` : ""}.`] };
    }
    case "cancelling":
      return {
        subject: `Cancellation: ${who}`,
        lines: [`${who} cancelled their subscription.`, d.endsAt ? `They keep access until ${day(d.endsAt)}, unless they change their mind.` : ""].filter(Boolean),
      };
    case "ended":
      return { subject: `Subscription ended: ${who}`, lines: [`${who}'s subscription has now ended and their chatbot is paused.`] };
    default:
      return null;
  }
}

export async function notifyAdmin(kind, d) {
  const to = process.env.ADMIN_EMAIL;
  if (!to) return;
  const m = adminMessage(kind, d);
  if (!m) return;
  try {
    await sendEmail({
      to,
      subject: m.subject,
      text: m.lines.join("\n\n"),
      html: m.lines.map((l) => `<p>${esc(l)}</p>`).join(""),
    });
  } catch (err) {
    console.error("admin email failed:", err.message);
  }
}
