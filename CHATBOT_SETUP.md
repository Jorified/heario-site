# Heario chatbot: setup and launch guide

Heario.ai is now a self-serve AI website chatbot with WhatsApp enquiry alerts.
Customers log in with an emailed link (no passwords), add their business info, WhatsApp number and
website, and paste one script tag onto their site. 14-day free trial, then a monthly Stripe subscription.

```
Customer's website --widget.js--> /api/chat --> Claude (Anthropic)
                                      |--> Postgres (Neon): accounts, chatbots, enquiries
                                      |--> WhatsApp Cloud API --> owner's phone  (email backup via Brevo)
heario.ai/login.html, dashboard.html --> /api/* (login, settings, billing, enquiries)
Stripe --> /api/stripe/webhook --> marks accounts subscribed / cancelled
```

Everything runs inside this one Vercel project: static pages plus serverless functions in `api/`.
The old desktop app is retired and no longer part of this site.

## 1. Create the database (Neon)
1. In Vercel: Project > Storage > add **Neon Postgres** (or use your existing Neon project). Copy the connection string as `DATABASE_URL`.
2. Open Neon's **SQL Editor**, paste all of `schema.sql`, run it. Safe to re-run (if you ran it before, run it again to add the `billing_currency` column).
   Use a **new database or schema** for this product, not the old licence tables.

## 2. Services and keys

| Variable | Where it comes from |
|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com. Optional `ANTHROPIC_MODEL` (default `claude-haiku-5-5`) |
| `DATABASE_URL` | Neon connection string |
| `SESSION_SECRET` | any random string, 32+ chars: `openssl rand -hex 32` |
| `APP_URL` | `https://heario.ai` (leave unset for Preview deployments so they use their own address) |
| `BREVO_API_KEY`, `EMAIL_FROM` | Brevo > SMTP & API > **API keys** (this is different from the SMTP key). `EMAIL_FROM` must be a verified sender, e.g. `hello@heario.ai` |
| `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` | see section 3. Optional: `STRIPE_SETUP_PRICE_ID` for the setup-fee add-on |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | see section 4 |
| `WHATSAPP_TEMPLATE_NAME` | `new_enquiry` (default) |
| `WHATSAPP_TEMPLATE_PHONE_NAME` | `new_enquiry_phone` (default) |
| `WHATSAPP_TEMPLATE_LANG` | `en` (default) |
| `WHATSAPP_APP_SECRET` | Meta app > App settings > Basic > App secret (checks delivery reports are really from Meta) |
| `WHATSAPP_VERIFY_TOKEN` | Any long random string you make up; type the same one into Meta's webhook setup |
| `CRON_SECRET` | any random string. Vercel sends it to the daily cleanup job automatically |
| `PLAN_MONTHLY_MESSAGES` | optional, default 3000 |
| `TRIAL_DAYS` | optional, default 14 |
| `LEAD_RETENTION_DAYS` | optional, default 90 (the privacy policy says 90) |
| `BOT_HOURLY_MESSAGES`, `BOT_HOURLY_ENQUIRIES` | optional, defaults 300 and 20 per chatbot per hour |

Add them in Vercel > Settings > Environment Variables, then redeploy.

