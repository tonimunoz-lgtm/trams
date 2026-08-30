// api/send-to-ridewithgps.js — envía una ruta de Trams a la cuenta de
// RideWithGPS del usuario, usando el token que guardó al conectar su
// cuenta. Desde ahí, si tiene la sincronización con Garmin activada (algo
// que configura él mismo, una vez, en la propia web de RideWithGPS), le
// llega sola al reloj.
//
// AVISO para quien mantenga este código: el nombre exacto de los campos
// para crear una ruta (route[track_points][][x]/[y]/[e]) es nuestra mejor
// estimación razonada a partir de la documentación pública de RideWithGPS
// (que menciona explícitamente "coordinates x and y" para sus track
// points) — no pudimos verificarlo en una prueba real antes de entregarlo.
// Si falla, el error de RideWithGPS se devuelve tal cual, sin inventar
// nada, para poder corregirlo con precisión a partir del mensaje real.
//
// Variables de entorno necesarias en Vercel:
//   FIREBASE_SERVICE_ACCOUNT_JSON
//   RIDEWITHGPS_API_KEY
//
// Los mensajes de error se devuelven en català o castellà según la
// cabecera X-Lang que manda el cliente (por defecto català).

import admin from 'firebase-admin';

const MSGS = {
  ca: {
    methodNotAllowed: 'Mètode no permès',
    badServerConfig: (msg) => `Configuració del servidor incorrecta: ${msg}`,
    missingToken: 'Falta el token d\u2019autenticació',
    invalidSession: 'Sessió no vàlida, torna a iniciar sessió',
    missingRouteId: 'Falta l\u2019id de la ruta',
    missingApiKey: 'Falta RIDEWITHGPS_API_KEY a les variables d\u2019entorn de Vercel',
    connectFirst: 'Primer has de connectar el teu compte de RideWithGPS.',
    routeNotFound: 'Ruta no trobada',
    notEnoughPoints: 'Aquesta ruta no té prou punts.',
    rwgpsRejected: (text, apiLen, tokLen) => `RideWithGPS ha respost: ${text} (diagnòstic: apiKey=${apiLen} car., token=${tokLen} car.)`,
    contactError: 'No s\u2019ha pogut contactar amb RideWithGPS'
  },
  es: {
    methodNotAllowed: 'Método no permitido',
    badServerConfig: (msg) => `Configuración del servidor incorrecta: ${msg}`,
    missingToken: 'Falta el token de autenticación',
    invalidSession: 'Sesión no válida, vuelve a iniciar sesión',
    missingRouteId: 'Falta el id de la ruta',
    missingApiKey: 'Falta RIDEWITHGPS_API_KEY en las variables de entorno de Vercel',
    connectFirst: 'Primero tienes que conectar tu cuenta de RideWithGPS.',
    routeNotFound: 'Ruta no encontrada',
    notEnoughPoints: 'Esta ruta no tiene suficientes puntos.',
    rwgpsRejected: (text, apiLen, tokLen) => `RideWithGPS respondió: ${text} (diagnóstico: apiKey=${apiLen} car., token=${tokLen} car.)`,
    contactError: 'No se pudo contactar con RideWithGPS'
  }
};

function pickLang(req) {
  const l = String(req.headers['x-lang'] || '').toLowerCase();
  return l === 'es' ? 'es' : 'ca';
}

let initError = null;
if (!admin.apps.length) {
  try {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON no está definida en Vercel');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  } catch (e) {
    initError = e;
    console.error('No se pudo inicializar firebase-admin:', e.message);
  }
}

export default async function handler(req, res) {
  const M = MSGS[pickLang(req)];

  if (req.method !== 'POST') {
    res.status(405).json({ error: M.methodNotAllowed });
    return;
  }
  if (initError) {
    res.status(500).json({ error: M.badServerConfig(initError.message) });
    return;
  }

  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) {
    res.status(401).json({ error: M.missingToken });
    return;
  }

  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(idToken);
  } catch (e) {
    res.status(401).json({ error: M.invalidSession });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const { routeId } = body || {};
  if (!routeId) {
    res.status(400).json({ error: M.missingRouteId });
    return;
  }

  const apiKey = process.env.RIDEWITHGPS_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: M.missingApiKey });
    return;
  }

  const db = admin.firestore();

  // 1. Leemos el token de RideWithGPS del usuario, guardado al conectar su cuenta.
  const integrationDoc = await db.collection('users').doc(decoded.uid)
    .collection('integrations').doc('ridewithgps').get();

  if (!integrationDoc.exists || !integrationDoc.data().authToken) {
    res.status(400).json({ error: M.connectFirst });
    return;
  }
  const rwToken = integrationDoc.data().authToken;

  // 2. Leemos la ruta.
  const routeDoc = await db.collection('routes').doc(routeId).get();
  if (!routeDoc.exists) {
    res.status(404).json({ error: M.routeNotFound });
    return;
  }
  const route = routeDoc.data();
  const points = route.points || [];
  if (points.length < 2) {
    res.status(400).json({ error: M.notEnoughPoints });
    return;
  }

  // 3. La empujamos a RideWithGPS (endpoint "legacy", sin prefijo /api/v1/
  // — su propia documentación confirma que crear rutas todavía no está
  // disponible en v1, solo lectura/borrado).
  try {
    // Diagnóstico seguro: solo la LONGITUD de las credenciales, nunca el
    // valor — así, si algo llega vacío o cortado, se ve en los logs de
    // Vercel sin exponer ningún secreto.
    console.log('Enviando a RideWithGPS. Longitud apiKey:', apiKey.length, 'Longitud rwToken:', rwToken.length);

    const basicAuth = Buffer.from(`${apiKey}:${rwToken}`).toString('base64');

    const url = `https://ridewithgps.com/routes.json?apikey=${encodeURIComponent(apiKey)}&auth_token=${encodeURIComponent(rwToken)}&version=2`;
    const rwResp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-rwgps-api-key': apiKey,
        'x-rwgps-auth-token': rwToken,
        'Authorization': `Basic ${basicAuth}`
      },
      body: JSON.stringify({
        apikey: apiKey, api_key: apiKey, auth_token: rwToken,
        route: {
          name: route.name || 'Ruta de Trams',
          description: route.description || 'Importada des de Trams',
          track_points: points.map(p => ({
            x: p.lon, y: p.lat,
            e: p.ele != null ? p.ele : 0
          }))
        }
      })
    });

    const text = await rwResp.text();
    let data;
    try { data = JSON.parse(text); } catch { data = null; }

    if (!rwResp.ok) {
      console.error('RideWithGPS rechazó la creación de la ruta', rwResp.status, text);
      res.status(rwResp.status || 502).json({
        error: M.rwgpsRejected(text.slice(0, 400), apiKey.length, rwToken.length)
      });
      return;
    }

    console.log('Respuesta completa de RideWithGPS al crear la ruta:', text);

    // Comprobamos varias formas posibles de encontrar el id — ya hemos
    // visto que RideWithGPS anida las cosas un nivel más de lo esperado
    // en otros endpoints, así que cubrimos varias posibilidades.
    const rideWithGpsRouteId = (data && data.route && data.route.id) || (data && data.id) || null;
    const routeUrl = rideWithGpsRouteId ? `https://ridewithgps.com/routes/${rideWithGpsRouteId}` : null;

    res.status(200).json({ ok: true, rideWithGpsRoute: data, routeUrl });

  } catch (e) {
    console.error('Error llamando a RideWithGPS', e);
    res.status(500).json({ error: M.contactError });
  }
}
