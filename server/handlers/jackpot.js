/* Cagnotte progressive partagée entre tous les jeux. Alimentée par un petit
   prélèvement (3%) sur chaque mise posée n'importe où sur le site, plus les
   inscriptions à 10 jetons. Le tirage est manuel (réservé à l'Intendance) —
   pas de tirage automatique. Le prélèvement n'est qu'une écriture comptable
   (le jeton a déjà rejoint le profit du casino via la mise normale) : au
   tirage, la récompense est plafonnée au profit courant du casino, pour ne
   jamais nous faire passer en négatif. */
import { getDb } from "../db.js";
import { adjustBalance, isExpired, isSuspended, casinoProfitTokens } from "./cards.js";
import { isAdmin, isPlayer } from "../auth.js";

const RAKE_RATE = 0.03;
const ENTRY_COST = 10;
const JACKPOT_ID = "current";

let ioRef = null;
export function initJackpot(io){ ioRef = io; }

async function getJackpotDoc(){
  const db = await getDb();
  const doc = await db.collection("jackpot").findOne({ _id: JACKPOT_ID });
  return doc || { _id: JACKPOT_ID, pool: 0, entrants: [] };
}

function publicState(doc){
  return { pool: doc.pool || 0, entrantCount: (doc.entrants || []).length };
}

async function broadcastJackpot(){
  if(!ioRef) return;
  try{ ioRef.to("jackpot").emit("jackpot:state", publicState(await getJackpotDoc())); }
  catch(e){ console.error("broadcastJackpot a échoué :", e); }
}

/* Appelé par chaque jeu au moment de la mise (pas du gain) — le prélèvement
   est proportionnel à l'argent qui circule, pas au résultat. */
export async function addRake(betAmount){
  try{
    const rake = Math.floor(betAmount * RAKE_RATE);
    if(rake <= 0) return;
    const db = await getDb();
    await db.collection("jackpot").updateOne(
      { _id: JACKPOT_ID }, { $inc: { pool: rake }, $setOnInsert: { entrants: [] } }, { upsert: true }
    );
    broadcastJackpot();
  }catch(e){ console.error("addRake a échoué :", e); }
}

export function registerJackpotHandlers(io, socket){
  socket.on("jackpot:join", async (_payload, cb) => {
    socket.join("jackpot");
    try{
      const doc = await getJackpotDoc();
      const subscribed = isPlayer(socket.session) && (doc.entrants || []).some(e => e.cardId === socket.session.cardId);
      cb?.({ ok: true, state: { ...publicState(doc), subscribed } });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });
  socket.on("jackpot:leave", () => socket.leave("jackpot"));

  socket.on("jackpot:subscribe", async (_payload, cb) => {
    try{
      if(!isPlayer(socket.session)) return cb?.({ ok: false, error: "Non connecté." });
      const cardId = socket.session.cardId;
      const db = await getDb();
      const doc = await getJackpotDoc();
      if((doc.entrants || []).some(e => e.cardId === cardId)){
        return cb?.({ ok: false, error: "Tu es déjà inscrit à ce Jackpot." });
      }
      const card = await db.collection("playerCards").findOne({ _id: cardId });
      if(!card) return cb?.({ ok: false, error: "Carte introuvable." });
      if(isExpired(card)) return cb?.({ ok: false, error: "Carte expirée." });
      if(isSuspended(card)) return cb?.({ ok: false, error: "Carte suspendue — contacte l'Hôte." });
      if((card.balance || 0) < ENTRY_COST) return cb?.({ ok: false, error: "Solde insuffisant." });

      const balanceAfter = await adjustBalance({
        cardId, amount: -ENTRY_COST, type: "mise", gameId: "jackpot",
        note: `Inscription au Jackpot (${ENTRY_COST} jetons)`
      });
      await db.collection("jackpot").updateOne(
        { _id: JACKPOT_ID },
        { $inc: { pool: ENTRY_COST }, $push: { entrants: { cardId, playerName: socket.session.playerName } } },
        { upsert: true }
      );
      broadcastJackpot();
      cb?.({ ok: true, balanceAfter });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });

  socket.on("jackpot:draw", async (_payload, cb) => {
    try{
      if(!isAdmin(socket.session)) return cb?.({ ok: false, error: "Réservé à l'Intendance." });
      const doc = await getJackpotDoc();
      const entrants = doc.entrants || [];
      if(!entrants.length) return cb?.({ ok: false, error: "Personne n'est inscrit au Jackpot." });

      const winner = entrants[Math.floor(Math.random() * entrants.length)];
      const profit = await casinoProfitTokens();
      const payout = Math.max(0, Math.min(doc.pool || 0, profit));

      if(payout > 0){
        await adjustBalance({
          cardId: winner.cardId, amount: payout, type: "gain", gameId: "jackpot",
          note: `Jackpot remporté ! (${entrants.length} inscrit(s))`
        });
      }

      const db = await getDb();
      await db.collection("jackpot").updateOne(
        { _id: JACKPOT_ID }, { $set: { pool: 0, entrants: [] } }, { upsert: true }
      );

      if(ioRef){
        ioRef.to("jackpot").emit("jackpot:won", { playerName: winner.playerName, payout, entrantCount: entrants.length });
      }
      broadcastJackpot();
      cb?.({ ok: true, winner: winner.playerName, payout });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });
}
