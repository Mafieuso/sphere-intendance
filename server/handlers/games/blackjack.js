/* Blackjack — état de la manche en mémoire serveur, diffusé au salon
   "table:blackjack-1". La résolution attend que tous les sièges aient fini
   leur tour (bust/stand) avant de payer — ferme la race condition trouvée
   plus tôt (un tirage en cours ne peut plus être lu dans un état obsolète). */
import { isCroupierOrAdmin, isPlayer } from "../../auth.js";
import { adjustBalance, isExpired, isSuspended } from "../cards.js";
import { getDb } from "../../firebaseAdmin.js";

const TABLE_ID = "blackjack-1";
const ROOM = `table:${TABLE_ID}`;
const RANKS = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
const SUITS = ["♠","♥","♦","♣"];
function randomCard(){ return { rank: RANKS[Math.floor(Math.random()*RANKS.length)], suit: SUITS[Math.floor(Math.random()*SUITS.length)] }; }
function cardValue(rank){ if(rank==="A") return 11; if(["J","Q","K"].includes(rank)) return 10; return parseInt(rank,10); }
function handTotal(hand){
  let total = hand.reduce((s,c)=>s+cardValue(c.rank),0);
  let aces = hand.filter(c=>c.rank==="A").length;
  while(total > 21 && aces > 0){ total -= 10; aces--; }
  return total;
}

let ioRef = null;
const table = { status: "betting", roundId: 1, dealerHand: [], hideSecond: true, croupierName: null, seats: [] };

function publicState(){
  const dealerHand = (table.hideSecond && table.dealerHand.length > 1)
    ? [table.dealerHand[0], { hidden: true }]
    : table.dealerHand;
  return {
    status: table.status, roundId: table.roundId, croupierName: table.croupierName,
    dealerHand,
    dealerTotal: table.hideSecond ? null : handTotal(table.dealerHand),
    seats: table.seats.map(s => ({
      id: s.id, cardId: s.cardId, playerName: s.playerName, bet: s.bet, hand: s.hand,
      total: handTotal(s.hand), status: s.status
    }))
  };
}
function broadcast(){ ioRef?.to(ROOM).emit("table:blackjack:state", publicState()); }

export function initBlackjack(io){ ioRef = io; }

