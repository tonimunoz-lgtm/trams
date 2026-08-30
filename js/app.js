// app.js — núcleo de Trams. Bloque 1: login, subir una ruta (GPX/FIT),
// y una lista básica para confirmar que la base compartida funciona.
// La exploración completa (mapa, buscador, filtros) llega en el bloque 2.
//
// Textos de interfaz: todos pasan por I18n.t('clave') (ver js/i18n.js).
// Los comentarios de código se quedan tal cual estaban (en castellano),
// ya que no afectan a lo que ve la persona usuaria de la app.

import { auth } from './firebase-config.js';
import {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, updateProfile
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { DB } from './db.js';

const { t, getLang, setLang } = window.I18n;

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
// IDIOMA — botón fijo en pantalla, con persistencia en localStorage.
// Por defecto: català.
// ============================================================

function setupLangToggle() {
  const btn = document.getElementById('langToggle');
  if (!btn) return;

  function refreshLabel() {
    btn.textContent = getLang() === 'ca' ? 'ES' : 'CA';
    btn.title = t('lang.toggleTitle');
    document.documentElement.lang = getLang();
  }

  refreshLabel();

  btn.onclick = () => {
    setLang(getLang() === 'ca' ? 'es' : 'ca');
    refreshLabel();
    router();
  };
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

  // Caso especial: la vista de "en directo" es la única de toda la app
  // que funciona SIN sesión iniciada — es un enlace pensado para
  // compartir con cualquiera, tenga o no cuenta en Trams.
  if (key === '/live') {
    renderLiveView(param);
    return;
  }

  if (!CURRENT_USER) {
    renderLogin();
    return;
  }

  if (key === '/' || key === '') renderList();
  else if (key === '/upload') renderUpload();
  else if (key === '/record') renderRecord();
  else if (key === '/connect') renderConnect();
  else if (key === '/import-osm') renderImportOsm();
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
      <p class="auth-tag">${t('auth.tagline')}</p>

      <input id="authName" placeholder="${t('auth.namePlaceholder')}" style="display:none;">
      <input id="authEmail" type="email" placeholder="${t('auth.emailPlaceholder')}">
      <input id="authPassword" type="password" placeholder="${t('auth.passwordPlaceholder')}">

      <button class="btn" id="btnAuthSubmit">${t('auth.submitLogin')}</button>
      <p class="auth-switch">${t('auth.noAccount')} <b id="btnAuthSwitch">${t('auth.switchToSignup')}</b></p>
      <p id="authError" style="color:#c0392b; font-size:13px;"></p>
    </div>
  `;

  let mode = 'login';

  document.getElementById('btnAuthSwitch').onclick = () => {
    mode = mode === 'login' ? 'signup' : 'login';
    document.getElementById('authName').style.display = mode === 'signup' ? 'block' : 'none';
    document.getElementById('btnAuthSubmit').textContent = mode === 'signup' ? t('auth.submitSignup') : t('auth.submitLogin');
    document.getElementById('btnAuthSwitch').textContent = mode === 'signup' ? t('auth.switchToLogin') : t('auth.switchToSignup');
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
    <div class="topbar"><h2>${t('upload.title')}</h2></div>

    <div class="card">
      <div class="dropzone" id="dropzone">
        <p><b>${t('upload.dropzoneTitle')}</b><br>${t('upload.dropzoneSubtitle')}</p>
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
  status.innerHTML = `<div class="spinner"></div><p>${t('upload.processing', { name: file.name })}</p>`;

  try {
    const { points, name, source } = await Parsers.parseFile(file);
    if (points.length < 2) throw new Error(t('upload.invalidTrack'));

    const summary = Stats.computeSummary(points);
    if (!summary) throw new Error(t('upload.statsError'));

    showPreview(summary, name, source);

  } catch (e) {
    console.error(e);
    status.innerHTML = `<p style="color:#c0392b;">${e.message}</p>`;
  }
}

function showPreview(summary, suggestedName, source, containerId = 'uploadStatus') {
  const status = document.getElementById(containerId);

  status.innerHTML = h`
    <div class="stat-grid">
      <div class="stat"><b>${Stats.fmtDistance(summary.totalDistance)}</b><span>${t('stat.distance')}</span></div>
      <div class="stat"><b>+${Math.round(summary.elevGain)} m</b><span>${t('stat.elevGain')}</span></div>
      <div class="stat"><b>-${Math.round(summary.elevLoss)} m</b><span>${t('stat.elevLoss')}</span></div>
      <div class="stat"><b>${summary.hasTime ? Stats.fmtDuration(summary.duration) : '--'}</b><span>${t('stat.duration')}</span></div>
    </div>

    <label>${t('form.routeName')}</label>
    <input id="routeName" value="${suggestedName || ''}" placeholder="${t('form.routeNamePlaceholder')}">

    <label>${t('form.activityType')}</label>
    <select id="routeActivity">
      <option value="hiking">${t('activity.hiking')}</option>
      <option value="running">${t('activity.running')}</option>
      <option value="cycling">${t('activity.cycling')}</option>
      <option value="mtb">${t('activity.mtb')}</option>
      <option value="other">${t('activity.other')}</option>
    </select>

    <label>${t('form.description')}</label>
    <textarea id="routeDesc" placeholder="${t('form.descriptionPlaceholder')}"></textarea>

    <button class="btn" id="btnSaveRoute" style="margin-top:12px;">${t('form.saveShared')}</button>
  `;

  document.getElementById('btnSaveRoute').onclick = async () => {
    const btn = document.getElementById('btnSaveRoute');
    btn.disabled = true;
    btn.textContent = t('form.saving');

    try {
      const storedPoints = Stats.downsampleForStorage(summary.points).map(p => ({
        lat: +p.lat.toFixed(6),
        lon: +p.lon.toFixed(6),
        ele: p.ele != null ? Math.round(p.ele) : null
      }));

      const route = {
        name: document.getElementById('routeName').value.trim() || t('form.unnamedRoute'),
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
      toast(t('toast.routeSaved'));
      navigate(`#/route/${saved.id}`);

    } catch (e) {
      console.error(e);
      toast(e.message || t('toast.routeSaveError'));
      btn.disabled = false;
      btn.textContent = t('form.saveShared');
    }
  };
}

