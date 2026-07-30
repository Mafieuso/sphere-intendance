/* Taux de change officiel de la maison : 1 jeton = 50 000 ¥.
   Toutes les conversions Yens <-> jetons passent par ce module. */
export const YEN_PER_TOKEN = 50000;

export function tokensToYen(tokens){
  return Math.round((tokens || 0) * YEN_PER_TOKEN);
}

export function yenToTokens(yen){
  return Math.floor((yen || 0) / YEN_PER_TOKEN);
}

/* Formatage compact : 1 200 000 -> "1,2M ¥" ; sinon "123 456 ¥" */
export function formatYen(yen){
  const n = Math.round(yen || 0);
  const abs = Math.abs(n);
  if(abs >= 1000000) return (n/1000000).toLocaleString('fr-FR', {maximumFractionDigits:1}) + "M ¥";
  return n.toLocaleString('fr-FR') + " ¥";
}

export function formatTokens(tokens){
  return (tokens || 0).toLocaleString('fr-FR');
}

/* Bloc HTML prêt à l'emploi : 🪙 1 234 jetons — ≈ 61 700 000 ¥ */
export function tokenDisplayHTML(tokens, { small = false } = {}){
  const yen = tokensToYen(tokens);
  return `<span class="token-display"><span class="chip-icon">🪙</span><span class="token-num">${formatTokens(tokens)}</span>${small ? '' : `<span class="yen-equiv">≈ ${formatYen(yen)}</span>`}</span>`;
}
