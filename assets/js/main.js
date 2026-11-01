/* =========================================================
   zakatabish.online — site behaviour
   ---------------------------------------------------------
   Shared helpers ($, $$, store, fitCanvas, token, reduceMotion,
   loadScript, whenNear, loadThree, createStage) are declared at
   top level so the page scripts loaded after this file (hero3d.js,
   the playground demos) can reuse them directly.
   ========================================================= */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

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

/* ── loading on demand ───────────────────────────────
   Nothing heavy is fetched with the page. Libraries, datasets and
   3D scenes load when the part of the page that needs them comes
   near the viewport, and each script is only ever requested once. */
const loadScript = (() => {
  const cache = {};
  return src => cache[src] || (cache[src] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = resolve;
    s.onerror = () => { delete cache[src]; reject(new Error('Could not load ' + src)); };
    document.head.appendChild(s);
  }));
})();

function whenNear(el, fn, margin = '600px') {
  if (!el) return;
  if (!('IntersectionObserver' in window)) { fn(); return; }
  const io = new IntersectionObserver(entries => {
    if (entries.some(e => e.isIntersecting)) { io.disconnect(); fn(); }
  }, { rootMargin: margin });
  io.observe(el);
}

/* Runs fn once the browser is idle after load, so first paint never waits on it. */
function afterLoad(fn, timeout = 900) {
  const go = () => ('requestIdleCallback' in window) ? requestIdleCallback(fn, { timeout }) : setTimeout(fn, 60);
  document.readyState === 'complete' ? go() : window.addEventListener('load', go, { once: true });
}

const hasWebGL = (() => {
  let ok = null;
  return () => {
    if (ok !== null) return ok;
    try { const c = document.createElement('canvas'); ok = !!(c.getContext('webgl2') || c.getContext('webgl')); }
    catch { ok = false; }
    return ok;
  };
})();

/* One copy of three.js (r149) serves every 3D scene on the site,
   including the RAG demo, so it is cached after the first page. */
const loadThree = () => window.THREE ? Promise.resolve(window.THREE)
  : loadScript('assets/js/vendor/three.min.js').then(() => window.THREE);

/* ── 3D stage ────────────────────────────────────────
   A three.js renderer bound to a host element. It sizes itself with a
   ResizeObserver, caps the pixel ratio, and only runs its frame loop
   while the host is on screen and the tab is visible, so a page with
   four scenes costs about as much as the one you are looking at. */
function createStage(host, { fov = 36, near = 0.05, far = 60, onFrame, onResize } = {}) {
  const T = THREE;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
  const renderer = new T.WebGLRenderer({ antialias: dpr < 2, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.className = 'stage3d__canvas';
  host.appendChild(canvas);

  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(fov, 1, near, far);
  const st = { T, renderer, scene, camera, host, canvas, w: 1, h: 1, onScreen: false, running: false,
               pointer: { x: 0, y: 0, px: -999, py: -999, active: false }, onFrame, onResize };

  const resize = () => {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    st.w = w; st.h = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    st.onResize?.(st);
    if (st.started && !st.running) st.render(0);
  };

  let last = performance.now(), t = 0, raf = 0;
  st.render = (dt) => { st.onFrame?.(dt, t, st); renderer.render(scene, camera); };
  const loop = (now) => {
    const dt = Math.min((now - last) / 1000, 0.05); last = now; t += dt;
    st.render(dt);
    raf = requestAnimationFrame(loop);
  };
  const sync = () => {
    const want = st.started && st.onScreen && !document.hidden;
    if (want && !st.running) { st.running = true; last = performance.now(); raf = requestAnimationFrame(loop); }
    if (!want && st.running) { st.running = false; cancelAnimationFrame(raf); }
  };
  new IntersectionObserver(([e]) => { st.onScreen = e.isIntersecting; sync(); }, { rootMargin: '80px' }).observe(host);
  document.addEventListener('visibilitychange', sync);
  new ResizeObserver(resize).observe(host);

  const setPointer = (cx, cy) => {
    const r = host.getBoundingClientRect();
    st.pointer.px = cx - r.left; st.pointer.py = cy - r.top;
    st.pointer.x = (st.pointer.px / r.width) * 2 - 1;
    st.pointer.y = (st.pointer.py / r.height) * 2 - 1;
    st.pointer.active = true;
  };
  host.addEventListener('pointermove', e => setPointer(e.clientX, e.clientY));
  host.addEventListener('pointerleave', () => { st.pointer.active = false; });

  /* project a world position to host pixels, for HTML labels */
  const v = new T.Vector3();
  st.toScreen = (p) => { v.copy(p).project(camera); return { x: (v.x + 1) / 2 * st.w, y: (1 - v.y) / 2 * st.h, z: v.z }; };

  /* call once the scene is built: draws a first frame, then animates while visible */
  st.start = () => { st.started = true; resize(); st.render(0); sync(); };

  resize();
  return st;
}

/* A soft round sprite texture, shared by every glow on the site. */
let _glowTex = null;
function glowTexture() {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  _glowTex = new THREE.CanvasTexture(c);
  return _glowTex;
}

const isDark = () => document.documentElement.dataset.theme === 'dark';

/* ── scroll reveal ───────────────────────────────────
   Chapters rise in with a little 3D tilt as you reach them, so the
   page tells you one thing at a time instead of everything at once. */
(function reveal() {
  const els = $$('[data-reveal]');
  if (!els.length) return;
  if (reduceMotion || !('IntersectionObserver' in window)) { els.forEach(e => e.classList.add('is-in')); return; }
  const io = new IntersectionObserver(entries => entries.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
  }), { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  els.forEach(e => io.observe(e));
})();

/* ── 3D tilt ─────────────────────────────────────────
   Cards lean toward the pointer, with a soft highlight where it is.
   Only on a real mouse, never under reduced motion. */
(function tilt() {
  if (!finePointer || reduceMotion) return;
  $$('[data-tilt]').forEach(el => {
    const max = parseFloat(el.dataset.tilt) || 6;
    let raf = 0, tx = 0, ty = 0;
    el.addEventListener('pointermove', e => {
      const r = el.getBoundingClientRect();
      tx = (e.clientX - r.left) / r.width; ty = (e.clientY - r.top) / r.height;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        el.style.setProperty('--ry', ((tx - 0.5) * 2 * max).toFixed(2) + 'deg');
        el.style.setProperty('--rx', ((0.5 - ty) * 2 * max).toFixed(2) + 'deg');
        el.style.setProperty('--gx', (tx * 100).toFixed(1) + '%');
        el.style.setProperty('--gy', (ty * 100).toFixed(1) + '%');
        el.classList.add('is-tilting');
      });
    });
    el.addEventListener('pointerleave', () => {
      el.classList.remove('is-tilting');
      el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg');
    });
  });
})();