// ============================================================
// GRABAR EN DIRECTO CON EL GPS DEL MÓVIL
// ============================================================

function renderRecord() {
  const $v = document.getElementById('view');
  $v.innerHTML = `
    <div class="topbar"><a href="#/" class="icon-btn">‹</a><h2>${t('record.title')}</h2></div>

    <div class="card" style="text-align:center; padding:28px 16px;">
      <div id="recDistance" style="font-size:38px; font-weight:800; line-height:1;">0.00 km</div>
      <div style="margin-top:14px;">
        <div id="recDuration" style="font-size:22px; font-weight:800;">0:00</div>
        <span style="font-size:11px; color:#888;">${t('record.time')}</span>
      </div>
    </div>

    <div class="map-box" id="recordMap"></div>

    <label id="liveShareRow" style="display:flex; align-items:center; gap:8px; margin-top:12px; font-weight:400;">
      <input type="checkbox" id="liveShareCheck" style="width:auto; margin:0;">
      ${t('record.liveShareLabel')}
    </label>
    <div id="liveShareLink" style="display:none; margin-top:8px;"></div>

    <div id="recControls" style="display:flex; gap:10px; margin-top:14px;"></div>

    <p style="font-size:11px; color:#888; margin-top:12px; text-align:center; line-height:1.5;">
      ${t('record.foregroundNote')}
    </p>

    <div id="recSaveArea" style="margin-top:16px;"></div>
  `;

  let map = null, line = null;
  if (typeof L !== 'undefined') {
    map = L.map('recordMap', { attributionControl: false, zoomControl: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(map);
    map.setView([41.39, 2.16], 13);
  }

  let uiTimer = null;
  let liveSessionId = null;
  let lastLiveUpdateAt = 0;

  function fmtLiveDuration(sec) {
    sec = Math.floor(sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h > 0 ? h + ':' : '') + String(m).padStart(h > 0 ? 2 : 1, '0') + ':' + String(s).padStart(2, '0');
  }

  function refreshUI() {
    const stats = Recorder.liveStats();
    document.getElementById('recDistance').textContent = (stats.distance / 1000).toFixed(2) + ' km';
    document.getElementById('recDuration').textContent = fmtLiveDuration(stats.elapsedSec);

    if (map && stats.points.length > 1) {
      const latlngs = stats.points.map(p => [p.lat, p.lon]);
      if (line) line.setLatLngs(latlngs);
      else line = L.polyline(latlngs, { color: '#1F6F4A', weight: 4 }).addTo(map);
      map.fitBounds(line.getBounds(), { padding: [24, 24] });
    } else if (map && stats.points.length === 1) {
      map.setView([stats.points[0].lat, stats.points[0].lon], 16);
    }

    // Actualizamos la posición compartida cada ~15s, no en cada punto —
    // de sobra para que quien te siga vea algo casi en directo, sin
    // machacar Firestore con una escritura por segundo.
    if (liveSessionId && stats.points.length && (Date.now() - lastLiveUpdateAt > 15000)) {
      lastLiveUpdateAt = Date.now();
      const last = stats.points[stats.points.length - 1];
      DB.updateLiveTracking(liveSessionId, { lat: last.lat, lon: last.lon }).catch(() => {});
    }
  }

  async function handleStop() {
    const stats = Recorder.liveStats();
    if (stats.points.length < 2 || stats.distance < 50) {
      if (confirm(t('record.discardConfirm'))) {
        Recorder.discard();
        clearInterval(uiTimer);
        if (liveSessionId) DB.stopLiveTracking(liveSessionId).catch(() => {});
        navigate('#/');
      }
      return;
    }

    const points = Recorder.stop();
    clearInterval(uiTimer);
    if (liveSessionId) DB.stopLiveTracking(liveSessionId).catch(() => {});

    const summary = Stats.computeSummary(points);
    if (!summary) { toast(t('record.processError')); return; }

    document.getElementById('recControls').innerHTML = '';
    showPreview(summary, null, 'recorded', 'recSaveArea');
  }

  function renderControls() {
    const controls = document.getElementById('recControls');
    const state = Recorder.state;

    if (state === 'idle' || state === 'stopped') {
      document.getElementById('liveShareRow').style.display = 'flex';
      controls.innerHTML = `<button class="btn" id="btnRecStart" style="width:100%;">${t('record.start')}</button>`;
      document.getElementById('btnRecStart').onclick = async () => {
        try {
          await Recorder.start();

          const wantsShare = document.getElementById('liveShareCheck').checked;
          if (wantsShare) {
            liveSessionId = await DB.startLiveTracking(t('record.liveDefaultName')).catch(() => null);
            if (liveSessionId) {
              const url = `${window.location.origin}/#/live/${liveSessionId}`;
              const linkBox = document.getElementById('liveShareLink');
              linkBox.style.display = 'block';
              linkBox.innerHTML = h`
                <div style="background:#F4F6F3; border-radius:8px; padding:8px; font-size:11px; word-break:break-all;">${url}</div>
                <button class="btn secondary" id="btnCopyLiveLink" style="width:100%; margin-top:6px;">${t('record.copyLink')}</button>
              `;
              document.getElementById('btnCopyLiveLink').onclick = async () => {
                try { await navigator.clipboard.writeText(url); toast(t('toast.linkCopied')); }
                catch { toast(t('toast.linkCopyError')); }
              };
            }
          }
          document.getElementById('liveShareRow').style.display = 'none';

          renderControls();
          if (!uiTimer) uiTimer = setInterval(refreshUI, 1000);
        } catch (e) {
          toast(e.message || t('record.geoError'));
        }
      };
    } else if (state === 'recording') {
      controls.innerHTML = `
        <button class="btn secondary" id="btnRecPause" style="flex:1;">${t('record.pause')}</button>
        <button class="btn" id="btnRecStop" style="flex:1; background:#c0392b;">${t('record.stop')}</button>
      `;
      document.getElementById('btnRecPause').onclick = () => { Recorder.pause(); renderControls(); };
      document.getElementById('btnRecStop').onclick = handleStop;
    } else if (state === 'paused') {
      controls.innerHTML = `
        <button class="btn" id="btnRecResume" style="flex:1;">${t('record.resume')}</button>
        <button class="btn secondary" id="btnRecStop" style="flex:1;">${t('record.stop')}</button>
      `;
      document.getElementById('btnRecResume').onclick = async () => { await Recorder.resume(); renderControls(); };
      document.getElementById('btnRecStop').onclick = handleStop;
    }
  }

  renderControls();
  refreshUI();
}

// ============================================================
// VER "EN DIRECTO" — pantalla pública, funciona SIN sesión iniciada.
// ============================================================

function renderLiveView(sessionId) {
  const $v = document.getElementById('view');
  $v.innerHTML = `
    <div class="topbar"><h2>${t('live.title')}</h2></div>
    <div class="card" id="liveStatusCard"><div class="spinner"></div></div>
    <div class="map-box" id="liveMap"></div>
  `;

  if (!sessionId) {
    document.getElementById('liveStatusCard').innerHTML = `<p style="color:#c0392b;">${t('live.invalidLink')}</p>`;
    return;
  }

  let map = null, marker = null;

  const unsubscribe = DB.watchLiveTracking(sessionId, (data) => {
    renderLiveStatus(data);

    if (data && data.lat != null && data.lon != null && typeof L !== 'undefined') {
      if (!map) {
        map = L.map('liveMap', { attributionControl: false });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(map);
        map.setView([data.lat, data.lon], 15);
      }
      if (marker) marker.setLatLng([data.lat, data.lon]);
      else marker = L.marker([data.lat, data.lon]).addTo(map);
      map.panTo([data.lat, data.lon]);
    }
  });

  // Nos damos de baja del listener en tiempo real al salir de esta
  // pantalla — si no, seguiría escuchando cambios de fondo para siempre.
  window.addEventListener('hashchange', function cleanup() {
    unsubscribe();
    window.removeEventListener('hashchange', cleanup);
  }, { once: true });
}

function renderLiveStatus(data) {
  const card = document.getElementById('liveStatusCard');
  if (!card) return;

  if (!data) {
    card.innerHTML = `<p style="color:#888;">${t('live.unavailable')}</p>`;
    return;
  }

  if (!data.active) {
    card.innerHTML = h`<p>${t('live.finished', { name: `<b>${data.userName}</b>`, routeName: data.routeName })}</p>`;
    return;
  }

  const secondsAgo = (data.updatedAt && data.updatedAt.toMillis)
    ? Math.round((Date.now() - data.updatedAt.toMillis()) / 1000)
    : null;
  const stale = secondsAgo != null && secondsAgo > 120;

  card.innerHTML = h`
    <p>${t('live.active', { name: `<b>${data.userName}</b>`, routeName: data.routeName })}</p>
    <p style="font-size:12px; color:${stale ? '#c0392b' : '#888'};">
      ${secondsAgo != null ? t('live.updatedAgo', { n: secondsAgo }) : t('live.waitingFirst')}
      ${stale ? t('live.staleNote') : ''}
    </p>
  `;
}

// ============================================================
// ============================================================
// EXPLORAR RUTAS — buscador, filtro por tipo, mapa en miniatura
// ============================================================

function activityLabels() {
  return {
    hiking: t('activity.hiking'), running: t('activity.running'), cycling: t('activity.cycling'),
    mtb: t('activity.mtb'), other: t('activity.other')
  };
}

let EXPLORE_FILTER = 'all';
let ALL_ROUTES_CACHE = [];

async function renderList() {
  const $v = document.getElementById('view');
  $v.innerHTML = `
    <div class="topbar">
      <h2>${t('list.title')}</h2>
      <button class="icon-btn" id="btnQuickSync" title="${t('list.syncTitle')}">↻</button>
      <a href="#/connect" class="icon-btn" title="${t('list.connectTitle')}">⌚</a>
      <button class="icon-btn" id="btnLogout">⏻</button>
    </div>
    <a href="#/upload" class="btn" style="display:block; text-align:center; margin-bottom:10px;">${t('list.uploadBtn')}</a>
    <a href="#/record" class="btn secondary" style="display:block; text-align:center; margin-bottom:10px;">${t('list.recordBtn')}</a>
    <a href="#/import-osm" class="btn secondary" style="display:block; text-align:center; margin-bottom:16px;">${t('list.importOsmBtn')}</a>

    <input id="searchInput" placeholder="${t('list.searchPlaceholder')}" style="margin-bottom:10px;">

    <div id="filterChips" class="chips-row"></div>

    <div id="routesList"><div class="spinner"></div></div>
  `;

  document.getElementById('btnLogout').onclick = () => signOut(auth);
  document.getElementById('searchInput').oninput = renderFilteredRoutes;
  setupQuickSync();

  renderFilterChips();
  await loadAndRenderRoutes();
}

function setupQuickSync() {
  const btn = document.getElementById('btnQuickSync');
  if (!btn) return;

  btn.onclick = async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = '…';

    try {
      const idToken = await auth.currentUser.getIdToken();
      const resp = await fetch('/api/trigger-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}`, 'X-Lang': getLang() },
        body: JSON.stringify({ days: 1 })
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `Error ${resp.status}`);
      }
      toast(t('toast.syncTriggered'));
    } catch (e) {
      console.error(e);
      toast(e.message || t('toast.syncError'));
    } finally {
      btn.textContent = original;
      setTimeout(() => { btn.disabled = false; }, 8000);
    }
  };
}

