// Homepage price card, run in jsdom against the real pricing.js + home.js.
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { JSDOM } from "jsdom";

const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");

function page(apiBody, { stored } = {}) {
  const dom = new JSDOM(
    '<body><div class="amt" id="priceAmt">Simple monthly pricing</div><div class="cur-switch" id="curSwitch" hidden></div><p id="setupNote" hidden></p></body>',
    { url: "https://heario.ai/", runScripts: "outside-only" }
  );
  const { window } = dom;
  if (stored) window.localStorage.setItem("heario_currency", stored);
  window.fetch = async () => ({ json: async () => apiBody });
  window.eval(read("pricing.js"));
  window.eval(read("home.js"));
  return { window, flush: () => new Promise((r) => setTimeout(r, 20)), d: window.document };
}

const API = {
  currency: "gbp",
  prices: { eur: { amount: 2900, display: "€29" }, gbp: { amount: 2500, display: "£25" }, usd: { amount: 3100, display: "$31" } },
};

test("shows the visitor's regional price, with a currency switcher", async () => {
  const p = page(API);
  await p.flush();
  assert.equal(p.d.getElementById("priceAmt").textContent, "£25 / month");
  assert.equal(p.d.getElementById("curSwitch").hidden, false);
  assert.deepEqual([...p.d.querySelectorAll("#curSwitch button")].map((b) => b.textContent), ["EUR €", "GBP £", "USD $"]);
  assert.equal(p.d.querySelector('#curSwitch button[aria-pressed="true"]').textContent, "GBP £");
});

test("switching currency updates the price and is remembered", async () => {
  const p = page(API);
  await p.flush();
  [...p.d.querySelectorAll("#curSwitch button")].find((b) => b.textContent.startsWith("USD")).click();
  assert.equal(p.d.getElementById("priceAmt").textContent, "$31 / month");
  assert.equal(p.window.localStorage.getItem("heario_currency"), "usd");
  const again = page(API, { stored: "usd" });
  await again.flush();
  assert.equal(again.d.getElementById("priceAmt").textContent, "$31 / month", "a returning visitor keeps their choice");
});

test("when prices are unavailable the card keeps its neutral text (no invented number)", async () => {
  const p = page({ prices: null, currency: "eur" });
  await p.flush();
  assert.equal(p.d.getElementById("priceAmt").textContent, "Simple monthly pricing");
  assert.equal(p.d.getElementById("curSwitch").hidden, true);
});

test("homepage mentions the optional setup fee in the visitor's currency, and hides it when there isn't one", async () => {
  const withSetup = page({ ...API, setup: { eur: { amount: 1999, display: "€19.99" }, gbp: { amount: 1699, display: "£16.99" } } });
  await withSetup.flush();
  const note = withSetup.d.getElementById("setupNote");
  assert.equal(note.hidden, false);
  assert.match(note.textContent, /£16\.99/);

  const without = page(API);
  await without.flush();
  assert.equal(without.d.getElementById("setupNote").hidden, true);
});
