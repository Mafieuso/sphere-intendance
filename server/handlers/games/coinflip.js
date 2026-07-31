import { isPlayer } from "../../auth.js";
import { adjustBalance, isExpired, isSuspended } from "../cards.js";
import { addRake } from "../jackpot.js";
import { recordWager } from "../ranks.js";
import { getDb } from "../../db.js";

export function registerCoinflipHandlers(io, socket){
  socket.on("game:coinflip:play", async ({ choice, bet } = {}, cb) => {
    try{
      if(!isPlayer(socket.session)) return cb?.({ ok: false, error: "Non connecté." });
      if(!["pile", "face"].includes(choice)) return cb?.({ ok: false, error: "Choix invalide." });
      const amount = parseInt(bet, 10);
      if(!amount || amount < 2) return cb?.({ ok: false, error: "Mise minimum : 2 jetons." });

      const cardId = socket.session.cardId;
      const db = await getDb();
      const card = await db.collection("playerCards").findOne({ _id: cardId });
      if(!card) return cb?.({ ok: false, error: "Carte introuvable." });
      if(isExpired(card)) return cb?.({ ok: false, error: "Carte expirée — repasse à la caisse." });
      if(isSuspended(card)) return cb?.({ ok: false, error: "Carte suspendue — contacte l'Hôte." });
      if((card.balance || 0) < amount) return cb?.({ ok: false, error: "Solde de jetons insuffisant." });

      addRake(amount);
      const rankUp = await recordWager(cardId, amount);
      const outcome = Math.random() < 0.5 ? "pile" : "face";
      const win = outcome === choice;
      const net = win ? Math.round(amount * 0.5) : -amount;
      const balanceAfter = await adjustBalance({
        cardId, amount: net, type: win ? "gain" : "perte", gameId: "coinflip",
        note: `Mise ${amount} jeton(s) sur ${choice}, résultat ${outcome}`
      });
      cb?.({ ok: true, outcome, win, net, balanceAfter, rankUp });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });
}
