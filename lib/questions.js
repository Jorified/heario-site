// Questions the assistant couldn't answer. The chat records them (worded generally, personal details
// scrubbed); the owner sees them in the dashboard and can add an answer to the business information.
import { one, query } from "./db.js";
import { rateLimit } from "./util.js";

export const MAX_OPEN = 200;
export const MAX_ANSWER = 1000;
export const MAX_KNOWLEDGE = 8000;

// Belt and braces: the AI is told not to include personal details, but strip emails and phone numbers anyway.
export function cleanQuestion(v) {
  return String(v ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[email]")
    .replace(/\+?\d[\d\s().-]{5,}\d/g, (m) => (m.replace(/\D/g, "").length >= 7 ? "[number]" : m))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

export async function recordQuestion(bot, input, ip) {
  const question = cleanQuestion(input?.question);
  if (question.length < 4) return;
  if (!(await rateLimit(`unanswered:${bot.id}:${ip}`, 5, 3600))) return;
  await query(
    `INSERT INTO questions (bot_id, question)
       SELECT $1, $2 WHERE (SELECT count(*) FROM questions WHERE bot_id = $1 AND status = 'open') < ${MAX_OPEN}
     ON CONFLICT (bot_id, lower(question)) WHERE status = 'open'
       DO UPDATE SET times = questions.times + 1, last_asked_at = now()`,
    [bot.id, question]
  );
}

export const listOpen = (botId) =>
  query(
    `SELECT id, question, times, created_at, last_asked_at FROM questions
     WHERE bot_id = $1 AND status = 'open' ORDER BY times DESC, last_asked_at DESC LIMIT 50`,
    [botId]
  );

export const qaBlock = (question, answer) => `Q: ${question}\nA: ${answer}`;

// Marks the question answered and appends "Q: … / A: …" to the business information.
// Returns { knowledge, block } or { error, status }.
// `edited` is the owner's tidied wording of the question (optional).
export async function answerQuestion(botId, id, answer, edited) {
  const q = await one(`UPDATE questions SET status = 'answered' WHERE id = $1 AND bot_id = $2 AND status = 'open' RETURNING question`, [id, botId]);
  if (!q) return { error: "That question has already been dealt with. Refresh the page.", status: 404 };
  const block = qaBlock(edited || q.question, answer);
  const saved = await one(
    `UPDATE bots SET
       knowledge = CASE WHEN btrim(knowledge) = '' THEN $2 ELSE rtrim(knowledge, E' \\n\\t') || E'\\n\\n' || $2 END,
       updated_at = now()
     WHERE id = $1 AND length(CASE WHEN btrim(knowledge) = '' THEN $2 ELSE rtrim(knowledge, E' \\n\\t') || E'\\n\\n' || $2 END) <= ${MAX_KNOWLEDGE}
     RETURNING knowledge`,
    [botId, block]
  );
  if (!saved) {
    await query("UPDATE questions SET status = 'open' WHERE id = $1", [id]);
    return { error: `Your business information is full (${MAX_KNOWLEDGE.toLocaleString("en")} characters). Shorten it, save, then try again.`, status: 400 };
  }
  return { knowledge: saved.knowledge, block };
}

export async function dismissQuestion(botId, id) {
  const q = await one(`UPDATE questions SET status = 'dismissed' WHERE id = $1 AND bot_id = $2 AND status = 'open' RETURNING id`, [id, botId]);
  return !!q;
}
