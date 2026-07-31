import { isPlayer } from "../../auth.js";
import { adjustBalance, isExpired, isSuspended } from "../cards.js";
import { getDb } from "../../db.js";

export function registerDiceHandlers(io, socket){
  socket.on("game:dice:play", async ({ choice, bet } = {}, cb) => {
    try{
      if(!isPlayer(socket.session)) return cb?.({ ok: false, error: "Non connecté." });
      const num = parseInt(choice, 10);
      if(!num || num < 1 || num > 6) return cb?.({ ok: false, error: "Choisis un chiffre de 1 à 6." });
      const amount = parseInt(bet, 10);
      if(!amount || amount <= 0) return cb?.({ ok: false, error: "Mise invalide." });

      const cardId = socket.session.cardId;
      const db = await getDb();
      const card = await db.collection("playerCards").findOne({ _id: cardId });
      if(!card) return cb?.({ ok: false, error: "Carte introuvable." });
      if(isExpired(card)) return cb?.({ ok: false, error: "Carte expirée — repasse à la caisse." });
      if(isSuspended(card)) return cb?.({ ok: false, error: "Carte suspendue — contacte l'Hôte." });
      if((card.balance || 0) < amount) return cb?.({ ok: false, error: "Solde de jetons insuffisant." });

      const roll = Math.floor(Math.random() * 6) + 1;
      const win = roll === num;
      const net = win ? amount * 4 : -amount;
      const balanceAfter = await adjustBalance({
        cardId, amount: net, type: win ? "gain" : "perte", gameId: "dice",
        note: `Mise ${amount} jeton(s) sur ${num}, résultat ${roll}`
      });
      cb?.({ ok: true, roll, win, net, balanceAfter });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });
}
