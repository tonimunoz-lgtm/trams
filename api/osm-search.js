// api/osm-search.js — puente hacia Overpass API (OpenStreetMap).
//
// Overpass no permite llamadas directas desde el navegador (bloquea por
// CORS), así que esta función hace la petición desde el servidor —igual
// que ya hacemos con RideWithGPS— y se la devuelve al navegador ya lista.
//
// No necesita ninguna variable de entorno nueva: Overpass es un servicio
// público y gratuito, sin clave de acceso.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  // Modo 1: buscar coordenadas de un lugar por su nombre (Nominatim)
  if (body && body.action === 'geocode') {
    const place = body.place;
    if (!place) { res.status(400).json({ error: 'Falta el nombre del lugar.' }); return; }

    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(place)}`;
      const geoResp = await fetch(url, { headers: { 'Accept-Language': 'es', 'User-Agent': 'Trams-App' } });
      const results = await geoResp.json();
      if (!results.length) { res.status(404).json({ error: 'No se ha encontrado ese lugar.' }); return; }
      res.status(200).json({ lat: parseFloat(results[0].lat), lon: parseFloat(results[0].lon), label: results[0].display_name });
    } catch (e) {
      console.error('Error geocodificando', e);
      res.status(500).json({ error: 'No se pudo buscar ese lugar.' });
    }
    return;
  }

  // Modo 2 (por defecto): buscar rutas/senderos cerca de un punto (Overpass)
  const { lat, lon, radius, osmValue } = body || {};
  if (lat == null || lon == null || !radius || !osmValue) {
    res.status(400).json({ error: 'Faltan parámetros de búsqueda.' });
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
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query)
    });

    const text = await overpassResp.text();

    if (!overpassResp.ok) {
      console.error('Overpass rechazó la consulta', overpassResp.status, text.slice(0, 500));
      res.status(overpassResp.status || 502).json({
        error: `OpenStreetMap respondió: ${text.slice(0, 300)}`
      });
      return;
    }

    let data;
    try { data = JSON.parse(text); } catch {
      res.status(502).json({ error: 'Respuesta de OpenStreetMap no reconocida.' });
      return;
    }

    res.status(200).json(data);

  } catch (e) {
    console.error('Error llamando a Overpass', e);
    res.status(500).json({ error: 'No se pudo contactar con OpenStreetMap (puede estar saturado, prueba en un minuto).' });
  }
}