// ============================================================
// CONECTAR MI GARMIN (vía Intervals.icu)
// ============================================================

// ============================================================
// IMPORTAR DE OPENSTREETMAP — busca senderos/rutas reales cerca de un
// punto (vía Overpass API, gratis y pública) y los deja importar con
// un clic. Los senderos largos suelen venir troceados en varios pedazos
// en OpenStreetMap — los cosemos en un trazado continuo aquí mismo.
//
// OJO — margen de longitud: Overpass encuentra una relación de ruta si
// CUALQUIERA de sus nodos cae dentro del radio pedido, aunque la ruta
// completa (p.ej. un GR de 200km) recorra medio país. Por eso antes
// aparecían resultados kilométricamente enormes con un radio de 5-10km.
// Como no cortamos el trazado (solo lo cosemos entero), aplicamos un
// margen razonable: descartamos relaciones cuya longitud total supere
// el radio pedido multiplicado por OSM_LENGTH_MARGIN. No es un filtro
// exacto por "cerca del punto", pero evita que salgan rutas que se van
// muchísimo más allá de lo buscado.
// ============================================================

const OSM_LENGTH_MARGIN = 3;

function haversineSimple(a, b) {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180, dLon = (b.lon - a.lon) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180, lat2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function stitchSegments(segments) {
  const valid = segments.filter(s => s && s.length > 1);
  if (!valid.length) return [];
  let path = [...valid[0]];
  for (let i = 1; i < valid.length; i++) {
    const seg = valid[i];
    const last = path[path.length - 1];
    const distToStart = haversineSimple(last, seg[0]);
    const distToEnd = haversineSimple(last, seg[seg.length - 1]);
    path = distToEnd < distToStart ? path.concat([...seg].reverse()) : path.concat(seg);
  }
  return path;
}

function osmRouteTypes() {
  return {
    hiking: { osmValue: 'hiking', label: t('activity.hiking') },
    cycling: { osmValue: 'bicycle', label: t('activity.cycling') },
    mtb: { osmValue: 'mtb', label: t('activity.mtb') }
  };
}

// Pide la altitud real de cada punto a nuestro puente con Open-Elevation
// (ver api/elevation.js) — OSM no trae altitud en los nodos de un camino.
// Si el servicio falla, no bloqueamos la importación: seguimos con los
// puntos tal cual (sin altitud), y quien llame a esta función decide
// cómo avisar de que se ha importado sin desnivel.
async function fetchElevations(points) {
  if (!points.length) return { points, ok: true };
  try {
    const resp = await fetch('/api/elevation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Lang': getLang() },
      body: JSON.stringify({ points: points.map(p => ({ lat: p.lat, lon: p.lon })) })
    });
    const data = await resp.json();
    if (!resp.ok || !Array.isArray(data.elevations)) {
      return { points, ok: false };
    }
    const withEle = points.map((p, i) => ({
      ...p,
      ele: (typeof data.elevations[i] === 'number') ? data.elevations[i] : p.ele
    }));
    // "ok" solo si el servicio ha devuelto al menos alguna altitud real —
    // si todo ha vuelto null (servicio caído, etc.), lo tratamos como fallo.
    const ok = data.elevations.some(e => typeof e === 'number');
    return { points: withEle, ok };
  } catch (e) {
    console.warn('No se pudo obtener la altitud de OpenStreetMap', e);
    return { points, ok: false };
  }
}

