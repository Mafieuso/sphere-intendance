/* Ambiance sonore — entièrement synthétisée via Web Audio (oscillateurs +
   bruit filtré), donc zéro fichier audio à héberger et zéro coût. Les
   navigateurs bloquant tout son avant un premier geste utilisateur, le
   AudioContext n'est créé/réveillé qu'au premier clic ou touche pressée. */

let ctx = null;
let muted = localStorage.getItem("sphereIntendanceSoundMuted") === "1";

function ensureCtx(){
  if(ctx) return ctx;
  try{ ctx = new (window.AudioContext || window.webkitAudioContext)(); }catch{ return null; }
  return ctx;
}

function unlock(){
  const c = ensureCtx();
  if(c && c.state === "suspended") c.resume().catch(() => {});
}
document.addEventListener("pointerdown", unlock, { once: true });
document.addEventListener("keydown", unlock, { once: true });

function tone(freq, { duration = .15, type = "sine", gain = .15, delay = 0, glideTo = null } = {}){
  if(muted) return;
  const c = ensureCtx();
  if(!c || c.state === "suspended") return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if(glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + duration);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + .01);
  g.gain.exponentialRampToValueAtTime(.0001, t0 + duration);
  osc.connect(g); g.connect(c.destination);
  osc.start(t0); osc.stop(t0 + duration + .05);
}

export function playClick(){ tone(880, { duration: .05, type: "square", gain: .05 }); }

export function playWhoosh(){
  if(muted) return;
  const c = ensureCtx();
  if(!c || c.state === "suspended") return;
  const t0 = c.currentTime;
  const bufferSize = Math.floor(c.sampleRate * .3);
  const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
  const data = buffer.getChannelData(0);
  for(let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  const noise = c.createBufferSource();
  noise.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(600, t0);
  filter.frequency.exponentialRampToValueAtTime(2200, t0 + .3);
  const g = c.createGain();
  g.gain.setValueAtTime(.12, t0);
  g.gain.exponentialRampToValueAtTime(.0001, t0 + .3);
  noise.connect(filter); filter.connect(g); g.connect(c.destination);
  noise.start(t0); noise.stop(t0 + .3);
}

export function playCoin(){
  tone(1046.5, { duration: .12, type: "sine", gain: .14 });
  tone(1568, { duration: .18, type: "sine", gain: .12, delay: .07 });
}

export function playThud(){
  tone(140, { duration: .22, type: "sine", gain: .18, glideTo: 60 });
}

export function playGong(){
  tone(196, { duration: 1.8, type: "sine", gain: .14 });
  tone(293.7, { duration: 1.6, type: "sine", gain: .08, delay: .03 });
  tone(392, { duration: 1.4, type: "sine", gain: .06, delay: .06 });
}

export function playFanfare(){
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, { duration: .35, type: "triangle", gain: .13, delay: i * .09 }));
}

export function isSoundMuted(){ return muted; }
export function setSoundMuted(v){
  muted = v;
  localStorage.setItem("sphereIntendanceSoundMuted", v ? "1" : "0");
}

/* Petit bouton flottant en haut à gauche (seul coin encore libre : le
   bandeau Jackpot prend le haut, la mascotte le bas-gauche, les toasts le
   bas-droite) pour couper/rétablir le son à tout moment. */
export function mountSoundToggle(){
  if(document.getElementById("soundToggle")) return;
  const btn = document.createElement("button");
  btn.id = "soundToggle";
  btn.className = "sound-toggle";
  btn.setAttribute("aria-label", "Activer/couper le son");
  btn.textContent = muted ? "🔇" : "🔊";
  btn.addEventListener("click", () => {
    setSoundMuted(!muted);
    btn.textContent = muted ? "🔇" : "🔊";
    if(!muted) playClick();
  });
  document.body.appendChild(btn);
}

/* Petit tic sur chaque bouton cliqué, site-wide — les liens (transitions de
   page) ont déjà leur propre whoosh, donc exclus ici pour ne pas cumuler. */
export function initClickSounds(){
  document.addEventListener("click", (e) => {
    const el = e.target.closest("button, .btn");
    if(!el || el.id === "soundToggle") return;
    playClick();
  });
}
