/* =========================================================
   Decision-boundary playground — a tiny network (2 -> 16 tanh
   -> 16 tanh -> softmax 2) trains live on points you place,
   redrawing its decision boundary every epoch.
   ========================================================= */
(function () {
  const canvas = $('#dbCanvas');
  if (!canvas || typeof convnetjs === 'undefined') return;

  const epochEl = $('#dbEpoch'), lossEl = $('#dbLoss');
  const trainBtn = $('#dbTrain'), resetBtn = $('#dbReset');
  const classABtn = $('#dbClassA'), classBBtn = $('#dbClassB');
  const dsBtns = $$('[data-ds]');

  let W = 0, H = 0, ctx = null;
  let net, trainer;
  let points = [], currentClass = 0, currentDs = 'blobs';
  let epoch = 0, trainBudget = 0, training = false;

  function randn() {
    let u = 0, v = 0;
    while (!u) u = Math.random();
    while (!v) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function genBlobs() {
    const pts = [];
    [[-0.5, -0.3], [0.5, 0.35]].forEach((c, label) => {
      for (let i = 0; i < 40; i++) pts.push({ x: c[0] + randn() * 0.22, y: c[1] + randn() * 0.22, label });
    });
    return pts;
  }
  function genSpiral() {
    const pts = [];
    for (let label = 0; label < 2; label++) {
      for (let i = 0; i < 70; i++) {
        const r = i / 70;
        const t = r * 4 * Math.PI + label * Math.PI + (Math.random() - 0.5) * 0.3;
        pts.push({ x: Math.cos(t) * r * 0.85, y: Math.sin(t) * r * 0.85, label });
      }
    }
    return pts;
  }
  function genXor() {
    const pts = [];
    for (let i = 0; i < 140; i++) {
      const x = (Math.random() * 2 - 1) * 0.9;
      const y = (Math.random() * 2 - 1) * 0.9;
      pts.push({ x, y, label: (x > 0) !== (y > 0) ? 1 : 0 });
    }
    return pts;
  }
  const DATASETS = { blobs: genBlobs, spiral: genSpiral, xor: genXor };

  function buildNet() {
    net = new convnetjs.Net();
    net.makeLayers([
      { type: 'input', out_sx: 1, out_sy: 1, out_depth: 2 },
      { type: 'fc', num_neurons: 16, activation: 'tanh' },
      { type: 'fc', num_neurons: 16, activation: 'tanh' },
      { type: 'softmax', num_classes: 2 }
    ]);
    trainer = new convnetjs.SGDTrainer(net, { learning_rate: 0.02, momentum: 0.9, batch_size: 1, l2_decay: 0.001 });
  }

  function hexToRgb(hex) {
    const h = (hex || '').replace('#', '').trim();
    const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    const n = parseInt(full || '000000', 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mixColor(t) {
    const a = hexToRgb(token('--accent') || '#5645D6');
    const b = hexToRgb(token('--accent2') || '#0C8C86');
    const r = Math.round(a[0] + (b[0] - a[0]) * t);
    const g = Math.round(a[1] + (b[1] - a[1]) * t);
    const bl = Math.round(a[2] + (b[2] - a[2]) * t);
    return `rgb(${r},${g},${bl})`;
  }

  function toCanvas(x, y) { return { cx: (x + 1) / 2 * W, cy: (1 - (y + 1) / 2) * H }; }
  function toData(cx, cy) { return { x: (cx / W) * 2 - 1, y: (1 - (cy / H)) * 2 - 1 }; }

  function loadDataset(name) {
    currentDs = name;
    points = DATASETS[name]();
    buildNet();
    epoch = 0; trainBudget = 0; training = false;
    trainBtn.textContent = 'Train';
    updateStats(NaN);
    render();
  }

  function size() {
    const w = canvas.clientWidth || 360;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(w * dpr);
    canvas.style.height = w + 'px';
    ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    W = w; H = w;
    render();
  }

  function render() {
    if (!ctx || !net) return;
    const cell = 10;
    for (let py = 0; py < H; py += cell) {
      for (let px = 0; px < W; px += cell) {
        const d = toData(px + cell / 2, py + cell / 2);
        net.forward(new convnetjs.Vol([d.x, d.y]), false);
        const p = net.layers[net.layers.length - 1].out_act.w;
        const t = (p[1] - p[0] + 1) / 2;
        ctx.fillStyle = mixColor(t);
        ctx.globalAlpha = 0.5;
        ctx.fillRect(px, py, cell, cell);
      }
    }
    ctx.globalAlpha = 1;
    points.forEach(pt => {
      const { cx, cy } = toCanvas(pt.x, pt.y);
      ctx.beginPath();
      ctx.fillStyle = pt.label === 0 ? (token('--accent') || '#5645D6') : (token('--accent2') || '#0C8C86');
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = token('--card') || '#fff';
      ctx.stroke();
    });
  }

  function updateStats(loss) {
    epochEl.textContent = String(epoch);
    lossEl.textContent = Number.isFinite(loss) ? loss.toFixed(3) : '…';
  }

  function trainTick() {
    if (trainBudget <= 0) { training = false; trainBtn.textContent = 'Train'; return; }
    const shuffled = points.slice().sort(() => Math.random() - 0.5);
    let lossSum = 0;
    shuffled.forEach(pt => {
      const res = trainer.train(new convnetjs.Vol([pt.x, pt.y]), pt.label);
      lossSum += res.loss;
    });
    epoch++;
    trainBudget--;
    updateStats(lossSum / Math.max(1, shuffled.length));
    render();
    requestAnimationFrame(trainTick);
  }

  trainBtn?.addEventListener('click', () => {
    trainBudget += 150;
    if (!training) { training = true; trainBtn.textContent = 'Training…'; requestAnimationFrame(trainTick); }
  });
  resetBtn?.addEventListener('click', () => loadDataset(currentDs));

  dsBtns.forEach(b => b.addEventListener('click', () => {
    dsBtns.forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    loadDataset(b.dataset.ds);
  }));

  classABtn?.addEventListener('click', () => {
    currentClass = 0;
    classABtn.setAttribute('aria-pressed', 'true');
    classBBtn.setAttribute('aria-pressed', 'false');
  });
  classBBtn?.addEventListener('click', () => {
    currentClass = 1;
    classBBtn.setAttribute('aria-pressed', 'true');
    classABtn.setAttribute('aria-pressed', 'false');
  });

  canvas.addEventListener('click', e => {
    const r = canvas.getBoundingClientRect();
    const cx = e.clientX - r.left, cy = e.clientY - r.top;
    const d = toData(cx, cy);
    points.push({ x: d.x, y: d.y, label: currentClass });
    render();
  });

  window.addEventListener('resize', size, { passive: true });
  window.addEventListener('themechange', render);

  loadDataset('blobs');
  size();
})();
