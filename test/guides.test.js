import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildGuides } from "../scripts/build-guides.mjs";

test("install guide pages are up to date with the dashboard's instructions", () => {
  const pages = buildGuides();
  assert.ok(Object.keys(pages).length >= 10);
  for (const [f, html] of Object.entries(pages)) {
    assert.equal(fs.readFileSync(new URL("../" + f, import.meta.url), "utf8"), html, f + " is out of date: run npm run build-guides");
    assert.ok(!html.includes("{copy}"), f);
  }
  const sitemap = fs.readFileSync(new URL("../sitemap.xml", import.meta.url), "utf8");
  for (const f of Object.keys(pages)) assert.ok(sitemap.includes("https://heario.ai/" + f.replace("index.html", "")), f + " missing from sitemap");
});
