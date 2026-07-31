/* Rangs de fidélité — basés sur le total misé à vie (pas le solde ni le
   profit, pour ne jamais pénaliser une série de pertes) : plus on joue,
   plus on monte, indépendamment du résultat. */
import { getDb } from "../db.js";

export const RANKS = [
  { key: "visiteur", label: "Visiteur", threshold: 0 },
  { key: "habitue", label: "Habitué", threshold: 100 },
  { key: "invite_honneur", label: "Invité d'Honneur", threshold: 500 },
  { key: "actionnaire", label: "Actionnaire", threshold: 2000 },
  { key: "grand_mecene", label: "Grand Mécène", threshold: 5000 },
];

export function rankForWagered(totalWagered){
  let current = RANKS[0];
  for(const r of RANKS){ if((totalWagered || 0) >= r.threshold) current = r; }
  return current;
}

/* Enregistre une mise sur le total à vie du joueur et détecte un passage
   de rang. Retourne le libellé du nouveau rang si on vient de le franchir,
   sinon null — l'appelant l'inclut dans sa réponse pour que le client
   célèbre localement (jamais de diffusion publique : chaque joueur ne
   voit que sa propre progression). */
export async function recordWager(cardId, amount){
  try{
    const db = await getDb();
    const res = await db.collection("playerCards").findOneAndUpdate(
      { _id: cardId },
      { $inc: { totalWagered: amount } },
      { returnDocument: "after", includeResultMetadata: true }
    );
    const after = res.value;
    if(!after) return null;
    const newWagered = after.totalWagered || 0;
    const prevWagered = newWagered - amount;
    const prevRank = rankForWagered(prevWagered);
    const newRank = rankForWagered(newWagered);
    return newRank.key !== prevRank.key ? newRank.label : null;
  }catch(e){ console.error("recordWager a échoué :", e); return null; }
}
