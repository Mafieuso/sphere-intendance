/* Cartes joueur + économie. adjustBalance() est la seule porte d'entrée pour
   modifier un solde — elle n'est jamais exposée telle quelle à un socket
   client : les jeux l'appellent en interne avec des montants calculés côté
   serveur (jamais fournis par le navigateur), et les dépôts/retraits passent
   par des événements dédiés réservés à l'Hôte/l'Admin. C'est ce qui ferme
   les failles "solde modifiable par n'importe qui" et "role auto-déclaré". */
import { getDb, newId } from "../db.js";
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
    const db = await getDb();
    const docs = await db.collection("playerCards").find({}).toArray();
    const cards = docs.map(d => serializeCard(d._id, d));
    ioRef.to("cards:list").emit("cards:list:update", cards);
  }catch(e){ console.error("broadcastCardsList a échoué :", e); }
}

async function broadcastProfit(){
  if(!ioRef) return;
  try{
    ioRef.to("profit").emit("profit:update", await casinoProfitTokens());
  }catch(e){ console.error("broadcastProfit a échoué :", e); }
}

/* Ajuste un solde de façon atomique via une mise à jour conditionnelle
   MongoDB (balance >= -amount) — équivalent à la transaction Firestore
   d'origine, mais en une seule opération atomique native. amount positif
   = crédit, négatif = débit. Rejette si le solde deviendrait négatif. */
export async function adjustBalance({ cardId, amount, type, staffId, staffName, gameId, note }){
  const db = await getDb();
  const cards = db.collection("playerCards");
  const now = Date.now();

  const res = await cards.findOneAndUpdate(
    { _id: cardId, balance: { $gte: -amount } },
    { $inc: { balance: amount }, $set: { lastTransactionAt: now } },
    { returnDocument: "after", includeResultMetadata: true }
  );
  const card = res.value;
  if(!card){
    const existing = await cards.findOne({ _id: cardId });
    if(!existing) throw new Error("Carte introuvable.");
    throw new Error("Solde insuffisant.");
  }
  const result = { steamId: card.steamId, playerName: card.playerName, balanceAfter: card.balance };

  const txId = newId();
  await db.collection("transactions").insertOne({
    _id: txId, cardId, steamId: result.steamId, playerName: result.playerName,
    type, amount, balanceAfter: result.balanceAfter,
    staffId: staffId || null, staffName: staffName || null,
    gameId: gameId || null, note: note || "", createdAt: now
  });
  if(ioRef){
    ioRef.to("transactions:feed").emit("transactions:new", serializeTransaction(txId, {
      cardId, steamId: result.steamId, playerName: result.playerName, type, amount,
      balanceAfter: result.balanceAfter, staffName: staffName || null, gameId: gameId || null,
      note: note || "", createdAt: now
    }));
  }

  await logAction({
    action: type.toUpperCase(), detail: note || "",
    steamId: result.steamId, playerName: result.playerName,
    staffId, staffName, amount, gameId
  });

  if(gameId){
    try{
      await db.collection("stats").updateOne(
        { _id: "global" }, { $inc: { casinoProfitTokens: -amount } }, { upsert: true }
      );
      broadcastProfit();
      broadcastLeaderboard();
    }catch(e){ console.error("Profit casino non mis à jour :", e); }
  }
  broadcastCardsList();
  return result.balanceAfter;
}

export async function casinoProfitTokens(){
  const db = await getDb();
  const stats = db.collection("stats");
  const doc = await stats.findOne({ _id: "global" });
  if(doc && typeof doc.casinoProfitTokens === "number") return doc.casinoProfitTokens;
  // Migration unique : calcule depuis l'historique complet, puis mémorise.
  const txs = await db.collection("transactions").find({}).toArray();
  const total = txs.reduce((sum, t) => t.gameId ? sum - (t.amount || 0) : sum, 0);
  await stats.updateOne({ _id: "global" }, { $set: { casinoProfitTokens: total } }, { upsert: true });
  return total;
}