async function geocodePlace(placeName) {
  const resp = await fetch('/api/osm-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Lang': getLang() },
    body: JSON.stringify({ action: 'geocode', place: placeName })
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || t('osm.needPlace'));
  return data;
}

async function searchOsmRoutes(lat, lon, radiusM, osmValue) {
  const resp = await fetch('/api/osm-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Lang': getLang() },
    body: JSON.stringify({ lat, lon, radius: radiusM, osmValue })
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || 'OpenStreetMap no respondió.');

  const nodesById = {}, waysById = {}, relations = [];
  for (const el of data.elements) {
    if (el.type === 'node') nodesById[el.id] = { lat: el.lat, lon: el.lon };
    else if (el.type === 'way') waysById[el.id] = el;
    else if (el.type === 'relation') relations.push(el);
  }

  const radiusNum = Number(radiusM) || 0;

  return relations.map(rel => {
    const wayMembers = rel.members.filter(m => m.type === 'way');
    const segments = wayMembers.map(m => {
      const way = waysById[m.ref];
      if (!way || !way.nodes) return null;
      return way.nodes.map(nid => nodesById[nid]).filter(Boolean);
    });
    const points = stitchSegments(segments);
    return {
      osmId: rel.id,
      name: (rel.tags && rel.tags.name) || `#${rel.id}`,
      points
    };
  }).filter(r => {
    if (r.points.length <= 5) return false; // descartamos trozos demasiado pequeños/rotos
    if (!radiusNum) return true;
    const totalLength = Stats.cumulativeDistances(r.points).pop() || 0;
    // Descarta rutas que se van mucho más allá del radio pedido (ver nota arriba).
    return totalLength <= radiusNum * OSM_LENGTH_MARGIN;
  });
}

