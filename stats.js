// stats.js — cálculos geométricos de una ruta: distancia, desnivel,
// simplificación para guardar en Firestore. A diferencia de RunTrack, aquí
// una ruta puede no tener marcas de tiempo en absoluto (lo normal en un
// track de Wikiloc pensado para seguir, no para cronometrar) — todo lo que
// depende del tiempo es opcional y se omite si no hay datos.

const Stats = (() => {

  function haversine(a, b) {
    const R = 6371000;
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLon = (b.lon - a.lon) * Math.PI / 180;
    const lat1 = a.lat * Math.PI / 180, lat2 = b.lat * Math.PI / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function cumulativeDistances(points) {
    const cum = [0];
    for (let i = 1; i < points.length; i++) {
      cum.push(cum[i - 1] + haversine(points[i - 1], points[i]));
    }
    return cum;
  }

  // Desnivel positivo/negativo, suavizando la altitud (el GPS es ruidoso
  // en vertical) para no contar como "subida" cada pequeño temblor del
  // sensor.
  function computeElevation(points, windowSize = 2) {
    const elevs = points.map(p => p.ele);
    const valid = elevs.filter(e => e != null);
    if (valid.length < 5) return { gain: 0, loss: 0, min: null, max: null };

    const smoothed = points.map((p, i) => {
      const win = points
        .slice(Math.max(0, i - windowSize), i + windowSize + 1)
        .map(pp => pp.ele)
        .filter(e => e != null);
      return win.length ? win.reduce((a, b) => a + b, 0) / win.length : null;
    });

    let gain = 0, loss = 0;
    for (let i = 1; i < smoothed.length; i++) {
      if (smoothed[i] == null || smoothed[i - 1] == null) continue;
      const diff = smoothed[i] - smoothed[i - 1];
      if (diff > 0.15) gain += diff;
      else if (diff < -0.15) loss += -diff;
    }

    return { gain, loss, min: Math.min(...valid), max: Math.max(...valid) };
  }

  function computeSummary(rawPoints) {
    const points = rawPoints.filter(p =>
      Number.isFinite(p.lat) && Number.isFinite(p.lon)
    );
    if (points.length < 2) return null;

    const cum = cumulativeDistances(points);
    const totalDistance = cum[cum.length - 1];
    const elevation = computeElevation(points);

    // El tiempo es opcional: muchas rutas de senderismo no llevan
    // marcas de tiempo, solo el trazado a seguir.
    const hasTime = !!(points.every(p => p.t) && points[0].t && points[points.length - 1].t);
    const duration = hasTime ? (points[points.length - 1].t - points[0].t) / 1000 : null;

    return {
      points, cum, totalDistance, duration,
      elevGain: elevation.gain, elevLoss: elevation.loss,
      minEle: elevation.min, maxEle: elevation.max,
      hasTime
    };
  }

  // --------------------------------------------------------------------
  // Simplificación Douglas-Peucker — igual que en RunTrack, para no
  // superar el límite de tamaño de un documento de Firestore guardando
  // miles de puntos de una ruta larga.
  // --------------------------------------------------------------------
  function perpDist(p, a, b) {
    const toXY = (pt) => [
      pt.lon * 111320 * Math.cos(a.lat * Math.PI / 180),
      pt.lat * 110540
    ];
    const [px, py] = toXY(p), [ax, ay] = toXY(a), [bx, by] = toXY(b);
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(px - ax, py - ay);
    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy;
    return Math.hypot(px - cx, py - cy);
  }

  function simplify(points, tolerance = 6) {
    if (points.length <= 2) return points;
    const keep = new Array(points.length).fill(false);
    keep[0] = true;
    keep[points.length - 1] = true;

    const stack = [[0, points.length - 1]];
    while (stack.length) {
      const [start, end] = stack.pop();
      if (end <= start + 1) continue;
      let maxD = 0, idx = -1;
      for (let i = start + 1; i < end; i++) {
        const d = perpDist(points[i], points[start], points[end]);
        if (d > maxD) { maxD = d; idx = i; }
      }
      if (idx !== -1 && maxD > tolerance) {
        keep[idx] = true;
        stack.push([start, idx]);
        stack.push([idx, end]);
      }
    }
    return points.filter((_, i) => keep[i]);
  }

  function downsampleForStorage(points, maxPoints = 2000) {
    let pts = simplify(points, 6);
    if (pts.length > maxPoints) {
      const step = pts.length / maxPoints;
      const out = [];
      for (let i = 0; i < maxPoints; i++) out.push(pts[Math.floor(i * step)]);
      out.push(pts[pts.length - 1]);
      pts = out;
    }
    return pts;
  }

  function fmtDistance(meters) {
    if (meters == null) return '--';
    return (meters / 1000).toFixed(2) + ' km';
  }

  function fmtDuration(seconds) {
    if (seconds == null) return '--';
    seconds = Math.round(seconds);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  return {
    haversine, cumulativeDistances, computeSummary, downsampleForStorage,
    fmtDistance, fmtDuration
  };
})();
