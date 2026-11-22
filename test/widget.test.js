// Runs widget.js inside jsdom with a stubbed fetch.
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { JSDOM } from "jsdom";

const code = fs.readFileSync(new URL("../widget.js", import.meta.url), "utf8");

function boot({ config, chatReply, data = {} }) {
  const dom = new JSDOM("<!doctype html><body></body>", { url: "https://murphyplumbing.ie/", pretendToBeVisual: true });
  const { window } = dom;
  const sent = [];
  const fetchStub = async (url, init) => {
    sent.push({ url, init });
    if (url.includes("widget-config")) return new Response(JSON.stringify(config.body), { status: config.status });
    return new Response(JSON.stringify(chatReply.body), { status: chatReply.status });
  };
  const script = { dataset: { key: "hb_" + "a".repeat(24), ...data }, src: "https://heario.ai/widget.js" };
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

test("page API: open() shows the chat, ask() sends a question, and ready fires", async () => {
  let ready = false;
  const t = boot({
    config: { status: 200, body: { title: "Chat with Heario", greeting: "Hi", color: "#4f8ef7" } },
    chatReply: { status: 200, body: { reply: "It costs 19.99 a month.", notified: false } },
  });
  t.window.addEventListener("heario:ready", () => (ready = true));
  await t.flush();
  const d = t.window.document;
  assert.equal(ready || !!d.querySelector(".hw-btn"), true);
  assert.equal(d.querySelector(".hw-box").classList.contains("open"), false);
  t.window.HearioWidget.open();
  assert.equal(d.querySelector(".hw-box").classList.contains("open"), true);
  assert.equal(d.querySelector(".hw-btn").getAttribute("aria-expanded"), "true");
  t.window.HearioWidget.ask("How much is it?");
  assert.ok(d.querySelector(".hw-typing"), "typing indicator while waiting");
  await t.flush();
  assert.equal(d.querySelector(".hw-typing"), null, "typing indicator replaced by the reply");
  const bots = [...d.querySelectorAll(".hw-m.bot")];
  assert.equal(bots.at(-1).textContent, "It costs 19.99 a month.");
  const call = JSON.parse(t.sent.find((x) => x.url.endsWith("/api/chat")).init.body);
  assert.deepEqual(call.messages, [{ role: "user", content: "How much is it?" }]);
  assert.equal(d.querySelector(".hw-av").textContent.charAt(0), "H", "avatar uses the business initial");
});

test("shows a confirmation when the owner was notified", async () => {
  const t = boot({
    config: { status: 200, body: { title: "T", greeting: "G", color: "#112233" } },
    chatReply: { status: 200, body: { reply: "Thanks, passed on.", notified: true } },
  });
  await t.flush();
  t.window.HearioWidget.ask("Ann, 087 111 2222, boiler");
  await t.flush();
  assert.match(t.window.document.querySelector(".hw-note").textContent, /Enquiry sent/);
});

test("dark theme and teaser are opt-in via data attributes", async () => {
  const plain = boot({ config: { status: 200, body: { title: "T", greeting: "G", color: "#112233" } }, chatReply: { status: 200, body: {} } });
  await plain.flush();
  assert.equal(plain.window.document.querySelector(".hw-teaser"), null);
  assert.match(plain.window.document.head.querySelector("style").textContent, /#ffffff/);

  const t = boot({
    config: { status: 200, body: { title: "T", greeting: "G", color: "#112233" } },
    chatReply: { status: 200, body: {} },
    data: { theme: "dark", teaser: "Hi there|Ask me anything" },
  });
  await t.flush();
  const d = t.window.document;
  assert.match(d.head.querySelector("style").textContent, /#0f141d/);
  assert.equal(d.querySelector(".hw-teaser b").textContent, "Hi there");
  assert.equal(d.querySelector(".hw-teaser span").textContent, "Ask me anything");
  d.querySelector(".hw-teaser").click();
  assert.equal(d.querySelector(".hw-box").classList.contains("open"), true, "clicking the teaser opens the chat");
});

test("data-avatar shows a logo in the header, and ignores unsafe values", async () => {
  const ok = boot({ config: { status: 200, body: { title: "Chat with Heario", greeting: "G", color: "#4f8ef7" } }, chatReply: { status: 200, body: {} }, data: { avatar: "/favicon.svg" } });
  await ok.flush();
  assert.equal(ok.window.document.querySelector(".hw-av img").getAttribute("src"), "/favicon.svg");

  for (const bad of ["javascript:alert(1)", "//evil.example/x.png", "http://insecure.example/x.png", 'x" onerror="alert(1)']) {
    const t = boot({ config: { status: 200, body: { title: "T", greeting: "G", color: "#4f8ef7" } }, chatReply: { status: 200, body: {} }, data: { avatar: bad } });
    await t.flush();
    assert.equal(t.window.document.querySelector(".hw-av img"), null, bad);
  }
});

test("only the owner's booking link is clickable in replies; other links and the visitor's text stay plain", async () => {
  const t = boot({
    config: { status: 200, body: { title: "T", greeting: "Hi", color: "#112233", booking_url: "https://calendly.com/murphy/" } },
    chatReply: { status: 200, body: { reply: "Book at https://calendly.com/murphy. Or see https://evil.example now.", notified: false } },
  });
  await t.flush();
  const d = t.window.document;
  d.querySelector(".hw-in").value = "see https://calendly.com/murphy/";
  d.querySelector(".hw-form").dispatchEvent(new t.window.Event("submit", { cancelable: true }));
  await t.flush();
  const links = [...d.querySelectorAll(".hw-msgs a")];
  assert.equal(links.length, 1);
  assert.equal(links[0].href, "https://calendly.com/murphy/");
  assert.equal(links[0].target, "_blank");
  assert.match(links[0].rel, /noopener/);
  assert.equal(links[0].closest(".hw-m").className.includes("bot"), true);
  assert.equal(d.querySelectorAll(".hw-m.bot").item(1).textContent, "Book at https://calendly.com/murphy. Or see https://evil.example now.");
});