/* ── lightbox ────────────────────────────────────────
   <a href="big.jpg" data-lightbox data-caption="…"> opens the image in
   a native <dialog> instead of navigating away. */
(function lightbox() {
  const links = $$('a[data-lightbox]');
  if (!links.length || typeof HTMLDialogElement === 'undefined') return;
  const dlg = document.createElement('dialog');
  dlg.className = 'lightbox';
  dlg.innerHTML = '<button class="lightbox__close" type="button" aria-label="Close">×</button><figure><img alt=""><figcaption></figcaption></figure>';
  document.body.appendChild(dlg);
  const img = $('img', dlg), cap = $('figcaption', dlg);
  links.forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    img.src = a.href;
    img.alt = a.querySelector('img')?.alt || '';
    cap.innerHTML = a.dataset.caption || '';
    dlg.showModal();
  }));
  $('.lightbox__close', dlg).addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
})();

/* ── videos ──────────────────────────────────────────
   .vplayer: a muted teaser loops once it scrolls into view; pressing
   play (or a chapter) swaps in the full video with sound. Nothing but
   the poster is downloaded until then.
   video[data-autoplay]: a silent explainer that plays by itself, and
   pauses whenever it is off screen so it never costs CPU unseen. */
(function videos() {
  $$('.vplayer').forEach(box => {
    const video = $('video', box), playBtn = $('.vplayer__play', box);
    const full = box.dataset.src, teaser = box.dataset.teaser;
    const chapters = $$(`[data-video="${box.id}"] [data-t]`);
    let isFull = false;

    if (teaser && !reduceMotion) {
      whenNear(box, () => { if (!isFull) { video.src = teaser; video.play().catch(() => {}); } }, '100px');
    }
    const start = (t = 0) => {
      const seek = () => { try { video.currentTime = t; } catch {} video.play().catch(() => {}); };
      if (!isFull) {
        // switching from the teaser: wait for the full video's metadata before seeking
        isFull = true;
        box.classList.add('is-playing');
        video.loop = false; video.muted = false; video.controls = true;
        video.preload = 'auto';
        video.addEventListener('loadedmetadata', seek, { once: true });
        video.src = full;
      } else seek();
      video.focus({ preventScroll: true });
    };
    playBtn?.addEventListener('click', () => start(0));
    chapters.forEach(b => b.addEventListener('click', () => {
      start(parseFloat(b.dataset.t) || 0);
      box.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
    }));
    video.addEventListener('timeupdate', () => {
      if (!isFull || !chapters.length) return;
      let cur = chapters[0];
      chapters.forEach(b => { if (video.currentTime >= parseFloat(b.dataset.t)) cur = b; });
      chapters.forEach(b => b.classList.toggle('is-now', b === cur));
    });
  });

  $$('video[data-autoplay]').forEach(v => {
    const box = v.closest('.vportrait') || v.parentElement;
    const btn = $('.vportrait__play', box);
    if (reduceMotion) { v.removeAttribute('autoplay'); v.pause(); box.classList.add('is-paused'); }
    // A lazily loaded copy (data-src) only starts fetching when it is near.
    if (v.dataset.src) whenNear(v, () => { v.src = v.dataset.src; if (!reduceMotion) v.play().catch(() => {}); }, '300px');
    let userPaused = reduceMotion;
    new IntersectionObserver(([e]) => {
      if (!v.src && !v.currentSrc) return;
      if (e.isIntersecting && !userPaused) v.play().catch(() => {});
      else v.pause();
    }, { threshold: 0.15 }).observe(v);
    const toggle = () => {
      if (v.paused) { userPaused = false; if (!v.src && v.dataset.src) v.src = v.dataset.src; v.play().catch(() => {}); }
      else { userPaused = true; v.pause(); }
    };
    v.addEventListener('play', () => box.classList.remove('is-paused'));
    v.addEventListener('pause', () => box.classList.add('is-paused'));
    v.addEventListener('click', toggle);
    btn?.addEventListener('click', toggle);
  });
})();