async function renderImportOsm() {
  const $v = document.getElementById('view');
  $v.innerHTML = h`
    <div class="topbar"><a href="#/" class="icon-btn">‹</a><h2>${t('osm.title')}</h2></div>

    <p style="font-size:12px; color:#888; margin-bottom:10px;">
      ${t('osm.description')}
    </p>

    <label>${t('osm.searchNear')}</label>
    <input id="osmPlace" placeholder="${t('osm.placePlaceholder')}">
    <button class="btn secondary" id="btnUseMyLocation" style="width:100%; margin-bottom:10px;">${t('osm.useLocation')}</button>

    <label>${t('osm.type')}</label>
    <select id="osmType">
      <option value="hiking">${t('activity.hiking')}</option>
      <option value="cycling">${t('activity.cycling')}</option>
      <option value="mtb">${t('activity.mtb')}</option>
    </select>

    <label>${t('osm.radius')}</label>
    <select id="osmRadius">
      <option value="5000">5 km</option>
      <option value="10000" selected>10 km</option>
      <option value="20000">20 km</option>
    </select>

    <button class="btn" id="btnSearchOsm" style="width:100%; margin-top:6px;">${t('osm.searchBtn')}</button>

    <div id="osmResults" style="margin-top:16px;"></div>
  `;

  let searchCenter = null;

  document.getElementById('btnUseMyLocation').onclick = () => {
    if (!('geolocation' in navigator)) { toast(t('osm.noGeo')); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        searchCenter = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        document.getElementById('osmPlace').value = t('osm.currentLocationLabel');
        toast(t('toast.locationDetected'));
      },
      () => toast(t('toast.locationError'))
    );
  };

  document.getElementById('btnSearchOsm').onclick = async () => {
    const results = document.getElementById('osmResults');
    const placeText = document.getElementById('osmPlace').value.trim();
    const radius = document.getElementById('osmRadius').value;
    const activityKey = document.getElementById('osmType').value;

    results.innerHTML = '<div class="spinner"></div>';

    try {
      let center = searchCenter;
      if (!center) {
        if (!placeText) throw new Error(t('osm.needPlace'));
        center = await geocodePlace(placeText);
      }

      const found = await searchOsmRoutes(center.lat, center.lon, radius, osmRouteTypes()[activityKey].osmValue);

      if (!found.length) {
        results.innerHTML = `<p style="color:#888; text-align:center;">${t('osm.noResults')}</p>`;
        return;
      }

      results.innerHTML = found.map((r, i) => {
        const dist = Stats.cumulativeDistances(r.points).pop();
        return h`
          <div class="card">
            <b>${r.name}</b>
            <p style="font-size:12px; color:#888;">${Stats.fmtDistance(dist)} · ${t('osm.points', { n: r.points.length })}</p>
            <button class="btn secondary" data-import="${i}" style="width:100%;">${t('osm.importBtn')}</button>
          </div>
        `;
      }).join('');

      results.querySelectorAll('[data-import]').forEach(btn => {
        btn.onclick = async () => {
          const r = found[+btn.dataset.import];
          btn.disabled = true;
          try {
            // 1. Simplificamos el trazado ANTES de pedir altitud, para no
            // tener que consultar miles de puntos a un servicio público y
            // gratuito — con esto ya queda con la densidad final de
            // almacenamiento (igual tolerancia que downsampleForStorage).
            const simplifiedPoints = Stats.downsampleForStorage(r.points);

            btn.textContent = t('osm.fetchingElevation');
            const { points: pointsWithEle, ok: elevationOk } = await fetchElevations(simplifiedPoints);

            btn.textContent = t('osm.importing');
            const summary = Stats.computeSummary(pointsWithEle);
            if (!summary) throw new Error(t('osm.invalidTrack'));

            const storedPoints = summary.points.map(p => ({
              lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6),
              ele: p.ele != null ? Math.round(p.ele) : null
            }));

            const saved = await DB.saveRoute({
              name: r.name,
              activityType: activityKey,
              description: t('osm.importedDesc'),
              distance: summary.totalDistance,
              elevGain: summary.elevGain,
              elevLoss: summary.elevLoss,
              duration: null,
              source: 'openstreetmap',
              points: storedPoints
            });

            toast(elevationOk ? t('toast.imported') : t('osm.elevationError'));
            navigate(`#/route/${saved.id}`);
          } catch (e) {
            toast(e.message || t('toast.importError'));
            btn.disabled = false;
            btn.textContent = t('osm.importBtn');
          }
        };
      });

    } catch (e) {
      console.error(e);
      results.innerHTML = `<p style="color:#c0392b;">${e.message}</p>`;
    }
  };
}

