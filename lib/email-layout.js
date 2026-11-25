// A simple, branded email layout that works in Gmail, Outlook and phone mail apps:
// tables and inline styles only, a light background, one clear button, and a plain-text twin.
import { esc } from "./util.js";

const BLUE = "#4f8ef7";
const INK = "#141821";
const MUTED = "#5f6877";

// blocks: [{ p: "text" } | { h: "heading" } | { stats: [[number, label], ...] } | { checklist: [[done, text], ...] }
//          | { button: [label, url] } | { small: "text" }]
export function renderEmail({ preheader = "", blocks, footer }) {
  const html = blocks.map((b) => {
    if (b.h) return `<h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:${INK};font-weight:700">${esc(b.h)}</h1>`;
    if (b.p) return `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${INK}">${esc(b.p).replace(/\n/g, "<br>")}</p>`;
    if (b.small) return `<p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:${MUTED}">${esc(b.small)}</p>`;
    if (b.stats) {
      const cells = b.stats.map(([n, label]) =>
        `<td width="${Math.floor(100 / b.stats.length)}%" style="padding:16px 12px;background:#f2f6ff;border-radius:10px;text-align:center">` +
        `<div style="font-size:28px;font-weight:700;color:${BLUE};line-height:1.1">${esc(String(n))}</div>` +
        `<div style="font-size:13px;color:${MUTED};margin-top:4px">${esc(label)}</div></td>`
      ).join('<td width="12" style="font-size:0">&nbsp;</td>');
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px"><tr>${cells}</tr></table>`;
    }
    if (b.checklist) {
      const rows = b.checklist.map(([done, text]) =>
        `<tr><td width="28" valign="top" style="padding:5px 0;font-size:16px;color:${done ? "#16a34a" : "#b6bdc9"}">${done ? "&#10003;" : "&#9675;"}</td>` +
        `<td style="padding:5px 0;font-size:15px;line-height:1.5;color:${done ? MUTED : INK}">${esc(text)}</td></tr>`
      ).join("");
      return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px">${rows}</table>`;
    }
    if (b.button) {
      const [label, url] = b.button;
      return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 20px"><tr><td bgcolor="${BLUE}" style="border-radius:10px">` +
        `<a href="${esc(url)}" style="display:inline-block;padding:14px 26px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px">${esc(label)}</a>` +
        `</td></tr></table>`;
    }
    return "";
  }).join("");

  const doc =
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>` +
    `<body style="margin:0;padding:0;background:#f4f6fb;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb"><tr><td align="center" style="padding:28px 12px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">` +
    `<tr><td style="padding:0 4px 14px;font-size:20px;font-weight:700;color:${BLUE}">Heario</td></tr>` +
    `<tr><td style="background:#ffffff;border-radius:14px;padding:30px 28px;border:1px solid #e6eaf2">${html}</td></tr>` +
    `<tr><td style="padding:16px 8px;font-size:12px;line-height:1.5;color:#8a93a3;text-align:center">${esc(footer || "")}</td></tr>` +
    `</table></td></tr></table></body></html>`;

  const text = blocks.map((b) => {
    if (b.h) return b.h;
    if (b.p || b.small) return b.p || b.small;
    if (b.stats) return b.stats.map(([n, l]) => `${n} ${l}`).join(" | ");
    if (b.checklist) return b.checklist.map(([d, t]) => `${d ? "[x]" : "[ ]"} ${t}`).join("\n");
    if (b.button) return `${b.button[0]}: ${b.button[1]}`;
    return "";
  }).filter(Boolean).join("\n\n") + (footer ? `\n\n--\n${footer}` : "");

  return { html: doc, text };
}
