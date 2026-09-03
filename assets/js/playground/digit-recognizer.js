/* =========================================================
   Digit recognizer. Trains a small neural network on real
   handwritten digits, live, in the browser, using ConvNetJS.

   Network: 64 (8x8 pixels) -> H1 relu -> H2 relu -> 10 softmax
   (H1, H2 are user editable). Layer indices after ConvNetJS's
   makeLayers() desugaring stay fixed regardless of H1/H2:
     0 input | 1 fc(H1) | 2 relu(H1) | 3 fc(H2) | 4 relu(H2) | 5 fc(10) | 6 softmax
   FullyConnLayer.filters[j].w[i] is the weight from input unit i
   to output unit j (verified against assets/js/vendor/convnet.js).
   ========================================================= */
(function () {
  const canvas = $('#digitCanvas');
  if (!canvas || typeof convnetjs === 'undefined') return;

  const clearBtn = $('#digitClear');
  const statusEl = $('#digitStatus');
  const trainFill = $('#trainFill');
  const trainVal = $('#trainVal');
  const barsEl = $('#digitBars');
  const netvizEl = $('#digitNetviz');
  const h1MinusBtn = $('#h1Minus'), h1PlusBtn = $('#h1Plus'), h1CountEl = $('#h1Count');
  const h2MinusBtn = $('#h2Minus'), h2PlusBtn = $('#h2Plus'), h2CountEl = $('#h2Count');

  const H1_MIN = 8, H1_MAX = 48, H1_STEP = 4;
  const H2_MIN = 4, H2_MAX = 32, H2_STEP = 4;
  let H1 = 32, H2 = 16;
  const OUT = 10;
  const EPOCHS = 14;

  let net, trainer;
  let trainSamples = [], testSamples = [];
  let epoch = 0, sampleIdx = 0, lossSum = 0, lossCount = 0, vizTick = 0;
  let done = false, ready = false, dataLoaded = false;

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

  function buildNet() {
    net = new convnetjs.Net();
    net.makeLayers([
      { type: 'input', out_sx: 1, out_sy: 1, out_depth: 64 },
      { type: 'fc', num_neurons: H1, activation: 'relu' },
      { type: 'fc', num_neurons: H2, activation: 'relu' },
      { type: 'softmax', num_classes: OUT }
    ]);
    trainer = new convnetjs.SGDTrainer(net, {
      learning_rate: 0.02, l2_decay: 0.0005, momentum: 0.9, batch_size: 8
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

  /* ── network diagram: input thumbnail + weighted edges ── */
  let thumbCv, netCv, netCtx, netW = 0, netH = 0, sweepRAF = null;

  function buildNetviz() {
    netvizEl.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'netviz__thumbwrap';
    thumbCv = document.createElement('canvas');
    thumbCv.width = 8; thumbCv.height = 8;
    wrap.appendChild(thumbCv);
    const lbl = document.createElement('span');
    lbl.className = 'netviz__label';
    lbl.textContent = 'input 8×8';
    wrap.appendChild(lbl);
    netvizEl.appendChild(wrap);

    const arrow = document.createElement('span');
    arrow.className = 'netviz__arrow';
    arrow.textContent = '→';
    arrow.setAttribute('aria-hidden', 'true');
    netvizEl.appendChild(arrow);

    netCv = document.createElement('canvas');
    netCv.id = 'digitNetCanvas';
    netvizEl.appendChild(netCv);
    sizeNetCanvas();
    drawDiagram({ mode: null });
  }

  function sizeNetCanvas() {
    if (!netCv) return;
    const w = netCv.clientWidth || 260;
    const h = netCv.clientHeight || 168;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    netCv.width = Math.round(w * dpr);
    netCv.height = Math.round(h * dpr);
    netCtx = netCv.getContext('2d');
    netCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    netW = w; netH = h;
  }

  function paintThumb(pixels64) {
    if (!thumbCv) return;
    const ctx = thumbCv.getContext('2d');
    const img = ctx.createImageData(8, 8);
    for (let i = 0; i < 64; i++) {
      const v = Math.max(0, Math.min(1, pixels64[i])) * 255;
      img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  function nodePositions() {
    const padX = netW * 0.09, padY = netH * 0.12;
    const colX = [padX, netW / 2, netW - padX];
    function col(n, x) {
      const arr = [];
      const gap = (netH - padY * 2) / Math.max(1, n - 1);
      for (let i = 0; i < n; i++) arr.push({ x, y: n === 1 ? netH / 2 : padY + gap * i });
      return arr;
    }
    return { h1: col(H1, colX[0]), h2: col(H2, colX[1]), out: col(OUT, colX[2]) };
  }

  function drawDiagram(opts) {
    if (!netCtx) return;
    netCtx.clearRect(0, 0, netW, netH);
    const pos = nodePositions();
    const ruleColor = token('--rule') || '#232537';
    const muteColor = token('--mute') || '#8991AC';
    const accent = token('--accent') || '#8B7DFF';
    const accent2 = token('--accent2') || '#3FE0D0';
    const activeColor = opts.mode === 'backward' ? accent : accent2;

    if (net) {
      const l2 = net.layers[3], l3 = net.layers[5];
      let maxW1 = 1e-6;
      for (let j = 0; j < H2; j++) for (let i = 0; i < H1; i++) maxW1 = Math.max(maxW1, Math.abs(l2.filters[j].w[i]));
      for (let j = 0; j < H2; j++) {
        for (let i = 0; i < H1; i++) {
          const w = Math.abs(l2.filters[j].w[i]) / maxW1;
          if (w < 0.12) continue;
          netCtx.strokeStyle = ruleColor;
          netCtx.globalAlpha = 0.05 + w * 0.32;
          netCtx.lineWidth = 0.6 + w * 1.3;
          netCtx.beginPath(); netCtx.moveTo(pos.h1[i].x, pos.h1[i].y); netCtx.lineTo(pos.h2[j].x, pos.h2[j].y); netCtx.stroke();
        }
      }
      let maxW2 = 1e-6;
      for (let k = 0; k < OUT; k++) for (let j = 0; j < H2; j++) maxW2 = Math.max(maxW2, Math.abs(l3.filters[k].w[j]));
      for (let k = 0; k < OUT; k++) {
        for (let j = 0; j < H2; j++) {
          const w = Math.abs(l3.filters[k].w[j]) / maxW2;
          if (w < 0.12) continue;
          netCtx.strokeStyle = ruleColor;
          netCtx.globalAlpha = 0.05 + w * 0.32;
          netCtx.lineWidth = 0.6 + w * 1.3;
          netCtx.beginPath(); netCtx.moveTo(pos.h2[j].x, pos.h2[j].y); netCtx.lineTo(pos.out[k].x, pos.out[k].y); netCtx.stroke();
        }
      }
    }
    netCtx.globalAlpha = 1;

    function drawNodes(arr, vals, baseR) {
      arr.forEach((p, idx) => {
        const v = vals ? Math.max(0, Math.min(1, vals[idx] || 0)) : 0;
        const r = baseR + v * baseR * 0.9;
        netCtx.beginPath();
        netCtx.fillStyle = v > 0.15 ? activeColor : ruleColor;
        netCtx.globalAlpha = 0.4 + v * 0.6;
        netCtx.arc(p.x, p.y, r, 0, Math.PI * 2);
        netCtx.fill();
      });
      netCtx.globalAlpha = 1;
    }
    drawNodes(pos.h1, opts.h1Vals, H1 > 24 ? 2.2 : 3.1);
    drawNodes(pos.h2, opts.h2Vals, H2 > 16 ? 2.8 : 3.8);

    pos.out.forEach((p, k) => {
      const v = opts.outVals ? Math.max(0, Math.min(1, opts.outVals[k] || 0)) : 0;
      netCtx.beginPath();
      netCtx.fillStyle = v > 0.15 ? activeColor : ruleColor;
      netCtx.globalAlpha = 0.4 + v * 0.6;
      netCtx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      netCtx.fill();
      netCtx.globalAlpha = 1;
      netCtx.fillStyle = v > 0.3 ? '#05070C' : muteColor;
      netCtx.font = '8px monospace';
      netCtx.textAlign = 'center'; netCtx.textBaseline = 'middle';
      netCtx.fillText(String(k), p.x, p.y);
    });
  }

  let sweeping = false;
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
    const h1Act = normalize(Array.from(net.layers[2].out_act.w));
    const h2Act = normalize(Array.from(net.layers[4].out_act.w));
    const outAct = normalize(Array.from(net.layers[6].out_act.w));

    const backward = vizTick % 2 === 0;
    if (backward) {
      const h1Grad = normalize(Array.from(net.layers[2].out_act.dw).map(Math.abs));
      const h2Grad = normalize(Array.from(net.layers[4].out_act.dw).map(Math.abs));
      animateSweep('backward', { h1: h1Grad, h2: h2Grad, out: new Array(OUT).fill(1) }, 700);
    } else {
      animateSweep('forward', { h1: h1Act, h2: h2Act, out: outAct }, 700);
    }
  }

  /* ── training loop ───────────────────────────────────── */
  function updateTrainUI(pct, avgLoss) {
    trainFill.style.width = pct + '%';
    trainVal.textContent = pct + '% · loss ' + avgLoss.toFixed(3);
  }

  function trainStep() {
    if (done) return;
    const stepsPerFrame = 24;
    let lastSample = null;
    for (let s = 0; s < stepsPerFrame && !done; s++) {
      const sample = trainSamples[sampleIdx];
      lastSample = sample;
      const vol = new convnetjs.Vol(sample.x);
      const res = trainer.train(vol, sample.y);
      lossSum += res.loss; lossCount++;
      sampleIdx++;
      if (sampleIdx >= trainSamples.length) {
        sampleIdx = 0; epoch++; shuffle(trainSamples);
        if (epoch >= EPOCHS) done = true;
      }
    }
    vizTick++;
    if (vizTick % 3 === 0 && lastSample) visualizeTraining(lastSample.x);
    const pct = Math.min(100, Math.round(((epoch + sampleIdx / trainSamples.length) / EPOCHS) * 100));
    updateTrainUI(pct, lossSum / Math.max(1, lossCount));
    if (!done) requestAnimationFrame(trainStep);
    else finishTraining();
  }

  function finishTraining() {
    let correct = 0;
    testSamples.forEach(s => {
      net.forward(new convnetjs.Vol(s.x), false);
      const probs = net.layers[6].out_act.w;
      let top = 0;
      for (let d = 1; d < 10; d++) if (probs[d] > probs[top]) top = d;
      if (top === s.y) correct++;
    });
    const acc = Math.round((correct / Math.max(1, testSamples.length)) * 100);
    trainFill.style.width = '100%';
    trainVal.textContent = acc + '% held-out accuracy';
    statusEl.innerHTML = `Trained on ${trainSamples.length.toLocaleString()} digits · <b>${acc}%</b> accuracy on ${testSamples.length} it never saw during training. Draw a digit below.`;
    ready = true;
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

  function restartTraining() {
    if (sweepRAF) cancelAnimationFrame(sweepRAF);
    ready = false; done = false;
    epoch = 0; sampleIdx = 0; lossSum = 0; lossCount = 0; vizTick = 0;
    buildNet();
    buildBars();
    renderBars(new Array(10).fill(0));
    trainFill.style.width = '0%';
    trainVal.textContent = '0% · loss …';
    statusEl.textContent = `Rebuilding the network (${H1} → ${H2} hidden units) and training from scratch…`;
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

  async function loadAndTrain() {
    buildBars();
    buildNetviz();
    updateNetCtrlUI();
    if (typeof window.DIGITS_DATA === 'undefined') {
      if (statusEl) statusEl.textContent = 'Could not load the training data. assets/data/digits8x8.js did not load.';
      return;
    }
    if (statusEl) statusEl.textContent = 'Training on 1,797 handwritten digits…';
    const all = shuffle(window.DIGITS_DATA.samples.slice());
    const testN = Math.round(all.length * 0.1);
    testSamples = all.slice(0, testN);
    trainSamples = all.slice(testN);
    dataLoaded = true;
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

  /* Crop to the drawn ink's bounding box, pad it, then average that
     square region into 8x8. Matches how the training images (and
     MNIST-style datasets generally) are centered and scaled, so a
     prediction no longer depends on where or how large you drew,
     or how many points your stroke happened to be sampled into. */
  function downsample8x8() {
    const W = canvas.width, H = canvas.height;
    const img = ctx.getImageData(0, 0, W, H).data;
    const THRESH = 24;
    let minX = W, minY = H, maxX = 0, maxY = 0, found = false;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (img[(y * W + x) * 4] > THRESH) {
          found = true;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    const out = new Array(64).fill(0);
    if (!found) return out;

    const size = Math.max(maxX - minX, maxY - minY, 1);
    const margin = size * 0.3;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const half = size / 2 + margin;
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
        out[by * 8 + bx] = n ? (sum / n) / 255 : 0;
      }
    }
    return out;
  }

  let predictQueued = false;
  function predict() {
    if (!ready || !hasInk) return;
    const pixels = downsample8x8();
    net.forward(new convnetjs.Vol(pixels), false);
    const probs = Array.from(net.layers[6].out_act.w);
    const top = renderBars(probs);
    paintThumb(pixels);
    const h1Act = normalize(Array.from(net.layers[2].out_act.w));
    const h2Act = normalize(Array.from(net.layers[4].out_act.w));
    animateSweep('forward', { h1: h1Act, h2: h2Act, out: normalize(probs.slice()) }, 500);
    statusEl.innerHTML = `Best guess: <b>${top}</b> (${Math.round(probs[top] * 100)}% confidence). Keep drawing to refine it.`;
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

  loadAndTrain();
})();