async function renderConnect() {
  const $v = document.getElementById('view');
  $v.innerHTML = `
    <div class="topbar"><a href="#/" class="icon-btn">‹</a><h2>${t('connect.garminTitle')}</h2></div>
    <div class="card" id="garminCard"><div class="spinner"></div></div>

    <div class="topbar" style="margin-top:20px;"><h2>${t('connect.sendTitle')}</h2></div>
    <div class="card" id="rwgpsCard"><div class="spinner"></div></div>
  `;

  const card = document.getElementById('garminCard');
  const existing = await DB.getGarminIntegration().catch(() => null);

  card.innerHTML = h`
    <p style="font-size:12px; color:#888; margin-bottom:10px;">
      ${t('connect.garminDesc')}
    </p>

    <label>${t('connect.apiKeyLabel')}</label>
    <input id="garminApiKey" type="password" placeholder="${existing ? t('connect.apiKeySaved') : t('connect.apiKeyPlaceholder')}">

    <label>${t('connect.athleteIdLabel')}</label>
    <input id="garminAthleteId" value="${existing ? existing.intervalsAthleteId : '0'}">

    <div style="display:flex; gap:8px; margin-top:6px;">
      <button class="btn" id="btnSaveGarmin" style="flex:1;">${existing ? t('connect.updateKey') : t('connect.save')}</button>
      ${existing ? `<button class="btn secondary" id="btnRemoveGarmin">${t('connect.disconnect')}</button>` : ''}
    </div>
    <p id="garminMsg" style="font-size:12px; margin-top:8px;"></p>
  `;

  document.getElementById('btnSaveGarmin').onclick = async () => {
    const key = document.getElementById('garminApiKey').value.trim();
    const athleteId = document.getElementById('garminAthleteId').value.trim() || '0';
    const msg = document.getElementById('garminMsg');
    if (!key) { msg.style.color = '#c0392b'; msg.textContent = t('connect.pasteFirst'); return; }
    try {
      await DB.saveGarminIntegration({ intervalsApiKey: key, intervalsAthleteId: athleteId });
      toast(t('toast.garminConnected'));
      renderConnect();
    } catch (e) {
      msg.style.color = '#c0392b';
      msg.textContent = e.message || t('connect.saveError');
    }
  };

  const btnRemove = document.getElementById('btnRemoveGarmin');
  if (btnRemove) {
    btnRemove.onclick = async () => {
      if (!confirm(t('connect.disconnectConfirm'))) return;
      await DB.deleteGarminIntegration();
      toast(t('toast.disconnected'));
      renderConnect();
    };
  }

  // --- RideWithGPS (puente para mandar rutas al reloj) ---
  const rwCard = document.getElementById('rwgpsCard');
  const existingRw = await DB.getRideWithGPSIntegration().catch(() => null);

  rwCard.innerHTML = h`
    <p style="font-size:12px; color:#888; margin-bottom:10px;">
      ${t('rwgps.desc')}
    </p>
    <label>${t('rwgps.emailLabel')}</label>
    <input id="rwEmail" type="email" placeholder="${existingRw ? t('rwgps.emailSaved') : t('rwgps.emailPlaceholder')}">
    <label>${t('rwgps.passwordLabel')}</label>
    <input id="rwPassword" type="password" placeholder="${t('rwgps.passwordPlaceholder')}">
    <button class="btn" id="btnSaveRw" style="width:100%; margin-top:6px;">${existingRw ? t('rwgps.reconnect') : t('rwgps.connect')}</button>
    <p id="rwMsg" style="font-size:12px; margin-top:8px;"></p>
  `;

  document.getElementById('btnSaveRw').onclick = async () => {
    const email = document.getElementById('rwEmail').value.trim();
    const password = document.getElementById('rwPassword').value;
    const msg = document.getElementById('rwMsg');
    if (!email || !password) { msg.style.color = '#c0392b'; msg.textContent = t('rwgps.fillFields'); return; }

    msg.style.color = '#888';
    msg.textContent = t('rwgps.connecting');
    try {
      const idToken = await auth.currentUser.getIdToken();
      const resp = await fetch('/api/ridewithgps-connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}`, 'X-Lang': getLang() },
        body: JSON.stringify({ email, password })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `Error ${resp.status}`);

      await DB.saveRideWithGPSIntegration({ authToken: data.authToken, rwgpsUserId: data.userId });
      toast(t('toast.rwgpsConnected'));
      renderConnect();
    } catch (e) {
      msg.style.color = '#c0392b';
      msg.textContent = e.message || t('rwgps.connectError');
    }
  };
}

function renderFilterChips() {
  const chipsEl = document.getElementById('filterChips');
  const options = [['all', t('filter.all')], ['favorites', t('filter.favorites')], ...Object.entries(activityLabels())];
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
    if (EXPLORE_FILTER === 'favorites') {
      const favIds = await DB.listFavoriteIds();
      if (!favIds.length) {
        ALL_ROUTES_CACHE = [];
      } else {
        const all = await DB.listRoutes({ activityType: 'all', count: 200 });
        const favSet = new Set(favIds);
        ALL_ROUTES_CACHE = all.filter(r => favSet.has(r.id));
      }
    } else {
      ALL_ROUTES_CACHE = await DB.listRoutes({ activityType: EXPLORE_FILTER, count: 100 });
    }
    renderFilteredRoutes();
  } catch (e) {
    console.error(e);
    list.innerHTML = `<p style="color:#c0392b;">${t('list.loadError')}</p>`;
  }
}

