/* =========================================================
   RL Pong — replays genuine saved checkpoints from an offline
   policy-gradient (REINFORCE) training run. Physics here
   mirror train_pong.py exactly so behaviour is faithful to
   what was actually measured for each checkpoint's win rate.
   Drawn as a 3D table; the game itself runs at a fixed 60 steps
   a second whatever the display's refresh rate.
   ========================================================= */
(function () {
  const host = $('#pongStage');
  if (!host) return;

  const stagesEl = $('#pongStages');
  const winEl = $('#pongWin'), epEl = $('#pongEp');
  const readout = $('#pongReadout');
  const toggleBtn = $('#pongToggle');
  const curveCv = $('#pongCurve');

  const LABELS = ['Untrained', 'Early', 'Learning', 'Improving', 'Confident', 'Best'];

  let meta = null, checkpoints = [], current = null, curveChart = null;
  let running = true;
  let tally = { wins: 0, losses: 0 };
  const state = { bx: 0.5, by: 0.5, bvx: 0, bvy: 0, agentY: 0.5, oppY: 0.5, oppTarget: 0.5, step: 0 };

  function randn() {
    let u = 0, v = 0;
    while (!u) u = Math.random();
    while (!v) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function serve() {
    state.bx = 0.5;
    state.by = 0.3 + Math.random() * 0.4;
    const angle = Math.random() * 0.7 - 0.35;
    const dir = Math.random() < 0.5 ? -1 : 1;
    state.bvx = dir * meta.ballSpeed;
    state.bvy = angle * meta.ballSpeed;
    state.step = 0;
  }

  function forwardGreedy(p, x) {
    const H = p.W1.length, h = new Array(H);
    for (let i = 0; i < H; i++) {
      let s = p.b1[i];
      const row = p.W1[i];
      for (let j = 0; j < row.length; j++) s += row[j] * x[j];
      h[i] = Math.tanh(s);
    }
    let best = 0, bestV = -Infinity;
    for (let i = 0; i < p.W2.length; i++) {
      let s = p.b2[i];
      const row = p.W2[i];
      for (let j = 0; j < row.length; j++) s += row[j] * h[j];
      if (s > bestV) { bestV = s; best = i; }
    }
    return best;
  }

  function oppMove() {
    if (state.step % meta.oppReactEvery === 0) state.oppTarget = state.bvx < 0 ? state.by + randn() * meta.oppNoise : 0.5;
    if (state.oppY < state.oppTarget - 0.01) state.oppY += meta.oppSpeed;
    else if (state.oppY > state.oppTarget + 0.01) state.oppY -= meta.oppSpeed;
    state.oppY = Math.min(1 - meta.paddleHalf, Math.max(meta.paddleHalf, state.oppY));
  }

  let flash = 0, flashSide = 0;
  function tick() {
    if (!current) return;
    const x = [state.bx, state.by, state.bvx / meta.ballSpeed, state.bvy / meta.ballSpeed, state.agentY, state.oppY];
    const a = forwardGreedy(current, x);
    if (a === 0) state.agentY = Math.min(1 - meta.paddleHalf, state.agentY + meta.paddleSpeed);
    else if (a === 1) state.agentY = Math.max(meta.paddleHalf, state.agentY - meta.paddleSpeed);

    oppMove();

    state.bx += state.bvx; state.by += state.bvy;
    if (state.by <= 0) { state.by = -state.by; state.bvy = -state.bvy; }
    else if (state.by >= 1) { state.by = 2 - state.by; state.bvy = -state.bvy; }

    let scored = null;
    if (state.bx <= meta.oppX) {
      if (Math.abs(state.by - state.oppY) <= meta.paddleHalf) {
        state.bx = meta.oppX; state.bvx = Math.abs(state.bvx);
        state.bvy += (Math.random() * 0.012 - 0.006);
      } else scored = 'agent';
    } else if (state.bx >= meta.agentX) {
      if (Math.abs(state.by - state.agentY) <= meta.paddleHalf) {
        state.bx = meta.agentX; state.bvx = -Math.abs(state.bvx);
        state.bvy += (state.by - state.agentY) * 0.05;
      } else scored = 'opponent';
    }

    state.step++;
    if (state.step > 400) scored = scored || 'timeout';
    if (scored) {
      if (scored === 'agent') { tally.wins++; flash = 1; flashSide = -1; }
      else if (scored === 'opponent') { tally.losses++; flash = 1; flashSide = 1; }
      serve();
      updateReadout();
    }
  }

  /* ── 3D table ───────────────────────────────────────── */
  const TW = 3.4, TD = 2.04;                 // table width (game x) and depth (game y)
  const gx = x => (x - 0.5) * TW, gz = y => (y - 0.5) * TD;
  let st, ball, ballGlow, agent, opp, trail, trailPos, trailCol, goalL, goalR, C = {};
  const TRAIL = 16, hist = [];

  function build() {
    if (!hasWebGL()) { host.insertAdjacentHTML('beforeend', '<p class="stage3d__fallback">This view needs WebGL.</p>'); return; }
    st = createStage(host, { fov: 38, onFrame: frame, onResize: fit });
    const { T, scene } = st;

    const table = new T.Mesh(new T.PlaneGeometry(TW + 0.3, TD + 0.3), new T.MeshBasicMaterial({ color: 0x05070c }));
    table.rotation.x = -Math.PI / 2; table.position.y = -0.002;
    scene.add(table);

    const lineMat = new T.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16 });
    const rim = new T.BufferGeometry().setFromPoints([[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([a, b]) => new T.Vector3(a * TW / 2, 0, b * TD / 2)));
    scene.add(new T.Line(rim, lineMat));
    const mid = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(0, 0, -TD / 2), new T.Vector3(0, 0, TD / 2)]),
      new T.LineDashedMaterial({ color: 0xffffff, dashSize: 0.08, gapSize: 0.1, transparent: true, opacity: 0.22 }));
    mid.computeLineDistances();
    scene.add(mid);
    const g = new T.GridHelper(TW, 17, 0xffffff, 0xffffff);
    g.material.transparent = true; g.material.opacity = 0.035; g.scale.z = TD / TW;
    scene.add(g);

    // goal glows that flash when a point is scored
    const goalGeo = new T.PlaneGeometry(0.5, TD);
    const mkGoal = x => { const m = new T.Mesh(goalGeo, new T.MeshBasicMaterial({ transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.001, 0); scene.add(m); return m; };
    goalL = mkGoal(-TW / 2 + 0.25); goalR = mkGoal(TW / 2 - 0.25);

    const ph = meta.paddleHalf * 2 * TD;
    const paddleGeo = new T.BoxGeometry(0.06, 0.1, ph);
    agent = new T.Mesh(paddleGeo, new T.MeshBasicMaterial());
    opp = new T.Mesh(paddleGeo, new T.MeshBasicMaterial({ color: 0x8991ac }));
    agent.position.set(gx(meta.agentX) + 0.03, 0.05, 0);
    opp.position.set(gx(meta.oppX) - 0.03, 0.05, 0);
    const edge = m => { const e = new T.LineSegments(new T.EdgesGeometry(paddleGeo), new T.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 })); m.add(e); };
    edge(agent); edge(opp);
    scene.add(agent, opp);

    ball = new T.Mesh(new T.SphereGeometry(0.04, 18, 14), new T.MeshBasicMaterial({ color: 0xf5f6fa }));
    ballGlow = new T.Sprite(new T.SpriteMaterial({ map: glowTexture(), color: 0xffffff, transparent: true, opacity: 0.7, blending: T.AdditiveBlending, depthWrite: false }));
    ballGlow.scale.setScalar(0.32);
    ball.add(ballGlow);
    scene.add(ball);

    trailPos = new Float32Array(TRAIL * 3); trailCol = new Float32Array(TRAIL * 4);
    const tg = new T.BufferGeometry();
    tg.setAttribute('position', new T.BufferAttribute(trailPos, 3));
    tg.setAttribute('color', new T.BufferAttribute(trailCol, 4));
    trail = new T.Points(tg, new T.PointsMaterial({ size: 0.09, map: glowTexture(), vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false }));
    scene.add(trail);

    // labels that sit on the table
    const lab = document.createElement('div');
    lab.className = 'net3d__labels';
    lab.innerHTML = '<span class="pong3d__tag">scripted opponent</span><span class="pong3d__tag is-agent">RL agent</span>';
    host.appendChild(lab);
    st.tags = $$('.pong3d__tag', lab);

    readColors();
    window.addEventListener('themechange', readColors);
    st.start();
  }

  function readColors() {
    if (!st) return;
    C.a2 = new st.T.Color(token('--accent2') || '#3FE0D0');
    agent.material.color.copy(C.a2);
    goalL.material.color.copy(C.a2);
    goalR.material.color.set(0xff6b81);
  }

  function fit(s) {
    const k = Math.max(1, 1.6 / (s.w / s.h));
    s.camera.position.set(0, 2.5 * k, 3.15 * k);
    s.camera.lookAt(0, -0.1, 0.12);
  }

  let acc = 0, sway = 0;
  function frame(dt, t) {
    if (running && current) {
      acc += dt * 60;
      let n = 0;
      while (acc >= 1 && n < 4) { tick(); acc -= 1; n++; }
      if (n === 4) acc = 0;
    }
    if (!meta) return;
    const T = st.T;
    ball.position.set(gx(state.bx), 0.045, gz(state.by));
    agent.position.z += (gz(state.agentY) - agent.position.z) * 0.6;
    opp.position.z += (gz(state.oppY) - opp.position.z) * 0.6;

    hist.unshift([ball.position.x, ball.position.y, ball.position.z]);
    if (hist.length > TRAIL) hist.pop();
    for (let i = 0; i < TRAIL; i++) {
      const p = hist[i] || hist[hist.length - 1];
      trailPos[i * 3] = p[0]; trailPos[i * 3 + 1] = p[1]; trailPos[i * 3 + 2] = p[2];
      const a = (1 - i / TRAIL) * 0.45;
      trailCol[i * 4] = C.a2.r; trailCol[i * 4 + 1] = C.a2.g; trailCol[i * 4 + 2] = C.a2.b; trailCol[i * 4 + 3] = a;
    }
    trail.geometry.attributes.position.needsUpdate = true;
    trail.geometry.attributes.color.needsUpdate = true;

    flash = Math.max(0, flash - dt * 1.6);
    goalL.material.opacity = flashSide < 0 ? flash * 0.5 : 0;
    goalR.material.opacity = flashSide > 0 ? flash * 0.5 : 0;

    // a slow drift of the camera, toward the pointer when there is one
    const target = st.pointer.active ? st.pointer.x * 0.35 : (reduceMotion ? 0 : Math.sin(t * 0.2) * 0.12);
    sway += (target - sway) * 0.05;
    const k = Math.max(1, 1.6 / (st.w / st.h));
    st.camera.position.x = sway * 2.4 * k;
    st.camera.lookAt(0, -0.1, 0.12);

    const place = (el, v) => { const s = st.toScreen(v); el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px)`; };
    place(st.tags[0], new T.Vector3(gx(0) + 0.35, 0, TD / 2 + 0.12));
    place(st.tags[1], new T.Vector3(gx(1) - 0.35, 0, TD / 2 + 0.12));
  }

  function updateReadout() {
    if (!current) return;
    winEl.textContent = current.winRate + '%';
    epEl.textContent = current.episode.toLocaleString();
    readout.innerHTML = `<b>${current.winRate}%</b> win rate · <b>${current.lossRate ?? (100 - current.winRate - (current.drawRate || 0)).toFixed(1)}%</b> loss rate, measured over 1,500 evaluation rallies at episode ${current.episode.toLocaleString()}. This session: <b>${tally.wins}</b>–<b>${tally.losses}</b> (agent–opponent).`;
  }

  function selectCheckpoint(idx) {
    current = checkpoints[idx];
    tally = { wins: 0, losses: 0 };
    state.agentY = 0.5; state.oppY = 0.5; state.oppTarget = 0.5;
    serve();
    $$('.stagebtn', stagesEl).forEach((b, i) => b.setAttribute('aria-pressed', String(i === idx)));
    updateReadout();
    updateCurveHighlight(idx);
  }

  function buildStages() {
    stagesEl.innerHTML = '';
    checkpoints.forEach((cp, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'stagebtn';
      b.textContent = LABELS[i] || ('ep ' + cp.episode);
      b.title = `Episode ${cp.episode.toLocaleString()} · ${cp.winRate}% win rate`;
      b.addEventListener('click', () => selectCheckpoint(i));
      stagesEl.appendChild(b);
    });
  }

  function buildCurve() {
    if (typeof Chart === 'undefined' || !curveCv) return;
    curveChart = new Chart(curveCv.getContext('2d'), {
      type: 'line',
      data: {
        labels: checkpoints.map(c => c.episode.toLocaleString()),
        datasets: [{
          data: checkpoints.map(c => c.winRate),
          borderColor: token('--accent2') || '#3FE0D0',
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: checkpoints.map(() => 3),
          pointBackgroundColor: token('--accent2') || '#3FE0D0',
          tension: 0.25
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => c.parsed.y + '% win rate' } } },
        scales: {
          x: { ticks: { color: token('--mute'), font: { size: 9 } }, grid: { display: false } },
          y: { ticks: { color: token('--mute'), font: { size: 9 } }, grid: { color: token('--rule') }, min: 0, max: 100 }
        }
      }
    });
  }
  function updateCurveHighlight(idx) {
    if (!curveChart) return;
    curveChart.data.datasets[0].pointRadius = checkpoints.map((_, i) => i === idx ? 6 : 3);
    curveChart.update();
  }

  function init() {
    if (typeof window.PONG_DATA === 'undefined') {
      readout.textContent = 'Could not load the training checkpoints.';
      return;
    }
    meta = window.PONG_DATA.meta;
    checkpoints = window.PONG_DATA.checkpoints;
    buildStages();
    buildCurve();
    selectCheckpoint(checkpoints.length - 1);
    build();
  }

  toggleBtn?.addEventListener('click', () => {
    running = !running;
    toggleBtn.textContent = running ? 'Pause' : 'Resume';
  });

  whenNear(host, () => {
    Promise.all([loadScript('assets/data/pong-checkpoints.js'), loadScript('assets/js/vendor/chart.umd.js'), loadThree()])
      .then(init)
      .catch(() => { readout.textContent = 'Could not load the demo.'; });
  });
})();
