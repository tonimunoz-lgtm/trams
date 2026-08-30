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
// DOS MODOS, que no se mezclan:
//   - Por proximidad (sin "name" en el body): el radio es un radio de
//     verdad, filtro "around" de Overpass alrededor del punto — tal cual
//     lo pide la persona usuaria. No hay ningún descarte por longitud del
//     tramo aquí; eso se gestiona en el cliente como orden, no como filtro.
//   - Por nombre (con "name"): IGNORAMOS lat/lon/radius por completo para
//     la consulta — aunque el cliente los mande (los usa solo para
//     ordenar resultados por distancia, no para restringir la búsqueda).
//     Usamos siempre DEFAULT_BBOX como área de búsqueda, porque una
//     consulta por nombre sin ningún límite geográfico en el servidor
//     público de Overpass es demasiado pesada (riesgo real de timeout).

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

// Construye un patrón de regex "difuso" a partir del texto que escribe la
// persona usuaria: insensible a mayúsculas (vía flag "i" en Overpass),
// a espacios repetidos/distintos (\s+ entre palabras) y a acentos —
// sustituyendo cada vocal (y "c"/"n") por una clase de caracteres con
// sus variantes acentuadas más comunes en català/castellà/francès. Así
// "Cinc Cims", "cinc  cims" o "cïnc cims" encuentran lo mismo.
const ACCENT_CLASSES = {
  a: '[aàáâä]', e: '[eèéêë]', i: '[iìíîï]', o: '[oòóôö]', u: '[uùúûü]',
  c: '[cç]', n: '[nñ]'
};

function buildFuzzyNamePattern(raw) {
  const words = String(raw).trim().toLowerCase().split(/\s+/).filter(Boolean);
  const wordPatterns = words.map(word => {
    let pattern = '';
    for (const ch of word) {
      if (/[.*+?^${}()|[\]\\]/.test(ch)) pattern += '\\' + ch;
      else if (ACCENT_CLASSES[ch]) pattern += ACCENT_CLASSES[ch];
      else pattern += ch;
    }
    return pattern;
  });
  return wordPatterns.join('\\s+');
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

  // Modo 2 (por defecto): buscar rutas/senderos por proximidad o por
  // nombre (Overpass) — ver nota de cabecera, no se combinan.
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

  // Por nombre: SIEMPRE la zona por defecto, ignorando lat/lon/radius
  // aunque vengan en el body (el cliente los manda solo para ordenar).
  // Por proximidad: el radio real pedido, sin más.
  const areaClause = name ? `(${DEFAULT_BBOX})` : `(around:${radius},${lat},${lon})`;
  const nameFilter = name ? `["name"~"${buildFuzzyNamePattern(name)}",i]` : '';

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
