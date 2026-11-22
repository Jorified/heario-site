// The enquiry email: a copy (if the owner turned it on), or the backup when WhatsApp can't deliver.
import { sendEmail } from "./email.js";
import { esc } from "./util.js";

const INTRO = {
  copy: "A copy of your WhatsApp alert.",
  fallback: "We couldn't deliver this enquiry to your WhatsApp, so here it is by email. Check the WhatsApp number in your dashboard.",
  plain: "",
};

export async function emailEnquiry({ to, business, name, contact, enquiry, reason = "plain" }) {
  const dash = (process.env.APP_URL || "https://heario.ai").replace(/\/+$/, "") + "/dashboard.html";
  const intro = INTRO[reason] || "";
  const forWho = business ? ` for ${business}` : "";
  await sendEmail({
    to,
    subject: `New website enquiry from ${name}`,
    text: `${intro ? intro + "\n\n" : ""}New enquiry${forWho} from your website chat.\n\nName: ${name}\nContact: ${contact}\nEnquiry: ${enquiry}\n\nSee all enquiries: ${dash}`,
    html:
      (intro ? `<p style="color:#555">${esc(intro)}</p>` : "") +
      `<p><b>New enquiry${esc(forWho)} from your website chat</b></p>` +
      `<p>Name: ${esc(name)}<br>Contact: ${esc(contact)}<br>Enquiry: ${esc(enquiry)}</p>` +
      `<p><a href="${esc(dash)}">See all enquiries</a></p>`,
  });
}
