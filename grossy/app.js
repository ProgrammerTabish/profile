/* Großry: clickable prototype.
   Everything runs in the browser. State lives in localStorage only (wrapped, since it can be unavailable). */
(function () {
  'use strict';

  const D = window.GR_DATA;
  const P = Object.fromEntries(D.products.map(p => [p.id, p]));
  const UNI = Object.fromEntries(D.universities.map(u => [u.id, u]));
  const KEY = 'grossry.proto.v1';
  const FEE = 0.20;                 // Großry takes 20% of the verified saving
  const LOGISTICS = 0.08;           // share of the landed price that is transport + handling
  const SLOT_CAP = 12;              // max people per 15-minute slot
  const BASE_LOADS = [12, 12, 12, 11, 12, 11, 12, 11, 10, 10, 9, 9]; // other students per slot, 16:00–19:00
  const SLOT_TIMES = BASE_LOADS.map((_, i) => {
    const m = 16 * 60 + i * 15, f = x => String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0');
    return f(m) + '–' + f(m + 15);
  });
  const OTHERS = BASE_LOADS.reduce((a, b) => a + b, 0);
  const LEDGER = [['Bulk purchasing', .59], ['Collective transportation', .25], ['Reduced supplier markup', .09], ['Consolidated packaging', .07]];
  const LAST = { participants: 118, lines: 702, items: 1488, value: 2140, savings: 486, completed: 114, trips: 236 };
  const REWARDS = [
    { id: 'd2', name: '€2 grocery discount', cost: 200, credit: 2 },
    { id: 'prio', name: 'Priority pickup (any slot, even full)', cost: 150 },
    { id: 'bonus', name: 'Bonus product: 1 L oat drink', cost: 250 },
    { id: 'deliv', name: 'Free home delivery (Plus concept)', cost: 300 }
  ];

  /* ── cycle dates ─────────────────────────────────────── */
  const today = new Date();
  const cycle = (() => {
    const d = new Date(today.getFullYear(), today.getMonth() + (today.getDate() > 10 ? 1 : 0), 1);
    const month = d.toLocaleString('en-GB', { month: 'long' });
    const mon = d.toLocaleString('en-GB', { month: 'short' });
    const dist = new Date(d.getFullYear(), d.getMonth(), 16);
    const next = new Date(d.getFullYear(), d.getMonth() + 1, 1).toLocaleString('en-GB', { month: 'long' });
    const daysLeft = Math.max(0, Math.ceil((new Date(d.getFullYear(), d.getMonth(), 10, 23, 59) - today) / 864e5));
    return { month, mon, year: d.getFullYear(), next, daysLeft, distDay: dist.toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) };
  })();
  const STAGES = [
    { label: 'Shopping open', when: `1–10 ${cycle.mon}`, text: 'Shopping opens' },
    { label: 'Order closed', when: `10 ${cycle.mon}, 23:59 → 11 ${cycle.mon}`, text: 'Order closes · demand aggregated' },
    { label: 'Bulk procurement', when: `12 ${cycle.mon}`, text: 'Bulk procurement' },
    { label: 'Goods arrived', when: `14 ${cycle.mon}`, text: 'Goods arrive on campus' },
    { label: 'Sorting', when: `15 ${cycle.mon}`, text: 'Sorting by order' },
    { label: 'Distribution day', when: `16 ${cycle.mon}`, text: 'Distribution 16:00–19:00' },
    { label: 'Cycle complete', when: `17 ${cycle.mon}`, text: 'Cycle closed, savings realised' }
  ];

  /* ── state ───────────────────────────────────────────── */
  const fresh = () => ({
    v: 1, view: 'app', tab: 'home', user: null,
    cart: {}, submitted: false, stage: 0, subs: true, slot: null, priority: false,
    code: 'GR-' + (1000 + Math.floor(Math.random() * 9000)),
    collected: false, noShow: false, rated: null, creditUsed: 0, paidAtLock: null,
    credits: 0, points: 120, pointsLog: [['Welcome bonus', 120]], redeemed: [],
    runner: { primary: null, backup: null, handed: 0, issues: 0, done: false, runs: 0, rating: null, notes: [] },
    votes: {}, myRequests: [], posts: [], replies: {}, myReviews: {}, problems: [],
    wg: null, notif: { order: true, runner: true, community: false }, insights: true, invites: 0
  });
  const store = {
    get() { try { const s = JSON.parse(localStorage.getItem(KEY)); return s && s.v === 1 ? Object.assign(fresh(), s) : null; } catch (e) { return null; } },
    set(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* storage unavailable: demo still works for this visit */ } },
    clear() { try { localStorage.removeItem(KEY); } catch (e) {} }
  };
  let S = store.get() || fresh();
  const save = () => store.set(S);

  // Transient UI state (not persisted)
  const ui = { stack: [], shopCat: 'All', q: '', comm: 'requests', forumCat: 'All', ob: { step: 'welcome' }, preview: false, photo: null, rate: {} };

  /* ── helpers ─────────────────────────────────────────── */
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const eur = n => '€' + (Math.round(n * 100) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const eur0 = n => '€' + Math.round(n).toLocaleString('en-GB');
  const num = n => Math.round(n).toLocaleString('en-GB');
  const PLURAL = { can: 'cans', jar: 'jars', pack: 'packs', bag: 'bags', bottle: 'bottles' };
  const fq = (q, u) => { const v = +(+q).toFixed(1); return v + ' ' + (v !== 1 && PLURAL[u] ? PLURAL[u] : u); };
  const per = p => '/' + p.unit;
  const stars = r => '★★★★★'.slice(0, Math.round(r)) + '☆☆☆☆☆'.slice(0, 5 - Math.round(r));
  const first = () => (S.user && S.user.name ? S.user.name.split(' ')[0] : 'there');
  const locked = () => S.stage >= 1;
  const isRunner = () => S.runner.primary === 'you';
  const isBackup = () => S.runner.backup === 'you';

  function addPoints(label, n) { S.points += n; S.pointsLog.unshift([label, n]); }

  /* ── pricing ─────────────────────────────────────────── */
  function tierInfo(p) {
    const t = +(p.demand + (S.cart[p.id] || 0) * p.pack).toFixed(2);
    let idx = -1;
    p.tiers.forEach((tr, i) => { if (t >= tr[0]) idx = i; });
    const next = p.tiers[idx + 1] || null;
    return {
      t, idx, unlocked: idx >= 0, next,
      price: idx >= 0 ? p.tiers[idx][1] : p.tiers[0][1],
      need: next ? +(next[0] - t).toFixed(2) : 0,
      pct: next ? Math.min(100, t / next[0] * 100) : 100
    };
  }
  function lines() {
    return Object.keys(S.cart).filter(id => S.cart[id] > 0 && P[id]).map(id => {
      const p = P[id], n = S.cart[id], q = +(n * p.pack).toFixed(2), ti = tierInfo(p);
      const ref = q * p.ref, landed = q * ti.price;
      return { p, n, q, ti, ref, landed, gross: Math.max(0, ref - landed), dropped: locked() && !ti.unlocked };
    });
  }
  function totals() {
    const L = lines().filter(l => !l.dropped);
    const t = { ref: 0, landed: 0, gross: 0, items: 0, count: L.length };
    L.forEach(l => { t.ref += l.ref; t.landed += l.landed; t.gross += l.gross; t.items += l.n; });
    t.fee = t.gross * FEE;
    const sub = t.landed + t.fee;
    t.credit = locked() ? S.creditUsed : Math.min(S.credits, sub);
    t.pay = sub - t.credit;
    t.net = t.gross - t.fee;
    return t;
  }
  function community() {
    const c = { units: 0, value: 0, gross: 0, lines: 0, sacks: 0 };
    D.products.forEach(p => {
      if (p.excluded) return;
      const ti = tierInfo(p);
      if (!ti.unlocked && locked()) return;
      c.units += ti.t / p.pack;
      c.value += ti.t * ti.price;
      c.gross += ti.t * (p.ref - ti.price);
      c.lines += p.students + (S.cart[p.id] ? 1 : 0);
    });
    c.participants = OTHERS + (S.submitted ? 1 : 0);
    c.savings = c.gross * (1 - FEE);
    c.trips = c.participants * 2;
    return c;
  }

  /* ── slots ───────────────────────────────────────────── */
  const slotFull = i => BASE_LOADS[i] >= SLOT_CAP;
  function allocateSlot() {
    if (S.priority) return 0;
    const i = BASE_LOADS.findIndex(l => l < SLOT_CAP);
    return i < 0 ? BASE_LOADS.length - 1 : i;
  }

  /* ── QR (illustrative, not a real QR encoding) ───────── */
  function qrSvg(code) {
    const n = 21; let h = 2166136261;
    for (const ch of code) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    const rnd = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return (h >>> 0) / 4294967296; };
    const finder = (x, y) => `<rect x="${x}" y="${y}" width="7" height="7"/><rect x="${x + 1}" y="${y + 1}" width="5" height="5" fill="#fff"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3"/>`;
    const inF = (x, y) => (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9);
    let cells = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!inF(x, y) && rnd() > .52) cells += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
    return `<svg viewBox="0 0 ${n} ${n}" fill="#111" shape-rendering="crispEdges" role="img" aria-label="Order code ${esc(code)}">${finder(0, 0)}${finder(n - 7, 0)}${finder(0, n - 7)}${cells}</svg>`;
  }

  /* ── icons ───────────────────────────────────────────── */
  const ICON = {
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    shop: '<path d="M4 7h16l-1.5 12h-13z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
    orders: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',
    run: '<path d="M3 17h2l2-6h9l3 6h2"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/><path d="M8 11l2-4h5"/>',
    profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'
  };
  const TABS = [['home', 'Home'], ['shop', 'Shop'], ['orders', 'Orders'], ['run', 'Run'], ['profile', 'Profile']];

  /* ── toast + sheet ───────────────────────────────────── */
  let toastT;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2800);
  }
  let sheetReturn = null;
  function openSheet(title, html) {
    sheetReturn = document.activeElement;
    $('#sheetPanel').innerHTML = `<div class="sheet__head"><h3 id="sheetTitle">${title}</h3><button class="iconbtn" data-act="close-sheet" aria-label="Close">✕</button></div>${html}`;
    $('#sheetPanel').setAttribute('aria-labelledby', 'sheetTitle');
    $('#sheet').hidden = false;
    $('#sheetPanel').scrollTop = 0;
    const f = $('#sheetPanel [data-act="close-sheet"]'); f && f.focus();
  }
  function closeSheet() { $('#sheet').hidden = true; if (sheetReturn && sheetReturn.focus) sheetReturn.focus(); }

  /* ── share ───────────────────────────────────────────── */
  function share(text) {
    const url = location.origin + location.pathname;
    const done = () => { S.invites++; if (S.invites <= 5) addPoints('Invited classmates', 10); save(); render(); };
    if (navigator.share) {
      navigator.share({ title: 'Großry', text, url }).then(done).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text + ' ' + url).then(() => { toast('Invite text copied. Paste it in your class chat.'); done(); }, () => toast(text));
    } else { toast(text); done(); }
  }

  /* =====================================================
     SCREENS
     ===================================================== */

  /* ── onboarding / registration ───────────────────────── */
  function screenOnboarding() {
    const ob = ui.ob;
    if (ob.step === 'welcome') {
      return `<div class="hero"><div class="proto__logo">G</div><h1>Großry</h1>
        <p>Get wholesale prices without having to buy wholesale quantities.</p></div>
        <div class="card"><ol class="small" style="margin:0;padding-left:1.1rem">
          <li>Add your monthly groceries.</li>
          <li>Your university pools demand to unlock bulk price tiers.</li>
          <li>One bulk purchase, one student Order Runner, one 10-minute pickup slot on campus.</li></ol></div>
        <button class="btn btn--block" data-act="ob" data-step="form">Create account</button>
        <div style="height:.5rem"></div>
        <button class="btn btn--ghost btn--block" data-act="demo-login">Explore with a demo account</button>
        <p class="tiny mute" style="margin-top:.9rem;text-align:center">Prototype. Nothing you enter is sent anywhere.</p>`;
    }
    if (ob.step === 'form') {
      const u = D.universities[0];
      return `<h3 style="margin-bottom:.2rem">Join your university's purchasing group</h3>
        <p class="small mute">Verify your university email to join. Only verified students can order.</p>
        <form data-form="register" novalidate>
          <label class="field"><span>Full name</span><input name="name" autocomplete="off" required></label>
          <label class="field"><span>University</span><select name="uni" data-change="uni">${D.universities.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label>
          <label class="field"><span>Campus</span><select name="campus" id="campusSel">${u.campus.map(c => `<option>${esc(c)}</option>`).join('')}</select></label>
          <label class="field"><span>Student email</span><input name="email" type="email" autocomplete="off" id="emailIn" placeholder="name@${u.domain}"><small id="emailHint">Must be an address at ${u.domain} (subdomains like stud.${u.domain} work too).</small></label>
          <label class="field"><span>Phone number</span><input name="phone" type="tel" autocomplete="off" placeholder="+49 …"><small>Only used for pickup-day issues.</small></label>
          <label class="field"><span>Password</span><input name="pw" type="password" autocomplete="new-password" minlength="8"><small>Min. 8 characters. The prototype checks the length only and never stores it.</small></label>
          <label class="field"><span>Profile photo <span class="mute">(optional)</span></span><input name="photo" type="file" accept="image/*" data-change="photo"><small>Not needed for ordering (data minimisation). Previewed on this device only, never saved.</small></label>
          <label class="check"><input type="checkbox" name="terms"> <span>I accept the <button type="button" class="linkbtn" data-act="legal" data-doc="terms">Terms (draft)</button>.</span></label>
          <label class="check"><input type="checkbox" name="privacy"> <span>I have read the <button type="button" class="linkbtn" data-act="legal" data-doc="privacy">Privacy Policy (draft)</button>.</span></label>
          ${ob.err ? `<p class="err" role="alert">${esc(ob.err)}</p>` : ''}
          <button class="btn btn--block">Send verification code</button>
        </form>
        <p style="text-align:center;margin-top:.6rem"><button class="linkbtn small" data-act="ob" data-step="welcome">Back</button></p>`;
    }
    // verify
    return `<h3 style="margin-bottom:.3rem">Verify your student email</h3>
      <p class="small mute">We would send a 6-digit code to <b>${esc(ob.pending.email)}</b>.</p>
      <div class="card card--info small"><b>Prototype:</b> no email is sent. Your code is <span class="code">${ob.code}</span></div>
      <form data-form="verify">
        <label class="field"><span>Verification code</span><input name="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></label>
        ${ob.err ? `<p class="err" role="alert">${esc(ob.err)}</p>` : ''}
        <button class="btn btn--block">Verify and join</button>
      </form>
      <p style="text-align:center;margin-top:.6rem"><button class="linkbtn small" data-act="ob" data-step="form">Change details</button></p>`;
  }

  /* ── home ────────────────────────────────────────────── */
  function screenHome() {
    const h = today.getHours();
    const greet = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    const t = totals(), c = community();
    const pct = Math.round(S.stage / (STAGES.length - 1) * 100);
    const hasCart = lines().length > 0;

    let status;
    if (S.stage === 0) status = S.submitted ? `Submitted. You can still change it for ${cycle.daysLeft} more day${cycle.daysLeft === 1 ? '' : 's'}.` : hasCart ? 'Basket started but not submitted yet.' : `Shopping is open until 10 ${cycle.mon}, 23:59.`;
    else if (!S.submitted) status = `You didn't order this cycle. ${cycle.next} opens on the 1st.`;
    else if (S.collected) status = 'Collected. Enjoy, and see what you saved below.';
    else status = STAGES[S.stage].text + '.';

    // the product closest to its next tier (for the referral nudge)
    const nudge = D.products.filter(p => !p.excluded).map(p => ({ p, ti: tierInfo(p) })).filter(x => x.ti.next)
      .sort((a, b) => (b.ti.pct) - (a.ti.pct))[0];

    return `<p class="mute small" style="margin:0">${greet},</p>
      <h2 style="font-size:1.35rem;margin-bottom:.8rem">${esc(first())}</h2>

      <div class="card card--brand">
        <span class="eyebrow mute">${cycle.month} ${cycle.year} order</span>
        <p style="font-weight:600;margin-bottom:.5rem">Your ${cycle.month} grocery cycle is ${pct}% complete.</p>
        <div class="bar" style="background:rgba(255,255,255,.25);border-color:transparent"><i style="width:${pct}%;background:currentColor"></i></div>
        <p class="small mute" style="margin:.5rem 0 0">${esc(status)}</p>
      </div>

      ${hasCart ? `<div class="card">
        <span class="eyebrow">Savings meter</span>
        <div class="grid2">
          <div><span class="small mute">Supermarket equivalent</span><div class="strike" style="font-size:1.15rem">${eur(t.ref)}</div></div>
          <div><span class="small mute">Your Großry price</span><div style="font-size:1.15rem;font-weight:700">${eur(t.ref - t.net)}</div></div>
        </div>
        <div style="margin-top:.6rem"><span class="small mute">You save</span><div class="big save">${eur(t.net)}</div></div>
        <p class="tiny mute" style="margin:.4rem 0 0">After Großry's 20% share of the saving. ${S.stage < 2 ? 'Estimated until procurement.' : 'Confirmed at procurement.'}</p>
      </div>` : `<div class="card"><span class="eyebrow">Savings meter</span><p class="small" style="margin:0">Add products to see your saving against the supermarket reference basket. <button class="linkbtn" data-act="tab" data-tab="shop">Start shopping</button></p></div>`}

      <div class="card card--save"><span class="eyebrow">Community savings this month</span><div class="big save">${eur0(c.savings)}</div><p class="tiny mute" style="margin:0">Estimated: students' net saving across all orders this cycle.</p></div>

      ${nudge && S.stage === 0 ? `<div class="card">
        <span class="eyebrow">Help unlock a lower price</span>
        <p class="small" style="margin-bottom:.4rem"><b>${esc(nudge.p.name)}</b>: ${fq(nudge.ti.need, nudge.p.unit)} more unlocks <b>${eur(nudge.ti.next[1])}${per(nudge.p)}</b>.</p>
        <div class="bar bar--save"><i style="width:${nudge.ti.pct}%"></i></div>
        <div class="btnrow"><button class="btn btn--ghost btn--sm" data-act="product" data-id="${nudge.p.id}">View product</button><button class="btn btn--sm" data-act="share-product" data-id="${nudge.p.id}">Invite classmates</button></div>
      </div>` : ''}

      <div class="card">
        <div class="card__head"><h3>This month at ${esc(S.user ? UNI[S.user.uni].name : 'your university')}</h3></div>
        <table class="kv">
          <tr><th>Metric</th><th class="right">This cycle<br><span style="text-transform:none">estimated</span></th><th>Last cycle<br><span style="text-transform:none">realised</span></th></tr>
          <tr><td>Students participating</td><td class="right">${num(c.participants)}</td><td>${num(LAST.participants)}</td></tr>
          <tr><td>Product lines ordered</td><td class="right">${num(c.lines)}</td><td>${num(LAST.lines)}</td></tr>
          <tr><td>Total items</td><td class="right">${num(c.units)}</td><td>${num(LAST.items)}</td></tr>
          <tr><td>Collective purchasing value</td><td class="right">${eur0(c.value)}</td><td>${eur0(LAST.value)}</td></tr>
          <tr><td>Community savings (net)</td><td class="right">${eur0(c.savings)}</td><td>${eur0(LAST.savings)}</td></tr>
          <tr><td>Orders completed</td><td class="right">${S.stage >= 6 ? num(c.participants - 3) : '—'}</td><td>${num(LAST.completed)}</td></tr>
          <tr><td>Food trips avoided</td><td class="right">${num(c.trips)}</td><td>${num(LAST.trips)}</td></tr>
        </table>
        <p class="tiny mute" style="margin:.5rem 0 0">Pilot catalogue of ${D.products.length} products. Demo figures.</p>
      </div>

      <div class="card">
        <h3>Cycle timetable</h3>
        <ul class="tl">${STAGES.map((s, i) => `<li class="${i < S.stage ? 'done' : i === S.stage ? 'now' : ''}"><i></i><b>${s.text}</b><small>${s.when}</small></li>`).join('')}</ul>
      </div>

      <div class="card">
        <h3>Sustainability (estimated)</h3>
        <div class="grid2">
          <div class="stat"><b>${num(c.trips)}</b><span>individual supermarket trips avoided</span></div>
          <div class="stat"><b>1</b><span>consolidated van delivery instead</span></div>
        </div>
        <p class="tiny mute" style="margin:.5rem 0 0"><b>Method:</b> assumes each participant replaces 2 bulk-shopping trips a month (to be validated by survey). Packaging saved is not claimed until measured.</p>
      </div>

      <div class="card" style="padding:.2rem .9rem">
        <button class="rowbtn" data-act="sub" data-name="community">Community: requests &amp; forum</button>
        <button class="rowbtn" data-act="sub" data-name="wg">WG mode: order with your flatmates</button>
        <button class="rowbtn" data-act="tab" data-tab="run">Become an Order Runner</button>
        <button class="rowbtn" data-act="points">Großry Points: ${num(S.points)}</button>
      </div>`;
  }

  /* ── shop ────────────────────────────────────────────── */
  function productCard(p) {
    const ti = tierInfo(p), n = S.cart[p.id] || 0;
    const need = p.excluded ? '<span class="badge badge--warn">Pilot excluded: cold chain</span>'
      : !ti.unlocked ? `${fq(ti.need, p.unit)} more needed to unlock bulk pricing.`
        : ti.next ? `${fq(ti.need, p.unit)} more to unlock ${eur(ti.next[1])}${per(p)}.` : 'Top price tier reached.';
    return `<button class="pcard${p.excluded ? ' pcard--off' : ''}" data-act="product" data-id="${p.id}">
      <span class="pimg" aria-hidden="true">${p.icon}</span>
      <span>
        <span class="pcard__t">${esc(p.name)} <span class="mute small" style="font-weight:400">· ${esc(p.size)}</span></span>
        <span class="tiny mute">${esc(p.brand)}</span>
        <span class="pcard__price"><b>${eur(ti.price)}${per(p)}</b><span class="strike small">${eur(p.ref)}</span>${!ti.unlocked && !p.excluded ? '<span class="badge">if unlocked</span>' : ''}</span>
        <span class="pcard__meta"><span class="badge">👥 ${p.students + (n ? 1 : 0)} students</span><span class="badge"><span class="stars">★</span> ${p.rating}</span>${n ? `<span class="badge badge--ok">In basket: ${fq(n * p.pack, p.unit)}</span>` : ''}</span>
        <span class="bar${ti.unlocked ? '' : ' bar--save'}"><i style="width:${ti.pct}%"></i></span>
        <span class="pcard__need" style="display:block">${need}</span>
      </span></button>`;
  }
  function shopList() {
    const q = ui.q.trim().toLowerCase();
    const list = D.products.filter(p => (ui.shopCat === 'All' || p.cat === ui.shopCat) && (!q || (p.name + ' ' + p.brand + ' ' + p.cat).toLowerCase().includes(q)));
    return list.length ? list.map(productCard).join('') : `<p class="mute small">No products match. <button class="linkbtn" data-act="sub" data-name="community">Request it from the community</button>.</p>`;
  }
  function screenShop() {
    const cats = ['All', ...new Set(D.products.map(p => p.cat))];
    return `${locked() ? `<div class="card card--info small"><b>${cycle.month} ordering is closed.</b> Demand is locked for procurement. Browse now; ${cycle.next} opens on the 1st.</div>` : ''}
      <label class="sr-only" for="searchIn">Search products</label>
      <input class="search" id="searchIn" type="search" placeholder="Search rice, oil, noodles…" value="${esc(ui.q)}" data-input="search">
      <div class="chips" role="group" aria-label="Categories">${cats.map(c => `<button class="chip" data-act="cat" data-cat="${esc(c)}" aria-pressed="${ui.shopCat === c}">${esc(c)}</button>`).join('')}<button class="chip" data-act="sub" data-name="community">＋ Request a product</button></div>
      <div id="shopList">${shopList()}</div>
      <div style="height:3rem"></div>`;
  }

  function stepper(p) {
    const n = S.cart[p.id] || 0, off = locked() || p.excluded;
    return `<span class="stepper"><button data-act="qty" data-id="${p.id}" data-d="-1" aria-label="Remove one ${esc(p.name)}" ${off || !n ? 'disabled' : ''}>−</button><output aria-live="polite">${n}</output><button data-act="qty" data-id="${p.id}" data-d="1" aria-label="Add one ${esc(p.name)}" ${off ? 'disabled' : ''}>+</button></span>`;
  }

  function splitView(p) {
    // Deterministic other-student portions, packed into sacks in order; you take the first portion of sack 1.
    const mine = (S.cart[p.id] || 0) * p.pack;
    const sizes = [2.5, 1, 3, .5, 5, 2, 1.5, 4, 1, 2.5, .5, 3];
    let left = p.demand, i = 0; const portions = [];
    if (mine) portions.push({ who: 'You', q: mine, me: true });
    while (left > 0.001) { const q = Math.min(sizes[i % sizes.length], left); portions.push({ who: 'Student ' + String.fromCharCode(65 + (i % 26)), q }); left -= q; i++; }
    const sacks = []; let cur = [], fill = 0;
    portions.forEach(pt => {
      let q = pt.q;
      while (q > 0.001) { const take = Math.min(q, p.sack - fill); cur.push({ ...pt, q: take }); fill += take; q -= take; if (fill >= p.sack - 0.001) { sacks.push(cur); cur = []; fill = 0; } }
    });
    const partial = cur.length ? { items: cur, fill } : null;
    const s1 = sacks[0] || (partial && partial.items) || [];
    const palette = ['var(--brand)', 'var(--save)', 'var(--info)', 'var(--mute)'];
    return `<div class="card">
      <h3>Buy together, split automatically</h3>
      <p class="small mute">The supplier sells ${esc(p.supplierPack)}s. Großry splits each sack across students' portions.</p>
      <p class="small" style="margin-bottom:.3rem"><b>Sack 1 of ${sacks.length + (partial ? 1 : 0)}</b> (${p.sack} kg)</p>
      <div style="display:flex;height:18px;border-radius:6px;overflow:hidden;border:1px solid var(--rule)">${s1.map((x, k) => `<span title="${esc(x.who)}: ${+x.q.toFixed(1)} kg" style="width:${x.q / p.sack * 100}%;background:${x.me ? 'var(--brand)' : palette[(k % 3) + 1]};opacity:${x.me ? 1 : .55};border-right:1px solid var(--surface)"></span>`).join('')}</div>
      <ul class="list small" style="margin-top:.4rem">${s1.slice(0, 6).map(x => `<li style="padding:.25rem 0;display:flex;justify-content:space-between"><span>${x.me ? '<b>You</b>' : esc(x.who)}</span><span>${+x.q.toFixed(1)} kg</span></li>`).join('')}${s1.length > 6 ? `<li class="mute" style="padding:.25rem 0">+ ${s1.length - 6} more portions</li>` : ''}</ul>
      ${partial ? `<p class="small" style="margin:.4rem 0 0">Last sack: <b>${+partial.fill.toFixed(1)} of ${p.sack} kg</b> claimed. ${+(p.sack - partial.fill).toFixed(1)} kg more fills it; otherwise the remainder is bought at the next smaller pack size.</p>` : ''}
      <p class="tiny mute" style="margin:.5rem 0 0">Portioning loose food is a food-hygiene activity (LMHV). In the pilot, portions are packed by the supplier or hygiene-trained staff, never by runners.</p>
    </div>`;
  }

  function screenProduct(id) {
    const p = P[id], ti = tierInfo(p), n = S.cart[id] || 0;
    const rv = (D.reviews[id] || []).concat((S.myReviews[id] || []).map(r => [r.name, r.stars, r.text]));
    const savePct = Math.round((1 - ti.price / p.ref) * 100);
    return `<div style="display:flex;gap:.9rem;align-items:center;margin-bottom:.8rem">
        <span class="pimg pimg--lg" aria-hidden="true">${p.icon}</span>
        <div><h2 style="font-size:1.15rem">${esc(p.name)}</h2><p class="small mute" style="margin:0">${esc(p.size)} · ${esc(p.brand)}</p>
        <p class="small" style="margin:0"><span class="stars">${stars(p.rating)}</span> ${p.rating}/5 · ${p.nreviews + (S.myReviews[id] || []).length} reviews</p></div>
      </div>
      ${p.excluded ? `<div class="card card--warn small">${esc(p.excluded)}</div>` : ''}
      <div class="card">
        <table class="kv">
          <tr><td>Reference price (retail benchmark)</td><td class="strike">${eur(p.ref)}${per(p)}</td></tr>
          <tr><td>Wholesale price (before handling)</td><td>${eur(ti.price * (1 - LOGISTICS))}${per(p)}</td></tr>
          <tr class="hl"><td>Your expected price</td><td>${eur(ti.price)}${per(p)}</td></tr>
        </table>
        <p class="tiny mute" style="margin:.4rem 0 .6rem">${ti.unlocked ? `${savePct}% below the reference before Großry's 20% share of the saving.` : `Bulk pricing is not unlocked yet. If the minimum isn't reached by 10 ${cycle.mon}, this item is refunded or substituted.`}</p>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:.6rem">
          <span class="small">${n ? `In basket: <b>${fq(n * p.pack, p.unit)}</b> · ${eur(n * p.pack * ti.price)}` : `Step: ${fq(p.pack, p.unit)}`}</span>${stepper(p)}
        </div>
      </div>

      <div class="card">
        <h3>The more students join, the cheaper it gets</h3>
        <table class="tiers">${p.tiers.map((tr, i) => `<tr class="${i === ti.idx ? 'on' : ti.next && tr === ti.next ? 'next' : ''}"><td>${fq(tr[0], p.unit)}${i === 0 ? ' <span class="tiny mute">(minimum)</span>' : ''}</td><td>${eur(tr[1])}${per(p)}</td></tr>`).join('')}</table>
        <p class="small" style="margin:.6rem 0 .3rem">Current demand: <b>${fq(ti.t, p.unit)}</b>${ti.next ? ` / ${fq(ti.next[0], p.unit)}` : ''}</p>
        <div class="bar${ti.unlocked ? '' : ' bar--save'}"><i style="width:${ti.pct}%"></i></div>
        ${ti.next && !p.excluded ? `<p class="small" style="margin:.4rem 0 0">We need <b>${fq(ti.need, p.unit)}</b> more to unlock <b>${eur(ti.next[1])}${per(p)}</b>.</p>
        <button class="btn btn--block" style="margin-top:.6rem" data-act="share-product" data-id="${p.id}" ${locked() ? 'disabled' : ''}>Help unlock lower price</button>` : ''}
      </div>

      ${p.shared && !p.excluded ? splitView(p) : ''}

      <div class="card">
        <div class="card__head"><h3>Reviews</h3><button class="linkbtn small" data-act="review" data-id="${p.id}">Write a review</button></div>
        ${rv.length ? `<ul class="list">${rv.map(r => `<li><span class="stars small">${stars(r[1])}</span> <b class="small">${esc(r[0])}</b><p class="small" style="margin:.15rem 0 0">“${esc(r[2])}”</p></li>`).join('')}</ul>` : '<p class="small mute">No written reviews yet.</p>'}
      </div>

      <div class="card">
        <h3>Information</h3>
        <table class="kv small">
          <tr><td>Ingredients</td><td>${esc(p.ingredients)}</td></tr>
          <tr><td>Nutrition</td><td>${esc(p.nutrition)}</td></tr>
          <tr><td>Allergens</td><td>${esc(p.allergens)}</td></tr>
          <tr><td>Country of origin</td><td>${esc(p.origin)}</td></tr>
          <tr><td>Storage</td><td>${esc(p.storage)}</td></tr>
          <tr><td>Shelf life</td><td>${esc(p.shelf)}</td></tr>
          <tr><td>Supplier</td><td>Demo Wholesale Partner</td></tr>
          <tr><td>Supplier packaging</td><td>${esc(p.supplierPack)}</td></tr>
          <tr><td>Availability</td><td>${p.excluded ? 'Not in pilot' : 'Available (demo)'}</td></tr>
          <tr><td>Collection</td><td>${esc(cycle.distDay)}</td></tr>
        </table>
      </div>`;
  }

  /* ── orders ──────────────────────────────────────────── */
  function economics(t) {
    return `<table class="kv">
      <tr><td>Normal estimated price <span class="tiny mute">(reference basket)</span></td><td>${eur(t.ref)}</td></tr>
      <tr><td>Bulk purchasing saving</td><td class="ok">−${eur(t.gross)}</td></tr>
      <tr><td>Großry service contribution <span class="tiny mute">(20% of saving)</span></td><td>+${eur(t.fee)}</td></tr>
      <tr><td>Collection / handling</td><td>${eur(0)}</td></tr>
      ${t.credit ? `<tr><td>Großry credit</td><td class="ok">−${eur(t.credit)}</td></tr>` : ''}
      <tr class="total"><td>You pay</td><td>${eur(t.pay)}</td></tr>
      <tr class="hl"><td>Your net saving</td><td>${eur(t.net)}</td></tr>
    </table>`;
  }
  function ledger(t) {
    return `<div class="card">
      <h3>Savings ledger</h3>
      <p class="small" style="margin-bottom:.2rem">You saved <b class="save">${eur(t.gross)}</b> before Großry's share. Here's where it comes from:</p>
      <ul class="ledger">${LEDGER.map(([k, f]) => `<li><span>${k}</span><b>${eur(t.gross * f)}</b><span class="bar bar--save"><i style="width:${f * 100}%"></i></span></li>`).join('')}</ul>
      <p class="tiny mute" style="margin:.3rem 0 0"><b>Savings = reference retail basket price − actual Großry landed cost.</b> The split above is a modelled breakdown for the prototype.</p>
    </div>`;
  }
  function lineRow(l) {
    const p = l.p;
    const status = l.dropped ? '<span class="badge badge--warn">Not unlocked: refunded</span>'
      : S.stage >= 2 ? '<span class="badge badge--ok">Purchased</span>'
        : !l.ti.unlocked ? '<span class="badge badge--save">Estimate: not unlocked yet</span>' : '';
    return `<li style="display:grid;grid-template-columns:36px 1fr auto;gap:.6rem;align-items:center">
      <span class="pimg" style="width:36px;height:36px;font-size:1.2rem" aria-hidden="true">${p.icon}</span>
      <span><button class="linkbtn" style="text-decoration:none;color:var(--ink)" data-act="product" data-id="${p.id}">${esc(p.name)}</button><br><span class="tiny mute">${fq(l.q, p.unit)} × ${eur(l.ti.price)} · <span class="strike">${eur(l.ref)}</span> ${eur(l.landed)}</span> ${status}</span>
      ${locked() ? `<b class="small${l.dropped ? ' strike' : ''}">${eur(l.landed)}</b>` : stepper(p)}
    </li>`;
  }
  function screenOrders() {
    const L = lines(), t = totals();
    const past = `<div class="card"><h3>Past orders</h3><ul class="list">${D.history.map(h => `<li style="display:flex;justify-content:space-between;gap:.5rem"><span>${h.month}<br><span class="tiny mute">${h.items} items · ${eur(h.paid)}</span></span><span class="save small">saved ${eur(h.saved)}</span></li>`).join('')}</ul></div>`;

    if (!L.length) {
      return `<div class="card" style="text-align:center"><p style="font-size:2rem;margin:0">🧺</p><h3>Your ${cycle.month} basket is empty</h3>
        <p class="small mute">${locked() ? `Ordering for ${cycle.month} is closed. ${cycle.next} opens on the 1st.` : `Add your expected monthly groceries before 10 ${cycle.mon}, 23:59.`}</p>
        ${locked() ? '' : '<button class="btn" data-act="tab" data-tab="shop">Browse products</button>'}</div>${past}`;
    }

    if (!locked()) {
      return `<div class="card">
          <div class="card__head"><h3>Your ${cycle.month} basket</h3>${S.submitted ? '<span class="badge badge--ok">Submitted</span>' : '<span class="badge">Draft</span>'}</div>
          <ul class="list">${L.map(lineRow).join('')}</ul>
        </div>
        <div class="card">${economics(t)}
          <p class="tiny mute" style="margin:.5rem 0 0">Reference = average shelf price for comparable products across a defined retail basket. Prices are estimates until the order closes.</p></div>
        ${ledger(t)}
        <div class="card">
          <label class="toggle"><span>Allow substitutions<br><span class="tiny mute">If an item is unavailable, accept a comparable product at the same or lower price.</span></span><input type="checkbox" data-change="subs" ${S.subs ? 'checked' : ''}></label>
          ${S.credits ? `<p class="small" style="margin:.5rem 0 0">Credit available: <b>${eur(S.credits)}</b> (applied automatically).</p>` : ''}
        </div>
        <div class="card card--info small">
          <b>Demand lock:</b> you can change or cancel until <b>10 ${cycle.mon}, 23:59</b>. After that the order is committed to the supplier and can't be cancelled. Items that don't reach their bulk minimum are refunded${S.subs ? ' or substituted' : ''}.
        </div>
        ${S.submitted
          ? `<div class="btnrow"><button class="btn btn--warn" data-act="cancel-order">Cancel order</button></div><p class="tiny mute" style="text-align:center;margin-top:.5rem">Changes to quantities are saved to your submitted order automatically.</p>`
          : `<button class="btn btn--block" data-act="submit-order">Submit order · ${eur(t.pay)}</button><p class="tiny mute" style="text-align:center;margin-top:.5rem">Prototype: no payment is taken.</p>`}
        <div style="height:.8rem"></div>${past}`;
    }

    if (!S.submitted) {
      return `<div class="card card--info"><h3>Basket not submitted</h3><p class="small" style="margin:0">Ordering for ${cycle.month} closed before you submitted. Your basket rolls over to ${cycle.next}.</p></div>${past}`;
    }

    // Locked and submitted: tracking + collection
    const track = [
      ['Order submitted', true],
      ['Bulk targets aggregated', S.stage >= 1],
      ['Purchased', S.stage >= 2],
      ['Arrived at campus', S.stage >= 3],
      ['Sorted', S.stage >= 4],
      ['Waiting for collection', S.stage >= 5 && !S.noShow],
      ['Collected', S.collected]
    ];
    const nowIdx = track.findIndex(x => !x[1]);
    const dropped = L.filter(l => l.dropped);
    const wgN = S.wg && S.wg.consolidated ? S.wg.members.length : 0;

    return `<div class="card card--info small"><b>🔒 Your order is now locked.</b> It has been committed to procurement.</div>
      <div class="card">
        <div class="card__head"><h3>Order ${S.code}</h3><span class="badge badge--ok">${eur(t.pay)}</span></div>
        <ul class="tl">${track.map((x, i) => `<li class="${x[1] ? 'done' : i === nowIdx ? 'now' : ''}"><i></i><b>${x[0]}</b></li>`).join('')}</ul>
      </div>

      ${S.noShow ? `<div class="card card--warn small"><b>Not collected.</b> Your order is held at the campus pickup point for 48 h (demo rule). After that it is donated, without a refund.</div>` : ''}

      ${S.collected ? rateCard() : `<div class="card">
        <h3>Your collection</h3>
        <div class="collect">
          <div class="qr">${qrSvg(S.code)}</div>
          <div class="small">
            <b style="font-size:1rem">${esc(cycle.distDay)}</b><br>
            📍 ${esc(S.user ? UNI[S.user.uni].name + ', ' + S.user.campus : 'Campus')}, Building X foyer<br>
            Slot: <b>${SLOT_TIMES[S.slot]}</b>${S.priority ? ' <span class="badge badge--ok">Priority</span>' : ''}<br>
            Order: <b class="mono">${S.code}</b>
            ${wgN ? `<br><span class="badge badge--info">WG pickup for ${wgN + 1}</span>` : ''}
          </div>
        </div>
        <p class="small" style="margin:.7rem 0 0">Please arrive within your assigned slot. Your runner scans this code at handover.</p>
        <p class="tiny mute" style="margin:.2rem 0 0">Illustrative code, not a real scannable QR.</p>
        <div class="btnrow">
          ${S.stage < 5 ? '<button class="btn btn--ghost btn--sm" data-act="change-slot">Change slot</button>' : ''}
          ${S.stage === 5 ? '<button class="btn btn--sm" data-act="self-handover">Simulate: show QR to runner</button>' : ''}
        </div>
      </div>`}

      <div class="card">
        <h3>Items</h3>
        <ul class="list">${L.map(lineRow).join('')}</ul>
        ${dropped.length ? `<p class="small" style="margin:.4rem 0 0">${dropped.length} item${dropped.length > 1 ? 's' : ''} didn't reach the bulk minimum and ${dropped.length > 1 ? 'are' : 'is'} refunded${S.subs ? ' (no comparable substitute in stock)' : ''}.</p>` : ''}
      </div>
      <div class="card">${economics(t)}</div>
      ${ledger(t)}
      ${S.stage >= 5 ? '<button class="btn btn--ghost btn--block" data-act="problem">Report a problem with this order</button><div style="height:.8rem"></div>' : ''}
      ${past}`;
  }
  function rateCard() {
    if (S.rated) return `<div class="card card--save"><h3>✅ Collected. Thank you!</h3><p class="small" style="margin:0">You rated your runner ${S.rated.avg.toFixed(1)}★. +20 points for collecting on time.</p></div>`;
    const crit = ['On time', 'Complete', 'Friendly / professional', 'Correct distribution', 'Product handling'];
    return `<div class="card card--save">
      <h3>✅ Order ${S.code} delivered</h3>
      <p class="small">Status changed: Prepared → Collected. How was your Order Runner?</p>
      ${crit.map((c, i) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:.2rem 0" class="small"><span>${c}</span><span class="starpick" role="radiogroup" aria-label="${c}">${[1, 2, 3, 4, 5].map(v => `<button data-act="star" data-k="${i}" data-v="${v}" class="${(ui.rate[i] || 0) >= v ? 'on' : ''}" aria-label="${v} stars">★</button>`).join('')}</span></div>`).join('')}
      <button class="btn btn--block" style="margin-top:.6rem" data-act="submit-rating">Submit rating</button>
    </div>`;
  }

  /* ── run ─────────────────────────────────────────────── */
  function runnerDashboard() {
    const total = OTHERS + (S.submitted ? 1 : 0);
    const collected = S.runner.handed + (S.collected ? 1 : 0);
    const issues = S.runner.issues;
    const waiting = Math.max(0, total - collected - issues);
    let cum = 0;
    const rows = BASE_LOADS.map((l, i) => {
      const n = l + (S.submitted && S.slot === i ? 1 : 0);
      const start = cum; cum += n;
      const st = S.runner.handed >= cum ? '<span class="ok">Done</span>' : S.runner.handed > start ? '<span class="save">Now</span>' : '<span class="mute">Next</span>';
      return `<tr><td>${SLOT_TIMES[i]}</td><td class="right">${n}</td><td class="right">${st}</td></tr>`;
    }).join('');
    const queue = [0, 1, 2].map(k => 'GR-' + (4000 + ((S.runner.handed + k) * 377) % 5000));
    return `<div class="card">
      <h3>Today's distribution · ${total} orders</h3>
      <div class="grid2" style="grid-template-columns:repeat(3,1fr)">
        <div class="stat"><b class="ok">${collected}</b><span>collected</span></div>
        <div class="stat"><b class="save">${waiting}</b><span>waiting</span></div>
        <div class="stat"><b class="bad">${issues}</b><span>issues</span></div>
      </div>
      <form data-form="scan" style="display:flex;gap:.4rem;margin:.8rem 0 .3rem">
        <label class="sr-only" for="scanIn">Order code</label>
        <input id="scanIn" name="code" class="search" style="margin:0" placeholder="Scan or type code, e.g. ${S.submitted ? S.code : 'GR-4377'}" autocomplete="off">
        <button class="btn btn--sm">Scan</button>
      </form>
      <p class="small" style="margin:.5rem 0 .2rem"><b>Next in queue</b></p>
      <ul class="list">${queue.map(c => `<li style="display:flex;justify-content:space-between;align-items:center"><span class="mono small">${c}</span><button class="btn btn--ghost btn--sm" data-act="handover" data-code="${c}">Confirm handover</button></li>`).join('')}</ul>
      <div class="btnrow"><button class="btn btn--sm" data-act="handover-batch">Simulate next few handovers</button><button class="btn btn--warn btn--sm" data-act="runner-issue">Report issue</button></div>
      <table class="kv small" style="margin-top:.8rem"><tr><th>Slot</th><th class="right">Orders</th><th>Status</th></tr>${rows}</table>
      <p class="tiny mute" style="margin:.4rem 0 0">Capacity: ${SLOT_CAP} people per 15 minutes, allocated automatically.</p>
    </div>`;
  }
  function screenRun() {
    const c = community(), R = S.runner;
    const role = isRunner() ? 'primary' : isBackup() ? 'backup' : null;
    const canSign = S.stage <= 1;
    const name = x => x === 'you' ? '<b>You</b>' : x ? esc(x) : '<span class="mute">Open</span>';
    const steps = [['Pick up bulk order at Demo Wholesale Partner', 2], ['Transport to campus', 3], ['Sort into orders (ambient goods only)', 4], ['Run distribution 16:00–19:00', 5], ['Hand back unclaimed orders and close the run', 6]];

    return `<div class="card">
        <span class="eyebrow">This month's bulk order</span>
        <div class="grid2" style="grid-template-columns:repeat(3,1fr)">
          <div class="stat"><b>${num(c.participants)}</b><span>students</span></div>
          <div class="stat"><b>${num(c.units)}</b><span>units</span></div>
          <div class="stat"><b>${eur0(c.value)}</b><span>order value</span></div>
        </div>
      </div>

      <div class="card">
        <h3>Can you collect this order for your university?</h3>
        <table class="kv small">
          <tr><td>Estimated workload</td><td>3.5 hours</td></tr>
          <tr><td>Transport required</td><td>Car or van (rental reimbursed)</td></tr>
          <tr><td>Collection location</td><td>Demo Wholesale Partner</td></tr>
          <tr><td>University</td><td>${esc(S.user ? UNI[S.user.uni].name + ', ' + S.user.campus : '')}</td></tr>
          <tr><td>Distribution</td><td>${esc(cycle.distDay)}, 16:00–19:00</td></tr>
        </table>
        <div class="card card--save small" style="margin:.7rem 0 0"><b>Incentive:</b> €20 grocery credit + transport reimbursement (€0.30/km, max €15).<br><b>Backup runner:</b> €5 reservation credit, paid even if not activated.</div>
      </div>

      <div class="card">
        <h3>Runners for ${cycle.month}</h3>
        <table class="kv small">
          <tr><td>Primary runner</td><td>${name(R.primary)}</td></tr>
          <tr><td>Backup runner</td><td>${name(R.backup)}</td></tr>
        </table>
        ${canSign ? `<div class="btnrow">
          ${role ? `<button class="btn btn--ghost btn--sm" data-act="runner-withdraw">Withdraw (${role})</button>` : `
          <button class="btn btn--sm" data-act="runner-join" data-role="primary" ${R.primary ? 'disabled' : ''}>Volunteer as primary</button>
          <button class="btn btn--ghost btn--sm" data-act="runner-join" data-role="backup" ${R.backup ? 'disabled' : ''}>Volunteer as backup</button>`}
        </div>` : ''}
        ${R.primary && S.stage >= 1 && S.stage <= 4 ? `<button class="linkbtn small" style="margin-top:.6rem" data-act="runner-cancel">Simulate: primary runner cancels</button>` : ''}
        <p class="tiny mute" style="margin:.5rem 0 0">Every run has a backup, so no single student is a point of failure. Volunteering is voluntary and not employment.</p>
      </div>

      ${isRunner() && S.stage >= 1 ? `<div class="card">
        <h3>Your assignment</h3>
        <ul class="tl">${steps.map(([s, st]) => `<li class="${S.stage >= st ? 'done' : S.stage === st - 1 ? 'now' : ''}"><i></i><b>${s}</b></li>`).join('')}</ul>
        <p class="tiny mute" style="margin:0"><b>Hygiene checklist:</b> keep goods dry and off the floor, no chilled/frozen items, wash hands before sorting, report damaged packaging.</p>
      </div>` : ''}

      ${S.stage === 5 && (isRunner() || ui.preview) ? runnerDashboard() : ''}
      ${S.stage === 5 && !isRunner() && !ui.preview ? `<div class="card small">Distribution is running now with ${name(R.primary)}. <button class="linkbtn" data-act="preview-runner">Preview the runner dashboard</button></div>` : ''}
      ${S.stage < 5 && !isRunner() ? `<p class="small mute">The runner dashboard (slot schedule, live status, QR scanning) unlocks on distribution day. Volunteer as primary, or press <b>Advance ▶</b> to distribution day to preview it.</p>` : ''}
      ${R.done ? `<div class="card card--save small"><b>Run complete.</b> €20 credit added to your account, +100 points, and transport reimbursement of €12.60 (demo) recorded.</div>` : ''}

      <div class="card">
        <h3>Your runner reputation</h3>
        <div class="grid2">
          <div class="stat"><b>${R.runs}</b><span>completed runs</span></div>
          <div class="stat"><b>${R.rating ? R.rating.toFixed(1) + ' ★' : '—'}</b><span>average rating</span></div>
        </div>
        <p class="small" style="margin:.6rem 0 0">${R.runs >= 3 ? '<span class="badge badge--ok">🏅 Trusted Order Runner</span>' : `<b>Trusted Order Runner</b> badge after 3 successful runs (${R.runs}/3).`}</p>
        <p class="tiny mute" style="margin:.4rem 0 0">Students rate: on time, complete, friendly, correct distribution and product handling.</p>
      </div>`;
  }

  /* ── profile ─────────────────────────────────────────── */
  function screenProfile() {
    const u = S.user;
    const initials = u.name.split(/\s+/).map(x => x[0]).join('').slice(0, 2).toUpperCase();
    return `<div class="card" style="display:flex;gap:.8rem;align-items:center">
        <span class="avatar">${ui.photo ? `<img src="${ui.photo}" alt="">` : esc(initials)}</span>
        <div style="min-width:0"><h3 style="margin:0">${esc(u.name)}</h3><p class="small mute" style="margin:0;overflow-wrap:anywhere">${esc(u.email)}</p>
        <p class="small" style="margin:0">${esc(UNI[u.uni].name)} · ${esc(u.campus)} <span class="badge badge--ok">✓ Verified</span></p></div>
      </div>

      <div class="grid2" style="margin-bottom:.8rem">
        <button class="stat" style="border:0;text-align:left" data-act="points"><b>${num(S.points)}</b><span>Großry Points ›</span></button>
        <div class="stat"><b>${eur(S.credits)}</b><span>grocery credit</span></div>
      </div>

      <div class="card" style="padding:.2rem .9rem">
        <button class="rowbtn" data-act="sub" data-name="wg">WG mode ${S.wg ? `<span class="badge badge--ok">${esc(S.wg.name)}</span>` : ''}</button>
        <button class="rowbtn" data-act="sub" data-name="community">Community: requests &amp; forum</button>
        <button class="rowbtn" data-act="plus">Großry Plus <span class="badge">concept</span></button>
        <button class="rowbtn" data-act="view" data-v="admin">Admin dashboard</button>
      </div>

      <div class="card">
        <h3>Notifications</h3>
        <label class="toggle"><span>Order status &amp; collection slot</span><input type="checkbox" data-change="notif" data-k="order" ${S.notif.order ? 'checked' : ''}></label>
        <label class="toggle"><span>Runner opportunities</span><input type="checkbox" data-change="notif" data-k="runner" ${S.notif.runner ? 'checked' : ''}></label>
        <label class="toggle"><span>Community &amp; price-tier updates</span><input type="checkbox" data-change="notif" data-k="community" ${S.notif.community ? 'checked' : ''}></label>
      </div>

      <div class="card">
        <h3>Privacy</h3>
        <label class="toggle"><span>Include my orders in aggregated market statistics<br><span class="tiny mute">Only totals over groups of 10+ students, never individual profiles.</span></span><input type="checkbox" data-change="insights" ${S.insights ? 'checked' : ''}></label>
        <p class="small" style="margin:.6rem 0 .3rem"><b>What we hold about you:</b> name, student email, phone, university, campus, orders, collection slot. No photo is required. Payment data would stay with the payment provider.</p>
        <div class="btnrow"><button class="btn btn--ghost btn--sm" data-act="export">Download my data</button><button class="btn btn--warn btn--sm" data-act="delete-account">Delete account</button></div>
      </div>

      <div class="card" style="padding:.2rem .9rem">
        <button class="rowbtn" data-act="legal" data-doc="terms">Terms and Conditions (draft)</button>
        <button class="rowbtn" data-act="legal" data-doc="privacy">Privacy Policy (draft)</button>
      </div>
      <p class="tiny mute" style="text-align:center">Großry prototype · fictional data</p>`;
  }

  /* ── community ───────────────────────────────────────── */
  function screenCommunity() {
    const seg = `<div class="seg" style="display:flex;margin-bottom:.8rem"><button style="flex:1" data-act="comm" data-v="requests" aria-pressed="${ui.comm === 'requests'}">Requests</button><button style="flex:1" data-act="comm" data-v="forum" aria-pressed="${ui.comm === 'forum'}">Forum</button></div>`;
    if (ui.comm === 'requests') {
      const reqs = S.myRequests.concat(D.requests);
      return seg + `<div class="card"><h3>What should Großry add?</h3>
          <form data-form="request" style="display:flex;gap:.4rem"><label class="sr-only" for="reqIn">Product name</label><input id="reqIn" name="name" class="search" style="margin:0" placeholder="e.g. Jasmine rice 10 kg" maxlength="60" ${locked() ? '' : ''}><button class="btn btn--sm">Request</button></form></div>
        ${reqs.map(r => { const v = r.votes + (S.votes[r.id] ? 1 : 0); return `<div class="card">
          <div class="card__head"><h3>${esc(r.name)}</h3><button class="btn btn--sm ${S.votes[r.id] ? '' : 'btn--ghost'}" data-act="vote" data-id="${r.id}" aria-pressed="${!!S.votes[r.id]}">▲ ${v}</button></div>
          <p class="small" style="margin-bottom:.3rem">${v} students requested it · potential bulk order <b>${v}/${r.goal}</b></p>
          <div class="bar"><i style="width:${Math.min(100, v / r.goal * 100)}%"></i></div>
          ${v >= r.goal ? '<p class="small ok" style="margin:.4rem 0 0">Goal reached: sent to sourcing for a supplier quote.</p>' : ''}
          ${r.note ? `<p class="tiny mute" style="margin:.4rem 0 0">${esc(r.note)}</p>` : ''}</div>`; }).join('')}`;
    }
    const cats = ['All', 'Product Reviews', 'Requests', 'Deals', 'WGs', 'Problems'];
    const posts = S.posts.concat(D.forum).filter(p => ui.forumCat === 'All' || p.cat === ui.forumCat);
    return seg + `<div class="chips">${cats.map(c => `<button class="chip" data-act="forum-cat" data-cat="${c}" aria-pressed="${ui.forumCat === c}">${c}</button>`).join('')}</div>
      <button class="btn btn--block" style="margin-bottom:.8rem" data-act="new-post">New post</button>
      ${posts.map(p => `<button class="post" data-act="thread" data-id="${p.id}"><span class="badge">${esc(p.cat)}</span><span class="post__t">${esc(p.title)}</span><span class="post__b">${esc(p.body)}</span><span class="post__m tiny">${esc(p.author)} · ${esc(p.ago)} · ${p.replies.length + (S.replies[p.id] || []).length} replies</span></button>`).join('')}
      <p class="tiny mute">Community guidelines: no unlawful, abusive, misleading or harmful content. Posts may be moderated.</p>`;
  }

  /* ── WG mode ─────────────────────────────────────────── */
  function screenWG() {
    if (!S.wg) {
      return `<div class="card"><h3>Order as a WG</h3><p class="small">Combine your flat's orders into one consolidated pickup: one slot, one person collects, fewer trips for everyone.</p>
        <form data-form="wg">
          <label class="field"><span>WG name</span><input name="name" maxlength="30" placeholder="e.g. WG Birkenweg"></label>
          <label class="field"><span>Flatmates (first names, comma separated)</span><input name="members" maxlength="120" placeholder="Lena, Omar, Ji-woo"><small>Prototype: flatmates are simulated with demo baskets.</small></label>
          <button class="btn btn--block">Create WG</button>
        </form></div>
        <div class="card small"><b>Have an invite code?</b> In the real app, a flatmate's invite link adds you to their WG.</div>`;
    }
    const t = totals();
    const mates = S.wg.members.map((m, i) => ({ name: m, pay: [41.2, 63.9, 28.4, 55.1, 37.7][i % 5], net: [10.6, 15.2, 7.1, 13.8, 9.4][i % 5] }));
    const sumPay = mates.reduce((a, m) => a + m.pay, 0) + t.pay, sumNet = mates.reduce((a, m) => a + m.net, 0) + t.net;
    return `<div class="card"><div class="card__head"><h3>${esc(S.wg.name)}</h3><span class="badge badge--ok">${mates.length + 1} members</span></div>
        <table class="kv"><tr><th>Member</th><th>Order</th></tr>
        <tr><td><b>You</b></td><td>${eur(t.pay)}</td></tr>
        ${mates.map(m => `<tr><td>${esc(m.name)}</td><td>${eur(m.pay)}</td></tr>`).join('')}
        <tr class="total"><td>Combined order</td><td>${eur(sumPay)}</td></tr>
        <tr class="hl"><td>Combined net saving</td><td>${eur(sumNet)}</td></tr></table></div>
      <div class="card">
        <label class="toggle"><span>One consolidated pickup<br><span class="tiny mute">One person collects all ${mates.length + 1} orders in one slot.</span></span><input type="checkbox" data-change="wg-consolidated" ${S.wg.consolidated ? 'checked' : ''}></label>
        ${S.wg.consolidated ? `<p class="small" style="margin:.5rem 0 0">Pickup person: <b>You</b>. Your QR covers the whole WG.</p>` : ''}
      </div>
      <button class="btn btn--warn btn--block" data-act="wg-leave">Leave WG</button>`;
  }

  /* ── sheets ──────────────────────────────────────────── */
  function pointsSheet() {
    openSheet('Großry Points', `<p class="big" style="margin-bottom:.2rem">${num(S.points)}</p><p class="small mute">Earn by ordering (1 pt per €), running orders (+100), inviting classmates (+10), collecting on time (+20) and reviewing (+5).</p>
      <h4 style="margin:.8rem 0 .4rem">Redeem</h4>
      <ul class="list">${REWARDS.map(r => `<li style="display:flex;justify-content:space-between;align-items:center;gap:.5rem"><span class="small">${r.name}<br><span class="tiny mute">${r.cost} points</span></span><button class="btn btn--sm" data-act="redeem" data-id="${r.id}" ${S.points < r.cost || (r.id === 'prio' && S.priority) ? 'disabled' : ''}>${r.id === 'prio' && S.priority ? 'Active' : 'Redeem'}</button></li>`).join('')}</ul>
      <h4 style="margin:.8rem 0 .4rem">History</h4>
      <ul class="list">${S.pointsLog.slice(0, 12).map(([l, n]) => `<li style="display:flex;justify-content:space-between" class="small"><span>${esc(l)}</span><b class="${n < 0 ? 'bad' : 'ok'}">${n > 0 ? '+' : ''}${n}</b></li>`).join('')}</ul>`);
  }
  function slotSheet() {
    openSheet('Choose a collection slot', `<p class="small mute">Slots are allocated automatically to spread arrivals: max ${SLOT_CAP} people per 15 minutes.${S.priority ? ' Priority pickup lets you pick a full slot.' : ''}</p>
      <div class="slots">${SLOT_TIMES.map((tm, i) => { const full = slotFull(i) && S.slot !== i && !S.priority; return `<button class="slot" data-act="pick-slot" data-i="${i}" aria-pressed="${S.slot === i}" ${full ? 'disabled' : ''}><b>${tm.split('–')[0]}</b>${S.slot === i ? 'Your slot' : slotFull(i) ? 'Full' : (SLOT_CAP - BASE_LOADS[i]) + ' left'}</button>`; }).join('')}</div>`);
  }
  function threadSheet(id) {
    const p = S.posts.concat(D.forum).find(x => x.id === id);
    const rs = p.replies.concat(S.replies[id] || []);
    openSheet(esc(p.title), `<span class="badge">${esc(p.cat)}</span><p class="small" style="margin:.5rem 0">${esc(p.body)}</p><p class="tiny mute">${esc(p.author)} · ${esc(p.ago)}</p>
      ${rs.map(r => `<div class="reply"><b class="small">${esc(r[0])}</b><br>${esc(r[1])}</div>`).join('') || '<p class="small mute">No replies yet.</p>'}
      <form data-form="reply" data-id="${esc(id)}"><label class="field"><span>Reply</span><textarea name="text" maxlength="400"></textarea></label><button class="btn btn--block">Post reply</button></form>`);
  }

  /* =====================================================
     ADMIN
     ===================================================== */
  function renderAdmin() {
    const rows = D.products.map(p => {
      const ti = tierInfo(p), q = ti.t, landed = q * ti.price;
      return { p, ti, q, landed, wholesale: landed * (1 - LOGISTICS), logistics: landed * LOGISTICS, fee: q * (p.ref - ti.price) * FEE, net: q * (p.ref - ti.price) * (1 - FEE), buy: ti.unlocked && !p.excluded };
    });
    const B = rows.filter(r => r.buy);
    const sum = k => B.reduce((a, r) => a + r[k], 0);
    const c = community();
    const total = OTHERS + (S.submitted ? 1 : 0);
    const collected = S.stage >= 6 ? total - (S.noShow ? 1 : 0) - 2 : S.runner.handed + (S.collected ? 1 : 0);
    const status = S.stage < 2 ? 'Estimated' : 'Realised';
    const incidents = S.problems.length + S.runner.issues;
    const damaged = S.stage >= 3 ? 2 : 0;
    const runnerName = x => x === 'you' ? (S.user ? esc(S.user.name) + ' (you)' : 'You') : x ? esc(x) : '<span class="bad">Unassigned</span>';
    const sacks = rows.filter(r => r.p.shared && r.buy);
    const insightRows = rows.filter(r => !r.p.excluded).map(r => ({ name: r.p.name, n: r.p.students + (S.cart[r.p.id] && S.insights ? 1 : 0), q: r.q, unit: r.p.unit }));

    $('#adminView').innerHTML = `<div class="admin">
      <div class="admin__head"><div><span class="eyebrow">Admin dashboard · demo campus</span><h1>${cycle.month} ${cycle.year} cycle</h1></div>
        <span class="stagepill">${STAGES[S.stage].label} · ${STAGES[S.stage].when}</span></div>

      <div class="kpis">
        <div class="kpi"><b>${num(c.participants)}</b><span>active students this cycle</span></div>
        <div class="kpi"><b>${B.length}/${rows.length}</b><span>products past bulk minimum</span></div>
        <div class="kpi"><b>${eur0(sum('landed') + sum('fee'))}</b><span>gross sales (${status.toLowerCase()})</span></div>
        <div class="kpi"><b>${eur0(sum('fee'))}</b><span>platform revenue (20% of savings)</span></div>
        <div class="kpi"><b>${eur0(sum('net'))}</b><span>student net savings</span></div>
        <div class="kpi"><b>${incidents}</b><span>open incidents</span></div>
      </div>

      <div class="panels">
        <section class="panel panel--wide"><h2>Procurement</h2><p>Total quantity required per product, against the supplier's price tiers. Items below the minimum at close are dropped and refunded.</p>
          <div class="tablewrap"><table class="dt">
            <thead><tr><th>Product</th><th class="num">Required</th><th>Tier progress</th><th class="num">Wholesale / unit</th><th class="num">Landed / unit</th><th class="num">Min. order</th><th>Supplier</th><th>Delivery</th><th>Status</th></tr></thead>
            <tbody>${rows.map(r => `<tr><td>${r.p.icon} ${esc(r.p.name)}</td><td class="num">${fq(r.q, r.p.unit)}</td>
              <td><span class="minibar"><i style="width:${r.ti.pct}%"></i></span><span class="tiny mute">${r.ti.next ? 'next ' + fq(r.ti.next[0], r.p.unit) : 'top'}</span></td>
              <td class="num">${eur(r.ti.price * (1 - LOGISTICS))}</td><td class="num">${eur(r.ti.price)}</td><td class="num">${fq(r.p.tiers[0][0], r.p.unit)}</td><td>Demo Wholesale Partner</td><td>14 ${cycle.mon}</td>
              <td>${r.p.excluded ? '<span class="badge badge--warn">Excluded: cold chain</span>' : r.ti.unlocked ? '<span class="badge badge--ok">Unlocked</span>' : `<span class="badge badge--save">${locked() ? 'Dropped' : 'Below minimum'}</span>`}</td></tr>`).join('')}</tbody>
          </table></div></section>

        <section class="panel"><h2>Inventory</h2><p>${S.stage < 3 ? 'Goods not yet received.' : 'Received ambient goods for this cycle.'}</p>
          <table class="dt"><tbody>
            <tr><td>Received units</td><td class="num">${S.stage >= 3 ? num(c.units - damaged) : '—'}</td></tr>
            <tr><td>Distributed orders</td><td class="num">${S.stage >= 5 ? num(collected) + ' / ' + total : '—'}</td></tr>
            <tr><td>Remaining orders</td><td class="num">${S.stage >= 5 ? num(total - collected) : '—'}</td></tr>
            <tr><td>Damaged units</td><td class="num">${damaged}</td></tr>
            <tr><td>Expiring within 30 days</td><td class="num">0</td></tr>
          </tbody></table></section>

        <section class="panel"><h2>Users</h2><p>Demo campus.</p>
          <table class="dt"><tbody>
            <tr><td>Verified students</td><td class="num">${num(c.participants + 74)}</td></tr>
            <tr><td>Active this cycle</td><td class="num">${num(c.participants)}</td></tr>
            <tr><td>Orders</td><td class="num">${num(total)}</td></tr>
            <tr><td>Cancellations (before lock)</td><td class="num">6</td></tr>
            <tr><td>No-shows</td><td class="num">${S.stage >= 6 ? 2 + (S.noShow ? 1 : 0) : '—'}</td></tr>
          </tbody></table></section>

        <section class="panel"><h2>Finance</h2><p>${status} for products past their minimum.</p>
          <table class="dt"><tbody>
            <tr><td>Gross sales</td><td class="num">${eur(sum('landed') + sum('fee'))}</td></tr>
            <tr><td>Procurement cost</td><td class="num">${eur(sum('wholesale'))}</td></tr>
            <tr><td>Logistics cost (incl. runner credit)</td><td class="num">${eur(sum('logistics'))}</td></tr>
            <tr><td>Platform revenue</td><td class="num">${eur(sum('fee'))}</td></tr>
            <tr><td>Actual student savings (net)</td><td class="num">${eur(sum('net'))}</td></tr>
          </tbody></table></section>

        <section class="panel"><h2>Operations</h2><p>Distribution ${esc(cycle.distDay)}, 16:00–19:00.</p>
          <table class="dt"><tbody>
            <tr><td>Current runner</td><td class="num">${runnerName(S.runner.primary)}</td></tr>
            <tr><td>Backup runner</td><td class="num">${runnerName(S.runner.backup)}</td></tr>
            <tr><td>Distribution slots</td><td class="num">${BASE_LOADS.length} × 15 min</td></tr>
            <tr><td>Slot utilisation</td><td class="num">${Math.round(total / (BASE_LOADS.length * SLOT_CAP) * 100)}%</td></tr>
            <tr><td>Open incidents</td><td class="num">${incidents}</td></tr>
          </tbody></table></section>

        <section class="panel"><h2>Pack splitting</h2><p>Supplier sacks split into student portions.</p>
          <table class="dt"><thead><tr><th>Product</th><th class="num">Demand</th><th class="num">Sacks</th><th class="num">Last sack</th></tr></thead><tbody>
            ${sacks.map(r => { const full = Math.floor(r.q / r.p.sack), rest = +(r.q - full * r.p.sack).toFixed(1); return `<tr><td>${esc(r.p.name)}</td><td class="num">${fq(r.q, 'kg')}</td><td class="num">${full + (rest ? 1 : 0)} × ${r.p.sack} kg</td><td class="num">${rest ? rest + ' kg' : 'full'}</td></tr>`; }).join('') || '<tr><td colspan="4" class="mute">None unlocked.</td></tr>'}
          </tbody></table></section>

        <section class="panel panel--wide"><h2>Aggregated market insights (preview)</h2>
          <p>What a supplier or research partner could see: totals only, no individual or location data. Any product bought by fewer than 10 students is suppressed, so no row can single out a person. Students who opted out are excluded.</p>
          <div class="tablewrap"><table class="dt"><thead><tr><th>Product</th><th class="num">Students</th><th class="num">Total quantity</th><th>Shared?</th></tr></thead><tbody>
            ${insightRows.map(r => r.n < 10 ? `<tr><td>${esc(r.name)}</td><td class="num mute">&lt; 10</td><td class="num mute">suppressed</td><td class="mute">No (below threshold)</td></tr>` : `<tr><td>${esc(r.name)}</td><td class="num">${r.n}</td><td class="num">${fq(r.q, r.unit)}</td><td class="ok">Yes</td></tr>`).join('')}
          </tbody></table></div></section>

        <section class="panel panel--wide"><h2>Savings methodology</h2>
          <p style="color:var(--ink)"><b>Savings = reference retail basket price − actual Großry landed cost.</b> The reference is the average shelf price for a comparable product across a defined, published basket of retailers, never the most expensive one. Landed cost = wholesale price + transport + handling (${LOGISTICS * 100}% in this model). Großry keeps 20% of the verified saving; students keep 80%. The benchmark and fee structure must be validated before launch.</p></section>
      </div>
      <p class="small mute" style="margin-top:1rem">All figures are fictional demo data, derived live from the same model the student app uses. <button class="linkbtn" data-act="view" data-v="app">Back to student app</button></p>
    </div>`;
  }

  /* =====================================================
     RENDER
     ===================================================== */
  function current() { return ui.stack.length ? ui.stack[ui.stack.length - 1] : { name: S.tab }; }
  let lastKey = '';
  function render() {
    // chrome
    document.querySelectorAll('[data-act="view"][data-v]').forEach(b => { if (b.closest('.seg')) b.setAttribute('aria-pressed', String(S.view === b.dataset.v)); });
    $('#stagePill').textContent = STAGES[S.stage].label;
    $('[data-act="stage-prev"]').disabled = S.stage === 0;
    $('[data-act="stage-next"]').disabled = S.stage === STAGES.length - 1;
    $('#themeBtn').textContent = effectiveTheme() === 'dark' ? 'Light' : 'Dark';
    $('#appView').hidden = S.view !== 'app';
    $('#adminView').hidden = S.view !== 'admin';
    if (S.view === 'admin') { renderAdmin(); return; }

    const scr = $('#screen');
    if (!S.user) {
      $('#appbar').innerHTML = `<h2>Welcome</h2>`;
      $('#tabbar').hidden = true;
      scr.innerHTML = screenOnboarding();
      lastKey = 'ob';
      return;
    }
    $('#tabbar').hidden = false;
    const cur = current();
    const key = cur.name + (cur.id || '');
    const keep = key === lastKey ? scr.scrollTop : 0;
    const titles = { home: 'Großry', shop: 'Shop', orders: 'Orders', run: 'Run an order', profile: 'Profile', community: 'Community', wg: 'WG mode', product: cur.id ? P[cur.id].name : '' };
    const count = Object.values(S.cart).reduce((a, b) => a + b, 0);
    $('#appbar').innerHTML = `${ui.stack.length ? '<button class="iconbtn" data-act="back" aria-label="Back">←</button>' : ''}
      <h2>${esc(titles[cur.name])}</h2>
      <span class="badge badge--ok" title="Großry Points">${num(S.points)} pts</span>
      <button class="iconbtn" data-act="tab" data-tab="orders" aria-label="Basket, ${count} items">🧺${count ? `<span class="dot">${count}</span>` : ''}</button>`;

    const map = { home: screenHome, shop: screenShop, orders: screenOrders, run: screenRun, profile: screenProfile, community: screenCommunity, wg: screenWG };
    scr.innerHTML = cur.name === 'product' ? screenProduct(cur.id) : map[cur.name]();
    scr.scrollTop = keep;
    lastKey = key;

    $('#tabbar').innerHTML = TABS.map(([k, l]) => `<button data-act="tab" data-tab="${k}" ${S.tab === k ? 'aria-current="page"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>${l}</button>`).join('');

    // floating basket on shop/product
    const fab = $('#fab'); if (fab) fab.remove();
    if ((cur.name === 'shop' || cur.name === 'product') && count && !locked()) {
      const t = totals();
      $('#phone').insertAdjacentHTML('beforeend', `<button class="fab" id="fab" data-act="tab" data-tab="orders">🧺 Basket · ${eur(t.pay)} <span style="opacity:.8;font-weight:500">save ${eur(t.net)}</span></button>`);
    }
  }

  function go(tab) { S.tab = tab; ui.stack = []; ui.preview = false; save(); render(); $('#screen').scrollTop = 0; }
  function push(name, id) { ui.stack.push({ name, id }); render(); $('#screen').scrollTop = 0; }

  /* ── theme ───────────────────────────────────────────── */
  function effectiveTheme() {
    const t = document.documentElement.dataset.theme;
    if (t) return t;
    return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  /* ── stage transitions ───────────────────────────────── */
  function advance() {
    if (S.stage >= STAGES.length - 1) return;
    const from = S.stage; S.stage++;
    if (from === 0) {
      if (S.submitted) {
        const t = totals();                               // already computed with locked() pricing
        S.creditUsed = Math.min(S.credits, t.landed + t.fee);
        S.credits -= S.creditUsed;
        S.slot = allocateSlot();
        addPoints(`${cycle.month} order`, Math.floor(t.landed + t.fee - S.creditUsed));
        toast(`Order locked. Slot ${SLOT_TIMES[S.slot]} allocated automatically.`);
      } else if (lines().length) toast('Basket not submitted. It rolls over to next cycle.');
    }
    if (from === 1) {
      if (!S.runner.primary) S.runner.primary = 'Noah K. (Trusted Runner)';
      if (!S.runner.backup) S.runner.backup = 'Lina S.';
      if (isBackup()) { S.credits += 5; toast('Backup reservation: €5 credit added.'); }
    }
    if (from === 5) {
      if (S.submitted && !S.collected) S.noShow = true;
      if (isRunner() && !S.runner.done) {
        S.runner.done = true; S.runner.runs++; S.credits += 20; addPoints('Completed an Order Runner run', 100);
        S.runner.rating = 4.9;
      }
    }
    save(); render();
  }

  /* =====================================================
     EVENTS
     ===================================================== */
  const ACT = {
    view(el) { S.view = el.dataset.v; save(); render(); window.scrollTo(0, 0); },
    'stage-next': advance,
    'stage-prev'() { if (S.stage > 0) { S.stage--; save(); render(); } },
    theme() {
      const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('zt.theme', next); } catch (e) {}
      render();
    },
    reset() {
      if (!confirm('Reset the demo? This clears your demo account and basket from this browser.')) return;
      store.clear(); S = fresh(); ui.stack = []; ui.ob = { step: 'welcome' }; ui.photo = null; ui.rate = {}; closeSheet(); render();
    },
    ob(el) { ui.ob.step = el.dataset.step; ui.ob.err = null; render(); },
    'demo-login'() {
      S.user = { name: 'Alex Student', email: 'alex.demo@student.example', phone: '+49 000 0000000', uni: 'oth-aw', campus: 'Amberg', verified: true };
      S.cart = { rice: 5, oatmilk: 6, passata: 2, noodles: 3, sunoil: 2, tp: 1 };
      save(); render(); toast('Signed in with the demo account. Basket pre-filled.');
    },
    tab(el) { go(el.dataset.tab); },
    back() { ui.stack.pop(); render(); },
    sub(el) { push(el.dataset.name); },
    product(el) { push('product', el.dataset.id); },
    cat(el) { ui.shopCat = el.dataset.cat; render(); },
    qty(el) {
      if (locked()) return;
      const id = el.dataset.id, n = Math.max(0, (S.cart[id] || 0) + Number(el.dataset.d));
      const before = tierInfo(P[id]).idx;
      if (n) S.cart[id] = n; else delete S.cart[id];
      const after = tierInfo(P[id]).idx;
      if (after > before) toast(`🎉 New price tier unlocked: ${eur(P[id].tiers[after][1])}${per(P[id])}`);
      if (!Object.keys(S.cart).length && S.submitted) { S.submitted = false; toast('Basket empty: order withdrawn.'); }
      save(); render();
    },
    'share-product'(el) {
      const p = P[el.dataset.id], ti = tierInfo(p);
      share(ti.next ? `We need ${fq(ti.need, p.unit)} more ${p.name.toLowerCase()} to unlock ${eur(ti.next[1])}${per(p)} on Großry. Join this month's student order!` : `Join this month's Großry student grocery order!`);
    },
    'submit-order'() { S.submitted = true; save(); render(); toast(`Order submitted. You can change it until 10 ${cycle.mon}, 23:59.`); },
    'cancel-order'() { if (confirm('Cancel your submitted order? Your basket stays as a draft.')) { S.submitted = false; save(); render(); toast('Order cancelled. Nothing will be bought for you.'); } },
    'change-slot': slotSheet,
    'pick-slot'(el) { S.slot = Number(el.dataset.i); save(); closeSheet(); render(); toast(`Collection slot changed to ${SLOT_TIMES[S.slot]}.`); },
    'self-handover'() { S.collected = true; addPoints('Collected on time', 20); save(); render(); toast(`Order ${S.code} delivered. Status: Prepared → Collected.`); },
    star(el) { ui.rate[el.dataset.k] = Number(el.dataset.v); render(); },
    'submit-rating'() {
      const v = [0, 1, 2, 3, 4].map(i => ui.rate[i] || 0);
      if (v.some(x => !x)) { toast('Please rate all five points.'); return; }
      S.rated = { scores: v, avg: v.reduce((a, b) => a + b, 0) / 5 }; addPoints('Rated your runner', 5); save(); render();
    },
    problem() {
      const L = lines().filter(l => !l.dropped);
      openSheet('Report a problem', `<form data-form="problem">
        <label class="field"><span>Product</span><select name="item">${L.map(l => `<option>${esc(l.p.name)}</option>`).join('')}</select></label>
        <label class="field"><span>What happened?</span><select name="type"><option>Missing</option><option>Damaged</option><option>Wrong product</option><option>Quality issue</option></select></label>
        <label class="field"><span>Details (optional)</span><textarea name="note" maxlength="300"></textarea></label>
        <button class="btn btn--block">Send report</button></form>`);
    },
    'runner-join'(el) {
      S.runner[el.dataset.role] = 'you'; save(); render();
      toast(el.dataset.role === 'primary' ? 'You are the primary Order Runner. Incentive: €20 credit + transport.' : 'You are the backup runner: €5 reservation credit.');
    },
    'runner-withdraw'() { if (isRunner()) S.runner.primary = null; if (isBackup()) S.runner.backup = null; save(); render(); },
    'runner-cancel'() {
      const R = S.runner;
      if (isBackup()) { R.primary = 'you'; R.backup = 'Lina S. (new backup)'; toast('Backup Runner activated: you are now the primary runner.'); }
      else if (isRunner()) { R.primary = R.backup || 'Lina S.'; R.backup = null; toast('You cancelled. Backup Runner activated.'); }
      else { R.primary = R.backup || 'Lina S.'; R.backup = null; toast('Primary cancelled. Backup Runner activated; backup slot is open.'); }
      save(); render();
    },
    'preview-runner'() { ui.preview = true; render(); },
    handover(el) { S.runner.handed = Math.min(OTHERS, S.runner.handed + 1); save(); render(); toast(`Order ${el.dataset.code} delivered. Prepared → Collected.`); },
    'handover-batch'() { S.runner.handed = Math.min(OTHERS, S.runner.handed + 3 + Math.floor(Math.random() * 6)); save(); render(); },
    'runner-issue'() { S.runner.issues++; save(); render(); toast('Issue logged for admin follow-up.'); },
    points: pointsSheet,
    redeem(el) {
      const r = REWARDS.find(x => x.id === el.dataset.id);
      if (!r || S.points < r.cost) return;
      S.points -= r.cost; S.pointsLog.unshift(['Redeemed: ' + r.name, -r.cost]);
      if (r.credit) S.credits += r.credit;
      if (r.id === 'prio') S.priority = true;
      S.redeemed.push(r.id); save(); pointsSheet(); render(); toast('Redeemed: ' + r.name);
    },
    plus() {
      openSheet('Großry Plus (concept)', `<p class="small">A possible premium membership, not available in the prototype:</p>
        <ul class="small"><li>Early ordering before the cycle opens</li><li>Priority pickup slots</li><li>Home delivery</li><li>Automatic recurring monthly orders</li></ul>
        <p class="small mute">Campus pickup always stays free. Plus would be one of several revenue streams, alongside the 20% share of verified savings, supplier commission, optional delivery fees and aggregated market insights.</p>`);
    },
    legal(el) { openSheet(el.dataset.doc === 'terms' ? 'Terms and Conditions' : 'Privacy Policy', `<div class="legal">${el.dataset.doc === 'terms' ? D.terms : D.privacy}</div>`); },
    'close-sheet': closeSheet,
    export() {
      const data = { note: 'Großry prototype: demo data held in this browser only', user: S.user, basket: S.cart, submitted: S.submitted, orderCode: S.code, slot: S.slot != null ? SLOT_TIMES[S.slot] : null, points: S.points, credits: S.credits, wg: S.wg, posts: S.posts, reviews: S.myReviews, settings: { notifications: S.notif, aggregatedInsights: S.insights } };
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      a.download = 'grossry-my-data.json'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    'delete-account'() {
      if (!confirm('Delete your demo account? All demo data in this browser is erased.')) return;
      store.clear(); S = fresh(); ui.stack = []; ui.ob = { step: 'welcome' }; ui.photo = null; render(); toast('Account and data deleted.');
    },
    comm(el) { ui.comm = el.dataset.v; render(); },
    'forum-cat'(el) { ui.forumCat = el.dataset.cat; render(); },
    vote(el) { const id = el.dataset.id; if (S.votes[id]) delete S.votes[id]; else S.votes[id] = true; save(); render(); },
    thread(el) { threadSheet(el.dataset.id); },
    'new-post'() {
      openSheet('New post', `<form data-form="post">
        <label class="field"><span>Category</span><select name="cat"><option>Product Reviews</option><option>Requests</option><option>Deals</option><option>WGs</option><option>Problems</option></select></label>
        <label class="field"><span>Title</span><input name="title" maxlength="80"></label>
        <label class="field"><span>Message</span><textarea name="body" maxlength="500"></textarea></label>
        <button class="btn btn--block">Post</button></form>`);
    },
    review(el) {
      openSheet('Write a review', `<form data-form="review" data-id="${el.dataset.id}">
        <label class="field"><span>Rating</span><select name="stars"><option value="5">★★★★★</option><option value="4">★★★★☆</option><option value="3">★★★☆☆</option><option value="2">★★☆☆☆</option><option value="1">★☆☆☆☆</option></select></label>
        <label class="field"><span>Review</span><textarea name="text" maxlength="300"></textarea></label>
        <button class="btn btn--block">Publish review</button></form>`);
    },
    'wg-leave'() { S.wg = null; save(); render(); }
  };

  const FORMS = {
    register(f) {
      const v = Object.fromEntries(new FormData(f));
      const u = UNI[v.uni], email = String(v.email || '').trim().toLowerCase();
      let err = null;
      if (String(v.name || '').trim().length < 2) err = 'Please enter your full name.';
      else if (!/^[^@\s]+@[^@\s]+$/.test(email) || !(email.endsWith('@' + u.domain) || email.endsWith('.' + u.domain))) err = `Use your ${u.name} email (…@${u.domain}).`;
      else if (String(v.phone || '').replace(/\D/g, '').length < 6) err = 'Please enter a phone number.';
      else if (String(v.pw || '').length < 8) err = 'Password must be at least 8 characters.';
      else if (!v.terms || !v.privacy) err = 'Please accept the Terms and read the Privacy Policy.';
      if (err) { ui.ob.err = err; const e = f.querySelector('.err'); if (e) e.textContent = err; else f.querySelector('button:not([type])').insertAdjacentHTML('beforebegin', `<p class="err" role="alert">${esc(err)}</p>`); return; }
      ui.ob = { step: 'verify', err: null, code: String(100000 + Math.floor(Math.random() * 900000)), pending: { name: String(v.name).trim(), email, phone: String(v.phone).trim(), uni: v.uni, campus: v.campus } };
      render();
    },
    verify(f) {
      const code = String(new FormData(f).get('code') || '').trim();
      if (code !== ui.ob.code) { ui.ob.err = 'That code does not match.'; render(); return; }
      S.user = Object.assign({ verified: true }, ui.ob.pending); ui.ob = { step: 'welcome' };
      save(); render(); toast(`Verified! You joined the ${UNI[S.user.uni].name} purchasing group.`);
    },
    scan(f) {
      const code = String(new FormData(f).get('code') || '').trim().toUpperCase();
      if (S.submitted && code === S.code) {
        if (S.collected) { toast('Already collected.'); return; }
        S.collected = true; addPoints('Collected on time', 20); save(); render(); toast(`Order ${code} delivered. Prepared → Collected.`); return;
      }
      if (/^GR-\d{4}$/.test(code)) { S.runner.handed = Math.min(OTHERS, S.runner.handed + 1); save(); render(); toast(`Order ${code} delivered. Prepared → Collected.`); return; }
      toast('Not a valid order code (format GR-1234).');
    },
    request(f) {
      const name = String(new FormData(f).get('name') || '').trim();
      if (name.length < 2) return;
      const id = 'm' + Date.now();
      S.myRequests.unshift({ id, name, votes: 0, goal: 50, note: 'Your request' }); S.votes[id] = true; save(); render(); toast('Request added. Share it to collect votes.');
    },
    post(f) {
      const v = Object.fromEntries(new FormData(f));
      if (!String(v.title).trim() || !String(v.body).trim()) { toast('Add a title and a message.'); return; }
      S.posts.unshift({ id: 'p' + Date.now(), cat: v.cat, title: String(v.title).trim(), body: String(v.body).trim(), author: first(), ago: 'now', replies: [] });
      ui.forumCat = 'All'; save(); closeSheet(); render();
    },
    reply(f) {
      const text = String(new FormData(f).get('text') || '').trim(); if (!text) return;
      const id = f.dataset.id; (S.replies[id] = S.replies[id] || []).push([first(), text]); save(); threadSheet(id); render();
    },
    review(f) {
      const v = Object.fromEntries(new FormData(f)); const text = String(v.text || '').trim(); if (!text) { toast('Write a few words first.'); return; }
      const id = f.dataset.id; (S.myReviews[id] = S.myReviews[id] || []).push({ name: first(), stars: Number(v.stars), text });
      addPoints('Product review', 5); save(); closeSheet(); render(); toast('Review published. +5 points.');
    },
    problem(f) {
      const v = Object.fromEntries(new FormData(f));
      S.problems.push({ item: v.item, type: v.type }); save(); closeSheet(); render();
      toast(`Reported (${v.type}: ${v.item}). Ticket #${1000 + S.problems.length} opened.`);
    },
    wg(f) {
      const v = Object.fromEntries(new FormData(f));
      const name = String(v.name || '').trim(), members = String(v.members || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 6);
      if (!name || !members.length) { toast('Add a WG name and at least one flatmate.'); return; }
      S.wg = { name, members, consolidated: true }; save(); render(); toast('WG created with one consolidated pickup.');
    }
  };

  const CHANGE = {
    uni(el) {
      const u = UNI[el.value];
      $('#campusSel').innerHTML = u.campus.map(c => `<option>${esc(c)}</option>`).join('');
      $('#emailIn').placeholder = 'name@' + u.domain;
      $('#emailHint').textContent = `Must be an address at ${u.domain} (subdomains like stud.${u.domain} work too).`;
    },
    photo(el) {
      const file = el.files && el.files[0]; if (!file) return;
      const r = new FileReader(); r.onload = () => { ui.photo = r.result; toast('Photo previewed on this device only.'); }; r.readAsDataURL(file);
    },
    subs(el) { S.subs = el.checked; save(); },
    notif(el) { S.notif[el.dataset.k] = el.checked; save(); },
    insights(el) { S.insights = el.checked; save(); toast(el.checked ? 'Included in aggregated statistics.' : 'Excluded from aggregated statistics.'); },
    'wg-consolidated'(el) { S.wg.consolidated = el.checked; save(); render(); }
  };

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = ACT[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el); }
  });
  document.addEventListener('submit', e => {
    const f = e.target.closest('[data-form]'); if (!f) return;
    e.preventDefault(); const fn = FORMS[f.dataset.form]; if (fn) fn(f);
  });
  document.addEventListener('change', e => {
    const el = e.target.closest('[data-change]'); if (!el) return;
    const fn = CHANGE[el.dataset.change]; if (fn) fn(el);
  });
  document.addEventListener('input', e => {
    if (e.target.dataset.input === 'search') { ui.q = e.target.value; $('#shopList').innerHTML = shopList(); }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });
  $('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });

  // Size the phone to the viewport under the prototype chrome on small screens.
  function sizeChrome() {
    const h = $('#chrome').offsetHeight + $('.disclaimer').offsetHeight;
    document.documentElement.style.setProperty('--chrome', h + 'px');
  }
  window.addEventListener('resize', sizeChrome);
  sizeChrome();
  render();
})();
