/* Roulette européenne multijoueur — deux tables indépendantes ("1" et "2"),
   chacune avec son propre état en mémoire et sa propre room Socket.io, pour
   que deux croupiers puissent animer une manche chacun en parallèle. Plus
   aucune lecture Firestore générée par l'affichage en direct : seul le
   résultat final (transactions) est persisté. */
import { isCroupierOrAdmin, isPlayer } from "../../auth.js";
import { adjustBalance, isExpired, isSuspended } from "../cards.js";
import { addRake } from "../jackpot.js";
import { recordWager } from "../ranks.js";
import { getDb } from "../../db.js";

const TABLE_IDS = ["1", "2"];
const RED_NUMBERS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
function numberColor(n){ if(n === 0) return "green"; return RED_NUMBERS.has(n) ? "rouge" : "noir"; }

function freshTable(){ return { status: "closed", roundId: 0, result: null, croupierName: null, bets: [] }; }
const tables = new Map(TABLE_IDS.map(id => [id, freshTable()]));

let ioRef = null;
function roomFor(tableId){ return `table:roulette:${tableId}`; }
function publicState(tableId){
  const t = tables.get(tableId);
  return { tableId, status: t.status, roundId: t.roundId, result: t.result, croupierName: t.croupierName, bets: t.bets };
}
function broadcast(tableId){ ioRef?.to(roomFor(tableId)).emit("table:roulette:state", publicState(tableId)); }

export function initRoulette(io){ ioRef = io; }

export function registerRouletteHandlers(io, socket){
  socket.on("table:roulette:join", ({ tableId } = {}, cb) => {
    if(!TABLE_IDS.includes(tableId)) return cb?.({ ok: false, error: "Table invalide." });
    socket.join(roomFor(tableId));
    cb?.({ ok: true, state: publicState(tableId) });
  });
  socket.on("table:roulette:leave", ({ tableId } = {}) => {
    if(TABLE_IDS.includes(tableId)) socket.leave(roomFor(tableId));
  });

  socket.on("table:roulette:newRound", ({ tableId } = {}, cb) => {
    if(!isCroupierOrAdmin(socket.session)) return cb?.({ ok: false, error: "Réservé au Croupier." });
    if(!TABLE_IDS.includes(tableId)) return cb?.({ ok: false, error: "Table invalide." });
    const table = tables.get(tableId);
    table.status = "betting";
    table.roundId += 1;
    table.result = null;
    table.croupierName = socket.session.name;
    table.bets = [];
    broadcast(tableId);
    cb?.({ ok: true });
  });

  socket.on("table:roulette:bet", async ({ tableId, betType, betValue, amount } = {}, cb) => {
    try{
      if(!isPlayer(socket.session)) return cb?.({ ok: false, error: "Non connecté." });
      if(!TABLE_IDS.includes(tableId)) return cb?.({ ok: false, error: "Table invalide." });
      const table = tables.get(tableId);
      if(table.status !== "betting") return cb?.({ ok: false, error: "Les mises ne sont pas ouvertes." });
      const amt = parseInt(amount, 10);
      if(!amt || amt <= 0) return cb?.({ ok: false, error: "Mise invalide." });
      if(!["color", "number"].includes(betType)) return cb?.({ ok: false, error: "Type de mise invalide." });

      const cardId = socket.session.cardId;
      const db = await getDb();
      const card = await db.collection("playerCards").findOne({ _id: cardId });
      if(!card) return cb?.({ ok: false, error: "Carte introuvable." });
      if(isExpired(card)) return cb?.({ ok: false, error: "Carte expirée." });
      if(isSuspended(card)) return cb?.({ ok: false, error: "Carte suspendue — contacte l'Hôte." });
      if((card.balance || 0) < amt) return cb?.({ ok: false, error: "Solde insuffisant." });

      const label = betType === "color" ? betValue : ("numéro " + betValue);
      await adjustBalance({
        cardId, amount: -amt, type: "mise", gameId: "roulette",
        note: `Mise ${amt} jeton(s) sur ${label} (table ${tableId})`
      });
      const rankUp = await recordWager(cardId, amt);
      table.bets.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
        roundId: table.roundId, cardId, steamId: socket.session.steamId, playerName: socket.session.playerName,
        amount: amt, betType, betValue, createdAt: Date.now()
      });
      broadcast(tableId);
      cb?.({ ok: true, rankUp });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });

  socket.on("table:roulette:closeAndSpin", ({ tableId } = {}, cb) => {
    if(!isCroupierOrAdmin(socket.session)) return cb?.({ ok: false, error: "Réservé au Croupier." });
    if(!TABLE_IDS.includes(tableId)) return cb?.({ ok: false, error: "Table invalide." });
    const table = tables.get(tableId);
    if(table.status !== "betting") return cb?.({ ok: false, error: "Aucune manche ouverte." });
    table.status = "spinning";
    broadcast(tableId);
    cb?.({ ok: true });

    const roundId = table.roundId;
    const roundBets = [...table.bets];
    setTimeout(async () => {
      if(table.roundId !== roundId) return; // une nouvelle manche a déjà été ouverte
      const result = Math.floor(Math.random() * 37);
      const color = numberColor(result);
      for(const bet of roundBets){
        let win = false, payout = 0;
        if(bet.betType === "color" && bet.betValue === color){ win = true; payout = bet.amount * 2; }
        if(bet.betType === "number" && parseInt(bet.betValue, 10) === result){ win = true; payout = bet.amount * 36; }
        if(win){
          try{
            await adjustBalance({
              cardId: bet.cardId, amount: payout, type: "gain", gameId: "roulette",
              note: `Roulette manche #${roundId} — numéro ${result} (table ${tableId})`
            });
          }catch(e){ console.error("Paiement roulette échoué :", e); }
        }else{
          addRake(bet.amount);
        }
      }
      table.status = "result";
      table.result = result;
      broadcast(tableId);
    }, 3700);
  });
}
