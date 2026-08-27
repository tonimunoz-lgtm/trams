// app.js — núcleo de Trams. Bloque 1: login, subir una ruta (GPX/FIT),
// y una lista básica para confirmar que la base compartida funciona.
// La exploración completa (mapa, buscador, filtros) llega en el bloque 2.

import { auth } from './firebase-config.js';
import {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, updateProfile
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { DB } from './db.js';

function h(strings, ...values) {
  return strings.reduce((acc, str, i) => acc + str + (values[i] ?? ''), '');
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ============================================================
// ROUTER
// ============================================================

let CURRENT_USER = null;

window.addEventListener('hashchange', router);

function navigate(hash) { window.location.hash = hash; }

async function router() {
  const hash = window.location.hash || '#/';
  const [path, param] = hash.replace('#/', '').split('/');
  const key = '/' + path;

  if (!CURRENT_USER) {
    renderLogin();
    return;
  }

  if (key === '/' || key === '') renderList();
  else if (key === '/upload') renderUpload();
  else if (key === '/route') renderRouteDetail(param);
  else renderList();
}

// ============================================================
// AUTENTICACIÓN
// ============================================================

function renderLogin() {
  const $v = document.getElementById('view');
  $v.innerHTML = h`
    <div class="auth-box">
      <h1 class="auth-logo">🥾 Trams</h1>
      <p class="auth-tag">Rutas compartidas, sin cuotas.</p>

      <input id="authName" placeholder="Tu nombre (solo para registro)" style="display:none;">
      <input id="authEmail" type="email" placeholder="Email">
      <input id="authPassword" type="password" placeholder="Contraseña">

      <button class="btn" id="btnAuthSubmit">Entrar</button>
      <p class="auth-switch">¿No tienes cuenta? <b id="btnAuthSwitch">Regístrate</b></p>
      <p id="authError" style="color:#c0392b; font-size:13px;"></p>
    </div>
  `;

  let mode = 'login';

  document.getElementById('btnAuthSwitch').onclick = () => {
    mode = mode === 'login' ? 'signup' : 'login';
    document.getElementById('authName').style.display = mode === 'signup' ? 'block' : 'none';
    document.getElementById('btnAuthSubmit').textContent = mode === 'signup' ? 'Crear cuenta' : 'Entrar';
    document.getElementById('btnAuthSwitch').textContent = mode === 'signup' ? 'Inicia sesión' : 'Regístrate';
  };

  document.getElementById('btnAuthSubmit').onclick = async () => {
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    const name = document.getElementById('authName').value.trim();
    const errorEl = document.getElementById('authError');
    errorEl.textContent = '';

    try {
      if (mode === 'signup') {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        if (name) await updateProfile(cred.user, { displayName: name });
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (e) {
      errorEl.textContent = e.message;
    }
  };
}

// ============================================================
// SUBIR UNA RUTA
// ============================================================

function renderUpload() {
  const $v = document.getElementById('view');
  $v.innerHTML = h`
    <div class="topbar"><h2>Subir ruta</h2></div>

    <div class="card">
      <div class="dropzone" id="dropzone">
        <p><b>Toca para elegir un archivo</b><br>GPX (.fit llegará pronto)</p>
      </div>
      <input type="file" id="fileInput" accept=".gpx" style="display:none;">
      <div id="uploadStatus"></div>
    </div>
  `;

  document.getElementById('dropzone').onclick = () => document.getElementById('fileInput').click();
  document.getElementById('fileInput').onchange = (e) => {
    if (e.target.files.length) handleFile(e.target.files[0]);
  };
}

async function handleFile(file) {
  const status = document.getElementById('uploadStatus');
  status.innerHTML = `<div class="spinner"></div><p>Procesando ${file.name}…</p>`;

  try {
    const { points, name, source } = await Parsers.parseFile(file);
    if (points.length < 2) throw new Error('El archivo no contiene un trazado válido.');

    const summary = Stats.computeSummary(points);
    if (!summary) throw new Error('No se pudieron calcular las estadísticas de esta ruta.');

    showPreview(summary, name, source);

  } catch (e) {
    console.error(e);
    status.innerHTML = `<p style="color:#c0392b;">${e.message}</p>`;
  }
}

function showPreview(summary, suggestedName, source) {
  const status = document.getElementById('uploadStatus');

  status.innerHTML = h`
    <div class="stat-grid">
      <div class="stat"><b>${Stats.fmtDistance(summary.totalDistance)}</b><span>Distancia</span></div>
      <div class="stat"><b>+${Math.round(summary.elevGain)} m</b><span>Desnivel +</span></div>
      <div class="stat"><b>-${Math.round(summary.elevLoss)} m</b><span>Desnivel -</span></div>
      <div class="stat"><b>${summary.hasTime ? Stats.fmtDuration(summary.duration) : '--'}</b><span>Duración</span></div>
    </div>

    <label>Nombre de la ruta</label>
    <input id="routeName" value="${suggestedName || ''}" placeholder="Ej. Cap de Creus por la costa">

    <label>Tipo de actividad</label>
    <select id="routeActivity">
      <option value="hiking">Senderismo</option>
      <option value="running">Correr</option>
      <option value="cycling">Bici</option>
      <option value="mtb">BTT</option>
      <option value="other">Otro</option>
    </select>

    <label>Descripción (opcional)</label>
    <textarea id="routeDesc" placeholder="Cómo es la ruta, puntos de interés, dificultad..."></textarea>

    <button class="btn" id="btnSaveRoute" style="margin-top:12px;">Guardar en la base compartida</button>
  `;

  document.getElementById('btnSaveRoute').onclick = async () => {
    const btn = document.getElementById('btnSaveRoute');
    btn.disabled = true;
    btn.textContent = 'Guardando…';

    try {
      const storedPoints = Stats.downsampleForStorage(summary.points).map(p => ({
        lat: +p.lat.toFixed(6),
        lon: +p.lon.toFixed(6),
        ele: p.ele != null ? Math.round(p.ele) : null
      }));

      const route = {
        name: document.getElementById('routeName').value.trim() || 'Ruta sin nombre',
        activityType: document.getElementById('routeActivity').value,
        description: document.getElementById('routeDesc').value.trim(),
        distance: summary.totalDistance,
        elevGain: summary.elevGain,
        elevLoss: summary.elevLoss,
        duration: summary.hasTime ? summary.duration : null,
        source,
        points: storedPoints
      };

      const saved = await DB.saveRoute(route);
      toast('¡Ruta guardada!');
      navigate(`#/route/${saved.id}`);

    } catch (e) {
      console.error(e);
      toast(e.message || 'No se pudo guardar la ruta');
      btn.disabled = false;
      btn.textContent = 'Guardar en la base compartida';
    }
  };
}

// ============================================================
// ============================================================
// EXPLORAR RUTAS — buscador, filtro por tipo, mapa en miniatura
// ============================================================

const ACTIVITY_LABELS = {
  hiking: '🥾 Senderismo', running: '🏃 Correr', cycling: '🚴 Bici',
  mtb: '🚵 BTT', other: '📍 Otro'
};

let EXPLORE_FILTER = 'all';
let ALL_ROUTES_CACHE = [];

async function renderList() {
  const $v = document.getElementById('view');
  $v.innerHTML = `
    <div class="topbar">
      <h2>🥾 Trams</h2>
      <button class="icon-btn" id="btnLogout">⏻</button>
    </div>
    <a href="#/upload" class="btn" style="display:block; text-align:center; margin-bottom:16px;">+ Subir una ruta</a>

    <input id="searchInput" placeholder="Buscar por nombre…" style="margin-bottom:10px;">

    <div id="filterChips" class="chips-row"></div>

    <div id="routesList"><div class="spinner"></div></div>
  `;

  document.getElementById('btnLogout').onclick = () => signOut(auth);
  document.getElementById('searchInput').oninput = renderFilteredRoutes;

  renderFilterChips();
  await loadAndRenderRoutes();
}

function renderFilterChips() {
  const chipsEl = document.getElementById('filterChips');
  const options = [['all', 'Todos'], ...Object.entries(ACTIVITY_LABELS)];
  chipsEl.innerHTML = options.map(([key, label]) => h`
    <button class="chip ${EXPLORE_FILTER === key ? 'chip-active' : ''}" data-filter="${key}">${label}</button>
  `).join('');

  chipsEl.querySelectorAll('[data-filter]').forEach(btn => {
    btn.onclick = async () => {
      EXPLORE_FILTER = btn.dataset.filter;
      renderFilterChips();
      await loadAndRenderRoutes();
    };
  });
}

async function loadAndRenderRoutes() {
  const list = document.getElementById('routesList');
  list.innerHTML = '<div class="spinner"></div>';
  try {
    ALL_ROUTES_CACHE = await DB.listRoutes({ activityType: EXPLORE_FILTER, count: 100 });
    renderFilteredRoutes();
  } catch (e) {
    console.error(e);
    list.innerHTML = `<p style="color:#c0392b;">No se pudieron cargar las rutas.</p>`;
  }
}

function renderFilteredRoutes() {
  const list = document.getElementById('routesList');
  const search = (document.getElementById('searchInput').value || '').toLowerCase().trim();
  const routes = search
    ? ALL_ROUTES_CACHE.filter(r => (r.name || '').toLowerCase().includes(search))
    : ALL_ROUTES_CACHE;

  if (!routes.length) {
    list.innerHTML = `<p style="color:#888; text-align:center;">${search ? 'Ninguna ruta coincide.' : 'Todavía no hay rutas — ¡sé el primero!'}</p>`;
    return;
  }

  list.innerHTML = routes.map(r => h`
    <a href="#/route/${r.id}" class="card route-card">
      <div class="route-map" id="mini-${r.id}"></div>
      <b>${r.name}</b>
      <p style="font-size:12px; color:#888;">${ACTIVITY_LABELS[r.activityType] || ''} · Subida por ${r.createdByName}</p>
      <div class="stat-grid cols-3">
        <div class="stat"><b>${Stats.fmtDistance(r.distance)}</b><span>Distancia</span></div>
        <div class="stat"><b>+${Math.round(r.elevGain)} m</b><span>Desnivel</span></div>
        <div class="stat"><b>${r.duration ? Stats.fmtDuration(r.duration) : '--'}</b><span>Duración</span></div>
      </div>
    </a>
  `).join('');

  routes.forEach(r => drawMiniMap(r));
}

function drawMiniMap(route) {
  const el = document.getElementById(`mini-${route.id}`);
  if (!el || typeof L === 'undefined' || !route.points || route.points.length < 2) return;
  const map = L.map(el, {
    attributionControl: false, zoomControl: false,
    dragging: false, scrollWheelZoom: false, touchZoom: false, doubleClickZoom: false
  });
  const latlngs = route.points.map(p => [p.lat, p.lon]);
  const line = L.polyline(latlngs, { color: '#1F6F4A', weight: 3 }).addTo(map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(map);
  map.fitBounds(line.getBounds(), { padding: [10, 10] });
}

// ============================================================
// FICHA DE UNA RUTA — mapa grande, perfil de elevación, descarga GPX
// ============================================================

async function renderRouteDetail(id) {
  const $v = document.getElementById('view');
  $v.innerHTML = `<div class="spinner"></div>`;

  const route = await DB.getRoute(id);
  if (!route) {
    $v.innerHTML = `<p>Ruta no encontrada.</p><a href="#/">Volver</a>`;
    return;
  }

  $v.innerHTML = h`
    <div class="topbar">
      <a href="#/" class="icon-btn">‹</a>
      <h2>${route.name}</h2>
    </div>

    <div class="map-box" id="detailMap"></div>

    <div class="card">
      <p style="font-size:12px; color:#888;">${ACTIVITY_LABELS[route.activityType] || ''} · Subida por ${route.createdByName}</p>
      ${route.description ? `<p>${route.description}</p>` : ''}

      <div class="stat-grid">
        <div class="stat"><b>${Stats.fmtDistance(route.distance)}</b><span>Distancia</span></div>
        <div class="stat"><b>+${Math.round(route.elevGain)} m</b><span>Desnivel +</span></div>
        <div class="stat"><b>-${Math.round(route.elevLoss)} m</b><span>Desnivel -</span></div>
        <div class="stat"><b>${route.duration ? Stats.fmtDuration(route.duration) : '--'}</b><span>Duración</span></div>
      </div>

      <button class="btn secondary" id="btnDownloadGPX" style="margin-top:12px; width:100%;">⬇ Descargar GPX</button>
    </div>

    <div class="section-title">Perfil de elevación</div>
    <div class="card">
      <canvas id="elevChart" height="140"></canvas>
    </div>
  `;

  if (typeof L !== 'undefined' && route.points && route.points.length > 1) {
    const map = L.map('detailMap', { attributionControl: false });
    const latlngs = route.points.map(p => [p.lat, p.lon]);
    const line = L.polyline(latlngs, { color: '#1F6F4A', weight: 4 }).addTo(map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(map);
    map.fitBounds(line.getBounds(), { padding: [20, 20] });
  }

  drawElevationChart(route.points);

  document.getElementById('btnDownloadGPX').onclick = () => downloadGPX(route);
}

function drawElevationChart(points) {
  const el = document.getElementById('elevChart');
  if (!el || typeof Chart === 'undefined' || !points || points.length < 2) return;

  const cum = Stats.cumulativeDistances(points);
  const labels = cum.map(d => (d / 1000).toFixed(1));
  const elevs = points.map(p => p.ele);

  new Chart(el, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: elevs, borderColor: '#1F6F4A', backgroundColor: 'rgba(31,111,74,0.15)',
        fill: true, pointRadius: 0, borderWidth: 2, tension: 0.2
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { title: { display: true, text: 'km' }, ticks: { maxTicksLimit: 6 } },
        y: { title: { display: true, text: 'Altitud (m)' } }
      }
    }
  });
}

function downloadGPX(route) {
  const points = (route.points || []).map(p =>
    `<trkpt lat="${p.lat}" lon="${p.lon}">${p.ele != null ? `<ele>${p.ele}</ele>` : ''}</trkpt>`
  ).join('\n    ');

  const safeName = (route.name || 'ruta').replace(/[<>&]/g, '');

  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Trams" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${safeName}</name>
    <trkseg>
    ${points}
    </trkseg>
  </trk>
</gpx>`;

  const blob = new Blob([gpx], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName.replace(/[^a-z0-9]/gi, '_') || 'ruta'}.gpx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ============================================================
// ARRANQUE
// ============================================================

onAuthStateChanged(auth, (user) => {
  CURRENT_USER = user;
  router();
});
