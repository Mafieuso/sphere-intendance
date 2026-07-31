/* Accès MongoDB côté serveur uniquement (chaîne de connexion secrète —
   variable d'env Render, jamais présente dans le dépôt public). C'est le
   SEUL endroit du système qui touche la base désormais. Contrairement à
   Firestore, MongoDB Atlas (tier gratuit M0) n'impose aucun plafond de
   requêtes par jour — seulement des limites de stockage/connexions,
   bien plus difficiles à atteindre pour ce volume d'usage. */
import { MongoClient } from "mongodb";
import { randomUUID } from "crypto";

let client = null;
let dbInstance = null;

export async function getDb(){
  if(dbInstance) return dbInstance;
  const uri = process.env.MONGODB_URI;
  if(!uri){
    throw new Error("MONGODB_URI n'est pas défini (variable d'environnement Render).");
  }
  client = new MongoClient(uri);
  await client.connect();
  dbInstance = client.db();
  return dbInstance;
}

export function newId(){
  return randomUUID();
}
