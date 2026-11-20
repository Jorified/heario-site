// Homepage: fills in the price card from Stripe's prices and lets visitors switch currency.
(function () {
  var amt = document.getElementById('priceAmt');
  var sw = document.getElementById('curSwitch');
  if (!amt || !sw || !window.HearioPricing) return;

  window.HearioPricing.load().then(function (info) {
    if (!info.prices) return; // keep the "Simple monthly pricing" fallback text
    var cur = window.HearioPricing.pick(info);

    var note = document.getElementById('setupNote');

    function draw() {
      if (note) {
        var s = info.setup && info.setup[cur];
        note.hidden = !s;
        note.textContent = s ? 'Optional one-off setup assistance: ' + s.display + ' (add it at checkout)' : '';
      }
      amt.textContent = '';
      amt.className = 'amt has-price';
      amt.appendChild(document.createTextNode(info.prices[cur].display));
      var small = document.createElement('small');
      small.textContent = ' / month';
      amt.appendChild(small);

      var codes = Object.keys(info.prices);
      sw.textContent = '';
      sw.hidden = codes.length < 2;
      codes.forEach(function (code) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = window.HearioPricing.labels[code] || code.toUpperCase();
        b.setAttribute('aria-pressed', code === cur ? 'true' : 'false');
        b.onclick = function () { cur = code; window.HearioPricing.remember(code); draw(); };
        sw.appendChild(b);
      });
    }
    draw();
  });
})();
