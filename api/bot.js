// PUT /api/bot -> save the customer's chatbot settings.
// POST /api/bot/test-whatsapp -> send a test alert; POST /api/bot/import-site -> draft info from the website.
// (Both reach this file via a vercel.json rewrite.)
import { botView, validateBotInput } from "../lib/bot.js";
import { one } from "../lib/db.js";
import { guard } from "../lib/guard.js";
import { json } from "../lib/util.js";
import { dispatch } from "../lib/route.js";
import { POST as testWhatsapp } from "../lib/handlers/bot-test-whatsapp.js";
import { POST as importSite } from "../lib/handlers/bot-import-site.js";

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
       email_copy = $13,
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [
      current.id, v.business_name, v.owner_name, v.knowledge, v.response_time, v.greeting,
      v.color, v.allowed_origins, v.owner_whatsapp, v.enabled, v.consent_now, v.consent_clear,
      v.email_copy,
    ]
  );
  return json({ ok: true, bot: botView(saved) });
}

const post = dispatch({ "test-whatsapp": testWhatsapp, "import-site": importSite });
// Old rewrite sent /api/bot/test-whatsapp here with no action; keep that working.
export const POST = (request) => (new URL(request.url).searchParams.get("action") || /\/api\/bot\/[a-z-]+$/.test(new URL(request.url).pathname) ? post(request) : testWhatsapp(request));
