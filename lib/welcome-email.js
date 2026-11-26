// Sent once, the moment someone starts a free trial: a short personal note from Jack with the three setup steps.
import { sendEmail } from "./email.js";
import { renderEmail } from "./email-layout.js";
import { longDay } from "./trial-email.js";

export function welcomeEmail({ email, trialEndsAt, days }) {
  const dash = (process.env.APP_URL || "https://heario.ai").replace(/\/+$/, "") + "/dashboard.html";
  const ends = longDay(new Date(trialEndsAt));
  const { html, text } = renderEmail({
    preheader: "Your free trial has started. Here's how to get your chat live in about 10 minutes.",
    blocks: [
      { h: "Welcome to Heario" },
      { p: "Hi," },
      { p: `I'm Jack, the founder of Heario. Thanks for starting your ${days}-day free trial. It runs until ${ends}, and there's no card needed.` },
      { p: "Getting your chat live takes about 10 minutes:" },
      { checklist: [
        [false, "1. Tell it about your business: add a few lines, or let us read your website and write a draft for you."],
        [false, "2. Add your WhatsApp number, so every enquiry comes straight to your phone."],
        [false, "3. Paste one line of code onto your website. There are step-by-step instructions for WordPress, Wix, Squarespace, Shopify and more."],
      ] },
      { button: ["Open my dashboard", dash] },
      { p: "Not technical, or short on time? Just reply to this email and I'll help you get it set up, free." },
      { p: "Jack\nFounder, Heario" },
    ],
    footer: `You're getting this because you started a free Heario trial with ${email}. Heario, Ireland.`,
  });
  return { subject: "Welcome to Heario: get your chat live in 10 minutes", html, text };
}

export async function sendWelcomeEmail(d) {
  const m = welcomeEmail(d);
  try {
    await sendEmail({ to: d.email, subject: m.subject, html: m.html, text: m.text, senderName: "Jack at Heario", replyTo: "support@heario.ai" });
  } catch (err) {
    console.error("welcome email failed:", err.message);
  }
}
