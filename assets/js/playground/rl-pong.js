/* =========================================================
   RL Pong — replays genuine saved checkpoints from an offline
   policy-gradient (REINFORCE) training run. Physics here
   mirror train_pong.py exactly so behaviour is faithful to
   what was actually measured for each checkpoint's win rate.
   ========================================================= */
(function () {
  const canvas = $('#pongCanvas');
  if (!canvas) return;

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
    const H = p.W1.length;
    const h = new Array(H);
    for (let i = 0; i < H; i++) {
      let s = p.b1[i];
      const row = p.W1[i];
      for (let j = 0; j < row.length; j++) s += row[j] * x[j];
      h[i] = Math.tanh(s);
    }
    const O = p.W2.length;
    let best = 0, bestV = -Infinity;
    for (let i = 0; i < O; i++) {
      let s = p.b2[i];
      const row = p.W2[i];
      for (let j = 0; j < row.length; j++) s += row[j] * h[j];
      if (s > bestV) { bestV = s; best = i; }
    }
    return best;
  }

  function oppMove() {
    if (state.step % meta.oppReactEvery === 0) {
      state.oppTarget = state.bvx < 0 ? state.by + randn() * meta.oppNoise : 0.5;
    }
    if (state.oppY < state.oppTarget - 0.01) state.oppY += meta.oppSpeed;
    else if (state.oppY > state.oppTarget + 0.01) state.oppY -= meta.oppSpeed;
    state.oppY = Math.min(1 - meta.paddleHalf, Math.max(meta.paddleHalf, state.oppY));
  }

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
      if (scored === 'agent') tally.wins++;
      else if (scored === 'opponent') tally.losses++;
      serve();
      updateReadout();
    }
  }

  function draw() {
    const r = fitCanvas(canvas, 5 / 3);
    const ctx = r.ctx, W = r.w, H = r.h;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#05070C';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.setLineDash([6, 8]);
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
    ctx.setLineDash([]);

    const pw = W * 0.014, ph = H * meta.paddleHalf * 2;
    ctx.fillStyle = token('--mute') || '#8991AC';
    ctx.fillRect(meta.oppX * W - pw / 2, state.oppY * H - ph / 2, pw, ph);
    ctx.fillStyle = token('--accent2') || '#3FE0D0';
    ctx.fillRect(meta.agentX * W - pw / 2, state.agentY * H - ph / 2, pw, ph);

    ctx.beginPath();
    ctx.fillStyle = '#F5F6FA';
    ctx.arc(state.bx * W, state.by * H, W * 0.011, 0, Math.PI * 2);
    ctx.fill();
  }

  let raf = null;
  function loop() {
    if (running) { tick(); draw(); }
    raf = requestAnimationFrame(loop);
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
        responsive: true, maintainAspectRatio: false,
        animation: false,
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
      readout.textContent = 'Could not load the training checkpoints. assets/data/pong-checkpoints.js did not load.';
      return;
    }
    meta = window.PONG_DATA.meta;
    checkpoints = window.PONG_DATA.checkpoints;
    buildStages();
    buildCurve();
    selectCheckpoint(checkpoints.length - 1);
    loop();
  }

  toggleBtn?.addEventListener('click', () => {
    running = !running;
    toggleBtn.textContent = running ? 'Pause' : 'Resume';
  });
  window.addEventListener('resize', draw, { passive: true });
  window.addEventListener('themechange', draw);

  init();
})();
