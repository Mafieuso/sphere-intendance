/* Accès Firestore côté serveur uniquement, via le SDK Admin (clé de service
   secrète — variable d'env Render, jamais présente dans le dépôt public).
   C'est le SEUL endroit du système qui touche Firestore désormais. */
import admin from "firebase-admin";

let app = null;

function init(){
  if(app) return app;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if(!raw){
    throw new Error("FIREBASE_SERVICE_ACCOUNT n'est pas défini (variable d'environnement Render).");
  }
  const serviceAccount = JSON.parse(raw);
  app = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  return app;
}

export function getDb(){
  init();
  return admin.firestore();
}

export const FieldValue = admin.firestore.FieldValue;
export const Timestamp = admin.firestore.Timestamp;
