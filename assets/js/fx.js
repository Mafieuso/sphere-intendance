/* Effets atmosphériques partagés : braises animées + particules dorées.
   Attend un <canvas id="embers"> et un <div class="particles"> dans la page. */
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
  for(let i=0;i<40;i++){ const e=spawn(); e.y=Math.random()*h; embers.push(e); }

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
  for(let i=0;i<32;i++){
    const p = document.createElement('div');
    const size = Math.random()*3+1, x = Math.random()*100, delay = Math.random()*20, dur = Math.random()*18+12;
    const opacity = Math.random()*.4+.08;
    const col = Math.random()<.6 ? `rgba(220,${Math.floor(Math.random()*60)},0,${opacity})` : `rgba(240,${Math.floor(Math.random()*100+160)},${Math.floor(Math.random()*40)},${opacity})`;
    p.style.cssText = `position:fixed;border-radius:50%;pointer-events:none;z-index:0;left:${x}%;width:${size}px;height:${size}px;background:${col};box-shadow:0 0 ${size*3}px ${col};animation:floatUp ${dur}s ${delay}s infinite linear;`;
    container.appendChild(p);
  }
}

export function initFx(){
  initEmbers();
  spawnParticles();
}
