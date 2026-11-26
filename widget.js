/*! Heario chat widget. Add to any website, just before </body>:
 *   <script src="https://heario.ai/widget.js" data-key="hb_..." defer></script>
 * Optional attributes:
 *   data-theme="dark"            dark panel for dark websites (default: light)
 *   data-teaser="Title|Line"     a small speech bubble beside the button, shown once per visit
 *   data-avatar="/logo.png"      your logo in the chat header (https:// or a path on your site)
 * Page API (once loaded): HearioWidget.open(), .close(), .ask("question"), .destroy().
 * Fires a "heario:ready" event on window when the chat is ready.
 */
(function () {
  // Some site builders and optimisers load scripts in ways that hide currentScript, so fall back to finding our tag.
  var s = document.currentScript || document.querySelector('script[src*="/widget.js"][data-key]');
  if (!s || !s.dataset.key || window.HearioWidget) return;
  var KEY = s.dataset.key;
  var DARK = s.dataset.theme === "dark";
  var TEASER = String(s.dataset.teaser || "").slice(0, 200); // the page can set its own pop-up; otherwise the owner's dashboard setting is used
  var AVATAR = String(s.dataset.avatar || "");
  var BASE = new URL(s.src).origin;
  var STORE = "heario_chat_" + KEY;
  var SEEN = "heario_teaser_" + KEY;
  var history = [];
  var busy = false;
  var nodes = [];
  var api = { open: function () {}, close: function () {}, ask: function () {} };

  try { history = JSON.parse(sessionStorage.getItem(STORE) || "[]"); } catch (e) {}

  fetch(BASE + "/api/widget-config?key=" + encodeURIComponent(KEY))
    .then(function (r) { if (!r.ok) throw new Error("not allowed"); return r.json(); })
    .then(build)
    .catch(function () { /* unknown key or site not allowed: render nothing */ });

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    e.className = cls;
    if (text) e.textContent = text; // textContent only: no HTML injection from replies
    return e;
  }

  // Lighten (amt > 0) or darken (amt < 0) a #rrggbb colour.
  function shade(hex, amt) {
    var n = parseInt(hex.slice(1), 16), out = "#";
    [16, 8, 0].forEach(function (sh) {
      var c = (n >> sh) & 255;
      c = amt > 0 ? Math.round(c + (255 - c) * amt) : Math.round(c * (1 + amt));
      out += ("0" + c.toString(16)).slice(-2);
    });
    return out;
  }

  var ICON_CHAT = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 21l2.1-5.6A8.4 8.4 0 1 1 21 11.5z"/><path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01" stroke-width="2.6"/></svg>';
  var ICON_X = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  var ICON_SEND = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>';

  function build(cfg) {
    var C = /^#[0-9a-fA-F]{6}$/.test(cfg.color) ? cfg.color : "#4f8ef7";
    var C2 = shade(C, -0.28);
    var T = DARK
      ? { bg: "#0f141d", panel: "#131924", line: "#242c3c", text: "#e6ebf3", muted: "#8b96a9", bot: "#1b2231", input: "#111722" }
      : { bg: "#ffffff", panel: "#f5f7fa", line: "#e3e6eb", text: "#141821", muted: "#7b8492", bot: "#ffffff", input: "#ffffff" };
    var css = document.createElement("style");
    css.textContent =
      ".hw-btn,.hw-box,.hw-teaser{font:14px/1.45 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;box-sizing:border-box;letter-spacing:normal;text-align:left}" +
      ".hw-box *,.hw-teaser *{box-sizing:border-box}" +
      ".hw-btn{position:fixed;right:20px;bottom:20px;width:60px;height:60px;border-radius:50%;border:0;padding:0;display:grid;place-items:center;background:linear-gradient(140deg," + C + "," + C2 + ");color:#fff;cursor:pointer;box-shadow:0 10px 28px " + C + "66,0 2px 6px rgba(0,0,0,.25);z-index:2147483000;transition:transform .25s}" +
      ".hw-btn:hover{transform:scale(1.06)}.hw-btn:focus-visible{outline:3px solid " + shade(C, 0.5) + ";outline-offset:3px}" +
      ".hw-btn::before{content:'';position:absolute;inset:0;border-radius:50%;animation:hw-ring 2.6s ease-out infinite}" +
      ".hw-btn.open::before{animation:none}" +
      ".hw-btn span{display:grid;place-items:center;transition:transform .3s,opacity .2s}" +
      ".hw-btn .hw-x{position:absolute;opacity:0;transform:rotate(-90deg)}.hw-btn.open .hw-x{opacity:1;transform:none}.hw-btn.open .hw-chat{opacity:0;transform:rotate(90deg)}" +
      "@keyframes hw-ring{0%{box-shadow:0 0 0 0 " + C + "77}70%{box-shadow:0 0 0 16px " + C + "00}100%{box-shadow:0 0 0 0 " + C + "00}}" +
      ".hw-teaser{position:fixed;right:20px;bottom:94px;max-width:260px;padding:12px 34px 12px 14px;border-radius:16px 16px 4px 16px;background:" + T.bg + ";color:" + T.text + ";border:1px solid " + T.line + ";box-shadow:0 14px 36px rgba(0,0,0,.3);z-index:2147483000;cursor:pointer;opacity:0;transform:translateY(10px) scale(.96);transition:opacity .35s,transform .35s;pointer-events:none}" +
      ".hw-teaser.show{opacity:1;transform:none;pointer-events:auto}" +
      ".hw-teaser b{display:block;font-size:13.5px;font-weight:650}.hw-teaser span{display:block;margin-top:2px;font-size:12.5px;color:" + T.muted + "}" +
      ".hw-tx{position:absolute;top:6px;right:6px;width:22px;height:22px;border:0;border-radius:50%;background:transparent;color:" + T.muted + ";cursor:pointer;font-size:16px;line-height:1;padding:0}" +
      ".hw-box{position:fixed;right:20px;bottom:92px;width:370px;max-width:calc(100vw - 24px);height:540px;max-height:calc(100vh - 112px);background:" + T.bg + ";color:" + T.text + ";border-radius:18px;border:1px solid " + T.line + ";box-shadow:0 24px 60px rgba(0,0,0,.35);display:none;flex-direction:column;overflow:hidden;z-index:2147483000}" +
      ".hw-box.open{display:flex;animation:hw-in .28s cubic-bezier(.2,.8,.2,1)}" +
      "@keyframes hw-in{from{opacity:0;transform:translateY(14px) scale(.97)}to{opacity:1;transform:none}}" +
      ".hw-head{display:flex;align-items:center;gap:11px;background:linear-gradient(120deg," + C + "," + C2 + ");color:#fff;padding:13px 12px 13px 14px}" +
      ".hw-av{position:relative;flex:0 0 38px;height:38px;border-radius:50%;display:grid;place-items:center;font-weight:700;font-size:16px;background:rgba(255,255,255,.22);border:1.5px solid rgba(255,255,255,.45)}" +
      ".hw-av img{position:absolute;inset:0;width:100%;height:100%;border-radius:50%;object-fit:cover;background:#0b0e13;opacity:0;transition:opacity .2s}.hw-av.has-img img{opacity:1}" +
      ".hw-av i{position:absolute;right:-1px;bottom:-1px;width:11px;height:11px;border-radius:50%;background:#3ddc84;border:2px solid " + C2 + "}" +
      ".hw-who{flex:1;min-width:0}.hw-title{font-weight:650;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".hw-meta{display:flex;align-items:center;gap:5px;font-size:12px;opacity:.92}.hw-live{opacity:.85}" +
      ".hw-close{flex:0 0 32px;height:32px;border:0;border-radius:50%;background:rgba(255,255,255,.14);color:#fff;cursor:pointer;display:grid;place-items:center;padding:0}" +
      ".hw-close:hover{background:rgba(255,255,255,.26)}" +
      ".hw-msgs{flex:1;overflow:auto;padding:16px 14px;display:flex;flex-direction:column;gap:9px;background:" + T.panel + "}" +
      ".hw-m{max-width:84%;padding:9px 12px;border-radius:16px;white-space:pre-wrap;word-wrap:break-word;animation:hw-pop .25s ease-out}" +
      "@keyframes hw-pop{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}" +
      ".hw-m.bot{background:" + T.bot + ";border:1px solid " + T.line + ";align-self:flex-start;border-top-left-radius:5px}" +
      ".hw-link{color:inherit;text-decoration:underline;font-weight:600;word-break:break-all}" +
      ".hw-m.me{background:linear-gradient(135deg," + C + "," + C2 + ");color:#fff;align-self:flex-end;border-top-right-radius:5px}" +
      ".hw-typing{display:inline-flex;gap:4px;align-items:center;padding:12px 14px}" +
      ".hw-typing i{width:7px;height:7px;border-radius:50%;background:" + T.muted + ";animation:hw-dot 1s infinite}" +
      ".hw-typing i:nth-child(2){animation-delay:.15s}.hw-typing i:nth-child(3){animation-delay:.3s}" +
      "@keyframes hw-dot{0%,60%,100%{transform:none;opacity:.45}30%{transform:translateY(-4px);opacity:1}}" +
      ".hw-note{align-self:center;font-size:12px;color:" + (DARK ? "#7ee2a8" : "#16803f") + ";background:rgba(61,220,132,.12);border:1px solid rgba(61,220,132,.35);padding:4px 11px;border-radius:999px}" +
      ".hw-card{align-self:stretch;background:" + T.bot + ";border:1px solid " + T.line + ";border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:8px;animation:hw-pop .25s ease-out}" +
      ".hw-card label{font-size:12px;color:" + T.muted + ";display:flex;flex-direction:column;gap:3px}" +
      ".hw-card input,.hw-card textarea{width:100%;border:1px solid " + T.line + ";border-radius:9px;padding:8px 10px;font:inherit;background:" + T.input + ";color:" + T.text + ";outline:none;box-shadow:none}" +
      ".hw-card input:focus,.hw-card textarea:focus{border-color:" + C + "}" +
      ".hw-card textarea{resize:vertical;min-height:64px}" +
      ".hw-card button{border:0;border-radius:10px;padding:10px;font:inherit;font-weight:650;color:#fff;cursor:pointer;background:linear-gradient(140deg," + C + "," + C2 + ")}" +
      ".hw-card button:disabled{opacity:.6;cursor:default}" +
      ".hw-card .hw-err{font-size:12px;color:#d64545;min-height:0}" +
      ".hw-form{display:flex;align-items:center;gap:8px;padding:10px 10px 10px 14px;border-top:1px solid " + T.line + ";background:" + T.input + ";margin:0}" +
      ".hw-in{flex:1;min-width:0;border:0;padding:8px 0;font:inherit;outline:none;background:transparent;color:" + T.text + ";box-shadow:none}" +
      ".hw-in::placeholder{color:" + T.muted + "}" +
      ".hw-send{flex:0 0 38px;height:38px;border:0;border-radius:12px;background:linear-gradient(140deg," + C + "," + C2 + ");color:#fff;cursor:pointer;display:grid;place-items:center;padding:0}" +
      ".hw-send:disabled{opacity:.5;cursor:default}" +
      ".hw-foot{font-size:11px;text-align:center;color:" + T.muted + ";padding:6px;background:" + T.input + "}.hw-foot a{color:inherit}" +
      "@media (max-width:480px){.hw-card input,.hw-card textarea{font-size:16px}.hw-box{right:0;bottom:0;width:100%;max-width:none;height:100%;max-height:none;border-radius:0;border:0}.hw-btn.open{display:none}.hw-teaser{right:16px;bottom:90px}.hw-in{font-size:16px}}" +
      "@media (prefers-reduced-motion:reduce){.hw-btn::before,.hw-box.open,.hw-m,.hw-typing i{animation:none}}";

    var btn = el("button", "hw-btn");
    btn.type = "button";
    btn.innerHTML = '<span class="hw-chat">' + ICON_CHAT + '</span><span class="hw-x">' + ICON_X + "</span>";
    btn.setAttribute("aria-label", "Open chat");
    btn.setAttribute("aria-expanded", "false");

    var box = el("div", "hw-box");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", cfg.title || "Chat");
    var head = el("div", "hw-head");
    var name = String(cfg.title || "").replace(/^Chat with\s+/i, "");
    var av = el("div", "hw-av", (name.charAt(0) || "?").toUpperCase());
    if (/^(https:\/\/|\/(?!\/))[^\s"'<>]+$/.test(AVATAR)) {
      var img = document.createElement("img");
      img.alt = "";
      img.src = AVATAR;
      img.onload = function () { av.classList.add("has-img"); };
      img.onerror = function () { img.remove(); };
      av.appendChild(img);
    }
    av.appendChild(el("i", ""));
    var who = el("div", "hw-who");
    who.appendChild(el("div", "hw-title", cfg.title));
    var meta = el("div", "hw-meta");
    meta.appendChild(el("span", "hw-sub", "AI assistant"));
    meta.appendChild(el("span", "hw-live", "· Online now"));
    who.appendChild(meta);
    var close = el("button", "hw-close");
    close.type = "button";
    close.innerHTML = ICON_X;
    close.setAttribute("aria-label", "Close chat");
    head.appendChild(av); head.appendChild(who); head.appendChild(close);

    var msgs = el("div", "hw-msgs");
    msgs.setAttribute("aria-live", "polite");
    var form = el("form", "hw-form");
    var input = el("input", "hw-in");
    input.placeholder = "Type your message…";
    input.maxLength = 1000;
    input.setAttribute("aria-label", "Message");
    var send = el("button", "hw-send");
    send.type = "submit";
    send.innerHTML = ICON_SEND;
    send.setAttribute("aria-label", "Send");
    form.appendChild(input);
    form.appendChild(send);
    var foot = el("div", "hw-foot", "AI-generated replies. Powered by ");
    var link = el("a", "", "Heario");
    link.href = BASE; link.target = "_blank"; link.rel = "noopener";
    foot.appendChild(link);
    box.appendChild(head); box.appendChild(msgs); box.appendChild(form); box.appendChild(foot);

    var teaser = null, tx = null;
    if (!TEASER && typeof cfg.teaser === "string") TEASER = cfg.teaser.slice(0, 200);
    if (TEASER) {
      teaser = el("div", "hw-teaser");
      teaser.setAttribute("role", "button");
      teaser.setAttribute("tabindex", "0");
      var parts = TEASER.split("|");
      teaser.appendChild(el("b", "", parts[0]));
      if (parts[1]) teaser.appendChild(el("span", "", parts[1]));
      tx = el("button", "hw-tx", "×");
      tx.type = "button";
      tx.setAttribute("aria-label", "Dismiss");
      teaser.appendChild(tx);
    }

    document.head.appendChild(css);
    document.body.appendChild(btn);
    document.body.appendChild(box);
    nodes = [css, btn, box];
    if (teaser) { document.body.appendChild(teaser); nodes.push(teaser); }

    // The owner's booking link (and only that) becomes clickable in the assistant's replies.
    var BOOK = typeof cfg.booking_url === "string" && /^https:\/\//.test(cfg.booking_url) ? cfg.booking_url : "";
    function setText(m, text) {
      m.textContent = "";
      var s = String(text || "");
      // The AI may drop "https://" or a trailing slash; those still count as the booking link.
      var bare = BOOK.replace(/^https:\/\//, "");
      var forms = BOOK ? [BOOK, BOOK.replace(/\/$/, ""), bare, bare.replace(/\/$/, "")].filter(function (v, i, a) { return v.length > 8 && a.indexOf(v) === i; }) : [];
      while (s) {
        var at = -1, hit = "";
        forms.forEach(function (f) { var i = s.indexOf(f); if (i > -1 && (at === -1 || i < at || (i === at && f.length > hit.length))) { at = i; hit = f; } });
        if (at === -1) { m.appendChild(document.createTextNode(s)); break; }
        if (at) m.appendChild(document.createTextNode(s.slice(0, at)));
        var a = document.createElement("a");
        a.href = BOOK; a.target = "_blank"; a.rel = "noopener noreferrer"; a.className = "hw-link";
        a.textContent = hit;
        m.appendChild(a);
        s = s.slice(at + hit.length);
      }
    }
    function add(role, text) {
      var m = el("div", "hw-m " + (role === "user" ? "me" : "bot"));
      if (role === "user") m.textContent = text || ""; else setText(m, text);
      msgs.appendChild(m);
      msgs.scrollTop = msgs.scrollHeight;
      return m;
    }
    function typingBubble() {
      var m = el("div", "hw-m bot hw-typing");
      m.setAttribute("aria-label", "Typing");
      m.innerHTML = "<i></i><i></i><i></i>";
      msgs.appendChild(m);
      msgs.scrollTop = msgs.scrollHeight;
      return m;
    }
    function settle(m, text) {
      m.classList.remove("hw-typing");
      m.removeAttribute("aria-label");
      setText(m, text);
      msgs.scrollTop = msgs.scrollHeight;
    }
    // Short enquiry form, shown when AI replies are paused (monthly limit reached or the AI is down).
    var card = null;
    function leadCard() {
      if (card && card.parentNode) { msgs.appendChild(card); msgs.scrollTop = msgs.scrollHeight; return; }
      card = el("form", "hw-card");
      card.noValidate = true;
      function field(label, tag, type, auto) {
        var l = el("label", "", label), f = document.createElement(tag);
        if (type) f.type = type;
        if (auto) f.autocomplete = auto;
        f.maxLength = tag === "textarea" ? 600 : 120;
        l.appendChild(f); card.appendChild(l);
        return f;
      }
      var fName = field("Your name", "input", "text", "name");
      var fContact = field("Phone or email", "input", "text", "tel");
      var fMsg = field("What do you need?", "textarea");
      fMsg.value = history.filter(function (m) { return m.role === "user"; }).map(function (m) { return m.content; }).join(" ").slice(-600);
      var err = el("div", "hw-err");
      err.setAttribute("role", "alert");
      var go = el("button", "", "Send enquiry");
      go.type = "submit";
      card.appendChild(err); card.appendChild(go);
      card.onsubmit = function (ev) {
        ev.preventDefault();
        var lead = { name: fName.value.trim(), contact: fContact.value.trim(), enquiry: fMsg.value.trim() };
        if (!lead.name || !lead.contact || !lead.enquiry) { err.textContent = "Please fill in all three."; return; }
        err.textContent = ""; go.disabled = true; go.textContent = "Sending…";
        fetch(BASE + "/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: KEY, lead: lead }) })
          .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
          .then(function (x) {
            if (!x.ok) throw new Error(x.d.error || "error");
            card.remove(); card = null;
            msgs.appendChild(el("div", "hw-note", "✓ Enquiry sent. They'll be in touch."));
            history.push({ role: "user", content: "[Sent an enquiry with the form]" }, { role: "assistant", content: "Thanks, I've passed that on." });
            save();
            msgs.scrollTop = msgs.scrollHeight;
          })
          .catch(function (e) {
            err.textContent = e.message && e.message !== "error" ? e.message : "Sorry, that didn't send. Please try again.";
            go.disabled = false; go.textContent = "Send enquiry";
          });
      };
      msgs.appendChild(card);
      msgs.scrollTop = msgs.scrollHeight;
      fName.focus();
    }
    function save() { try { sessionStorage.setItem(STORE, JSON.stringify(history.slice(-30))); } catch (e) {} }
    function hideTeaser(remember) {
      if (!teaser) return;
      teaser.classList.remove("show");
      if (remember) { try { sessionStorage.setItem(SEEN, "1"); } catch (e) {} }
    }
    function setOpen(on) {
      box.classList.toggle("open", on);
      btn.classList.toggle("open", on);
      btn.setAttribute("aria-expanded", on ? "true" : "false");
      btn.setAttribute("aria-label", on ? "Close chat" : "Open chat");
      if (on) { hideTeaser(true); input.focus(); msgs.scrollTop = msgs.scrollHeight; }
    }

    add("assistant", cfg.greeting);
    history.forEach(function (m) { add(m.role, m.content); });

    btn.onclick = function () { setOpen(!box.classList.contains("open")); };
    close.onclick = function () { setOpen(false); btn.focus(); };
    box.addEventListener("keydown", function (e) { if (e.key === "Escape") { setOpen(false); btn.focus(); } });
    if (teaser) {
      teaser.onclick = function (e) { if (e.target === tx) { hideTeaser(true); return; } setOpen(true); };
      teaser.onkeydown = function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(true); } };
      var seen = false;
      try { seen = !!sessionStorage.getItem(SEEN); } catch (e) {}
      if (!seen && !history.length) setTimeout(function () {
        if (box.classList.contains("open")) return;
        teaser.classList.add("show");
        // Don't leave it covering the page: tuck it away after a while (the bubble stays).
        setTimeout(function () { hideTeaser(true); }, 12000);
      }, 3500);
    }

    form.onsubmit = function (ev) {
      ev.preventDefault();
      var text = input.value.trim();
      if (!text || busy) return;
      input.value = "";
      busy = true;
      send.disabled = true;
      add("user", text);
      history.push({ role: "user", content: text });
      var typing = typingBubble();
      fetch(BASE + "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: KEY, messages: history })
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (x) {
          if (!x.ok) throw new Error(x.d.error || "error");
          settle(typing, x.d.reply);
          history.push({ role: "assistant", content: x.d.reply });
          if (x.d.notified) { msgs.appendChild(el("div", "hw-note", "✓ Enquiry sent. They'll be in touch.")); msgs.scrollTop = msgs.scrollHeight; }
          save();
          if (x.d.form) leadCard();
        })
        .catch(function (e) {
          settle(typing, String(e.message || "").indexOf("too fast") > -1 ? e.message : "Sorry, something went wrong. Please try again in a moment.");
          history.pop(); // drop the unanswered message so roles stay in order
        })
        .then(function () { busy = false; send.disabled = false; });
    };

    api.open = function () { setOpen(true); };
    api.close = function () { setOpen(false); };
    api.ask = function (text) {
      setOpen(true);
      if (busy || !text) return;
      input.value = String(text).slice(0, 1000);
      form.onsubmit({ preventDefault: function () {} });
    };
    try { window.dispatchEvent(new Event("heario:ready")); } catch (e) {}
  }

  window.HearioWidget = {
    open: function () { api.open(); },
    close: function () { api.close(); },
    ask: function (text) { api.ask(text); },
    destroy: function () { nodes.forEach(function (n) { n.remove(); }); window.HearioWidget = undefined; }
  };
})();
