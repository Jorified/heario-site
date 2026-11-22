// GET /api/leads -> the customer's most recent enquiries.  GET /api/leads?format=csv -> all of them as a spreadsheet.
// PATCH /api/leads { id, stage?, note? } -> update an enquiry's status (new/contacted/won/lost) or note.
// GET/POST /api/whatsapp/webhook (via ?action=wa-webhook) -> Meta delivery reports, see lib/handlers/wa-webhook.js.
// GET /api/leads?r=<code> (via /r/<code>) -> the signed "Reply on WhatsApp" link, see lib/handlers/lead-reply.js.
import { query } from "../lib/db.js";
import { guard } from "../lib/guard.js";
import { json, oneLine } from "../lib/util.js";
import { one } from "../lib/db.js";
import { replyRedirect } from "../lib/handlers/lead-reply.js";
import { receive, verify } from "../lib/handlers/wa-webhook.js";
import { actionOf } from "../lib/route.js";

// Vercel may hand the function either the original URL (/r/<code>, /api/whatsapp/webhook) or the
// rewritten one (/api/leads?r=<code>, ?action=wa-webhook), so accept both.
const isWebhook = (request) => actionOf(request) === "wa-webhook" || new URL(request.url).pathname.replace(/\/+$/, "") === "/api/whatsapp/webhook";
const replyCodeOf = (request) => {
  const u = new URL(request.url);
  const m = /^\/r\/([^/]+)\/?$/.exec(u.pathname);
  return m ? decodeURIComponent(m[1]) : u.searchParams.get("r");
};

export async function GET(request) {
  if (isWebhook(request)) return verify(request);
  const r = replyCodeOf(request);
  if (r !== null) return replyRedirect(request, r);
  const g = await guard(request);
  if (g.response) return g.response;
  const csv = new URL(request.url).searchParams.get("format") === "csv";
  const leads = await query(
    `SELECT l.id, l.name, l.contact, l.enquiry, l.whatsapp_status, l.created_at, l.stage, l.note, l.urgent
     FROM leads l JOIN bots b ON b.id = l.bot_id
     WHERE b.account_id = $1 ORDER BY l.created_at DESC LIMIT ${csv ? 2000 : 100}`,
    [g.account.id]
  );
  return csv ? toCsv(leads, new URL(request.url).searchParams.get("tz")) : json({ leads });
}

export const STAGES = ["new", "contacted", "won", "lost"];

export async function PATCH(request) {
  const g = await guard(request, { mutating: true });
  if (g.response) return g.response;
  const body = await request.json().catch(() => null);
  const id = String(body?.id ?? "");
  if (!/^\d{1,18}$/.test(id)) return json({ error: "Invalid enquiry." }, 400);
  const stage = body.stage === undefined ? null : String(body.stage);
  if (stage !== null && !STAGES.includes(stage)) return json({ error: "Invalid status." }, 400);
  const note = body.note === undefined ? null : String(body.note).replace(/\r\n/g, "\n").trim().slice(0, 500);
  const row = await one(
    `UPDATE leads l SET stage = COALESCE($3, l.stage), note = COALESCE($4, l.note)
     FROM bots b WHERE l.bot_id = b.id AND b.account_id = $2 AND l.id = $1
     RETURNING l.id, l.stage, l.note`,
    [id, g.account.id, stage, note]
  );
  return row ? json({ ok: true, lead: row }) : json({ error: "Enquiry not found." }, 404);
}

// Spreadsheet-safe cell: quoted, and anything a spreadsheet could run as a formula is defused
// (phone numbers like "+353 ..." are left alone).
function cell(v) {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s) && !/^\+[\d\s().-]+$/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
const STAGE_LABEL = { new: "New", contacted: "Contacted", won: "Won", lost: "Lost" };

// Times in the owner's own time zone (sent by their browser); anything unrecognised falls back to UTC.
function stamper(tz) {
  let zone = "UTC";
  try { if (tz && /^[A-Za-z_]+(?:[/+\-][A-Za-z0-9_+\-]+)*$/.test(tz)) { new Intl.DateTimeFormat("en", { timeZone: tz }); zone = tz; } } catch {}
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const fmt = (d) => { const p = Object.fromEntries(f.formatToParts(new Date(d)).map((x) => [x.type, x.value])); return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`; };
  return { zone, fmt };
}

function toCsv(leads, tz) {
  const { zone, fmt } = stamper(tz);
  const head = [zone === "UTC" ? "Date (UTC)" : `Date (${zone})`, "Name", "Contact", "Enquiry", "Urgent", "Status", "Note", "Alert"];
  const rows = leads.map((l) => [
    fmt(l.created_at),
    l.name, l.contact, l.enquiry, l.urgent ? "Yes" : "", STAGE_LABEL[l.stage] || l.stage, oneLine(l.note, 500), l.whatsapp_status,
  ]);
  const text = "\uFEFF" + [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
  const day = new Date().toISOString().slice(0, 10);
  return new Response(text, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="heario-enquiries-${day}.csv"`,
      "cache-control": "no-store",
    },
  });
}

export async function POST(request) {
  if (isWebhook(request)) return receive(request);
  return json({ error: "Not found" }, 404);
}
