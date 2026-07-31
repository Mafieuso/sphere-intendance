/* Cartes joueur + économie. adjustBalance() est la seule porte d'entrée pour
   modifier un solde — elle n'est jamais exposée telle quelle à un socket
   client : les jeux l'appellent en interne avec des montants calculés côté
   serveur (jamais fournis par le navigateur), et les dépôts/retraits passent
   par des événements dédiés réservés à l'Hôte/l'Admin. C'est ce qui ferme
   les failles "solde modifiable par n'importe qui" et "role auto-déclaré". */
import { getDb, FieldValue } from "../firebaseAdmin.js";
import { isHoteOrAdmin, isPlayer } from "../auth.js";
import { serializeCard, serializeTransaction } from "../serialize.js";
import { logAction } from "./logs.js";
import { broadcastLeaderboard } from "./logs.js";

export const EXPIRATION_MS = 24 * 60 * 60 * 1000;

export function isExpired(card){
  if(!card || !card.lastTransactionAt) return false;
  const last = typeof card.lastTransactionAt === "number" ? card.lastTransactionAt : card.lastTransactionAt.toMillis();
  return (Date.now() - last) > EXPIRATION_MS;
}
export function isSuspended(card){ return card?.status === "suspended"; }

function generateCardPin(){
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let pin = "";
  for(let i = 0; i < 6; i++) pin += chars[Math.floor(Math.random() * chars.length)];
  return pin;
}

let ioRef = null;
export function initCards(io){ ioRef = io; }

async function broadcastCardsList(){
  if(!ioRef) return;
  try{
    const db = getDb();
    const snap = await db.collection("playerCards").get();
    const cards = snap.docs.map(d => serializeCard(d.id, d.data()));
    ioRef.to("cards:list").emit("cards:list:update", cards);
  }catch(e){ console.error("broadcastCardsList a échoué :", e); }
}

async function broadcastProfit(){
  if(!ioRef) return;
  try{
    ioRef.to("profit").emit("profit:update", await casinoProfitTokens());
  }catch(e){ console.error("broadcastProfit a échoué :", e); }
}

/* Ajuste un solde de façon atomique. amount positif = crédit, négatif = débit.
   Rejette si le solde deviendrait négatif. Fonction interne — pas un handler
   socket direct. */
export async function adjustBalance({ cardId, amount, type, staffId, staffName, gameId, note }){
  const db = getDb();
  const cardRef = db.collection("playerCards").doc(cardId);
  let result;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(cardRef);
    if(!snap.exists) throw new Error("Carte introuvable.");
    const card = snap.data();
    const newBalance = (card.balance || 0) + amount;
    if(newBalance < 0) throw new Error("Solde insuffisant.");
    tx.update(cardRef, { balance: newBalance, lastTransactionAt: FieldValue.serverTimestamp() });
    result = { steamId: card.steamId, playerName: card.playerName, balanceAfter: newBalance };
  });

  const txRef = await db.collection("transactions").add({
    cardId, steamId: result.steamId, playerName: result.playerName,
    type, amount, balanceAfter: result.balanceAfter,
    staffId: staffId || null, staffName: staffName || null,
    gameId: gameId || null, note: note || "", createdAt: FieldValue.serverTimestamp()
  });
  if(ioRef){
    ioRef.to("transactions:feed").emit("transactions:new", serializeTransaction(txRef.id, {
      cardId, steamId: result.steamId, playerName: result.playerName, type, amount,
      balanceAfter: result.balanceAfter, staffName: staffName || null, gameId: gameId || null,
      note: note || "", createdAt: Date.now()
    }));
  }

  await logAction({
    action: type.toUpperCase(), detail: note || "",
    steamId: result.steamId, playerName: result.playerName,
    staffId, staffName, amount, gameId
  });

  if(gameId){
    try{
      await db.collection("stats").doc("global").set(
        { casinoProfitTokens: FieldValue.increment(-amount) }, { merge: true }
      );
      broadcastProfit();
      broadcastLeaderboard();
    }catch(e){ console.error("Profit casino non mis à jour :", e); }
  }
  broadcastCardsList();
  return result.balanceAfter;
}

