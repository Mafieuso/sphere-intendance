/* Session Joueur — déverrouille sa propre Carte via son PIN personnel
   (distinct du PIN staff). Permet de jouer aux jeux solo sans compte complet. */
import { findCardBySteamId } from "./cards.js";

const KEY = "sphereIntendancePlayer";

export function getPlayerSession(){
  try{ return JSON.parse(localStorage.getItem(KEY)); }catch{ return null; }
}
export function setPlayerSession(card){
  localStorage.setItem(KEY, JSON.stringify({ id: card.id, steamId: card.steamId, playerName: card.playerName }));
}
export function clearPlayerSession(){
  localStorage.removeItem(KEY);
}

export async function unlockCard(steamId, pin){
  const card = await findCardBySteamId(steamId);
  if(!card || card.pin !== pin.trim().toUpperCase()) return null;
  setPlayerSession(card);
  return card;
}

export function requirePlayerCard(){
  const session = getPlayerSession();
  if(!session){
    location.href = "../carte.html";
    return null;
  }
  return session;
}
