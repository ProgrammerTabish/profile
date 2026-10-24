/* Water in a bottle – data collector (browser side).
   Capture: scale photo -> bottle type -> images (tap = 1, hold = burst) -> next bottle.
   Every photo is resized, JPEG-compressed, tagged with the owner in EXIF and queued in IndexedDB;
   the queue is uploaded to the private Apps Script backend in order, in batches, with retries.
   Review: label each bottle from its scale photo (no OCR), discard bad images, approve. */
(function () {
  'use strict';

  const CFG = window.AIP_CONFIG || {};
  const OWNER = CFG.ownerTag || 'ShaikhZakaTabish_Awais';
  const LS = 'aip.';
  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------------ small utils
  function load(key, fallback) {
    try { const v = localStorage.getItem(LS + key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(LS + key, JSON.stringify(value)); } catch (e) { /* private mode */ }
  }
  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  }
  function fmtWeight(v) { return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000); }
  function parseWeight(s) {
    s = String(s || '').trim().replace(',', '.');
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    return Number(s);
  }
  function blobToB64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }
  function b64ToUrl(b64) { return 'data:image/jpeg;base64,' + b64; }
  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  let toastTimer = 0;
  function toast(text, bad) {
    const t = $('toast');
    t.textContent = text;
    t.classList.toggle('is-bad', !!bad);
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, bad ? 5000 : 2600);
  }

  // ------------------------------------------------------------------ state
  const settings = Object.assign({
    rotation: 0, rate: 5, maxSide: 1280, quality: 0.85, deviceId: '', collector: '',
  }, load('settings', {}));
  function saveSettings() { save('settings', settings); }

  const S = {
    pin: '',
    types: load('types', CFG.types || {}),
    view: 'capture',
    step: 'scale',              // scale | type | capture
    pendingScale: null,         // {canvas, blob, w, h, capturedAt}
    sample: null,               // {localId, type, count, weight, sampleId}
    lastSample: null,
    stream: null,
    encoding: 0,
    holding: false,
    burstTimer: 0,
    wakeLock: null,
  };

  // ------------------------------------------------------------------ API
  class ApiError extends Error { constructor(code) { super(code); this.code = code; } }
  const ERRORS = {
    pin: 'Wrong PIN.',
    locked: 'Too many wrong PINs. Try again in 15 minutes.',
    not_set_up: 'The Drive backend is not set up yet: run setup() in the Apps Script editor.',
    network: 'No connection to Drive.',
  };

  async function api(action, data, pin) {
    if (!CFG.endpoint) throw new ApiError('no_endpoint');
    let res;
    try {
      res = await fetch(CFG.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // simple request: no CORS preflight
        body: JSON.stringify(Object.assign({ action, pin: pin || S.pin }, data || {})),
        redirect: 'follow',
      });
    } catch (e) {
      throw new ApiError('network');
    }
    let j;
    try { j = await res.json(); } catch (e) { throw new ApiError('bad_response'); }
    if (!j.ok) {
      if (j.error === 'pin' && S.pin) lock(ERRORS.pin);
      throw new ApiError(j.error || 'error');
    }
    return j;
  }

  function errText(e) {
    const code = e && (e.code || e.message);
    return ERRORS[code] || String(code || 'Something went wrong.');
  }

  function applyServerConfig(cfg) {
    if (cfg && cfg.types) { S.types = cfg.types; save('types', cfg.types); buildTypeGrid(); }
  }

  // ------------------------------------------------------------------ PIN
  function unlockedPin() {
    return sessionStorage.getItem(LS + 'pin') || load('pin', '');
  }

  async function tryUnlock(pin, remember, silent) {
    const msg = $('pinMsg');
    $('pinGo').disabled = true;
    if (!silent) msg.textContent = 'Checking…';
    try {
      const r = await api('ping', {}, pin);
      S.pin = pin;
      sessionStorage.setItem(LS + 'pin', pin);
      if (remember) save('pin', pin); else localStorage.removeItem(LS + 'pin');
      applyServerConfig(r.config);
      showStats(r);
      enterApp();
    } catch (e) {
      if (e.code === 'network' && silent && pin) {      // offline start: capture still works, uploads wait
        S.pin = pin;
        enterApp();
        toast('Offline. Photos are kept on this phone and uploaded later.');
      } else {
        msg.textContent = e.code === 'no_endpoint'
          ? 'Not connected to Drive yet: put the Apps Script web app URL into ai-project/config.js.'
          : errText(e);
        if (e.code === 'pin') { localStorage.removeItem(LS + 'pin'); sessionStorage.removeItem(LS + 'pin'); }
        $('pinInput').select();
      }
    } finally {
      $('pinGo').disabled = false;
    }
  }

  function lock(message) {
    S.pin = '';
    sessionStorage.removeItem(LS + 'pin');
    localStorage.removeItem(LS + 'pin');
    stopCamera();
    $('app').hidden = true;
    $('lock').hidden = false;
    $('pinMsg').textContent = message || '';
    $('pinInput').value = '';
    setTimeout(() => $('pinInput').focus(), 50);
  }

  function enterApp() {
    $('lock').hidden = true;
    $('app').hidden = false;
    $('barWho').textContent = settings.collector ? settings.collector : '';
    showView(S.view);
    pump();
  }

  // ------------------------------------------------------------------ views
  function showView(view) {
    S.view = view;
    $('app').dataset.view = view;
    document.querySelectorAll('.tabs button').forEach((b) => {
      if (b.dataset.view === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    $('viewCapture').hidden = view !== 'capture';
    $('viewReview').hidden = view !== 'review';
    $('viewSetup').hidden = view !== 'setup';
    document.querySelector('meta[name="theme-color"]').content = view === 'capture' ? '#10202C' : getComputedStyle(document.body).backgroundColor;
    if (view === 'capture') startCamera(); else stopCamera();
    if (view === 'review') loadList();
    if (view === 'setup') { renderSetup(); loadLevels(); }
  }

  // ------------------------------------------------------------------ IndexedDB queue
  let dbp = null;
  function db() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open('aip-collector', 1);
        req.onupgradeneeded = () => {
          const d = req.result;
          d.createObjectStore('jobs', { keyPath: 'id', autoIncrement: true });
          d.createObjectStore('samples', { keyPath: 'localId' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbp;
  }
  async function tx(store, mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(store, mode);
      const s = t.objectStore(store);
      let out;
      const r = fn(s);
      if (r && 'onsuccess' in r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('aborted'));
    });
  }
  const jobsAdd = (job) => tx('jobs', 'readwrite', (s) => s.add(job));
  const jobsHead = (n) => tx('jobs', 'readonly', (s) => s.getAll(undefined, n));
  const jobsCount = () => tx('jobs', 'readonly', (s) => s.count());
  const jobsDelete = (ids) => tx('jobs', 'readwrite', (s) => { ids.forEach((id) => s.delete(id)); });
  const jobsClear = () => tx('jobs', 'readwrite', (s) => s.clear());
  const sampleGet = (localId) => tx('samples', 'readonly', (s) => s.get(localId));
  const samplePut = (rec) => tx('samples', 'readwrite', (s) => s.put(rec));

  // ------------------------------------------------------------------ uploader
  const BATCH_BYTES = 2.5 * 1024 * 1024;
  const BATCH_MAX = 8;
  let pumping = false;
  let retryTimer = 0;
  let backoff = 2000;
  let lastError = '';

  async function pump() {
    if (pumping || !S.pin || !CFG.endpoint) return;
    pumping = true;
    clearTimeout(retryTimer);
    try {
      for (;;) {
        const head = await jobsHead(BATCH_MAX);
        if (!head.length) break;
        await updateSync(true);
        const job = head[0];
        if (job.kind === 'start') {
          const r = await api('startSample', {
            type: job.type, weight: job.weight, collector: job.collector, clientId: job.clientId,
            scale: { b64: await blobToB64(job.scale.blob), w: job.scale.w, h: job.scale.h, capturedAt: job.scale.capturedAt },
          });
          await samplePut({ localId: job.localId, sampleId: r.sample.sampleId });
          await jobsDelete([job.id]);
          if (r.warning) toast(r.sample.sampleId + ': ' + r.warning, true);
          if (S.sample && S.sample.localId === job.localId) { S.sample.sampleId = r.sample.sampleId; renderCapture(); }
          if (S.lastSample && S.lastSample.localId === job.localId) S.lastSample.sampleId = r.sample.sampleId;
        } else {
          const map = await sampleGet(job.localId);
          if (!map) throw new Error('bottle of a waiting photo is unknown');
          const batch = [];
          let bytes = 0;
          for (const j of head) {
            if (j.kind !== 'img' || j.localId !== job.localId) break;
            if (batch.length && bytes + j.blob.size > BATCH_BYTES) break;
            batch.push(j);
            bytes += j.blob.size;
          }
          const images = [];
          for (const j of batch) {
            images.push({ clientId: j.clientId, b64: await blobToB64(j.blob), thumb: j.thumb, w: j.w, h: j.h, capturedAt: j.capturedAt });
          }
          await api('uploadImages', { sampleId: map.sampleId, collector: batch[0].collector, images });
          await jobsDelete(batch.map((j) => j.id));
        }
        backoff = 2000;
        lastError = '';
      }
    } catch (e) {
      lastError = errText(e);
      if (e.code !== 'pin') {
        retryTimer = setTimeout(pump, backoff);
        backoff = Math.min(backoff * 2, 60000);
      }
    } finally {
      pumping = false;
      updateSync(false);
    }
  }

  async function updateSync(busy) {
    const n = await jobsCount();
    const pill = $('syncPill');
    let state = 'idle';
    let text = 'All uploaded';
    if (n) {
      state = busy ? 'busy' : lastError ? 'error' : 'waiting';
      text = (busy ? 'Uploading ' : '') + n + ' waiting';
      if (!busy && lastError) text = n + ' waiting · retrying';
    }
    pill.dataset.state = state;
    $('syncText').textContent = text;
    pill.title = lastError || '';
    if (S.view === 'setup') renderQueueStat(n);
    return n;
  }

  // ------------------------------------------------------------------ camera
  const video = $('video');
  const preview = $('preview');
  const pctx = preview.getContext('2d');
  let rafId = 0;

  async function startCamera() {
    if (S.stream) { requestWakeLock(); return; }
    const msg = $('camMsg');
    msg.hidden = true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showCamMsg('This browser cannot use the camera here. Open the page over https in Chrome or Safari.');
      return;
    }
    // resizeMode 'none' = only the camera's own modes; no cropping to the requested aspect ratio
    const base = { width: { ideal: 1280 }, height: { ideal: 720 }, resizeMode: { ideal: 'none' } };
    const video1 = settings.deviceId ? Object.assign({ deviceId: { exact: settings.deviceId } }, base)
      : Object.assign({ facingMode: { ideal: 'environment' } }, base);
    try {
      try {
        S.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: video1 });
      } catch (e) {
        if (!settings.deviceId) throw e;
        settings.deviceId = ''; saveSettings();
        S.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: Object.assign({ facingMode: { ideal: 'environment' } }, base) });
      }
    } catch (e) {
      showCamMsg(e && e.name === 'NotAllowedError'
        ? 'Camera access was blocked. Allow the camera for this site in the browser settings, then try again.'
        : 'No camera could be opened (' + (e && e.name || 'error') + '). Close other apps that use it and try again.', true);
      return;
    }
    video.srcObject = S.stream;
    try { await video.play(); } catch (e) { /* autoplay with muted+playsinline normally works */ }
    if (S.view !== 'capture') { stopCamera(); return; }
    listCameras();
    requestWakeLock();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(drawPreview);
  }

  function showCamMsg(text, retry) {
    const msg = $('camMsg');
    msg.innerHTML = '';
    const p = document.createElement('p');
    p.textContent = text;
    msg.appendChild(p);
    if (retry) {
      const b = document.createElement('button');
      b.className = 'btn';
      b.type = 'button';
      b.textContent = 'Try again';
      b.onclick = () => startCamera();
      msg.appendChild(b);
    }
    msg.hidden = false;
  }

  function stopCamera() {
    cancelAnimationFrame(rafId);
    stopBurst();
    if (S.stream) S.stream.getTracks().forEach((t) => t.stop());
    S.stream = null;
    video.srcObject = null;
    if (S.wakeLock) { S.wakeLock.release().catch(() => {}); S.wakeLock = null; }
  }

  async function requestWakeLock() {
    try { if ('wakeLock' in navigator && !S.wakeLock) S.wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* not allowed */ }
  }

  async function listCameras() {
    try {
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      const sel = $('setCamera');
      const current = S.stream && S.stream.getVideoTracks()[0];
      const curId = current && current.getSettings ? current.getSettings().deviceId : '';
      sel.innerHTML = '<option value="">Back camera (default)</option>' + devices.map((d, i) =>
        `<option value="${d.deviceId}">${(d.label || 'Camera ' + (i + 1)).replace(/</g, '&lt;')}</option>`).join('');
      sel.value = settings.deviceId && devices.some((d) => d.deviceId === settings.deviceId) ? settings.deviceId : '';
      const s = current && current.getSettings ? current.getSettings() : {};
      $('camInfo').textContent = s.width ? `Camera delivers ${s.width}×${s.height}${curId ? '' : ''}.` : '';
    } catch (e) { /* ignore */ }
  }

  /** The current frame rotated by the setting, scaled so the long side is at most maxSide. */
  function grab(maxSide) {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    const rot = settings.rotation % 360;
    const rw = rot % 180 ? vh : vw, rh = rot % 180 ? vw : vh;
    const k = Math.min(1, maxSide / Math.max(rw, rh));
    const c = document.createElement('canvas');
    c.width = Math.round(rw * k);
    c.height = Math.round(rh * k);
    const g = c.getContext('2d');
    g.translate(c.width / 2, c.height / 2);
    g.rotate(rot * Math.PI / 180);
    g.drawImage(video, -vw * k / 2, -vh * k / 2, vw * k, vh * k);
    return c;
  }

  function drawPreview() {
    rafId = requestAnimationFrame(drawPreview);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.round(preview.clientWidth * dpr), H = Math.round(preview.clientHeight * dpr);
    if (!W || !H) return;
    if (preview.width !== W || preview.height !== H) { preview.width = W; preview.height = H; }
    pctx.setTransform(1, 0, 0, 1, 0, 0);
    pctx.fillStyle = '#10202C';
    pctx.fillRect(0, 0, W, H);
    if (S.step === 'type' && S.pendingScale) {
      const c = S.pendingScale.canvas;
      const k = Math.min(W / c.width, H / c.height);
      pctx.drawImage(c, (W - c.width * k) / 2, (H - c.height * k) / 2, c.width * k, c.height * k);
      return;
    }
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw) return;
    const rot = settings.rotation % 360;
    const rw = rot % 180 ? vh : vw, rh = rot % 180 ? vw : vh;
    const k = Math.min(W / rw, H / rh);
    pctx.translate(W / 2, H / 2);
    pctx.rotate(rot * Math.PI / 180);
    pctx.drawImage(video, -vw * k / 2, -vh * k / 2, vw * k, vh * k);
  }

  // ------------------------------------------------------------------ encoding
  function canvasToJpeg(canvas, quality) {
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', quality));
  }

  async function encodeTagged(canvas, quality, info) {
    const raw = await canvasToJpeg(canvas, quality);
    const now = info.date || new Date();
    const comment = JSON.stringify(Object.assign({ owner: OWNER, project: CFG.project || 'Water in a bottle' }, info.meta));
    const bytes = window.Exif.insertExif(new Uint8Array(await raw.arrayBuffer()), {
      description: `${OWNER} | ${CFG.project || 'Water in a bottle'} | ${info.what}`,
      artist: OWNER,
      copyright: `Copyright (c) ${now.getFullYear()} ${OWNER}. All rights reserved.`,
      software: 'zakatabish.online/ai-project',
      dateTime: now,
      userComment: comment,
    });
    return new Blob([bytes], { type: 'image/jpeg' });
  }

  function thumbOf(canvas) {
    const k = 240 / Math.max(canvas.width, canvas.height);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(canvas.width * k));
    c.height = Math.max(1, Math.round(canvas.height * k));
    c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.7).replace(/^data:[^,]*,/, '');
  }

  // ------------------------------------------------------------------ capture flow
  function setStep(step) {
    S.step = step;
    $('typeSheet').hidden = step !== 'type';
    renderCapture();
  }

  function renderCapture() {
    const order = ['scale', 'type', 'capture'];
    const now = order.indexOf(S.step);
    document.querySelectorAll('#steps li').forEach((li) => {
      const i = order.indexOf(li.dataset.step);
      li.className = i < now ? 'is-done' : i === now ? 'is-now' : '';
    });
    const sh = $('shutter');
    sh.dataset.mode = S.step === 'scale' ? 'scale' : 'image';
    sh.setAttribute('aria-label', S.step === 'scale' ? 'Take the scale photo' : 'Take image (hold for burst)');
    sh.disabled = S.step === 'type';
    $('nextBottle').disabled = S.step !== 'capture';
    $('rateVal').textContent = settings.rate;
    const count = $('finderCount');
    let hint = '';
    if (S.step === 'scale') {
      count.hidden = true;
      hint = 'Put the bottle on the scale so the display is readable, then take the scale photo.';
      if (S.lastSample) hint += ` Last: ${S.lastSample.sampleId || 'new bottle'}, type ${S.lastSample.type}, ${S.lastSample.count} images.`;
    } else if (S.step === 'type') {
      count.hidden = true;
      hint = '';
    } else {
      count.hidden = false;
      $('countNum').textContent = S.sample.count;
      $('countLabel').textContent = `${S.sample.sampleId || 'new bottle'} · type ${S.sample.type}`;
      hint = S.holding ? `Recording at ${settings.rate} per second…` : 'Tap for one image, hold for a burst. Next bottle when done.';
    }
    const h = $('hint');
    h.textContent = hint;
    h.hidden = !hint;
  }

  async function takeScalePhoto() {
    const canvas = grab(1600);
    if (!canvas) { toast('The camera is not ready yet.', true); return; }
    flash();
    const capturedAt = new Date();
    S.pendingScale = { canvas, w: canvas.width, h: canvas.height, capturedAt: capturedAt.toISOString(), date: capturedAt };
    $('typeWeight').value = '';
    updateWeightNote($('typeWeight'), $('typeVol'), null);
    setStep('type');
  }

  async function startSample(type) {
    const ps = S.pendingScale;
    if (!ps) return;
    const raw = $('typeWeight').value.trim();
    let weight = null;
    if (raw) {
      weight = parseWeight(raw);
      const empty = S.types[type] && S.types[type].emptyWeightG;
      if (weight === null || weight <= 0) { toast('Type the weight as a number, or leave it empty.', true); return; }
      if (empty !== undefined && weight < empty) { toast(`That is less than the empty type ${type} bottle (${empty} g). Check the weight or the type.`, true); return; }
    }
    const localId = uuid();
    const collector = settings.collector || '';
    const sample = { localId, type, count: 0, weight, sampleId: null };
    // queued before any of its images (the uploader works strictly in order)
    sample.ready = (async () => {
      const blob = await encodeTagged(ps.canvas, 0.92, {
        date: ps.date, what: `scale photo | bottle type ${type}`,
        meta: { kind: 'scale', bottleType: type, localBottle: localId, collector, capturedAt: ps.capturedAt },
      });
      await jobsAdd({ kind: 'start', localId, clientId: localId, type, weight, collector,
        scale: { blob, w: ps.w, h: ps.h, capturedAt: ps.capturedAt } });
    })();
    S.sample = sample;
    S.pendingScale = null;
    setStep('capture');
    try {
      await sample.ready;
    } catch (e) {
      toast('Could not save the scale photo: ' + (e.message || e), true);
      if (S.sample === sample) { S.sample = null; setStep('scale'); }
      return;
    }
    pump();
  }

  async function shootImage() {
    const s = S.sample;
    if (!s || S.step !== 'capture') return;
    if (S.encoding > 6) { toast('The phone cannot keep up – lower the burst rate.', true); return; }
    const canvas = grab(settings.maxSide);
    if (!canvas) return;
    s.count++;
    flash();
    if (navigator.vibrate) navigator.vibrate(8);
    renderCapture();
    S.encoding++;
    const capturedAt = new Date();
    const index = s.count;
    try {
      const blob = await encodeTagged(canvas, settings.quality, {
        date: capturedAt, what: `bottle type ${s.type} | image ${index}`,
        meta: { kind: 'image', bottleType: s.type, localBottle: s.localId, localIndex: index, collector: settings.collector || '', capturedAt: capturedAt.toISOString() },
      });
      await s.ready;
      await jobsAdd({ kind: 'img', localId: s.localId, clientId: uuid(), collector: settings.collector || '',
        blob, thumb: thumbOf(canvas), w: canvas.width, h: canvas.height, capturedAt: capturedAt.toISOString() });
    } catch (e) {
      s.count--;
      toast('Could not save the image: ' + (e.message || e), true);
    } finally {
      S.encoding--;
      renderCapture();
    }
    if (!pumping) pump(); else updateSync(true);
  }

  let flashTimer = 0;
  function flash() {
    const f = $('finder');
    f.classList.add('is-flash');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => f.classList.remove('is-flash'), 90);
  }

  function startBurst() {
    if (S.step === 'scale') { takeScalePhoto(); return; }
    if (S.step !== 'capture' || S.holding) return;
    S.holding = true;
    shootImage();
    const tick = () => {
      if (!S.holding) return;
      $('shutter').classList.add('is-rec');
      $('finder').classList.add('is-rec');
      renderCapture();
      shootImage();
      S.burstTimer = setTimeout(tick, 1000 / settings.rate);
    };
    S.burstTimer = setTimeout(tick, Math.max(1000 / settings.rate, 250));   // a quick tap stays one image
  }

  function stopBurst() {
    if (!S.holding) return;
    S.holding = false;
    clearTimeout(S.burstTimer);
    $('shutter').classList.remove('is-rec', 'is-down');
    $('finder').classList.remove('is-rec');
    renderCapture();
  }

  function nextBottle() {
    if (S.step !== 'capture') return;
    stopBurst();
    S.lastSample = S.sample;
    S.sample = null;
    setStep('scale');
  }

  function setRate(delta) {
    settings.rate = Math.min(15, Math.max(1, settings.rate + delta));
    saveSettings();
    renderCapture();
  }

  function buildTypeGrid() {
    const grid = $('typeGrid');
    grid.innerHTML = '';
    Object.keys(S.types).sort().forEach((t) => {
      const info = S.types[t];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'type';
      b.dataset.type = t;
      const short = String(info.description || '').replace(/^(Tallest|Shortest)\s*-\s*/, '').replace(/\s*\(.*\)$/, '');
      b.innerHTML = `<img src="img/bottle-${t}.jpg" alt=""><b>${t}</b><small></small>`;
      b.querySelector('small').textContent = short;
      b.setAttribute('aria-label', `Type ${t}: ${info.description}`);
      b.addEventListener('click', () => startSample(Number(t)));
      grid.appendChild(b);
    });
  }

  function updateWeightNote(input, note, type) {
    const w = parseWeight(input.value);
    note.className = 'lcd__note';
    if (!input.value.trim()) {
      note.textContent = type ? '' : 'You can also read it from the scale photo later, in Review.';
      return null;
    }
    if (w === null) { note.textContent = 'Numbers only, e.g. 1233 or 1233.5'; note.classList.add('is-bad'); return null; }
    if (!type) {
      const parts = Object.keys(S.types).map((t) => {
        const v = w - S.types[t].emptyWeightG;
        return v >= 0 ? `type ${t}: ${fmtWeight(v)} ml` : null;
      }).filter(Boolean);
      note.textContent = parts.length ? 'Water: ' + parts.join(' · ') : 'Lighter than every empty bottle – check the weight.';
      if (!parts.length) note.classList.add('is-bad');
      return w;
    }
    const empty = S.types[type] ? S.types[type].emptyWeightG : 0;
    const v = w - empty;
    if (v < 0) { note.textContent = `Less than the empty bottle (${empty} g) – check the weight.`; note.classList.add('is-bad'); return null; }
    note.textContent = `= ${fmtWeight(v)} ml water (empty bottle ${empty} g)`;
    note.classList.add('is-ok');
    return w;
  }

  // ------------------------------------------------------------------ review
  const R = { filter: 'todo', samples: [], todo: [], cur: null, idx: -1, images: [], discard: new Set(), history: [], full: {} };

  async function loadList() {
    const list = $('bottleList');
    $('listEmpty').hidden = true;
    if (!R.samples.length) list.innerHTML = '<li class="empty">Loading…</li>';
    try {
      const r = await api('list');
      applyServerConfig(r.config);
      R.samples = r.samples;
      renderList();
    } catch (e) {
      list.innerHTML = '';
      $('listEmpty').hidden = false;
      $('listEmpty').textContent = 'Could not load the bottles: ' + errText(e);
    }
  }

  function renderList() {
    const todo = R.samples.filter((s) => s.reviewStatus !== 'approved');
    $('cntTodo').textContent = todo.length;
    $('cntAll').textContent = R.samples.length;
    document.querySelectorAll('#reviewList .seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === R.filter)));
    const shown = R.filter === 'todo' ? todo : R.samples;
    R.todo = shown;
    const list = $('bottleList');
    list.innerHTML = '';
    shown.forEach((s, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      const label = s.weight !== null ? `<b>${fmtWeight(s.weight)} g</b> = ${fmtWeight(s.volume)} ml` : 'No label yet';
      const chip = s.reviewStatus === 'approved' ? '<span class="chip chip--ok">Approved</span>'
        : s.weight !== null ? '<span class="chip chip--todo">Images to check</span>' : '<span class="chip chip--todo">Needs label</span>';
      b.innerHTML = `<span class="sid">${s.sampleId}</span><span class="meta">Type ${s.type} · ${s.numImages} images<br>${label}</span>${chip}`;
      b.addEventListener('click', () => openBottle(i));
      li.appendChild(b);
      list.appendChild(li);
    });
    const empty = $('listEmpty');
    empty.hidden = shown.length > 0;
    empty.textContent = R.filter === 'todo'
      ? (R.samples.length ? 'Every bottle is approved. Capture more, or look at All.' : 'No bottles on Drive yet. Capture the first one.')
      : 'No bottles on Drive yet.';
  }

  async function openBottle(i) {
    if (i < 0 || i >= R.todo.length) { closeBottle(); return; }
    R.idx = i;
    R.cur = R.todo[i];
    R.discard = new Set();
    R.history = [];
    R.full = {};
    R.images = [];
    $('reviewList').hidden = true;
    $('reviewBottle').hidden = false;
    $('viewReview').scrollTop = 0;
    $('bottleId').textContent = R.cur.sampleId;
    $('bottleType').textContent = `type ${R.cur.type}`;
    $('bottlePos').textContent = `${i + 1} of ${R.todo.length}`;
    $('scaleImg').removeAttribute('src');
    $('imgGrid').innerHTML = '';
    $('labelWeight').value = R.cur.weight !== null ? fmtWeight(R.cur.weight) : '';
    updateWeightNote($('labelWeight'), $('labelVol'), R.cur.type);
    showStep(R.cur.weight !== null && R.cur.reviewStatus !== 'approved' ? 'images' : 'label');
    try {
      const r = await api('getSample', { sampleId: R.cur.sampleId });
      if (R.cur.sampleId !== r.sample.sampleId) return;
      R.cur = Object.assign(R.cur, r.sample);
      R.images = r.images;
      if (r.scale) $('scaleImg').src = b64ToUrl(r.scale);
      else $('scaleImg').alt = 'This bottle has no scale photo.';
      renderGrid();
    } catch (e) {
      toast('Could not load ' + R.cur.sampleId + ': ' + errText(e), true);
    }
  }

  function closeBottle() {
    $('reviewBottle').hidden = true;
    $('reviewList').hidden = false;
    renderList();
  }

  function showStep(step) {
    $('stepLabel').hidden = step !== 'label';
    $('stepImages').hidden = step !== 'images';
    $('tabLabel').setAttribute('aria-selected', String(step === 'label'));
    $('tabImages').setAttribute('aria-selected', String(step === 'images'));
    if (step === 'label') setTimeout(() => { if (!matchMedia('(pointer: coarse)').matches) $('labelWeight').focus(); }, 30);
  }

  async function saveLabel() {
    const w = updateWeightNote($('labelWeight'), $('labelVol'), R.cur.type);
    if (w === null || w <= 0) { toast('Type the weight shown on the scale.', true); $('labelWeight').focus(); return; }
    const btn = $('saveLabel');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const r = await api('label', { sampleId: R.cur.sampleId, weight: w });
      Object.assign(R.cur, r.sample);
      R.samples = R.samples.map((s) => (s.sampleId === r.sample.sampleId ? Object.assign(s, r.sample) : s));
      const g = await api('getSample', { sampleId: R.cur.sampleId, withScale: false });
      R.images = g.images;
      renderGrid();
      toast(`Label saved: ${fmtWeight(r.sample.weight)} g = ${fmtWeight(r.sample.volume)} ml`);
      showStep('images');
    } catch (e) {
      toast(errText(e), true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save label';
    }
  }

  function renderGrid() {
    const grid = $('imgGrid');
    grid.innerHTML = '';
    R.images.forEach((img, k) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      if (R.discard.has(img.fileId)) b.className = 'is-discarded';
      b.setAttribute('aria-label', `Image ${k + 1}${R.discard.has(img.fileId) ? ', discarded' : ''}`);
      const im = document.createElement('img');
      im.alt = '';
      im.loading = 'lazy';
      if (img.thumb) im.src = b64ToUrl(img.thumb);
      b.appendChild(im);
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = k + 1;
      b.appendChild(n);
      b.addEventListener('click', () => openViewer(k));
      li.appendChild(b);
      grid.appendChild(li);
    });
    const kept = R.images.length - R.discard.size;
    $('imgCount').textContent = R.images.length ? `${kept}/${R.images.length}` : '0';
    $('imagesLead').textContent = R.images.length
      ? `Tap an image to look at it full size. ${R.discard.size ? R.discard.size + ' marked to discard; they move to _discarded on Drive when you approve or save.' : 'Discarded images move to _discarded on Drive and can be restored there.'}`
      : 'This bottle has no images.';
    $('undoDiscard').disabled = !R.history.length;
    $('approveBtn').textContent = R.discard.size ? `Approve bottle, discard ${R.discard.size}` : 'Approve bottle';
  }

  // viewer
  const V = { k: 0 };
  function openViewer(k) {
    V.k = Math.max(0, Math.min(k, R.images.length - 1));
    $('viewer').hidden = false;
    renderViewer();
  }
  function closeViewer() { $('viewer').hidden = true; renderGrid(); }
  async function renderViewer() {
    const img = R.images[V.k];
    if (!img) { closeViewer(); return; }
    const discarded = R.discard.has(img.fileId);
    $('viewer').classList.toggle('is-discarded', discarded);
    $('viewerStamp').hidden = !discarded;
    $('viewerPos').textContent = `${V.k + 1} / ${R.images.length}`;
    $('viewerName').textContent = img.name;
    const el = $('viewerImg');
    const want = img.fileId;
    el.src = R.full[want] || (img.thumb ? b64ToUrl(img.thumb) : '');
    if (!R.full[want]) {
      try {
        const r = await api('getImage', { fileId: want });
        R.full[want] = b64ToUrl(r.b64);
        if (R.images[V.k] && R.images[V.k].fileId === want) el.src = R.full[want];
      } catch (e) { /* the thumbnail stays */ }
    }
    const next = R.images[V.k + 1];                       // prefetch one ahead
    if (next && !R.full[next.fileId]) api('getImage', { fileId: next.fileId }).then((r) => { R.full[next.fileId] = b64ToUrl(r.b64); }).catch(() => {});
  }
  function viewerStep(d) {
    const k = V.k + d;
    if (k >= R.images.length) { closeViewer(); $('approveBtn').focus(); return; }
    if (k < 0) return;
    V.k = k;
    renderViewer();
  }
  function markDiscard(k) {
    const img = R.images[k];
    if (!img || R.discard.has(img.fileId)) return;
    R.discard.add(img.fileId);
    R.history.push(img.fileId);
  }
  function undoDiscard(fileId) {
    const id = fileId || R.history[R.history.length - 1];
    if (!id) return false;
    R.discard.delete(id);
    R.history = R.history.filter((x) => x !== id);
    return true;
  }

  async function finishBottle(approve) {
    if (approve && R.cur.weight === null) { toast('Save the label first.', true); showStep('label'); return; }
    const btn = $('approveBtn');
    btn.disabled = true;
    try {
      const r = await api('finish', { sampleId: R.cur.sampleId, discard: Array.from(R.discard), approve: !!approve });
      R.samples = R.samples.map((s) => (s.sampleId === r.sample.sampleId ? Object.assign(s, r.sample) : s));
      toast(approve ? `${r.sample.sampleId} approved · ${r.sample.numImages} images kept, ${r.discarded} discarded`
        : `${r.sample.sampleId} saved · ${r.discarded} discarded`);
      if (approve) {
        const left = R.samples.filter((s) => s.reviewStatus !== 'approved');
        if (R.filter === 'todo') {
          R.todo = left;
          if (left.length) openBottle(Math.min(R.idx, left.length - 1)); else closeBottle();
        } else {
          openBottle(R.idx + 1);
        }
      } else {
        openBottle(R.idx);
      }
    } catch (e) {
      toast(errText(e), true);
    } finally {
      btn.disabled = false;
    }
  }

  async function rotateAll() {
    const keep = R.images.filter((img) => !R.discard.has(img.fileId));
    if (!keep.length) return;
    if (!confirm(`Rotate all ${keep.length} images of ${R.cur.sampleId} by 90° clockwise?`)) return;
    const btn = $('rotateAll');
    btn.disabled = true;
    let done = 0;
    try {
      for (const img of keep) {
        btn.textContent = `Rotating ${done + 1}/${keep.length}…`;
        const src = R.full[img.fileId] || b64ToUrl((await api('getImage', { fileId: img.fileId })).b64);
        const el = new Image();
        await new Promise((res, rej) => { el.onload = res; el.onerror = rej; el.src = src; });
        const c = document.createElement('canvas');
        c.width = el.naturalHeight;
        c.height = el.naturalWidth;
        const g = c.getContext('2d');
        g.translate(c.width / 2, c.height / 2);
        g.rotate(Math.PI / 2);
        g.drawImage(el, -el.naturalWidth / 2, -el.naturalHeight / 2);
        const blob = await encodeTagged(c, 0.95, {
          what: `bottle type ${R.cur.type} | ${img.name} | rotated`,
          meta: { kind: 'image', sampleId: R.cur.sampleId, bottleType: R.cur.type, file: img.name, rotated: 90 },
        });
        const r = await api('replaceImage', { fileId: img.fileId, b64: await blobToB64(blob), thumb: thumbOf(c), w: c.width, h: c.height });
        delete R.full[img.fileId];
        done++;
        void r;
      }
      toast(`${done} images rotated`);
    } catch (e) {
      toast(`Rotation stopped after ${done} images: ${errText(e)}`, true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Rotate all 90°';
      try { const g = await api('getSample', { sampleId: R.cur.sampleId, withScale: false }); R.images = g.images; } catch (e) { /* keep */ }
      renderGrid();
    }
  }

  // ------------------------------------------------------------------ setup
  function showStats(r) {
    if (!r || !r.stats) return;
    const s = r.stats;
    $('dataStat').textContent = `${s.samples} bottles (${s.approved} approved, ${s.labeled} labeled), ${s.images} images. Next bottle: ${r.nextSample}.`;
  }
  function renderQueueStat(n) {
    $('queueStat').textContent = n ? `${n} photo${n === 1 ? '' : 's'} waiting to upload.${lastError ? ' Last try: ' + lastError : ''}` : 'Nothing waiting. Everything is on Drive.';
  }
  function renderSetup() {
    $('setCollector').value = settings.collector || '';
    document.querySelectorAll('#setRotation button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.rot) === settings.rotation)));
    document.querySelectorAll('#setSize button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.size) === settings.maxSide)));
    document.querySelectorAll('#setQuality button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.q) === settings.quality)));
    const est = Math.round((settings.maxSide * settings.maxSide * 9 / 16) * ({ 0.92: 0.27, 0.85: 0.18, 0.75: 0.12 }[settings.quality] || 0.18) / 1024);
    $('sizeHint').textContent = `Long side ${settings.maxSide} px, JPEG quality ${Math.round(settings.quality * 100)} – about ${est} KB per image. Scale photos are always kept at high quality so the digits stay readable.`;
    $('ownerTag').textContent = OWNER;
    jobsCount().then(renderQueueStat);
    listCameras();
    if (S.pin) api('ping').then(showStats).catch(() => {});
  }

  // ------------------------------------------------------------------ scale weight levels (setup)
  const MIN_GAP_G = 40;           // smaller gaps are not worth a bottle

  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function fmtG(v) { return Math.round(v).toLocaleString('en'); }
  function hasWeight(l) { return l.weightG !== null && l.weightG !== '' && isFinite(l.weightG); }

  /** A script deployed before "levels" existed answers unknown_action: build the same list from "list". */
  async function driveLevels() {
    let levels;
    try {
      const r = await api('levels');
      applyServerConfig(r.config);
      levels = r.levels;
    } catch (e) {
      if (e.code !== 'unknown_action') throw e;
      const r = await api('list');
      applyServerConfig(r.config);
      levels = r.samples.map((s) => ({
        sampleId: s.sampleId, type: s.type, weightG: s.weight, images: s.numImages, approved: s.reviewStatus === 'approved',
      }));
    }
    return levels;
  }

  /** Only the bottles recorded on Google Drive; the PC/webcam dataset is not shown. */
  async function loadLevels() {
    renderLevels([], S.pin ? 'Loading the bottles on Drive…' : '');
    if (!S.pin) return;
    try {
      renderLevels(await driveLevels(), '');
    } catch (e) {
      renderLevels([], 'Bottles on Drive not loaded: ' + errText(e));
    }
  }

  /** Spaces between neighbouring scale weights (the empty bottle counts as a level), biggest first. */
  function levelGaps(values, empty) {
    const pts = [empty].concat(values.filter((v) => v > empty));
    const out = [];
    for (let i = 1; i < pts.length; i++) {
      if (pts[i] - pts[i - 1] >= MIN_GAP_G) out.push({ from: pts[i - 1], to: pts[i], size: pts[i] - pts[i - 1] });
    }
    return out.sort((a, b) => b.size - a.size);
  }

  function renderLevels(levels, note) {
    const box = $('levels');
    box.innerHTML = '';
    $('levelsNote').textContent = note;
    const top = Math.max(1000, ...levels.filter(hasWeight).map((l) => Number(l.weightG)),
      ...Object.values(S.types).map((i) => Number(i.emptyWeightG) || 0));
    const step = top > 1000 ? 500 : 250;
    const axisMax = Math.ceil(top / step) * step;
    const pct = (g) => Math.min(100, Math.max(0, (g / axisMax) * 100));

    Object.keys(S.types).sort().forEach((t) => {
      const info = S.types[t];
      const mine = levels.filter((l) => String(l.type) === t);
      const empty = Number(info.emptyWeightG) || 0;
      const pts = mine.filter(hasWeight).map((l) => Object.assign({}, l, { weightG: Number(l.weightG) })).sort((a, b) => a.weightG - b.weightG);
      const images = mine.reduce((n, l) => n + Number(l.images || 0), 0);
      const unlabeled = mine.length - pts.length;
      const gaps = levelGaps(Array.from(new Set(pts.map((l) => l.weightG))), empty);
      const short = String(info.description || '').replace(/^(Tallest|Shortest)\s*-\s*/, '');

      const sec = document.createElement('section');
      sec.className = 'lv';
      const sum = mine.length
        ? `${mine.length} bottle${mine.length === 1 ? '' : 's'} · ${fmtG(images)} images${unlabeled ? ` · ${unlabeled} without label` : ''}`
        : 'No bottles yet';
      sec.innerHTML = `<h4 class="lv__title">Type ${esc(t)} <small>${esc(short)} · empty ${esc(info.emptyWeightG)} g</small></h4>`
        + `<p class="lv__sum">${sum}</p>`;

      const strip = document.createElement('div');
      strip.className = 'lv__strip';
      const track = document.createElement('div');
      track.className = 'lv__track';
      gaps.slice(0, 3).forEach((g) => {
        const band = document.createElement('span');
        band.className = 'lv__gap';
        band.style.left = pct(g.from) + '%';
        band.style.width = (pct(g.to) - pct(g.from)) + '%';
        track.appendChild(band);
      });
      const mark = document.createElement('span');
      mark.className = 'lv__empty';
      mark.style.left = pct(empty) + '%';
      mark.title = `Empty bottle: ${empty} g`;
      track.appendChild(mark);
      const tip = document.createElement('div');
      tip.className = 'lv__tip';
      tip.hidden = true;
      pts.forEach((l) => {
        const d = document.createElement('button');
        d.type = 'button';
        d.className = 'lv__dot' + (l.approved ? '' : ' is-open');
        d.style.left = pct(l.weightG) + '%';
        const text = `${l.sampleId} · ${fmtWeight(l.weightG)} g on the scale (bottle + water) · ${l.images} images · ${l.approved ? 'approved' : 'not approved yet'}`;
        d.setAttribute('aria-label', text);
        const show = () => {
          tip.textContent = text;
          tip.hidden = false;
          const x = (pct(l.weightG) / 100) * track.offsetWidth + track.offsetLeft;
          const half = tip.offsetWidth / 2;
          tip.style.left = Math.min(strip.offsetWidth - half, Math.max(half, x)) + 'px';
        };
        d.addEventListener('pointerenter', show);
        d.addEventListener('focus', show);
        d.addEventListener('click', show);
        d.addEventListener('pointerleave', () => { if (document.activeElement !== d) tip.hidden = true; });
        d.addEventListener('blur', () => { tip.hidden = true; });
        track.appendChild(d);
      });
      strip.appendChild(track);
      strip.appendChild(tip);

      const axis = document.createElement('div');
      axis.className = 'lv__axis';
      axis.setAttribute('aria-hidden', 'true');
      for (let g = 0; g <= axisMax; g += step) {
        const tick = document.createElement('span');
        tick.style.left = pct(g) + '%';
        tick.textContent = g === axisMax ? `${g} g` : String(g);
        axis.appendChild(tick);
      }
      strip.appendChild(axis);
      sec.appendChild(strip);

      const vals = document.createElement('p');
      vals.className = 'lv__vals';
      vals.textContent = pts.length ? 'Scale: ' + pts.map((l) => fmtWeight(l.weightG)).join(' · ') + ' g' : 'No labeled bottle yet – any level from empty to full is new.';
      sec.appendChild(vals);

      if (gaps.length) {
        const next = document.createElement('p');
        next.className = 'lv__next';
        next.innerHTML = '<i>Fill next, on the scale (middle of the biggest gaps)</i>' + gaps.slice(0, 3).map((g) => {
          const mid = Math.round((g.from + g.to) / 2 / 5) * 5;
          return `<span><b>≈ ${fmtG(mid)} g</b> <small>(gap ${fmtWeight(g.from)}–${fmtWeight(g.to)} g)</small></span>`;
        }).join('');
        sec.appendChild(next);
      }
      box.appendChild(sec);
    });
  }

  // ------------------------------------------------------------------ events
  function bind() {
    $('pinForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const pin = $('pinInput').value.trim();
      if (pin) tryUnlock(pin, $('pinRemember').checked);
    });
    document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
    $('syncPill').addEventListener('click', () => { lastError = ''; backoff = 2000; pump(); if (S.view !== 'setup') showView('setup'); });

    // shutter: tap = 1 image, hold = burst
    const sh = $('shutter');
    sh.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.preventDefault();
      try { sh.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      sh.classList.add('is-down');
      startBurst();
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => sh.addEventListener(ev, () => { sh.classList.remove('is-down'); stopBurst(); }));
    sh.addEventListener('contextmenu', (e) => e.preventDefault());
    sh.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') e.preventDefault(); });

    // middle mouse on the camera view, like the desktop tool
    const finder = $('finder');
    finder.addEventListener('mousedown', (e) => { if (e.button === 1) { e.preventDefault(); startBurst(); } });
    window.addEventListener('mouseup', (e) => { if (e.button === 1) stopBurst(); });
    finder.addEventListener('auxclick', (e) => e.preventDefault());

    $('rateDown').addEventListener('click', () => setRate(-1));
    $('rateUp').addEventListener('click', () => setRate(1));
    $('nextBottle').addEventListener('click', nextBottle);
    $('retakeScale').addEventListener('click', () => { S.pendingScale = null; setStep('scale'); });
    $('discardScale').addEventListener('click', () => {
      S.pendingScale = null;
      setStep(S.sample ? 'capture' : 'scale');
      toast('Scale photo discarded');
    });
    $('typeWeight').addEventListener('input', () => updateWeightNote($('typeWeight'), $('typeVol'), null));

    // review
    document.querySelectorAll('#reviewList .seg button').forEach((b) => b.addEventListener('click', () => { R.filter = b.dataset.filter; renderList(); }));
    $('listRefresh').addEventListener('click', loadList);
    $('bottleBack').addEventListener('click', () => { closeBottle(); loadList(); });
    $('tabLabel').addEventListener('click', () => showStep('label'));
    $('tabImages').addEventListener('click', () => showStep('images'));
    $('labelWeight').addEventListener('input', () => updateWeightNote($('labelWeight'), $('labelVol'), R.cur && R.cur.type));
    $('labelWeight').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveLabel(); } });
    $('saveLabel').addEventListener('click', saveLabel);
    $('prevBottle').addEventListener('click', () => openBottle(Math.max(0, R.idx - 1)));
    $('skipBottle').addEventListener('click', () => openBottle(R.idx + 1));
    $('zoomBtn').addEventListener('click', () => {
      const z = $('scaleZoom');
      z.dataset.zoom = z.dataset.zoom === '2' ? '1' : '2';
      $('zoomBtn').textContent = z.dataset.zoom === '2' ? 'Fit' : 'Zoom';
      if (z.dataset.zoom === '2') { z.scrollLeft = (z.scrollWidth - z.clientWidth) / 2; z.scrollTop = (z.scrollHeight - z.clientHeight) / 2; }
    });
    $('undoDiscard').addEventListener('click', () => { if (undoDiscard()) renderGrid(); });
    $('approveBtn').addEventListener('click', () => finishBottle(true));
    $('saveNoApprove').addEventListener('click', () => finishBottle(false));
    $('rotateAll').addEventListener('click', rotateAll);

    // viewer
    $('viewerClose').addEventListener('click', closeViewer);
    $('viewerPrev').addEventListener('click', () => viewerStep(-1));
    $('viewerNext').addEventListener('click', () => viewerStep(1));
    $('viewerKeep').addEventListener('click', () => { undoDiscard(R.images[V.k].fileId); viewerStep(1); });
    $('viewerDiscard').addEventListener('click', () => { markDiscard(V.k); viewerStep(1); });
    let sx = 0, sy = 0;
    const stage = $('viewerStage');
    stage.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    stage.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) viewerStep(dx < 0 ? 1 : -1);
    });

    // setup
    $('setCollector').addEventListener('change', () => {
      settings.collector = $('setCollector').value.trim().slice(0, 40);
      saveSettings();
      $('barWho').textContent = settings.collector;
    });
    $('setCamera').addEventListener('change', () => { settings.deviceId = $('setCamera').value; saveSettings(); stopCamera(); toast('Camera changed'); });
    document.querySelectorAll('#setRotation button').forEach((b) => b.addEventListener('click', () => { settings.rotation = Number(b.dataset.rot); saveSettings(); renderSetup(); }));
    document.querySelectorAll('#setSize button').forEach((b) => b.addEventListener('click', () => { settings.maxSide = Number(b.dataset.size); saveSettings(); renderSetup(); }));
    document.querySelectorAll('#setQuality button').forEach((b) => b.addEventListener('click', () => { settings.quality = Number(b.dataset.q); saveSettings(); renderSetup(); }));
    $('uploadNow').addEventListener('click', () => { lastError = ''; backoff = 2000; pump(); });
    $('clearQueue').addEventListener('click', async () => {
      const n = await jobsCount();
      if (!n) { toast('Nothing is waiting.'); return; }
      if (!confirm(`Delete ${n} photos that are not on Drive yet? This cannot be undone.`)) return;
      await jobsClear();
      updateSync(false);
      toast(`${n} waiting photos deleted`);
    });
    $('exportXlsx').addEventListener('click', async () => {
      const b = $('exportXlsx');
      b.disabled = true; b.textContent = 'Writing…';
      try { const r = await api('exportXlsx'); toast(`${r.file} written to the Drive folder`); } catch (e) { toast(errText(e), true); }
      b.disabled = false; b.textContent = 'Write Excel copy to Drive';
    });
    $('lockNow').addEventListener('click', () => lock('Locked. The PIN was removed from this device.'));

    // keyboard: same keys as the desktop tools
    document.addEventListener('keydown', onKey);
    document.addEventListener('keyup', (e) => { if (e.key === ' ' && S.view === 'capture') stopBurst(); });

    window.addEventListener('online', () => { backoff = 2000; pump(); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { stopBurst(); if (S.view === 'capture') stopCamera(); }
      else if (!$('app').hidden && S.view === 'capture') startCamera();
    });
    setInterval(() => { if (!pumping) pump(); }, 30000);
  }

  function onKey(e) {
    if ($('app').hidden) return;
    const typing = e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
    if (!$('viewer').hidden) {
      const k = e.key;
      if (k === 'Enter' || k === ' ' || k === 'ArrowRight') { e.preventDefault(); if (k !== 'ArrowRight') undoDiscard(R.images[V.k].fileId); viewerStep(1); }
      else if (k === 'Delete') { markDiscard(V.k); viewerStep(1); }
      else if (k === 'ArrowLeft' || k === 'Backspace') { e.preventDefault(); viewerStep(-1); }
      else if (k === 'u' || k === 'U') { undoDiscard(R.images[V.k] && R.discard.has(R.images[V.k].fileId) ? R.images[V.k].fileId : null); renderViewer(); }
      else if (k === 'Escape' || k === 'a' || k === 'A') closeViewer();
      return;
    }
    if (S.view === 'capture') {
      if (S.step === 'type') {
        if (e.key === 'Escape') { $('discardScale').click(); return; }
        if (typing) return;
        if (/^[1-9]$/.test(e.key) && S.types[e.key]) { startSample(Number(e.key)); return; }
        if (e.key === 'Enter') { e.preventDefault(); takeScalePhoto(); }
        return;
      }
      if (typing) return;
      if (e.key === 'Enter') { e.preventDefault(); if (S.step === 'capture') { stopBurst(); S.lastSample = S.sample; S.sample = null; S.step = 'scale'; } takeScalePhoto(); }
      else if (e.key === ' ' && !e.repeat) { e.preventDefault(); startBurst(); }
      else if (e.key === '+' || e.key === '=') setRate(1);
      else if (e.key === '-' || e.key === '_') setRate(-1);
      else if (e.key === 'r' || e.key === 'R') { settings.rotation = (settings.rotation + 90) % 360; saveSettings(); toast(`View rotated ${settings.rotation}° clockwise`); }
      return;
    }
    if (S.view === 'review' && !$('reviewBottle').hidden && !typing) {
      if (e.key === 'l' || e.key === 'L') showStep('label');
      else if ((e.key === 'Enter') && !$('stepImages').hidden) finishBottle(true);
      else if (e.key === 'o' || e.key === 'O') { if (!$('stepImages').hidden) rotateAll(); }
    }
  }

  // ------------------------------------------------------------------ start
  function init() {
    buildTypeGrid();
    bind();
    renderCapture();
    if (!CFG.endpoint) {
      $('pinMsg').textContent = 'Not connected to Drive yet: put the Apps Script web app URL into ai-project/config.js.';
    }
    const pin = unlockedPin();
    if (pin) {
      $('pinInput').value = pin;
      tryUnlock(pin, !!load('pin', ''), true);
    } else {
      setTimeout(() => $('pinInput').focus(), 50);
    }
    updateSync(false).catch(() => {});
  }

  init();
})();
