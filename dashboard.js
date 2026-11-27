(function () {
  var $ = function (id) { return document.getElementById(id); };
  var state = null;
  var dirty = false; // unsaved changes in the settings form
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

  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

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
    var choice = b.teaser_on ? 'popup' : b.greeting_style === 'business' ? 'business' : 'personal';
    Array.prototype.forEach.call(document.querySelectorAll('input[name=greeting_choice]'), function (r) { r.checked = r.value === choice; });
    $('greet_own').open = !!(b.greeting || b.teaser_title || b.teaser_text);
    $('teaser_title').value = b.teaser_title || '';
    $('teaser_text').value = b.teaser_text || '';
    syncGreeting();
    $('enabled').checked = b.enabled;
    $('snippet').textContent = '<script src="' + location.origin + '/widget.js" data-key="' + b.embed_key + '" defer></script>';
    renderInstall(b);
    renderGetStarted(b);
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
  function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function syncTz() { $('tzwrap').hidden = !($('hours_on').checked || $('closures').children.length); }
  function addClosure(from, to) {
    var row = el('div', undefined, 'closure-row'), a = el('input', undefined, 'cb-input hours-time closure-from'), b = el('input', undefined, 'cb-input hours-time closure-to');
    a.type = b.type = 'date'; a.value = from || today(); b.value = to || a.value;
    a.setAttribute('aria-label', 'Closed from'); b.setAttribute('aria-label', 'Closed until (last closed day)');
    a.onchange = function () { if (!b.value || b.value < a.value) b.value = a.value; };
    var rm = el('button', 'Remove', 'danger-link closure-rm'); rm.type = 'button';
    rm.onclick = function () { row.remove(); syncTz(); dirty = true; };
    row.appendChild(a); row.appendChild(el('span', 'to', 'hours-to')); row.appendChild(b); row.appendChild(rm);
    $('closures').appendChild(row);
    syncTz();
  }
  function renderHours(h) {
    var on = !!(h && h.days), days = (h && h.days) || DEFAULT_HOURS, box = $('hours_days');
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
      var dash = el('span', 'to', 'hours-to');
      function sync() { from.hidden = to.hidden = dash.hidden = !open.checked; closed.hidden = open.checked; }
      open.onchange = sync;
      row.appendChild(lab); row.appendChild(from); row.appendChild(dash); row.appendChild(to); row.appendChild(closed);
      box.appendChild(row);
      sync();
    });
    $('closures').textContent = '';
    ((h && h.closed) || []).forEach(function (c) { if (c[1] >= today()) addClosure(c[0], c[1]); });
    syncTz();
  }
  function readHoursForm() {
    var days = null, closed = [];
    if ($('hours_on').checked) {
      days = {};
      DAYS.forEach(function (d) { days[d[0]] = $('h_' + d[0]).checked ? [$('h_' + d[0] + '_from').value, $('h_' + d[0] + '_to').value] : null; });
    }
    [].forEach.call($('closures').children, function (r) {
      var a = r.querySelector('.closure-from').value, b = r.querySelector('.closure-to').value;
      if (a || b) closed.push([a, b]);
    });
    if (!days && !closed.length) return null;
    return { tz: $('hours_tz').value, days: days, closed: closed };
  }
  $('hours_on').addEventListener('change', function () { $('hours').hidden = !$('hours_on').checked; syncTz(); });
  $('addclosure').addEventListener('click', function () { addClosure(); dirty = true; });

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
      text.textContent = p.subscriptionStatus && p.subscriptionStatus !== 'none'
        ? 'Your subscription has ended, so the chatbot is paused. Subscribe again to switch it back on.'
        : 'Your free trial has ended, so the chatbot is paused. Subscribe to switch it back on.';
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
          var SYM = { eur: '€ EUR', gbp: '£ GBP', usd: '$ USD' };
          var pick = el('div', undefined, 'cur-pick');
          pick.setAttribute('role', 'group');
          pick.setAttribute('aria-label', 'Currency to pay in');
          pick.appendChild(el('span', 'Pay in', 'cur-label'));
          codes.forEach(function (c) {
            var b = el('button', SYM[c] || c.toUpperCase(), 'cur-btn');
            b.type = 'button';
            b.setAttribute('aria-pressed', c === cur ? 'true' : 'false');
            b.onclick = function () { if (c === cur) return; HearioPricing.remember(c); renderPlan(me); };
            pick.appendChild(b);
          });
          buy.appendChild(pick);
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
      actions.appendChild(el('span', p.status === 'trial' ? 'Subscribe any time to keep the chatbot running after your trial.' : 'Subscribe to switch your chatbot back on. Your settings and enquiries are kept.', 'hint'));
    }
    if (p.hasBilling) {
      var manage = el('button', 'Manage billing', 'btn-ghost');
      manage.type = 'button';
      manage.onclick = function () { redirectTo('/api/billing/portal', manage); };
      actions.appendChild(manage);
    }
    banner.appendChild(box);
    var u = me.usage, resets = u.resets ? new Date(u.resets + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' }) : 'the 1st of next month';
    var line = u.messages.toLocaleString() + ' of ' + u.limit.toLocaleString() + ' chat messages used this month. Resets on ' + resets + '.';
    $('usage').className = 'hint';
    if (u.messages > u.limit) {
      line += ' You\'ve reached this month\'s limit: your chat is still taking enquiries with a short form instead of AI replies until then. Need more? Email support@heario.ai and we\'ll raise your limit.';
      $('usage').className = 'hint usage-warn';
    } else if (u.messages >= Math.ceil(u.limit * 0.8)) {
      line += ' You\'re close to this month\'s limit. If you reach it, your chat keeps taking enquiries with a short form. Need more? Email support@heario.ai.';
      $('usage').className = 'hint usage-warn';
    }
    $('usage').textContent = line;
  }

  function redirectTo(path, btn, body) {
    btn.disabled = true;
    api('POST', path, body || {}).then(function (d) { location.href = d.url; })
      .catch(function (e) { btn.disabled = false; alert(e.message); });
  }

  function loadPreview(key) {
    if (window.HearioWidget) window.HearioWidget.destroy();
    // The pop-up normally shows once per visit. In the dashboard, show it again after every save so the owner sees their changes.
    try { sessionStorage.removeItem('heario_teaser_' + key); } catch (e) {}
    var s = document.createElement('script');
    s.src = '/widget.js?v=10';
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


  // Warn before leaving the page (Subscribe, Manage billing, Log out, closing the tab) with unsaved changes.
  $('form').addEventListener('input', function (ev) { if (ev.target.id !== 'import_url' && ev.target.id !== 'draft_text') dirty = true; });
  $('form').addEventListener('change', function (ev) { if (ev.target.id !== 'import_url' && ev.target.id !== 'draft_text') dirty = true; });
  window.addEventListener('beforeunload', function (ev) { if (dirty) { ev.preventDefault(); ev.returnValue = ''; } });

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
      greeting_style: chosen() === 'personal' ? 'personal' : 'business',
      teaser_on: chosen() === 'popup',
      teaser_title: $('teaser_title').value,
      teaser_text: $('teaser_text').value,
      enabled: $('enabled').checked
    }).then(function (d) {
      state.bot = d.bot;
      fill(state);
      dirty = false;
      say('savemsg', 'Saved.', 'ok');
    }).catch(function (e) { say('savemsg', e.message, 'err'); })
      .then(function () { $('save').disabled = false; });
  });

  $('testwa').addEventListener('click', function () {
    // The test goes to the saved number, so make sure what's on screen is what's saved.
    var digits = function (v) { return String(v || '').replace(/\D/g, '').replace(/^00/, ''); };
    if (digits($('owner_whatsapp').value) !== digits(state && state.bot.owner_whatsapp) || $('whatsapp_consent').checked !== !!(state && state.bot.whatsapp_consent)) {
      say('testmsg', 'Click Save changes at the bottom first, then send the test.', 'err');
      return;
    }
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
      dirty = true;
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
    dirty = true;
    $('importdraft').hidden = true;
    say('importmsg', 'Added. Click Save at the bottom to make it live.', 'ok');
    $('knowledge').focus();
  }
  $('draft_use').addEventListener('click', function () { applyDraft(false); });
  $('draft_add').addEventListener('click', function () { applyDraft(true); });
  $('draft_discard').addEventListener('click', function () { $('importdraft').hidden = true; say('importmsg', ''); });

  // ---- Greeting: one choice of three (wording matches lib/bot.js) ----
  function firstName() { return ($('owner_name').value.trim().split(/\s+/)[0]) || ''; }
  function chosen() { return (document.querySelector('input[name=greeting_choice]:checked') || {}).value || 'personal'; }
  // Examples use the real names; "[your name]" / "[your business]" until they're filled in, so the options never look alike.
  function greetingExample(style, forPreview) {
    var biz = $('business_name').value.trim() || (forPreview ? '[your business]' : ''), first = firstName() || (forPreview ? '[your name]' : '');
    if (style === 'business') first = '';
    if (first && biz) return "Hi! I'm " + first + "'s AI assistant at " + biz + ". Ask me anything, or leave your details and " + first + " will get back to you.";
    if (first) return "Hi! I'm " + first + "'s AI assistant. Ask me anything, or leave your details and " + first + " will get back to you.";
    return "Hi! I'm the AI assistant for " + (biz || 'this business') + ". Ask me anything, or leave your details and we'll get back to you.";
  }
  function teaserExample(forPreview) {
    var biz = $('business_name').value.trim() || (forPreview ? '[your business]' : '');
    return [biz ? 'Hi 👋 Got a question for ' + biz + '?' : 'Hi 👋 Got a question?',
      "Ask me anything. If I can't help, I'll automatically pass on your message and we'll be in touch."];
  }
  function syncGreeting() {
    var c = chosen(), t = teaserExample(true), pop = c === 'popup';
    $('greet_personal').textContent = '"' + greetingExample('personal', true) + '"';
    $('greet_business').textContent = '"' + greetingExample('business', true) + '"';
    $('gp_title').textContent = $('teaser_title').value.trim() || t[0];
    $('gp_line').textContent = $('teaser_text').value.trim() || t[1];
    $('greeting').placeholder = greetingExample(c === 'personal' ? 'personal' : 'business');
    $('teaser_title').placeholder = teaserExample()[0];
    $('teaser_text').placeholder = teaserExample()[1];
    $('teaser_own').hidden = $('teaser_own2').hidden = !pop;
    $('greet_hint').hidden = !(c === 'personal' && !firstName());
  }
  ['business_name', 'owner_name', 'teaser_title', 'teaser_text'].forEach(function (id) { $(id).addEventListener('input', syncGreeting); });
  Array.prototype.forEach.call(document.querySelectorAll('input[name=greeting_choice]'), function (r) { r.addEventListener('change', syncGreeting); });

  // ---- Get started checklist (new accounts) ----
  function renderGetStarted(b) {
    var box = $('getstarted'), hideKey = 'heario_getstarted_hidden_' + b.embed_key;
    var steps = [
      [!!(b.business_name && (b.knowledge || '').trim().length >= 20), 'Tell it about your business', 'Add your business name and a few lines about what you do, or let us read your website.', 'sec-business'],
      [!!(b.owner_whatsapp && b.whatsapp_consent), 'Add your WhatsApp number', 'So every enquiry comes straight to your phone.', 'sec-whatsapp'],
      [b.allowed_origins.length > 0, 'Add your website address', 'The chat only runs on the websites you list.', 'sec-website'],
      [!!b.live, 'Put the chat on your website', 'Paste one line of code. We have step-by-step help for every website builder.', 'install'],
    ];
    var done = steps.filter(function (x) { return x[0]; }).length, hidden = false;
    try { hidden = localStorage.getItem(hideKey) === '1'; } catch (e) {}
    box.hidden = done === steps.length || hidden;
    if (box.hidden) return;
    box.className = 'panel getstarted';
    box.innerHTML = '<div class="gs-head"><h2>Get started</h2><span class="gs-count">' + done + ' of ' + steps.length + ' done</span></div>' +
      '<div class="gs-bar"><span style="width:' + Math.round(done / steps.length * 100) + '%"></span></div>' +
      '<ol class="gs-list">' + steps.map(function (x) {
        return '<li class="' + (x[0] ? 'done' : '') + '"><span class="gs-tick" aria-hidden="true">' + (x[0] ? '&#10003;' : '') + '</span>' +
          '<span class="gs-text"><b>' + esc(x[1]) + '</b><small>' + esc(x[2]) + '</small></span>' +
          (x[0] ? '<span class="gs-done">Done</span>' : '<a class="btn-ghost gs-go" href="#' + x[3] + '">Do this</a>') + '</li>';
      }).join('') + '</ol>' +
      '<p class="gs-foot">Short on time? Email <a href="mailto:support@heario.ai">support@heario.ai</a> and we\'ll help you get it set up, free. <button type="button" class="gs-hide">Hide this</button></p>';
    box.querySelector('.gs-hide').onclick = function () { try { localStorage.setItem(hideKey, '1'); } catch (e) {} box.hidden = true; };
  }

  // ---- Install guide ----
  function copyCode(btn) {
    var text = $('snippet').textContent, label = btn.textContent;
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
      .then(function () { btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = label; }, 2000); })
      .catch(function () { var r = document.createRange(); r.selectNodeContents($('snippet')); var s = getSelection(); s.removeAllRanges(); s.addRange(r); btn.textContent = 'Press Ctrl+C to copy'; setTimeout(function () { btn.textContent = label; }, 3000); });
  }
  $('copy').addEventListener('click', function () { copyCode($('copy')); });

  // Each step is plain text; {copy} becomes a "Copy code" button, **x** is bold.
  var PLATFORMS = [
    { id: 'wordpress', name: 'WordPress', steps: [
      'In your WordPress admin, go to **Plugins → Add New Plugin**, search for **WPCode** and install and activate **WPCode – Insert Headers and Footers**.',
      'Go to **Code Snippets → Header & Footer**.',
      '{copy} Paste the code into the **Footer** box.',
      'Click **Save Changes**.'
    ], note: 'On WordPress.com, installing plugins needs the Business plan or higher. If you can\'t add plugins, ask your web developer to paste the code just before the closing </body> tag of your theme. If you use a speed plugin with a "delay JavaScript" setting (such as WP Rocket, LiteSpeed Cache or Perfmatters), add widget.js to its exclusions, or the chat only appears once a visitor scrolls or taps. If a cookie banner plugin blocks scripts until visitors accept, allow heario.ai in its settings too.' },
    { id: 'wix', name: 'Wix', steps: [
      'Open your site\'s dashboard and click **Settings**.',
      'Click **Custom Code** (under Development & integrations or Advanced).',
      'Click **+ Add Custom Code**.',
      '{copy} Paste the code, name it **Heario chat**, choose **All pages** and **Load code once**.',
      'Under **Place Code in**, choose **Body – end**, then click **Apply**.'
    ], note: 'Wix only allows custom code on a paid (Premium) plan with your own domain connected.' },
    { id: 'squarespace', name: 'Squarespace', steps: [
      'Go to **Settings → Advanced → Code Injection** (on newer sites: **Settings → Developer Tools → Code Injection**).',
      '{copy} Paste the code into the **Footer** box.',
      'Click **Save**.'
    ], note: 'Code Injection is on the Core, Plus and Advanced plans (and the older Business and Commerce plans), not Basic or Personal.' },
    { id: 'shopify', name: 'Shopify', steps: [
      'In Shopify admin, go to **Online Store → Themes**.',
      'Next to your live theme, click the **⋯** button, then **Edit code**.',
      'Open **layout → theme.liquid**.',
      'Find the closing **</body>** tag near the bottom (press Ctrl+F or Cmd+F and search for </body>).',
      '{copy} Paste the code on the line just above **</body>**.',
      'Click **Save**.'
    ], note: 'Under 3. Your website, add both your own domain and your .myshopify.com address, so the chat works on both. If you change theme later, paste the code into the new theme too.' },
    { id: 'webflow', name: 'Webflow', steps: [
      'Open **Site settings → Custom code**.',
      '{copy} Paste the code into **Footer code**.',
      'Click **Save**, then **Publish** your site.'
    ], note: 'Custom code needs a paid Webflow site plan. If visitors also use your yoursite.webflow.io address, add it in section 3 too.' },
    { id: 'framer', name: 'Framer', steps: [
      'Click the **gear icon** to open **Site Settings**, then the **General** tab.',
      'Scroll down to **Custom Code**.',
      '{copy} Paste the code into **End of <body> tag**.',
      'Click **Save**, then **Publish**.'
    ], note: 'Custom code needs a paid Framer site plan.' },
    { id: 'square', name: 'Square Online', steps: [
      'In your Square Dashboard, open **Online** (or **Channels → Square Online**).',
      'Go to **Settings → Tracking Tools** and click **Add new code**.',
      '{copy} Name it **Heario chat** and paste the code.',
      'Choose **End of body**, then **Save**.',
      'Publish your site from the site editor.'
    ], note: 'Custom code is on the Square Online Plus and Premium plans.' },
    { id: 'jimdo', name: 'Jimdo', steps: [
      'In the Jimdo Creator editor, go to **Settings → Edit Head**.',
      '{copy} Paste the code into the box.',
      'Click **Save**.'
    ], note: 'This needs a paid Jimdo Creator plan. Jimdo\'s simpler "Dolphin" editor doesn\'t allow site-wide code, so the chat can\'t be added there.' },
    { id: 'gtm', name: 'Google Tag Manager', steps: [
      'In Tag Manager, go to **Tags → New**.',
      'Click **Tag Configuration** and choose **Custom HTML**.',
      '{copy} Paste the code.',
      'Click **Triggering** and choose **All Pages**, then **Save**.',
      'Click **Submit**, then **Publish**.'
    ], note: 'Use this if your website already loads Google Tag Manager. It works with any builder that supports it.' },
    { id: 'godaddy', name: 'GoDaddy', steps: [
      'GoDaddy\'s Websites + Marketing builder doesn\'t currently let you add code to every page, so the floating chat bubble can\'t be added there.',
      'If your GoDaddy site runs on **WordPress**, use the WordPress steps instead.'
    ], note: 'Email support@heario.ai if you\'re on GoDaddy and we\'ll look at the options with you.' },
    { id: 'html', name: 'My own code / other', steps: [
      '{copy} Paste the code just before the closing **</body>** tag on every page.',
      'If your site has a shared footer or layout file, paste it there once and it covers every page.',
      'Upload or publish the changed files.'
    ], note: 'Most builders have a setting called "custom code", "code injection", "footer scripts" or "tracking code". Choose the one for the end of the body or the footer, for all pages. Avoid "HTML block" or "embed" sections: they place the code inside a box on one page and the chat bubble won\'t work properly.' },
    { id: 'dev', name: 'I have a web developer', steps: [
      'Click **Email it to my web developer** above. It opens an email with your code and instructions, ready to send. If no email opens, click **Copy instructions** and paste them into an email or message.',
      'They just need to add your one line of code before the closing </body> tag on every page.'
    ] }
  ];

  function stepHtml(t) {
    var h = esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    return h.replace('{copy}', '<button type="button" class="btn-ghost inst-copy">Copy code</button> ');
  }
  function showPlatform(id) {
    var p = PLATFORMS.filter(function (x) { return x.id === id; })[0];
    Array.prototype.forEach.call($('inst_platforms').children, function (b) { b.setAttribute('aria-pressed', b.dataset.id === id ? 'true' : 'false'); });
    var g = $('inst_guide');
    g.innerHTML = '<h3>' + esc(p.name) + '</h3><ol>' + p.steps.map(function (t) { return '<li>' + stepHtml(t) + '</li>'; }).join('') + '</ol>' +
      (p.note ? '<p class="inst-note">' + esc(p.note) + '</p>' : '');
    Array.prototype.forEach.call(g.querySelectorAll('.inst-copy'), function (b) { b.addEventListener('click', function () { copyCode(b); }); });
    g.hidden = false;
    try { localStorage.setItem('heario_platform', id); } catch (e) {}
  }
  PLATFORMS.forEach(function (p) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'inst-pf'; b.dataset.id = p.id; b.textContent = p.name; b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', function () { showPlatform(p.id); });
    $('inst_platforms').appendChild(b);
  });
  try { var lastPf = localStorage.getItem('heario_platform'); if (lastPf && PLATFORMS.some(function (p) { return p.id === lastPf; })) showPlatform(lastPf); } catch (e) {}

  var devText = '';
  $('inst_copydev').addEventListener('click', function () {
    var btn = $('inst_copydev');
    (navigator.clipboard ? navigator.clipboard.writeText(devText) : Promise.reject())
      .then(function () { btn.textContent = 'Copied. Paste it into an email or message'; setTimeout(function () { btn.textContent = 'Copy instructions'; }, 3000); })
      .catch(function () { window.prompt('Copy these instructions:', devText); });
  });
  function renderInstall(b) {
    var sites = b.allowed_origins.map(function (o) { return o.replace(/^https?:\/\//i, ''); });
    $('inst_origins').innerHTML = sites.length
      ? 'The chat will work on: <b>' + esc(sites.join(', ')) + '</b>. If your site also uses a free address from your builder (like yoursite.webflow.io), add that too.'
      : '<span class="inst-warn">No website added yet. Add your address in section 3 (for example yourbusiness.ie) and click Save, or the chat won\'t appear on your site.</span>';
    var body = 'Hi,\n\nPlease add our website chat (Heario) to every page of ' + (sites[0] || 'our website') + '.\n\n' +
      'Paste this one line just before the closing </body> tag, on all pages (or in the shared footer/layout):\n\n' + $('snippet').textContent + '\n\n' +
      'Notes:\n- It loads after the page, so it won\'t slow the site down.\n- It only runs on the website addresses we have listed in Heario' + (sites.length ? ' (' + sites.join(', ') + ')' : '') + '. If you test on a staging or preview address, tell me and I\'ll add it.\n- Please don\'t put it inside an HTML/embed block: the chat bubble needs to be on the page itself.\n\nThanks!';
    $('inst_email').href = 'mailto:?subject=' + encodeURIComponent('Please add our website chat (one line of code)') + '&body=' + encodeURIComponent(body);
    devText = body;
  }

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
    if (q) {
      var note = el('p', q[1] === 'success' ? 'Thanks for subscribing! Your subscription is being activated. Refresh in a moment if it still shows as a trial.' : 'Checkout cancelled. Nothing was charged. You can subscribe any time below.', 'cb-msg ' + (q[1] === 'success' ? 'ok' : ''));
      note.style.margin = '0 0 14px';
      $('banner').insertBefore(note, $('banner').firstChild);
      history.replaceState(null, '', location.pathname); // so a refresh doesn't show it again
    }
  }).catch(function () {});
})();
