/* Cartes Joueur (wallet de tokens) — passe désormais par le serveur Node.js
   (assets/js/api.js), qui applique toutes les vérifications de rôle et
   d'atomicité avant de toucher Firestore. Le navigateur ne peut plus
   modifier un solde directement. */
import { request } from "./api.js";

export const EXPIRATION_MS = 24 * 60 * 60 * 1000;

export function isExpired(card){
  if(!card || !card.lastTransactionAt) return false;
  return (Date.now() - card.lastTransactionAt) > EXPIRATION_MS;
}

export function msUntilExpiration(card){
  if(!card || !card.lastTransactionAt) return EXPIRATION_MS;
  return Math.max(0, EXPIRATION_MS - (Date.now() - card.lastTransactionAt));
}

export function isSuspended(card){
  return card?.status === "suspended";
}

export async function setCardSuspended(cardId, suspended){
  await request("card:suspend", { cardId, suspend: suspended });
}

export async function findCardBySteamId(steamId){
  const res = await request("card:find", { steamId });
  return res.card;
}

export async function getCard(cardId){
  const res = await request("card:get", { cardId });
  return res.card;
}

export async function listAllCards(){
  const res = await request("cards:list:subscribe");
  return res.cards;
}

export async function createCard({ steamId, playerName }){
  const res = await request("card:create", { steamId, playerName });
  return { id: res.cardId, pin: res.pin };
}

/* Dépôt (amount positif) ou retrait (amount négatif) par l'Hôte/l'Admin.
   Les jeux ne passent PAS par cette fonction : chacun a son propre appel
   serveur dédié (game:xxx:play, table:xxx:bet...) qui calcule lui-même le
   montant côté serveur — jamais fourni par le navigateur. */
export async function adjustBalance({ cardId, amount, note }){
  const event = amount >= 0 ? "card:deposit" : "card:withdraw";
  const res = await request(event, { cardId, amount: Math.abs(amount), note });
  return res.balanceAfter;
}

export async function cardTransactions(cardId, max = 30){
  const res = await request("card:transactions", { cardId, max });
  return res.transactions;
}

export async function totalTokensInCirculation(){
  const cards = await listAllCards();
  return cards.reduce((sum, c) => sum + (isExpired(c) ? 0 : (c.balance || 0)), 0);
}

export async function casinoProfitTokens(){
  const res = await request("profit:subscribe");
  return res.profitTokens;
}

export async function deleteCard(cardId){
  await request("card:delete", { cardId });
}
