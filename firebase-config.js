// firebase-config.js — PENDIENTE DE RELLENAR con las claves de tu proyecto
// de Firebase NUEVO para Trams (distinto del de RunTrack, para no mezclar
// datos de las dos apps).
//
// Cómo conseguirlas:
//   1. https://console.firebase.google.com → Crear proyecto (ej. "trams-app")
//   2. Dentro del proyecto → icono de engranaje ⚙️ → Project settings
//   3. Baja hasta "Your apps" → añade una app Web (</> icono)
//   4. Copia el objeto "firebaseConfig" que te da y pégalo aquí abajo
//   5. Activa Authentication → Sign-in method → Email/Password
//   6. Activa Firestore Database → Create database → modo producción

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "PON_AQUI_TU_API_KEY",
  authDomain: "PON_AQUI_TU_PROYECTO.firebaseapp.com",
  projectId: "PON_AQUI_TU_PROYECTO",
  storageBucket: "PON_AQUI_TU_PROYECTO.appspot.com",
  messagingSenderId: "PON_AQUI_TU_SENDER_ID",
  appId: "PON_AQUI_TU_APP_ID"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
