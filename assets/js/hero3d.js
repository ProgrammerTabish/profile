/* =========================================================
   Hero neural network, in 3D
   ---------------------------------------------------------
   Not a decorative loop: a real 5→7→7→4 network doing real
   arithmetic every frame. The pointer (or a slow drift when you
   aren't touching it) is the input vector, a forward pass runs
   through the chosen activation function, cross-entropy against a
   rotating target class gives real gradients, and a small SGD step
   is applied once per cycle, so the loss readout genuinely falls.

   Each layer is a ring of neurons in 3D space. Edge brightness is
   the real |weight|, the pulses travelling along them are the
   forward pass (cyan) and the gradient flowing back (indigo), and
   the curve floating over each hidden ring is the current
   activation function plotted from its own definition.

   three.js is fetched after the page has painted; until then (and
   if WebGL is unavailable) the static SVG poster stays in place.
   ========================================================= */
(function heroNet3D() {
  const host = $('#heroNet');
  if (!host) return;

  const rdAct = $('#rdAct'), rdConf = $('#rdConf'), rdLayers = $('#rdLayers'),
        rdLoss = $('#rdLoss'), rdState = $('#rdState'), led = $('.led', host.parentElement);

  /* ── the maths (unchanged from the 2D version) ─────── */
  const ACTS = [
    { name: 'ReLU',       f: z => (z > 0 ? z : 0),            df: z => (z > 0 ? 1 : 0) },
    { name: 'tanh',       f: z => Math.tanh(z),               df: (z, a) => 1 - a * a },
    { name: 'sigmoid',    f: z => 1 / (1 + Math.exp(-z)),     df: (z, a) => a * (1 - a) },
    { name: 'leaky ReLU', f: z => (z > 0 ? z : 0.1 * z),      df: z => (z > 0 ? 1 : 0.1) },
    { name: 'GELU',
      f: z => 0.5 * z * (1 + Math.tanh(0.7978845608 * (z + 0.044715 * z * z * z))),
      df: z => {
        const h = 0.001, g = x => 0.5 * x * (1 + Math.tanh(0.7978845608 * (x + 0.044715 * x * x * x)));
        return (g(z + h) - g(z - h)) / (2 * h);
      } }
  ];
  let actIdx = 0;
  const act = () => ACTS[actIdx];

  const LAYERS = [5, 7, 7, 4];
  const L = LAYERS.length - 1;
  let weights = [], biases = [], zs = [], as = [], deltas = [];
  let target = 0, lossEMA = null, stepCount = 0;

  function initWeights() {
    weights = []; biases = [];
    for (let l = 0; l < L; l++) {
      const scale = Math.sqrt(2 / LAYERS[l]);
      weights.push(Array.from({ length: LAYERS[l] }, () =>
        Array.from({ length: LAYERS[l + 1] }, () => (Math.random() * 2 - 1) * scale)));
      biases.push(new Array(LAYERS[l + 1]).fill(0));
    }
    zs = LAYERS.map(n => new Array(n).fill(0));
    as = LAYERS.map(n => new Array(n).fill(0));
    deltas = LAYERS.map(n => new Array(n).fill(0));
    lossEMA = null; stepCount = 0;
  }
  const softmax = z => { const m = Math.max(...z); const e = z.map(v => Math.exp(v - m)); const s = e.reduce((a, b) => a + b, 0) || 1; return e.map(v => v / s); };
  const normalize = arr => { const m = Math.max(1e-6, ...arr.map(Math.abs)); return arr.map(v => Math.abs(v) / m); };

  function forward(x) {
    as[0] = x.slice(); zs[0] = x.slice();
    const A = act();
    for (let l = 0; l < L; l++) {
      const z = new Array(LAYERS[l + 1]).fill(0);
      for (let j = 0; j < LAYERS[l + 1]; j++) {
        let s = biases[l][j];
        for (let i = 0; i < LAYERS[l]; i++) s += as[l][i] * weights[l][i][j];
        z[j] = s;
      }
      zs[l + 1] = z;
      as[l + 1] = l === L - 1 ? softmax(z) : z.map(A.f);   // softmax output makes "confidence" real
    }
    return as[L];
  }

  /* Softmax + cross-entropy collapses to (a − onehot) at the output. */
  function backward(targetIdx, lr) {
    const A = act(), out = as[L];
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
    if (lr > 0) {
      for (let l = 0; l < L; l++) for (let j = 0; j < LAYERS[l + 1]; j++) {
        const dj = deltas[l + 1][j];
        for (let i = 0; i < LAYERS[l]; i++) {
          weights[l][i][j] -= lr * as[l][i] * dj;
          weights[l][i][j] *= 0.9999;          // light decay: a long-open tab never saturates
        }
        biases[l][j] -= lr * dj;
      }
    }
  }

  const pointer = { x: 0.5, y: 0.5, active: false };
  function readInput(t) {
    const px = pointer.active ? pointer.x : 0.5 + Math.sin(t * 0.31) * 0.34;
    const py = pointer.active ? pointer.y : 0.5 + Math.cos(t * 0.23) * 0.3;
    const v = [];
    for (let i = 0; i < LAYERS[0]; i++) {
      const phase = (i / LAYERS[0]) * Math.PI * 2;
      v.push(Math.sin(px * 3.1 + phase) * 0.9 + Math.cos(py * 2.7 - phase) * 0.6);
    }
    return v;
  }

  initWeights();
  if (rdLayers) rdLayers.textContent = LAYERS.join('·');

  /* ── 3D ─────────────────────────────────────────────── */
  function build() {
    if (!hasWebGL()) return;
    const st = createStage(host, { fov: 34, onFrame: frame, onResize: fit });
    const { T, scene, camera } = st;
    const root = new T.Group();
    scene.add(root);

    // layer rings: each layer's neurons sit on a circle in the y–z plane
    const nodes = [];
    const X0 = -2.1, DX = 1.4;
    LAYERS.forEach((count, li) => {
      const r = 0.34 + count * 0.1;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + li * 0.45;
        nodes.push({ layer: li, idx: i, pos: new T.Vector3(X0 + li * DX, Math.sin(a) * r, Math.cos(a) * r),
                     act: 0.06, gate: 0, glow: 0, mode: 'forward' });
      }
    });
    const byLayer = li => nodes.filter(n => n.layer === li);

    const sphereGeo = new T.SphereGeometry(0.07, 18, 14);
    nodes.forEach(n => {
      n.mesh = new T.Mesh(sphereGeo, new T.MeshBasicMaterial({ color: 0xffffff }));
      n.mesh.position.copy(n.pos);
      n.halo = new T.Sprite(new T.SpriteMaterial({ map: glowTexture(), transparent: true, depthWrite: false }));
      n.halo.position.copy(n.pos);
      root.add(n.mesh, n.halo);
    });

    // edges, one segment per weight, coloured per vertex (RGBA, so alpha works)
    const edges = [];
    for (let li = 0; li < L; li++) byLayer(li).forEach(a => byLayer(li + 1).forEach(b => edges.push({ li, a, b })));
    const ePos = new Float32Array(edges.length * 6), eCol = new Float32Array(edges.length * 8);
    edges.forEach((e, k) => { e.a.pos.toArray(ePos, k * 6); e.b.pos.toArray(ePos, k * 6 + 3); });
    const eGeo = new T.BufferGeometry();
    eGeo.setAttribute('position', new T.BufferAttribute(ePos, 3));
    eGeo.setAttribute('color', new T.BufferAttribute(eCol, 4));
    const eMat = new T.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
    root.add(new T.LineSegments(eGeo, eMat));

    // pulses: one point per edge, travelling with the wave
    const pPos = new Float32Array(edges.length * 3), pCol = new Float32Array(edges.length * 4);
    const pGeo = new T.BufferGeometry();
    pGeo.setAttribute('position', new T.BufferAttribute(pPos, 3));
    pGeo.setAttribute('color', new T.BufferAttribute(pCol, 4));
    const pMat = new T.PointsMaterial({ size: 0.16, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false });
    root.add(new T.Points(pGeo, pMat));

    // activation curves floating above the two hidden rings
    const curves = [1, 2].map(li => {
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(new Float32Array(29 * 3), 3));
      const line = new T.Line(g, new T.LineBasicMaterial({ transparent: true }));
      line.position.set(X0 + li * DX, 1.38, 0);
      root.add(line);
      return line;
    });
    function drawCurves() {
      const A = act(), xs = [], ys = [];
      for (let i = 0; i <= 28; i++) { xs.push(-3 + 6 * i / 28); ys.push(A.f(xs[i])); }
      const lo = Math.min(...ys), hi = Math.max(...ys), span = Math.max(1e-6, hi - lo);
      curves.forEach(line => {
        const arr = line.geometry.attributes.position.array;
        xs.forEach((x, i) => { arr[i * 3] = x / 3 * 0.42; arr[i * 3 + 1] = ((ys[i] - lo) / span) * 0.32; arr[i * 3 + 2] = 0; });
        line.geometry.attributes.position.needsUpdate = true;
      });
    }
    drawCurves();

    // HTML labels that follow their 3D anchors
    const labelBox = document.createElement('div');
    labelBox.className = 'net3d__labels';
    labelBox.setAttribute('aria-hidden', 'true');
    host.appendChild(labelBox);
    const mkLabel = (cls, text) => { const s = document.createElement('span'); s.className = cls; s.textContent = text; labelBox.appendChild(s); return s; };
    const capY = -1.25;
    const caps = [['input 5', 'your pointer'], ['dense 7', 'hidden'], ['dense 7', 'hidden'], ['softmax 4', 'output']]
      .map(([a, b], li) => ({ el: mkLabel('net3d__cap', ''), at: new T.Vector3(X0 + li * DX, capY, 0), a, b }));
    caps.forEach(c => { c.el.innerHTML = `${c.a}<small>${c.b}</small>`; });
    const actLabels = [1, 2].map(li => ({ el: mkLabel('net3d__act', ''), at: new T.Vector3(X0 + li * DX, 1.85, 0) }));
    const outLabels = byLayer(L).map(n => ({ el: mkLabel('net3d__pct', ''), n }));

    let C = {};
    const readColors = () => {
      const c = s => new T.Color(token(s) || '#888');
      C = { a1: c('--accent'), a2: c('--accent2'), rule: c('--rule'), mute: c('--mute'), dark: isDark() };
      const blend = C.dark ? T.AdditiveBlending : T.NormalBlending;
      [pMat].concat(nodes.map(n => n.halo.material)).forEach(m => { m.blending = blend; m.needsUpdate = true; });
      curves.forEach(l => l.material.color.copy(C.a2));
    };
    readColors();
    window.addEventListener('themechange', readColors);

    function fit(s) {
      // pull the camera back on narrow, tall hosts so all four rings fit
      const dist = 5.5 * Math.max(1, 1.55 / (s.w / s.h));
      s.camera.position.set(0, 0.35, dist);
      s.camera.lookAt(0, 0.05, 0);
    }

    // the pointer is the input vector
    host.addEventListener('pointermove', () => {
      pointer.x = Math.min(1, Math.max(0, st.pointer.px / st.w));
      pointer.y = Math.min(1, Math.max(0, st.pointer.py / st.h));
      pointer.active = true;
    });
    host.addEventListener('pointerleave', () => { pointer.active = false; });

    let pulseT = 0, rotY = -0.55, rotX = 0.12, locked = false;
    const started = performance.now();
    const tmp = new T.Color();

    function frame(dt) {
      const speed = reduceMotion ? 0.35 : 1;
      const prevT = pulseT;
      pulseT += dt * speed;

      const cycle = 3.6;
      const prevCycle = Math.floor(prevT / cycle), thisCycle = Math.floor(pulseT / cycle);
      const u = (pulseT % cycle) / cycle;
      let waveMode = null, localT = 0;
      if (u < 0.46) { waveMode = 'forward'; localT = u / 0.46; }
      else if (u >= 0.52) { waveMode = 'backward'; localT = (u - 0.52) / 0.48; }
      const phase = localT * (LAYERS.length + 1);

      if (thisCycle !== prevCycle) {
        target = (target + 1) % LAYERS[L];
        if (thisCycle % 4 === 0) { actIdx = (actIdx + 1) % ACTS.length; initWeights(); drawCurves(); }
      }

      const out = forward(readInput(pulseT));
      const conf = Math.max(...out);
      const loss = -Math.log(Math.max(1e-9, out[target]));
      lossEMA = lossEMA === null ? loss : lossEMA * 0.96 + loss * 0.04;
      if (waveMode === 'backward' && localT > 0.9 && stepCount < thisCycle + 1) { stepCount = thisCycle + 1; backward(target, 0.06); }
      else backward(target, 0);

      const actNorm = LAYERS.map((_, l) => normalize(as[l]));
      const gradNorm = LAYERS.map((_, l) => normalize(deltas[l] || []));

      // gentle orbit, leaning toward the pointer
      const tgtY = -0.55 + (pointer.active ? (pointer.x - 0.5) * 0.7 : Math.sin(pulseT * 0.16) * 0.22);
      const tgtX = 0.12 + (pointer.active ? (pointer.y - 0.5) * 0.35 : Math.cos(pulseT * 0.13) * 0.06);
      rotY += (tgtY - rotY) * 0.04; rotX += (tgtX - rotX) * 0.04;
      root.rotation.set(rotX, rotY, 0);
      root.updateMatrixWorld();

      // node state: the wave gate, plus a glow where the pointer is
      const wp = new T.Vector3();
      nodes.forEach(n => {
        const layerIndex = waveMode === 'backward' ? (L - n.layer) : n.layer;
        const lp = phase - layerIndex;
        const gateTarget = waveMode && lp > 0 && lp < 1.3 ? Math.sin(Math.min(lp, 1) * Math.PI) : 0;
        n.gate += (gateTarget - n.gate) * 0.16;
        wp.copy(n.pos).applyMatrix4(root.matrixWorld);
        n.screen = st.toScreen(wp);
        let glowTarget = 0;
        if (st.pointer.active) glowTarget = Math.max(0, 1 - Math.hypot(n.screen.x - st.pointer.px, n.screen.y - st.pointer.py) / (st.w * 0.16));
        n.glow += (glowTarget - n.glow) * 0.15;
        const src = waveMode === 'backward' ? gradNorm : actNorm;
        const real = (src[n.layer] && src[n.layer][n.idx]) || 0;
        n.act = Math.max(0.06, real * n.gate, n.glow);
        n.mode = n.glow >= real * n.gate ? 'forward' : (waveMode || 'forward');

        const col = n.act > 0.35 ? (n.mode === 'backward' ? C.a1 : C.a2) : C.rule;
        n.mesh.material.color.copy(tmp.copy(C.dark ? C.mute : C.rule).lerp(col, Math.min(1, n.act * 1.4)));
        n.mesh.scale.setScalar(0.8 + n.act * 0.9);
        n.halo.material.color.copy(n.mode === 'backward' ? C.a1 : C.a2);
        n.halo.material.opacity = Math.max(0, n.act - 0.2) * (C.dark ? 0.95 : 0.5);
        n.halo.scale.setScalar(0.35 + n.act * 0.55);
      });

      // edges and pulses
      let maxW = [1e-6, 1e-6, 1e-6];
      edges.forEach(e => { maxW[e.li] = Math.max(maxW[e.li], Math.abs(weights[e.li][e.a.idx][e.b.idx])); });
      edges.forEach((e, k) => {
        const wAbs = Math.abs(weights[e.li][e.a.idx][e.b.idx]) / maxW[e.li];
        const flow = (e.a.act + e.b.act) / 2;
        const hot = flow > 0.3;
        const back = e.a.mode === 'backward' || e.b.mode === 'backward';
        const col = hot ? (back ? C.a1 : C.a2) : (C.dark ? C.mute : C.rule);
        const alpha = hot ? Math.min(0.85, flow * wAbs + 0.18) : 0.07 + wAbs * (C.dark ? 0.2 : 0.35);
        for (let v = 0; v < 2; v++) { eCol[k * 8 + v * 4] = col.r; eCol[k * 8 + v * 4 + 1] = col.g; eCol[k * 8 + v * 4 + 2] = col.b; eCol[k * 8 + v * 4 + 3] = alpha; }

        let t = -1, from = e.a.pos, to = e.b.pos;
        if (waveMode === 'forward') t = phase - (e.li + 0.5);
        else if (waveMode === 'backward') { t = phase - (L - (e.li + 1) + 0.5); from = e.b.pos; to = e.a.pos; }
        const vis = t > 0 && t < 1 ? Math.sin(t * Math.PI) * (0.25 + wAbs * 0.75) : 0;
        const tt = Math.min(1, Math.max(0, t));
        pPos[k * 3] = from.x + (to.x - from.x) * tt; pPos[k * 3 + 1] = from.y + (to.y - from.y) * tt; pPos[k * 3 + 2] = from.z + (to.z - from.z) * tt;
        const pc = waveMode === 'backward' ? C.a1 : C.a2;
        pCol[k * 4] = pc.r; pCol[k * 4 + 1] = pc.g; pCol[k * 4 + 2] = pc.b; pCol[k * 4 + 3] = vis;
      });
      eGeo.attributes.color.needsUpdate = true;
      pGeo.attributes.position.needsUpdate = true;
      pGeo.attributes.color.needsUpdate = true;

      // labels
      const place = (el, p) => { el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`; };
      caps.forEach(c => place(c.el, st.toScreen(wp.copy(c.at).applyMatrix4(root.matrixWorld))));
      actLabels.forEach(c => { c.el.textContent = act().name; place(c.el, st.toScreen(wp.copy(c.at).applyMatrix4(root.matrixWorld))); });
      let topK = 0;
      for (let k = 1; k < out.length; k++) if (out[k] > out[topK]) topK = k;
      outLabels.forEach((o, k) => {
        o.el.textContent = Math.round(out[k] * 100) + '%';
        o.el.classList.toggle('is-top', k === topK);
        place(o.el, { x: o.n.screen.x + 12, y: o.n.screen.y });
      });

      // readouts
      if (rdAct) rdAct.textContent = act().name;
      if (rdConf) rdConf.textContent = (conf * 100).toFixed(0) + '%';
      if (rdLoss) rdLoss.textContent = lossEMA.toFixed(3);
      if (!locked && performance.now() - started > 1200) { locked = true; led?.setAttribute('data-state', 'lock'); }
      if (rdState) rdState.textContent = !locked ? 'booting' : waveMode === 'forward' ? 'forward pass'
        : waveMode === 'backward' ? 'backprop' : 'weights updated';
    }

    st.start();
    host.classList.add('is-live');
  }

  afterLoad(() => loadThree().then(build).catch(() => { /* the SVG poster stays */ }), 400);
})();
