// Builds the public install guides (install/*.html) from the same
// step-by-step instructions the dashboard uses (PLATFORMS in dashboard.js),
// so the two never drift apart. Run: npm run build-guides
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://heario.ai";

export function loadPlatforms() {
  const js = fs.readFileSync(path.join(root, "dashboard.js"), "utf8");
  const m = js.match(/var PLATFORMS = (\[[\s\S]*?\n {2}\]);/);
  if (!m) throw new Error("PLATFORMS not found in dashboard.js");
  return vm.runInNewContext(m[1]);
}

// Public page details for each dashboard platform. Platforms not listed here
// (for example "I have a web developer") get no public page.
const PAGES = {
  wordpress: { slug: "wordpress", title: "WordPress",
    intro: "WordPress doesn't have a built-in box for site-wide code, so the easiest way is the free WPCode plugin. It adds a footer box that loads your chat on every page, and it keeps working when you change or update your theme." },
  wix: { slug: "wix", title: "Wix",
    intro: "Wix has a Custom Code setting that adds code to every page of your site. You paste your chat code there once and it appears on all pages." },
  squarespace: { slug: "squarespace", title: "Squarespace",
    intro: "Squarespace's Code Injection setting adds code to every page. Paste your chat code into the footer box once and the chat appears across your whole site." },
  shopify: { slug: "shopify", title: "Shopify",
    intro: "On Shopify you add the chat to your theme's main layout file, theme.liquid. Every page of your store uses that file, so one paste puts the chat on every page, including product and collection pages." },
  webflow: { slug: "webflow", title: "Webflow",
    intro: "Webflow's site-wide Custom Code setting adds code to every page. Paste your chat code into the footer code box, publish, and the chat is live." },
  framer: { slug: "framer", title: "Framer",
    intro: "Framer lets you add custom code to the end of every page from Site Settings. Paste your chat code there and publish." },
  square: { slug: "square-online", title: "Square Online",
    intro: "Square Online calls site-wide code \"Tracking Tools\". Add your chat code there, set it to load at the end of the body, and publish your site." },
  jimdo: { slug: "jimdo", title: "Jimdo",
    intro: "In Jimdo Creator, the Edit Head setting adds code to every page of your site. Paste your chat code there once." },
  gtm: { slug: "google-tag-manager", title: "Google Tag Manager", phrase: "using Google Tag Manager",
    intro: "If your website already loads Google Tag Manager, you can add the chat as a Custom HTML tag without touching your website's code. It works with any website builder that supports Tag Manager." },
  godaddy: { slug: "godaddy", title: "GoDaddy",
    intro: "Whether you can add a chat to a GoDaddy website depends on which kind of GoDaddy site you have. Here's how to tell and what to do." },
  html: { slug: "any-website", title: "any website", h1: "How to add an AI chatbot to any website", short: "Any website",
    intro: "Heario works on any website that lets you add a line of code before the closing </body> tag. That covers hand-built sites, most website builders and most content management systems." },
};

const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const rich = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
const plain = (t) => String(t).replace(/\*\*(.+?)\*\*/g, "$1");
// The dashboard's {copy} marker is a "Copy code" button; on the public page
// the code was copied in step 1, so the marker is just dropped.
const stepText = (t) => t.replace("{copy} ", "").replace("{copy}", "");

function head({ title, desc, url, jsonld }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}" />
  <link rel="canonical" href="${url}" />
  <meta property="og:site_name" content="Heario" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(desc)}" />
  <meta property="og:image" content="${SITE}/og.png?v=2" />
  <meta property="og:url" content="${url}" />
  <meta property="og:type" content="article" />
  <meta name="twitter:card" content="summary_large_image" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="stylesheet" href="/style.css" />
  <link rel="stylesheet" href="/guides.css" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Sora:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
