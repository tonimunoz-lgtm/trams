// recorder.js — grabación de una ruta en directo con el GPS del propio
// móvil. Es el mismo módulo (probado y verificado) que ya construimos
// para RunTrack — la lógica de captura de GPS, filtrado de ruido, pausas
// y Wake Lock no cambia entre "grabar una carrera" y "grabar una ruta".
//
// LIMITACIÓN IMPORTANTE (de los navegadores, no nuestra): solo graba de
// forma fiable con Trams en primer plano y la pantalla encendida.

const Recorder = (() => {

  const MAX_ACCURACY_M = 30; // descarta lecturas GPS poco fiables
  const MAX_JUMP_MPS = 12;   // salto de posición imposible a pie -> ruido GPS

  let points = [];
  let watchId = null;
  let wakeLock = null;
  let startTime = null;
  let pausedAt = null;
  let totalPausedMs = 0;
  let state = 'idle'; // idle | recording | paused | stopped

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch (e) {
      console.warn('Wake Lock no disponible en este navegador', e);
    }
  }

  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release().catch(() => {});
      wakeLock = null;
    }
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'visible' && state === 'recording' && !wakeLock) {
      requestWakeLock();
    }
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }

  function onPosition(pos) {
    const c = pos.coords;
    if (c.accuracy != null && c.accuracy > MAX_ACCURACY_M) return;

    const point = {
      lat: c.latitude,
      lon: c.longitude,
      ele: c.altitude != null ? c.altitude : null,
      t: new Date(pos.timestamp)
    };

    if (points.length) {
      const prev = points[points.length - 1];
      const dt = (point.t - prev.t) / 1000;
      if (dt <= 0) return;
      const d = Stats.haversine(prev, point);
      if (d / dt > MAX_JUMP_MPS) return;
    }

    points.push(point);
  }

  function onError(err) {
    console.warn('Error de geolocalización', err);
  }

  function watchOptions() {
    return { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 };
  }

  async function start() {
    if (!('geolocation' in navigator)) {
      throw new Error('Este navegador no tiene acceso a la ubicación.');
    }

    points = [];
    startTime = new Date();
    totalPausedMs = 0;
    pausedAt = null;
    state = 'recording';

    await requestWakeLock();
    watchId = navigator.geolocation.watchPosition(onPosition, onError, watchOptions());
  }

  function pause() {
    if (state !== 'recording') return;
    state = 'paused';
    pausedAt = new Date();
    if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    releaseWakeLock();
  }

  async function resume() {
    if (state !== 'paused') return;
    if (pausedAt) totalPausedMs += (new Date() - pausedAt);
    pausedAt = null;
    state = 'recording';
    await requestWakeLock();
    watchId = navigator.geolocation.watchPosition(onPosition, onError, watchOptions());
  }

  function stop() {
    if (pausedAt) { totalPausedMs += (new Date() - pausedAt); pausedAt = null; }
    state = 'stopped';
    if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    releaseWakeLock();
    return [...points];
  }

  function discard() {
    stop();
    points = [];
    state = 'idle';
  }

  function elapsedMs() {
    if (!startTime) return 0;
    const now = (state === 'paused' && pausedAt) ? pausedAt : new Date();
    return Math.max(0, (now - startTime) - totalPausedMs);
  }

  function liveStats() {
    const cum = points.length > 1 ? Stats.cumulativeDistances(points) : [0];
    const distance = cum[cum.length - 1] || 0;
    const elapsedSec = elapsedMs() / 1000;
    return { distance, elapsedSec, points: [...points], state };
  }

  return {
    start, pause, resume, stop, discard, liveStats,
    get state() { return state; }
  };
})();
