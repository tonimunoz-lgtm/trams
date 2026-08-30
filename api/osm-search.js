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

  // Modo 2 (por defecto): buscar rutas/senderos cerca de un punto (Overpass)
  const { lat, lon, radius, osmValue } = body || {};
  if (lat == null || lon == null || !radius || !osmValue) {
    res.status(400).json({ error: M.missingParams });
    return;
  }

  const query = `[out:json][timeout:25];
relation["route"="${osmValue}"](around:${radius},${lat},${lon});
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
