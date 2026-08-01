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

/* ── Ambiance de fond — un swing "cantina" ORIGINAL (basse qui marche,
   petit riff cuivré syncopé, pulsation balai en fond), composé en gamme
   Phrygien dominant (couleur klezmer/exotique), pas une reprise du thème
   Star Wars : mélodie, accords et rythme sont écrits ici, pas copiés.
   Séquenceur "lookahead" classique en Web Audio (on planifie quelques
   centaines de ms à l'avance, avec re-vérification régulière) plutôt que
   de compter sur setTimeout pour le tempo lui-même. */
const BPM = 132;
const BEAT = 60 / BPM;
const SWING_LONG = BEAT * .62, SWING_SHORT = BEAT * .38; // paire d'égales inégales (feel "swing")

// Basse (une note par temps, 4 mesures à 4 temps = 16 temps, en Ré Phrygien dominant.
const BASS_PATTERN = [
  146.83, 185.00, 220.00, 261.63,   // Ré7 : Ré-Fa#-La-Do
  196.00, 233.08, 293.66, 233.08,   // Solm : Sol-Sib-Ré-Sib
  220.00, 261.63, 293.66, 261.63,   // La7  : La-Do-Ré-Do
  146.83, 220.00, 146.83, 185.00,   // pédale Ré, résolution
];
// Petit riff syncopé (cuivré), joué sur les 2 dernières mesures (temps 8 à 15) —
// null = silence. Position = index de temps (pas d'eighth) dans le cycle de 32.
const LEAD_RIFF = {
  17: 440.00, 20: 392.00, 21: 369.99, 23: 293.66,
  26: 440.00, 28: 466.16, 30: 587.33,
};

let schedulerTimer = null;
let nextStepTime = 0;
let stepIndex = 0;

function pluck(freq, t0, { duration = .18, type = "sine", gain = .1 } = {}){
  const v = effectiveVolume();
  if(v <= 0) return;
  const c = ctx;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain * v, t0 + .008);
  g.gain.exponentialRampToValueAtTime(.0001, t0 + duration);
  osc.connect(g); g.connect(c.destination);
  osc.start(t0); osc.stop(t0 + duration + .03);
}

function leadNote(freq, t0){
  const v = effectiveVolume();
  if(v <= 0) return;
  const c = ctx;
  const osc = c.createOscillator();
  const filter = c.createBiquadFilter();
  const g = c.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(freq, t0);
  filter.type = "bandpass"; filter.frequency.value = freq * 1.5; filter.Q.value = 3;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(.09 * v, t0 + .01);
  g.gain.exponentialRampToValueAtTime(.0001, t0 + .22);
  osc.connect(filter); filter.connect(g); g.connect(c.destination);
  osc.start(t0); osc.stop(t0 + .26);
}

function swingTick(t0){
  const v = effectiveVolume();
  if(v <= 0) return;
  const c = ctx;
  const bufferSize = Math.floor(c.sampleRate * .04);
  const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
  const data = buffer.getChannelData(0);
  for(let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  const noise = c.createBufferSource();
  noise.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = "highpass"; filter.frequency.value = 4000;
  const g = c.createGain();
  g.gain.setValueAtTime(.05 * v, t0);
  g.gain.exponentialRampToValueAtTime(.0001, t0 + .04);
  noise.connect(filter); filter.connect(g); g.connect(c.destination);
  noise.start(t0); noise.stop(t0 + .04);
}

function scheduleAmbience(){
  const c = ctx;
  while(nextStepTime < c.currentTime + .25){
    const step = stepIndex % 32;
    const onBeat = step % 2 === 0; // pas long (temps) vs pas court (contretemps swingué)
    if(onBeat) pluck(BASS_PATTERN[Math.floor(step / 2) % 16], nextStepTime, { duration: .3, type: "triangle", gain: .12 });
    else swingTick(nextStepTime);
    if(LEAD_RIFF[step] != null) leadNote(LEAD_RIFF[step], nextStepTime);
    nextStepTime += onBeat ? SWING_LONG : SWING_SHORT;
    stepIndex++;
  }
  schedulerTimer = setTimeout(scheduleAmbience, 60);
}

let ambienceRunning = false;
function startAmbience(){
  if(ambienceRunning || muted || volume <= 0) return;
  const c = ensureCtx();
  if(!c || c.state === "suspended") return;
  ambienceRunning = true;
  stepIndex = 0;
  nextStepTime = c.currentTime + .1;
  scheduleAmbience();
}

function stopAmbience(){
  if(!ambienceRunning) return;
  ambienceRunning = false;
  clearTimeout(schedulerTimer);
  schedulerTimer = null;
}

export function isSoundMuted(){ return muted; }
export function getSoundVolume(){ return volume; }

export function setSoundMuted(v){
  muted = v;
  localStorage.setItem("sphereIntendanceSoundMuted", v ? "1" : "0");
  if(muted) stopAmbience(); else startAmbience();
}

export function setSoundVolume(v){
  volume = Math.max(0, Math.min(1, v));
  localStorage.setItem("sphereIntendanceSoundVolume", String(volume));
  if(volume <= 0) stopAmbience();
  else if(!muted) startAmbience();
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
