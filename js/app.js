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

function showPreview(summary, suggestedName, source, containerId = 'uploadStatus') {
  const status = document.getElementById(containerId);

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
// GRABAR EN DIRECTO CON EL GPS DEL MÓVIL
// ============================================================

function renderRecord() {
  const $v = document.getElementById('view');
  $v.innerHTML = `
    <div class="topbar"><a href="#/" class="icon-btn">‹</a><h2>Grabar en directo</h2></div>

    <div class="card" style="text-align:center; padding:28px 16px;">
      <div id="recDistance" style="font-size:38px; font-weight:800; line-height:1;">0.00 km</div>
      <div style="margin-top:14px;">
        <div id="recDuration" style="font-size:22px; font-weight:800;">0:00</div>
        <span style="font-size:11px; color:#888;">TIEMPO</span>
      </div>
    </div>

    <div class="map-box" id="recordMap"></div>

    <label id="liveShareRow" style="display:flex; align-items:center; gap:8px; margin-top:12px; font-weight:400;">
      <input type="checkbox" id="liveShareCheck" style="width:auto; margin:0;">
      📍 Compartir mi posición en directo (con quien tenga el enlace)
    </label>
    <div id="liveShareLink" style="display:none; margin-top:8px;"></div>

    <div id="recControls" style="display:flex; gap:10px; margin-top:14px;"></div>

    <p style="font-size:11px; color:#888; margin-top:12px; text-align:center; line-height:1.5;">
      Mantén Trams en primer plano y la pantalla encendida durante toda la ruta —
      si bloqueas el móvil o cambias de app, el GPS puede pausarse (limitación del navegador).
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
      if (confirm('Apenas hay recorrido grabado. ¿Descartar esta grabación?')) {
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
    if (!summary) { toast('No se pudo procesar la grabación'); return; }

    document.getElementById('recControls').innerHTML = '';
    showPreview(summary, null, 'recorded', 'recSaveArea');
  }

  function renderControls() {
    const controls = document.getElementById('recControls');
    const state = Recorder.state;

    if (state === 'idle' || state === 'stopped') {
      document.getElementById('liveShareRow').style.display = 'flex';
      controls.innerHTML = `<button class="btn" id="btnRecStart" style="width:100%;">▶ Empezar a grabar</button>`;
      document.getElementById('btnRecStart').onclick = async () => {
        try {
          await Recorder.start();

          const wantsShare = document.getElementById('liveShareCheck').checked;
          if (wantsShare) {
            liveSessionId = await DB.startLiveTracking('una ruta en directo').catch(() => null);
            if (liveSessionId) {
              const url = `${window.location.origin}/#/live/${liveSessionId}`;
              const linkBox = document.getElementById('liveShareLink');
              linkBox.style.display = 'block';
              linkBox.innerHTML = h`
                <div style="background:#F4F6F3; border-radius:8px; padding:8px; font-size:11px; word-break:break-all;">${url}</div>
                <button class="btn secondary" id="btnCopyLiveLink" style="width:100%; margin-top:6px;">📋 Copiar enlace para compartir</button>
              `;
              document.getElementById('btnCopyLiveLink').onclick = async () => {
                try { await navigator.clipboard.writeText(url); toast('Enlace copiado'); }
                catch { toast('No se pudo copiar'); }
              };
            }
          }
          document.getElementById('liveShareRow').style.display = 'none';

          renderControls();
          if (!uiTimer) uiTimer = setInterval(refreshUI, 1000);
        } catch (e) {
          toast(e.message || 'No se pudo acceder a la ubicación. Revisa los permisos de este sitio.');
        }
      };
    } else if (state === 'recording') {
      controls.innerHTML = `
        <button class="btn secondary" id="btnRecPause" style="flex:1;">⏸ Pausar</button>
        <button class="btn" id="btnRecStop" style="flex:1; background:#c0392b;">⏹ Finalizar</button>
      `;
      document.getElementById('btnRecPause').onclick = () => { Recorder.pause(); renderControls(); };
      document.getElementById('btnRecStop').onclick = handleStop;
    } else if (state === 'paused') {
      controls.innerHTML = `
        <button class="btn" id="btnRecResume" style="flex:1;">▶ Reanudar</button>
        <button class="btn secondary" id="btnRecStop" style="flex:1;">⏹ Finalizar</button>
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
    <div class="topbar"><h2>🥾 Trams · En directo</h2></div>
    <div class="card" id="liveStatusCard"><div class="spinner"></div></div>
    <div class="map-box" id="liveMap"></div>
  `;

  if (!sessionId) {
    document.getElementById('liveStatusCard').innerHTML = '<p style="color:#c0392b;">Enlace no válido.</p>';
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
    card.innerHTML = '<p style="color:#888;">Este enlace ya no está disponible.</p>';
    return;
  }

  if (!data.active) {
    card.innerHTML = h`<p><b>${data.userName}</b> ha terminado de compartir su posición (${data.routeName}).</p>`;
    return;
  }

  const secondsAgo = (data.updatedAt && data.updatedAt.toMillis)
    ? Math.round((Date.now() - data.updatedAt.toMillis()) / 1000)
    : null;
  const stale = secondsAgo != null && secondsAgo > 120;

  card.innerHTML = h`
    <p><b>${data.userName}</b> está haciendo "${data.routeName}" ahora mismo. 🟢</p>
    <p style="font-size:12px; color:${stale ? '#c0392b' : '#888'};">
      ${secondsAgo != null ? `Última actualización hace ${secondsAgo}s` : 'Esperando la primera posición…'}
      ${stale ? ' — puede que haya perdido la conexión' : ''}
    </p>
  `;
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
      <button class="icon-btn" id="btnQuickSync" title="Actualizar desde Garmin">↻</button>
      <a href="#/connect" class="icon-btn" title="Conectar mi reloj">⌚</a>
      <button class="icon-btn" id="btnLogout">⏻</button>
    </div>
    <a href="#/upload" class="btn" style="display:block; text-align:center; margin-bottom:10px;">+ Subir una ruta</a>
    <a href="#/record" class="btn secondary" style="display:block; text-align:center; margin-bottom:16px;">🔴 Grabar en directo</a>

    <input id="searchInput" placeholder="Buscar por nombre…" style="margin-bottom:10px;">

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
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ days: 1 })
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `Error ${resp.status}`);
      }
      toast('Sincronización lanzada — tardará unos 20-40s');
    } catch (e) {
      console.error(e);
      toast(e.message || 'No se pudo lanzar la sincronización');
    } finally {
      btn.textContent = original;
      setTimeout(() => { btn.disabled = false; }, 8000);
    }
  };
}

