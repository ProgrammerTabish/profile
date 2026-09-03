/* =========================================================
   zakatabish.online — site behaviour
   ---------------------------------------------------------
   Shared helpers ($, $$, store, fitCanvas, token, reduceMotion)
   are declared at top level so the playground scripts loaded
   after this file (see index.html) can reuse them directly.
   ========================================================= */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const store = {
  get(k, fb = null) { try { const v = localStorage.getItem(k); return v === null ? fb : JSON.parse(v); } catch { return fb; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } }
};

/* Assembled in JS (not present as page text) to deter the simplest
   scrapers. Page-independent so console.contact() works from any page,
   not only the one with the #mailLink reveal card (contact.html). */
const EMAIL = 'zakatabish' + '@' + 'gmail.com';

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

/* ── nav drawer ──────────────────────────────────────── */
/* Which link is "current" is hardcoded per-page (aria-current="page"
   in each file's own copy of the nav) — this is a static multi-page
   site with no client-side routing, so there's nothing to spy on. */
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

/* ── hero neural network ─────────────────────────────── */
(function heroNet() {
  const cv = $('#heroNet');
  if (!cv) return;

  const rdAct = $('#rdAct'), rdConf = $('#rdConf'), rdLayers = $('#rdLayers');
  const rdState = $('#rdState'), led = $('.led');

  let W = 0, H = 0, ctx = null;
  const LAYERS = [5, 7, 7, 4];
  let nodes = [];
  let edgeWeights = [];
  let colAccent, colAccent2, colRule;
  let started = performance.now(), locked = false, pulseT = 0;
  const pointer = { x: -999, y: -999, active: false };

  const readColors = () => {
    colAccent = token('--accent') || '#5645D6';
    colAccent2 = token('--accent2') || '#0C8C86';
    colRule = token('--rule') || '#DBDEEA';
  };

  function layout() {
    nodes = [];
    const padX = W * 0.09, padY = H * 0.12;
    const innerW = W - padX * 2;
    LAYERS.forEach((count, li) => {
      const x = padX + (innerW * li) / (LAYERS.length - 1);
      const gap = (H - padY * 2) / Math.max(1, count - 1);
      for (let i = 0; i < count; i++) {
        const y = count === 1 ? H / 2 : padY + gap * i;
        nodes.push({ x, y, layer: li, act: 0.06 + Math.random() * 0.05, actWave: 0, actPointer: 0, colorMode: 'forward' });
      }
    });
    if (rdLayers) rdLayers.textContent = String(LAYERS.length);

    // Fixed (illustrative) connection weights, so edges have something
    // to visibly represent besides activation, same idea as the digit
    // demo's real weight-magnitude edges.
    edgeWeights = [];
    for (let li = 0; li < LAYERS.length - 1; li++) {
      const mat = [];
      for (let i = 0; i < LAYERS[li]; i++) {
        const row = [];
        for (let j = 0; j < LAYERS[li + 1]; j++) row.push(Math.random() * 2 - 1);
        mat.push(row);
      }
      edgeWeights.push(mat);
    }
  }

  const size = () => { const r = fitCanvas(cv, 16 / 9); ctx = r.ctx; W = r.w; H = r.h; layout(); };
  readColors(); size();
  window.addEventListener('resize', size, { passive: true });
  window.addEventListener('themechange', readColors);

  const onMove = (x, y) => {
    const r = cv.getBoundingClientRect();
    pointer.x = x - r.left; pointer.y = y - r.top; pointer.active = true;
  };
  cv.addEventListener('pointermove', e => onMove(e.clientX, e.clientY));
  cv.addEventListener('pointerleave', () => { pointer.active = false; });
  cv.addEventListener('touchmove', e => {
    if (e.touches[0]) onMove(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });

  function byLayer(li) { return nodes.filter(n => n.layer === li); }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05); last = now;
    pulseT += dt * (reduceMotion ? 0.35 : 1);

    // A full cycle is a forward pass (left to right, signal colour),
    // a short pause, then a backward pass (right to left, gradient
    // colour) travelling back over the same layers in reverse order.
    const cycle = 3.2;
    const u = (pulseT % cycle) / cycle;
    let waveMode = null, localT = 0;
    if (u < 0.5) { waveMode = 'forward'; localT = u / 0.5; }
    else if (u < 0.55) { waveMode = null; }
    else { waveMode = 'backward'; localT = (u - 0.55) / 0.45; }
    const phase = localT * (LAYERS.length + 1);

    nodes.forEach(n => {
      let waveTarget = 0.06;
      const layerIndex = waveMode === 'backward' ? (LAYERS.length - 1 - n.layer) : n.layer;
      const lp = phase - layerIndex;
      if (waveMode && lp > 0 && lp < 1.3) waveTarget = Math.max(waveTarget, Math.sin(Math.min(lp, 1) * Math.PI) * 0.85 + 0.1);
      n.actWave += (waveTarget - n.actWave) * 0.12;

      let pointerTarget = 0;
      if (pointer.active) {
        const d = Math.hypot(n.x - pointer.x, n.y - pointer.y);
        pointerTarget = Math.max(0, 1 - d / (W * 0.18));
      }
      n.actPointer += (pointerTarget - n.actPointer) * 0.15;

      n.act = Math.max(n.actWave, n.actPointer);
      // Pointer contact always reads as "forward" (you're driving an
      // inference); otherwise colour follows whichever pass is live.
      n.colorMode = n.actPointer >= n.actWave ? 'forward' : (waveMode || 'forward');
    });

    ctx.clearRect(0, 0, W, H);

    for (let li = 0; li < LAYERS.length - 1; li++) {
      const from = byLayer(li), to = byLayer(li + 1);
      const weights = edgeWeights[li];
      from.forEach((a, i) => {
        to.forEach((b, j) => {
          const act = (a.act + b.act) / 2;
          const hot = act > 0.35;
          const wAbs = Math.abs(weights[i][j]);
          const mode = a.colorMode === 'backward' || b.colorMode === 'backward' ? 'backward' : 'forward';
          ctx.strokeStyle = hot ? (mode === 'backward' ? colAccent : colAccent2) : colRule;
          ctx.globalAlpha = hot ? Math.min(0.6, act) : 0.1 + wAbs * 0.12;
          ctx.lineWidth = hot ? 1 + wAbs * 1.3 : 0.6 + wAbs * 0.6;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        });
      });
    }
    ctx.globalAlpha = 1;

    nodes.forEach(n => {
      const r = 3 + n.act * 4.2;
      const nodeColor = n.colorMode === 'backward' ? colAccent : colAccent2;
      ctx.beginPath();
      ctx.fillStyle = n.act > 0.4 ? nodeColor : colRule;
      ctx.globalAlpha = 0.35 + n.act * 0.65;
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fill();
      if (n.act > 0.55) {
        ctx.beginPath();
        ctx.strokeStyle = nodeColor;
        ctx.globalAlpha = (n.act - 0.55) * 0.9;
        ctx.lineWidth = 1.5;
        ctx.arc(n.x, n.y, r + 3, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
    ctx.globalAlpha = 1;

    if (rdAct) {
      const outAct = byLayer(LAYERS.length - 1).map(n => n.act);
      const maxAct = outAct.length ? Math.max(...outAct) : 0;
      rdAct.textContent = (maxAct * 100).toFixed(0) + '%';
      rdConf.textContent = Math.max(0, Math.min(100, 58 + Math.sin(pulseT * 0.7) * 18 + maxAct * 22)).toFixed(0) + '%';
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

/* ── email reveal ────────────────────────────────────── */
(function mail() {
  const link = $('#mailLink'), text = $('#mailText');
  if (!link) return;
  let shown = false;
  const reveal = (e) => {
    if (!shown) {
      e?.preventDefault();
      link.href = 'mailto:' + EMAIL;
      text.textContent = EMAIL;
      shown = true;
    }
  };
  link.addEventListener('click', reveal);
  link.addEventListener('focus', reveal);
  link.addEventListener('pointerenter', reveal);
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

  const CHIPS = ['help', 'whoami', 'projects', 'skills', 'playground', 'contact', 'theme', 'clear'];
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
      write('diag 1.5, interactive résumé shell', 'dim');
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

  // This is a static multi-page site (no client-side router), so "go"
  // navigates the browser — same-page anchors just work as normal hrefs.
  const go = (url) => { close(); window.location.href = url; };

  const PROJECTS = [
    { name: 'mcp-diagnostics-server', label: 'MCP server for hardware diagnostics', page: 'projects.html#proj-mcp' },
    { name: 'lab-network-monitor', label: 'Lab network monitoring & anomaly alerting', page: 'projects.html#proj-monitoring' },
    { name: 'finalyearproject', label: 'City waste management (GPS tracking)', page: 'projects.html#proj-waste', url: 'https://github.com/ProgrammerTabish/FinalYearProject' }
  ];

  const CMD = {
    help() {
      write([
        '<span class="cmd">whoami</span>      who you are talking to',
        '<span class="cmd">now</span>         what I am doing at the moment',
        '<span class="cmd">work</span>        experience history',
        '<span class="cmd">skills</span>      the toolkit',
        '<span class="cmd">projects</span>    list featured projects',
        '<span class="cmd">open</span> &lt;n&gt;   open project number n',
        '<span class="cmd">playground</span>  jump to the live AI demos',
        '<span class="cmd">contact</span>     how to reach me',
        '<span class="cmd">cv</span>          download the CV',
        '<span class="cmd">theme</span>       switch light and dark',
        '<span class="cmd">clear</span>       wipe the screen'
      ].join('\n'));
    },
    whoami() {
      write('Shaikh Zaka Tabish, AI engineering for industrial systems.\nMSc student at OTH Amberg, one year as a working student at Nokia Nuremberg.\nI make black box systems explain themselves, to engineers and to models.');
    },
    now() {
      write('OTH Amberg       MSc Artificial Intelligence for Industrial Applications\nNokia Nuremberg  board bring up and diagnostics software, Aug 2025 to Jul 2026\nLooking for      AI/ML working student, internship and graduate roles');
    },
    work() { write('Opening the experience page.', 'dim'); go('experience.html#work'); },
    skills() {
      write('Python · JavaScript · C++ · C#\nNeural networks (from scratch) · reinforcement learning · ConvNetJS · MCP · anomaly detection\nREST · HTTP · WebSockets · network diagnostics · monitoring\nData analysis · automation · GPS &amp; geodata · OpenStreetMap · Leaflet\nAgile · Jira · Confluence · Git · Jenkins · Cursor · Copilot\nEnglish C1 · German B1');
      write('Full toolkit on the <span class="cmd">experience.html</span> page.', 'dim');
    },
    projects() {
      write(PROJECTS.map((p, i) =>
        `${String(i + 1).padStart(2, '0')}  ${p.label}  ${p.url ? `<a href="${p.url}" rel="noopener">code</a>` : ''}`
      ).join('\n'));
      write('Use <span class="cmd">open 1</span> to read the case study, or <span class="cmd">playground</span> for the live demos.', 'dim');
    },
    open(arg) {
      const n = parseInt(arg, 10);
      const hit = Number.isInteger(n) ? PROJECTS[n - 1] : PROJECTS.find(p => p.name === String(arg).toLowerCase());
      if (!hit) { write('No project by that number or name. Run <span class="cmd">projects</span> first.', 'warn'); return; }
      write(`Opening the case study for ${hit.label}.`, 'ok');
      go(hit.page);
    },
    playground() { write('Opening the playground.', 'ok'); go('playground.html'); },
    contact() {
      write(`email     <a href="mailto:${EMAIL}">${EMAIL}</a>\ngithub    <a href="https://github.com/ProgrammerTabish" rel="noopener">ProgrammerTabish</a>\nlinkedin  <a href="https://www.linkedin.com/in/zakatabish" rel="noopener">in/zakatabish</a>`);
      write('Full contact page: <span class="cmd">contact.html</span>', 'dim');
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
