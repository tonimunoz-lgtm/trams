// api/elevation.js — puente hacia Open-Elevation (servicio público y
// gratuito de altitudes por coordenadas). Hace falta porque las rutas
// importadas de OpenStreetMap (vía Overpass) traen solo lat/lon de cada
// nodo — OSM no guarda la altitud de los caminos, solo de algún punto
// suelto como una cima. Sin esto, "Desnivel +/-" y el perfil de
// elevación de una ruta importada de OSM siempre saldrían a 0.
//
// Igual que con Overpass, lo hacemos desde el servidor (no directamente
// desde el navegador) para evitar problemas de CORS y para poder
// trocear la petición en lotes sin que el cliente tenga que gestionarlo.
//
// No necesita ninguna variable de entorno: Open-Elevation es público.
//
// Los mensajes de error se devuelven en català o castellà según la
// cabecera X-Lang que manda el cliente (por defecto català).

const OPEN_ELEVATION_URL = 'https://api.open-elevation.com/api/v1/lookup';
const CHUNK_SIZE = 100;      // puntos por petición a Open-Elevation
const CONCURRENCY = 4;       // peticiones en paralelo
const CHUNK_TIMEOUT_MS = 9000;
const MAX_POINTS = 2000;     // igual que MAX_STORED_POINTS en el resto de la app

const MSGS = {
  ca: {
    methodNotAllowed: 'Mètode no permès',
    missingPoints: 'Falta la llista de punts.',
    tooManyPoints: `No es poden consultar més de ${MAX_POINTS} punts d\u2019una vegada.`
  },
  es: {
    methodNotAllowed: 'Método no permitido',
    missingPoints: 'Falta la lista de puntos.',
    tooManyPoints: `No se pueden consultar más de ${MAX_POINTS} puntos de una vez.`
  }
};

function pickLang(req) {
  const l = String(req.headers['x-lang'] || '').toLowerCase();
  return l === 'es' ? 'es' : 'ca';
}

async function fetchChunk(points) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHUNK_TIMEOUT_MS);

  try {
    const resp = await fetch(OPEN_ELEVATION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locations: points.map(p => ({ latitude: p.lat, longitude: p.lon }))
      }),
      signal: controller.signal
    });

    if (!resp.ok) {
      console.error('Open-Elevation rechazó el lote', resp.status);
      return points.map(() => null);
    }

    const data = await resp.json();
    const results = (data && data.results) || [];
    // Si por lo que sea el servicio devolviera menos resultados de los
    // pedidos, rellenamos el resto con null en vez de desalinear el array.
    return points.map((_, i) => (results[i] && typeof results[i].elevation === 'number') ? results[i].elevation : null);

  } catch (e) {
    console.error('Error consultando Open-Elevation (lote descartado, se sigue sin altitud para estos puntos)', e.message);
    return points.map(() => null);
  } finally {
    clearTimeout(timeout);
  }
}

// Ejecuta las peticiones por lotes con un límite de concurrencia, para no
// disparar decenas de peticiones a la vez contra un servicio público y
// gratuito (sería mala práctica) ni superar el tiempo límite de la
// función serverless.
async function fetchAllElevations(points) {
  const chunks = [];
  for (let i = 0; i < points.length; i += CHUNK_SIZE) {
    chunks.push(points.slice(i, i + CHUNK_SIZE));
  }

  const results = new Array(chunks.length);
  let next = 0;

  async function worker() {
    while (next < chunks.length) {
      const idx = next++;
      results[idx] = await fetchChunk(chunks[idx]);
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker);
  await Promise.all(workers);

  return results.flat();
}

export default async function handler(req, res) {
  const M = MSGS[pickLang(req)];

  if (req.method !== 'POST') {
    res.status(405).json({ error: M.methodNotAllowed });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  const points = (body && body.points) || [];
  if (!Array.isArray(points) || !points.length) {
    res.status(400).json({ error: M.missingPoints });
    return;
  }
  if (points.length > MAX_POINTS) {
    res.status(400).json({ error: M.tooManyPoints });
    return;
  }

  const cleanPoints = points.map(p => ({ lat: Number(p.lat), lon: Number(p.lon) }));

  try {
    const elevations = await fetchAllElevations(cleanPoints);
    res.status(200).json({ elevations });
  } catch (e) {
    // No debería llegar aquí (fetchChunk ya atrapa sus propios errores),
    // pero por si acaso devolvemos nulls en vez de tumbar la importación.
    console.error('Error inesperado obteniendo altitudes', e);
    res.status(200).json({ elevations: cleanPoints.map(() => null) });
  }
}
