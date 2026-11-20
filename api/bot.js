// PUT /api/bot -> save the customer's chatbot settings.
// POST (reached as /api/bot/test-whatsapp via a vercel.json rewrite) -> send a test alert.
import { botView, validateBotInput } from "../lib/bot.js";
import { one } from "../lib/db.js";
import { guard } from "../lib/guard.js";
import { json } from "../lib/util.js";

export async function PUT(request) {
  const g = await guard(request, { mutating: true });
  if (g.response) return g.response;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return json({ error: "Invalid request." }, 400);

  const current = await one("SELECT * FROM bots WHERE account_id = $1", [g.account.id]);
  const { values: v, error } = validateBotInput(body, current);
  if (error) return json({ error }, 400);

  const saved = await one(
    `UPDATE bots SET
       business_name = $2, owner_name = $3, knowledge = $4, response_time = $5, greeting = $6,
       color = $7, allowed_origins = $8, owner_whatsapp = $9, enabled = $10,
       whatsapp_consent_at = CASE WHEN $11::boolean THEN now()
                                  WHEN $12::boolean THEN NULL
                                  ELSE whatsapp_consent_at END,
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [
      current.id, v.business_name, v.owner_name, v.knowledge, v.response_time, v.greeting,
      v.color, v.allowed_origins, v.owner_whatsapp, v.enabled, v.consent_now, v.consent_clear,
    ]
  );
  return json({ ok: true, bot: botView(saved) });
}

export { POST } from "../lib/handlers/bot-test-whatsapp.js";