/* ── skill sphere ────────────────────────────────────
   The toolkit as a sphere of tags (CSS 3D, no WebGL): each tag sits on
   a Fibonacci point, the sphere turns slowly and leans toward the
   pointer, and nearer tags are larger and brighter. It only animates
   while it is on screen. The plain grouped list sits underneath it. */
(function orb() {
  const box = $('.orb');
  if (!box) return;
  const items = $$('.orb__tag', box);
  const n = items.length;
  const pts = items.map((_, i) => {
    const y = 1 - (i + 0.5) * 2 / n, r = Math.sqrt(1 - y * y), a = i * Math.PI * (3 - Math.sqrt(5));
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  });
  let rx = 0.3, ry = 0, vx = 0.0016, vy = 0.0042, raf = 0, on = false, R = 150;
  const fit = () => { R = box.clientWidth * (box.clientWidth < 420 ? 0.31 : 0.4); };
  fit();
  new ResizeObserver(fit).observe(box);
  box.addEventListener('pointermove', e => {
    const r = box.getBoundingClientRect();
    vy = ((e.clientX - r.left) / r.width - 0.5) * 0.02;
    vx = -((e.clientY - r.top) / r.height - 0.5) * 0.014;
  });
  box.addEventListener('pointerleave', () => { vx = 0.0016; vy = 0.0042; });
  const draw = () => {
    if (!reduceMotion) { rx += vx; ry += vy; }
    const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry);
    pts.forEach(([x, y, z], i) => {
      const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
      const y2 = y * cx - z1 * sx, z2 = y * sx + z1 * cx;
      const k = (z2 + 1.6) / 2.6;
      const el = items[i];
      el.style.transform = `translate(-50%, -50%) translate3d(${(x1 * R).toFixed(1)}px, ${(y2 * R).toFixed(1)}px, 0) scale(${(0.55 + k * 0.55).toFixed(3)})`;
      el.style.opacity = (0.1 + k * k * 0.9).toFixed(2);
      el.style.zIndex = String(Math.round(k * 100));
    });
    if (on && !reduceMotion) raf = requestAnimationFrame(draw);
  };
  new IntersectionObserver(([e]) => {
    on = e.isIntersecting;
    cancelAnimationFrame(raf);
    draw();
  }).observe(box);
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
    { name: 'private-rag-assistant', label: 'Private RAG assistant for banking compliance', page: 'projects.html#proj-rag', url: 'https://github.com/ProgrammerTabish/private-rag-assistant' },
    { name: 'cone-crimping-machine', label: 'Automatic cone crimping machine (Arduino, built in a garage)', page: 'projects.html#proj-crimp' },
    { name: 'mcp-diagnostics-server', label: 'MCP server for hardware diagnostics', page: 'projects.html#proj-mcp' },
    { name: 'lab-network-monitor', label: 'Lab network monitoring & anomaly alerting', page: 'projects.html#proj-monitoring' },
    { name: 'finalyearproject', label: 'City waste management (GPS tracking)', page: 'projects.html#proj-waste', url: 'https://github.com/ProgrammerTabish/FinalYearProject' },
    { name: 'grossry', label: 'Großry: student collective purchasing prototype', page: 'projects.html#proj-grossry' }
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
        '<span class="cmd">theme</span>       switch light and dark',
        '<span class="cmd">clear</span>       wipe the screen'
      ].join('\n'));
    },
    whoami() {
      write('Shaikh Zaka Tabish, AI engineering for industrial systems.\nMSc student at OTH Amberg, one year as a working student at Nokia Nuremberg.\nI make black box systems explain themselves, to engineers and to models.');
    },
    now() {
      write('OTH Amberg       MSc Artificial Intelligence for Industrial Applications\nLatest           Innovation Challenge 2026, private RAG assistant for Specific-Group (Oct 2026)\nNokia Nuremberg  board bring up and diagnostics software, Aug 2025 to Jul 2026\nLooking for      AI/ML working student, internship and graduate roles');
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
