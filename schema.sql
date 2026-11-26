-- Heario chatbot product schema (Postgres / Neon).
-- Run once in the Neon SQL Editor (Neon console > your project > SQL Editor).
-- Safe to re-run: every statement is IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS accounts (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                   text NOT NULL UNIQUE,
  created_at              timestamptz NOT NULL DEFAULT now(),
  trial_ends_at           timestamptz NOT NULL,
  stripe_customer_id      text UNIQUE,
  stripe_subscription_id  text,
  subscription_status     text NOT NULL DEFAULT 'none'
);

-- Added with multi-currency pricing. Re-run this file on an existing database to pick it up.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS billing_currency text;

CREATE TABLE IF NOT EXISTS bots (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  embed_key           text NOT NULL UNIQUE,
  enabled             boolean NOT NULL DEFAULT true,
  business_name       text NOT NULL DEFAULT '',
  owner_name          text NOT NULL DEFAULT '',
  knowledge           text NOT NULL DEFAULT '',
  response_time       text NOT NULL DEFAULT '',
  greeting            text NOT NULL DEFAULT '',
  color               text NOT NULL DEFAULT '#4f8ef7',
  allowed_origins     text NOT NULL DEFAULT '',
  owner_whatsapp      text NOT NULL DEFAULT '',
  whatsapp_consent_at timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leads (
  id              bigserial PRIMARY KEY,
  bot_id          uuid NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  name            text NOT NULL,
  contact         text NOT NULL,
  enquiry         text NOT NULL,
  whatsapp_status text NOT NULL DEFAULT 'skipped',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leads_bot_created ON leads (bot_id, created_at DESC);

-- Added with WhatsApp delivery reports and the optional email copy. Safe to re-run.
ALTER TABLE bots  ADD COLUMN IF NOT EXISTS email_copy boolean NOT NULL DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS wa_message_id text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS emailed_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS leads_wa_message_id ON leads (wa_message_id) WHERE wa_message_id IS NOT NULL;

-- Added with enquiry status/notes, the urgent flag and visitor confirmation emails. Safe to re-run.
ALTER TABLE bots  ADD COLUMN IF NOT EXISTS confirm_visitor boolean NOT NULL DEFAULT true;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'new';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS note text NOT NULL DEFAULT '';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS urgent boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS usage (
  bot_id   uuid NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  month    text NOT NULL,
  messages integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bot_id, month)
);

CREATE TABLE IF NOT EXISTS login_tokens (
  token_hash text PRIMARY KEY,
  email      text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);
CREATE INDEX IF NOT EXISTS login_tokens_email ON login_tokens (email, expires_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  k            text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  n            integer NOT NULL
);

-- Questions the assistant couldn't answer, shown in the dashboard so the owner can add an answer. Safe to re-run.
CREATE TABLE IF NOT EXISTS questions (
  id            bigserial PRIMARY KEY,
  bot_id        uuid NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  question      text NOT NULL,
  times         integer NOT NULL DEFAULT 1,
  status        text NOT NULL DEFAULT 'open',
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_asked_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS questions_open_unique ON questions (bot_id, lower(question)) WHERE status = 'open';

-- Booking link and opening hours. Safe to re-run.
ALTER TABLE bots ADD COLUMN IF NOT EXISTS booking_url text NOT NULL DEFAULT '';
ALTER TABLE bots ADD COLUMN IF NOT EXISTS opening_hours text NOT NULL DEFAULT '';

-- Per-customer monthly chat message allowance (NULL = the plan default, PLAN_MONTHLY_MESSAGES).
ALTER TABLE bots ADD COLUMN IF NOT EXISTS message_limit integer;

-- Trial emails already sent (each goes once).
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS trial_reminder_sent_at timestamptz;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS trial_ended_sent_at timestamptz;

-- When the chat last loaded on the customer's own website (not the dashboard preview).
ALTER TABLE bots ADD COLUMN IF NOT EXISTS site_seen_at timestamptz;

-- Greeting style and the optional pop-up next to the chat bubble.
ALTER TABLE bots ADD COLUMN IF NOT EXISTS greeting_style text;
ALTER TABLE bots ADD COLUMN IF NOT EXISTS teaser_on boolean NOT NULL DEFAULT false;
ALTER TABLE bots ADD COLUMN IF NOT EXISTS teaser_title text NOT NULL DEFAULT '';
ALTER TABLE bots ADD COLUMN IF NOT EXISTS teaser_text text NOT NULL DEFAULT '';
ALTER TABLE bots ADD COLUMN IF NOT EXISTS teaser_style text; -- no longer used (the greeting style now sets the pop-up wording)
