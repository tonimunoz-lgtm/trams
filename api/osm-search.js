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
//     lo pide la persona usuaria. Una sola consulta, con geometría.
//   - Por nombre (con "name"): IGNORAMOS lat/lon/radius por completo para
//     la búsqueda — solo se usan en el cliente para ordenar por distancia.
//
//     OJO — por qué en DOS PASOS: al principio construíamos un regex
//     "difuso" (con clases de caracteres para cada vocal acentuada) y se
//     lo pasábamos directamente al operador "~" de Overpass. Resultó que
//     el motor de regex del servidor público de Overpass no gestiona bien
//     esas clases de caracteres acentuados — por eso "Camí dels Monjos"
//     no aparecía buscando "cami dels monjos" aunque el tramo existe (se
//     veía perfectamente buscando por ubicación, con el mismo filtro de
//     tipo de ruta). En vez de depender de las rarezas del regex remoto,
//     ahora la comparación aproximada (sin acentos, sin mayúsculas, sin
//     espacios de más) la hacemos aquí mismo en JavaScript, con
//     normalización Unicode de verdad:
//       1. Pedimos a Overpass SOLO las etiquetas (sin geometría) de todas
//          las rutas con nombre en la zona — respuesta ligera.
//       2. Filtramos en el propio servidor con normalizeText(), que
//          compara ignorando acentos/mayúsculas/espacios de verdad.
//       3. Solo entonces pedimos la geometría completa de los tramos que
//          de verdad han hecho match (por id), no de todos.

const DEFAULT_BBOX = '40.3,-1.5,43.5,4.5'; // Catalunya i voltants (Aragó, Franja, sud de França)
const MAX_NAME_MATCHES = 30; // tope de resultados a los que pedimos geometría

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

// Normaliza texto para comparar "a lo aproximado": minúsculas, sin
// acentos/diacríticos (vía descomposición Unicode NFD + quitar las
// marcas combinadas), y espacios repetidos colapsados. Esto es JS
// estándar de verdad, no un regex hecho a mano — por eso es fiable.
function normalizeText(str) {
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

async function overpassFetch(query) {
  const resp = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': '*/*',
      'User-Agent': 'Trams-App (contacto: sin publicar)'
    },
    body: 'data=' + encodeURIComponent(query)
  });
  const text = await resp.text();
  if (!resp.ok) {
    const err = new Error(`OpenStreetMap: ${text.slice(0, 300)}`);
    err.httpStatus = resp.status;
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch {
    const err = new Error('unrecognized');
    err.unrecognized = true;
    throw err;
  }
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

  try {
    if (name) {
      // Paso 1: solo etiquetas (sin geometría) de todas las rutas CON
      // NOMBRE de este tipo en la zona por defecto — respuesta ligera.
      const tagsQuery = `[out:json][timeout:25];
relation["route"="${osmValue}"]["name"](${DEFAULT_BBOX});
out tags;`;

      const tagsData = await overpassFetch(tagsQuery);

      // Paso 2: comparación aproximada de verdad, en JS.
      const target = normalizeText(name);
      const matchedIds = (tagsData.elements || [])
        .filter(el => el.type === 'relation' && el.tags && el.tags.name && normalizeText(el.tags.name).includes(target))
        .map(el => el.id)
        .slice(0, MAX_NAME_MATCHES);

      if (!matchedIds.length) {
        res.status(200).json({ elements: [] });
        return;
      }

      // Paso 3: geometría completa, solo de los que han hecho match.
      const geomQuery = `[out:json][timeout:25];
relation(id:${matchedIds.join(',')});
out body;
>;
out skel qt;`;

      const geomData = await overpassFetch(geomQuery);
      res.status(200).json(geomData);
      return;
    }

    // Búsqueda por proximidad: una sola consulta con geometría directa.
    const query = `[out:json][timeout:25];
relation["route"="${osmValue}"](around:${radius},${lat},${lon});
out body;
>;
out skel qt;`;

    const data = await overpassFetch(query);
    res.status(200).json(data);

  } catch (e) {
    if (e.unrecognized) {
      res.status(502).json({ error: M.overpassUnrecognized });
    } else if (e.httpStatus) {
      console.error('Overpass rechazó la consulta', e.httpStatus, e.message);
      res.status(e.httpStatus).json({ error: e.message });
    } else {
      console.error('Error llamando a Overpass', e);
      res.status(500).json({ error: M.overpassError });
    }
  }
}
