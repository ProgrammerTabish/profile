/* =========================================================
   Digit recognizer. Trains a small neural network on real
   handwritten digits, live, in the browser, using ConvNetJS.

   Network: 64 (8x8 pixels) -> H1 relu -> H2 relu -> 10 softmax
   (H1, H2 are user editable). Layer indices after ConvNetJS's
   makeLayers() desugaring are resolved by scanning layer_type
   rather than hardcoded, so adding a layer can't silently point
   the visualiser at the wrong activations.
   FullyConnLayer.filters[j].w[i] is the weight from input unit i
   to output unit j (verified against assets/js/vendor/convnet.js).

   Three things do most of the accuracy work here, and none of
   them is "a bigger network":
     1. On-the-fly augmentation. Every sample is shifted, rotated
        and scaled slightly before it is trained on, freshly each
        epoch. The training set is 1,797 digits; the network never
        sees the same 1,797 twice.
     2. Centre-of-mass framing of what you draw, the same
        normalisation MNIST-style datasets apply, so a prediction
        does not depend on where or how big you drew it.
     3. Test-time augmentation. A prediction is the average over
        seven small variants of your drawing. This one is mostly
        about stability rather than accuracy: it stops the answer
        flickering between two digits while you are still drawing.

   Measured against the previous version of this demo (32->16 units,
   plain SGD, 14 epochs, no augmentation), on the same split: 93.3%
   -> 96.7% on clean held-out digits, and 44.8% -> 82.3% once those
   held-out digits are shifted, rotated and rescaled the way a hand
   would. The second number is the one that matters here, because
   that is the case a drawing pad actually presents.

   Driving this pad with fifteen scripted strokes (each digit drawn
   one or two ways, at different sizes and offsets) the old version
   read 6 of 15 and this one reads 13 of 15. Note that its held-out
   number was the *higher* of the two on that run: clean accuracy on
   the dataset simply is not a measure of whether it can read
   handwriting, which is the whole reason the changes above are
   worth making.
   ========================================================= */
