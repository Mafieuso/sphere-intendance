/* Cagnotte progressive partagée entre tous les jeux. Alimentée par un petit
   prélèvement sur les mises PERDUES par les joueurs (jamais sur la mise
   elle-même, encore moins sur un gain) — voir addRake() plus bas — plus les
   inscriptions à 10 jetons. Le tirage est manuel (réservé à l'Intendance) —
   pas de tirage automatique.

   Pour ne jamais risquer de mettre l'Intendance à perte : sur toute somme
   destinée au Jackpot (prélèvement de jeu ou inscription), seule une part
   (POOL_SHARE) rejoint réellement la cagnotte distribuable — le reste
   reste acquis au profit normal du casino, sans jamais transiter par une
   transaction séparée (il en fait déjà partie via la mise normale). La
   cagnotte est comptée en Yens (pas en jetons) pour que ce prélèvement
   reste précis même sur de petites mises, et pour qu'elle progresse de
   façon visible et régulière plutôt que par à-coups arrondis à zéro.
   Au tirage, la récompense est en plus plafonnée au profit courant du
   casino, en toute dernière protection. */
import { getDb } from "../db.js";
import { adjustBalance, isExpired, isSuspended, casinoProfitTokens } from "./cards.js";
import { isAdmin, isPlayer } from "../auth.js";
import { logAction } from "./logs.js";
import { tokensToYen, yenToTokens } from "../../assets/js/economy.js";

const RAKE_RATE = 0.03;            // part symbolique de chaque mise "fléchée" vers le Jackpot
const DEFAULT_POOL_SHARE_PCT = 25; // par défaut : 25% rejoint la cagnotte, 75% reste profit — ajustable en direct par l'Intendance
const ENTRY_COST = 10;             // coût d'inscription, en jetons (inchangé, bien réel)
const JACKPOT_ID = "current";

let ioRef = null;
export function initJackpot(io){ ioRef = io; }

async function getJackpotDoc(){
  const db = await getDb();
  const doc = await db.collection("jackpot").findOne({ _id: JACKPOT_ID });
  return doc || { _id: JACKPOT_ID, poolYen: 0, entrants: [] };
}

/* Le taux de reversement n'est jamais transmis aux joueurs (publicState) —
   seule l'Intendance peut le consulter/modifier, via jackpot:getConfig et
   jackpot:setRate. Peu importe sa valeur, le paiement final reste de toute
   façon plafonné au profit courant du casino (voir jackpot:draw) : ajuster
   ce taux ne peut donc jamais faire passer l'Intendance en négatif. */
function poolShareOf(doc){
  const pct = typeof doc.poolSharePercent === "number" ? doc.poolSharePercent : DEFAULT_POOL_SHARE_PCT;
  return pct / 100;
}

function publicState(doc){
  return { poolYen: doc.poolYen || 0, entrantCount: (doc.entrants || []).length };
}

async function broadcastJackpot(){
  if(!ioRef) return;
  try{ ioRef.to("jackpot").emit("jackpot:state", publicState(await getJackpotDoc())); }
  catch(e){ console.error("broadcastJackpot a échoué :", e); }
}

/* Appelé par chaque jeu UNIQUEMENT quand le joueur perd sa mise (jamais au
   moment de miser, jamais sur un gain) : le prélèvement porte sur une somme
   déjà acquise au profit du casino, jamais sur de l'argent qui pourrait
   encore repartir vers le joueur. Alimenter le Jackpot dès la mise (comme
   avant) faisait grossir la cagnotte même quand le joueur gagnait — un
   double risque financier pour l'Intendance (le paiement du gain ET le
   prélèvement partaient du même jeton). */
