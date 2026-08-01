/* Ascension Fulgurante — le point de crash n'est JAMAIS envoyé au client
   avant que le crash ne survienne réellement (contrairement à l'ancienne
   version où il était lisible dans Firestore dès le début de la manche).
   Le serveur tique le multiplicateur en mémoire et ne diffuse que sa valeur
   courante ; l'encaissement est validé contre le multiplicateur calculé
   côté serveur au moment de la demande, jamais contre une valeur du client. */
import { isCroupierOrAdmin, isPlayer } from "../../auth.js";
import { adjustBalance, isExpired, isSuspended } from "../cards.js";
import { addRake } from "../jackpot.js";
import { recordWager } from "../ranks.js";
import { getDb } from "../../db.js";

const TABLE_ID = "crash-1";
const ROOM = `table:${TABLE_ID}`;
const MAX_MULTIPLIER = 10;
const MAX_BET = 10;
const TICK_MS = 100;

let ioRef = null;
const table = { status: "waiting", roundId: 1, croupierName: null, startedAt: null, crashPoint: null, bets: [] };
let tickTimer = null;

/* Distribution resserrée vers le bas (exposant 1.6) — moins de tentation
   d'attendre un multiplicateur trop haut avant d'encaisser. */
function genCrashPoint(){
  const r = Math.pow(Math.random(), 1.6);
  const raw = Math.max(1, Math.floor((0.94 / (1 - r)) * 100) / 100);
  return Math.min(MAX_MULTIPLIER, raw);
}
function multiplierAt(elapsedSec){
  return Math.min(MAX_MULTIPLIER, 1 + Math.pow(elapsedSec, 1.32) * 0.09);
}
function currentMultiplier(){
  if(table.status !== "running" || !table.startedAt) return 1;
  const elapsed = (Date.now() - table.startedAt) / 1000;
  return multiplierAt(elapsed);
}

function publicState(){
  return {
    status: table.status, roundId: table.roundId, croupierName: table.croupierName,
    startedAt: table.startedAt,
    multiplier: table.status === "crashed" ? table.crashPoint : currentMultiplier(),
    bets: table.bets.map(b => ({
      id: b.id, cardId: b.cardId, playerName: b.playerName, amount: b.amount,
      cashedOut: b.cashedOut, cashOutMultiplier: b.cashOutMultiplier
    }))
  };
}
function broadcast(){ ioRef?.to(ROOM).emit("table:crash:state", publicState()); }

export function initCrash(io){ ioRef = io; }

function stopTick(){ if(tickTimer){ clearInterval(tickTimer); tickTimer = null; } }
function startTick(){
  stopTick();
  tickTimer = setInterval(async () => {
    const mult = currentMultiplier();
    if(mult >= table.crashPoint){
      stopTick();
      table.status = "crashed";
      table.bets.forEach(b => { if(!b.cashedOut) addRake(b.amount); });
      broadcast();
      return;
    }
    broadcast();
  }, TICK_MS);
}

export function registerCrashHandlers(io, socket){
  socket.on("table:crash:join", (_payload, cb) => {
    socket.join(ROOM);
    cb?.({ ok: true, state: publicState() });
  });
  socket.on("table:crash:leave", () => socket.leave(ROOM));

  socket.on("table:crash:newRound", (_payload, cb) => {
    if(!isCroupierOrAdmin(socket.session)) return cb?.({ ok: false, error: "Réservé au Croupier." });
    if(table.status === "running") return cb?.({ ok: false, error: "Une manche est déjà en cours." });
    stopTick();
    table.status = "waiting";
    table.roundId += 1;
    table.croupierName = socket.session.name;
    table.startedAt = null;
    table.crashPoint = genCrashPoint();
    table.bets = [];
    broadcast();
    cb?.({ ok: true });
  });

  socket.on("table:crash:bet", async ({ amount } = {}, cb) => {
    try{
      if(!isPlayer(socket.session)) return cb?.({ ok: false, error: "Non connecté." });
      if(table.status !== "waiting") return cb?.({ ok: false, error: "Attends que le Croupier ouvre les mises." });
      const amt = parseInt(amount, 10);
      if(!amt || amt <= 0) return cb?.({ ok: false, error: "Mise invalide." });
      if(amt > MAX_BET) return cb?.({ ok: false, error: "Mise maximum : 10 jetons." });
      const cardId = socket.session.cardId;
      if(table.bets.some(b => b.cardId === cardId)) return cb?.({ ok: false, error: "Tu as déjà misé sur cette manche." });

      const db = await getDb();
      const card = await db.collection("playerCards").findOne({ _id: cardId });
      if(!card) return cb?.({ ok: false, error: "Carte introuvable." });
      if(isExpired(card)) return cb?.({ ok: false, error: "Carte expirée." });
      if(isSuspended(card)) return cb?.({ ok: false, error: "Carte suspendue — contacte l'Hôte." });
      if((card.balance || 0) < amt) return cb?.({ ok: false, error: "Solde insuffisant." });

      await adjustBalance({ cardId, amount: -amt, type: "mise", gameId: "crash", note: `Mise ${amt} jeton(s) — Ascension Fulgurante` });
      const rankUp = await recordWager(cardId, amt);
      table.bets.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
        cardId, steamId: socket.session.steamId, playerName: socket.session.playerName,
        amount: amt, cashedOut: false, cashOutMultiplier: null
      });
      broadcast();
      cb?.({ ok: true, rankUp });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });

  socket.on("table:crash:launch", (_payload, cb) => {
    if(!isCroupierOrAdmin(socket.session)) return cb?.({ ok: false, error: "Réservé au Croupier." });
    if(table.status !== "waiting") return cb?.({ ok: false, error: "Aucune manche en attente." });
    table.status = "running";
    table.startedAt = Date.now();
    broadcast();
    startTick();
    cb?.({ ok: true });
  });

  socket.on("table:crash:cashout", async (_payload, cb) => {
    try{
      if(!isPlayer(socket.session)) return cb?.({ ok: false, error: "Non connecté." });
      if(table.status !== "running") return cb?.({ ok: false, error: "Aucune manche en cours." });
      const bet = table.bets.find(b => b.cardId === socket.session.cardId);
      if(!bet || bet.cashedOut) return cb?.({ ok: false, error: "Aucune mise active." });
      const mult = currentMultiplier();
      if(mult >= table.crashPoint) return cb?.({ ok: false, error: "Trop tard — déjà crashé." });
      bet.cashedOut = true;
      bet.cashOutMultiplier = mult;
      const payout = Math.floor(bet.amount * mult);
      const balanceAfter = await adjustBalance({
        cardId: bet.cardId, amount: payout, type: "gain", gameId: "crash",
        note: `Encaissé à ${mult.toFixed(2)}×`
      });
      broadcast();
      cb?.({ ok: true, multiplier: mult, payout, balanceAfter });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });
}
