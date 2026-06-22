// ════════════════════════════════════════════════════════════════
//  Heario live-demo capture — scripted online-meeting scenario.
//  Record the .stage element. The whole sequence runs ~28s then loops.
// ════════════════════════════════════════════════════════════════

const $ = s => document.querySelector(s);
const capText   = $('#capText');
const captions  = $('#captions');
const natTx     = $('#natTx');
const natAns    = $('#natAns');
const natStatus = $('#natStatus');
const natDot    = $('#natDot');
const natConf   = $('#natConf');
const natConfN  = $('#natConfN');
const wave      = $('#wave');
const iTile     = $('#interviewerTile');
const meetTime  = $('#meetTime');

const CONF_COLORS = ['#222b3d', '#f0524b', '#d98b3a', '#f5bf4f', '#8bc34a', '#5fb85f'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

// optional Higgsfield drop-ins: if interviewer.mp4 / self.mp4 exist, use them
function tryVideo(id, src) {
  const v = document.getElementById(id);
  if (!v) return;
  v.src = src + '?t=' + Date.now();   // cache-bust so recordings always use the latest clip
  v.addEventListener('loadeddata', () => { v.classList.add('on'); v.play().catch(()=>{}); });
  v.addEventListener('error', () => { v.removeAttribute('src'); });
}
// served same-origin (not GitHub Releases) — Releases forces
// Content-Disposition: attachment, which blocks inline playback on mobile
tryVideo('interviewerVideo', 'interviewer.mp4');
tryVideo('selfVideo', 'self.mp4');

// running meeting clock
let t0 = Date.now();
setInterval(() => {
  const s = Math.floor((Date.now() - t0) / 1000);
  meetTime.textContent = String(Math.floor(s/60)).padStart(2,'0') + ':' + String(s%60).padStart(2,'0');
}, 500);

// ── helpers ──────────────────────────────────────────────────────
function setStatus(state) {            // 'listening' | 'transcribing' | 'answering'
  natStatus.className = 'nat-status' + (state !== 'listening' ? ' ' + state : '');
  natDot.className    = 'nat-dot'    + (state !== 'listening' ? ' ' + state : '');
  natStatus.textContent = state;
}

// Speak a line: types the meeting caption AND streams live voice-to-text into the
// Heario overlay word-by-word — interim (dim) word finalizes to solid, like real STT.
async function speakAndTranscribe(speaker, text, cps = 28) {
  // bottom meeting captions / live subtitles (persistent bar, blinking while speaking)
  captions.classList.add('show', 'speaking');
  $('#capSpk').textContent = speaker;
  capText.textContent = '';

  // overlay live transcription
  setStatus('transcribing');
  natTx.classList.add('live'); natTx.classList.remove('question');
  natTx.innerHTML = '<span class="tx-spk">S0</span> <span class="tx-final"></span>' +
                    '<span class="tx-interim"></span><span class="tx-cur">▋</span>';
  const finalEl   = natTx.querySelector('.tx-final');
  const interimEl = natTx.querySelector('.tx-interim');

  let word = '';
  for (const ch of text) {
    capText.textContent += ch;               // meeting caption (char by char)
    if (ch === ' ') {                        // word boundary → finalize into overlay
      finalEl.textContent += word + ' ';
      interimEl.textContent = '';
      word = '';
    } else {
      word += ch;
      interimEl.textContent = word;          // interim (in-progress) word, dimmed
    }
    await sleep(1000 / cps);
  }
  if (word) { finalEl.textContent += word; interimEl.textContent = ''; }
  captions.classList.remove('speaking');   // line finalized — caret off, subtitle persists
  const cur = natTx.querySelector('.tx-cur'); if (cur) cur.remove();
}

async function streamAnswer(text, conf, cps = 42) {
  setStatus('answering');
  natConf.hidden = false; natConfN.textContent = conf + '/5';
  [...natConf.querySelectorAll('i')].forEach((pip, i) => {
    pip.style.background = i < conf ? CONF_COLORS[conf] : '#222b3d';
  });
  natAns.innerHTML = ''; natAns.classList.add('streaming');
  for (const ch of text) { natAns.textContent += ch; await sleep(1000 / cps); }
  natAns.classList.remove('streaming');
  setStatus('listening');
}

// ── the scenario ─────────────────────────────────────────────────
const SCRIPT = [
  {
    say: ['Sarah Chen', "Alright — let's do a system design round.", 30],
  },
  {
    say: ['Sarah Chen', "How would you design a URL shortener that scales to a billion links?", 30],
    transcript: "Q: design a URL shortener that scales to a billion links",
    answer: {
      conf: 5,
      text: "Use a 7-char base-62 key from an ID generator — 62^7 ≈ 3.5T URLs, huge headroom. Store key→URL in a KV store (DynamoDB/Redis), sharded by key prefix. Reads dominate ~100:1, so front it with a CDN/edge cache. Use a Snowflake-style ID service to avoid collisions; 301-redirect on lookup. Add a bloom filter to fast-reject unknown keys."
    }
  },
  {
    say: ['Sarah Chen', "Nice. And how would you support custom vanity aliases?", 30],
    transcript: "Q: how would you support custom vanity aliases?",
    answer: {
      conf: 4,
      text: "Treat aliases as a separate namespace: a uniqueness check on write via a conditional put (INSERT … IF NOT EXISTS) so two users can't claim the same alias. Reserve a blocklist for abuse/profanity, rate-limit creation per account, and fall back to the auto-generated key if the alias is taken."
    }
  },
];

async function runScenario() {
  // reset
  natTx.innerHTML = '<span class="nat-ph">Waiting for audio…</span>';
  natTx.classList.remove('live', 'question');
  natAns.innerHTML = '<span class="nat-ph">Answer will appear here…</span>';
  natConf.hidden = true;
  setStatus('listening');
  iTile.classList.add('speaking');
  t0 = Date.now();

  await sleep(1200);

  for (const beat of SCRIPT) {
    // interviewer speaks → live voice-to-text streams into the overlay
    iTile.classList.add('speaking');
    await speakAndTranscribe(beat.say[0], beat.say[1], beat.say[2]);
    setStatus('listening');
    await sleep(400);

    if (beat.answer) {
      natTx.classList.add('question');        // recognized as a question → highlight
      await sleep(550);
      iTile.classList.remove('speaking');     // they stop, listening for your answer
      await streamAnswer(beat.answer.text, beat.answer.conf);
      await sleep(2200);
    } else {
      await sleep(900);
    }
  }

  iTile.classList.add('speaking');
  await sleep(2500);
}

// ── record mode ──────────────────────────────────────────────────
// Add ?rec to the URL (or press "r") for a clean single take:
// 3-2-1 countdown → play once → freeze on the final frame. No loop, no timing guesswork.
const REC = new URLSearchParams(location.search).has('rec');

async function countdown() {
  const el = document.createElement('div');
  el.className = 'rec-countdown';
  document.querySelector('.stage').appendChild(el);
  for (const n of ['3', '2', '1']) { el.textContent = n; el.classList.remove('tick'); void el.offsetWidth; el.classList.add('tick'); await sleep(850); }
  el.remove();
}

async function loop() {
  if (REC) {
    await countdown();
    await runScenario();          // single take, then freeze on the last frame
    return;
  }
  while (true) { await runScenario(); await sleep(800); }
}

$('#replay').addEventListener('click', () => location.reload());
// press "r" to (re)start a clean single take
addEventListener('keydown', e => { if (e.key === 'r' || e.key === 'R') location.href = location.pathname + '?rec'; });
loop();
