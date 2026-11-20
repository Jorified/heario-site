// Runs widget.js inside jsdom with a stubbed fetch.
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { JSDOM } from "jsdom";

const code = fs.readFileSync(new URL("../widget.js", import.meta.url), "utf8");

function boot({ config, chatReply }) {
  const dom = new JSDOM("<!doctype html><body></body>", { url: "https://murphyplumbing.ie/", pretendToBeVisual: true });
  const { window } = dom;
  const sent = [];
  const fetchStub = async (url, init) => {
    sent.push({ url, init });
    if (url.includes("widget-config")) return new Response(JSON.stringify(config.body), { status: config.status });
    return new Response(JSON.stringify(chatReply.body), { status: chatReply.status });
  };
  const script = { dataset: { key: "hb_" + "a".repeat(24) }, src: "https://heario.ai/widget.js" };
  const doc = new Proxy(window.document, {
    get: (t, p) => (p === "currentScript" ? script : typeof t[p] === "function" ? t[p].bind(t) : t[p]),
  });
  new Function("document", "window", "fetch", "URL", "sessionStorage", code)(doc, window, fetchStub, URL, window.sessionStorage);
  return { window, sent, flush: () => new Promise((r) => setTimeout(r, 30)) };
}

test("renders from config, sends the key, and shows replies as text (never HTML)", async () => {
  const t = boot({
    config: { status: 200, body: { title: "Chat with Murphy", greeting: "Hi there", color: "#112233" } },
    chatReply: { status: 200, body: { reply: '<img src=x onerror="alert(1)"> hello', notified: false } },
  });
  await t.flush();
  const d = t.window.document;
  assert.equal(d.querySelector(".hw-title").textContent, "Chat with Murphy");
  assert.equal(d.querySelector(".hw-sub").textContent, "AI assistant");
  assert.equal(d.querySelector(".hw-m.bot").textContent, "Hi there");
  assert.match(d.head.querySelector("style").textContent, /#112233/);

  d.querySelector(".hw-in").value = "hello?";
  d.querySelector(".hw-form").dispatchEvent(new t.window.Event("submit", { cancelable: true }));
  await t.flush();
  const call = t.sent.find((s) => s.url.endsWith("/api/chat"));
  assert.equal(call.url, "https://heario.ai/api/chat");
  const body = JSON.parse(call.init.body);
  assert.equal(body.key, "hb_" + "a".repeat(24));
  assert.deepEqual(body.messages, [{ role: "user", content: "hello?" }]);
  const bots = [...d.querySelectorAll(".hw-m.bot")];
  assert.equal(bots.at(-1).textContent, '<img src=x onerror="alert(1)"> hello');
  assert.equal(d.querySelector(".hw-msgs img"), null, "no HTML injected");
});

test("renders nothing when the site isn't allowed", async () => {
  const t = boot({ config: { status: 403, body: { error: "Not allowed." } }, chatReply: { status: 200, body: {} } });
  await t.flush();
  assert.equal(t.window.document.querySelector(".hw-btn"), null);
});

test("failed chat call shows a friendly error and keeps message order valid", async () => {
  const t = boot({
    config: { status: 200, body: { title: "T", greeting: "G", color: "#112233" } },
    chatReply: { status: 500, body: { error: "Something went wrong. Please try again." } },
  });
  await t.flush();
  const d = t.window.document;
  d.querySelector(".hw-in").value = "hi";
  d.querySelector(".hw-form").dispatchEvent(new t.window.Event("submit", { cancelable: true }));
  await t.flush();
  assert.match([...d.querySelectorAll(".hw-m.bot")].at(-1).textContent, /something went wrong/i);
  d.querySelector(".hw-in").value = "again";
  d.querySelector(".hw-form").dispatchEvent(new t.window.Event("submit", { cancelable: true }));
  await t.flush();
  const second = JSON.parse(t.sent.filter((s) => s.url.endsWith("/api/chat")).at(-1).init.body);
  assert.deepEqual(second.messages.map((m) => m.role), ["user"], "failed turn was dropped");
});
