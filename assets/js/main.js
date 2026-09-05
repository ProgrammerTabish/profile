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

/* ── hero neural network ─────────────────────────────
   Not a decorative loop: this is a real 5→7→7→4 network doing
   real arithmetic every frame. The pointer (or a slow drift when
   you aren't touching it) is the input vector, a forward pass runs
   through the chosen activation function, cross-entropy against a
   rotating target class gives real gradients, and a small SGD step
   is actually applied — so the loss readout genuinely falls and the
   confidence genuinely climbs. The activation function cycles, and
   the little curve drawn above each hidden layer is that function
   plotted from its own definition, not an illustration of one.
   ─────────────────────────────────────────────────── */
(function heroNet() {
  const cv = $('#heroNet');
  if (!cv) return;

  const rdAct = $('#rdAct'), rdConf = $('#rdConf'), rdLayers = $('#rdLayers'),
        rdLoss = $('#rdLoss'), rdState = $('#rdState'), led = $('.led'),
        quoteEl = $('#netQuote');

  /* ── activation functions ──────────────────────────
     f is applied to the pre-activation z; df takes both z and the
     already-computed a = f(z), since tanh' and sigmoid' are cheaper
     to express in terms of a. */
  const ACTS = [
    {
      name: 'ReLU',
      note: 'passes what is positive, silences the rest',
      f: z => (z > 0 ? z : 0),
      df: z => (z > 0 ? 1 : 0)
    },
    {
      name: 'tanh',
      note: 'squashes every signal into −1 … 1',
      f: z => Math.tanh(z),
      df: (z, a) => 1 - a * a
    },
    {
      name: 'sigmoid',
      note: 'turns any number into a probability',
      f: z => 1 / (1 + Math.exp(-z)),
      df: (z, a) => a * (1 - a)
    },
    {
      name: 'leaky ReLU',
      note: 'never lets a neuron go fully dark',
      f: z => (z > 0 ? z : 0.1 * z),
      df: z => (z > 0 ? 1 : 0.1)
    },
    {
      name: 'GELU',
      note: 'a smooth ReLU, the one transformers use',
      f: z => 0.5 * z * (1 + Math.tanh(0.7978845608 * (z + 0.044715 * z * z * z))),
      df: z => {
        const h = 0.001;
        const g = x => 0.5 * x * (1 + Math.tanh(0.7978845608 * (x + 0.044715 * x * x * x)));
        return (g(z + h) - g(z - h)) / (2 * h);
      }
    }
  ];
  let actIdx = 0;
  const act = () => ACTS[actIdx];

  const QUOTES = [
    'Learning is just pattern adaptation, written in arithmetic.',
    'A weight is the memory of every mistake it has already made.',
    'No single neuron knows what the network knows.',
    'Intelligence here is a curve, bent until it fits the world.',
    'Every gradient is a small, precise confession of being wrong.',
    'Understanding is compression you can run backwards.',
    'The model does not think. It leans, very carefully, in a direction.',
    'Nothing inside a layer is intelligent. Everything between them is.',
    'Given enough examples, arithmetic starts to look like intuition.',
    'The network never learns the answer, only how wrong it just was.'
  ];
  let quoteIdx = Math.floor(Math.random() * QUOTES.length);

  /* Layer sizes, and how each layer is labelled under the diagram. */
  const LAYERS = [5, 7, 7, 4];
  const SHAPE = LAYERS.join('·');

  let W = 0, H = 0, ctx = null;
  let nodes = [];
  let weights = [], biases = [];     // weights[l][i][j]: unit i of layer l → unit j of layer l+1
  let zs = [], as = [], deltas = []; // per-layer pre-activations, activations, gradients
  let colAccent, colAccent2, colRule, colMute, colInk;
  let started = performance.now(), locked = false, pulseT = 0;
  let target = 0, lossEMA = null, stepCount = 0;
  const pointer = { x: -999, y: -999, active: false };

  const readColors = () => {
    colAccent = token('--accent') || '#5645D6';
    colAccent2 = token('--accent2') || '#0C8C86';
    colRule = token('--rule') || '#DBDEEA';
    colMute = token('--mute') || '#5B6076';
    colInk = token('--ink') || '#12131C';
  };

  const normalize = arr => {
    const m = Math.max(1e-6, ...arr.map(Math.abs));
    return arr.map(v => Math.abs(v) / m);
  };

  /* Kaiming-ish init, so the forward pass doesn't saturate or die
     immediately whichever activation is currently selected. */
  function initWeights() {
    weights = []; biases = [];
    for (let l = 0; l < LAYERS.length - 1; l++) {
      const scale = Math.sqrt(2 / LAYERS[l]);
      const mat = [];
      for (let i = 0; i < LAYERS[l]; i++) {
        const row = [];
        for (let j = 0; j < LAYERS[l + 1]; j++) row.push((Math.random() * 2 - 1) * scale);
        mat.push(row);
      }
      weights.push(mat);
      biases.push(new Array(LAYERS[l + 1]).fill(0));
    }
    zs = LAYERS.map(n => new Array(n).fill(0));
    as = LAYERS.map(n => new Array(n).fill(0));
    deltas = LAYERS.map(n => new Array(n).fill(0));
    lossEMA = null; stepCount = 0;
  }

  function layout() {
    nodes = [];
    // Asymmetric: the output column carries its softmax percentage to the
    // right of each node, so it needs more room on that side than the
    // input column does on its own.
    const padL = W * 0.09, padR = W * 0.17;
    const topPad = H * 0.24;               // room for the activation curves
    const botPad = H * 0.2;                // room for the layer captions
    const innerW = W - padL - padR;
    LAYERS.forEach((count, li) => {
      const x = padL + (innerW * li) / (LAYERS.length - 1);
      const usable = H - topPad - botPad;
      const gap = usable / Math.max(1, count - 1);
      for (let i = 0; i < count; i++) {
        const y = count === 1 ? topPad + usable / 2 : topPad + gap * i;
        nodes.push({ x, y, layer: li, idx: i, act: 0.06, gate: 0, glow: 0, colorMode: 'forward' });
      }
    });
    if (rdLayers) rdLayers.textContent = SHAPE;
  }

  const size = () => { const r = fitCanvas(cv, 16 / 9); ctx = r.ctx; W = r.w; H = r.h; layout(); };
  readColors(); initWeights(); size();
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

  /* ── the actual maths ──────────────────────────────── */

  /* The input vector. With the pointer down it's a real function of
     where you are on the canvas; otherwise it drifts on its own so
     the network still has something to chew on. */
  function readInput(t) {
    const px = pointer.active ? pointer.x / W : 0.5 + Math.sin(t * 0.31) * 0.34;
    const py = pointer.active ? pointer.y / H : 0.5 + Math.cos(t * 0.23) * 0.3;
    const v = [];
    for (let i = 0; i < LAYERS[0]; i++) {
      const phase = (i / LAYERS[0]) * Math.PI * 2;
      v.push(Math.sin(px * 3.1 + phase) * 0.9 + Math.cos(py * 2.7 - phase) * 0.6);
    }
    return v;
  }

  function forward(x) {
    as[0] = x.slice(); zs[0] = x.slice();
    const A = act();
    for (let l = 0; l < LAYERS.length - 1; l++) {
      const last = l === LAYERS.length - 2;
      const z = new Array(LAYERS[l + 1]).fill(0);
      for (let j = 0; j < LAYERS[l + 1]; j++) {
        let s = biases[l][j];
        for (let i = 0; i < LAYERS[l]; i++) s += as[l][i] * weights[l][i][j];
        z[j] = s;
      }
      zs[l + 1] = z;
      // Hidden layers use the selected activation; the output layer is
      // always softmax, which is what makes "confidence" a real number.
      as[l + 1] = last ? softmax(z) : z.map(A.f);
    }
    return as[LAYERS.length - 1];
  }

  function softmax(z) {
    const m = Math.max(...z);
    const e = z.map(v => Math.exp(v - m));
    const s = e.reduce((a, b) => a + b, 0) || 1;
    return e.map(v => v / s);
  }

  /* Cross-entropy against the current target class, then plain SGD.
     Softmax + cross-entropy collapses to (a − onehot) at the output,
     which is why there's no separate softmax derivative here. */
  function backward(targetIdx, lr) {
    const L = LAYERS.length - 1;
    const A = act();
    const out = as[L];
    deltas[L] = out.map((v, k) => v - (k === targetIdx ? 1 : 0));

    for (let l = L - 1; l >= 1; l--) {
      const d = new Array(LAYERS[l]).fill(0);
      for (let i = 0; i < LAYERS[l]; i++) {
        let s = 0;
        for (let j = 0; j < LAYERS[l + 1]; j++) s += weights[l][i][j] * deltas[l + 1][j];
        d[i] = s * A.df(zs[l][i], as[l][i]);
      }
      deltas[l] = d;
    }

    for (let l = 0; l < L; l++) {
      for (let j = 0; j < LAYERS[l + 1]; j++) {
        const dj = deltas[l + 1][j];
        for (let i = 0; i < LAYERS[l]; i++) {
          weights[l][i][j] -= lr * as[l][i] * dj;
          // Light weight decay keeps a long-running page from drifting
          // into ever-larger weights and saturating the activation.
          weights[l][i][j] *= 0.9999;
        }
        biases[l][j] -= lr * dj;
      }
    }
    return -Math.log(Math.max(1e-9, out[targetIdx]));
  }

  /* ── activation curve glyph ────────────────────────── */
  function drawActCurve(cx, cy, w, h, alpha) {
    const A = act();
    const xs = [];
    for (let i = 0; i <= 28; i++) xs.push(-3 + (6 * i) / 28);
    const ys = xs.map(A.f);
    const lo = Math.min(...ys), hi = Math.max(...ys);
    const span = Math.max(1e-6, hi - lo);

    ctx.save();
    ctx.globalAlpha = alpha * 0.5;
    ctx.strokeStyle = colRule;
    ctx.lineWidth = 1;
    ctx.beginPath();                                  // baseline at f = 0 (or the floor)
    const zeroY = cy + h / 2 - ((0 - lo) / span) * h;
    const clampY = Math.max(cy - h / 2, Math.min(cy + h / 2, zeroY));
    ctx.moveTo(cx - w / 2, clampY); ctx.lineTo(cx + w / 2, clampY); ctx.stroke();

    ctx.globalAlpha = alpha;
    ctx.strokeStyle = colAccent2;
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    xs.forEach((x, i) => {
      const px = cx - w / 2 + ((x + 3) / 6) * w;
      const py = cy + h / 2 - ((ys[i] - lo) / span) * h;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    });
    ctx.stroke();
    ctx.restore();
  }

  function drawCaption(x, y, main, sub, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = colInk;
    ctx.font = '500 10px ' + (getComputedStyle(document.documentElement).getPropertyValue('--f-mono') || 'monospace');
    ctx.fillText(main, x, y);
    if (sub) {
      ctx.globalAlpha = alpha * 0.72;
      ctx.fillStyle = colMute;
      ctx.font = '400 9px ' + (getComputedStyle(document.documentElement).getPropertyValue('--f-mono') || 'monospace');
      ctx.fillText(sub, x, y + 12);
    }
    ctx.restore();
  }

  /* ── frame ─────────────────────────────────────────── */
  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05); last = now;
    pulseT += dt * (reduceMotion ? 0.35 : 1);

    // One cycle = forward pass, pause, backward pass. The weight update
    // is applied once per cycle, at the moment the backward sweep lands.
    const cycle = 3.6;
    const prevCycle = Math.floor((pulseT - dt * (reduceMotion ? 0.35 : 1)) / cycle);
    const thisCycle = Math.floor(pulseT / cycle);
    const u = (pulseT % cycle) / cycle;

    let waveMode = null, localT = 0;
    if (u < 0.46) { waveMode = 'forward'; localT = u / 0.46; }
    else if (u < 0.52) { waveMode = null; }
    else { waveMode = 'backward'; localT = (u - 0.52) / 0.48; }
    const phase = localT * (LAYERS.length + 1);

    // New cycle: rotate the target class, and every few cycles rotate
    // the activation function too (which resets the weights, since the
    // old ones were fitted under a different non-linearity).
    if (thisCycle !== prevCycle) {
      target = (target + 1) % LAYERS[LAYERS.length - 1];
      if (thisCycle % 4 === 0) {
        actIdx = (actIdx + 1) % ACTS.length;
        initWeights();
      }
      if (quoteEl) {
        quoteIdx = (quoteIdx + 1) % QUOTES.length;
        quoteEl.textContent = QUOTES[quoteIdx];
      }
    }

    const out = forward(readInput(pulseT));
    const conf = Math.max(...out);
    const loss = -Math.log(Math.max(1e-9, out[target]));
    lossEMA = lossEMA === null ? loss : lossEMA * 0.96 + loss * 0.04;

    // The weight update fires once per cycle, as the gradient sweep
    // reaches the input side — so what you see is what just happened.
    if (waveMode === 'backward' && localT > 0.9 && stepCount < thisCycle + 1) {
      stepCount = thisCycle + 1;
      backward(target, 0.06);
    } else {
      backward(target, 0);   // gradients only, no step, for the display
    }

    const actNorm = LAYERS.map((_, l) => normalize(as[l]));
    const gradNorm = LAYERS.map((_, l) => normalize(deltas[l] || []));

    nodes.forEach(n => {
      const layerIndex = waveMode === 'backward' ? (LAYERS.length - 1 - n.layer) : n.layer;
      const lp = phase - layerIndex;
      let gateTarget = 0;
      if (waveMode && lp > 0 && lp < 1.3) gateTarget = Math.sin(Math.min(lp, 1) * Math.PI);
      n.gate += (gateTarget - n.gate) * 0.16;

      let glowTarget = 0;
      if (pointer.active) {
        const d = Math.hypot(n.x - pointer.x, n.y - pointer.y);
        glowTarget = Math.max(0, 1 - d / (W * 0.18));
      }
      n.glow += (glowTarget - n.glow) * 0.15;

      const src = waveMode === 'backward' ? gradNorm : actNorm;
      const real = (src[n.layer] && src[n.layer][n.idx]) || 0;
      n.act = Math.max(0.06, real * n.gate, n.glow);
      n.colorMode = n.glow >= real * n.gate ? 'forward' : (waveMode || 'forward');
    });

    ctx.clearRect(0, 0, W, H);

    /* edges — thickness from the real |weight|, colour from the pass */
    for (let li = 0; li < LAYERS.length - 1; li++) {
      const from = byLayer(li), to = byLayer(li + 1);
      let maxW = 1e-6;
      for (let i = 0; i < LAYERS[li]; i++)
        for (let j = 0; j < LAYERS[li + 1]; j++) maxW = Math.max(maxW, Math.abs(weights[li][i][j]));
      from.forEach((a, i) => {
        to.forEach((b, j) => {
          const flow = (a.act + b.act) / 2;
          const hot = flow > 0.3;
          const wAbs = Math.abs(weights[li][i][j]) / maxW;
          const mode = a.colorMode === 'backward' || b.colorMode === 'backward' ? 'backward' : 'forward';
          ctx.strokeStyle = hot ? (mode === 'backward' ? colAccent : colAccent2) : colRule;
          ctx.globalAlpha = hot ? Math.min(0.62, flow * wAbs + 0.12) : 0.08 + wAbs * 0.14;
          ctx.lineWidth = hot ? 0.8 + wAbs * 1.8 : 0.5 + wAbs * 0.7;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        });
      });
    }
    ctx.globalAlpha = 1;

    /* nodes */
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

    /* the winning output class gets its index drawn in it */
    const outNodes = byLayer(LAYERS.length - 1);
    let topK = 0;
    for (let k = 1; k < out.length; k++) if (out[k] > out[topK]) topK = k;
    outNodes.forEach((n, k) => {
      ctx.save();
      ctx.globalAlpha = k === topK ? 0.95 : 0.4;
      ctx.fillStyle = colMute;
      ctx.font = '400 8px ' + (getComputedStyle(document.documentElement).getPropertyValue('--f-mono') || 'monospace');
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(`${(out[k] * 100).toFixed(0)}%`, n.x + 11, n.y);
      ctx.restore();
    });

    /* activation curves above the two hidden layers */
    const A = act();
    const cw = Math.min(46, W * 0.09), ch = cw * 0.5;
    [1, 2].forEach(li => {
      const col = byLayer(li);
      const cx = col[0].x;
      drawActCurve(cx, H * 0.11, cw, ch, 0.9);
      drawCaption(cx, H * 0.11 + ch / 2 + 5, A.name, null, 0.85);
    });

    /* layer captions along the bottom */
    const capY = H - H * 0.14;
    drawCaption(byLayer(0)[0].x, capY, `input ${LAYERS[0]}`, 'your pointer', 0.9);
    drawCaption(byLayer(1)[0].x, capY, `dense ${LAYERS[1]}`, 'hidden', 0.9);
    drawCaption(byLayer(2)[0].x, capY, `dense ${LAYERS[2]}`, 'hidden', 0.9);
    drawCaption(byLayer(3)[0].x, capY, `softmax ${LAYERS[3]}`, 'output', 0.9);

    /* readouts */
    if (rdAct) rdAct.textContent = A.name;
    if (rdConf) rdConf.textContent = (conf * 100).toFixed(0) + '%';
    if (rdLoss) rdLoss.textContent = lossEMA.toFixed(3);

    if (!locked && now - started > 1600) {
      locked = true;
      led?.setAttribute('data-state', 'lock');
    }
    if (rdState) {
      rdState.textContent = !locked ? 'booting'
        : waveMode === 'forward' ? 'forward pass'
        : waveMode === 'backward' ? 'backprop'
        : 'weights updated';
    }
    requestAnimationFrame(frame);
  }
  if (quoteEl) quoteEl.textContent = QUOTES[quoteIdx];
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
        '<span class="cmd">certs</span>       certificates and references',
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
    certs() {
      write([
        'Werkstudentenzeugnis   Nokia Solutions and Networks, Jul 2026',
        'Work experience        Integrated Computer Solutions, Apr 2025',
        'B.Tech CSE             DBATU, First Class with Distinction, CGPA 7.51',
        'Bachelor thesis        City Waste Management System Using Van Tracking',
        'IELTS Academic         overall 7.5, CEFR C1',
        'Goethe A2              74/100 · Goethe B1 Sprechen 65/100'
      ].join('\n'));
      write('All of them are readable in full on the experience page.', 'dim');
      go('experience.html#credentials');
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
