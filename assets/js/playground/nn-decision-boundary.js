/* =========================================================
   Decision-boundary playground, in 3D. A tiny network (2 -> 16
   tanh -> 16 tanh -> softmax 2) trains live on points you place.

   The sheet is the network's output over the whole plane: its
   height is p(class B), so class A points sit on the floor and
   class B points float at full height, and training is literally
   bending the sheet until it passes through all of them. The
   glowing line is where the sheet crosses one half: the decision
   boundary. Drag to orbit, click to drop a point, or switch to the
   top view to see the classic flat map.
   ========================================================= */
(function () {
  const host = $('#dbStage');
  if (!host) return;

  const epochEl = $('#dbEpoch'), lossEl = $('#dbLoss');
  const trainBtn = $('#dbTrain'), resetBtn = $('#dbReset'), viewBtn = $('#dbView');
  const classABtn = $('#dbClassA'), classBBtn = $('#dbClassB');
  const dsBtns = $$('[data-ds]');

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
    for (let label = 0; label < 2; label++) for (let i = 0; i < 70; i++) {
      const r = i / 70, t = r * 4 * Math.PI + label * Math.PI + (Math.random() - 0.5) * 0.3;
      pts.push({ x: Math.cos(t) * r * 0.85, y: Math.sin(t) * r * 0.85, label });
    }
    return pts;
  }
  function genXor() {
    const pts = [];
    for (let i = 0; i < 140; i++) {
      const x = (Math.random() * 2 - 1) * 0.9, y = (Math.random() * 2 - 1) * 0.9;
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
  const pB = (x, y) => { net.forward(new convnetjs.Vol([x, y]), false); return net.layers[net.layers.length - 1].out_act.w[1]; };

  /* ── scene ──────────────────────────────────────────── */
  const N = 40, HGT = 0.9, MAXPTS = 600;
  let st, T, surfGeo, surfMat, wireMat, ptsMesh, contour, floorContour, gridH, floorMat;
  const grid = new Float32Array((N + 1) * (N + 1));
  let C = {};
  const view = { az: -0.65, el: 0.62, dist: 4.5, tAz: -0.65, tEl: 0.62, top: false };

  function build() {
    if (!hasWebGL()) { host.insertAdjacentHTML('beforeend', '<p class="stage3d__fallback">This view needs WebGL.</p>'); return; }
    st = createStage(host, { fov: 36, onFrame: frame });
    T = st.T;
    const { scene } = st;

    // the output sheet: a plane on the floor whose vertices are lifted to p(B)
    surfGeo = new T.PlaneGeometry(2, 2, N, N);
    surfGeo.rotateX(-Math.PI / 2);
    surfGeo.setAttribute('color', new T.BufferAttribute(new Float32Array(surfGeo.attributes.position.count * 3), 3));
    surfMat = new T.MeshBasicMaterial({ vertexColors: true, side: T.DoubleSide, transparent: true, opacity: 0.72, depthWrite: false });
    wireMat = new T.MeshBasicMaterial({ wireframe: true, transparent: true, opacity: 0.16 });
    const surf = new T.Mesh(surfGeo, surfMat);
    surf.name = 'surface';
    scene.add(surf, new T.Mesh(surfGeo, wireMat));

    // floor frame and grid
    floorMat = new T.LineBasicMaterial({ transparent: true, opacity: 0.5 });
    const f = [-1, -1, 1, -1, 1, 1, -1, 1, -1, -1];
    const fg = new T.BufferGeometry();
    fg.setAttribute('position', new T.Float32BufferAttribute(f.reduce((a, v, i) => (i % 2 ? a.push(0, v) : a.push(v), a), []), 3));
    scene.add(new T.Line(fg, floorMat));
    gridH = new T.GridHelper(2, 8);
    gridH.material.transparent = true; gridH.material.opacity = 0.18;
    scene.add(gridH);

    // the training points
    ptsMesh = new T.InstancedMesh(new T.SphereGeometry(0.034, 12, 10), new T.MeshBasicMaterial(), MAXPTS);
    ptsMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    scene.add(ptsMesh);

    // decision boundary (p = 0.5): on the sheet, and its shadow on the floor
    const mkContour = (opacity) => {
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(new Float32Array(N * N * 4 * 3), 3));
      g.setDrawRange(0, 0);
      const m = new T.LineSegments(g, new T.LineBasicMaterial({ transparent: true, opacity }));
      scene.add(m);
      return m;
    };
    contour = mkContour(1);
    floorContour = mkContour(0.55);

    readColors();
    window.addEventListener('themechange', () => { readColors(); render(); });
    bindOrbit();
    loadDataset('blobs');
    st.start();
  }

  function readColors() {
    const c = s => new T.Color(token(s) || '#888');
    C = { a: c('--accent'), b: c('--accent2'), rule: c('--rule'), mute: c('--mute'), ink: c('--ink') };
    wireMat.color.copy(isDark() ? C.mute : C.ink);
    floorMat.color.copy(C.mute);
    gridH.material.color.copy(C.mute);
    contour.material.color.copy(C.ink);
    floorContour.material.color.copy(C.ink);
  }

  /* recompute the sheet, the points and the boundary from the current net */
  function render() {
    if (!st || !net) return;
    const pos = surfGeo.attributes.position, col = surfGeo.attributes.color;
    const col3 = new T.Color();
    for (let iz = 0; iz <= N; iz++) for (let ix = 0; ix <= N; ix++) {
      const k = iz * (N + 1) + ix;
      const x = -1 + 2 * ix / N, z = -1 + 2 * iz / N;     // world z = −data y
      const p = pB(x, -z);
      grid[k] = p;
      pos.setY(k, p * HGT);
      col3.copy(C.a).lerp(C.b, p);
      col.setXYZ(k, col3.r, col3.g, col3.b);
    }
    pos.needsUpdate = true; col.needsUpdate = true;

    const m = new T.Matrix4();
    points.slice(0, MAXPTS).forEach((pt, i) => {
      m.makeTranslation(pt.x, pt.label * HGT, -pt.y);
      ptsMesh.setMatrixAt(i, m);
      ptsMesh.setColorAt(i, pt.label === 0 ? C.a : C.b);
    });
    ptsMesh.count = Math.min(points.length, MAXPTS);
    ptsMesh.instanceMatrix.needsUpdate = true;
    if (ptsMesh.instanceColor) ptsMesh.instanceColor.needsUpdate = true;

    marchingSquares();
  }

  /* p = 0.5 iso-line over the grid, as line segments */
  function marchingSquares() {
    const a = contour.geometry.attributes.position.array, b = floorContour.geometry.attributes.position.array;
    let n = 0;
    const at = (ix, iz) => grid[iz * (N + 1) + ix];
    const wx = ix => -1 + 2 * ix / N;
    const push = (x, z) => { a[n] = x; a[n + 1] = 0.5 * HGT + 0.004; a[n + 2] = z; b[n] = x; b[n + 1] = 0.003; b[n + 2] = z; n += 3; };
    for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) {
      const v = [at(ix, iz), at(ix + 1, iz), at(ix + 1, iz + 1), at(ix, iz + 1)];
      const c = [[wx(ix), wx(iz)], [wx(ix + 1), wx(iz)], [wx(ix + 1), wx(iz + 1)], [wx(ix), wx(iz + 1)]];
      const cross = [];
      for (let e = 0; e < 4; e++) {
        const p0 = v[e], p1 = v[(e + 1) % 4];
        if ((p0 - 0.5) * (p1 - 0.5) < 0) {
          const t = (0.5 - p0) / (p1 - p0);
          const q0 = c[e], q1 = c[(e + 1) % 4];
          cross.push([q0[0] + (q1[0] - q0[0]) * t, q0[1] + (q1[1] - q0[1]) * t]);
        }
      }
      for (let k = 0; k + 1 < cross.length; k += 2) { push(cross[k][0], cross[k][1]); push(cross[k + 1][0], cross[k + 1][1]); }
    }
    contour.geometry.setDrawRange(0, n / 3); floorContour.geometry.setDrawRange(0, n / 3);
    contour.geometry.attributes.position.needsUpdate = true; floorContour.geometry.attributes.position.needsUpdate = true;
  }

  function frame(dt, t) {
    const idle = !dragging && !view.top && !reduceMotion;
    view.az += ((view.tAz + (idle ? Math.sin(t * 0.25) * 0.12 : 0)) - view.az) * 0.08;
    view.el += (view.tEl - view.el) * 0.08;
    const cam = st.camera, r = view.dist;
    cam.position.set(Math.sin(view.az) * Math.cos(view.el) * r, 0.3 + Math.sin(view.el) * r, Math.cos(view.az) * Math.cos(view.el) * r);
    cam.lookAt(0, 0.3, 0);
  }

  /* drag to orbit; a click that didn't move drops a point */
  let dragging = false;
  function bindOrbit() {
    let down = null;
    const ray = new T.Raycaster(), ndc = new T.Vector2(), floor = new T.Plane(new T.Vector3(0, 1, 0), 0), hit = new T.Vector3();
    host.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, az: view.tAz, el: view.tEl }; host.setPointerCapture(e.pointerId); });
    host.addEventListener('pointermove', e => {
      if (!down) return;
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (!dragging && Math.hypot(dx, dy) > 6) dragging = true;
      if (dragging) {
        view.top = false; viewBtn?.setAttribute('aria-pressed', 'false');
        view.tAz = down.az - dx * 0.008;
        view.tEl = Math.min(1.45, Math.max(0.12, down.el + dy * 0.006));
      }
    });
    host.addEventListener('pointerup', e => {
      if (down && !dragging) {
        const r = host.getBoundingClientRect();
        ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(ndc, st.camera);
        const surf = st.scene.getObjectByName('surface');
        const hits = ray.intersectObject(surf);
        const p = hits.length ? hits[0].point : ray.ray.intersectPlane(floor, hit);
        if (p && Math.abs(p.x) <= 1 && Math.abs(p.z) <= 1) { points.push({ x: p.x, y: -p.z, label: currentClass }); render(); }
      }
      down = null; dragging = false;
    });
  }

  viewBtn?.addEventListener('click', () => {
    view.top = !view.top;
    viewBtn.setAttribute('aria-pressed', String(view.top));
    viewBtn.textContent = view.top ? '3D view' : 'Top view';
    if (view.top) { view.tAz = 0; view.tEl = 1.5; } else { view.tAz = -0.65; view.tEl = 0.62; }
  });

  function loadDataset(name) {
    currentDs = name;
    points = DATASETS[name]();
    buildNet();
    epoch = 0; trainBudget = 0; training = false;
    trainBtn.textContent = 'Train';
    updateStats(NaN);
    render();
  }

  function updateStats(loss) {
    epochEl.textContent = String(epoch);
    lossEl.textContent = Number.isFinite(loss) ? loss.toFixed(3) : '…';
  }

  function trainTick() {
    if (trainBudget <= 0) { training = false; trainBtn.textContent = 'Train'; return; }
    const shuffled = points.slice().sort(() => Math.random() - 0.5);
    let lossSum = 0;
    shuffled.forEach(pt => { lossSum += trainer.train(new convnetjs.Vol([pt.x, pt.y]), pt.label).loss; });
    epoch++; trainBudget--;
    updateStats(lossSum / Math.max(1, shuffled.length));
    render();
    requestAnimationFrame(trainTick);
  }

  trainBtn?.addEventListener('click', () => {
    if (!net) return;
    trainBudget += 150;
    if (!training) { training = true; trainBtn.textContent = 'Training…'; requestAnimationFrame(trainTick); }
  });
  resetBtn?.addEventListener('click', () => net && loadDataset(currentDs));
  dsBtns.forEach(b => b.addEventListener('click', () => {
    if (!net) return;
    dsBtns.forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    loadDataset(b.dataset.ds);
  }));
  classABtn?.addEventListener('click', () => { currentClass = 0; classABtn.setAttribute('aria-pressed', 'true'); classBBtn.setAttribute('aria-pressed', 'false'); });
  classBBtn?.addEventListener('click', () => { currentClass = 1; classBBtn.setAttribute('aria-pressed', 'true'); classABtn.setAttribute('aria-pressed', 'false'); });

  // Nothing is fetched until the demo is close to the screen.
  whenNear(host, () => {
    Promise.all([loadScript('assets/js/vendor/convnet.js'), loadThree()]).then(build)
      .catch(() => host.insertAdjacentHTML('beforeend', '<p class="stage3d__fallback">Could not load the demo.</p>'));
  });
})();
