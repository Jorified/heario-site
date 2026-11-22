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
    $('booking_url').value = b.booking_url || '';
    renderHours(b.opening_hours);
    $('owner_whatsapp').value = b.owner_whatsapp;
    $('whatsapp_consent').checked = b.whatsapp_consent;
    $('email_copy').checked = !!b.email_copy;
    $('confirm_visitor').checked = b.confirm_visitor !== false;
    $('allowed_origins').value = b.allowed_origins.join(', ');
    if (!$('import_url').value && b.allowed_origins.length) $('import_url').value = b.allowed_origins[0].replace(/^https?:\/\//, '');
    $('color').value = b.color;
    $('greeting').value = b.greeting;
    $('enabled').checked = b.enabled;
    $('snippet').textContent = '<script src="' + location.origin + '/widget.js" data-key="' + b.embed_key + '" defer></script>';
    renderPlan(me);
    loadPreview(b.embed_key);
  }

  var DAYS = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];
  var DEFAULT_HOURS = { mon: ['09:00', '17:30'], tue: ['09:00', '17:30'], wed: ['09:00', '17:30'], thu: ['09:00', '17:30'], fri: ['09:00', '17:30'], sat: null, sun: null };
  function browserTz() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Dublin'; } catch (e) { return 'Europe/Dublin'; } }
  function fillZones(selected) {
    var sel = $('hours_tz'), zones = [];
    try { zones = Intl.supportedValuesOf('timeZone'); } catch (e) {}
    ['Europe/Dublin', 'Europe/London', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', selected].forEach(function (z) { if (z && zones.indexOf(z) === -1) zones.push(z); });
    sel.textContent = '';
    zones.sort().forEach(function (z) { var o = el('option', z.replace(/_/g, ' ')); o.value = z; o.selected = z === selected; sel.appendChild(o); });
  }
  function renderHours(h) {
    var on = !!h, days = (h && h.days) || DEFAULT_HOURS, box = $('hours_days');
    $('hours_on').checked = on;
    $('hours').hidden = !on;
    fillZones((h && h.tz) || browserTz());
    box.textContent = '';
    DAYS.forEach(function (d) {
      var v = days[d[0]], row = el('div', undefined, 'hours-row'), open = el('input'), lab = el('label', undefined, 'hours-day');
      open.type = 'checkbox'; open.checked = !!v; open.id = 'h_' + d[0];
      lab.appendChild(open); lab.appendChild(el('span', d[1]));
      var from = el('input', undefined, 'cb-input hours-time'), to = el('input', undefined, 'cb-input hours-time');
      from.type = to.type = 'time'; from.id = 'h_' + d[0] + '_from'; to.id = 'h_' + d[0] + '_to';
      from.value = v ? v[0] : '09:00'; to.value = v ? v[1] : '17:30';
      from.setAttribute('aria-label', d[1] + ' opening time'); to.setAttribute('aria-label', d[1] + ' closing time');
      var closed = el('span', 'Closed', 'hours-closed');
      function sync() { from.hidden = to.hidden = dash.hidden = !open.checked; closed.hidden = open.checked; }
      var dash = el('span', 'to', 'hours-to');
      open.onchange = sync;
      row.appendChild(lab); row.appendChild(from); row.appendChild(dash); row.appendChild(to); row.appendChild(closed);
      box.appendChild(row);
      sync();
    });
  }
  function readHoursForm() {
    if (!$('hours_on').checked) return null;
    var days = {};
    DAYS.forEach(function (d) { days[d[0]] = $('h_' + d[0]).checked ? [$('h_' + d[0] + '_from').value, $('h_' + d[0] + '_to').value] : null; });
    return { tz: $('hours_tz').value, days: days };
  }
  $('hours_on').addEventListener('change', function () { $('hours').hidden = !$('hours_on').checked; });

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

  var leadsData = [], leadFilter = 'all';
  var STAGES = [['new', 'New'], ['contacted', 'Contacted'], ['won', 'Won'], ['lost', 'Lost']];
  var ALERTS = { sent: ['WhatsApp sent', 'sent'], delivered: ['WhatsApp delivered', 'sent'], read: ['WhatsApp read', 'sent'], emailed: ['Emailed', ''], failed_emailed: ['WhatsApp failed, emailed', 'failed'], failed: ['Delivery failed', 'failed'], skipped: ['Not sent', ''] };

  function saveLead(l, change, flash) {
    return api('PATCH', '/api/leads', Object.assign({ id: l.id }, change))
      .then(function (d) { l.stage = d.lead.stage; l.note = d.lead.note; if (flash) { flash.classList.add('saved'); setTimeout(function () { flash.classList.remove('saved'); }, 1200); } })
      .catch(function (e) { alert(e.message); });
  }

  function renderFilters() {
    var box = $('leadfilters');
    box.textContent = '';
    [['all', 'All']].concat(STAGES).forEach(function (s) {
      var n = s[0] === 'all' ? leadsData.length : leadsData.filter(function (l) { return l.stage === s[0]; }).length;
      var b = el('button', s[1] + ' ' + n, 'lead-filter' + (leadFilter === s[0] ? ' on' : ''));
      b.type = 'button';
      b.setAttribute('aria-pressed', leadFilter === s[0] ? 'true' : 'false');
      b.onclick = function () { leadFilter = s[0]; renderLeads(); };
      box.appendChild(b);
    });
  }

  function renderLeads() {
    var box = $('leads');
    box.textContent = '';
    renderFilters();
    $('leadexport').style.display = leadsData.length ? '' : 'none';
    if (!leadsData.length) { box.appendChild(el('p', 'No enquiries yet. They will appear here as they come in.', 'hint')); return; }
    var shown = leadsData.filter(function (l) { return leadFilter === 'all' || l.stage === leadFilter; });
    if (!shown.length) { box.appendChild(el('p', 'No enquiries with this status.', 'hint')); return; }
    var t = el('table', undefined, 'leads'), head = el('thead'), hr = el('tr');
    ['When', 'From', 'Enquiry', 'Status'].forEach(function (h) { hr.appendChild(el('th', h)); });
    head.appendChild(hr); t.appendChild(head);
    var body = el('tbody');
    shown.forEach(function (l) {
      var tr = el('tr', undefined, l.stage === 'won' || l.stage === 'lost' ? 'done' : ''), lab = ALERTS[l.whatsapp_status] || [l.whatsapp_status, ''];
      var when = new Date(l.created_at);
      tr.appendChild(el('td', when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ', ' + when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }), 'lead-when'));
      var who = el('td');
      who.appendChild(el('div', l.name, 'lead-name'));
      who.appendChild(el('div', l.contact, 'lead-contact'));
      tr.appendChild(who);
      var enq = el('td', undefined, 'lead-enq');
      if (l.urgent) enq.appendChild(el('span', 'Urgent', 'tag urgent'));
      enq.appendChild(el('div', l.enquiry, 'lead-text'));
      var note = el('input', undefined, 'lead-note');
      note.type = 'text'; note.maxLength = 500; note.value = l.note || ''; note.placeholder = 'Add a note…';
      note.setAttribute('aria-label', 'Note for ' + l.name);
      var noteTimer, noteSaved = note.value;
      function saveNote() { clearTimeout(noteTimer); if (note.value === noteSaved) return; noteSaved = note.value; saveLead(l, { note: note.value }, note); }
      note.oninput = function () { clearTimeout(noteTimer); noteTimer = setTimeout(saveNote, 1200); };
      note.onchange = saveNote;
      note.onblur = saveNote;
      enq.appendChild(note);
      tr.appendChild(enq);
      var st = el('td', undefined, 'lead-status'), sel = el('select', undefined, 'lead-stage stage-' + l.stage);
      sel.setAttribute('aria-label', 'Status for ' + l.name);
      STAGES.forEach(function (s) { var o = el('option', s[1]); o.value = s[0]; o.selected = l.stage === s[0]; sel.appendChild(o); });
      sel.onchange = function () {
        sel.className = 'lead-stage stage-' + sel.value;
        saveLead(l, { stage: sel.value }, sel).then(function () { renderFilters(); tr.className = l.stage === 'won' || l.stage === 'lost' ? 'done' : ''; });
      };
      st.appendChild(sel);
      st.appendChild(el('span', lab[0], 'tag lead-alert ' + lab[1]));
      tr.appendChild(st);
      body.appendChild(tr);
    });
    t.appendChild(body);
    var wrap = el('div', undefined, 'leads-wrap');
    wrap.appendChild(t);
    box.appendChild(wrap);
  }

  function exportLeads(e) {
    e.preventDefault();
    var tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (x) {}
    fetch('/api/leads?format=csv&tz=' + encodeURIComponent(tz), { credentials: 'same-origin' }).then(function (r) {
      if (r.status === 401) { location.replace('/login.html'); return null; }
      if (!r.ok) throw new Error('export');
      return r.blob().then(function (b) {
        var a = document.createElement('a'), m = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') || '');
        a.href = URL.createObjectURL(b); a.download = m ? m[1] : 'heario-enquiries.csv';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      });
    }).catch(function () { alert("We couldn't download your spreadsheet just now. Please try again."); });
  }
  $('leadexport').onclick = exportLeads;

  var questionsData = [];
  function renderQuestions() {
    var box = $('questions');
    box.textContent = '';
    $('qcount').textContent = questionsData.length ? String(questionsData.length) : '';
    if (!questionsData.length) { box.appendChild(el('p', 'Nothing here yet. Questions the assistant couldn\u2019t answer will appear here.', 'hint')); return; }
    var list = el('ul', undefined, 'q-list');
    questionsData.forEach(function (q) {
      var li = el('li', undefined, 'q-item');
      li.appendChild(el('div', q.question, 'q-text'));
      var last = new Date(q.last_asked_at);
      li.appendChild(el('div', (q.times > 1 ? 'Asked ' + q.times + ' times, last on ' : 'Asked on ') + last.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), 'q-meta'));
      var row = el('div', undefined, 'q-actions');
      var add = el('button', 'Add an answer', 'btn-primary q-add'), skip = el('button', 'Not relevant', 'btn-ghost');
      add.type = skip.type = 'button';
      row.appendChild(add); row.appendChild(skip);
      li.appendChild(row);
      var form = el('div', undefined, 'q-form');
      form.hidden = true;
      var qi = el('input', undefined, 'cb-input q-edit');
      qi.type = 'text'; qi.maxLength = 200; qi.value = q.question;
      var ql = el('label', 'Question (tidy the wording if you like)', 'q-label'), al = el('label', 'Your answer', 'q-label');
      qi.id = 'qq' + q.id; ql.htmlFor = qi.id;
      var ta = el('textarea', undefined, 'cb-textarea q-answer');
      ta.maxLength = 1000; ta.rows = 3; ta.placeholder = 'Write the answer as you\u2019d tell a customer.';
      ta.id = 'qa' + q.id; al.htmlFor = ta.id;
      var save = el('button', 'Save answer', 'btn-primary'), cancel = el('button', 'Cancel', 'btn-ghost');
      save.type = cancel.type = 'button';
      var fr = el('div', undefined, 'q-actions');
      fr.appendChild(save); fr.appendChild(cancel);
      form.appendChild(ql); form.appendChild(qi); form.appendChild(al); form.appendChild(ta); form.appendChild(fr);
      li.appendChild(form);
      add.onclick = function () { row.hidden = true; form.hidden = false; ta.focus(); };
      cancel.onclick = function () { form.hidden = true; row.hidden = false; };
      save.onclick = function () {
        if (qi.value.trim().length < 4) { qi.focus(); return; }
        if (!ta.value.trim()) { ta.focus(); return; }
        save.disabled = true;
        api('POST', '/api/bot/answer-question', { id: q.id, question: qi.value, answer: ta.value }).then(function (d) {
          // Keep the form in step, without losing anything typed in Business information but not saved yet.
          var k = $('knowledge');
          if (k.value === state.bot.knowledge) k.value = d.knowledge;
          else k.value = k.value.replace(/\s+$/, '') + (k.value.trim() ? '\n\n' : '') + d.added;
          state.bot.knowledge = d.knowledge;
          questionsData = questionsData.filter(function (x) { return x.id !== q.id; });
          renderQuestions();
          say('qmsg', 'Added to your business information. The assistant will use it from now on.', 'ok');
        }).catch(function (e) { save.disabled = false; say('qmsg', e.message, 'err'); });
      };
      skip.onclick = function () {
        skip.disabled = true;
        api('POST', '/api/bot/dismiss-question', { id: q.id }).then(function () {
          questionsData = questionsData.filter(function (x) { return x.id !== q.id; });
          renderQuestions();
          say('qmsg', '');
        }).catch(function (e) { skip.disabled = false; say('qmsg', e.message, 'err'); });
      };
      list.appendChild(li);
    });
    box.appendChild(list);
  }

  function loadQuestions() {
    api('GET', '/api/bot/questions').then(function (d) { questionsData = d.questions; renderQuestions(); }).catch(function () {
      var box = $('questions');
      box.textContent = '';
      box.appendChild(el('p', "We couldn't load these just now. Refresh the page to try again.", 'hint'));
    });
  }

  function loadLeads() {
    api('GET', '/api/leads').then(function (d) {
      leadsData = d.leads.map(function (l) { l.stage = l.stage || 'new'; return l; });
      renderLeads();
    }).catch(function () {
      var box = $('leads');
      box.textContent = '';
      box.appendChild(el('p', "We couldn't load your enquiries just now. Refresh the page to try again.", 'hint'));
    });
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
      booking_url: $('booking_url').value,
      opening_hours: readHoursForm(),
      owner_whatsapp: $('owner_whatsapp').value,
      whatsapp_consent: $('whatsapp_consent').checked,
      email_copy: $('email_copy').checked,
      confirm_visitor: $('confirm_visitor').checked,
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
      .then(function () { say('testmsg', 'Sent. It should arrive within a minute. If it doesn\u2019t, check the number and the country code.', 'ok'); })
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
    loadQuestions();
    if (q && q[1] === 'success') say('savemsg', 'Thanks! Your subscription is being activated. Refresh in a moment if it still shows as a trial.', 'ok');
  }).catch(function () {});
})();
