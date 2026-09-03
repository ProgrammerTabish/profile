/* =========================================================
   zakatabish.online — site behaviour
   ---------------------------------------------------------
   CONFIG lives at the top. The only thing you normally need
   to edit is GH.deny — repositories listed there are never
   shown. Private repos are already impossible to expose:
   the unauthenticated GitHub API only returns public ones.
   ========================================================= */

const GH = {
  user: 'ProgrammerTabish',

  // Never render these (lowercase). Add any repo you want kept off the site.
  deny: [
    'qams',
    'profile',
    'programmertabish',
    'programmertabish.github.io',
    'portfolio',
    'zakatabish.online'
  ],

  // Shown first, in this order, if they exist.
  pin: ['finalyearproject'],

  hideForks: true,
  cacheKey: 'zt.repos.v1',
  cacheTtl: 6 * 60 * 60 * 1000 // 6 hours
};

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const store = {
  get(k, fb = null) { try { const v = localStorage.getItem(k); return v === null ? fb : JSON.parse(v); } catch { return fb; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } }
};

/* ── theme ───────────────────────────────────────────── */
(function theme() {
  const btn = $('#themeToggle');
  const label = $('[data-theme-label]');
  const saved = store.get('zt.theme');
  const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

  const apply = (mode) => {
    document.documentElement.dataset.theme = mode;
    if (label) label.textContent = mode === 'dark' ? 'Light' : 'Dark';
    if (btn) btn.setAttribute('aria-pressed', String(mode === 'dark'));
    window.dispatchEvent(new CustomEvent('themechange'));
  };

  apply(saved || (sysDark ? 'dark' : 'light'));

  btn?.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    store.set('zt.theme', next);
    apply(next);
  });

  window.setTheme = (m) => { store.set('zt.theme', m); apply(m); };
})();

