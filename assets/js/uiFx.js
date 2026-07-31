/* Effets d'interface partagés : tilt 3D, compteurs animés, confettis,
   entrée échelonnée, traînée de curseur. Purement cosmétique — n'affecte
   jamais la logique métier. */
import { tokenDisplayHTML } from "./economy.js";

/* Les cartes de menu/navigation (gate-card, table-card, game-tile) sont exclues :
   le tilt qui suit la souris donnait l'impression que les menus "bougeaient" en
   permanence, ce qui était gênant. Elles gardent un simple hover CSS statique. */
const TILT_SEL = '.panel,.stat-card,.card-visual,.card-result';

export function initTilt(){
  let current = null;
  document.addEventListener('mousemove', (e) => {
    const card = e.target.closest(TILT_SEL);
    if(card !== current){
      if(current){ current.style.transform = ''; current.classList.remove('wow-tilt-active'); }
      if(card){
        if(getComputedStyle(card).position === 'static') card.style.position = 'relative';
        if(!card.querySelector(':scope > .wow-sheen')){
          const sh = document.createElement('div'); sh.className = 'wow-sheen'; card.appendChild(sh);
        }
      }
      current = card;
    }
    if(!card) return;
    const r = card.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    const rx = (py - .5) * -4, ry = (px - .5) * 4;
    card.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg) translateY(-2px)`;
    card.classList.add('wow-tilt-active');
    card.style.setProperty('--mx', (px*100)+'%');
    card.style.setProperty('--my', (py*100)+'%');
  });
  document.addEventListener('mouseleave', () => {
    if(current){ current.style.transform = ''; current.classList.remove('wow-tilt-active'); current = null; }
  }, true);
}

/* Compte de 0 à target en douceur pour les éléments .stat-val */
export function animateCounters(root = document){
  root.querySelectorAll('.stat-val[data-count]').forEach(el => {
    const target = parseInt(el.dataset.count, 10) || 0;
    let current = 0;
    const step = Math.max(1, Math.ceil(target / 30));
    const t = setInterval(() => {
      current = Math.min(current + step, target);
      el.textContent = current.toLocaleString('fr-FR');
      if(current >= target) clearInterval(t);
    }, 25);
  });
}

/* Entrée échelonnée pour un ensemble d'éléments (cartes, lignes...) */
export function staggerIn(selector, root = document){
  root.querySelectorAll(selector).forEach((el, i) => {
    el.style.animationDelay = `${i * 0.05}s`;
    el.classList.add('wow-in');
  });
}

/* Anime le texte d'un élément d'une valeur numérique à une autre (compteur qui défile). */
export function countUp(el, from, to, { duration = 700 } = {}){
  if(!el) return;
  const startVal = Number(from) || 0, delta = (Number(to) || 0) - startVal;
  if(delta === 0){ el.textContent = startVal.toLocaleString('fr-FR'); return; }
  const start = performance.now();
  function frame(now){
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(startVal + delta * eased).toLocaleString('fr-FR');
    if(t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

/* Met à jour une pastille de solde (balance-pill) avec un défilement du chiffre
   et un léger pulse, plutôt qu'un saut instantané — utilisé sur chaque gain/perte. */
export function animateTokenPill(el, fromTokens, toTokens, opts = {}){
  if(!el) return;
  el.innerHTML = tokenDisplayHTML(toTokens, opts);
  const numEl = el.querySelector('.token-num');
  if(numEl) countUp(numEl, fromTokens, toTokens);
  el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse');
}

/* Anneau lumineux qui s'étend et s'efface, pour accompagner une victoire. */
export function ringPulse(x, y, color = '#f5d870'){
  const r = document.createElement('div');
  r.className = 'wow-ring';
  r.style.cssText = `left:${x}px;top:${y}px;border-color:${color};`;
  document.body.appendChild(r);
  setTimeout(() => r.remove(), 750);
}

/* Explosion de particules dorées/vertes à un point précis de l'écran (victoire, création, etc.) */
export function burst(x, y, { count = 22, colors = ['#f5d870','#c9a227','#5ee0af'] } = {}){
  ringPulse(x, y, colors[0]);
  for(let i = 0; i < count; i++){
    const s = document.createElement('div');
    s.className = 'wow-burst';
    const size = Math.random()*5+3;
    const angle = Math.random()*Math.PI*2, dist = Math.random()*160+50;
    const color = colors[Math.floor(Math.random()*colors.length)];
    s.style.cssText = `width:${size}px;height:${size}px;left:${x}px;top:${y}px;
      background:radial-gradient(circle,${color},transparent 70%);
      --dx:${Math.cos(angle)*dist}px;--dy:${Math.sin(angle)*dist}px;--rot:${Math.random()*360}deg;`;
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 950);
  }
}

/* Secousse de feedback sur une perte — le jeu réagit aussi quand ça ne
   passe pas, pas seulement sur les victoires. */
export function shake(el){
  if(!el) return;
  el.classList.remove('wow-shake'); void el.offsetWidth; el.classList.add('wow-shake');
}

/* Flash plein écran + confettis plus généreux, réservé aux gros gains
   (blackjack naturel, numéro plein, gros multiplicateur). */
export function jackpotBurst(x, y, opts = {}){
  const f = document.createElement('div');
  f.className = 'wow-flash';
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 650);
  burst(x, y, { count: 44, colors: ['#f5d870','#c9a227','#5ee0af','#66c0f4'], ...opts });
}

/* Traînée de particules douces suivant le curseur (désactivée sur tactile) */
export function initCursorTrail(){
  if(matchMedia('(pointer:coarse)').matches) return;
  let last = 0;
  document.addEventListener('mousemove', (e) => {
    const now = performance.now();
    if(now - last < 40) return; last = now;
    const t = document.createElement('div');
    t.className = 'wow-trail';
    t.style.transform = `translate(${e.clientX}px,${e.clientY}px)`;
    document.body.appendChild(t);
    requestAnimationFrame(() => {
      t.style.transition = 'transform .5s ease-out,opacity .5s ease-out';
      t.style.transform += ' translateY(-10px) scale(.2)';
      t.style.opacity = '0';
    });
    setTimeout(() => t.remove(), 550);
  });
}

export function initUiFx({ tilt = true, cursorTrail = true } = {}){
  if(tilt) initTilt();
  if(cursorTrail) initCursorTrail();
}
