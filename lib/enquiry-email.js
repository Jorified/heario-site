// The enquiry email: a copy (if the owner turned it on), or the backup when WhatsApp can't deliver.
import { sendEmail } from "./email.js";
import { esc } from "./util.js";

const INTRO = {
  copy: "A copy of your WhatsApp alert.",
  fallback: "We couldn't deliver this enquiry to your WhatsApp, so here it is by email. Check the WhatsApp number in your dashboard.",
  plain: "",
};

export async function emailEnquiry({ to, business, name, contact, enquiry, reason = "plain", urgent = false }) {
  const dash = (process.env.APP_URL || "https://heario.ai").replace(/\/+$/, "") + "/dashboard.html";
  const intro = INTRO[reason] || "";
  const forWho = business ? ` for ${business}` : "";
  await sendEmail({
    to,
    subject: `${urgent ? "URGENT: " : ""}New website enquiry from ${name}`,
    text: `${intro ? intro + "\n\n" : ""}${urgent ? "URGENT: they need help today.\n\n" : ""}New enquiry${forWho} from your website chat.\n\nName: ${name}\nContact: ${contact}\nEnquiry: ${enquiry}\n\nSee all enquiries: ${dash}`,
    html:
      (intro ? `<p style="color:#555">${esc(intro)}</p>` : "") +
      (urgent ? `<p style="color:#c0392b"><b>URGENT: they need help today.</b></p>` : "") +
      `<p><b>New enquiry${esc(forWho)} from your website chat</b></p>` +
      `<p>Name: ${esc(name)}<br>Contact: ${esc(contact)}<br>Enquiry: ${esc(enquiry)}</p>` +
      `<p><a href="${esc(dash)}">See all enquiries</a></p>`,
  });
}

// The first email address in the visitor's contact details, or null.
export const emailIn = (contact) => (String(contact ?? "").match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/) || [null])[0];

// "Thanks, we've got your enquiry" to the visitor, sent in the business's name. Replies go to the owner.
export async function confirmToVisitor({ to, business, owner, when, name, enquiry, replyTo }) {
  const biz = business || "the business";
  const first = String(name || "").split(" ")[0] || "there";
  const who = owner || "The team";
  const by = when || "as soon as possible";
  const footer = `Sent by Heario on behalf of ${biz}. You received this because you made an enquiry through the chat on their website.`;
  await sendEmail({
    to,
    replyTo,
    senderName: `${biz} via Heario`.slice(0, 70),
    subject: `Thanks for your enquiry to ${biz}`,
    text: `Hi ${first},\n\nThanks for getting in touch with ${biz}. We've passed your enquiry on, and ${who} will be in touch ${by}.\n\nYour enquiry: ${enquiry}\n\nIf anything changes, just reply to this email.\n\n${footer}`,
    html:
      `<p>Hi ${esc(first)},</p>` +
      `<p>Thanks for getting in touch with ${esc(biz)}. We've passed your enquiry on, and ${esc(who)} will be in touch ${esc(by)}.</p>` +
      `<p style="background:#f4f6fa;padding:10px 12px;border-radius:6px">Your enquiry: ${esc(enquiry)}</p>` +
      `<p>If anything changes, just reply to this email.</p>` +
      `<p style="color:#888;font-size:12px">${esc(footer)}</p>`,
  });
}