## 3. Stripe
1. Products > create **Heario Chatbot** with ONE recurring **monthly** price. Set the amount in EUR, then use **Add prices for other currencies** to add GBP and USD amounts (you choose each amount; they don't have to be converted rates). Copy the price ID into `STRIPE_PRICE_ID`.
   - The homepage and dashboard read these amounts from Stripe, so there is no price to edit in the code.
   - Irish, EU and rest-of-world visitors are shown EUR, UK visitors GBP, US visitors USD. Anyone can switch currency, and a customer's currency is fixed once they've paid.
   - **To change the price later:** create a new Price (all three currencies), put its ID in `STRIPE_PRICE_ID` and redeploy. New subscribers pay the new price; existing ones keep theirs unless you move them in Stripe. The site picks the new amounts up within 5 minutes.
   - **Optional setup fee add-on:** create a second product, **Heario setup assistance**, with a **one-time** price (EUR 19.99, plus GBP 16.99 and USD 22.99 via "Add a price by currency", all tax-inclusive). Put its price ID in `STRIPE_SETUP_PRICE_ID`. Checkout then shows it as an add-on the customer can tick, only for people who have never been billed and only in a currency the price has. Leave the variable unset to switch the add-on off. Remember to create it in live mode too and use the live ID in Production.
2. Developers > Webhooks > add endpoint `https://heario.ai/api/stripe/webhook`, events:
   `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
3. Settings > Billing > **Customer portal**: enable it (cancellation, card updates, invoices).
4. **VAT: prices are VAT-inclusive.** The amounts (EUR 19.99, GBP 16.99, USD 22.99) are what the customer pays, VAT included. In the Price, set **Include tax in price = Included** (tax behaviour `inclusive`) for EUR, GBP and USD. Stripe doesn't let you change this after a Price is created, so if it was left on Auto, create a new Price. Stripe Tax isn't wired into checkout: you account for VAT yourself (Irish VAT is 23%; EU consumers can fall under OSS rules, and UK/US sales have their own rules), so confirm registration and rates with your accountant before taking live payments.

## 4. WhatsApp Cloud API (one Heario sender for all customers)
1. developers.facebook.com: create a Business app with the WhatsApp product, add and verify the **Heario business number** (it can't also be on the normal WhatsApp app).
2. Create a **System User** token with `whatsapp_business_messaging` and `whatsapp_business_management` (permanent, unlike the temporary token). Put it in `WHATSAPP_TOKEN`; the number's ID goes in `WHATSAPP_PHONE_NUMBER_ID`.
3. WhatsApp Manager > Message templates: create **two Utility templates**, language **English** (`en`).
   Both use the same header, body and footer:

   - Header (text): `New website enquiry`
   - Body:
     ```
     New enquiry for {{1}} from your website chat.

     Name: {{2}}
     Contact: {{3}}
     Enquiry: {{4}}

     Please get back to them using the contact details above.
     ```
   - Footer: `Heario alerts. Turn off in your dashboard.`
   - Samples: {{1}} `Murphy Plumbing`, {{2}} `Ann Byrne`, {{3}} `087 111 2222`, {{4}} `Boiler not heating, can someone call out this week?`

   **`new_enquiry`**: one button, Visit website, static URL `https://heario.ai/dashboard.html`, text `See all enquiries`.

   **`new_enquiry_phone`**: two buttons, in this order:
   1. Visit website, **dynamic** URL `https://heario.ai/r/{{1}}`, text `Reply on WhatsApp`, sample `42.AbCdEfGhIjKlMnOp`
      (Meta rejects direct wa.me links, so this goes via Heario, which forwards the owner to the visitor's chat)
   2. Visit website, static URL `https://heario.ai/dashboard.html`, text `See all enquiries`

   The phone version is used when the visitor leaves a **mobile** number Heario can place (international format, or a
   local number when the owner is in Ireland, the UK or North America; Irish and UK landlines are skipped). If it isn't approved yet, alerts fall back to
   `new_enquiry` automatically. Wait for approval (usually minutes, at most a day).
4. **Delivery reports (webhook).** Meta app > WhatsApp > Configuration > Webhook: Callback URL
   `https://heario.ai/api/whatsapp/webhook`, Verify token = your `WHATSAPP_VERIFY_TOKEN`, then Verify and save
   and subscribe to the **messages** field. Heario then shows "WhatsApp delivered/read" on each enquiry, and if
   WhatsApp accepts an alert but can't deliver it later (wrong number, not on WhatsApp, blocked), the enquiry is
   emailed to the owner automatically. Deploy with both env vars set before clicking Verify.
5. To message more than a handful of numbers, complete Meta **business verification**.

Customers must tick the consent box before any alert is sent; the time is stored.
If WhatsApp delivery fails (straight away or later, via the delivery report), the enquiry is emailed to the customer's
login address instead. Customers can also tick "Also email me a copy of every enquiry" (off by default).

## 5. Test before launch
- `npm test` runs 60 automated tests (login, settings, chat, unanswered questions, WhatsApp alerts, delivery reports and fallback, Stripe webhook, website reader, widget safety). They use an in-memory database and stub every external service, so passing proves the logic, **not** that your keys and Meta template are right.
- Use the Vercel **Preview** deployment for this branch: log in, fill in the dashboard, press **Send a test alert**, chat in the preview bubble, make a test enquiry, subscribe with a Stripe test card.

## 6. Launch checklist
- [ ] `npm run check-launch` passes (fills in your legal name, address, and hosting regions in the legal pages)
- [ ] Have an Irish solicitor or data protection adviser review `privacy.html`, `terms.html` and `dpa.html`
- [ ] Check the price shows correctly in EUR, GBP and USD on the homepage (use the currency buttons) and in the dashboard
- [ ] Switch Stripe, WhatsApp and Anthropic to live keys; confirm the template is approved
- [ ] Add your own website to a test account and send yourself a real enquiry
- [ ] Look at the old product pages: they're excluded from the deployment via `.vercelignore` but remain in git. Delete them whenever you like
- [x] Old desktop-app Stripe webhook switched off (done by Jack, 20 Nov 2026), so chatbot payments can't trigger old licence-key emails. If you ever re-enable it, use a separate Stripe account for the chatbot

## Known limits
- Chat transcripts aren't stored; only the enquiry. The widget keeps the current conversation in the visitor's session storage.
- One chatbot per account.
- Rate limits: 20 messages a minute per visitor, 300 messages and 20 enquiries an hour per chatbot (`BOT_HOURLY_MESSAGES`, `BOT_HOURLY_ENQUIRIES`), and the monthly cap per chatbot.
- The website allowlist is enforced by browsers only. Scripts can fake the site address and the chatbot key is public, so the caps above are the real protection. If abuse ever becomes a problem, add a Cloudflare Turnstile check to the widget.
- Free-text WhatsApp messages aren't used, because Meta only allows templates to numbers that haven't messaged you in the last 24 hours.
