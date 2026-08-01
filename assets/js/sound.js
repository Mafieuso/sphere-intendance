/* Ambiance sonore — entièrement synthétisée via Web Audio (oscillateurs +
   bruit filtré), donc zéro fichier audio à héberger et zéro coût. Les
   navigateurs bloquant tout son avant un premier geste utilisateur, le
   AudioContext n'est créé/réveillé qu'au premier clic ou touche pressée.

   Volontairement discret : les effets (clic, victoire, défaite...) sont à
   faible gain, et une nappe d'ambiance très douce tourne en fond, réglable
   (curseur) ou coupable d'un clic — jamais imposée à plein volume. */

let ctx = null;
let muted = localStorage.getItem("sphereIntendanceSoundMuted") === "1";
let volume = parseFloat(localStorage.getItem("sphereIntendanceSoundVolume"));
if(!Number.isFinite(volume)) volume = .12;

function effectiveVolume(){ return muted ? 0 : volume; }

function ensureCtx(){
  if(ctx) return ctx;
  try{ ctx = new (window.AudioContext || window.webkitAudioContext)(); }catch{ return null; }
  return ctx;
}

function unlock(){
  const c = ensureCtx();
  if(c && c.state === "suspended") c.resume().catch(() => {});
  startAmbience();
}
document.addEventListener("pointerdown", unlock, { once: true });
document.addEventListener("keydown", unlock, { once: true });

function tone(freq, { duration = .15, type = "sine", gain = .1, delay = 0, glideTo = null } = {}){
  const v = effectiveVolume();
  if(v <= 0) return;
  const c = ensureCtx();
  if(!c || c.state === "suspended") return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if(glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + duration);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain * v, t0 + .01);
  g.gain.exponentialRampToValueAtTime(.0001, t0 + duration);
  osc.connect(g); g.connect(c.destination);
  osc.start(t0); osc.stop(t0 + duration + .05);
}

export function playClick(){ tone(880, { duration: .04, type: "square", gain: .3 }); }

export function playWhoosh(){
  const v = effectiveVolume();
  if(v <= 0) return;
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
  g.gain.setValueAtTime(.7 * v, t0);
  g.gain.exponentialRampToValueAtTime(.0001, t0 + .3);
  noise.connect(filter); filter.connect(g); g.connect(c.destination);
  noise.start(t0); noise.stop(t0 + .3);
}

export function playCoin(){
  tone(1046.5, { duration: .12, type: "sine", gain: .09 });
  tone(1568, { duration: .18, type: "sine", gain: .07, delay: .07 });
}

export function playThud(){
  tone(140, { duration: .22, type: "sine", gain: .12, glideTo: 60 });
}

export function playGong(){
  tone(196, { duration: 1.8, type: "sine", gain: .1 });
  tone(293.7, { duration: 1.6, type: "sine", gain: .05, delay: .03 });
  tone(392, { duration: 1.4, type: "sine", gain: .04, delay: .06 });
}

export function playFanfare(){
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, { duration: .35, type: "triangle", gain: .08, delay: i * .09 }));
}

/* ── Nappe d'ambiance de fond — accord suspendu très doux (pas une
   mélodie), qui "respire" lentement (LFO sur le volume) plutôt que de
   rester figé. Démarre au premier geste utilisateur (unlock), s'arrête
   proprement si coupé, reprend si le son est rétabli. */
let ambience = null;

function startAmbience(){
  if(ambience || muted || volume <= 0) return;
  const c = ensureCtx();
  if(!c || c.state === "suspended") return;
  const master = c.createGain();
  master.gain.setValueAtTime(0, c.currentTime);
  master.gain.linearRampToValueAtTime(.16 * volume, c.currentTime + 2.5);
  master.connect(c.destination);

  const lfo = c.createOscillator();
  const lfoGain = c.createGain();
  lfo.frequency.value = .06;
  lfoGain.gain.value = .05 * volume;
  lfo.connect(lfoGain); lfoGain.connect(master.gain);
  lfo.start();

  const notes = [98, 146.83, 220, 293.66]; // Sol1-Ré2-La2-Ré3 : accord suspendu, feutré
  const oscs = notes.map((f, i) => {
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.value = f * (1 + (i === 2 ? .003 : 0)); // très léger battement sur une voix
    const g = c.createGain();
    g.gain.value = i === 0 ? .5 : .22;
    osc.connect(g); g.connect(master);
    osc.start();
    return osc;
  });

  ambience = { master, lfo, oscs };
}

function stopAmbience(){
  if(!ambience) return;
  const c = ctx;
  const { master, lfo, oscs } = ambience;
  if(c){
    master.gain.cancelScheduledValues(c.currentTime);
    master.gain.linearRampToValueAtTime(.0001, c.currentTime + .8);
  }
  setTimeout(() => {
    try{ lfo.stop(); oscs.forEach(o => o.stop()); }catch{}
  }, 900);
  ambience = null;
}

function applyVolumeToAmbience(){
  if(!ambience || !ctx) return;
  ambience.master.gain.cancelScheduledValues(ctx.currentTime);
  ambience.master.gain.linearRampToValueAtTime(.16 * effectiveVolume(), ctx.currentTime + .3);
}

export function isSoundMuted(){ return muted; }
export function getSoundVolume(){ return volume; }

export function setSoundMuted(v){
  muted = v;
  localStorage.setItem("sphereIntendanceSoundMuted", v ? "1" : "0");
  if(muted) stopAmbience(); else startAmbience();
  applyVolumeToAmbience();
}

export function setSoundVolume(v){
  volume = Math.max(0, Math.min(1, v));
  localStorage.setItem("sphereIntendanceSoundVolume", String(volume));
  if(volume <= 0){ stopAmbience(); }
  else if(!muted && !ambience){ startAmbience(); }
  applyVolumeToAmbience();
}

/* Petit contrôle flottant en haut à gauche (seul coin encore libre : le
   bandeau Jackpot prend le haut, la mascotte le bas-gauche, les toasts le
   bas-droite) — icône pour couper/rétablir + curseur pour ajuster. */
export function mountSoundToggle(){
  if(document.getElementById("soundControl")) return;
  const wrap = document.createElement("div");
  wrap.id = "soundControl";
  wrap.className = "sound-control";
  wrap.innerHTML = `
    <button id="soundMuteBtn" aria-label="Couper/rétablir le son">${muted || volume <= 0 ? "🔇" : "🔊"}</button>
    <input type="range" id="soundVolumeSlider" min="0" max="100" value="${Math.round(volume * 100)}" aria-label="Volume">
  `;
  document.body.appendChild(wrap);

  const btn = wrap.querySelector("#soundMuteBtn");
  const slider = wrap.querySelector("#soundVolumeSlider");
  const refreshIcon = () => { btn.textContent = (muted || volume <= 0) ? "🔇" : "🔊"; };

  btn.addEventListener("click", () => {
    setSoundMuted(!muted);
    refreshIcon();
    if(!muted) playClick();
  });
  slider.addEventListener("input", () => {
    setSoundVolume(Number(slider.value) / 100);
    if(muted && Number(slider.value) > 0) setSoundMuted(false);
    refreshIcon();
  });
}

/* Petit tic sur chaque bouton cliqué, site-wide — les liens (transitions de
   page) ont déjà leur propre whoosh, donc exclus ici pour ne pas cumuler. */
export function initClickSounds(){
  document.addEventListener("click", (e) => {
    const el = e.target.closest("button, .btn");
    if(!el || el.id === "soundMuteBtn") return;
    playClick();
  });
}
