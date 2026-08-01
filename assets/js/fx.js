/* Effets atmosphériques partagés : braises animées + particules dorées.
   Attend un <canvas id="embers"> et un <div class="particles"> dans la page. */
import { playWhoosh, mountSoundToggle, initClickSounds } from "./sound.js";
export function initEmbers(){
  const cv = document.getElementById('embers');
  if(!cv) return;
  const ctx = cv.getContext('2d');
  let w, h, embers = [];
  function resize(){ w = cv.width = innerWidth; h = cv.height = innerHeight; }
  resize(); addEventListener('resize', resize);

  function spawn(){
    return { x: Math.random()*w, y: h+20, r: Math.random()*2+.6,
      vy: -(Math.random()*.5+.25), vx:(Math.random()-.5)*.4,
      life:0, maxLife: Math.random()*500+400, hue: Math.random()<.7?18:45, alpha: Math.random()*.5+.3 };
  }
  for(let i=0;i<55;i++){ const e=spawn(); e.y=Math.random()*h; embers.push(e); }

  let last = performance.now();
  function frame(now){
    const dt = Math.min(now-last, 50); last = now;
    ctx.clearRect(0,0,w,h);
    embers.forEach((e,i)=>{
      e.life+=dt; e.x+=e.vx; e.y+=e.vy; e.vx+=(Math.random()-.5)*.02;
      const t=e.life/e.maxLife, fade = t<.1?t/.1 : t>.75?(1-t)/.25 : 1;
      const col = e.hue===18 ? `rgba(255,90,20,${e.alpha*fade})` : `rgba(255,190,80,${e.alpha*fade})`;
      ctx.beginPath(); ctx.fillStyle=col; ctx.shadowColor=col; ctx.shadowBlur=e.r*4;
      ctx.arc(e.x,e.y,e.r,0,7); ctx.fill(); ctx.shadowBlur=0;
      if(e.life>=e.maxLife || e.y<-10) embers[i]=spawn();
    });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

export function spawnParticles(){
  const container = document.querySelector('.particles');
  if(!container) return;
  for(let i=0;i<45;i++){
    const p = document.createElement('div');
    const size = Math.random()*3+1, x = Math.random()*100, delay = Math.random()*20, dur = Math.random()*18+12;
    const opacity = Math.random()*.4+.08;
    const col = Math.random()<.6 ? `rgba(220,${Math.floor(Math.random()*60)},0,${opacity})` : `rgba(240,${Math.floor(Math.random()*100+160)},${Math.floor(Math.random()*40)},${opacity})`;
    p.style.cssText = `position:fixed;border-radius:50%;pointer-events:none;z-index:0;left:${x}%;width:${size}px;height:${size}px;background:${col};box-shadow:0 0 ${size*3}px ${col};animation:floatUp ${dur}s ${delay}s infinite linear;`;
    container.appendChild(p);
  }
}

/* Symboles de jeu (cartes, mahjong, dés) qui dérivent lentement en fond —
   réservé à l'accueil, pour ne pas alourdir visuellement les pages de jeu. */
export function spawnSuitSymbols(){
  const container = document.querySelector('.particles');
  if(!container) return;
  const glyphs = ['♠', '♥', '♦', '♣', '🀄', '🎲'];
  for(let i = 0; i < 14; i++){
    const s = document.createElement('div');
    const x = Math.random() * 100, delay = Math.random() * 25, dur = Math.random() * 22 + 18, size = Math.random() * 10 + 14;
    const glyph = glyphs[Math.floor(Math.random() * glyphs.length)];
    const isRed = glyph === '♥' || glyph === '♦';
    s.textContent = glyph;
    s.style.cssText = `position:fixed;left:${x}%;bottom:-40px;font-size:${size}px;
      color:${isRed ? '#b3121a' : '#c9a227'};pointer-events:none;z-index:0;
      animation:suitFloat ${dur}s ${delay}s infinite linear;`;
    container.appendChild(s);
  }
}

/* Rails ornementaux gauche/droite — décorent le vide des grands écrans
   (masqués en CSS sous 1300px). Site-wide via initFx(). */
const RAIL_GLYPHS = ['♠', '扇', '♦', '鶴', '♣', '宝'];
export function mountSideRails(){
  if(document.getElementById('sideRailLeft')) return;
  ['left', 'right'].forEach(side => {
    const rail = document.createElement('div');
    rail.id = side === 'left' ? 'sideRailLeft' : 'sideRailRight';
    rail.className = `side-rail side-rail-${side}`;
    RAIL_GLYPHS.forEach((g, i) => {
      const m = document.createElement('div');
      m.className = 'side-rail-medallion';
      m.textContent = g;
      m.style.animationDelay = `${i * .6}s`;
      rail.appendChild(m);
    });
    document.body.appendChild(rail);
  });
}

/* Transition de page — un voile qui se dissipe à l'arrivée et se referme
   juste avant de quitter la page (liens internes, même origine, clic
   simple), pour éviter le "saut" instantané entre deux pages. */
export function initPageTransitions(){
  const enter = document.createElement('div');
  enter.className = 'page-transition-overlay pt-visible';
  document.body.appendChild(enter);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => { enter.classList.remove('pt-visible'); });
  });
  setTimeout(() => enter.remove(), 550);

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if(!a || e.defaultPrevented) return;
    if(a.target === '_blank' || a.hasAttribute('download')) return;
    if(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    const hrefAttr = a.getAttribute('href') || '';
    if(!hrefAttr || hrefAttr.startsWith('#') || hrefAttr.startsWith('javascript:')) return;
    let url;
    try{ url = new URL(a.href, location.href); }catch{ return; }
    if(url.origin !== location.origin) return;
    e.preventDefault();
    playWhoosh();
    const exit = document.createElement('div');
    exit.className = 'page-transition-overlay';
    document.body.appendChild(exit);
    requestAnimationFrame(() => { exit.classList.add('pt-visible'); });
    setTimeout(() => { location.href = a.href; }, 320);
  });
}

export function initFx(){
  initEmbers();
  spawnParticles();
  initPageTransitions();
  mountSideRails();
  mountSoundToggle();
  initClickSounds();
  import("./assistant.js").then(m => m.mountAssistant());
}
