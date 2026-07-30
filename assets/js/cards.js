/* Cartes Joueur (wallet de tokens) — création, dépôt/retrait, historique,
   et règle d'expiration : une carte sans dépôt/retrait depuis 24h est
   considérée expirée (calcul côté client à partir de lastTransactionAt,
   pas besoin de fonction planifiée côté serveur). */
import {
  db, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, query, where,
  orderBy, limit, runTransaction, serverTimestamp, increment
} from "./firebase-init.js";
import { logAction } from "./logs.js";

export const EXPIRATION_MS = 24 * 60 * 60 * 1000;

export function isExpired(card){
  if(!card || !card.lastTransactionAt) return false;
  const last = card.lastTransactionAt.toMillis ? card.lastTransactionAt.toMillis() : card.lastTransactionAt;
  return (Date.now() - last) > EXPIRATION_MS;
}

export function msUntilExpiration(card){
  if(!card || !card.lastTransactionAt) return EXPIRATION_MS;
  const last = card.lastTransactionAt.toMillis ? card.lastTransactionAt.toMillis() : card.lastTransactionAt;
  return Math.max(0, EXPIRATION_MS - (Date.now() - last));
}

/* Une carte suspendue par l'Hôte/l'Admin ne peut plus miser/jouer tant qu'elle
   n'est pas réactivée — ses jetons restent gelés en attendant. */
export function isSuspended(card){
  return card?.status === "suspended";
}

export async function setCardSuspended(cardId, suspended, staff){
  const card = await getCard(cardId);
  if(!card) throw new Error("Carte introuvable.");
  await updateDoc(doc(db, "playerCards", cardId), { status: suspended ? "suspended" : "active" });
  await logAction({
    action: suspended ? "CARTE_SUSPENDUE" : "CARTE_REACTIVEE",
    detail: suspended ? `Carte suspendue (Steam ID ${card.steamId})` : `Carte réactivée (Steam ID ${card.steamId})`,
    steamId: card.steamId, playerName: card.playerName, staffId: staff?.id, staffName: staff?.name
  });
}

