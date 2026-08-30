// api/osm-search.js — puente hacia Overpass API (OpenStreetMap).
//
// Overpass no permite llamadas directas desde el navegador (bloquea por
// CORS), así que esta función hace la petición desde el servidor —igual
// que ya hacemos con RideWithGPS— y se la devuelve al navegador ya lista.
//
// No necesita ninguna variable de entorno nueva: Overpass es un servicio
// público y gratuito, sin clave de acceso.
//
// Los mensajes de error se devuelven en català o castellà según la
// cabecera X-Lang que manda el cliente (por defecto català).
//
// Búsqueda por nombre (body.name): muchos tramos tienen nombre propio
// (p.ej. "Cinc Cims") pero no son un "lugar" geocodificable por Nominatim
// — por eso el modo normal de "buscar cerca de un sitio" no los encuentra
// si escribes el nombre del tramo ahí. En este modo filtramos por el tag
// "name" de la relación en vez de (o además de) la posición:
//   - Si hay lat/lon, buscamos dentro de un radio más generoso que el
//     pedido (el nombre ya filtra mucho, el radio aquí solo desambigua
//     entre tramos con nombres parecidos en zonas distintas).
//   - Si no hay lat/lon, restringimos a un cuadro amplio alrededor de
//     Catalunya (para no lanzar una búsqueda sin acotar a medio planeta,
//     que en el servidor público de Overpass acabaría en timeout).

const NAME_SEARCH_RADIUS_MULTIPLIER = 5;
const NAME_SEARCH_MAX_RADIUS = 300000; // 300 km, tope para no disparar una consulta enorme
const NAME_SEARCH_MIN_RADIUS = 5000;
const DEFAULT_BBOX = '40.3,-1.5,43.5,4.5'; // Catalunya i voltants (Aragó, Franja, sud de França)

const MSGS = {
  ca: {
    methodNotAllowed: 'Mètode no permès',
    missingPlace: 'Falta el nom del lloc.',
    placeNotFound: 'No s\u2019ha trobat aquest lloc.',
    placeSearchError: 'No s\u2019ha pogut cercar aquest lloc.',
    missingParams: 'Falten paràmetres de cerca.',
    overpassUnrecognized: 'Resposta d\u2019OpenStreetMap no reconeguda.',
    overpassError: 'No s\u2019ha pogut contactar amb OpenStreetMap (pot estar saturat, prova-ho d\u2019aquí un minut).'
  },
  es: {
    methodNotAllowed: 'Método no permitido',
    missingPlace: 'Falta el nombre del lugar.',
    placeNotFound: 'No se ha encontrado ese lugar.',
    placeSearchError: 'No se pudo buscar ese lugar.',
    missingParams: 'Faltan parámetros de búsqueda.',
    overpassUnrecognized: 'Respuesta de OpenStreetMap no reconocida.',
    overpassError: 'No se pudo contactar con OpenStreetMap (puede estar saturado, prueba en un minuto).'
  }
};

function pickLang(req) {
  const l = String(req.headers['x-lang'] || '').toLowerCase();
  return l === 'es' ? 'es' : 'ca';
}

// Escapamos caracteres especiales de regex — el operador "~" de Overpass
// hace match por expresión regular (PCRE), y el nombre lo escribe la
// persona usuaria libremente.
function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

  // Modo 1: buscar coordenadas de un lugar por su nombre (Nominatim)
  if (body && body.action === 'geocode') {
    const place = body.place;
    if (!place) { res.status(400).json({ error: M.missingPlace }); return; }

    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(place)}`;
      const geoResp = await fetch(url, { headers: { 'Accept-Language': 'ca', 'Accept': 'application/json', 'User-Agent': 'Trams-App' } });
      const results = await geoResp.json();
      if (!results.length) { res.status(404).json({ error: M.placeNotFound }); return; }
      res.status(200).json({ lat: parseFloat(results[0].lat), lon: parseFloat(results[0].lon), label: results[0].display_name });
    } catch (e) {
      console.error('Error geocodificando', e);
      res.status(500).json({ error: M.placeSearchError });
    }
    return;
  }

  // Modo 2 (por defecto): buscar rutas/senderos por proximidad y/o por
  // nombre (Overpass).
  const { lat, lon, radius, osmValue, name } = body || {};
  const hasCenter = lat != null && lon != null;

  if (!osmValue) {
    res.status(400).json({ error: M.missingParams });
    return;
  }
  if (!name && (!hasCenter || !radius)) {
    // Sin nombre, necesitamos sí o sí un punto y un radio (búsqueda por
    // cercanía, comportamiento de siempre).
    res.status(400).json({ error: M.missingParams });
    return;
  }

  let areaClause;
  if (name) {
    if (hasCenter) {
      const baseRadius = Math.max(Number(radius) || NAME_SEARCH_MIN_RADIUS, NAME_SEARCH_MIN_RADIUS);
      const searchRadius = Math.min(baseRadius * NAME_SEARCH_RADIUS_MULTIPLIER, NAME_SEARCH_MAX_RADIUS);
      areaClause = `(around:${searchRadius},${lat},${lon})`;
    } else {
      areaClause = `(${DEFAULT_BBOX})`;
    }
  } else {
    areaClause = `(around:${radius},${lat},${lon})`;
  }

  const nameFilter = name ? `["name"~"${escapeRegex(name)}",i]` : '';

  const query = `[out:json][timeout:25];
relation["route"="${osmValue}"]${nameFilter}${areaClause};
out body;
>;
out skel qt;`;

  try {
    const overpassResp = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': '*/*',
        'User-Agent': 'Trams-App (contacto: sin publicar)'
      },
      body: 'data=' + encodeURIComponent(query)
    });

    const text = await overpassResp.text();

    if (!overpassResp.ok) {
      console.error('Overpass rechazó la consulta', overpassResp.status, text.slice(0, 500));
      res.status(overpassResp.status || 502).json({
        error: `OpenStreetMap: ${text.slice(0, 300)}`
      });
      return;
    }

    let data;
    try { data = JSON.parse(text); } catch {
      res.status(502).json({ error: M.overpassUnrecognized });
      return;
    }

    res.status(200).json(data);

  } catch (e) {
    console.error('Error llamando a Overpass', e);
    res.status(500).json({ error: M.overpassError });
  }
}
