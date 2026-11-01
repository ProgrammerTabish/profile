/* =========================================================
   3D view of the RAG pipeline (three.js r149, no modules).

   Every point is one of the 12,186 real chunks, placed by a
   3D UMAP of its real BGE-M3 vector, so chunks that mean
   similar things sit together. The glowing core on the right
   is the LLM; the dashed box is the bank's tenant boundary.
   ========================================================= */
(function () {
  'use strict';
  const THREE = window.THREE;

  const GROUP_COLORS = {
    dark:  ['#8B7DFF', '#FF7A90', '#F4B740', '#3FE0D0', '#4AA8FF', '#7EE081', '#E58BFF'],
    light: ['#5645D6', '#D3365A', '#B7791F', '#0C8C86', '#1E6FD9', '#2F8F3A', '#9B3FC2'],
  };
  const HI = { sparse: '#FFB347', dense: '#38E8FF', fused: '#FFFFFF', cited: '#FFFFFF' };
  const HI_LIGHT = { sparse: '#D9480F', dense: '#0B7FA8', fused: '#12131C', cited: '#12131C' };

  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  class RagScene {
    constructor(host, opts) {
      this.host = host;
      this.meta = opts.meta;
      this.xyz = opts.xyz;
      this.reduce = !!opts.reduceMotion;
      this.speed = 1;
      this.tweens = [];
      this.labels = [];
      this.light = document.documentElement.dataset.theme !== 'dark';
      this.onHover = opts.onHover || (() => {});
      this.onPick = opts.onPick || (() => {});
      this.groupFilter = -1;
      this._init();
    }

    /* ── setup ───────────────────────────────────────────── */
    _init() {
      const w = this.host.clientWidth, h = this.host.clientHeight;
      const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }));
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      r.setSize(w, h);
      this.host.appendChild(r.domElement);
      r.domElement.setAttribute('aria-hidden', 'true');

      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 50);
      this.target = new THREE.Vector3(0.55, 0, 0);
      this.orbit = { theta: -0.35, phi: 1.2, dist: 4.3, vt: 0, vp: 0 };
      this.world = new THREE.Group();
      this.scene.add(this.world);

      this._buildCloud();
      this._buildCore();
      this._buildTenant();
      this._buildQuery();
      this._buildLines();
      this._buildTokens();
      this._buildGroupLabels();
      this._bindPointer();

      this.raycaster = new THREE.Raycaster();
      this.raycaster.params.Points.threshold = 0.025;
      this.mouse = new THREE.Vector2(-9, -9);

      this.resize();
      new ResizeObserver(() => this.resize()).observe(this.host);
      this.visible = true;
      new IntersectionObserver(([e]) => (this.visible = e.isIntersecting)).observe(this.host);
      this.clock = new THREE.Clock();
      const loop = () => {
        requestAnimationFrame(loop);
        if (this.visible && !document.hidden) this._frame();
      };
      loop();
    }

    _buildCloud() {
      const n = this.meta.chunks.length;
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        pos[i * 3] = this.xyz[i * 3] / 32000 * 1.4;
        pos[i * 3 + 1] = this.xyz[i * 3 + 1] / 32000 * 1.4;
        pos[i * 3 + 2] = this.xyz[i * 3 + 2] / 32000 * 1.4;
      }
      this.pos = pos;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      g.setAttribute('hi', new THREE.BufferAttribute(new Float32Array(n), 1));
      g.setAttribute('hiColor', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      g.setAttribute('dim', new THREE.BufferAttribute(new Float32Array(n), 1));
      this.hiTarget = new Float32Array(n);
      this.dimTarget = new Float32Array(n);
      this.cloudGeo = g;
      this.cloudMat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false,
        uniforms: { uScale: { value: 1 }, uLight: { value: 0 }, uTime: { value: 0 } },
        vertexShader: `
          attribute vec3 color; attribute float hi; attribute vec3 hiColor; attribute float dim;
          uniform float uScale; uniform float uTime;
          varying vec3 vColor; varying float vAlpha; varying float vHi;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            float pulse = 1.0 + hi * 0.25 * sin(uTime * 6.0 + position.x * 20.0);
            gl_PointSize = uScale * (1.6 + hi * 5.5 * pulse) / -mv.z;
            vColor = mix(color, hiColor, clamp(hi, 0.0, 1.0));
            vAlpha = mix(0.62, 0.1, dim) + hi * 0.4;
            vHi = hi;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `
          uniform float uLight;
          varying vec3 vColor; varying float vAlpha; varying float vHi;
          void main() {
            vec2 c = gl_PointCoord - 0.5; float d = length(c);
            if (d > 0.5) discard;
            float core = smoothstep(0.5, 0.0, d);
            float a = vAlpha * mix(core, smoothstep(0.5, 0.3, d), uLight);
            vec3 col = vColor + (1.0 - uLight) * vHi * core * 0.35;
            gl_FragColor = vec4(col, a);
          }`,
      });
      this.cloud = new THREE.Points(g, this.cloudMat);
      this.world.add(this.cloud);
      this.applyTheme();
    }

    _buildCore() {
      const core = (this.core = new THREE.Group());
      core.position.set(2.15, 0.05, 0);
      const ico = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 1),
        new THREE.MeshBasicMaterial({ color: 0x8b7dff, wireframe: true, transparent: true, opacity: 0.55 }));
      const inner = new THREE.Mesh(new THREE.SphereGeometry(0.16, 32, 32),
        new THREE.MeshBasicMaterial({ color: 0x3fe0d0, transparent: true, opacity: 0.85 }));
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._glowTex(), color: 0x8b7dff,
        transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.scale.set(1.5, 1.5, 1);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0x3fe0d0, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
      const ring1 = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.004, 8, 96), ringMat);
      const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.003, 8, 96), ringMat.clone());
      ring1.rotation.x = 1.2; ring2.rotation.y = 1.1;
      core.add(glow, ico, inner, ring1, ring2);
      Object.assign(core.userData, { ico, inner, glow, ring1, ring2, heat: 0, heatT: 0 });
      this.world.add(core);
    }

    _buildTenant() {
      const box = new THREE.BoxGeometry(4.6, 2.9, 2.9);
      const edges = new THREE.EdgesGeometry(box);
      const mat = new THREE.LineDashedMaterial({ color: 0x8991ac, dashSize: 0.06, gapSize: 0.05, transparent: true, opacity: 0.28 });
      const line = new THREE.LineSegments(edges, mat);
      line.computeLineDistances();
      line.position.set(0.6, 0, 0);
      this.tenant = line;
      this.world.add(line);
    }

    _buildQuery() {
      const g = (this.query = new THREE.Group());
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 24, 24),
        new THREE.MeshBasicMaterial({ color: 0xffffff }));
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._glowTex(), color: 0x38e8ff,
        transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
      halo.scale.set(0.45, 0.45, 1);
      const wave = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16),
        new THREE.MeshBasicMaterial({ color: 0x38e8ff, wireframe: true, transparent: true, opacity: 0 }));
      wave.scale.setScalar(0.01);
      g.add(halo, orb, wave);
      g.userData = { orb, halo, wave };
      g.visible = false;
      g.position.set(-2.2, 0.4, 0.6);
      this.world.add(g);
    }

    _buildLines() {
      const max = 400;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 6), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(max * 6), 3));
      geo.setDrawRange(0, 0);
      this.lineMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false });
      this.lines = new THREE.LineSegments(geo, this.lineMat);
      this.lines.userData.max = max;
      this.world.add(this.lines);
    }

    _buildTokens() {
      const n = 220;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      this.tokMat = new THREE.PointsMaterial({ size: 0.035, map: this._glowTex(), color: 0x3fe0d0,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      this.tokens = new THREE.Points(geo, this.tokMat);
      this.tokState = Array.from({ length: n }, () => ({ live: false, t: 0, p0: new THREE.Vector3(), p1: new THREE.Vector3(), c: new THREE.Vector3() }));
      this.tokNext = 0;
      this.world.add(this.tokens);
    }

    _buildGroupLabels() {
      const n = this.meta.chunks.length, G = this.meta.groups.length;
      const sum = Array.from({ length: G }, () => [0, 0, 0, 0]);
      for (let i = 0; i < n; i++) {
        const g = this.meta.docs[this.meta.chunks[i][0]].g;
        sum[g][0] += this.pos[i * 3]; sum[g][1] += this.pos[i * 3 + 1]; sum[g][2] += this.pos[i * 3 + 2]; sum[g][3]++;
      }
      this.layer = document.createElement('div');
      this.layer.className = 'stage__labels';
      this.host.appendChild(this.layer);
      const mk = (text, cls, v) => {
        const el = document.createElement('span');
        el.className = 'slabel ' + cls; el.textContent = text;
        this.layer.appendChild(el);
        this.labels.push({ el, v });
        return el;
      };
      this.groupLabels = sum.map((s, g) => {
        const el = mk(this.meta.groups[g], 'slabel--group', new THREE.Vector3(s[0] / s[3], s[1] / s[3] + 0.08, s[2] / s[3]));
        el.style.setProperty('--c', `var(--g${g})`);
        return el;
      });
      this.coreLabel = mk('LLM', 'slabel--core', new THREE.Vector3(2.15, -0.62, 0));
      this.coreLabel.innerHTML = '<b>LLM</b><small>Mistral Small 3.1 · 24B</small>';
      mk('Bank tenant boundary · nothing leaves', 'slabel--tenant', new THREE.Vector3(-1.05, -1.52, 1.45));
      this.queryLabel = mk('', 'slabel--query', new THREE.Vector3());
      this.queryLabel.hidden = true;
    }

    _glowTex() {
      if (this._glow) return this._glow;
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const x = c.getContext('2d');
      const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, 64, 64);
      return (this._glow = new THREE.CanvasTexture(c));
    }

    /* ── interaction ─────────────────────────────────────── */
    _bindPointer() {
      const el = this.renderer.domElement;
      let drag = null, moved = 0;
      el.addEventListener('pointerdown', (e) => {
        drag = { x: e.clientX, y: e.clientY }; moved = 0;
        el.setPointerCapture(e.pointerId);
        this.lastInteract = performance.now();
      });
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        this.mouseClient = { x: e.clientX - r.left, y: e.clientY - r.top };
        if (!drag) return;
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        moved += Math.abs(dx) + Math.abs(dy);
        this.orbit.theta -= dx * 0.006;
        this.orbit.phi = Math.max(0.35, Math.min(2.8, this.orbit.phi - dy * 0.006));
        drag = { x: e.clientX, y: e.clientY };
        this.lastInteract = performance.now();
      });
      const up = (e) => {
        if (drag && moved < 6 && this.hoverIdx != null) this.onPick(this.hoverIdx);
        drag = null;
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', () => (drag = null));
      el.addEventListener('pointerleave', () => { this.mouse.set(-9, -9); this._setHover(null); });
      el.addEventListener('wheel', (e) => {
        e.preventDefault();
        this.orbit.dist = Math.max(1.6, Math.min(8, this.orbit.dist * (1 + Math.sign(e.deltaY) * 0.08)));
        this.lastInteract = performance.now();
      }, { passive: false });
    }

    _setHover(i) {
      if (i === this.hoverIdx) return;
      this.hoverIdx = i;
      this.renderer.domElement.style.cursor = i == null ? 'grab' : 'pointer';
      this.onHover(i, this.mouseClient);
    }

    resize() {
      const w = this.host.clientWidth, h = this.host.clientHeight;
      if (!w || !h) return;
      this.renderer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.narrow = w / h < 1.05;
      this.cloudMat.uniforms.uScale.value = h * 0.0125 * this.renderer.getPixelRatio();
    }

    applyTheme() {
      this.light = document.documentElement.dataset.theme !== 'dark';
      const pal = GROUP_COLORS[this.light ? 'light' : 'dark'];
      const col = this.cloudGeo.attributes.color.array;
      const c = new THREE.Color();
      this.meta.chunks.forEach((ch, i) => {
        c.set(pal[this.meta.docs[ch[0]].g]);
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      });
      this.cloudGeo.attributes.color.needsUpdate = true;
      this.cloudMat.uniforms.uLight.value = this.light ? 1 : 0;
      this.cloudMat.blending = this.light ? THREE.NormalBlending : THREE.AdditiveBlending;
      this.cloudMat.needsUpdate = true;
      this.hiPal = this.light ? HI_LIGHT : HI;
      if (this.tenant) this.tenant.material.color.set(this.light ? 0x5b6076 : 0x8991ac);
      if (this.core) {
        const u = this.core.userData;
        u.ico.material.color.set(this.light ? 0x5645d6 : 0x8b7dff);
        u.inner.material.color.set(this.light ? 0x0c8c86 : 0x3fe0d0);
        u.glow.material.opacity = this.light ? 0.25 : 0.55;
        u.glow.material.blending = this.light ? THREE.NormalBlending : THREE.AdditiveBlending;
      }
      if (this.tokMat) this.tokMat.color.set(this.light ? 0x0c8c86 : 0x3fe0d0);
    }

    setGroupFilter(g) {
      this.groupFilter = g;
      this.meta.chunks.forEach((ch, i) => {
        this.dimTarget[i] = g >= 0 && this.meta.docs[ch[0]].g !== g ? 1 : 0;
      });
      this.groupLabels.forEach((el, i) => el.classList.toggle('is-off', g >= 0 && i !== g));
    }

    /* ── tween helpers ───────────────────────────────────── */
    tween(ms, fn, ease = easeInOut) {
      const dur = this.reduce ? 1 : ms / this.speed;
      return new Promise((res) => this.tweens.push({ t0: performance.now(), dur, fn, ease, res }));
    }
    wait(ms) { return this.tween(ms, () => {}); }

    pointPos(i) { return new THREE.Vector3(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]); }

    _paint(ids, kind, level = 1) {
      const pal = this.hiPal, c = new THREE.Color(pal[kind]);
      const hc = this.cloudGeo.attributes.hiColor.array;
      for (const i of ids) {
        hc[i * 3] = c.r; hc[i * 3 + 1] = c.g; hc[i * 3 + 2] = c.b;
        this.hiTarget[i] = Math.max(this.hiTarget[i], level);
      }
      this.cloudGeo.attributes.hiColor.needsUpdate = true;
    }

    _setLines(from, ids, color) {
      const pa = this.lines.geometry.attributes.position.array;
      const ca = this.lines.geometry.attributes.color.array;
      const c = new THREE.Color(color);
      const n = Math.min(ids.length, this.lines.userData.max);
      for (let k = 0; k < n; k++) {
        const p = this.pointPos(ids[k]);
        pa.set([from.x, from.y, from.z, p.x, p.y, p.z], k * 6);
        ca.set([c.r, c.g, c.b, c.r, c.g, c.b], k * 6);
      }
      this.lines.geometry.setDrawRange(0, n * 2);
      this.lines.geometry.attributes.position.needsUpdate = true;
      this.lines.geometry.attributes.color.needsUpdate = true;
    }

    _labelQuery(text) {
      this.queryLabel.hidden = !text;
      this.queryLabel.textContent = text || '';
    }

    /* ── pipeline animation API (called by app.js) ───────── */
    reset() {
      this.hiTarget.fill(0);
      this.lineMat.opacity = 0;
      this.query.visible = false;
      this._labelQuery('');
      (this.cards || []).forEach((s) => { this.world.remove(s); s.material.map.dispose(); s.material.dispose(); });
      this.cards = [];
      this.core.userData.heatT = 0;
    }

    async showQuery(text) {
      this.reset();
      const q = this.query;
      q.visible = true;
      const start = new THREE.Vector3(-2.5, 0.9, 0.9), end = new THREE.Vector3(-1.75, 0.55, 0.5);
      this._labelQuery(text.length > 46 ? text.slice(0, 45) + '…' : text);
      await this.tween(700, (t) => {
        q.position.lerpVectors(start, end, t);
        q.userData.halo.material.opacity = 0.9 * t;
      }, easeOut);
    }

    async keywordSearch(ids, label) {
      this._labelQuery(label);
      const from = this.query.position.clone();
      this._setLines(from, ids, this.hiPal.sparse);
      this._paint(ids, 'sparse', 0.75);
      await this.tween(650, (t) => (this.lineMat.opacity = (this.light ? 0.5 : 0.35) * Math.sin(Math.PI * Math.min(t * 1.2, 1))));
      this.lineMat.opacity = 0;
    }

    async denseSearch(ids, seedIds, label) {
      this._labelQuery(label);
      // the query vector lands where its nearest chunks are
      const dest = new THREE.Vector3();
      const use = ids.slice(0, 10);
      use.forEach((i) => dest.add(this.pointPos(i)));
      dest.multiplyScalar(1 / Math.max(use.length, 1));
      const q = this.query, start = q.position.clone();
      await this.tween(900, (t) => q.position.lerpVectors(start, dest, t));
      const wave = q.userData.wave;
      this._setLines(dest, ids, this.hiPal.dense);
      this._paint(ids, 'dense', 0.85);
      await this.tween(800, (t) => {
        wave.scale.setScalar(0.02 + t * 0.55);
        wave.material.opacity = (this.light ? 0.35 : 0.5) * (1 - t);
        this.lineMat.opacity = (this.light ? 0.55 : 0.4) * Math.sin(Math.PI * t);
      }, easeOut);
      this.lineMat.opacity = 0;
      wave.material.opacity = 0;
    }

    async fuse(topIds, allIds) {
      this._labelQuery('RRF fusion → top 8');
      const hc = this.cloudGeo.attributes.hiColor;
      const start = Float32Array.from(this.hiTarget);
      const keep = new Set(topIds);
      await this.tween(700, (t) => {
        for (const i of allIds) if (!keep.has(i)) this.hiTarget[i] = start[i] * (1 - t) + 0.12 * t;
      });
      this._paint(topIds, 'fused', 1.25);
      hc.needsUpdate = true;
      this._setLines(this.query.position, topIds, this.hiPal.fused);
      await this.tween(500, (t) => (this.lineMat.opacity = 0.6 * t));
    }

    _cardSprite(text, n) {
      const c = document.createElement('canvas');
      const W = 360, H = 64; c.width = W; c.height = H;
      const x = c.getContext('2d');
      const dark = !this.light;
      x.fillStyle = dark ? 'rgba(18,21,31,.92)' : 'rgba(255,255,255,.95)';
      x.strokeStyle = dark ? 'rgba(139,125,255,.9)' : 'rgba(86,69,214,.9)';
      x.lineWidth = 2;
      x.beginPath(); x.roundRect ? x.roundRect(2, 2, W - 4, H - 4, 12) : x.rect(2, 2, W - 4, H - 4); x.fill(); x.stroke();
      x.fillStyle = dark ? '#3FE0D0' : '#0C8C86';
      x.font = '600 26px "IBM Plex Mono", monospace';
      x.fillText(`[${n}]`, 14, 42);
      x.fillStyle = dark ? '#E7E9F5' : '#12131C';
      x.font = '500 22px "IBM Plex Sans", sans-serif';
      x.fillText(text.length > 26 ? text.slice(0, 25) + '…' : text, 70, 41);
      const tex = new THREE.CanvasTexture(c);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
      s.scale.set(0.5, 0.089, 1);
      s.renderOrder = 10;
      return s;
    }

    async sendToCore(top) {
      this._labelQuery('Prompt: system rules + 8 numbered sources');
      this.lineMat.opacity = 0;
      const coreP = this.core.position;
      this.cards = top.map((c, k) => {
        const s = this._cardSprite(`${c.doc.replace(/^\d+_/, '').replace(/_/g, ' ')} ${c.section ? '· ' + c.section : ''}`, k + 1);
        s.position.copy(this.pointPos(c.i));
        s.material.opacity = 0;
        this.world.add(s);
        return s;
      });
      const starts = this.cards.map((s) => s.position.clone());
      const slot = (k, t) => {
        const a = (k / this.cards.length) * Math.PI * 2 + t;
        return new THREE.Vector3(coreP.x - 0.95 + Math.cos(a) * 0.08, coreP.y + 0.62 - k * 0.165, coreP.z + Math.sin(a) * 0.05);
      };
      await this.tween(1300, (t) => {
        this.cards.forEach((s, k) => {
          const tk = Math.max(0, Math.min(1, t * 1.6 - k * 0.08));
          const e = easeInOut(tk);
          const mid = starts[k].clone().lerp(slot(k, 0), 0.5); mid.y += 0.35;
          const a = starts[k].clone().lerp(mid, e), b = mid.clone().lerp(slot(k, 0), e);
          s.position.copy(a.lerp(b, e));
          s.material.opacity = Math.min(1, tk * 3);
        });
      }, (t) => t);
      this.core.userData.heatT = 0.5;
    }

    async think(on) {
      this._labelQuery(on ? 'LLM reads the prompt…' : '');
      this.core.userData.heatT = on ? 1 : 0.3;
      if (on) {
        const coreP = this.core.position;
        // the sources are absorbed into the context window
        const starts = this.cards.map((s) => s.position.clone());
        await this.tween(900, (t) => {
          this.cards.forEach((s, k) => {
            s.position.lerpVectors(starts[k], coreP, easeInOut(t));
            s.material.opacity = 1 - t;
            s.scale.set(0.5 * (1 - t * 0.8), 0.089 * (1 - t * 0.8), 1);
          });
        });
      }
    }

    emitToken() {
      const st = this.tokState[this.tokNext];
      this.tokNext = (this.tokNext + 1) % this.tokState.length;
      st.live = true; st.t = 0;
      st.p0.copy(this.core.position);
      st.p1.set(this.core.position.x - 1.1 + Math.random() * 0.4, 1.1 + Math.random() * 0.5, 0.9 + Math.random() * 0.4);
      st.c.set((Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6);
    }

    async cite(ids) {
      this.core.userData.heatT = 0.2;
      this._labelQuery(ids.length ? `${ids.length} cited sources verified` : 'no verifiable sources');
      this.hiTarget.fill(0);
      this._paint(ids, 'cited', 1.4);
      this._setLines(this.core.position, ids, this.hiPal.dense);
      await this.tween(600, (t) => (this.lineMat.opacity = 0.65 * t));
      this.query.visible = false;
    }

    focus(i) {
      const p = this.pointPos(i);
      const start = this.target.clone();
      this.tween(800, (t) => this.target.lerpVectors(start, p, t));
      const d0 = this.orbit.dist;
      this.tween(800, (t) => (this.orbit.dist = d0 + (2.2 - d0) * t));
      this._paint([i], 'cited', 1.6);
      this.lastInteract = performance.now();
    }

    home() {
      const start = this.target.clone(), d0 = this.orbit.dist;
      const end = new THREE.Vector3(this.narrow ? 1.05 : 0.55, 0, 0), d1 = this.narrow ? 7.2 : 4.3;
      this.tween(800, (t) => { this.target.lerpVectors(start, end, t); this.orbit.dist = d0 + (d1 - d0) * t; });
    }

    /* ── render loop ─────────────────────────────────────── */
    _frame() {
      const now = performance.now();
      const dt = Math.min(this.clock.getDelta(), 0.05);
      const time = this.clock.elapsedTime;

      this.tweens = this.tweens.filter((tw) => {
        const t = Math.min(1, (now - tw.t0) / tw.dur);
        tw.fn(tw.ease(t));
        if (t >= 1) { tw.res(); return false; }
        return true;
      });

      if (!this.reduce && (!this.lastInteract || now - this.lastInteract > 4000)) this.orbit.theta += dt * 0.05;
      const o = this.orbit;
      if (this._narrowWas !== this.narrow) { this._narrowWas = this.narrow; this.home(); }
      this.camera.position.set(
        this.target.x + o.dist * Math.sin(o.phi) * Math.sin(o.theta),
        this.target.y + o.dist * Math.cos(o.phi),
        this.target.z + o.dist * Math.sin(o.phi) * Math.cos(o.theta));
      this.camera.lookAt(this.target);

      // ease highlight + dim attributes toward their targets
      const hi = this.cloudGeo.attributes.hi, dim = this.cloudGeo.attributes.dim;
      const k = Math.min(1, dt * 7);
      let ch = false;
      for (let i = 0; i < hi.array.length; i++) {
        const dh = this.hiTarget[i] - hi.array[i], dd = this.dimTarget[i] - dim.array[i];
        if (dh > 0.001 || dh < -0.001) { hi.array[i] += dh * k; ch = true; }
        if (dd > 0.001 || dd < -0.001) { dim.array[i] += dd * k; ch = true; }
      }
      if (ch) { hi.needsUpdate = true; dim.needsUpdate = true; }
      this.cloudMat.uniforms.uTime.value = time;

      // core: idle breathing, heats up while "generating"
      const u = this.core.userData;
      u.heat += (u.heatT - u.heat) * Math.min(1, dt * 3);
      const spin = 0.25 + u.heat * 2.2;
      u.ico.rotation.y += dt * spin; u.ico.rotation.x += dt * spin * 0.4;
      u.ring1.rotation.z += dt * (0.3 + u.heat * 3); u.ring2.rotation.x += dt * (0.2 + u.heat * 2.4);
      const b = 1 + Math.sin(time * (2 + u.heat * 8)) * (0.04 + u.heat * 0.08);
      u.inner.scale.setScalar(b * (1 + u.heat * 0.25));
      u.glow.scale.setScalar(1.3 + u.heat * 0.9 + Math.sin(time * 3) * 0.05);

      if (this.query.visible) {
        const qh = this.query.userData.halo;
        qh.scale.setScalar(0.4 + Math.sin(time * 5) * 0.05);
      }

      // generated tokens drift from the core to the reader
      const tp = this.tokens.geometry.attributes.position.array;
      this.tokState.forEach((s, j) => {
        if (!s.live) { tp[j * 3 + 1] = -99; return; }
        s.t += dt * 0.9 * (this.reduce ? 4 : 1);
        if (s.t >= 1) { s.live = false; tp[j * 3 + 1] = -99; return; }
        const e = easeOut(s.t);
        const x = s.p0.x + (s.p1.x - s.p0.x) * e + s.c.x * Math.sin(Math.PI * e);
        const y = s.p0.y + (s.p1.y - s.p0.y) * e + s.c.y * Math.sin(Math.PI * e);
        const z = s.p0.z + (s.p1.z - s.p0.z) * e + s.c.z * Math.sin(Math.PI * e);
        tp[j * 3] = x; tp[j * 3 + 1] = y; tp[j * 3 + 2] = z;
      });
      this.tokens.geometry.attributes.position.needsUpdate = true;

      // hover picking (throttled)
      if (!this._lastPick || now - this._lastPick > 60) {
        this._lastPick = now;
        if (this.mouse.x > -2) {
          this.raycaster.setFromCamera(this.mouse, this.camera);
          this.raycaster.params.Points.threshold = 0.012 * o.dist;
          const hits = this.raycaster.intersectObject(this.cloud);
          const hit = hits.find((h) => this.dimTarget[h.index] < 0.5);
          this._setHover(hit ? hit.index : null);
        }
      }

      this.renderer.render(this.scene, this.camera);

      // HTML labels follow their 3D anchors
      const w = this.host.clientWidth, h = this.host.clientHeight;
      const v = new THREE.Vector3();
      for (const L of this.labels) {
        if (L.el === this.queryLabel) {
          if (L.el.hidden) continue;
          v.copy(this.query.position).add(new THREE.Vector3(0, 0.12, 0));
        } else v.copy(L.v);
        v.project(this.camera);
        const behind = v.z > 1;
        L.el.style.transform = `translate(-50%,-50%) translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
        L.el.style.opacity = behind ? 0 : '';
      }
      this.coreLabel.classList.toggle('is-hot', u.heat > 0.6);
    }
  }

  window.RagScene = RagScene;
})();