${jsonld.map((j) => `  <script type="application/ld+json">\n${JSON.stringify(j, null, 2)}\n  </script>`).join("\n")}
</head>
<body>
<div class="site-bg" aria-hidden="true">
  <div class="g-aurora g-aurora-1"></div>
  <div class="g-aurora g-aurora-2"></div>
</div>
<header class="guide-nav">
  <a href="/" class="logo">Heario</a>
  <div><a href="/login.html" class="guide-login">Log in</a><a href="/login.html" class="guide-cta">Start free trial</a></div>
</header>
<main class="guide">`;
}

function foot() {
  return `</main>
<footer class="guide-foot">
  <span>&copy; 2026 Heario</span>
  <a href="/">Home</a><a href="/install/">Install guides</a><a href="/privacy.html">Privacy</a><a href="/terms.html">Terms</a><a href="mailto:support@heario.ai">Contact</a>
</footer>
<script src="/widget.js?v=9" data-key="hb_f307f807bdebb7339ec7ca27" data-theme="dark" data-avatar="/favicon.svg" data-teaser="Hi &#128075; Got a question for Heario?|Ask me anything. If I can&rsquo;t help, I&rsquo;ll automatically pass on your message and we&rsquo;ll be in touch." defer></script>
</body>
</html>
`;
}

const CTA = `<div class="guide-cta-box">
    <h2>Don't have Heario yet?</h2>
    <p>Heario adds an AI assistant to your website that answers visitors' questions 24/7 and sends every enquiry straight to your WhatsApp. Setup takes about 10 minutes, and the 14-day free trial needs no card.</p>
    <a href="/login.html" class="guide-cta">Start your free trial</a>
  </div>`;

function pageFor(p, info, all) {
  const name = info.title;
  const phrase = info.phrase || `to your ${name} website`;
  const h1 = info.h1 || `How to add an AI chatbot ${phrase}`;
  const url = `${SITE}/install/${info.slug}.html`;
  const unsupported = p.id === "godaddy";
  const steps = unsupported ? p.steps.map(stepText)
    : ["Log in to your **Heario dashboard**, go to **4. Add it to your website** and click **Copy code**."].concat(p.steps.map(stepText));
  const desc = unsupported
    ? "Can you add an AI chatbot to a GoDaddy website? What works on GoDaddy Websites + Marketing and GoDaddy WordPress sites."
    : `Step-by-step: add Heario's AI chat ${phrase} in about 5 minutes. Answers visitors 24/7 and sends every enquiry to your WhatsApp.`;
  const jsonld = [{
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Heario", item: SITE + "/" },
      { "@type": "ListItem", position: 2, name: "Install guides", item: SITE + "/install/" },
      { "@type": "ListItem", position: 3, name: info.short || name, item: url },
    ],
  }];
  if (!unsupported) jsonld.push({
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: h1,
    totalTime: "PT5M",
    step: steps.map((s, i) => ({ "@type": "HowToStep", position: i + 1, text: plain(s) })),
  });
  const others = all.filter((x) => x.id !== p.id && PAGES[x.id])
    .map((x) => `<a href="/install/${PAGES[x.id].slug}.html">${esc(PAGES[x.id].short || PAGES[x.id].title)}</a>`).join("");

  return head({ title: unsupported ? "Can you add an AI chatbot to a GoDaddy website? | Heario" : `${h1} | Heario`, desc, url, jsonld }) + `
  <nav class="guide-crumbs" aria-label="Breadcrumb"><a href="/">Heario</a> › <a href="/install/">Install guides</a> › ${esc(info.short || name)}</nav>
  <h1>${esc(unsupported ? "Can you add an AI chatbot to a GoDaddy website?" : h1)}</h1>
  <p class="guide-lead">${esc(info.intro)}</p>
  ${unsupported ? "" : `<p class="guide-meta">Takes about 5 minutes · You only do it once · The chat then appears on every page</p>`}

  ${unsupported ? "" : `<h2>Before you start</h2>
  <ul>
    <li>You'll need a Heario account. <a href="/login.html">Start a free trial</a> if you don't have one yet.</li>
    <li>In your Heario dashboard, add your website address under <b>3. Your website</b> and click <b>Save</b>. The chat only runs on the addresses you list.</li>
  </ul>`}

  <h2>${unsupported ? "What to do" : "Steps"}</h2>
  <ol class="guide-steps">
${steps.map((s) => `    <li>${rich(s)}</li>`).join("\n")}
  </ol>
  ${p.note ? `<p class="guide-note"><b>Good to know:</b> ${esc(p.note)}</p>` : ""}

  ${unsupported ? "" : `<h2>Check it's working</h2>
  <p>Open your website in a private or incognito window. The chat bubble should appear in the bottom corner within a few seconds. It won't show inside your ${esc(p.id === "html" || p.id === "gtm" ? "website editor" : name + " editor")} or preview, only on your published site.</p>

  <h2>Chat bubble not showing?</h2>
  <ul>
    <li>Make sure you published or saved the change.</li>
    <li>Check that the exact address you're visiting is listed under <b>3. Your website</b> in your Heario dashboard, then click Save.</li>
    <li>Check "Chatbot is switched on" is ticked in your dashboard.</li>
    <li>Paste the code only once. If you've also added it to a page block, remove that copy.</li>
  </ul>`}
  ${unsupported ? "" : `<p>Still stuck? Email <a href="mailto:support@heario.ai">support@heario.ai</a> with your website address and we'll set it up with you, free.</p>`}

  ${CTA}

  <h2>Guides for other website builders</h2>
  <div class="guide-others">${others}</div>
