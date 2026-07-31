/* Widget Jackpot partagé — un badge flottant identique sur toutes les pages
   de jeu, la carte joueur et la Salle en Direct, pour que la cagnotte se
   voie grimper en direct peu importe où l'on se trouve. */
import { request, on, onReconnect } from "./api.js";
import { toast } from "./toast.js";
import { formatYen, tokensToYen } from "./economy.js";
import { countUp, jackpotBurst } from "./uiFx.js";

export function mountJackpotWidget({ canSubscribe = false } = {}){
  if(document.getElementById("jackpotWidget")) return; // évite un doublon si appelé plusieurs fois
  const el = document.createElement("div");
  el.id = "jackpotWidget";
  el.className = "jackpot-widget";
  el.innerHTML = `
    <div class="jackpot-label">🎰 Jackpot</div>
    <div class="jackpot-amount"><span id="jackpotPoolNum">0</span> 🪙</div>
    <div class="jackpot-yen" id="jackpotYen">≈ 0 ¥</div>
    ${canSubscribe ? `<button class="btn btn-gold btn-sm btn-block" id="jackpotSubBtn">S'inscrire (10 🪙)</button>` : ''}
  `;
  document.body.appendChild(el);

  let lastPool = 0;
  function renderPool(pool, animate){
    const numEl = document.getElementById("jackpotPoolNum");
    if(numEl){ animate ? countUp(numEl, lastPool, pool) : (numEl.textContent = pool.toLocaleString('fr-FR')); }
    document.getElementById("jackpotYen").textContent = `≈ ${formatYen(tokensToYen(pool))}`;
    lastPool = pool;
  }
  function renderSubscribed(subscribed){
    if(!canSubscribe) return;
    const btn = document.getElementById("jackpotSubBtn");
    if(!btn) return;
    btn.textContent = subscribed ? "✓ Inscrit" : "S'inscrire (10 🪙)";
    btn.disabled = subscribed;
  }

  on("jackpot:state", (state) => {
    renderPool(state.pool, true);
    el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse');
  });
  on("jackpot:won", ({ playerName, payout }) => {
    toast(`🎰 JACKPOT remporté par ${playerName} ! +${payout} 🪙`, "success");
    const r = el.getBoundingClientRect();
    jackpotBurst(r.left + r.width/2, r.top + r.height/2);
  });

  function join(){
    request("jackpot:join").then(res => {
      renderPool(res.state.pool, false);
      renderSubscribed(res.state.subscribed);
    }).catch(() => {});
  }
  join();
  onReconnect(join);

  if(canSubscribe){
    document.getElementById("jackpotSubBtn")?.addEventListener("click", async (e) => {
      e.target.disabled = true;
      try{
        await request("jackpot:subscribe");
        toast("Inscrit au Jackpot !", "success");
        renderSubscribed(true);
      }catch(err){
        toast(err.message, "error");
        e.target.disabled = false;
      }
    });
  }
}
