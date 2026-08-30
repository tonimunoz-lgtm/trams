// db.js — acceso a Firestore. A diferencia de RunTrack, aquí NO hay
// carpetas privadas por usuario: las rutas viven en una única colección
// compartida (routes/), visible para cualquiera con sesión iniciada en
// Trams — es el objetivo del propio proyecto (una base de rutas conjunta,
// como Wikiloc). Solo quien subió una ruta puede editarla o borrarla.

import { db, auth } from './firebase-config.js';
import {
  collection, doc, setDoc, getDoc, getDocs, deleteDoc,
  query, where, orderBy, limit, serverTimestamp, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const { t } = window.I18n;

function uid() {
  if (!auth.currentUser) throw new Error(t('auth.notLoggedIn'));
  return auth.currentUser.uid;
}

function displayName() {
  return (auth.currentUser && auth.currentUser.displayName) || t('auth.defaultName');
}

function routesCol() {
  return collection(db, 'routes');
}

async function saveRoute(route) {
  const ref = doc(routesCol());
  const payload = {
    ...route,
    id: ref.id,
    createdBy: uid(),
    createdByName: displayName(),
    createdAt: serverTimestamp()
  };
  await setDoc(ref, payload);
  return payload;
}

async function getRoute(id) {
  const snap = await getDoc(doc(db, 'routes', id));
  return snap.exists() ? snap.data() : null;
}

async function listRecentRoutes(count = 30) {
  const q = query(routesCol(), orderBy('createdAt', 'desc'), limit(count));
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data());
}

// Filtro por tipo de actividad en el propio servidor (rápido, con índice);
// el filtro por texto del nombre se hace en el cliente, después — no hay
// búsqueda de texto completo nativa en Firestore, y para el volumen de
// rutas que va a tener esto (tú y tus amigos, no millones de Wikiloc)
// filtrar en el cliente es más que suficiente.
async function listRoutes({ activityType = null, count = 100 } = {}) {
  let q;
  if (activityType && activityType !== 'all') {
    // Sin "orderBy" aquí a propósito: combinar "where" + "orderBy" en
    // campos distintos exige crear un índice compuesto en Firestore, y
    // si nadie lo ha creado a mano, la consulta falla en silencio y no
    // devuelve nada — por eso "Todos" funcionaba pero un tipo concreto
    // no. Pedimos solo el filtro, y ordenamos por fecha aquí mismo, en
    // el propio código, evitando depender de que exista ese índice.
    q = query(routesCol(), where('activityType', '==', activityType), limit(count));
  } else {
    q = query(routesCol(), orderBy('createdAt', 'desc'), limit(count));
  }
  const snap = await getDocs(q);
  const routes = snap.docs.map(d => d.data());

  if (activityType && activityType !== 'all') {
    routes.sort((a, b) => {
      const ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
      const tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
      return tb - ta;
    });
  }

  return routes;
}

async function updateRoute(id, changes) {
  const allowed = ['name', 'description', 'activityType', 'rideWithGpsUrl'];
  const payload = {};
  for (const key of allowed) {
    if (changes[key] !== undefined) payload[key] = changes[key];
  }
  await setDoc(doc(db, 'routes', id), payload, { merge: true });
}

async function deleteRoute(id) {
  // Limpiamos también las fotos y comentarios de esta ruta, para no
  // dejar nada huérfano en Firestore (igual que ya hicimos en RunTrack).
  const [photosSnap, commentsSnap] = await Promise.all([
    getDocs(photosCol(id)).catch(() => ({ docs: [] })),
    getDocs(commentsCol(id)).catch(() => ({ docs: [] }))
  ]);
  await Promise.all([
    ...photosSnap.docs.map(d => deleteDoc(d.ref).catch(() => {})),
    ...commentsSnap.docs.map(d => deleteDoc(d.ref).catch(() => {}))
  ]);
  await deleteDoc(doc(db, 'routes', id));
}

// ============================================================
// FOTOS de una ruta — subcolección aparte (como en RunTrack), para no
// arriesgarnos a superar el límite de tamaño del documento de la ruta.
// ============================================================

function photosCol(routeId) {
  return collection(db, 'routes', routeId, 'photos');
}

async function addPhoto(routeId, dataUrl) {
  const ref = doc(photosCol(routeId));
  const payload = {
    id: ref.id, dataUrl,
    uploadedBy: uid(),
    uploadedByName: displayName(),
    createdAt: serverTimestamp()
  };
  await setDoc(ref, payload);
  return payload;
}

async function listPhotos(routeId) {
  const snap = await getDocs(photosCol(routeId));
  return snap.docs.map(d => d.data());
}

async function deletePhoto(routeId, photoId) {
  await deleteDoc(doc(photosCol(routeId), photoId));
}

// ============================================================
// COMENTARIOS — cualquiera con cuenta en Trams puede comentar
// cualquier ruta (es una comunidad compartida, no hay concepto de
// "amigos" aquí); solo el autor puede borrar el suyo.
// ============================================================