/* ── nav drawer + scrollspy ──────────────────────────── */
(function nav() {
  const rail = $('#rail');
  const toggle = $('#railToggle');
  let scrim = null;

  const close = () => {
    rail.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    scrim?.remove();
    scrim = null;
  };

  const open = () => {
    rail.classList.add('is-open');
    toggle.setAttribute('aria-expanded', 'true');
    scrim = document.createElement('button');
    scrim.className = 'railScrim';
    scrim.setAttribute('aria-label', 'Close menu');
    scrim.addEventListener('click', close);
    document.body.appendChild(scrim);
  };

  toggle?.addEventListener('click', () => rail.classList.contains('is-open') ? close() : open());
  $$('.rail__nav a, .rail__mark').forEach(a => a.addEventListener('click', () => {
    if (window.innerWidth < 1080) close();
  }));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

  const links = $$('.rail__nav a');
  const map = new Map(links.map(a => [a.getAttribute('href').slice(1), a]));
  const targets = Array.from(map.keys()).map(id => document.getElementById(id)).filter(Boolean);

  if ('IntersectionObserver' in window && targets.length) {
    const io = new IntersectionObserver(entries => {
      entries.forEach(en => {
        if (!en.isIntersecting) return;
        links.forEach(a => a.removeAttribute('aria-current'));
        map.get(en.target.id)?.setAttribute('aria-current', 'true');
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    targets.forEach(t => io.observe(t));
  }
})();

/* ── canvas helper ───────────────────────────────────── */
function fitCanvas(cv, ratio) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = cv.clientWidth || 640;
  const h = Math.round(w / ratio);
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  cv.style.height = h + 'px';
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

function token(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/* ── hero oscilloscope ───────────────────────────────── */
(function scope() {
  const cv = $('#scope');
  if (!cv) return;

  const rdAmp = $('#rdAmp'), rdFreq = $('#rdFreq'), rdNoise = $('#rdNoise');
  const rdState = $('#rdState'), led = $('.led');

  let W = 0, H = 0, ctx = null;
  let amp = 0.18, freq = 1.05, noise = 0.42, t = 0;
  let targetAmp = 0.58, targetFreq = 1.6, targetNoise = 0.06;
  let locked = false, started = performance.now();
  let colTrace, colGrid, colGhost;

  const readColors = () => {
    colTrace = token('--ochre') || '#A9700B';
    colGrid  = token('--rule') || '#D6DAD5';
    colGhost = token('--petrol') || '#17505C';
  };

  const size = () => { const r = fitCanvas(cv, 16 / 9); ctx = r.ctx; W = r.w; H = r.h; };
  readColors(); size();
  window.addEventListener('resize', size, { passive: true });
  window.addEventListener('themechange', readColors);

  // pointer drives amplitude / frequency
  const onMove = (x, y) => {
    const r = cv.getBoundingClientRect();
    targetFreq = 0.7 + ((x - r.left) / r.width) * 3.6;
    targetAmp = 0.22 + (1 - (y - r.top) / r.height) * 0.62;
    targetNoise = 0.03;
  };
  cv.addEventListener('pointermove', e => onMove(e.clientX, e.clientY));
  cv.addEventListener('pointerleave', () => { targetAmp = 0.58; targetFreq = 1.6; });
  cv.addEventListener('touchmove', e => {
    if (e.touches[0]) onMove(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });

  function grid() {
    ctx.strokeStyle = colGrid;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    for (let i = 1; i < 8; i++) {
      const x = (W / 8) * i;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let i = 1; i < 5; i++) {
      const y = (H / 5) * i;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function wave(offset, alpha, width, color) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    for (let px = 0; px <= W; px += 2) {
      const u = px / W;
      const n = (Math.sin(u * 47.3 + t * 3.1) + Math.sin(u * 91.7 - t * 2.3)) * 0.5 * noise;
      const y = H / 2 - (Math.sin(u * Math.PI * 2 * freq + t + offset) * 0.5 + n * 0.5) * H * amp;
      px === 0 ? ctx.moveTo(px, y) : ctx.lineTo(px, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05); last = now;
    t += dt * (reduceMotion ? 0.35 : 1.35);

    amp   += (targetAmp - amp) * 0.05;
    freq  += (targetFreq - freq) * 0.05;
    noise += (targetNoise - noise) * 0.04;

    ctx.clearRect(0, 0, W, H);
    grid();
    wave(-0.55, 0.22, 1.4, colGhost);
    wave(0, 1, 2.1, colTrace);

    if (rdAmp) {
      rdAmp.textContent = (amp * 2).toFixed(2) + ' V';
      rdFreq.textContent = (freq * 1.42).toFixed(2) + ' kHz';
      rdNoise.textContent = (noise * 100).toFixed(1) + ' %';
    }

    if (!locked && now - started > 1600) {
      locked = true;
      if (rdState) rdState.textContent = 'signal locked';
      led?.setAttribute('data-state', 'lock');
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();

/* ── GitHub repositories ─────────────────────────────── */
const Repos = (function () {
  const grid = $('#repoGrid');
  const countEl = $('#repoCount');
  const langsEl = $('#repoLangs');
  const search = $('#repoQ');
  if (!grid) return {};

  let all = [], lang = null, q = '';

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const when = iso => {
    const d = (Date.now() - new Date(iso)) / 86400000;
    if (d < 1) return 'today';
    if (d < 30) return Math.round(d) + 'd ago';
    if (d < 365) return Math.round(d / 30) + 'mo ago';
    return Math.round(d / 365) + 'y ago';
  };

  const allowed = r =>
    !GH.deny.includes(r.name.toLowerCase()) &&
    !(GH.hideForks && r.fork) &&
    !r.private;

  function order(list) {
    return list.slice().sort((a, b) => {
      const pa = GH.pin.indexOf(a.name.toLowerCase());
      const pb = GH.pin.indexOf(b.name.toLowerCase());
      if (pa !== pb) return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
      return new Date(b.pushed_at) - new Date(a.pushed_at);
    });
  }

  function card(r) {
    const zip = `https://github.com/${r.full_name}/archive/refs/heads/${r.default_branch}.zip`;
    const live = r.homepage || (r.has_pages ? `https://${GH.user.toLowerCase()}.github.io/${r.name}/` : null);
    const title = r.name.replace(/[-_]/g, ' ');

    return `
      <article class="repo">
        <h3 class="repo__name"><a href="${esc(r.html_url)}" rel="noopener">${esc(title)}</a></h3>
        <p class="repo__desc">${esc(r.description || 'No description on GitHub yet.')}</p>
        ${r.topics?.length ? `<ul class="repo__topics">${r.topics.slice(0, 4).map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
        <p class="repo__meta">
          ${r.language ? `<span><i class="repo__dot"></i>${esc(r.language)}</span>` : ''}
          ${r.stargazers_count ? `<span>${r.stargazers_count} stars</span>` : ''}
          <span>updated ${when(r.pushed_at)}</span>
        </p>
        <p class="repo__acts">
          <a class="btn btn--outline btn--sm" href="${esc(r.html_url)}" rel="noopener">Code</a>
          <a class="btn btn--outline btn--sm" href="${esc(zip)}">Download ZIP</a>
          ${live ? `<a class="btn btn--solid btn--sm" href="${esc(live)}" rel="noopener">Open live</a>` : ''}
        </p>
      </article>`;
  }

  function render() {
    const needle = q.trim().toLowerCase();
    const list = all.filter(r => {
      if (lang && r.language !== lang) return false;
      if (!needle) return true;
      return (r.name + ' ' + (r.description || '') + ' ' + (r.language || '') + ' ' + (r.topics || []).join(' '))
        .toLowerCase().includes(needle);
    });

    grid.innerHTML = list.length
      ? list.map(card).join('')
      : `<p class="repos__err">Nothing matches that filter. Clear the search box to see everything again.</p>`;

    countEl.textContent = `${list.length} of ${all.length} public repositories`;
  }

  function chips() {
    const langs = [...new Set(all.map(r => r.language).filter(Boolean))].sort();
    langsEl.innerHTML = langs.map(l =>
      `<button class="chip" type="button" data-lang="${esc(l)}" aria-pressed="false">${esc(l)}</button>`).join('');

    langsEl.addEventListener('click', e => {
      const b = e.target.closest('[data-lang]');
      if (!b) return;
      lang = (lang === b.dataset.lang) ? null : b.dataset.lang;
      $$('[data-lang]', langsEl).forEach(x => x.setAttribute('aria-pressed', String(x.dataset.lang === lang)));
      render();
    });
  }

  function fail(msg) {
    grid.innerHTML = `<p class="repos__err">${esc(msg)} You can browse everything directly at
      <a href="https://github.com/${GH.user}" rel="noopener">github.com/${GH.user}</a>.</p>`;
    countEl.textContent = 'live list unavailable';
  }

  async function load() {
    const cached = store.get(GH.cacheKey);
    if (cached && Date.now() - cached.ts < GH.cacheTtl) {
      all = order(cached.data);
      chips(); render();
      return;
    }
    try {
      const res = await fetch(`https://api.github.com/users/${GH.user}/repos?per_page=100&sort=pushed`, {
        headers: { Accept: 'application/vnd.github+json' }
      });
      if (!res.ok) throw new Error(res.status === 403 ? 'GitHub is rate limiting this browser right now.' : 'GitHub returned ' + res.status + '.');
      const data = (await res.json()).filter(allowed).map(r => ({
        name: r.name, full_name: r.full_name, html_url: r.html_url, description: r.description,
        language: r.language, topics: r.topics, stargazers_count: r.stargazers_count,
        pushed_at: r.pushed_at, default_branch: r.default_branch, homepage: r.homepage, has_pages: r.has_pages
      }));
      store.set(GH.cacheKey, { ts: Date.now(), data });
      all = order(data);
      chips(); render();
    } catch (err) {
      if (cached) { all = order(cached.data); chips(); render(); }
      else fail(err.message || 'The repository list could not be loaded.');
    }
  }

  search?.addEventListener('input', e => { q = e.target.value; render(); });
  load();

  return { list: () => all };
})();

/* ── Signal Lock ─────────────────────────────────────── */
(function game() {
  const cv = $('#gameCanvas');
  if (!cv) return;

  const overlay = $('#gameOverlay'), oTitle = $('#gameOverlayTitle'), oText = $('#gameOverlayText');
  const startBtn = $('#gameStart'), bestEl = $('#gameBest'), hint = $('#gameHint');
  const fill = $('#meterFill'), mval = $('#meterVal');
  const rEl = $('#gameRound'), tEl = $('#gameTime'), sEl = $('#gameScore');
  const cA = $('#ctlAmp'), cF = $('#ctlFreq'), cP = $('#ctlPhase');
  const vA = $('#valAmp'), vF = $('#valFreq'), vP = $('#valPhase');

  const ROUNDS = 5, HOLD = 420, PASS = 90;
  let W = 0, H = 0, ctx = null;
  let running = false, round = 1, score = 0, t0 = 0, roundT0 = 0, holdFrom = 0, lock = 0;
  let target = null;
  let colT, colP, colGrid;

  const readColors = () => {
    colT = token('--petrol'); colP = token('--ochre'); colGrid = token('--rule');
  };
  const size = () => { const r = fitCanvas(cv, 20 / 9); ctx = r.ctx; W = r.w; H = r.h; };
  readColors(); size();
  window.addEventListener('resize', () => { size(); draw(); }, { passive: true });
  window.addEventListener('themechange', () => { readColors(); draw(); });

  const best = () => store.get('zt.signallock.best', 0);
  const showBest = () => { bestEl.textContent = best() ? `Best score so far: ${best()}` : ''; };
  showBest();

  const player = () => ({
    amp: +cA.value,
    freq: +cF.value / 100,
    phase: +cP.value / 100
  });

  function newTarget() {
    return {
      amp: 20 + Math.round(Math.random() * 70),
      freq: Math.round((60 + Math.random() * 320)) / 100,
      phase: Math.round(Math.random() * 620) / 100
    };
  }

  const yOf = (p, u, h) => h / 2 - Math.sin(u * Math.PI * 2 * p.freq + p.phase) * (p.amp / 100) * (h / 2.35);

  function trace(p, color, width, dash) {
    ctx.beginPath();
    ctx.setLineDash(dash || []);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    for (let px = 0; px <= W; px += 2) {
      const y = yOf(p, px / W, H);
      px === 0 ? ctx.moveTo(px, y) : ctx.lineTo(px, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function error() {
    if (!target) return 999;
    const p = player();
    let sum = 0;
    for (let i = 0; i <= 100; i++) {
      const u = i / 100;
      sum += Math.abs(yOf(target, u, 300) - yOf(p, u, 300));
    }
    return sum / 101;
  }

  function draw() {
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);

    ctx.strokeStyle = colGrid; ctx.globalAlpha = 0.5; ctx.lineWidth = 1;
    for (let i = 1; i < 10; i++) { const x = (W / 10) * i; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
    ctx.globalAlpha = 1;

    if (target) trace(target, colT, 1.8, [7, 6]);
    trace(player(), colP, 2.4);
  }

  function tolerance() { return 46 - (round - 1) * 6; }

  function tick(now) {
    if (!running) return;
    const err = error();
    lock = Math.max(0, Math.min(100, 100 * (1 - err / tolerance())));

    fill.style.width = lock.toFixed(0) + '%';
    fill.classList.toggle('is-lock', lock >= PASS);
    mval.textContent = lock.toFixed(0) + '%';
    tEl.textContent = ((now - t0) / 1000).toFixed(1) + 's';

    if (lock >= PASS) {
      if (!holdFrom) holdFrom = now;
      if (now - holdFrom >= HOLD) { clear(now); return; }
    } else {
      holdFrom = 0;
    }
    draw();
    requestAnimationFrame(tick);
  }

  function clear(now) {
    const ms = now - roundT0;
    const pts = Math.max(120, Math.round(1000 - ms / 8));
    score += pts;
    sEl.textContent = score;

    if (round >= ROUNDS) return finish();

    round++;
    rEl.textContent = round;
    hint.textContent = `Locked in ${(ms / 1000).toFixed(1)}s — ${pts} points. Tolerance is tighter now.`;
    target = newTarget();
    holdFrom = 0;
    roundT0 = performance.now();
    requestAnimationFrame(tick);
  }

  function finish() {
    running = false;
    [cA, cF, cP].forEach(c => c.disabled = true);
    const prev = best();
    if (score > prev) { store.set('zt.signallock.best', score); }
    oTitle.textContent = `${score} points`;
    oText.textContent = score > prev
      ? 'A new personal best. That is genuinely quick tuning.'
      : `Five signals locked in ${((performance.now() - t0) / 1000).toFixed(1)} seconds.`;
    startBtn.textContent = 'Play again';
    overlay.hidden = false;
    showBest();
    hint.textContent = 'Press start, then drag the sliders until the lock meter fills.';
  }

  function start() {
    running = true; round = 1; score = 0; lock = 0; holdFrom = 0;
    rEl.textContent = '1'; sEl.textContent = '0'; tEl.textContent = '0.0s';
    [cA, cF, cP].forEach(c => c.disabled = false);
    target = newTarget();
    overlay.hidden = true;
    hint.textContent = 'Match the dashed trace. Hold the lock for a moment to clear the round.';
    t0 = roundT0 = performance.now();
    requestAnimationFrame(tick);
  }

  const sync = () => {
    vA.textContent = cA.value;
    vF.textContent = (+cF.value / 100).toFixed(2);
    vP.textContent = (+cP.value / 100).toFixed(2);
    if (!running) draw();
  };
  [cA, cF, cP].forEach(c => c.addEventListener('input', sync));
  sync(); draw();

  startBtn.addEventListener('click', start);
  window.startSignalLock = () => {
    document.getElementById('lab').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
    if (!running) start();
  };
})();

/* ── email reveal ────────────────────────────────────── */
(function mail() {
  const link = $('#mailLink'), text = $('#mailText');
  if (!link) return;
  let shown = false;
  const reveal = (e) => {
    const addr = link.dataset.u + '@' + link.dataset.d;
    if (!shown) {
      e?.preventDefault();
      link.href = 'mailto:' + addr;
      text.textContent = addr;
      shown = true;
    }
  };
  link.addEventListener('click', reveal);
  link.addEventListener('focus', reveal);
  link.addEventListener('pointerenter', reveal);
  window.getMail = () => link.dataset.u + '@' + link.dataset.d;
})();

/* ── console ─────────────────────────────────────────── */
(function konsole() {
  const box = $('#console'), out = $('#consoleOut'), form = $('#consoleForm'),
        input = $('#consoleIn'), chips = $('#consoleChips'), closeBtn = $('#consoleClose');
  if (!box) return;

  const openers = [$('#consoleOpen'), $('#consoleOpen2')].filter(Boolean);
  const history = []; let hIdx = -1; let booted = false;

  const write = (html, cls = '') => {
    const p = document.createElement('div');
    if (cls) p.className = cls;
    p.innerHTML = html;
    out.appendChild(p);
    out.scrollTop = out.scrollHeight;
  };

  const CHIPS = ['help', 'whoami', 'projects', 'skills', 'contact', 'lock', 'theme', 'clear'];
  chips.innerHTML = CHIPS.map(c => `<button class="chip" type="button" data-cmd="${c}">${c}</button>`).join('');
  chips.addEventListener('click', e => {
    const b = e.target.closest('[data-cmd]');
    if (b) run(b.dataset.cmd);
  });

  function open() {
    box.hidden = false;
    openers.forEach(o => o.setAttribute('aria-expanded', 'true'));
    if (!booted) {
      booted = true;
      write('diag 1.4 — interactive résumé shell', 'dim');
      write('Type <span class="cmd">help</span> for the command list, or tap a chip below.', 'dim');
    }
    setTimeout(() => input.focus(), 40);
  }
  function close() {
    box.hidden = true;
    openers.forEach(o => o.setAttribute('aria-expanded', 'false'));
  }

  openers.forEach(o => o.addEventListener('click', open));
  closeBtn.addEventListener('click', close);
  box.addEventListener('click', e => { if (e.target === box) close(); });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !box.hidden) { close(); return; }
    const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || '');
    if ((e.key === '~' || e.key === '`') && !typing) { e.preventDefault(); box.hidden ? open() : close(); }
  });

  const go = (id) => { close(); document.getElementById(id)?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' }); };

  const CMD = {
    help() {
      write([
        '<span class="cmd">whoami</span>    who you are talking to',
        '<span class="cmd">now</span>       what I am doing at the moment',
        '<span class="cmd">work</span>      experience history',
        '<span class="cmd">skills</span>    the toolkit',
        '<span class="cmd">projects</span>  list public repositories',
        '<span class="cmd">open</span> &lt;n&gt;  open repository number n on GitHub',
        '<span class="cmd">lock</span>      play Signal Lock',
        '<span class="cmd">contact</span>   how to reach me',
        '<span class="cmd">cv</span>        download the CV',
        '<span class="cmd">theme</span>     switch light and dark',
        '<span class="cmd">clear</span>     wipe the screen'
      ].join('\n'));
    },
    whoami() {
      write('Shaikh Zaka Tabish — diagnostics and AI engineering.\nWorking student at Nokia Nuremberg, MSc student at OTH Amberg.\nI make hardware faults reproducible, then make them fixable.');
    },
    now() {
      write('Nokia Nuremberg  board bring-up &amp; diagnostics software, until Sep 2026\nOTH Amberg       MSc Artificial Intelligence for Industrial Applications\nNuremberg, DE    open to working student, internship and graduate roles');
    },
    work() { write('Opening the experience section.', 'dim'); go('work'); },
    skills() {
      write('Python · JavaScript · C++ · C#\nREST · HTTP · WebSockets · MCP · network diagnostics · monitoring\nData analysis · automation · GPS &amp; geodata · OpenStreetMap · React Leaflet\nAgile · Jira · Confluence · Git · Jenkins · Cursor · Copilot\nEnglish C1 · German B1');
    },
    projects() {
      const list = Repos.list ? Repos.list() : [];
      if (!list.length) { write('Repository list is still loading, or GitHub is rate limiting. Try again in a moment.', 'warn'); return; }
      write(list.map((r, i) =>
        `${String(i + 1).padStart(2, '0')}  <a href="${r.html_url}" rel="noopener">${r.name}</a>  <span class="dim">${r.language || '—'}</span>`
      ).join('\n'));
      write('Use <span class="cmd">open 1</span> to jump to one.', 'dim');
    },
    open(arg) {
      const list = Repos.list ? Repos.list() : [];
      const n = parseInt(arg, 10);
      const hit = Number.isInteger(n) ? list[n - 1] : list.find(r => r.name.toLowerCase() === String(arg).toLowerCase());
      if (!hit) { write('No repository by that number or name. Run <span class="cmd">projects</span> first.', 'warn'); return; }
      write(`Opening ${hit.name} on GitHub.`, 'ok');
      window.open(hit.html_url, '_blank', 'noopener');
    },
    lock() { write('Starting Signal Lock. Good luck.', 'ok'); window.startSignalLock?.(); close(); },
    contact() {
      const m = window.getMail ? window.getMail() : '';
      write(`email     <a href="mailto:${m}">${m}</a>\ngithub    <a href="https://github.com/${GH.user}" rel="noopener">${GH.user}</a>\nlinkedin  <a href="https://www.linkedin.com/in/zakatabish" rel="noopener">in/zakatabish</a>`);
    },
    cv() { write('Downloading the CV.', 'ok'); window.location.href = 'assets/cv-shaikh-zaka-tabish.pdf'; },
    theme(arg) {
      const mode = (arg === 'dark' || arg === 'light') ? arg : (document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
      window.setTheme?.(mode);
      write(`Theme set to ${mode}.`, 'ok');
    },
    clear() { out.innerHTML = ''; },
    sudo() { write('Nice try. This shell has exactly one user and he is already logged in.', 'warn'); },
    ls() { CMD.projects(); },
    exit() { close(); }
  };

  function run(raw) {
    const line = String(raw).trim();
    if (!line) return;
    write(`<span class="dim">diag &gt;</span> ${line.replace(/[<>]/g, '')}`);
    history.unshift(line); hIdx = -1;
    const [cmd, ...rest] = line.split(/\s+/);
    const fn = CMD[cmd.toLowerCase()];
    if (fn) fn(rest.join(' '));
    else write(`${cmd.replace(/[<>]/g, '')}: unknown command. Try <span class="cmd">help</span>.`, 'warn');
  }

  form.addEventListener('submit', e => { e.preventDefault(); run(input.value); input.value = ''; });

  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowUp') { e.preventDefault(); hIdx = Math.min(hIdx + 1, history.length - 1); input.value = history[hIdx] || ''; }
    if (e.key === 'ArrowDown') { e.preventDefault(); hIdx = Math.max(hIdx - 1, -1); input.value = hIdx === -1 ? '' : history[hIdx]; }
  });
})();