export function registerBlackjackHandlers(io, socket){
  socket.on("table:blackjack:join", (_payload, cb) => {
    socket.join(ROOM);
    cb?.({ ok: true, state: publicState() });
  });
  socket.on("table:blackjack:leave", () => socket.leave(ROOM));

  socket.on("table:blackjack:newRound", (_payload, cb) => {
    if(!isCroupierOrAdmin(socket.session)) return cb?.({ ok: false, error: "Réservé au Croupier." });
    table.status = "betting";
    table.roundId += 1;
    table.dealerHand = [];
    table.hideSecond = true;
    table.croupierName = socket.session.name;
    table.seats = [];
    broadcast();
    cb?.({ ok: true });
  });

  socket.on("table:blackjack:sit", async ({ amount } = {}, cb) => {
    try{
      if(!isPlayer(socket.session)) return cb?.({ ok: false, error: "Non connecté." });
      if(table.status !== "betting") return cb?.({ ok: false, error: "Les mises ne sont pas ouvertes." });
      const amt = parseInt(amount, 10);
      if(!amt || amt <= 0) return cb?.({ ok: false, error: "Mise invalide." });
      const cardId = socket.session.cardId;
      if(table.seats.some(s => s.cardId === cardId)) return cb?.({ ok: false, error: "Tu es déjà à la table pour cette manche." });

      const cardDoc = await getDb().collection("playerCards").doc(cardId).get();
      if(!cardDoc.exists) return cb?.({ ok: false, error: "Carte introuvable." });
      const card = cardDoc.data();
      if(isExpired(card)) return cb?.({ ok: false, error: "Carte expirée." });
      if(isSuspended(card)) return cb?.({ ok: false, error: "Carte suspendue — contacte l'Hôte." });
      if((card.balance || 0) < amt) return cb?.({ ok: false, error: "Solde insuffisant." });

      await adjustBalance({ cardId, amount: -amt, type: "mise", gameId: "blackjack", note: `Mise ${amt} jeton(s) au Blackjack` });
      table.seats.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
        cardId, steamId: socket.session.steamId, playerName: socket.session.playerName,
        bet: amt, hand: [], status: "waiting"
      });
      broadcast();
      cb?.({ ok: true });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });

  socket.on("table:blackjack:deal", (_payload, cb) => {
    if(!isCroupierOrAdmin(socket.session)) return cb?.({ ok: false, error: "Réservé au Croupier." });
    if(table.status !== "betting") return cb?.({ ok: false, error: "Ouvre d'abord les mises." });
    if(!table.seats.length) return cb?.({ ok: false, error: "Aucun joueur à la table." });
    table.seats.forEach(s => { s.hand = [randomCard(), randomCard()]; s.status = "playing"; });
    table.dealerHand = [randomCard(), randomCard()];
    table.hideSecond = true;
    table.status = "playing";
    broadcast();
    cb?.({ ok: true });
  });

  socket.on("table:blackjack:hit", async (_payload, cb) => {
    try{
      if(!isPlayer(socket.session)) return cb?.({ ok: false, error: "Non connecté." });
      if(table.status !== "playing") return cb?.({ ok: false, error: "La manche n'est pas en cours." });
      const seat = table.seats.find(s => s.cardId === socket.session.cardId);
      if(!seat || seat.status !== "playing") return cb?.({ ok: false, error: "Ce n'est pas ton tour." });
      seat.hand.push(randomCard());
      const total = handTotal(seat.hand);
      seat.status = total > 21 ? "bust" : "playing";
      broadcast();
      cb?.({ ok: true, bust: total > 21 });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });

  socket.on("table:blackjack:stand", (_payload, cb) => {
    if(!isPlayer(socket.session)) return cb?.({ ok: false, error: "Non connecté." });
    if(table.status !== "playing") return cb?.({ ok: false, error: "La manche n'est pas en cours." });
    const seat = table.seats.find(s => s.cardId === socket.session.cardId);
    if(!seat || seat.status !== "playing") return cb?.({ ok: false, error: "Ce n'est pas ton tour." });
    seat.status = "stand";
    broadcast();
    cb?.({ ok: true });
  });

  socket.on("table:blackjack:reveal", async (_payload, cb) => {
    try{
      if(!isCroupierOrAdmin(socket.session)) return cb?.({ ok: false, error: "Réservé au Croupier." });
      if(table.status !== "playing") return cb?.({ ok: false, error: "La manche n'est pas en cours." });
      if(table.seats.some(s => s.status === "playing")){
        return cb?.({ ok: false, error: "Certains joueurs n'ont pas fini leur tour (Tirer/Rester)." });
      }
      while(handTotal(table.dealerHand) < 17) table.dealerHand.push(randomCard());
      const dealerTotal = handTotal(table.dealerHand);
      const roundId = table.roundId;

      for(const seat of table.seats){
        const pTotal = handTotal(seat.hand);
        let outcome = "lose";
        if(pTotal > 21) outcome = "lose";
        else if(dealerTotal > 21) outcome = "win";
        else if(pTotal > dealerTotal) outcome = "win";
        else if(pTotal === dealerTotal) outcome = "push";
        else outcome = "lose";

        if(outcome === "win"){
          const blackjack = pTotal === 21 && seat.hand.length === 2;
          const payout = blackjack ? Math.floor(seat.bet * 2.5) : seat.bet * 2;
          try{
            await adjustBalance({
              cardId: seat.cardId, amount: payout, type: "gain", gameId: "blackjack",
              note: `Blackjack manche #${roundId} — ${pTotal} vs ${dealerTotal}`
            });
          }catch(e){ console.error("Paiement blackjack échoué :", e); }
        }else if(outcome === "push"){
          try{
            await adjustBalance({
              cardId: seat.cardId, amount: seat.bet, type: "gain", gameId: "blackjack",
              note: `Égalité (push) manche #${roundId}`
            });
          }catch(e){ console.error("Remboursement push échoué :", e); }
        }
        seat.status = outcome;
      }
      table.status = "result";
      table.hideSecond = false;
      broadcast();
      cb?.({ ok: true });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });
}