export function registerCardHandlers(io, socket){
  socket.on("card:create", async ({ steamId, playerName } = {}, cb) => {
    try{
      if(!isHoteOrAdmin(socket.session)) return cb?.({ ok: false, error: "Réservé à l'Hôte." });
      if(!steamId || !playerName) return cb?.({ ok: false, error: "Steam ID et nom requis." });
      const db = await getDb();
      const existing = await db.collection("playerCards").findOne({ steamId: steamId.trim() });
      if(existing) return cb?.({ ok: false, error: "Une carte existe déjà pour ce Steam ID." });
      const pin = generateCardPin();
      const id = newId();
      const now = Date.now();
      await db.collection("playerCards").insertOne({
        _id: id, steamId: steamId.trim(), playerName: playerName.trim(), balance: 0, pin,
        createdAt: now, lastTransactionAt: now,
        createdBy: socket.session.staffId, createdByName: socket.session.name, status: "active"
      });
      await logAction({
        action: "CARTE_CREEE", detail: `Nouvelle carte pour ${playerName} (${steamId})`,
        steamId, playerName, staffId: socket.session.staffId, staffName: socket.session.name
      });
      broadcastCardsList();
      cb?.({ ok: true, cardId: id, pin });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });

  socket.on("card:find", async ({ steamId } = {}, cb) => {
    try{
      if(!isHoteOrAdmin(socket.session)) return cb?.({ ok: false, error: "Réservé à l'Hôte." });
      const db = await getDb();
      const doc = await db.collection("playerCards").findOne({ steamId: (steamId || "").trim() });
      if(!doc) return cb?.({ ok: true, card: null });
      cb?.({ ok: true, card: serializeCard(doc._id, doc, { includePin: true }) });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });

  socket.on("card:get", async ({ cardId } = {}, cb) => {
    try{
      const targetId = cardId || (isPlayer(socket.session) ? socket.session.cardId : null);
      if(!targetId) return cb?.({ ok: false, error: "Carte non spécifiée." });
      if(!isHoteOrAdmin(socket.session) && !(isPlayer(socket.session) && socket.session.cardId === targetId)){
        return cb?.({ ok: false, error: "Accès refusé." });
      }
      const db = await getDb();
      const doc = await db.collection("playerCards").findOne({ _id: targetId });
      if(!doc) return cb?.({ ok: true, card: null });
      cb?.({ ok: true, card: serializeCard(doc._id, doc) });
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
      const db = await getDb();
      const cards = db.collection("playerCards");
      const doc = await cards.findOne({ _id: cardId });
      if(!doc) return cb?.({ ok: false, error: "Carte introuvable." });
      await cards.updateOne({ _id: cardId }, { $set: { status: suspend ? "suspended" : "active" } });
      await logAction({
        action: suspend ? "CARTE_SUSPENDUE" : "CARTE_REACTIVEE",
        detail: suspend ? `Carte suspendue (Steam ID ${doc.steamId})` : `Carte réactivée (Steam ID ${doc.steamId})`,
        steamId: doc.steamId, playerName: doc.playerName,
        staffId: socket.session.staffId, staffName: socket.session.name
      });
      broadcastCardsList();
      cb?.({ ok: true });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });

  socket.on("card:delete", async ({ cardId } = {}, cb) => {
    try{
      if(!isHoteOrAdmin(socket.session)) return cb?.({ ok: false, error: "Réservé à l'Hôte." });
      const db = await getDb();
      const cardDoc = await db.collection("playerCards").findOne({ _id: cardId });
      if(!cardDoc) return cb?.({ ok: false, error: "Carte introuvable." });
      const steamId = cardDoc.steamId;

      const txs = await db.collection("transactions").find({ cardId }).toArray();
      let profitReversal = 0;
      txs.forEach(t => { if(t.gameId) profitReversal += (t.amount || 0); });
      await db.collection("transactions").deleteMany({ cardId });

      if(profitReversal !== 0){
        try{
          await db.collection("stats").updateOne(
            { _id: "global" }, { $inc: { casinoProfitTokens: profitReversal } }, { upsert: true }
          );
        }catch(e){ console.error("Profit casino non ajusté :", e); }
      }

      await db.collection("logs").deleteMany({ steamId });
      await db.collection("playerCards").deleteOne({ _id: cardId });

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
      const db = await getDb();
      const docs = await db.collection("transactions").find({ cardId }).sort({ createdAt: -1 }).limit(max).toArray();
      cb?.({ ok: true, transactions: docs.map(d => serializeTransaction(d._id, d)) });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });

  socket.on("cards:list:subscribe", async (_payload, cb) => {
    try{
      if(!isHoteOrAdmin(socket.session)) return cb?.({ ok: false, error: "Réservé au staff." });
      socket.join("cards:list");
      const db = await getDb();
      const docs = await db.collection("playerCards").find({}).toArray();
      cb?.({ ok: true, cards: docs.map(d => serializeCard(d._id, d)) });
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
      const db = await getDb();
      const docs = await db.collection("transactions").find({}).sort({ createdAt: -1 }).limit(20).toArray();
      cb?.({ ok: true, transactions: docs.map(d => serializeTransaction(d._id, d)) });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });
  socket.on("transactions:unsubscribe", () => socket.leave("transactions:feed"));
}