function renderFilteredRoutes() {
  const list = document.getElementById('routesList');
  const search = (document.getElementById('searchInput').value || '').toLowerCase().trim();
  const routes = search
    ? ALL_ROUTES_CACHE.filter(r => (r.name || '').toLowerCase().includes(search))
    : ALL_ROUTES_CACHE;

  if (!routes.length) {
    list.innerHTML = `<p style="color:#888; text-align:center;">${search ? t('list.noMatch') : t('list.empty')}</p>`;
    return;
  }

  const labels = activityLabels();

  list.innerHTML = routes.map(r => h`
    <a href="#/route/${r.id}" class="card route-card">
      <div class="route-map" id="mini-${r.id}"></div>
      <b>${r.name}</b>
      <p style="font-size:12px; color:#888;">${labels[r.activityType] || ''} · ${t('list.uploadedBy', { name: r.createdByName })}</p>
      <div class="stat-grid cols-3">
        <div class="stat"><b>${Stats.fmtDistance(r.distance)}</b><span>${t('stat.distance')}</span></div>
        <div class="stat"><b>+${Math.round(r.elevGain)} m</b><span>${t('stat.elevGain')}</span></div>
        <div class="stat"><b>${r.duration ? Stats.fmtDuration(r.duration) : '--'}</b><span>${t('stat.duration')}</span></div>
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
    $v.innerHTML = `<p>${t('detail.notFound')}</p><a href="#/">${t('detail.back')}</a>`;
    return;
  }

  const isMine = CURRENT_USER && route.createdBy === CURRENT_USER.uid;
  const labels = activityLabels();

  $v.innerHTML = h`
    <div class="topbar">
      <a href="#/" class="icon-btn">‹</a>
      <h2 style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0;">${route.name}</h2>
      ${isMine ? '<button class="icon-btn" id="btnEditRoute" title="Editar">✏️</button>' : ''}
      ${isMine ? '<button class="icon-btn" id="btnDeleteRoute" title="Esborrar">🗑</button>' : ''}
      <button class="icon-btn" id="btnFavorite">☆</button>
    </div>

    <div class="map-box" id="detailMap"></div>
    <div id="editRouteBox"></div>

    <div class="card">
      <p style="font-size:12px; color:#888;">${labels[route.activityType] || ''} · ${t('detail.uploadedBy', { name: route.createdByName })}</p>
      ${route.description ? `<p>${route.description}</p>` : ''}

      <div class="stat-grid">
        <div class="stat"><b>${Stats.fmtDistance(route.distance)}</b><span>${t('stat.distance')}</span></div>
        <div class="stat"><b>+${Math.round(route.elevGain)} m</b><span>${t('stat.elevGain')}</span></div>
        <div class="stat"><b>-${Math.round(route.elevLoss)} m</b><span>${t('stat.elevLoss')}</span></div>
        <div class="stat"><b>${route.duration ? Stats.fmtDuration(route.duration) : '--'}</b><span>${t('stat.duration')}</span></div>
      </div>

      <button class="btn secondary" id="btnDownloadGPX" style="margin-top:12px; width:100%;">${t('detail.downloadGpx')}</button>
      <button class="btn" id="btnSendToWatch" style="margin-top:8px; width:100%;">${t('detail.sendToWatch')}</button>
    </div>

    <div class="section-title">${t('detail.elevationProfile')}</div>
    <div class="card">
      <canvas id="elevChart" height="140"></canvas>
    </div>

    <div class="section-title">${t('detail.photos')}</div>
    <div class="card">
      <div id="photosGallery" style="display:flex; gap:8px; overflow-x:auto; padding-bottom:4px;"></div>
      <input type="file" id="photoInput" accept="image/*" style="display:none;">
      <button class="btn secondary" id="btnAddPhoto" style="margin-top:10px; width:100%;">${t('detail.addPhoto')}</button>
    </div>

    <div class="section-title">${t('detail.comments')}</div>
    <div class="card">
      <div id="commentsList"></div>
      <div style="display:flex; gap:8px; margin-top:10px;">
        <input id="commentInput" placeholder="${t('detail.commentPlaceholder')}" maxlength="500" style="flex:1; margin-bottom:0;">
        <button class="btn" id="btnPostComment" style="width:auto;">${t('detail.send')}</button>
      </div>
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

  document.getElementById('btnSendToWatch').onclick = async () => {
    const btn = document.getElementById('btnSendToWatch');
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = t('detail.sending');
    try {
      const idToken = await auth.currentUser.getIdToken();
      const resp = await fetch('/api/send-to-ridewithgps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}`, 'X-Lang': getLang() },
        body: JSON.stringify({ routeId: route.id })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `Error ${resp.status}`);

      if (data.routeUrl) {
        // Nos acordamos del enlace, para poder ofrecer borrarla también
        // ahí si algún día borras esta ruta desde Trams.
        route.rideWithGpsUrl = data.routeUrl;
        DB.updateRoute(route.id, { rideWithGpsUrl: data.routeUrl }).catch(() => {});

        if (confirm(t('detail.sentConfirm'))) {
          window.open(data.routeUrl, '_blank');
        }
      } else {
        toast(t('toast.sentNoUrl'));
      }
    } catch (e) {
      console.error(e);
      alert(e.message || t('detail.sendError'));
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  };

  setupFavoriteButton(route);
  setupPhotos(route);
  setupComments(route);

  if (isMine) {
    document.getElementById('btnEditRoute').onclick = () => showEditRouteForm(route);
    document.getElementById('btnDeleteRoute').onclick = async () => {
      const confirmMsg = route.rideWithGpsUrl
        ? t('detail.deleteConfirmSimple', { name: route.name })
        : t('detail.deleteConfirmRwgps', { name: route.name });
      if (!confirm(confirmMsg)) return;

      try {
        await DB.deleteRoute(route.id);
        toast(t('toast.routeDeleted'));

        // Si la enviamos alguna vez a RideWithGPS, ofrecemos ir directos
        // a esa ruta ahí para borrarla también — mismo patrón que al
        // enviarla al reloj.
        if (route.rideWithGpsUrl && confirm(t('detail.deleteRwgpsConfirm'))) {
          window.open(route.rideWithGpsUrl, '_blank');
        }

        navigate('#/');
      } catch (e) {
        toast(e.message || t('detail.deleteError'));
      }
    };
  }
}

function showEditRouteForm(route) {
  const box = document.getElementById('editRouteBox');
  const labels = activityLabels();
  box.innerHTML = h`
    <div class="card">
      <label>${t('edit.name')}</label>
      <input id="editName" value="${route.name || ''}">
      <label>${t('edit.activityType')}</label>
      <select id="editActivity">
        ${Object.entries(labels).map(([key, label]) =>
          `<option value="${key}" ${route.activityType === key ? 'selected' : ''}>${label}</option>`
        ).join('')}
      </select>
      <label>${t('edit.description')}</label>
      <textarea id="editDesc">${route.description || ''}</textarea>
      <div style="display:flex; gap:8px;">
        <button class="btn" id="btnSaveEdit" style="flex:1;">${t('edit.save')}</button>
        <button class="btn secondary" id="btnCancelEdit">${t('edit.cancel')}</button>
      </div>
    </div>
  `;

  document.getElementById('btnCancelEdit').onclick = () => { box.innerHTML = ''; };

  document.getElementById('btnSaveEdit').onclick = async () => {
    const btn = document.getElementById('btnSaveEdit');
    btn.disabled = true;
    btn.textContent = t('edit.saving');
    try {
      await DB.updateRoute(route.id, {
        name: document.getElementById('editName').value.trim() || route.name,
        activityType: document.getElementById('editActivity').value,
        description: document.getElementById('editDesc').value.trim()
      });
      toast(t('toast.routeUpdated'));
      renderRouteDetail(route.id);
    } catch (e) {
      toast(e.message || t('edit.saveError'));
      btn.disabled = false;
      btn.textContent = t('edit.save');
    }
  };
}

function setupFavoriteButton(route) {
  const btn = document.getElementById('btnFavorite');

  DB.isFavorite(route.id).then(fav => {
    btn.textContent = fav ? '★' : '☆';
    btn.dataset.fav = fav ? '1' : '0';
  });

  btn.onclick = async () => {
    btn.disabled = true;
    try {
      if (btn.dataset.fav === '1') {
        await DB.removeFavorite(route.id);
        btn.textContent = '☆'; btn.dataset.fav = '0';
      } else {
        await DB.addFavorite(route);
        btn.textContent = '★'; btn.dataset.fav = '1';
      }
    } catch (e) {
      toast(t('toast.favError'));
    } finally {
      btn.disabled = false;
    }
  };
}

// Redimensiona una foto a un tamaño razonable antes de guardarla como
// texto base64 en Firestore — sin esto, una foto de móvil sin comprimir
// se pasaría de largo del límite de tamaño del documento.
function resizeImageKeepAspect(file, maxDim = 1000, quality = 0.78) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result; };
    reader.onerror = reject;
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > h && w > maxDim) { h = Math.round(h * (maxDim / w)); w = maxDim; }
      else if (h >= w && h > maxDim) { w = Math.round(w * (maxDim / h)); h = maxDim; }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function setupPhotos(route) {
  const gallery = document.getElementById('photosGallery');
  const input = document.getElementById('photoInput');
  const btnAdd = document.getElementById('btnAddPhoto');

  let photos = await DB.listPhotos(route.id).catch(() => []);

  function renderGallery() {
    if (!photos.length) {
      gallery.innerHTML = `<p style="color:#888; font-size:13px; margin:0;">${t('photos.none')}</p>`;
      return;
    }
    gallery.innerHTML = photos.map((p, i) => `
      <img src="${p.dataUrl}" data-idx="${i}" style="width:96px; height:96px; object-fit:cover; border-radius:10px; flex-shrink:0; cursor:pointer;">
    `).join('');
    gallery.querySelectorAll('img').forEach(imgEl => {
      imgEl.onclick = () => openPhotoLightbox(photos[+imgEl.dataset.idx], route.id, photos, renderGallery);
    });
  }
  renderGallery();

  btnAdd.onclick = () => input.click();
  input.onchange = async () => {
    if (!input.files.length) return;
    btnAdd.textContent = t('photos.uploading');
    try {
      const dataUrl = await resizeImageKeepAspect(input.files[0]);
      const saved = await DB.addPhoto(route.id, dataUrl);
      photos.push(saved);
      renderGallery();
      toast(t('toast.photoAdded'));
    } catch (e) {
      console.error(e);
      toast(t('photos.uploadError'));
    } finally {
      btnAdd.textContent = t('detail.addPhoto');
      input.value = '';
    }
  };
}

