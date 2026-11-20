/*! Heario chat widget. Add to any website, just before </body>:
 *   <script src="https://heario.ai/widget.js" data-key="hb_..." defer></script>
 */
(function () {
  var s = document.currentScript;
  if (!s || !s.dataset.key || window.HearioWidget) return;
  var KEY = s.dataset.key;
  var BASE = new URL(s.src).origin;
  var STORE = "heario_chat_" + KEY;
  var history = [];
  var busy = false;
  var nodes = [];

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

  function build(cfg) {
    var COLOR = /^#[0-9a-fA-F]{6}$/.test(cfg.color) ? cfg.color : "#4f8ef7";
    var css = document.createElement("style");
    css.textContent =
      ".hw-btn{position:fixed;right:20px;bottom:20px;width:58px;height:58px;border-radius:50%;border:0;background:" + COLOR + ";color:#fff;font-size:26px;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.28);z-index:2147483000}" +
      ".hw-box{position:fixed;right:20px;bottom:90px;width:360px;max-width:calc(100vw - 24px);height:500px;max-height:calc(100vh - 110px);background:#fff;border-radius:14px;box-shadow:0 10px 36px rgba(0,0,0,.28);display:none;flex-direction:column;overflow:hidden;z-index:2147483000;font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;color:#111}" +
      ".hw-box.open{display:flex}" +
      ".hw-head{background:" + COLOR + ";color:#fff;padding:12px 14px}.hw-title{font-weight:600}.hw-sub{font-size:11.5px;opacity:.85}" +
      ".hw-msgs{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:8px;background:#f6f7f9}" +
      ".hw-m{max-width:85%;padding:8px 11px;border-radius:12px;white-space:pre-wrap;word-wrap:break-word}" +
      ".hw-m.bot{background:#fff;border:1px solid #e3e5e8;align-self:flex-start}" +
      ".hw-m.me{background:" + COLOR + ";color:#fff;align-self:flex-end}" +
      ".hw-form{display:flex;border-top:1px solid #e3e5e8;background:#fff}" +
      ".hw-in{flex:1;border:0;padding:13px;font:inherit;outline:none;background:#fff;color:#111}" +
      ".hw-send{border:0;background:none;color:" + COLOR + ";font-weight:600;padding:0 14px;cursor:pointer}" +
      ".hw-foot{font-size:11px;text-align:center;color:#8a8f98;padding:5px;background:#fff}.hw-foot a{color:inherit}";
    var btn = el("button", "hw-btn", "💬");
    btn.setAttribute("aria-label", "Open chat");
    var box = el("div", "hw-box");
    var head = el("div", "hw-head");
    head.appendChild(el("div", "hw-title", cfg.title));
    head.appendChild(el("div", "hw-sub", "AI assistant"));
    var msgs = el("div", "hw-msgs");
    var form = el("form", "hw-form");
    var input = el("input", "hw-in");
    input.placeholder = "Type your message…";
    input.maxLength = 1000;
    input.setAttribute("aria-label", "Message");
    var send = el("button", "hw-send", "Send");
    send.type = "submit";
    form.appendChild(input);
    form.appendChild(send);
    var foot = el("div", "hw-foot", "AI-generated replies. Powered by ");
    var link = el("a", "", "Heario");
    link.href = BASE; link.target = "_blank"; link.rel = "noopener";
    foot.appendChild(link);
    box.appendChild(head); box.appendChild(msgs); box.appendChild(form); box.appendChild(foot);
    document.head.appendChild(css);
    document.body.appendChild(btn);
    document.body.appendChild(box);
    nodes = [css, btn, box];

    function add(role, text) {
      var m = el("div", "hw-m " + (role === "user" ? "me" : "bot"), text);
      msgs.appendChild(m);
      msgs.scrollTop = msgs.scrollHeight;
      return m;
    }
    function save() { try { sessionStorage.setItem(STORE, JSON.stringify(history.slice(-30))); } catch (e) {} }

    add("assistant", cfg.greeting);
    history.forEach(function (m) { add(m.role, m.content); });

    btn.onclick = function () {
      box.classList.toggle("open");
      if (box.classList.contains("open")) input.focus();
    };

    form.onsubmit = function (ev) {
      ev.preventDefault();
      var text = input.value.trim();
      if (!text || busy) return;
      input.value = "";
      busy = true;
      add("user", text);
      history.push({ role: "user", content: text });
      var typing = add("assistant", "…");
      fetch(BASE + "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: KEY, messages: history })
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (x) {
          if (!x.ok) throw new Error(x.d.error || "error");
          typing.textContent = x.d.reply;
          history.push({ role: "assistant", content: x.d.reply });
          save();
        })
        .catch(function (e) {
          typing.textContent = String(e.message || "").indexOf("too fast") > -1 ? e.message : "Sorry, something went wrong. Please try again in a moment.";
          history.pop(); // drop the unanswered message so roles stay in order
        })
        .then(function () { busy = false; });
    };
  }

  window.HearioWidget = {
    destroy: function () { nodes.forEach(function (n) { n.remove(); }); window.HearioWidget = undefined; }
  };
})();
