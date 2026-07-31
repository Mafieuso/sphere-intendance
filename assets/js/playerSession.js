/* Session Joueur — déverrouille sa propre Carte via son PIN personnel
   (distinct du PIN staff), en passant par le serveur (qui vérifie le PIN
   côté Firestore et ne renvoie jamais le PIN d'un autre joueur). */
import { request, setToken, clearToken } from "./api.js";

const KEY = "sphereIntendancePlayer";

export function getPlayerSession(){
  try{ return JSON.parse(localStorage.getItem(KEY)); }catch{ return null; }
}
export function setPlayerSession(card){
  localStorage.setItem(KEY, JSON.stringify({ id: card.id, steamId: card.steamId, playerName: card.playerName }));
  localStorage.removeItem("sphereIntendanceStaff"); // une connexion active exclut l'autre
}
export function clearPlayerSession(){
  localStorage.removeItem(KEY);
  clearToken();
}

export async function unlockCard(steamId, pin){
  const res = await request("card:unlock", { steamId, pin }).catch(() => null);
  if(!res?.ok) return null;
  setToken(res.token);
  setPlayerSession(res.card);
  return res.card;
}

export function requirePlayerCard(){
  const session = getPlayerSession();
  if(!session){
    location.href = "../carte.html";
    return null;
  }
  return session;
}
