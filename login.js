(function () {
  var form = document.getElementById('form');
  var email = document.getElementById('email');
  var go = document.getElementById('go');
  var msg = document.getElementById('msg');
  var title = document.getElementById('title');
  var sub = document.getElementById('sub');

  function say(text, cls) { msg.textContent = text; msg.className = 'cb-msg ' + (cls || ''); }

  // Arriving from the email link: the one-time token is in the URL fragment.
  var m = location.hash.match(/token=([a-f0-9]{64})/);
  if (m) {
    form.style.display = 'none';
    title.textContent = 'Logging you in…';
    sub.textContent = '';
    history.replaceState(null, '', location.pathname); // keep the token out of the address bar and history
    fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: m[1] })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (x) {
        if (!x.ok) throw new Error(x.d.error || 'Login failed.');
        location.replace('/dashboard.html');
      })
      .catch(function (e) {
        title.textContent = 'That link didn’t work';
        sub.textContent = e.message + ' Request a new one below.';
        form.style.display = '';
      });
    return;
  }

  // Already logged in? Skip straight to the dashboard.
  fetch('/api/me').then(function (r) { if (r.ok) location.replace('/dashboard.html'); }).catch(function () {});

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    say('');
    var value = email.value.trim();
    if (!value) { say('Enter your email address.', 'err'); return; }
    go.disabled = true;
    go.textContent = 'Sending…';
    fetch('/api/auth/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: value })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (x) {
        if (!x.ok) throw new Error(x.d.error || 'Something went wrong.');
        say('Check your inbox. We’ve sent a login link to ' + value + '. It expires in 15 minutes.', 'ok');
        go.textContent = 'Link sent';
        setTimeout(function () { go.disabled = false; go.textContent = 'Email me a login link'; }, 30000);
      })
      .catch(function (e) {
        say(e.message, 'err');
        go.disabled = false;
        go.textContent = 'Email me a login link';
      });
  });
})();
