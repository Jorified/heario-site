// ── Live download count from GitHub ─────────────────────────────────────
(async () => {
  try {
    const res = await fetch('https://api.github.com/repos/Jorified/heario-app/releases/tags/v0.1.0');
    const data = await res.json();
    const total = (data.assets || []).reduce((sum, a) => sum + a.download_count, 0);
    const count = Math.max(total, 1);
    const dlCount = document.getElementById('dlCount');
    if (dlCount) dlCount.textContent = count.toLocaleString() + '+';
  } catch (_) {}
})();

// ── Modes: neural reactor (auto-cycle + hover/click to retune the core) ───
(() => {
  const reactor = document.querySelector('.reactor');
  if (!reactor) return;
  const stage  = reactor.querySelector('.reactor-stage');
  const nodes  = [...reactor.querySelectorAll('.mode-node')];
  const icEl   = reactor.querySelector('.rc-ic');
  const nameEl = reactor.querySelector('.rc-name');
  const descEl = reactor.querySelector('.rc-desc');
  if (!nodes.length) return;

  let idx = 0, timer = null, hovering = false;

  const select = (i) => {
    idx = (i + nodes.length) % nodes.length;
    const n = nodes[idx];
    nodes.forEach((x, k) => x.classList.toggle('active', k === idx));
    const c = (n.style.getPropertyValue('--c') || '#4f8ef7').trim();
    reactor.style.setProperty('--active', c);
    // aim the scan beam at the node's orbital angle
    if (stage) stage.style.setProperty('--beam', n.style.getPropertyValue('--a') || '0deg');
    if (icEl)   icEl.textContent   = n.dataset.ic;
    if (nameEl) nameEl.textContent = n.dataset.name;
    if (descEl) descEl.textContent = n.dataset.desc;
  };

  const start = () => { if (!timer) timer = setInterval(() => { if (!hovering) select(idx + 1); }, 2600); };
  const stop  = () => { clearInterval(timer); timer = null; };

  nodes.forEach((n, i) => {
    n.addEventListener('click',      () => select(i));
    n.addEventListener('mouseenter', () => { hovering = true; select(i); });
    n.addEventListener('mouseleave', () => { hovering = false; });
  });

  const io = new IntersectionObserver((es) => {
    es.forEach(e => e.isIntersecting ? start() : stop());
  }, { threshold: 0.2 });
  io.observe(reactor);

  select(0);
})();

// ── Pricing toggle (cosmetic) ────────────────────────────────────────────
document.querySelectorAll('.toggle-label').forEach(label => {
  label.addEventListener('click', () => {
    document.querySelectorAll('.toggle-label').forEach(l => l.classList.remove('active'));
    label.classList.add('active');
  });
});

// ── Nav: add shadow once scrolled ────────────────────────────────────────
const nav = document.querySelector('.nav');
const stickyCta = document.getElementById('stickyCta');
const heroSection = document.querySelector('.hero');
const footerEl = document.querySelector('.footer');
const onScroll = () => {
  if (nav) nav.classList.toggle('scrolled', window.scrollY > 8);
  if (stickyCta && heroSection) {
    const pastHero = window.scrollY > heroSection.offsetHeight;
    // retract the sticky bar once the footer is in view — it's redundant there
    // and would otherwise cover the footer's bottom row
    const atFooter = footerEl && (window.scrollY + window.innerHeight) > (footerEl.offsetTop + 140);
    stickyCta.classList.toggle('visible', pastHero && !atFooter);
  }
};
onScroll();
window.addEventListener('scroll', onScroll, { passive: true });

// ── Scroll-reveal: auto-tag groups with staggered delays ─────────────────
const revealGroups = [
  ['.feature-card', 4],
  ['.step', 4],
  ['.plan-card', 4],
  ['.lifetime-card', 2],
  ['.section-inner > h2', 1],
  ['.section-inner > .section-sub', 1],
];
revealGroups.forEach(([sel, mod]) => {
  document.querySelectorAll(sel).forEach((el, i) => {
    el.classList.add('reveal');
    el.setAttribute('data-d', String((i % mod) + 1));
  });
});

const revealObs = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('in'); revealObs.unobserve(e.target); }
  });
}, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
document.querySelectorAll('.reveal').forEach(el => revealObs.observe(el));

