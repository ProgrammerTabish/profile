/* =========================================================
   MCP explainer — animates a request flowing from the user
   through an AI model, an MCP server, and two existing tools
   (Jira + a diagnostics suite), and a grounded answer back.
   The nodes stand on a tilted 3D floor (pure CSS transforms), so
   positions are measured in the floor's own layout coordinates,
   not on screen, and the packet travels along the floor.
   ========================================================= */
(function () {
  const stage = $('#mcpStage');
  if (!stage) return;

  const playBtn = $('#mcpPlay'), resetBtn = $('#mcpReset'), logEl = $('#mcpLog');
  const packet = $('#mcpPacket');
  const floor = $('.mcpviz__floor', stage) || stage;

  let edge = document.createElement('div');
  edge.className = 'mcpedge';
  floor.appendChild(edge);

  const STEPS = [
    { from: 'mcpUser', to: 'mcpModel', text: 'You ask: "Board B3 failed overnight, why?"' },
    { from: 'mcpModel', to: 'mcpServer', text: "The model doesn't know, so it calls a tool over MCP." },
    { from: 'mcpServer', to: 'mcpJira', text: 'MCP server looks up open tickets for board B3.' },
    { from: 'mcpJira', to: 'mcpServer', text: 'Jira returns two related tickets.' },
    { from: 'mcpServer', to: 'mcpDiag', text: 'MCP server re-runs the matching test on the real board.' },
    { from: 'mcpDiag', to: 'mcpServer', text: 'The diagnostics suite returns fresh hardware results.' },
    { from: 'mcpServer', to: 'mcpModel', text: 'MCP server hands back structured, grounded data.' },
    { from: 'mcpModel', to: 'mcpResult', text: 'The model answers using real data, not a guess.' }
  ];

  let cancelToken = 0;

  /* where a node touches the floor: its bottom centre, in floor coordinates */
  function centerOf(el) {
    return { x: el.offsetLeft + el.offsetWidth / 2, y: el.offsetTop + el.offsetHeight };
  }

  function positionEdge(a, b) {
    const pa = centerOf(a), pb = centerOf(b);
    const dx = pb.x - pa.x, dy = pb.y - pa.y;
    const len = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx) * 180 / Math.PI;
    edge.style.left = pa.x + 'px';
    edge.style.top = pa.y + 'px';
    edge.style.width = len + 'px';
    edge.style.transform = `rotate(${ang}deg)`;
  }

  function logStep(text, active) {
    if (!logEl) return;
    $$('li', logEl).forEach(li => li.classList.remove('is-now'));
    const li = document.createElement('li');
    li.textContent = text;
    if (active) li.classList.add('is-now');
    logEl.appendChild(li);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function runStep(step, token_, dur) {
    return new Promise(resolve => {
      const a = document.getElementById(step.from), b = document.getElementById(step.to);
      if (!a || !b) return resolve();
      a.classList.add('is-active'); b.classList.add('is-active');
      positionEdge(a, b);
      edge.classList.add('is-active');

      const pa = centerOf(a), pb = centerOf(b);
      packet.style.transition = 'none';
      packet.style.left = pa.x + 'px'; packet.style.top = pa.y + 'px';
      packet.style.opacity = '1';
      void packet.offsetWidth; // force reflow so the transition below actually animates
      packet.style.transition = `left ${dur}ms ease, top ${dur}ms ease`;
      packet.style.left = pb.x + 'px'; packet.style.top = pb.y + 'px';

      logStep(step.text, true);

      setTimeout(() => {
        if (token_ !== cancelToken) return resolve();
        packet.style.opacity = '0';
        a.classList.remove('is-active'); b.classList.remove('is-active');
        edge.classList.remove('is-active');
        resolve();
      }, dur + 300);
    });
  }

  async function play() {
    reset(false);
    const myToken = ++cancelToken;
    playBtn.disabled = true;
    playBtn.textContent = 'Playing…';
    for (const step of STEPS) {
      if (myToken !== cancelToken) break;
      await runStep(step, myToken, 700);
    }
    if (myToken === cancelToken) {
      playBtn.disabled = false;
      playBtn.textContent = 'Play again';
    }
  }

  function reset(clearBtn) {
    cancelToken++;
    $$('.mcpnode', stage).forEach(n => n.classList.remove('is-active'));
    edge.classList.remove('is-active');
    packet.style.opacity = '0';
    if (logEl) logEl.innerHTML = '<li>Press play to send a request through the system.</li>';
    if (clearBtn !== false) { playBtn.disabled = false; playBtn.textContent = 'Play the flow'; }
  }

  // lean the floor toward the pointer
  if (finePointer && !reduceMotion) {
    stage.addEventListener('pointermove', e => {
      const r = stage.getBoundingClientRect();
      stage.style.setProperty('--rz', (((e.clientX - r.left) / r.width - 0.5) * -10).toFixed(2) + 'deg');
      stage.style.setProperty('--tx', (40 + ((e.clientY - r.top) / r.height - 0.5) * -8).toFixed(2) + 'deg');
    });
    stage.addEventListener('pointerleave', () => { stage.style.removeProperty('--rz'); stage.style.removeProperty('--tx'); });
  }

  playBtn?.addEventListener('click', play);
  resetBtn?.addEventListener('click', () => reset());

  reset();
})();
