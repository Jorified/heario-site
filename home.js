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

// Homepage polish: glassier nav once scrolled, and sections that rise into view.
(function () {
  var nav = document.querySelector('.nav');
  function onScroll() { if (nav) nav.classList.toggle('scrolled', window.scrollY > 8); }
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  if (!('IntersectionObserver' in window)) return;

  // Play the chat demo when it comes into view, not while it's off-screen.
  var demo = document.querySelector('.demo-pair');
  if (demo) {
    document.documentElement.classList.add('js-anim');
    var dio = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { demo.classList.add('play'); dio.disconnect(); }
      });
    }, { threshold: 0.3 });
    dio.observe(demo);
  }

  var groups = ['.eyebrow', '.cb-h2', '.section-sub', '.cb-step', '.bento-card', '.price-card', '.faq-list details', '.cta-panel'];
  var els = [];
  groups.forEach(function (sel) {
    var list = document.querySelectorAll('.cb-section ' + sel + ', .final-cta ' + sel);
    Array.prototype.forEach.call(list, function (el, i) {
      el.classList.add('reveal');
      if (list.length > 1) el.setAttribute('data-d', String((i % 4) + 1));
      els.push(el);
    });
  });
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, { rootMargin: '0px 0px -8% 0px' });
  els.forEach(function (el) { io.observe(el); });
})();