` + foot();
}

function hubPage(all) {
  const url = `${SITE}/install/`;
  const listed = all.filter((p) => PAGES[p.id]);
  const jsonld = [{
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "How to add an AI chatbot to your website",
    url,
    hasPart: listed.map((p) => ({ "@type": "WebPage", name: `Add a chatbot to ${PAGES[p.id].title}`, url: `${SITE}/install/${PAGES[p.id].slug}.html` })),
  }];
  return head({ title: "How to add an AI chatbot to your website: guides for every builder | Heario",
    desc: "Step-by-step guides to add Heario's AI chat to WordPress, Wix, Squarespace, Shopify, Webflow, Framer, Square Online and any other website.", url, jsonld }) + `
  <nav class="guide-crumbs" aria-label="Breadcrumb"><a href="/">Heario</a> › Install guides</nav>
  <h1>How to add an AI chatbot to your website</h1>
  <p class="guide-lead">Adding Heario to your website takes about 5 minutes. You copy one line of code from your dashboard and paste it into your website builder's settings, once, and the chat appears on every page. Pick your website builder for step-by-step instructions.</p>
  <div class="guide-grid">
${listed.map((p) => `    <a href="/install/${PAGES[p.id].slug}.html"><b>${esc(PAGES[p.id].short || PAGES[p.id].title)}</b><span>${esc(p.id === "godaddy" ? "What works on GoDaddy" : p.id === "html" ? "Paste before </body>" : p.steps.length + 1 + " steps")}</span></a>`).join("\n")}
  </div>
  <h2>Prefer us to do it?</h2>
  <p>Not technical, or short on time? Email <a href="mailto:support@heario.ai">support@heario.ai</a> with your website address and we'll set it up for you, free. You can also send your code and instructions straight to your web developer from your dashboard.</p>
  ${CTA}
` + foot();
}

export function buildGuides() {
  const all = loadPlatforms();
  const out = { "install/index.html": hubPage(all) };
  for (const p of all) if (PAGES[p.id]) out[`install/${PAGES[p.id].slug}.html`] = pageFor(p, PAGES[p.id], all);
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  fs.mkdirSync(path.join(root, "install"), { recursive: true });
  for (const [f, html] of Object.entries(buildGuides())) fs.writeFileSync(path.join(root, f), html);
  console.log("Wrote", Object.keys(buildGuides()).join(", "));
}