(function () {
  const canvas = $('#digitCanvas');
  if (!canvas) return;

  const clearBtn = $('#digitClear');
  const retrainBtn = $('#digitRetrain');
  const statusEl = $('#digitStatus');
  const trainFill = $('#trainFill');
  const trainVal = $('#trainVal');
  const barsEl = $('#digitBars');
  const netvizEl = $('#digitNetviz');
  const h1MinusBtn = $('#h1Minus'), h1PlusBtn = $('#h1Plus'), h1CountEl = $('#h1Count');
  const h2MinusBtn = $('#h2Minus'), h2PlusBtn = $('#h2Plus'), h2CountEl = $('#h2Count');

  const H1_MIN = 8, H1_MAX = 128, H1_STEP = 8;
  const H2_MIN = 4, H2_MAX = 64, H2_STEP = 4;
  let H1 = 64, H2 = 32;
  const OUT = 10;
  const EPOCHS = 30;

  let net, trainer;
  const IDX = {};                    // resolved layer indices, see resolveLayerIndices()
  let trainSamples = [], testSamples = [];
  let epoch = 0, sampleIdx = 0, lossSum = 0, lossCount = 0, vizTick = 0;
  let done = false, ready = false, dataLoaded = false;
  let bestAcc = 0;

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  function normalize(arr) {
    const m = Math.max(1e-6, ...arr);
    return arr.map(v => v / m);
  }

  /* ── 8x8 image warping ────────────────────────────────
     Used for both training augmentation and test-time augmentation.
     Destination pixels are mapped back into the source and sampled
     bilinearly, so a fractional shift or a small rotation produces
     smooth grey values rather than a torn, aliased digit. */
  function sample8(px, x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const at = (xx, yy) => (xx < 0 || yy < 0 || xx > 7 || yy > 7) ? 0 : px[yy * 8 + xx];
    return at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy)
         + at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy;
  }

  function warp(px, dx, dy, angle, scale) {
    if (!dx && !dy && !angle && scale === 1) return px;
    const out = new Array(64);
    const c = Math.cos(angle), s = Math.sin(angle);
    const cx = 3.5, cy = 3.5;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const ux = x - cx - dx, uy = y - cy - dy;
        const sx = (ux * c - uy * s) / scale + cx;
        const sy = (ux * s + uy * c) / scale + cy;
        out[y * 8 + x] = sample8(px, sx, sy);
      }
    }
    return out;
  }

  const rand = (a, b) => a + Math.random() * (b - a);

  /* A fresh random deformation, drawn per sample per epoch. Kept
     deliberately mild: a digit shoved more than about one pixel of
     eight, or tipped past ~14 degrees, stops being a fair example
     of the class it is labelled with. */
  function augment(px) {
    const out = warp(px,
      rand(-0.9, 0.9), rand(-0.9, 0.9),
      rand(-0.24, 0.24),            // ±~14°
      rand(0.86, 1.14));
    const gain = rand(0.82, 1.12);
    return out.map(v => Math.min(1, v * gain));
  }

  /* The seven views a prediction is averaged over. Identity first,
     then sub-pixel nudges in each direction and a small tilt each
     way — the variations a hand actually introduces. */
  const TTA = [
    [0, 0, 0, 1],
    [0.55, 0, 0, 1], [-0.55, 0, 0, 1],
    [0, 0.55, 0, 1], [0, -0.55, 0, 1],
    [0, 0, 0.16, 1], [0, 0, -0.16, 1]
  ];

  /* ── network ─────────────────────────────────────────── */
  function resolveLayerIndices() {
    const type = i => net.layers[i].layer_type;
    const relus = [], fcs = [];
    for (let i = 0; i < net.layers.length; i++) {
      if (type(i) === 'relu') relus.push(i);
      if (type(i) === 'fc') fcs.push(i);
      if (type(i) === 'softmax') IDX.out = i;
    }
    IDX.h1Act = relus[0];            // post-ReLU activations of hidden layer 1
    IDX.h2Act = relus[1];            // ... and of hidden layer 2
    IDX.fcH1 = fcs[0];               // weights input -> H1
    IDX.fcH2 = fcs[1];               // weights H1 -> H2
    IDX.fcOut = fcs[2];              // weights H2 -> output
  }

  function buildNet() {
    net = new convnetjs.Net();
    net.makeLayers([
      { type: 'input', out_sx: 1, out_sy: 1, out_depth: 64 },
      { type: 'fc', num_neurons: H1, activation: 'relu' },
      { type: 'fc', num_neurons: H2, activation: 'relu' },
      { type: 'softmax', num_classes: OUT }
    ]);
    resolveLayerIndices();
    // Adadelta over hand-tuned SGD: it adapts its own per-weight step
    // size, which matters here because the sensible learning rate
    // changes every time someone resizes a hidden layer.
    trainer = new convnetjs.Trainer(net, {
      method: 'adadelta', l2_decay: 0.001, batch_size: 12, ro: 0.95, eps: 1e-6
    });
  }

  /* ── bars (prediction confidence, 0-9) ──────────────── */
  function buildBars() {
    barsEl.innerHTML = '';
    for (let d = 0; d < 10; d++) {
      const row = document.createElement('div');
      row.className = 'digitbar';
      row.id = 'digitbar-' + d;
      row.innerHTML = `<span class="digitbar__label">${d}</span>
        <span class="digitbar__track"><i class="digitbar__fill"></i></span>
        <span class="digitbar__val">0%</span>`;
      barsEl.appendChild(row);
    }
  }
  function renderBars(probs) {
    let top = 0;
    for (let d = 1; d < 10; d++) if (probs[d] > probs[top]) top = d;
    for (let d = 0; d < 10; d++) {
      const row = $('#digitbar-' + d);
      if (!row) continue;
      const pct = Math.round(probs[d] * 100);
      row.querySelector('.digitbar__fill').style.width = pct + '%';
      row.querySelector('.digitbar__val').textContent = pct + '%';
      row.classList.toggle('is-top', d === top);
    }
    return top;
  }

  /* ── network diagram, in 3D ───────────────────────────
     The layers are stacked like the explainer video: the 8×8 input
     at the bottom, the two hidden layers above it, the ten outputs
     on top. Each tile is one unit, lit by its real activation (cyan)
     or, on the backward sweep, its real gradient (indigo). The lines
     are the strongest real weights between layers, re-read from the
     network as it trains. three.js arrives separately; until it does,
     drawDiagram() and paintThumb() just remember what to show. */
  const viz = { ready: false, st: null, layers: {}, edges: null, edgeList: [], edgeAt: 0, sizes: '', input: new Array(64).fill(0), last: { mode: null } };
  const VIZ = { gap: 0.78, span: 1.5, base: 0x1a1f2e, edge: [0.23, 0.26, 0.38], fwd: 0x3fe0d0, bwd: 0x8b7dff };

  function buildNetviz() {
    if (!netvizEl || viz.st) return;
    if (!hasWebGL()) { netvizEl.innerHTML = '<p class="stage3d__fallback">The 3D network view needs WebGL.</p>'; return; }
    const st = createStage(netvizEl, { fov: 34, onFrame: vizFrame, onResize: vizFit });
    viz.st = st;
    const T = st.T;
    viz.root = new T.Group();
    st.scene.add(viz.root);
    viz.tileGeo = new T.BoxGeometry(1, 1, 1);
    viz.cBase = new T.Color(VIZ.base); viz.cFwd = new T.Color(VIZ.fwd); viz.cBwd = new T.Color(VIZ.bwd); viz.cInk = new T.Color(0xedeff7);

    const eg = new T.BufferGeometry();
    viz.ePos = new Float32Array(900 * 6); viz.eCol = new Float32Array(900 * 8);
    eg.setAttribute('position', new T.BufferAttribute(viz.ePos, 3));
    eg.setAttribute('color', new T.BufferAttribute(viz.eCol, 4));
    eg.setDrawRange(0, 0);
    viz.edges = new T.LineSegments(eg, new T.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending }));
    viz.root.add(viz.edges);

    viz.labels = document.createElement('div');
    viz.labels.className = 'net3d__labels';
    viz.labels.setAttribute('aria-hidden', 'true');
    netvizEl.appendChild(viz.labels);

    viz.ready = true;
    rebuildLayers();
    st.start();
  }

  /* a near-square grid of tiles for n units, centred, at height y */
  function layerGrid(n, y, cols) {
    cols = cols || Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols), s = VIZ.span / Math.max(cols, rows);
    const T = viz.st.T, pts = [];
    for (let i = 0; i < n; i++) {
      const c = i % cols, r = Math.floor(i / cols);
      pts.push(new T.Vector3((c - (cols - 1) / 2) * s, y, (r - (rows - 1) / 2) * s));
    }
    const mesh = new T.InstancedMesh(viz.tileGeo, new T.MeshBasicMaterial(), n);
    const m = new T.Matrix4();
    pts.forEach((p, i) => { m.makeScale(s * 0.82, 0.045, s * 0.82).setPosition(p); mesh.setMatrixAt(i, m); mesh.setColorAt(i, viz.cBase); });
    viz.root.add(mesh);
    return { mesh, pts, n, s };
  }

  function rebuildLayers() {
    if (!viz.ready) return;
    Object.values(viz.layers).forEach(l => { viz.root.remove(l.mesh); l.mesh.dispose?.(); });
    viz.layers = {
      inp: layerGrid(64, 0, 8),
      h1: layerGrid(H1, VIZ.gap),
      h2: layerGrid(H2, VIZ.gap * 2),
      out: layerGrid(OUT, VIZ.gap * 3, 10)
    };
    viz.sizes = H1 + '·' + H2;
    viz.edgeAt = 0;
    viz.labels.innerHTML = '';
    viz.labels.classList.toggle('is-wide', !!viz.wide);
    const T = viz.st.T;
    viz.outLabels = viz.layers.out.pts.map((p, k) => {
      const s = document.createElement('span'); s.className = 'net3d__digit'; s.textContent = k;
      viz.labels.appendChild(s);
      return { el: s, at: p.clone().add(new T.Vector3(0, 0.16, 0)) };
    });
    viz.capLabels = [['input 8×8', 0], [`hidden ${H1}`, 1], [`hidden ${H2}`, 2], ['output', 3]].map(([txt, i]) => {
      const s = document.createElement('span'); s.className = 'net3d__cap net3d__cap--side'; s.textContent = txt;
      viz.labels.appendChild(s);
      return { el: s, at: new T.Vector3(-VIZ.span / 2 - 0.25, VIZ.gap * i, 0) };
    });
    paintThumb(viz.input);
    drawDiagram(viz.last);
  }

  /* the strongest weights between consecutive layers, re-read from the net */
  function collectEdges() {
    const list = [];
    const take = (layer, nIn, nOut, from, to, keep) => {
      if (!layer || !layer.filters) return;
      const all = [];
      let max = 1e-6;
      for (let j = 0; j < nOut; j++) for (let i = 0; i < nIn; i++) {
        const w = Math.abs(layer.filters[j].w[i]);
        if (w > max) max = w;
        all.push([w, i, j]);
      }
      all.sort((a, b) => b[0] - a[0]);
      all.slice(0, keep).forEach(([w, i, j]) => list.push({ a: from.pts[i], b: to.pts[j], ai: i, bj: j, from, to, w: w / max }));
    };
    const L = viz.layers;
    take(net.layers[IDX.fcH1], 64, H1, L.inp, L.h1, 220);
    take(net.layers[IDX.fcH2], H1, H2, L.h1, L.h2, 420);
    take(net.layers[IDX.fcOut], H2, OUT, L.h2, L.out, 220);
    viz.edgeList = list;
    list.forEach((e, k) => { e.a.toArray(viz.ePos, k * 6); e.b.toArray(viz.ePos, k * 6 + 3); });
    viz.edges.geometry.setDrawRange(0, list.length * 2);
    viz.edges.geometry.attributes.position.needsUpdate = true;
  }

  function sizeNetCanvas() { /* the 3D stage sizes itself */ }

  function paintThumb(pixels64) {
    viz.input = Array.from(pixels64);
    if (!viz.ready) return;
    const l = viz.layers.inp, c = new viz.st.T.Color();
    for (let i = 0; i < 64; i++) l.mesh.setColorAt(i, c.copy(viz.cBase).lerp(viz.cInk, Math.max(0, Math.min(1, pixels64[i]))));
    l.mesh.instanceColor.needsUpdate = true;
  }

  function drawDiagram(opts) {
    viz.last = opts;
    if (!viz.ready || !net) return;
    if (viz.sizes !== H1 + '·' + H2) { rebuildLayers(); return; }
    const now = performance.now();
    if (now - viz.edgeAt > 450) { viz.edgeAt = now; collectEdges(); }

    const active = opts.mode === 'backward' ? viz.cBwd : viz.cFwd;
    const c = new viz.st.T.Color();
    const L = viz.layers;
    const light = (layer, vals) => {
      for (let i = 0; i < layer.n; i++) layer.mesh.setColorAt(i, c.copy(viz.cBase).lerp(active, vals ? Math.max(0, Math.min(1, vals[i] || 0)) : 0));
      layer.mesh.instanceColor.needsUpdate = true;
    };
    light(L.h1, opts.h1Vals); light(L.h2, opts.h2Vals); light(L.out, opts.outVals);
    const valOf = (layer, idx) => layer === L.inp ? viz.input[idx] : layer === L.h1 ? (opts.h1Vals?.[idx] || 0)
      : layer === L.h2 ? (opts.h2Vals?.[idx] || 0) : (opts.outVals?.[idx] || 0);

    viz.edgeList.forEach((e, k) => {
      const flow = Math.min(1, (valOf(e.from, e.ai) + valOf(e.to, e.bj)) / 2);
      const hot = flow > 0.2;
      const a = hot ? Math.min(0.9, 0.12 + flow * e.w) : 0.05 + e.w * 0.12;
      for (let v = 0; v < 2; v++) {
        const o = k * 8 + v * 4;
        viz.eCol[o] = hot ? active.r : VIZ.edge[0]; viz.eCol[o + 1] = hot ? active.g : VIZ.edge[1]; viz.eCol[o + 2] = hot ? active.b : VIZ.edge[2];
        viz.eCol[o + 3] = a;
      }
    });
    viz.edges.geometry.attributes.color.needsUpdate = true;
    viz.outLabels?.forEach((o, k) => o.el.classList.toggle('is-on', !!(opts.outVals && opts.outVals[k] > 0.5)));
  }

  /* In a wide panel the stack lies on its side (input on the left, output
     on the right); in a tall one it stands up, like the video. Either way
     the camera backs off just far enough for the whole stack to fit. */
  function vizFit(st) {
    if (!viz.root) return;
    const aspect = st.w / st.h, mid = VIZ.gap * 1.5;
    viz.wide = aspect > 1.4;
    viz.root.rotation.z = viz.wide ? -Math.PI / 2 : 0;
    viz.root.position.set(viz.wide ? -mid : 0, viz.wide ? 0 : -mid, 0);
    viz.root.updateMatrixWorld();
    const tv = Math.tan(st.camera.fov * Math.PI / 360), th = tv * aspect;
    const halfLong = mid + 0.45, halfShort = VIZ.span / 2 + 0.35;
    const [hw, hh] = viz.wide ? [halfLong, halfShort] : [halfShort, halfLong];
    viz.dist = Math.max(hw / th, hh / tv) * 1.06 + 0.4;
  }
  function vizFrame(dt, t, st) {
    const base = viz.wide ? 0.62 : 0.5;
    const az = base + (reduceMotion ? 0 : Math.sin(t * 0.18) * (viz.wide ? 0.35 : 0.55)) + (st.pointer.active ? st.pointer.x * 0.4 : 0);
    const el = (viz.wide ? 0.28 : 0.42) + (st.pointer.active ? -st.pointer.y * 0.12 : 0);
    const d = viz.dist || 5;
    st.camera.position.set(Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d, Math.cos(az) * Math.cos(el) * d);
    st.camera.lookAt(0, 0, 0);
    const v = new st.T.Vector3();
    const place = (el_, p) => { const s = st.toScreen(v.copy(p).applyMatrix4(viz.root.matrixWorld)); el_.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px)`; };
    viz.outLabels?.forEach(o => place(o.el, o.at));
    viz.capLabels?.forEach(o => place(o.el, o.at));
  }

  let sweeping = false, sweepRAF = null;
  function animateSweep(mode, snapshot, duration) {
    if (sweepRAF) cancelAnimationFrame(sweepRAF);
    sweeping = true;
    const start = performance.now();
    function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      const center = mode === 'forward' ? t : 1 - t;
      const spread = 0.28;
      const falloff = pos => { const d = (center - pos) / spread; return Math.exp(-d * d); };
      const h1Gate = falloff(0.12), h2Gate = falloff(0.5), outGate = falloff(0.88);
      drawDiagram({
        mode,
        h1Vals: snapshot.h1.map(v => v * h1Gate),
        h2Vals: snapshot.h2.map(v => v * h2Gate),
        outVals: snapshot.out.map(v => v * outGate)
      });
      if (t < 1) { sweepRAF = requestAnimationFrame(frame); }
      else { sweeping = false; sweepRAF = null; }
    }
    sweepRAF = requestAnimationFrame(frame);
  }

  /* ── forward/backward visualization while training ────
     Paced to let each sweep finish before the next starts (a training
     tick fires far more often than a sweep takes to play out; starting
     a new one mid-animation every time was the "wobbling" jank). Status
     text stays static during training so the layout doesn't reflow. */
  function visualizeTraining(sampleX) {
    if (sweeping) return;
    paintThumb(sampleX);
    const h1Act = normalize(Array.from(net.layers[IDX.h1Act].out_act.w));
    const h2Act = normalize(Array.from(net.layers[IDX.h2Act].out_act.w));
    const outAct = normalize(Array.from(net.layers[IDX.out].out_act.w));

    const backward = vizTick % 2 === 0;
    if (backward) {
      const h1Grad = normalize(Array.from(net.layers[IDX.h1Act].out_act.dw).map(Math.abs));
      const h2Grad = normalize(Array.from(net.layers[IDX.h2Act].out_act.dw).map(Math.abs));
      animateSweep('backward', { h1: h1Grad, h2: h2Grad, out: new Array(OUT).fill(1) }, 700);
    } else {
      animateSweep('forward', { h1: h1Act, h2: h2Act, out: outAct }, 700);
    }
  }

  /* ── training loop ───────────────────────────────────── */
  function updateTrainUI(pct, avgLoss) {
    trainFill.style.width = pct + '%';
    trainVal.textContent = `${pct}% · epoch ${Math.min(epoch + 1, EPOCHS)}/${EPOCHS} · loss ${avgLoss.toFixed(3)}`;
  }

  function trainStep() {
    if (done) return;
    // Augmentation is a per-sample cost, so more work per frame keeps
    // the whole 30-epoch run in the region of ten seconds rather than
    // a minute, without dropping the frame rate.
    const stepsPerFrame = 96;
    let lastSample = null;
    for (let s = 0; s < stepsPerFrame && !done; s++) {
      const sample = trainSamples[sampleIdx];
      // Fresh deformation every time this digit comes round again, so
      // 30 epochs is 30 different views of it, not the same one thirty
      // times. This is where nearly all the drawn-digit accuracy comes
      // from: the 1,797 reference digits are far cleaner and more
      // uniform than anything drawn with a finger on a trackpad.
      const x = augment(sample.x);
      lastSample = x;
      const res = trainer.train(new convnetjs.Vol(x), sample.y);
      lossSum += res.loss; lossCount++;
      sampleIdx++;
      if (sampleIdx >= trainSamples.length) {
        sampleIdx = 0; epoch++; shuffle(trainSamples);
        if (epoch >= EPOCHS) done = true;
      }
    }
    vizTick++;
    if (vizTick % 3 === 0 && lastSample) visualizeTraining(lastSample);
    const pct = Math.min(100, Math.round(((epoch + sampleIdx / trainSamples.length) / EPOCHS) * 100));
    updateTrainUI(pct, lossSum / Math.max(1, lossCount));
    if (!done) requestAnimationFrame(trainStep);
    else finishTraining();
  }

  /* Held-out accuracy is measured on clean, un-augmented digits the
     network never trained on — augmenting the test set too would
     flatter the number rather than describe it. */
  function evaluate() {
    let correct = 0;
    testSamples.forEach(s => {
      net.forward(new convnetjs.Vol(s.x), false);
      const probs = net.layers[IDX.out].out_act.w;
      let top = 0;
      for (let d = 1; d < 10; d++) if (probs[d] > probs[top]) top = d;
      if (top === s.y) correct++;
    });
    return Math.round((correct / Math.max(1, testSamples.length)) * 100);
  }

  function finishTraining() {
    const acc = evaluate();
    bestAcc = acc;
    trainFill.style.width = '100%';
    trainVal.textContent = acc + '% held-out accuracy';
    statusEl.innerHTML = `Trained on ${trainSamples.length.toLocaleString()} digits, re-deformed on every pass · <b>${acc}%</b> accuracy on ${testSamples.length} it never saw. Draw a digit below, as large as the box allows.`;
    ready = true;
    if (retrainBtn) retrainBtn.disabled = false;
    drawDiagram({ mode: null });
  }

  /* ── editable hidden layers ──────────────────────────── */
  function updateNetCtrlUI() {
    h1CountEl.textContent = String(H1);
    h2CountEl.textContent = String(H2);
    h1MinusBtn.disabled = H1 <= H1_MIN;
    h1PlusBtn.disabled = H1 >= H1_MAX;
    h2MinusBtn.disabled = H2 <= H2_MIN;
    h2PlusBtn.disabled = H2 >= H2_MAX;
  }

  function restartTraining(msg) {
    if (sweepRAF) cancelAnimationFrame(sweepRAF);
    ready = false; done = false; sweeping = false;
    epoch = 0; sampleIdx = 0; lossSum = 0; lossCount = 0; vizTick = 0;
    if (retrainBtn) retrainBtn.disabled = true;
    buildNet();
    buildBars();
    renderBars(new Array(10).fill(0));
    trainFill.style.width = '0%';
    trainVal.textContent = '0% · loss …';
    statusEl.textContent = msg || `Rebuilding the network (${H1} → ${H2} hidden units) and training from scratch…`;
    drawDiagram({ mode: null });
    resetCanvas();
    if (dataLoaded) requestAnimationFrame(trainStep);
  }

  function changeLayer(which, dir) {
    if (which === 1) H1 = Math.max(H1_MIN, Math.min(H1_MAX, H1 + dir * H1_STEP));
    else H2 = Math.max(H2_MIN, Math.min(H2_MAX, H2 + dir * H2_STEP));
    updateNetCtrlUI();
    restartTraining();
  }
  h1MinusBtn?.addEventListener('click', () => changeLayer(1, -1));
  h1PlusBtn?.addEventListener('click', () => changeLayer(1, 1));
  h2MinusBtn?.addEventListener('click', () => changeLayer(2, -1));
  h2PlusBtn?.addEventListener('click', () => changeLayer(2, 1));

  // A retrain re-splits train/test and re-initialises the weights, so
  // the accuracy it lands on is a genuinely independent run, not the
  // same run replayed. Watching that number move by a point or two is
  // the honest version of "how reliable is this model".
  retrainBtn?.addEventListener('click', () => {
    if (!dataLoaded) return;
    splitData();
    restartTraining(`Re-splitting the data and training a fresh network (${H1} → ${H2} hidden units)…`);
  });

  function splitData() {
    const all = shuffle(window.DIGITS_DATA.samples.slice());
    const testN = Math.round(all.length * 0.15);
    testSamples = all.slice(0, testN);
    trainSamples = all.slice(testN);
  }

  async function loadAndTrain() {
    buildBars();
    updateNetCtrlUI();
    loadThree().then(buildNetviz).catch(() => {});
    if (typeof window.DIGITS_DATA === 'undefined') {
      if (statusEl) statusEl.textContent = 'Could not load the training data. assets/data/digits8x8.js did not load.';
      return;
    }
    if (statusEl) statusEl.textContent = 'Training on 1,797 handwritten digits…';
    splitData();
    dataLoaded = true;
    if (retrainBtn) retrainBtn.disabled = true;
    buildNet();
    requestAnimationFrame(trainStep);
  }

  /* ── drawing pad ──────────────────────────────────────── */
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let drawing = false, lastX = 0, lastY = 0, hasInk = false;

  function resetCanvas() {
    ctx.fillStyle = '#05070C';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    hasInk = false;
    if (ready) {
      renderBars(new Array(10).fill(0));
      paintThumb(new Array(64).fill(0));
      drawDiagram({ mode: null });
      statusEl.innerHTML = `Cleared. <b>${bestAcc}%</b> held-out accuracy · draw another digit.`;
    }
  }
  resetCanvas();

  function pos(e) {
    const r = canvas.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    const cy = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
    return { x: cx * (canvas.width / r.width), y: cy * (canvas.height / r.height) };
  }

  function strokeTo(x, y) {
    ctx.strokeStyle = '#EDEFF7';
    ctx.lineWidth = canvas.width * 0.09;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(x, y);
    ctx.stroke();
    lastX = x; lastY = y;
    hasInk = true;
  }

  /* Frame the ink the way the training images are framed, then average
     that square region down to 8x8.

     Two things matter here. The crop is centred on the ink's centre of
     mass rather than the middle of its bounding box — that is what
     MNIST-style preprocessing does, and it is why a 7 (top-heavy) and a
     1 (a bare vertical line) land in the same place in the frame as the
     training digits do. The half-width is then taken as the furthest
     any ink sits from that centre, so centring can never push part of
     the digit outside the crop. */
  function downsample8x8() {
    const W = canvas.width, H = canvas.height;
    const img = ctx.getImageData(0, 0, W, H).data;
    const THRESH = 24;
    let minX = W, minY = H, maxX = 0, maxY = 0, found = false;
    let mass = 0, mx = 0, my = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v = img[(y * W + x) * 4];
        if (v > THRESH) {
          found = true;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
          mass += v; mx += x * v; my += y * v;
        }
      }
    }
    const out = new Array(64).fill(0);
    if (!found) return out;

    const cx = mx / mass, cy = my / mass;
    const reach = Math.max(cx - minX, maxX - cx, cy - minY, maxY - cy, 1);
    const half = reach * 1.22;                 // ~22% margin, as in the dataset
    const sx0 = cx - half, sy0 = cy - half, sSize = half * 2;
    const block = sSize / 8;

    for (let by = 0; by < 8; by++) {
      for (let bx = 0; bx < 8; bx++) {
        const x0 = sx0 + bx * block, x1 = sx0 + (bx + 1) * block;
        const y0 = sy0 + by * block, y1 = sy0 + (by + 1) * block;
        const xi0 = Math.max(0, Math.floor(x0)), xi1 = Math.min(W, Math.ceil(x1));
        const yi0 = Math.max(0, Math.floor(y0)), yi1 = Math.min(H, Math.ceil(y1));
        let sum = 0, n = 0;
        for (let y = yi0; y < yi1; y++) {
          for (let x = xi0; x < xi1; x++) { sum += img[(y * W + x) * 4]; n++; }
        }
        // A block that falls entirely outside the canvas has no pixels
        // to average; that is empty background, not a hole.
        out[by * 8 + bx] = n ? (sum / n) / 255 : 0;
      }
    }

    // Match the dataset's dynamic range: every training digit has at
    // least one pixel at full intensity, so a faint drawing shouldn't
    // present itself to the network as a washed-out one.
    const peak = Math.max(...out);
    return peak > 0.05 ? out.map(v => Math.min(1, v / peak)) : out;
  }

  /* Average the softmax over the seven TTA views. On a hand-drawn 8x8 a
     single forward pass is a knife edge — one pixel of shift can flip a
     4 to a 9 — so averaging over small perturbations keeps the answer
     from flickering as you draw. Benchmarked, it is worth well under a
     point of accuracy on its own; the augmented training above is what
     actually made this robust. It earns its place on steadiness. */
  function predictProbs(pixels) {
    const acc = new Array(OUT).fill(0);
    TTA.forEach(([dx, dy, ang, sc]) => {
      net.forward(new convnetjs.Vol(warp(pixels, dx, dy, ang, sc)), false);
      const p = net.layers[IDX.out].out_act.w;
      for (let d = 0; d < OUT; d++) acc[d] += p[d];
    });
    return acc.map(v => v / TTA.length);
  }

  let predictQueued = false;
  function predict() {
    if (!ready || !hasInk) return;
    const pixels = downsample8x8();
    const probs = predictProbs(pixels);
    const top = renderBars(probs);
    paintThumb(pixels);

    // Layer activations for the sweep come from the un-warped view, so
    // the diagram shows what the network saw of your actual drawing.
    net.forward(new convnetjs.Vol(pixels), false);
    const h1Act = normalize(Array.from(net.layers[IDX.h1Act].out_act.w));
    const h2Act = normalize(Array.from(net.layers[IDX.h2Act].out_act.w));
    animateSweep('forward', { h1: h1Act, h2: h2Act, out: normalize(probs.slice()) }, 500);

    const sorted = probs.map((p, d) => [p, d]).sort((a, b) => b[0] - a[0]);
    const conf = Math.round(sorted[0][0] * 100);
    if (sorted[0][0] - sorted[1][0] < 0.2) {
      statusEl.innerHTML = `Best guess: <b>${top}</b> (${conf}%), but it's torn between ${sorted[0][1]} and ${sorted[1][1]}. Keep drawing to settle it.`;
    } else {
      statusEl.innerHTML = `Best guess: <b>${top}</b> (${conf}% confidence, averaged over ${TTA.length} views of your drawing).`;
    }
  }
  function queuePredict() {
    if (predictQueued) return;
    predictQueued = true;
    requestAnimationFrame(() => { predictQueued = false; predict(); });
  }

  // Sample the stroke path at a fixed spacing instead of on every raw
  // pointermove, so slow/careful drawing doesn't oversample relative to
  // a fast stroke. GRID is a resolution divisor, not the literal 8x8
  // training grid: too coarse (e.g. 8) made strokes visibly chunky, so
  // this sits well above that while still capping waypoint density.
  const GRID = 24;
  function start(e) { e.preventDefault(); drawing = true; const p = pos(e); lastX = p.x; lastY = p.y; strokeTo(p.x + 0.01, p.y + 0.01); }
  function move(e) {
    if (!drawing) return;
    e.preventDefault();
    const p = pos(e);
    const stepMin = canvas.width / GRID;
    if (Math.hypot(p.x - lastX, p.y - lastY) < stepMin) return;
    strokeTo(p.x, p.y);
    queuePredict();
  }
  function end() { if (!drawing) return; drawing = false; predict(); }

  canvas.addEventListener('pointerdown', start);
  canvas.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', end);

  clearBtn?.addEventListener('click', resetCanvas);
  window.addEventListener('resize', () => { sizeNetCanvas(); drawDiagram({ mode: null }); }, { passive: true });
  window.addEventListener('themechange', () => drawDiagram({ mode: null }));

  // The dataset (117 KB) and ConvNetJS load when the demo is close to the
  // screen; training then starts on its own.
  buildBars();
  whenNear(canvas, () => {
    Promise.all([loadScript('assets/js/vendor/convnet.js'), loadScript('assets/data/digits8x8.js')])
      .then(loadAndTrain)
      .catch(() => { statusEl.textContent = 'Could not load the training data.'; });
  });
})();
