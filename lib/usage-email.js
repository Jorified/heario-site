// Tells the owner when their chatbot is close to, or has reached, this month's message allowance.
import { sendEmail } from "./email.js";
import { esc } from "./util.js";

const SUPPORT = "support@heario.ai";

export function resetLabel(date) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }).format(date);
}

export async function emailUsage({ to, business, used, limit, level, resets }) {
  const dash = (process.env.APP_URL || "https://heario.ai").replace(/\/+$/, "") + "/dashboard.html";
  const when = resetLabel(resets);
  const forWho = business ? ` for ${business}` : "";
  const over = level === "over";
  const subject = over
    ? "Your Heario chat has reached this month's limit"
    : "You've used 80% of your Heario chat messages this month";
  const lines = over
    ? [
        `Your website chat${forWho} has used all ${limit.toLocaleString("en-GB")} chat messages for this month.`,
        `It's still taking enquiries. Until ${when}, visitors see a short form instead of AI replies, and anything they send still comes to your WhatsApp and dashboard as usual.`,
        `AI replies start again automatically on ${when}.`,
      ]
    : [
        `Your website chat${forWho} has used ${used.toLocaleString("en-GB")} of its ${limit.toLocaleString("en-GB")} chat messages this month.`,
        `If it reaches the limit before ${when}, it keeps taking enquiries with a short form instead of AI replies, so you won't miss anyone.`,
      ];
  const more = "Need more messages? Just reply to this email and we'll raise your limit.";
  await sendEmail({
    to,
    replyTo: SUPPORT,
    subject,
    text: `${lines.join("\n\n")}\n\n${more}\n\nYour dashboard: ${dash}`,
    html: lines.map((l) => `<p>${esc(l)}</p>`).join("") + `<p><b>${esc(more)}</b></p><p><a href="${esc(dash)}">Open your dashboard</a></p>`,
  });
}