export async function addRake(lostAmount){
  try{
    const doc = await getJackpotDoc();
    const flaggedYen = tokensToYen(lostAmount) * RAKE_RATE;
    const poolYen = Math.floor(flaggedYen * poolShareOf(doc));
    if(poolYen <= 0) return;
    const db = await getDb();
    await db.collection("jackpot").updateOne(
      { _id: JACKPOT_ID }, { $inc: { poolYen }, $setOnInsert: { entrants: [] } }, { upsert: true }
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
      const poolYen = Math.floor(tokensToYen(ENTRY_COST) * poolShareOf(doc));
      await db.collection("jackpot").updateOne(
        { _id: JACKPOT_ID },
        { $inc: { poolYen }, $push: { entrants: { cardId, playerName: socket.session.playerName } } },
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
      const profitTokens = await casinoProfitTokens();
      const payout = Math.max(0, Math.min(yenToTokens(doc.poolYen || 0), profitTokens));

      if(payout > 0){
        await adjustBalance({
          cardId: winner.cardId, amount: payout, type: "gain", gameId: "jackpot",
          note: `Jackpot remporté ! (${entrants.length} inscrit(s))`
        });
      }

      const db = await getDb();
      await db.collection("jackpot").updateOne(
        { _id: JACKPOT_ID }, { $set: { poolYen: 0, entrants: [] } }, { upsert: true }
      );

      if(ioRef){
        ioRef.to("jackpot").emit("jackpot:won", { playerName: winner.playerName, payout, entrantCount: entrants.length });
      }
      broadcastJackpot();
      cb?.({ ok: true, winner: winner.playerName, payout });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });

  /* Réinitialise sans tirer de gagnant — pour clôturer une soirée sans
     laisser une cagnotte traîner. Rembourse chaque inscrit (annule
     complètement leur inscription, comme si elle n'avait jamais eu lieu),
     plutôt que de garder leur mise sans contrepartie. */
  socket.on("jackpot:reset", async (_payload, cb) => {
    try{
      if(!isAdmin(socket.session)) return cb?.({ ok: false, error: "Réservé à l'Intendance." });
      const doc = await getJackpotDoc();
      const entrants = doc.entrants || [];
      for(const entrant of entrants){
        try{
          await adjustBalance({
            cardId: entrant.cardId, amount: ENTRY_COST, type: "gain", gameId: "jackpot",
            note: "Jackpot annulé — inscription remboursée"
          });
        }catch(e){ console.error("Remboursement Jackpot échoué pour", entrant.cardId, ":", e); }
      }
      const db = await getDb();
      await db.collection("jackpot").updateOne(
        { _id: JACKPOT_ID }, { $set: { poolYen: 0, entrants: [] } }, { upsert: true }
      );
      broadcastJackpot();
      cb?.({ ok: true, refunded: entrants.length });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });

  /* Réglage réservé à l'Intendance — jamais exposé aux joueurs. */
  socket.on("jackpot:getConfig", async (_payload, cb) => {
    try{
      if(!isAdmin(socket.session)) return cb?.({ ok: false, error: "Réservé à l'Intendance." });
      const doc = await getJackpotDoc();
      cb?.({ ok: true, poolSharePercent: Math.round(poolShareOf(doc) * 100) });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });

  socket.on("jackpot:setRate", async ({ poolSharePercent } = {}, cb) => {
    try{
      if(!isAdmin(socket.session)) return cb?.({ ok: false, error: "Réservé à l'Intendance." });
      const pct = Math.round(Number(poolSharePercent));
      if(!Number.isFinite(pct) || pct < 1 || pct > 90){
        return cb?.({ ok: false, error: "Le taux doit être compris entre 1 et 90%." });
      }
      const db = await getDb();
      await db.collection("jackpot").updateOne(
        { _id: JACKPOT_ID }, { $set: { poolSharePercent: pct } }, { upsert: true }
      );
      await logAction({
        action: "JACKPOT_RATE", detail: `Taux de reversement du Jackpot ajusté à ${pct}%`,
        staffId: socket.session.staffId, staffName: socket.session.name
      });
      cb?.({ ok: true, poolSharePercent: pct });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });
}