export async function casinoProfitTokens(){
  const db = getDb();
  const statsRef = db.collection("stats").doc("global");
  const snap = await statsRef.get();
  if(snap.exists && typeof snap.data().casinoProfitTokens === "number") return snap.data().casinoProfitTokens;
  // Migration unique : calcule depuis l'historique complet, puis mémorise.
  const txSnap = await db.collection("transactions").get();
  const total = txSnap.docs.reduce((sum, d) => {
    const t = d.data();
    return t.gameId ? sum - (t.amount || 0) : sum;
  }, 0);
  await statsRef.set({ casinoProfitTokens: total }, { merge: true });
  return total;
}

export function registerCardHandlers(io, socket){
  socket.on("card:create", async ({ steamId, playerName } = {}, cb) => {
    try{
      if(!isHoteOrAdmin(socket.session)) return cb?.({ ok: false, error: "Réservé à l'Hôte." });
      if(!steamId || !playerName) return cb?.({ ok: false, error: "Steam ID et nom requis." });
      const db = getDb();
      const existing = await db.collection("playerCards").where("steamId", "==", steamId.trim()).limit(1).get();
      if(!existing.empty) return cb?.({ ok: false, error: "Une carte existe déjà pour ce Steam ID." });
      const pin = generateCardPin();
      const ref = await db.collection("playerCards").add({
        steamId: steamId.trim(), playerName: playerName.trim(), balance: 0, pin,
        createdAt: FieldValue.serverTimestamp(), lastTransactionAt: FieldValue.serverTimestamp(),
        createdBy: socket.session.staffId, createdByName: socket.session.name, status: "active"
      });
      await logAction({
        action: "CARTE_CREEE", detail: `Nouvelle carte pour ${playerName} (${steamId})`,
        steamId, playerName, staffId: socket.session.staffId, staffName: socket.session.name
      });
      broadcastCardsList();
      cb?.({ ok: true, cardId: ref.id, pin });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });

  socket.on("card:find", async ({ steamId } = {}, cb) => {
    try{
      if(!isHoteOrAdmin(socket.session)) return cb?.({ ok: false, error: "Réservé à l'Hôte." });
      const db = getDb();
      const snap = await db.collection("playerCards").where("steamId", "==", (steamId || "").trim()).limit(1).get();
      if(snap.empty) return cb?.({ ok: true, card: null });
      const d = snap.docs[0];
      cb?.({ ok: true, card: serializeCard(d.id, d.data(), { includePin: true }) });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });

  socket.on("card:get", async ({ cardId } = {}, cb) => {
    try{
      const targetId = cardId || (isPlayer(socket.session) ? socket.session.cardId : null);
      if(!targetId) return cb?.({ ok: false, error: "Carte non spécifiée." });
      if(!isHoteOrAdmin(socket.session) && !(isPlayer(socket.session) && socket.session.cardId === targetId)){
        return cb?.({ ok: false, error: "Accès refusé." });
      }
      const db = getDb();
      const doc = await db.collection("playerCards").doc(targetId).get();
      if(!doc.exists) return cb?.({ ok: true, card: null });
      cb?.({ ok: true, card: serializeCard(doc.id, doc.data()) });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });

  socket.on("card:deposit", async ({ cardId, amount, note } = {}, cb) => {
    try{
      if(!isHoteOrAdmin(socket.session)) return cb?.({ ok: false, error: "Réservé à l'Hôte." });
      const amt = parseInt(amount, 10);
      if(!amt || amt <= 0) return cb?.({ ok: false, error: "Montant invalide." });
      const balanceAfter = await adjustBalance({
        cardId, amount: amt, type: "depot", staffId: socket.session.staffId, staffName: socket.session.name, note
      });
      cb?.({ ok: true, balanceAfter });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });

  socket.on("card:withdraw", async ({ cardId, amount, note } = {}, cb) => {
    try{
      if(!isHoteOrAdmin(socket.session)) return cb?.({ ok: false, error: "Réservé à l'Hôte." });
      const amt = parseInt(amount, 10);
      if(!amt || amt <= 0) return cb?.({ ok: false, error: "Montant invalide." });
      const balanceAfter = await adjustBalance({
        cardId, amount: -amt, type: "retrait", staffId: socket.session.staffId, staffName: socket.session.name, note
      });
      cb?.({ ok: true, balanceAfter });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });

  socket.on("card:suspend", async ({ cardId, suspend } = {}, cb) => {
    try{
      if(!isHoteOrAdmin(socket.session)) return cb?.({ ok: false, error: "Réservé à l'Hôte." });
      const db = getDb();
      const ref = db.collection("playerCards").doc(cardId);
      const doc = await ref.get();
      if(!doc.exists) return cb?.({ ok: false, error: "Carte introuvable." });
      const card = doc.data();
      await ref.update({ status: suspend ? "suspended" : "active" });
      await logAction({
        action: suspend ? "CARTE_SUSPENDUE" : "CARTE_REACTIVEE",
        detail: suspend ? `Carte suspendue (Steam ID ${card.steamId})` : `Carte réactivée (Steam ID ${card.steamId})`,
        steamId: card.steamId, playerName: card.playerName,
        staffId: socket.session.staffId, staffName: socket.session.name
      });
      broadcastCardsList();
      cb?.({ ok: true });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });

  socket.on("card:delete", async ({ cardId } = {}, cb) => {
    try{
      if(!isHoteOrAdmin(socket.session)) return cb?.({ ok: false, error: "Réservé à l'Hôte." });
      const db = getDb();
      const cardRef = db.collection("playerCards").doc(cardId);
      const cardDoc = await cardRef.get();
      if(!cardDoc.exists) return cb?.({ ok: false, error: "Carte introuvable." });
      const steamId = cardDoc.data().steamId;

      const txSnap = await db.collection("transactions").where("cardId", "==", cardId).get();
      let profitReversal = 0;
      const batchDeletes = [];
      txSnap.docs.forEach(d => {
        const t = d.data();
        if(t.gameId) profitReversal += (t.amount || 0);
        batchDeletes.push(d.ref.delete());
      });
      await Promise.all(batchDeletes);

      if(profitReversal !== 0){
        try{
          await db.collection("stats").doc("global").set(
            { casinoProfitTokens: FieldValue.increment(profitReversal) }, { merge: true }
          );
        }catch(e){ console.error("Profit casino non ajusté :", e); }
      }

      const logSnap = await db.collection("logs").where("steamId", "==", steamId).get();
      await Promise.all(logSnap.docs.map(d => d.ref.delete()));

      await cardRef.delete();

      await logAction({
        action: "CARTE_SUPPRIMEE", detail: `Carte et historique effacés (Steam ID ${steamId})`,
        staffId: socket.session.staffId, staffName: socket.session.name
      });
      broadcastCardsList();
      broadcastProfit();
      broadcastLeaderboard();
      cb?.({ ok: true });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });

  socket.on("card:transactions", async ({ cardId, max = 30 } = {}, cb) => {
    try{
      if(!isHoteOrAdmin(socket.session) && !(isPlayer(socket.session) && socket.session.cardId === cardId)){
        return cb?.({ ok: false, error: "Accès refusé." });
      }
      const db = getDb();
      const snap = await db.collection("transactions").where("cardId", "==", cardId).get();
      const txs = snap.docs.map(d => serializeTransaction(d.id, d.data()))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, max);
      cb?.({ ok: true, transactions: txs });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });

  socket.on("cards:list:subscribe", async (_payload, cb) => {
    try{
      if(!isHoteOrAdmin(socket.session)) return cb?.({ ok: false, error: "Réservé au staff." });
      socket.join("cards:list");
      const db = getDb();
      const snap = await db.collection("playerCards").get();
      cb?.({ ok: true, cards: snap.docs.map(d => serializeCard(d.id, d.data())) });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });
  socket.on("cards:list:unsubscribe", () => socket.leave("cards:list"));

  socket.on("profit:subscribe", async (_payload, cb) => {
    try{
      if(!isHoteOrAdmin(socket.session)) return cb?.({ ok: false, error: "Réservé au staff." });
      socket.join("profit");
      cb?.({ ok: true, profitTokens: await casinoProfitTokens() });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });
  socket.on("profit:unsubscribe", () => socket.leave("profit"));

  socket.on("transactions:subscribe", async (_payload, cb) => {
    try{
      if(!isHoteOrAdmin(socket.session)) return cb?.({ ok: false, error: "Réservé au staff." });
      socket.join("transactions:feed");
      const db = getDb();
      const snap = await db.collection("transactions").orderBy("createdAt", "desc").limit(20).get();
      cb?.({ ok: true, transactions: snap.docs.map(d => serializeTransaction(d.id, d.data())) });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });
  socket.on("transactions:unsubscribe", () => socket.leave("transactions:feed"));
}
