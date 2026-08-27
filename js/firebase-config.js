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
  apiKey: "AIzaSyBRfcukKqgnr69Fs-AiYzAm7Ehv7H9QnxI",
  authDomain: "nadalquiz2025.firebaseapp.com",
  projectId: "nadalquiz2025",
  storageBucket: "nadalquiz2025.firebasestorage.app",
  messagingSenderId: "563642099266",
  appId: "1:563642099266:web:a959c08efe3ea0709dafdb"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