// ── Subtle parallax on the hero background as you scroll ──────────────────
// Translate the WRAPPER, not each .aurora — otherwise we'd overwrite the
// per-orb drift keyframes with an inline transform and freeze them.
const heroBg = document.querySelector('.hero-bg');
if (heroBg) {
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      heroBg.style.transform = `translateY(${window.scrollY * 0.18}px)`;
      ticking = false;
    });
  }, { passive: true });
}

// ── Constellation particle field across the whole page ───────────────────
(() => {
  const canvas = document.querySelector('.particle-canvas-global');
  if (!canvas) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const ctx = canvas.getContext('2d');
  let w, h, dpr, particles = [], raf, heroBottom = 700;
  const mouse = { x: -9999, y: -9999 };

  const COLORS = ['127,209,255', '79,142,247', '167,139,250', '236,72,153'];

  // brightness multiplier for a node, based on whether it falls inside the hero
  // (page coordinates) — makes the geometric web pop at the top, calm below.
  function heroBoost(viewportY) {
    const pageY = viewportY + window.scrollY;
    const t = Math.max(0, Math.min(1, (heroBottom - pageY) / 240));
    return 1 + 0.95 * t;            // up to ~1.95x inside the hero
  }

  function size() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    w = rect.width; h = rect.height;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const heroEl = document.querySelector('.hero');
    if (heroEl) heroBottom = heroEl.offsetTop + heroEl.offsetHeight;
    // density scales with area, capped for performance
    const count = Math.min(150, Math.floor((w * h) / 12000));
    particles = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.35,
      vy: (Math.random() - 0.5) * 0.35,
      r: Math.random() * 1.8 + 0.6,
      c: COLORS[(Math.random() * COLORS.length) | 0],
      tw: Math.random() * Math.PI * 2,            // twinkle phase
    }));
  }

  function frame() {
    ctx.clearRect(0, 0, w, h);
    const LINK = 130;

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.x += p.vx; p.y += p.vy;
      p.tw += 0.02;

      // wrap around edges
      if (p.x < -20) p.x = w + 20; if (p.x > w + 20) p.x = -20;
      if (p.y < -20) p.y = h + 20; if (p.y > h + 20) p.y = -20;

      // gentle cursor repulsion
      const dxm = p.x - mouse.x, dym = p.y - mouse.y;
      const dm = Math.hypot(dxm, dym);
      if (dm < 120) { p.x += (dxm / dm) * 0.8; p.y += (dym / dm) * 0.8; }

      // draw node with twinkle, brighter inside the hero
      const boost = heroBoost(p.y);
      const tw = 0.6 + Math.sin(p.tw) * 0.4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (boost > 1.4 ? 1.25 : 1), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${p.c},${Math.min(1, 0.7 * tw * boost)})`;
      ctx.shadowBlur = 8 * boost; ctx.shadowColor = `rgba(${p.c},0.85)`;
      ctx.fill();
      ctx.shadowBlur = 0;

      // links to nearby nodes
      for (let j = i + 1; j < particles.length; j++) {
        const q = particles[j];
        const dx = p.x - q.x, dy = p.y - q.y;
        const d = Math.hypot(dx, dy);
        if (d < LINK) {
          const lb = Math.max(boost, heroBoost(q.y));   // brightest endpoint wins
          ctx.beginPath();
          ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y);
          ctx.strokeStyle = `rgba(${p.c},${Math.min(.5, 0.14 * (1 - d / LINK) * lb)})`;
          ctx.lineWidth = lb > 1.4 ? 1.2 : 1;
          ctx.stroke();
        }
      }
    }
    raf = requestAnimationFrame(frame);
  }

  window.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = e.clientX - rect.left; mouse.y = e.clientY - rect.top;
  });
  window.addEventListener('mouseleave', () => { mouse.x = mouse.y = -9999; });
  let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(size, 150); });

  // pause the loop while the tab is hidden (perf / battery)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(raf); raf = null; }
    else if (!raf) raf = requestAnimationFrame(frame);
  });

  size();
  raf = requestAnimationFrame(frame);
})();

// ── Bento card A: type the live answer when it scrolls into view ─────────
(() => {
  const el = document.querySelector('.demo-a');
  if (!el) return;
  const full = el.getAttribute('data-type') || '';
  let started = false;
  const run = () => {
    if (started) return; started = true;
    let i = 0;
    const step = () => {
      if (i < full.length) {
        el.classList.add('typing');
        el.textContent += full[i++];
        setTimeout(step, full[i - 1] === ' ' ? 18 : 26);
      } else {
        setTimeout(() => el.classList.remove('typing'), 1500);
      }
    };
    step();
  };
  const obs = new IntersectionObserver(es => { if (es[0].isIntersecting) { run(); obs.disconnect(); } },
    { threshold: 0.4 });
  obs.observe(el);
})();

// ── Bento card B: cycle the active LLM chip ──────────────────────────────
(() => {
  const chips = [...document.querySelectorAll('.llm-chip')];
  if (!chips.length) return;
  let idx = 0, timer = null;
  const tick = () => {
    chips.forEach(c => c.classList.remove('active'));
    chips[idx].classList.add('active');
    idx = (idx + 1) % chips.length;
  };
  const orbit = document.querySelector('.llm-orbit');
  const obs = new IntersectionObserver(es => {
    if (es[0].isIntersecting && !timer) { tick(); timer = setInterval(tick, 1400); }
    else if (!es[0].isIntersecting && timer) { clearInterval(timer); timer = null; }
  }, { threshold: 0.3 });
  if (orbit) obs.observe(orbit);
})();

// ── Mockup: type-out effect on the answer text ───────────────────────────
const answerEl = document.querySelector('.mockup-a');
if (answerEl) {
  const fullText = answerEl.textContent;
  answerEl.textContent = '';
  let i = 0;
  const type = () => {
    if (i < fullText.length) {
      answerEl.classList.add('typing');
      answerEl.textContent += fullText[i++];
      // vary cadence slightly for a natural feel
      setTimeout(type, fullText[i - 1] === ' ' ? 6 : 11);
    } else {
      setTimeout(() => answerEl.classList.remove('typing'), 1200);
    }
  };
  const obs = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting) { type(); obs.disconnect(); }
  }, { threshold: 0.4 });
  obs.observe(answerEl);
}

// ── Showroom: interactive feature stage ──────────────────────────────────
// Auto-advances through the feature panels. Advancement is driven off the
// active tab's progress-bar animationend, so motion, progress, and timing
// stay perfectly in sync — and a single CSS :hover pause freezes all three.
(() => {
  const stage = document.querySelector('.showroom-stage');
  if (!stage) return;
  const tabs   = [...stage.querySelectorAll('.sr-tab')];
  const panels = [...stage.querySelectorAll('.sr-panel')];
  const screen = stage.querySelector('.sr-screen');
  const statusTx = stage.querySelector('.sr-status-tx');
  const featureEl = stage.querySelector('.sr-feature');
  if (!tabs.length || tabs.length !== panels.length) return;

  // status text shown in the stage title-bar per feature
  const STATUS = ['listening', 'answering', 'answering', 'listening',
                  'exporting', 'researching', 'offline · local', 'auto-selecting', 'reasoning',
                  'switching', 'pinned', 'discreet', 'hidden', 'debriefing'];
  let idx = 0;

  const setActive = (i) => {
    idx = (i + tabs.length) % tabs.length;
    tabs.forEach((t, k)   => t.classList.toggle('active', k === idx));
    panels.forEach((p, k) => p.classList.toggle('active', k === idx));
    // retint the whole screen (glow + live dot) to the active feature colour
    const c = (tabs[idx].style.getPropertyValue('--c') || '#4f8ef7').trim();
    if (screen) screen.style.setProperty('--c', c);
    if (statusTx) statusTx.textContent = STATUS[idx] || 'listening';
    if (featureEl) {
      const name = tabs[idx].querySelector('.sr-meta strong');
      if (name) featureEl.textContent = name.textContent;
    }
  };

  // advance the moment the active tab's progress bar finishes filling
  stage.addEventListener('animationend', (e) => {
    if (e.animationName === 'srProg') setActive(idx + 1);
  });

  // click any tab to jump straight to it
  tabs.forEach((t, i) => t.addEventListener('click', () => setActive(i)));

  // only run while the stage is on-screen (pauses + resets when scrolled away)
  const io = new IntersectionObserver((es) => {
    es.forEach(en => stage.classList.toggle('running', en.isIntersecting));
  }, { threshold: 0.25 });
  io.observe(stage);

  setActive(0);
})();
