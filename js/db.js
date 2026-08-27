// db.js — acceso a Firestore. A diferencia de RunTrack, aquí NO hay
// carpetas privadas por usuario: las rutas viven en una única colección
// compartida (routes/), visible para cualquiera con sesión iniciada en
// Trams — es el objetivo del propio proyecto (una base de rutas conjunta,
// como Wikiloc). Solo quien subió una ruta puede editarla o borrarla.

import { db, auth } from './firebase-config.js';
import {
  collection, doc, setDoc, getDoc, getDocs, deleteDoc,
  query, where, orderBy, limit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

function uid() {
  if (!auth.currentUser) throw new Error('No hay sesión iniciada.');
  return auth.currentUser.uid;
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
    createdByName: (auth.currentUser && auth.currentUser.displayName) || 'Alguien',
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
    q = query(routesCol(), where('activityType', '==', activityType), orderBy('createdAt', 'desc'), limit(count));
  } else {
    q = query(routesCol(), orderBy('createdAt', 'desc'), limit(count));
  }
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data());
}

async function deleteRoute(id) {
  await deleteDoc(doc(db, 'routes', id));
}

export const DB = { saveRoute, getRoute, listRecentRoutes, listRoutes, deleteRoute };
