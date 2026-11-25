// Trial emails: a reminder a few days before the free trial ends, and a note when it has ended.
// Written from Jack, personal and short, and shaped by how far the customer got:
//   "used"    - their chat has answered visitors: show what it did and ask them to keep it running
//   "ready"   - set up, but no visitors yet: point them at putting the code on their website
//   "setup"   - not finished setting up: show what's left, offer help and more time
import { sendEmail } from "./email.js";
import { renderEmail } from "./email-layout.js";
import { formatMoney } from "./pricing.js";

const SUPPORT = "support@heario.ai";

export function longDay(date) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Dublin" }).format(date);
}

// "€19.99 a month" (plus pounds and dollars when Stripe has them), or "" when prices aren't available.
export function priceLine(prices) {
  const a = prices?.amounts;
  if (!a || !a.eur) return "";
  const others = [a.gbp && `${formatMoney(a.gbp, "gbp")} in the UK`, a.usd && `${formatMoney(a.usd, "usd")} in the US`].filter(Boolean);
  return `${formatMoney(a.eur, "eur")} a month${others.length ? ` (${others.join(", ")})` : ""}. No contract: cancel any time from your dashboard.`;
}

// "used" only when the chat has loaded on their real website (not just the dashboard preview) and answered messages.
export function stage(d) {
  if (d.live && Number(d.messages) > 0) return "used";
  return d.knowledge && d.site ? "ready" : "setup";
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function trialEmail(kind, d, now = new Date()) {
  const app = (process.env.APP_URL || "https://heario.ai").replace(/\/+$/, "");
  const dash = `${app}/dashboard.html`;
  const st = stage(d);
  const hi = d.owner ? `Hi ${d.owner},` : "Hi,";
  const biz = d.business || "your business";
  const ends = longDay(new Date(d.trialEndsAt));
  const daysLeft = Math.max(1, Math.ceil((new Date(d.trialEndsAt) - now) / 86400000));
  const price = priceLine(d.prices);
  const messages = Number(d.messages) || 0, leads = Number(d.leads) || 0;
  const stats = { stats: [[messages, messages === 1 ? "message answered" : "messages answered"], [leads, leads === 1 ? "enquiry sent to you" : "enquiries sent to you"]] };
  const checklist = { checklist: [
    [!!d.knowledge, "Add a few lines about your business (or let us read your website)"],
    [!!d.whatsapp, "Add your WhatsApp number so enquiries reach your phone"],
    [!!d.site, "Add your website address"],
    [!!d.live, "Paste the code onto your website (step-by-step help for WordPress, Wix, Squarespace and more)"],
  ] };
  const help = { p: "Any questions, or would you like a hand? Just reply to this email. It comes straight to me." };
  const sign = { p: "Jack\nFounder, Heario" };
  const footer = `You're getting this because you started a free Heario trial with ${d.email}. Heario, Ireland.`;

  let subject, preheader, blocks;
  if (kind === "reminder") {
    subject = `Your Heario trial ends on ${ends}`;
    if (st === "used") {
      preheader = `Your chat has answered ${plural(messages, "message", "messages")} so far. Keep it running.`;
      blocks = [
        { h: `Your free trial ends in ${plural(daysLeft, "day", "days")}` },
        { p: hi },
        { p: `It's Jack from Heario. Your free trial for ${biz} ends on ${ends}. Here's what your website chat has done so far:` },
        stats,
        { p: leads
          ? `To keep it answering your visitors and sending enquiries to your phone, subscribe before then. It takes a minute, and nothing changes on your website.`
          : `To keep it answering your visitors around the clock, subscribe before then. It takes a minute, and nothing changes on your website.` },
        { button: ["Keep my chat running", dash] },
        price && { small: price },
        help, sign,
      ];
    } else if (st === "ready") {
      preheader = d.live ? "Your chat is live. Here's how to make sure visitors see it." : "Your chat is set up. One last step: put it on your website.";
      blocks = [
        { h: `Your free trial ends in ${plural(daysLeft, "day", "days")}` },
        { p: hi },
        { p: d.live
          ? `It's Jack from Heario. Your chat for ${biz} is on your website, but it hasn't had any visitors yet. Make sure it's on every page, and send a test message from your phone to see it working.`
          : `It's Jack from Heario. Your chat for ${biz} is set up, but it isn't on your website yet. That's the last step, and it only takes a few minutes.` },
        { p: "Your dashboard has step-by-step instructions for WordPress, Wix, Squarespace, Shopify and the rest. Most people are done in 5 minutes, and you can also email the code straight to your web developer." },
        { button: ["Put the chat on my website", `${dash}#install`] },
        { p: `Your trial ends on ${ends}. If you need more time to see it working, just reply and I'll extend it.` },
        help, sign,
      ];
    } else {
      preheader = "There's still time to try it properly. It takes about 10 minutes.";
      blocks = [
        { h: `Your free trial ends in ${plural(daysLeft, "day", "days")}` },
        { p: hi },
        { p: `It's Jack from Heario. You started a free trial, but your chat isn't quite set up yet. Here's what's left:` },
        checklist,
        { p: "It takes about 10 minutes. Or reply to this email and I'll set it up for you, free." },
        { button: ["Finish setting up", dash] },
        { p: `Your trial ends on ${ends}. If you need more time to try it properly, just reply and I'll extend it.` },
        sign,
      ];
    }
  } else {
    if (st === "used") {
      subject = "Your Heario chat is paused";
      preheader = "Your trial has ended. Everything is saved: subscribe and it's back on straight away.";
      blocks = [
        { h: "Your free trial has ended" },
        { p: hi },
        { p: `Your website chat for ${biz} is now paused. Visitors who open it are asked to contact you directly, and new enquiries won't reach your phone.` },
        { p: "During your trial it handled:" },
        stats,
        { p: "Everything you set up is saved. Subscribe and your chat is back on straight away, with nothing to change on your website." },
        { button: ["Switch my chat back on", dash] },
        price && { small: price },
        help, sign,
      ];
    } else {
      subject = "Your Heario trial has ended";
      preheader = "No problem if the timing wasn't right. Want more time to try it?";
      blocks = [
        { h: "Your free trial has ended" },
        { p: hi },
        { p: "Your Heario free trial has ended. It looks like you didn't get a chance to try it on your website, which is no problem: life gets busy." },
        { p: "If you'd like more time to see it working, just reply to this email and I'll extend your trial. I'm also happy to set it up for you." },
        { button: ["Open my dashboard", dash] },
        { small: "Not for you? You can delete your account and everything in it from your dashboard at any time." },
        sign,
      ];
    }
  }
  const { html, text } = renderEmail({ preheader, blocks: blocks.filter(Boolean), footer });
  return { subject, html, text };
}

export async function sendTrialEmail(kind, d) {
  const m = trialEmail(kind, d);
  await sendEmail({ to: d.email, subject: m.subject, html: m.html, text: m.text, senderName: "Jack at Heario", replyTo: SUPPORT });
}