export async function findCardBySteamId(steamId){
  const q = query(collection(db, "playerCards"), where("steamId", "==", steamId.trim()));
  const snap = await getDocs(q);
  if(snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

export async function getCard(cardId){
  const d = await getDoc(doc(db, "playerCards", cardId));
  return d.exists() ? { id: d.id, ...d.data() } : null;
}

export async function listAllCards(){
  const snap = await getDocs(query(collection(db, "playerCards"), orderBy("lastTransactionAt", "desc")));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

function generatePin(){
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let pin = "";
  for(let i=0;i<6;i++) pin += chars[Math.floor(Math.random()*chars.length)];
  return pin;
}

export async function createCard({ steamId, playerName, staff }){
  const existing = await findCardBySteamId(steamId);
  if(existing) throw new Error("Une carte existe déjà pour ce Steam ID.");
  const pin = generatePin();
  const ref = await addDoc(collection(db, "playerCards"), {
    steamId: steamId.trim(), playerName: playerName.trim(), balance: 0, pin,
    createdAt: serverTimestamp(), lastTransactionAt: serverTimestamp(),
    createdBy: staff?.id || null, createdByName: staff?.name || null, status: "active"
  });
  await logAction({
    action: "CARTE_CREEE", detail: `Nouvelle carte pour ${playerName} (${steamId})`,
    steamId, playerName, staffId: staff?.id, staffName: staff?.name
  });
  return { id: ref.id, pin };
}

/* Ajuste le solde d'une carte de façon atomique (dépôt, retrait, mise, gain, perte).
   amount positif = crédit, négatif = débit. Rejette si le solde deviendrait négatif. */
export async function adjustBalance({ cardId, amount, type, staff, gameId, note }){
  const cardRef = doc(db, "playerCards", cardId);
  let result;
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(cardRef);
    if(!snap.exists()) throw new Error("Carte introuvable.");
    const card = snap.data();
    const newBalance = (card.balance || 0) + amount;
    if(newBalance < 0) throw new Error("Solde insuffisant.");
    tx.update(cardRef, { balance: newBalance, lastTransactionAt: serverTimestamp() });
    result = { steamId: card.steamId, playerName: card.playerName, balanceAfter: newBalance };
  });

  /* Profit du casino tenu à jour en direct (compteur), en dehors de la
     transaction ci-dessus et en best-effort : si ça échoue (ex. règle
     Firestore pas encore déployée), le dépôt/retrait/mise ne doit jamais
     être bloqué pour autant — c'est juste un compteur d'affichage. */
  if(gameId){
    updateDoc(doc(db, "stats", "global"), { casinoProfitTokens: increment(-amount) })
      .catch(() => setDoc(doc(db, "stats", "global"), { casinoProfitTokens: increment(-amount) }, { merge: true }))
      .catch((e) => console.error("Profit casino non mis à jour :", e));
  }

  await addDoc(collection(db, "transactions"), {
    cardId, steamId: result.steamId, playerName: result.playerName,
    type, amount, balanceAfter: result.balanceAfter,
    staffId: staff?.id || null, staffName: staff?.name || null,
    gameId: gameId || null, note: note || "", createdAt: serverTimestamp()
  });

  await logAction({
    action: type.toUpperCase(), detail: note || "",
    steamId: result.steamId, playerName: result.playerName,
    staffId: staff?.id, staffName: staff?.name, amount, gameId
  });

  return result.balanceAfter;
}

export async function cardTransactions(cardId, max = 30){
  const q = query(collection(db, "transactions"), where("cardId", "==", cardId), orderBy("createdAt", "desc"), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function totalTokensInCirculation(){
  const cards = await listAllCards();
  return cards.reduce((sum, c) => sum + (isExpired(c) ? 0 : (c.balance || 0)), 0);
}

/* Profit net de la maison, en jetons : -somme des transactions liées à un jeu
   (mise = la maison encaisse, gain = la maison paie). Les dépôts/retraits ne
   comptent pas — ce ne sont que des échanges de devise, pas du profit de jeu.
   Lit un compteur maintenu à jour (1 seule lecture) plutôt que de relire tout
   l'historique des transactions à chaque appel. La toute première fois après
   ce déploiement, le compteur n'existe pas encore : on fait le calcul complet
   une seule fois pour l'initialiser, puis plus jamais. */
export async function casinoProfitTokens(){
  const statsRef = doc(db, "stats", "global");
  const statsSnap = await getDoc(statsRef);
  if(statsSnap.exists() && typeof statsSnap.data().casinoProfitTokens === "number"){
    return statsSnap.data().casinoProfitTokens;
  }
  const snap = await getDocs(query(collection(db, "transactions"), where("gameId", "!=", null)));
  const total = snap.docs.reduce((sum, d) => sum - (d.data().amount || 0), 0);
  await setDoc(statsRef, { casinoProfitTokens: total }, { merge: true });
  return total;
}

/* Supprime une carte joueur ainsi que toutes ses transactions et entrées de
   journal d'audit associées (aucune trace ne doit subsister). */
export async function deleteCard(cardId, steamId, staff){
  const txSnap = await getDocs(query(collection(db, "transactions"), where("cardId", "==", cardId)));
  let profitReversal = 0;
  for(const d of txSnap.docs){
    const t = d.data();
    if(t.gameId) profitReversal += (t.amount || 0);
    await deleteDoc(doc(db, "transactions", d.id));
  }
  if(profitReversal !== 0){
    /* Best-effort : ne doit jamais empêcher la suppression de la carte elle-même. */
    try{ await setDoc(doc(db, "stats", "global"), { casinoProfitTokens: increment(profitReversal) }, { merge: true }); }
    catch(e){ console.error("Profit casino non ajusté :", e); }
  }

  const logSnap = await getDocs(query(collection(db, "logs"), where("steamId", "==", steamId)));
  for(const d of logSnap.docs){ await deleteDoc(doc(db, "logs", d.id)); }

  await deleteDoc(doc(db, "playerCards", cardId));

  await logAction({
    action: "CARTE_SUPPRIMEE", detail: `Carte et historique effacés (Steam ID ${steamId})`,
    staffId: staff?.id, staffName: staff?.name
  });
}
