(function () {
  var $ = function (id) { return document.getElementById(id); };
  var state = null;
  var priceInfo = null;

  function api(method, path, body) {
    return fetch(path, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then(function (r) {
      if (r.status === 401) { location.replace('/login.html'); throw new Error('Please log in.'); }
      return r.json().then(function (d) {
        if (!r.ok) throw new Error(d.error || 'Something went wrong.');
        return d;
      });
    });
  }

  function say(id, text, cls) { var e = $(id); e.textContent = text; e.className = 'cb-msg ' + (cls || ''); e.style.margin = '0'; }

  function el(tag, text, cls) {
    var e = document.createElement(tag);
    if (text !== undefined) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }

  function fill(me) {
    state = me;
    var b = me.bot;
    $('who').textContent = me.email;
    $('business_name').value = b.business_name;
    $('owner_name').value = b.owner_name;
    $('knowledge').value = b.knowledge;
    $('response_time').value = b.response_time;
    $('owner_whatsapp').value = b.owner_whatsapp;
    $('whatsapp_consent').checked = b.whatsapp_consent;
    $('allowed_origins').value = b.allowed_origins.join(', ');
    if (!$('import_url').value && b.allowed_origins.length) $('import_url').value = b.allowed_origins[0].replace(/^https?:\/\//, '');
    $('color').value = b.color;
    $('greeting').value = b.greeting;
    $('enabled').checked = b.enabled;
    $('snippet').textContent = '<script src="' + location.origin + '/widget.js" data-key="' + b.embed_key + '" defer></script>';
    renderPlan(me);
    loadPreview(b.embed_key);
  }

  function renderPlan(me) {
    var p = me.plan, banner = $('banner'), actions = $('planactions');
    banner.textContent = '';
    actions.textContent = '';
    var box = el('div', undefined, 'banner'), text = el('p');
    if (p.status === 'trial') {
      text.textContent = 'Free trial: ' + p.trialDaysLeft + ' day' + (p.trialDaysLeft === 1 ? '' : 's') + ' left.';
    } else if (p.status === 'subscribed') {
      box.className = 'banner good';
      text.textContent = p.subscriptionStatus === 'past_due' ? 'Your last payment failed. Please update your card to keep the chatbot running.' : 'Your subscription is active.';
      if (p.subscriptionStatus === 'past_due') box.className = 'banner warn';
    } else {
      box.className = 'banner warn';
      text.textContent = 'Your free trial has ended, so the chatbot is paused. Subscribe to switch it back on.';
    }
    box.appendChild(text);
    if (!p.paid) {
      var buy = el('div'), cur = '';
      buy.style.cssText = 'display:flex;gap:10px;align-items:center;flex-wrap:wrap';
      if (priceInfo && priceInfo.prices) {
        cur = HearioPricing.pick(priceInfo, p.billingCurrency);
        buy.appendChild(el('span', priceInfo.prices[cur].display + ' / month', 'hint'));
        var codes = Object.keys(priceInfo.prices);
        if (!p.billingCurrency && codes.length > 1) {
          var sel = el('select', undefined, 'cb-select');
          sel.setAttribute('aria-label', 'Currency');
          codes.forEach(function (c) {
            var o = el('option', HearioPricing.labels[c] || c.toUpperCase());
            o.value = c; o.selected = c === cur; sel.appendChild(o);
          });
          sel.onchange = function () { HearioPricing.remember(sel.value); renderPlan(me); };
          buy.appendChild(sel);
        }
      }
      if (priceInfo && priceInfo.setup && priceInfo.setup[cur] && !p.hasBilling) {
        buy.appendChild(el('span', 'Optional at checkout: one-off setup assistance, ' + priceInfo.setup[cur].display + '.', 'hint'));
      }
      var sub = el('button', 'Subscribe', 'btn-primary');
      sub.type = 'button';
      sub.onclick = function () { redirectTo('/api/billing/checkout', sub, cur ? { currency: cur } : {}); };
      buy.appendChild(sub);
      box.appendChild(buy);
      actions.appendChild(el('span', 'Subscribe any time to keep the chatbot running after your trial.', 'hint'));
    }
    if (p.hasBilling) {
      var manage = el('button', 'Manage billing', 'btn-ghost');
      manage.type = 'button';
      manage.onclick = function () { redirectTo('/api/billing/portal', manage); };
      actions.appendChild(manage);
    }
    banner.appendChild(box);
    $('usage').textContent = me.usage.messages.toLocaleString() + ' of ' + me.usage.limit.toLocaleString() + ' chat messages used this month.';
  }

  function redirectTo(path, btn, body) {
    btn.disabled = true;
    api('POST', path, body || {}).then(function (d) { location.href = d.url; })
      .catch(function (e) { btn.disabled = false; alert(e.message); });
  }

  function loadPreview(key) {
    if (window.HearioWidget) window.HearioWidget.destroy();
    var s = document.createElement('script');
    s.src = '/widget.js';
    s.dataset.key = key;
    document.body.appendChild(s);
  }

  function loadLeads() {
    api('GET', '/api/leads').then(function (d) {
      var box = $('leads');
      box.textContent = '';
      if (!d.leads.length) { box.appendChild(el('p', 'No enquiries yet. They will appear here as they come in.', 'hint')); return; }
      var t = el('table', undefined, 'leads'), head = el('thead'), hr = el('tr');
      ['When', 'Name', 'Contact', 'Enquiry', 'Alert'].forEach(function (h) { hr.appendChild(el('th', h)); });
      head.appendChild(hr); t.appendChild(head);
      var body = el('tbody');
      var labels = { sent: ['WhatsApp sent', 'sent'], emailed: ['Emailed', ''], failed_emailed: ['WhatsApp failed, emailed', 'failed'], failed: ['Delivery failed', 'failed'], skipped: ['Not sent', ''] };
      d.leads.forEach(function (l) {
        var tr = el('tr'), lab = labels[l.whatsapp_status] || [l.whatsapp_status, ''];
        tr.appendChild(el('td', new Date(l.created_at).toLocaleString()));
        tr.appendChild(el('td', l.name));
        tr.appendChild(el('td', l.contact));
        tr.appendChild(el('td', l.enquiry));
        var td = el('td'); td.appendChild(el('span', lab[0], 'tag ' + lab[1])); tr.appendChild(td);
        body.appendChild(tr);
      });
      t.appendChild(body);
      box.appendChild(t);
    }).catch(function () {});
  }

  $('form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    say('savemsg', '');
    $('save').disabled = true;
    api('PUT', '/api/bot', {
      business_name: $('business_name').value,
      owner_name: $('owner_name').value,
      knowledge: $('knowledge').value,
      response_time: $('response_time').value,
      owner_whatsapp: $('owner_whatsapp').value,
      whatsapp_consent: $('whatsapp_consent').checked,
      allowed_origins: $('allowed_origins').value,
      color: $('color').value,
      greeting: $('greeting').value,
      enabled: $('enabled').checked
    }).then(function (d) {
      state.bot = d.bot;
      fill(state);
      say('savemsg', 'Saved.', 'ok');
    }).catch(function (e) { say('savemsg', e.message, 'err'); })
      .then(function () { $('save').disabled = false; });
  });

  $('testwa').addEventListener('click', function () {
    say('testmsg', 'Sending…');
    $('testwa').disabled = true;
    api('POST', '/api/bot/test-whatsapp', {})
      .then(function () { say('testmsg', 'Sent. Check your WhatsApp.', 'ok'); })
      .catch(function (e) { say('testmsg', e.message, 'err'); })
      .then(function () { $('testwa').disabled = false; });
  });

  var importing = false;
  $('importbtn').addEventListener('click', function () {
    if (importing) return;
    var url = $('import_url').value.trim();
    if (!url) { say('importmsg', 'Enter your website address first.', 'err'); $('import_url').focus(); return; }
    var host = url.replace(/^https?:\/\//i, '').split(/[\/?#]/)[0].replace(/^www\./i, '').toLowerCase();
    var listed = $('allowed_origins').value.split(/[\s,]+/).filter(Boolean).some(function (o) {
      return o.replace(/^https?:\/\//i, '').split(/[\/?#]/)[0].replace(/^www\./i, '').toLowerCase() === host;
    });
    if (!listed) {
      var cur = $('allowed_origins').value.trim();
      $('allowed_origins').value = cur ? cur.replace(/[\s,]+$/, '') + ', ' + host : host;
      say('importmsg', 'We added ' + host + ' to your websites in section 3. Click Save at the bottom, then press Read my website again.', 'err');
      return;
    }
    if (state && state.bot.allowed_origins.map(function (o) { return o.replace(/^https?:\/\//i, '').replace(/^www\./i, '').toLowerCase(); }).indexOf(host) === -1) {
      say('importmsg', 'Click Save at the bottom first, so this website is on your list, then press Read my website again.', 'err');
      return;
    }
    importing = true;
    $('importbtn').disabled = true;
    $('importdraft').hidden = true;
    say('importmsg', 'Reading your website… this can take up to a minute.');
    api('POST', '/api/bot/import-site', { url: url })
      .then(function (d) {
        $('draft_text').value = d.knowledge;
        $('draft_pages').textContent = 'Read ' + d.pages.length + ' page' + (d.pages.length === 1 ? '' : 's') + ': ' + d.pages.map(function (u) { return u.replace(/^https?:\/\/(www\.)?/, ''); }).join(', ');
        $('importdraft').hidden = false;
        say('importmsg', 'Draft ready. Check it below, then use it.', 'ok');
        $('draft_text').focus({ preventScroll: true }); $('draft_text').scrollTop = 0; $('importdraft').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      })
      .catch(function (e) { say('importmsg', e.message, 'err'); })
      .then(function () { importing = false; $('importbtn').disabled = false; });
  });
  $('import_url').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); $('importbtn').click(); } });

  function applyDraft(append) {
    var draft = $('draft_text').value.trim(), cur = $('knowledge').value.trim();
    var next = append && cur ? cur + '\n\n' + draft : draft;
    if (next.length > 8000) { say('importmsg', 'That would be over the 8,000 character limit. Shorten the draft or your current text first.', 'err'); return; }
    $('knowledge').value = next;
    $('importdraft').hidden = true;
    say('importmsg', 'Added. Click Save at the bottom to make it live.', 'ok');
    $('knowledge').focus();
  }
  $('draft_use').addEventListener('click', function () { applyDraft(false); });
  $('draft_add').addEventListener('click', function () { applyDraft(true); });
  $('draft_discard').addEventListener('click', function () { $('importdraft').hidden = true; say('importmsg', ''); });

  $('copy').addEventListener('click', function () {
    var text = $('snippet').textContent;
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
      .then(function () { $('copy').textContent = 'Copied'; setTimeout(function () { $('copy').textContent = 'Copy snippet'; }, 2000); })
      .catch(function () { var r = document.createRange(); r.selectNodeContents($('snippet')); var s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  });

  $('logout').addEventListener('click', function () {
    api('POST', '/api/auth/logout', {}).then(function () { location.replace('/'); });
  });

  $('delete').addEventListener('click', function () {
    var answer = prompt('This permanently deletes your account, chatbot and all enquiries, and cancels your subscription.\n\nType DELETE to confirm.');
    if (answer !== 'DELETE') return;
    api('DELETE', '/api/account', { confirm: 'DELETE' })
      .then(function () { location.replace('/'); })
      .catch(function (e) { alert(e.message); });
  });

  var q = location.search.match(/billing=(\w+)/);
  HearioPricing.load().then(function (d) { priceInfo = d; if (state) renderPlan(state); });
  api('GET', '/api/me').then(function (me) {
    fill(me);
    loadLeads();
    if (q && q[1] === 'success') say('savemsg', 'Thanks! Your subscription is being activated. Refresh in a moment if it still shows as a trial.', 'ok');
  }).catch(function () {});
})();
