/* =========================================================
   Waste-management dashboard — a self-contained front-end
   simulation of the final-year project's UI (Leaflet map +
   Chart.js), driven by synthetic GPS/fill-level data. No
   backend: this is a static GitHub Pages site.
   ========================================================= */
(function () {
  const mapEl = $('#wasteMap');
  if (!mapEl || typeof L === 'undefined') return;

  const CENTER = [49.4521, 11.0767]; // Nuremberg

  const map = L.map(mapEl, { zoomControl: true, scrollWheelZoom: false }).setView(CENTER, 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18, attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  function rand(min, max) { return min + Math.random() * (max - min); }

  function loopRoute(radiusLat, radiusLon, phase, points) {
    const pts = [];
    for (let i = 0; i <= points; i++) {
      const t = phase + (i / points) * Math.PI * 2;
      pts.push([CENTER[0] + Math.sin(t) * radiusLat, CENTER[1] + Math.cos(t) * radiusLon]);
    }
    return pts;
  }
  const routes = [
    loopRoute(0.018, 0.028, 0, 60),
    loopRoute(0.026, 0.018, 1.2, 60),
    loopRoute(0.014, 0.020, 2.4, 60),
    loopRoute(0.022, 0.033, 3.6, 60)
  ];
  routes.forEach(r => L.polyline(r, { color: '#8991AC', weight: 2, opacity: 0.35, dashArray: '4,7' }).addTo(map));

  function posOnRoute(route, progress) {
    const n = route.length - 1;
    const f = (progress % 1) * n;
    const i = Math.floor(f);
    const t = f - i;
    const a = route[i], b = route[(i + 1) % route.length];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }

  const vans = routes.map((route, i) => ({
    route, progress: Math.random(), speed: 0.00035 + Math.random() * 0.00018,
    marker: L.marker(route[0], {
      icon: L.divIcon({ className: '', html: `<div class="dash__van">${i + 1}</div>`, iconSize: [26, 26] })
    }).addTo(map)
  }));

  const BIN_COUNT = 14;
  const bins = Array.from({ length: BIN_COUNT }, (_, i) => ({
    name: 'Bin ' + String(i + 1).padStart(2, '0'),
    lat: CENTER[0] + rand(-0.03, 0.03),
    lon: CENTER[1] + rand(-0.045, 0.045),
    fill: rand(10, 55)
  }));

  function binColor(fill) {
    if (fill > 80) return '#E0555A';
    if (fill > 50) return token('--accent2') || '#0C8C86';
    return token('--ok') || '#17944B';
  }

  bins.forEach(b => {
    b.marker = L.circleMarker([b.lat, b.lon], {
      radius: 6, weight: 2, color: '#fff', fillColor: binColor(b.fill), fillOpacity: 0.9
    }).addTo(map);
    b.marker.bindTooltip(() => `${b.name}: ${Math.round(b.fill)}% full`, { direction: 'top', offset: [0, -6] });
  });

  const statBins = $('#statBins');
  const logEl = $('#wasteLog');
  function addLog(html, alert) {
    if (!logEl) return;
    const li = document.createElement('li');
    li.innerHTML = html;
    if (alert) li.classList.add('is-alert');
    logEl.prepend(li);
    while (logEl.children.length > 10) logEl.removeChild(logEl.lastChild);
  }

  const chartCv = $('#wasteChart');
  let chart = null, history = [];
  if (chartCv && typeof Chart !== 'undefined') {
    chart = new Chart(chartCv.getContext('2d'), {
      type: 'line',
      data: { labels: [], datasets: [{ data: [], borderColor: token('--accent') || '#5645D6', backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0, tension: 0.3 }] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { display: false },
          y: { min: 0, max: 100, ticks: { color: token('--mute'), font: { size: 9 } }, grid: { color: token('--rule') } }
        }
      }
    });
  }
  function pushChart(v) {
    if (!chart) return;
    history.push(v);
    if (history.length > 40) history.shift();
    chart.data.labels = history.map((_, i) => i);
    chart.data.datasets[0].data = history.slice();
    chart.update();
  }

  function tick() {
    vans.forEach(v => {
      v.progress += v.speed;
      const pos = posOnRoute(v.route, v.progress);
      v.marker.setLatLng(pos);
      bins.forEach(b => {
        const d = Math.hypot(pos[0] - b.lat, pos[1] - b.lon);
        if (d < 0.0035 && b.fill > 35) {
          const was = Math.round(b.fill);
          b.fill = rand(5, 15);
          b.marker.setStyle({ fillColor: binColor(b.fill) });
          addLog(`Van collected <b>${b.name}</b> (was ${was}% full)`, false);
        }
      });
    });

    bins.forEach(b => {
      const wasAbove = b.fill > 80;
      b.fill = Math.min(100, b.fill + rand(0.12, 0.45));
      b.marker.setStyle({ fillColor: binColor(b.fill) });
      if (b.fill > 80 && !wasAbove) addLog(`<b>${b.name}</b> crossed 80%, flagged for next route`, true);
    });

    if (statBins) statBins.textContent = String(bins.filter(b => b.fill > 80).length);
    pushChart(bins.reduce((s, b) => s + b.fill, 0) / bins.length);
  }

  setInterval(tick, 350);
  tick();

  setTimeout(() => map.invalidateSize(), 200);
  window.addEventListener('resize', () => map.invalidateSize(), { passive: true });
  window.addEventListener('themechange', () => {
    bins.forEach(b => b.marker.setStyle({ fillColor: binColor(b.fill) }));
  });
})();