function openPhotoLightbox(photo, routeId, photos, onChange) {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position:fixed; inset:0; background:rgba(0,0,0,.92); z-index:2000;
    display:flex; flex-direction:column; align-items:center; justify-content:center;
  `;
  overlay.innerHTML = `
    <img src="${photo.dataUrl}" style="max-width:94%; max-height:78%; border-radius:8px; object-fit:contain;">
    <div style="display:flex; gap:16px; margin-top:18px;">
      <button id="lightboxDelete" class="btn secondary">${t('photos.delete')}</button>
      <button id="lightboxClose" class="btn">${t('photos.close')}</button>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#lightboxClose').onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  overlay.querySelector('#lightboxDelete').onclick = async () => {
    if (!confirm(t('photos.deleteConfirm'))) return;
    try {
      await DB.deletePhoto(routeId, photo.id);
      const idx = photos.findIndex(p => p.id === photo.id);
      if (idx >= 0) photos.splice(idx, 1);
      onChange();
      overlay.remove();
      toast(t('toast.photoDeleted'));
    } catch (e) {
      toast(t('photos.deleteError'));
    }
  };
}

async function setupComments(route) {
  const list = document.getElementById('commentsList');
  const input = document.getElementById('commentInput');
  const btn = document.getElementById('btnPostComment');

  async function refresh() {
    const comments = await DB.listComments(route.id).catch(() => []);
    if (!comments.length) {
      list.innerHTML = `<p style="font-size:12px; color:#888;">${t('comments.none')}</p>`;
      return;
    }
    list.innerHTML = comments.map(c => h`
      <div style="padding:6px 0;">
        <b style="font-size:12px;">${c.userName}</b>
        <span style="font-size:13px;"> ${c.text}</span>
        ${c.uid === (auth.currentUser && auth.currentUser.uid)
          ? `<button data-del="${c.id}" style="background:none; border:none; color:#888; font-size:11px; cursor:pointer; margin-left:6px;">${t('comments.delete')}</button>`
          : ''}
      </div>
    `).join('');

    list.querySelectorAll('[data-del]').forEach(b => {
      b.onclick = async () => {
        await DB.deleteComment(route.id, b.dataset.del).catch(() => {});
        refresh();
      };
    });
  }

  btn.onclick = async () => {
    if (!input.value.trim()) return;
    btn.disabled = true;
    try {
      await DB.addComment(route.id, input.value);
      input.value = '';
      refresh();
    } catch (e) {
      toast(e.message || t('comments.postError'));
    } finally {
      btn.disabled = false;
    }
  };

  refresh();
}

function drawElevationChart(points) {
  const el = document.getElementById('elevChart');
  if (!el) return;

  if (typeof Chart === 'undefined') {
    el.parentElement.innerHTML = `<p style="color:#c0392b; font-size:13px;">${t('chart.loadError')}</p>`;
    return;
  }
  if (!points || points.length < 2 || !points.some(p => p.ele != null)) {
    el.parentElement.innerHTML = `<p style="color:#888; font-size:13px;">${t('chart.noElevation')}</p>`;
    return;
  }

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
        y: { title: { display: true, text: 'm' } }
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

setupLangToggle();

onAuthStateChanged(auth, (user) => {
  CURRENT_USER = user;
  router();
});
