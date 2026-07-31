/* Rangs de fidélité — miroir côté client de server/handlers/ranks.js
   (basé sur le total misé à vie, jamais le solde ni le profit). */
import { toast } from "./toast.js";
import { jackpotBurst } from "./uiFx.js";

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

export function nextRank(totalWagered){
  const current = rankForWagered(totalWagered);
  const idx = RANKS.findIndex(r => r.key === current.key);
  return RANKS[idx + 1] || null;
}

/* Panneau de progression compact — rang actuel + barre vers le prochain. */
export function rankProgressHTML(totalWagered){
  const current = rankForWagered(totalWagered);
  const next = nextRank(totalWagered);
  const pct = next ? Math.min(100, Math.round(((totalWagered - current.threshold) / (next.threshold - current.threshold)) * 100)) : 100;
  return `
    <div class="rank-badge">${current.label}</div>
    ${next
      ? `<div class="rank-bar"><div class="rank-bar-fill" style="width:${pct}%"></div></div>
         <div class="rank-next">${totalWagered.toLocaleString('fr-FR')} / ${next.threshold.toLocaleString('fr-FR')} 🪙 misés — prochain rang : ${next.label}</div>`
      : `<div class="rank-next">Rang maximum atteint !</div>`
    }
  `;
}

/* Célébration locale d'un passage de rang — appelé quand une réponse de
   jeu contient un champ "rankUp" non nul. Jamais public : chaque joueur
   ne voit que sa propre progression. */
export function celebrateRankUp(rankLabel){
  if(!rankLabel) return;
  toast(`🎖 Nouveau rang : ${rankLabel} !`, "success");
  jackpotBurst(window.innerWidth / 2, window.innerHeight / 2);
}