function commentsCol(routeId) {
  return collection(db, 'routes', routeId, 'comments');
}

async function addComment(routeId, text) {
  const trimmed = (text || '').trim();
  if (!trimmed) throw new Error(t('comments.postError'));
  const ref = doc(commentsCol(routeId));
  const payload = {
    id: ref.id, uid: uid(),
    userName: displayName(),
    text: trimmed.slice(0, 500),
    createdAt: serverTimestamp()
  };
  await setDoc(ref, payload);
  return payload;
}

async function listComments(routeId) {
  const q = query(commentsCol(routeId), orderBy('createdAt', 'asc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data());
}

async function deleteComment(routeId, commentId) {
  await deleteDoc(doc(commentsCol(routeId), commentId));
}

// ============================================================
// FAVORITOS — lista personal, privada, dentro de tu propia carpeta.
// ============================================================

function favoritesCol() {
  return collection(db, 'users', uid(), 'favorites');
}

async function addFavorite(route) {
  await setDoc(doc(favoritesCol(), route.id), {
    routeId: route.id, routeName: route.name, addedAt: serverTimestamp()
  });
}

async function removeFavorite(routeId) {
  await deleteDoc(doc(favoritesCol(), routeId));
}

async function isFavorite(routeId) {
  const snap = await getDoc(doc(favoritesCol(), routeId));
  return snap.exists();
}

async function listFavoriteIds() {
  const snap = await getDocs(favoritesCol());
  return snap.docs.map(d => d.id);
}

// ============================================================
// LIVE TRACKING — un enlace compartible, viable sin cuenta en Trams
// (como compartir ubicación por WhatsApp). Cualquiera con el enlace ve
// tu posición en el mapa; solo tú puedes actualizarla o pararla.
// ============================================================

function liveTrackingDoc(sessionId) {
  return doc(db, 'liveTracking', sessionId);
}

async function startLiveTracking(routeName) {
  const ref = doc(collection(db, 'liveTracking'));
  await setDoc(ref, {
    id: ref.id,
    uid: uid(),
    userName: displayName(),
    routeName: routeName || t('record.liveDefaultName'),
    active: true,
    lat: null, lon: null,
    startedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return ref.id;
}

async function updateLiveTracking(sessionId, { lat, lon }) {
  await setDoc(liveTrackingDoc(sessionId), {
    lat, lon, updatedAt: serverTimestamp()
  }, { merge: true });
}

async function stopLiveTracking(sessionId) {
  await setDoc(liveTrackingDoc(sessionId), {
    active: false, updatedAt: serverTimestamp()
  }, { merge: true });
}

function watchLiveTracking(sessionId, callback) {
  return onSnapshot(liveTrackingDoc(sessionId), (snap) => {
    callback(snap.exists() ? snap.data() : null);
  });
}

// ============================================================
// INTEGRACIÓN GARMIN/INTERVALS.ICU — cada usuario guarda su propia clave,
// dentro de su carpeta privada.
// ============================================================

function integrationsCol(targetUid) {
  return collection(db, 'users', targetUid, 'integrations');
}

async function saveGarminIntegration({ intervalsApiKey, intervalsAthleteId }) {
  await setDoc(doc(integrationsCol(uid()), 'garmin'), {
    source: 'garmin',
    intervalsApiKey,
    intervalsAthleteId: intervalsAthleteId || '0',
    updatedAt: serverTimestamp()
  });
}

async function getGarminIntegration() {
  const snap = await getDoc(doc(integrationsCol(uid()), 'garmin'));
  return snap.exists() ? snap.data() : null;
}

async function deleteGarminIntegration() {
  await deleteDoc(doc(integrationsCol(uid()), 'garmin'));
}

async function saveRideWithGPSIntegration({ authToken, rwgpsUserId }) {
  if (!authToken) throw new Error('RideWithGPS no devolvió un token de acceso.');
  await setDoc(doc(integrationsCol(uid()), 'ridewithgps'), {
    source: 'ridewithgps',
    authToken,
    // Firestore no admite "undefined" — si RideWithGPS no devuelve un id
    // de usuario (no lo necesitamos para nada, solo el token), lo dejamos
    // en null en vez de dejar que rompa el guardado.
    rwgpsUserId: rwgpsUserId != null ? rwgpsUserId : null,
    updatedAt: serverTimestamp()
  });
}

async function getRideWithGPSIntegration() {
  const snap = await getDoc(doc(integrationsCol(uid()), 'ridewithgps'));
  return snap.exists() ? snap.data() : null;
}

export const DB = {
  saveRoute, getRoute, listRecentRoutes, listRoutes, updateRoute, deleteRoute,
  addPhoto, listPhotos, deletePhoto,
  addComment, listComments, deleteComment,
  addFavorite, removeFavorite, isFavorite, listFavoriteIds,
  saveGarminIntegration, getGarminIntegration, deleteGarminIntegration,
  saveRideWithGPSIntegration, getRideWithGPSIntegration,
  startLiveTracking, updateLiveTracking, stopLiveTracking, watchLiveTracking
};
