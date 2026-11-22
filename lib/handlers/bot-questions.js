// GET  /api/bot/questions        -> open questions the assistant couldn't answer
// POST /api/bot/answer-question  { id, answer, question? } -> adds "Q/A" to the business information
//                                (question = the owner's tidied wording; defaults to the visitor's)
// POST /api/bot/dismiss-question { id }         -> hides it
import { one } from "../db.js";
import { guard } from "../guard.js";
import { answerQuestion, cleanQuestion, dismissQuestion, listOpen, MAX_ANSWER } from "../questions.js";
import { json } from "../util.js";

const botOf = (accountId) => one("SELECT id FROM bots WHERE account_id = $1", [accountId]);
const idOf = (body) => (Number.isSafeInteger(Number(body?.id)) && Number(body.id) > 0 ? Number(body.id) : null);

export async function list(request) {
  const g = await guard(request);
  if (g.response) return g.response;
  const bot = await botOf(g.account.id);
  return json({ questions: await listOpen(bot.id) });
}

export async function answer(request) {
  const g = await guard(request, { mutating: true });
  if (g.response) return g.response;
  const body = await request.json().catch(() => null);
  const id = idOf(body);
  const text = String(body?.answer ?? "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const edited = body?.question === undefined ? "" : cleanQuestion(body.question);
  if (!id) return json({ error: "Invalid request." }, 400);
  if (body?.question !== undefined && edited.length < 4) return json({ error: "Type the question first." }, 400);
  if (!text) return json({ error: "Type an answer first." }, 400);
  if (text.length > MAX_ANSWER) return json({ error: `Keep the answer under ${MAX_ANSWER.toLocaleString("en")} characters.` }, 400);
  const bot = await botOf(g.account.id);
  const r = await answerQuestion(bot.id, id, text, edited);
  if (r.error) return json({ error: r.error }, r.status);
  return json({ ok: true, knowledge: r.knowledge, added: r.block });
}

export async function dismiss(request) {
  const g = await guard(request, { mutating: true });
  if (g.response) return g.response;
  const id = idOf(await request.json().catch(() => null));
  if (!id) return json({ error: "Invalid request." }, 400);
  const bot = await botOf(g.account.id);
  await dismissQuestion(bot.id, id);
  return json({ ok: true });
}
