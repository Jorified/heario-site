# Heario — Ownership Transfer / Handover Checklist

Working checklist for transferring Heario to a new owner. Hand this to a buyer
during due diligence and work through it together at cutover.

> **Never put real secrets in this file.** It lists *what* transfers and *how* —
> API keys, passwords, and card data move through a secure channel (password-
> manager share, escrow, or the provider's own migration flow) at cutover only.
> This file is excluded from the public site via `.vercelignore` — keep it that way.

> **Not legal or financial advice.** An asset purchase agreement, the customer-
> data transfer terms, and valuation are worth a professional. Use escrow
> (Flippa / Escrow.com) and release funds only after handover is verified.

---

## 1. Asset inventory

| Asset | Location | Notes |
|---|---|---|
| Marketing site | GitHub `Jorified/heario-site` + Vercel project | Static site |
| Desktop app | GitHub `Jorified/heario-app` (public) | Tauri shell + sidecar |
| Pipeline | GitHub `Jorified/heario-poc` (**PRIVATE**) | Bundled into the sidecar — easy to forget |
| Backend API | GitHub `heario-api` + Vercel project | Stripe, managed AI proxy, quotas |
| Email assets | GitHub `heario-email` | License emails |
| Domain | `heario.ai` (registrar TBD; DNS on Vercel) | |
| Neon Postgres | via Vercel/Neon | Licenses + customer records (**PII**) |
| Release installers | GitHub Releases on `heario-app` | Latest: v0.1.7 |

## 2. Code repositories

- [ ] Transfer `Jorified/heario-site`
- [ ] Transfer `Jorified/heario-app`
- [ ] Transfer `Jorified/heario-poc` — **private; the sidecar cannot be built without it**
- [ ] Transfer `heario-api`
- [ ] Transfer `heario-email`
- [ ] Confirm buyer can build end-to-end: sidecar (PyInstaller) → `tauri build` → installer (see `heario-app/RELEASE.md`)

## 3. Domain

- [ ] Unlock `heario.ai` at the registrar
- [ ] Provide the EPP / auth code to the buyer
- [ ] Buyer accepts the transfer into their registrar account
- [ ] Re-point / verify DNS (currently on Vercel) after the other assets are live
- [ ] Transfer any email routing for the domain (support@heario.ai send-as)

## 4. Hosting (Vercel)

- [ ] Transfer the `heario-site` Vercel project (or buyer redeploys from the repo)
- [ ] Transfer the `heario-api` Vercel project
- [ ] Re-add all environment variables under the buyer's account (see §6)
- [ ] Re-attach the `api.heario.ai` domain to the API project

## 5. Database (Neon Postgres)

- [ ] Decide: transfer the Neon project, or dump/restore into the buyer's Neon
- [ ] Migrate the `licenses` + related tables (schema in `heario-api/schema.sql`)
- [ ] Confirm the buyer's `POSTGRES_URL` is wired into the API project
- [ ] **Customer PII** — handle under §7

## 6. Third-party services & env vars

Buyer creates their **own** accounts/keys; you revoke yours at cutover. Values are
NOT stored here — only the variable names the backend/app expect.

- [ ] **Stripe** — see §8 (the hard one)
- [ ] **Anthropic** (managed answers): `HEARIO_ANTHROPIC_API_KEY`
- [ ] **Deepgram** (STT): `DEEPGRAM_API_KEY`
- [ ] **Tavily** (web search): `TAVILY_API_KEY`
- [ ] **Brevo SMTP** (license emails): `BREVO_SMTP_LOGIN`, `BREVO_SMTP_KEY`
- [ ] Confirm the app's own BYOK settings still work for end users after cutover

## 7. Customer data & privacy

- [ ] Confirm `heario-site/privacy.html` permits transfer "in a sale of the business"
- [ ] Paper the data transfer in the asset purchase agreement (buyer inherits obligations)
- [ ] Decide notification to existing license holders, if required by your policy/jurisdiction
- [ ] Hand over the license/customer records only through a secure channel

## 8. Stripe (billing) — plan carefully

You cannot casually reassign a Stripe account. Pick one:

- **Option A — transfer the whole Stripe account** (cleanest if Heario is the only
  product on it): change account ownership to the buyer.
- **Option B — migrate to the buyer's Stripe**: contact **Stripe support** for the
  official customer + card (PAN) data migration — you cannot export card data
  yourself. Recreate products/prices/payment links; update `STRIPE_PRICE_*`,
  `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and the webhook endpoint
  (`https://api.heario.ai/api/webhook`).

- [ ] Existing subscriptions keep billing without re-collecting cards
- [ ] Webhook endpoint re-pointed and verified end-to-end (test payment → license email)

## 9. Cutover sequence (minimise downtime)

1. [ ] Deal signed; escrow funded
2. [ ] Buyer provisions their own Anthropic / Deepgram / Tavily / Brevo keys
3. [ ] Transfer all 5 GitHub repos
4. [ ] Transfer/migrate Stripe (§8)
5. [ ] Transfer Neon DB + Vercel projects; buyer sets env vars and redeploys
6. [ ] Transfer `heario.ai` domain / repoint DNS
7. [ ] Smoke test: site loads, download link works, a test purchase issues a license, app installs + connects
8. [ ] **Seller rotates/revokes every key that was theirs**
9. [ ] Escrow released

## 10. Due-diligence notes (be upfront)

A technical buyer will find these; disclosing them builds trust:

- **Installers are unsigned** — SmartScreen/AV friction; signing scaffolded but not
  active (`heario-app/sign-release.ps1`, `RELEASE.md`). Needs the buyer's (or your)
  Authenticode cert.
- **No CI/CD** — `heario-app/.github/workflows/release.yml` is a manual-only scaffold
  with documented blockers; releases are cut locally.
- **No auto-updater** — Tauri updater not configured; users update by reinstalling.
- **Cold-start latency** — first launch takes ~20-25s to connect (onefile sidecar
  extraction) before the overlay is ready.
- Latest release **v0.1.7** fixed the sidecar "reconnecting" hang; verified installs
  and connects on a clean run.
