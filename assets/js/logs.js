/* Journal d'audit partagé — chaque action (dépôt, retrait, mise, gain, perte,
   création de carte, connexion staff...) est tracée avec horodatage, Steam ID
   et identité du membre du staff responsable. Utilisé par l'admin pour le
   reporting de rentabilité de l'Intendance. */
import { db, collection, addDoc, serverTimestamp } from "./firebase-init.js";

export async function logAction({ action, detail, steamId, playerName, staffId, staffName, amount, gameId }){
  try{
    await addDoc(collection(db, "logs"), {
      action, detail: detail || "", steamId: steamId || null, playerName: playerName || null,
      staffId: staffId || null, staffName: staffName || null,
      amount: typeof amount === "number" ? amount : null,
      gameId: gameId || null, createdAt: serverTimestamp()
    });
  }catch(e){
    console.error("logAction a échoué :", e);
  }
}