// ============================================================
// CONECTAR MI GARMIN (vía Intervals.icu)
// ============================================================

async function renderConnect() {
  const $v = document.getElementById('view');
  $v.innerHTML = `
    <div class="topbar"><a href="#/" class="icon-btn">‹</a><h2>Conectar mi Garmin</h2></div>
    <div class="card" id="garminCard"><div class="spinner"></div></div>

    <div class="topbar" style="margin-top:20px;"><h2>Enviar rutas al reloj</h2></div>
    <div class="card" id="rwgpsCard"><div class="spinner"></div></div>
  `;

  const card = document.getElementById('garminCard');
  const existing = await DB.getGarminIntegration().catch(() => null);

  card.innerHTML = h`
    <p style="font-size:12px; color:#888; margin-bottom:10px;">
      Consigue tu clave personal en <b>intervals.icu → Ajustes → Developer Settings → API Key</b>, y pégala aquí.
      Es solo tuya — nadie más puede verla ni usarla. Tus actividades de correr, andar o bici se importarán
      automáticamente como rutas tuyas en Trams.
    </p>

    <label>Tu clave de Intervals.icu</label>
    <input id="garminApiKey" type="password" placeholder="${existing ? '•••••••••••••• (ya guardada)' : 'Pega tu clave aquí'}">

    <label>Tu Athlete ID (déjalo en "0" si es tu propia cuenta)</label>
    <input id="garminAthleteId" value="${existing ? existing.intervalsAthleteId : '0'}">

    <div style="display:flex; gap:8px; margin-top:6px;">
      <button class="btn" id="btnSaveGarmin" style="flex:1;">${existing ? 'Actualizar clave' : 'Guardar'}</button>
      ${existing ? '<button class="btn secondary" id="btnRemoveGarmin">Desconectar</button>' : ''}
    </div>
    <p id="garminMsg" style="font-size:12px; margin-top:8px;"></p>
  `;

  document.getElementById('btnSaveGarmin').onclick = async () => {
    const key = document.getElementById('garminApiKey').value.trim();
    const athleteId = document.getElementById('garminAthleteId').value.trim() || '0';
    const msg = document.getElementById('garminMsg');
    if (!key) { msg.style.color = '#c0392b'; msg.textContent = 'Pega tu clave primero.'; return; }
    try {
      await DB.saveGarminIntegration({ intervalsApiKey: key, intervalsAthleteId: athleteId });
      toast('Garmin conectado');
      renderConnect();
    } catch (e) {
      msg.style.color = '#c0392b';
      msg.textContent = e.message || 'No se pudo guardar.';
    }
  };

  const btnRemove = document.getElementById('btnRemoveGarmin');
  if (btnRemove) {
    btnRemove.onclick = async () => {
      if (!confirm('¿Desconectar Garmin?')) return;
      await DB.deleteGarminIntegration();
      toast('Desconectado');
      renderConnect();
    };
  }

  // --- RideWithGPS (puente para mandar rutas al reloj) ---
  const rwCard = document.getElementById('rwgpsCard');
  const existingRw = await DB.getRideWithGPSIntegration().catch(() => null);

  rwCard.innerHTML = h`
    <p style="font-size:12px; color:#888; margin-bottom:10px;">
      Con esto, cada ruta de Trams podrá "Enviarse al reloj": pasa por tu cuenta de RideWithGPS
      (gratis, sin tarjeta) y de ahí a tu Garmin, si tienes su sincronización activada en
      <a href="https://ridewithgps.com" target="_blank">ridewithgps.com</a> → Ajustes → Conexiones.
    </p>
    <label>Email de RideWithGPS</label>
    <input id="rwEmail" type="email" placeholder="${existingRw ? '•••• (ya conectado)' : 'tu@email.com'}">
    <label>Contraseña</label>
    <input id="rwPassword" type="password" placeholder="Solo se usa una vez, no se guarda">
    <button class="btn" id="btnSaveRw" style="width:100%; margin-top:6px;">${existingRw ? 'Reconectar' : 'Conectar RideWithGPS'}</button>
    <p id="rwMsg" style="font-size:12px; margin-top:8px;"></p>
  `;

  document.getElementById('btnSaveRw').onclick = async () => {
    const email = document.getElementById('rwEmail').value.trim();
    const password = document.getElementById('rwPassword').value;
    const msg = document.getElementById('rwMsg');
    if (!email || !password) { msg.style.color = '#c0392b'; msg.textContent = 'Rellena email y contraseña.'; return; }

    msg.style.color = '#888';
    msg.textContent = 'Conectando…';
    try {
      const idToken = await auth.currentUser.getIdToken();
      const resp = await fetch('/api/ridewithgps-connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ email, password })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `Error ${resp.status}`);

      await DB.saveRideWithGPSIntegration({ authToken: data.authToken, rwgpsUserId: data.userId });
      toast('RideWithGPS conectado');
      renderConnect();
    } catch (e) {
      msg.style.color = '#c0392b';
      msg.textContent = e.message || 'No se pudo conectar.';
    }
  };
}

function renderFilterChips() {
  const chipsEl = document.getElementById('filterChips');
  const options = [['all', 'Todos'], ['favorites', '★ Favoritos'], ...Object.entries(ACTIVITY_LABELS)];
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
      <h2 style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0;">${route.name}</h2>
      <button class="icon-btn" id="btnFavorite">☆</button>
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
      <button class="btn" id="btnSendToWatch" style="margin-top:8px; width:100%;">⌚ Enviar al reloj</button>
    </div>

    <div class="section-title">Perfil de elevación</div>
    <div class="card">
      <canvas id="elevChart" height="140"></canvas>
    </div>

    <div class="section-title">Fotos</div>
    <div class="card">
      <div id="photosGallery" style="display:flex; gap:8px; overflow-x:auto; padding-bottom:4px;"></div>
      <input type="file" id="photoInput" accept="image/*" style="display:none;">
      <button class="btn secondary" id="btnAddPhoto" style="margin-top:10px; width:100%;">📷 Añadir foto</button>
    </div>

    <div class="section-title">Comentarios</div>
    <div class="card">
      <div id="commentsList"></div>
      <div style="display:flex; gap:8px; margin-top:10px;">
        <input id="commentInput" placeholder="Escribe un comentario…" maxlength="500" style="flex:1; margin-bottom:0;">
        <button class="btn" id="btnPostComment" style="width:auto;">Enviar</button>
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
    btn.textContent = 'Enviando…';
    try {
      const idToken = await auth.currentUser.getIdToken();
      const resp = await fetch('/api/send-to-ridewithgps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ routeId: route.id })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `Error ${resp.status}`);

      if (data.routeUrl) {
        if (confirm('¡Enviada a RideWithGPS! ¿Abrirla ahora para darle a "Enviar al reloj"?')) {
          window.open(data.routeUrl, '_blank');
        }
      } else {
        toast('¡Enviada a RideWithGPS! Búscala en tu cuenta para mandarla al reloj.');
      }
    } catch (e) {
      console.error(e);
      alert(e.message || 'No se pudo enviar la ruta.');
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  };

  setupFavoriteButton(route);
  setupPhotos(route);
  setupComments(route);
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
      toast('No se pudo actualizar favoritos');
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
      gallery.innerHTML = '<p style="color:#888; font-size:13px; margin:0;">Todavía no hay fotos.</p>';
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
    btnAdd.textContent = 'Subiendo…';
    try {
      const dataUrl = await resizeImageKeepAspect(input.files[0]);
      const saved = await DB.addPhoto(route.id, dataUrl);
      photos.push(saved);
      renderGallery();
      toast('Foto añadida');
    } catch (e) {
      console.error(e);
      toast('No se pudo subir la foto');
    } finally {
      btnAdd.textContent = '📷 Añadir foto';
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
      <button id="lightboxDelete" class="btn secondary">🗑 Borrar</button>
      <button id="lightboxClose" class="btn">Cerrar</button>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#lightboxClose').onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  overlay.querySelector('#lightboxDelete').onclick = async () => {
    if (!confirm('¿Borrar esta foto?')) return;
    try {
      await DB.deletePhoto(routeId, photo.id);
      const idx = photos.findIndex(p => p.id === photo.id);
      if (idx >= 0) photos.splice(idx, 1);
      onChange();
      overlay.remove();
      toast('Foto borrada');
    } catch (e) {
      toast('No se pudo borrar (solo el autor puede)');
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
      list.innerHTML = '<p style="font-size:12px; color:#888;">Sin comentarios todavía.</p>';
      return;
    }
    list.innerHTML = comments.map(c => h`
      <div style="padding:6px 0;">
        <b style="font-size:12px;">${c.userName}</b>
        <span style="font-size:13px;"> ${c.text}</span>
        ${c.uid === (auth.currentUser && auth.currentUser.uid)
          ? `<button data-del="${c.id}" style="background:none; border:none; color:#888; font-size:11px; cursor:pointer; margin-left:6px;">borrar</button>`
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
      toast(e.message || 'No se pudo enviar el comentario');
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
    el.parentElement.innerHTML = '<p style="color:#c0392b; font-size:13px;">No se pudo cargar el gráfico (fallo de red al cargar la librería). Recarga la página.</p>';
    return;
  }
  if (!points || points.length < 2) {
    el.parentElement.innerHTML = '<p style="color:#888; font-size:13px;">Esta ruta no tiene datos de altitud.</p>';
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
