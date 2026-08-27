// api/trigger-sync.js — igual que en RunTrack: lanza el workflow de
// GitHub Actions bajo demanda, con el UID de quien pulsa el botón, para
// no tener que esperar a la próxima ejecución programada.
//
// Variables de entorno necesarias en Vercel:
//   FIREBASE_SERVICE_ACCOUNT_JSON, GITHUB_ACTIONS_TOKEN,
//   GITHUB_REPO_OWNER, GITHUB_REPO_NAME

import admin from 'firebase-admin';

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
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido' });
    return;
  }

  if (initError) {
    res.status(500).json({ error: `Configuración del servidor incorrecta: ${initError.message}` });
    return;
  }

  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) {
    res.status(401).json({ error: 'Falta el token de autenticación' });
    return;
  }

  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(idToken);
  } catch (e) {
    res.status(401).json({ error: 'Sesión no válida, vuelve a iniciar sesión' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const days = (body && body.days) ? String(body.days) : '1';

  const owner = process.env.GITHUB_REPO_OWNER;
  const repo = process.env.GITHUB_REPO_NAME;
  const token = process.env.GITHUB_ACTIONS_TOKEN;

  if (!owner || !repo || !token) {
    res.status(500).json({ error: 'Falta configuración del servidor (variables de GitHub en Vercel)' });
    return;
  }

  try {
    const ghResp = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/workflows/intervals-sync.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ref: 'main', inputs: { days, uid: decoded.uid } })
      }
    );

    if (!ghResp.ok) {
      const text = await ghResp.text().catch(() => '');
      console.error('GitHub rechazó la petición', ghResp.status, text);
      res.status(502).json({ error: 'GitHub no aceptó la petición de sincronización' });
      return;
    }

    res.status(200).json({ ok: true, triggeredBy: decoded.uid });

  } catch (e) {
    console.error('Error llamando a la API de GitHub', e);
    res.status(500).json({ error: 'No se pudo contactar con GitHub' });
  }
}
