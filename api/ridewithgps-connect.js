// api/ridewithgps-connect.js — recibe el email/contraseña de RideWithGPS
// del usuario UNA SOLA VEZ, los intercambia por un token de autenticación
// (usando nuestra propia clave de app), y devuelve ese token para que el
// cliente lo guarde — la contraseña NUNCA se guarda en ningún sitio,
// solo se usa de paso, en este único intercambio.
//
// Variables de entorno necesarias en Vercel:
//   FIREBASE_SERVICE_ACCOUNT_JSON (para verificar que quien llama está
//     logueado en Trams — igual que en trigger-sync.js)
//   RIDEWITHGPS_API_KEY (la clave de NUESTRA app, la creas tú en
//     ridewithgps.com/api/api_clients)
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
    missingCredentials: 'Falta l\u2019email o la contrasenya de RideWithGPS',
    missingApiKey: 'Falta RIDEWITHGPS_API_KEY a les variables d\u2019entorn de Vercel',
    rwgpsRejected: (text) => `RideWithGPS ha respost: ${text}`,
    noToken: (text) => `RideWithGPS no ha tornat cap token. Resposta: ${text}`,
    contactError: 'No s\u2019ha pogut contactar amb RideWithGPS'
  },
  es: {
    methodNotAllowed: 'Método no permitido',
    badServerConfig: (msg) => `Configuración del servidor incorrecta: ${msg}`,
    missingToken: 'Falta el token de autenticación',
    invalidSession: 'Sesión no válida, vuelve a iniciar sesión',
    missingCredentials: 'Falta email o contraseña de RideWithGPS',
    missingApiKey: 'Falta RIDEWITHGPS_API_KEY en las variables de entorno de Vercel',
    rwgpsRejected: (text) => `RideWithGPS respondió: ${text}`,
    noToken: (text) => `RideWithGPS no devolvió un token. Respuesta: ${text}`,
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
  try {
    await admin.auth().verifyIdToken(idToken);
  } catch (e) {
    res.status(401).json({ error: M.invalidSession });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const { email, password } = body || {};
  if (!email || !password) {
    res.status(400).json({ error: M.missingCredentials });
    return;
  }

  const apiKey = process.env.RIDEWITHGPS_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: M.missingApiKey });
    return;
  }

  try {
    // Reforzamos: mandamos la clave tanto en la URL como en el cuerpo de la
    // petición, para cubrir las dos convenciones más habituales sin tener
    // que adivinar cuál usa exactamente RideWithGPS en este endpoint.
    const url = `https://ridewithgps.com/api/v1/auth_tokens.json?apikey=${encodeURIComponent(apiKey)}`;
    const rwResp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-rwgps-api-key': apiKey
      },
      body: JSON.stringify({
        apikey: apiKey, api_key: apiKey,
        user: { email, password },
        email, password
      })
    });

    const text = await rwResp.text();
    let data;
    try { data = JSON.parse(text); } catch { data = null; }

    if (!rwResp.ok || !data) {
      // Le devolvemos el texto real de RideWithGPS, no un mensaje inventado
      // — así, si el formato esperado no era exactamente este, se ve el
      // error real y se puede corregir con precisión.
      console.error('RideWithGPS rechazó la autenticación', rwResp.status, text);
      res.status(rwResp.status || 502).json({
        error: M.rwgpsRejected(text.slice(0, 300))
      });
      return;
    }

    console.log('Respuesta completa de RideWithGPS al conectar:', text);

    // El token de verdad viene un nivel más adentro de lo que parecía a
    // simple vista: { auth_token: { auth_token: "...", user: {...} } }
    const authTokenObj = data.auth_token;
    const authToken = authTokenObj && authTokenObj.auth_token;
    const userId = authTokenObj && authTokenObj.user && authTokenObj.user.id;
    const displayName = authTokenObj && authTokenObj.user && authTokenObj.user.name;

    if (!authToken) {
      res.status(502).json({ error: M.noToken(text.slice(0, 300)) });
      return;
    }

    res.status(200).json({ ok: true, authToken: String(authToken), userId, displayName });

  } catch (e) {
    console.error('Error llamando a RideWithGPS', e);
    res.status(500).json({ error: M.contactError });
  }
}
