/* Assistant-mascotte : aide contextuelle (FAQ par mots-clés, 100% locale,
   aucune API) + petites réactions après une mise gagnée/perdue. Monté une
   seule fois depuis initFx() (assets/js/fx.js), donc présent sur toutes
   les pages sans rien modifier ailleurs. */

const GAME_RULES = [
  { icon: "🎡", label: "Roulette Européenne", lines: [
    "Mise sur une couleur (Rouge/Noir) ou un numéro plein (0-36).",
    "Couleur : paiement ×2. Numéro plein : paiement ×36.",
    "Le Croupier ouvre les mises, les ferme, puis lance la roue.",
    "Un seul numéro gagnant par manche (0 = vert, ni rouge ni noir).",
    "Tu peux miser plusieurs fois sur des choix différents dans la même manche."
  ]},
  { icon: "🃏", label: "Blackjack", lines: [
    "Rejoins la table pendant que les mises sont ouvertes.",
    "Le Croupier distribue 2 cartes à chacun et 2 au croupier (une cachée).",
    "Approche-toi de 21 sans dépasser (Tirer/Rester).",
    "Blackjack (21 avec 2 cartes) paie ×2.5.",
    "Victoire simple paie ×2. Égalité (push) rembourse la mise.",
    "Le croupier tire automatiquement jusqu'à 17."
  ]},
  { icon: "📈", label: "Ascension Fulgurante", lines: [
    "Mise avant le décollage — le Croupier fait décoller la fusée, pas les joueurs.",
    "Le multiplicateur grimpe en temps réel dès le décollage.",
    "Encaisse avant le crash pour remporter mise × multiplicateur.",
    "Multiplicateur plafonné à ×10 maximum.",
    "Mise maximum 10 jetons par manche.",
    "Si tu n'as pas encaissé avant le crash, la mise est perdue."
  ]},
  { icon: "🎲", label: "Lancer de Dés", lines: [
    "Choisis un chiffre de 1 à 6 avant de lancer.",
    "1 chance sur 6 de deviner juste.",
    "Victoire : gain net de 4× la mise (5× au total, mise incluse).",
    "Défaite : la mise complète est perdue."
  ]},
  { icon: "🪙", label: "Pile ou Face", lines: [
    "Choisis Pile ou Face avant de lancer.",
    "1 chance sur 2 de deviner juste.",
    "Victoire : +50 % de la mise en gain net.",
    "Défaite : la mise complète est perdue."
  ]}
];

const FAQ = [
  { icon: "💰", q: "Comment recharger mes jetons ?",
    keywords: ["recharg", "credit", "crédit", "depot", "dépot", "dépôt", "argent", "solde", "acheter"],
    a: "Le rechargement se fait uniquement par un Hôte ou un membre de l'Intendance : trouve l'un d'entre eux en jeu et demande un dépôt sur ta Carte de Joueur. Il n'existe aucun rechargement automatique sur le site." },
  { icon: "🎲", q: "Comment jouer à un jeu ?",
    keywords: ["comment jouer", "commencer", "debuter", "débuter", "demarrer", "démarrer", "table", "rejoindre"],
    a: "Va dans « Salle en Direct » ou choisis un jeu directement depuis l'accueil (Roulette, Blackjack, Ascension Fulgurante, Dés, Pile ou Face). Connecte-toi avec ta Carte de Joueur, place ta mise avec tes jetons, puis suis les instructions affichées sur la table." },
  { icon: "📜", q: "Les règles de chaque jeu", rules: true,
    keywords: ["regle", "règle", "rule", "comment ça marche", "comment ca marche"] },
  { icon: "🎰", q: "Comment fonctionne le Jackpot ?",
    keywords: ["jackpot", "cagnotte", "tirage", "gagnant du jackpot"],
    a: "Le Jackpot grossit avec chaque mise posée, sur n'importe quel jeu. Inscription libre à tout moment pour 10 jetons. Quand l'Intendance décide de lancer le tirage, un gagnant est choisi au hasard parmi les inscrits." },
  { icon: "🏅", q: "C'est quoi mon rang ?",
    keywords: ["rang", "niveau", "habitue", "habitué", "actionnaire", "mecene", "mécène", "grade", "progression"],
    a: "Ton rang (Visiteur → Habitué → Invité d'Honneur → Actionnaire → Grand Mécène) progresse avec le total de jetons misés à vie — jamais ton solde. Une série de pertes ne te fera donc jamais redescendre." },
  { icon: "🆘", q: "J'ai un problème",
    keywords: ["probleme", "problème", "bug", "staff", "aide", "hote", "hôte", "bloque", "bloquée", "suspendue"],
    a: "Contacte un Hôte ou un membre de l'Intendance directement en jeu — ce sont eux qui gèrent les cartes, les dépôts et les soucis techniques." }
];

const WIN_QUIPS = [
  "Les dieux du hasard t'aiment bien aujourd'hui... pour l'instant.",
  "Range tes jetons avant qu'ils repartent aussi vite qu'ils sont arrivés.",
  "Ne t'habitue pas trop à ce sourire, la maison se souvient de tout.",
  "Un gain, une légende de plus à raconter au bar.",
  "L'Intendance note soigneusement... et sourit un peu moins.",
  "Beau jeu. Ou juste beaucoup de chance. On ne dira rien.",
  "Tes jetons viennent de faire un aller simple vers ta poche. Bravo.",
  "Même les murs de la Sphère applaudissent, discrètement."
];
const LOSE_QUIPS = [
  "La maison te remercie pour ta généreuse contribution.",
  "Ce n'était pas ta soirée. Demain peut-être.",
  "Les jetons ont juste... changé de propriétaire. Ça arrive.",
  "Courage. Même les Grands Mécènes ont commencé comme ça.",
  "Une perte, une leçon. Ou juste une perte, en fait.",
  "L'Intendance ne rembourse jamais les regrets.",
  "Retente ta chance — c'est comme ça qu'on écrit les légendes... ou les tragédies.",
  "Ça arrive aux meilleurs. Et à toi aussi, apparemment."
];

function normalize(s){
  return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function findAnswer(text){
  const norm = normalize(text);
  if(!norm.trim()) return null;
  let best = null, bestScore = 0;
  for(const item of FAQ){
    const score = item.keywords.reduce((acc, k) => acc + (norm.includes(normalize(k)) ? 1 : 0), 0);
    if(score > bestScore){ bestScore = score; best = item; }
  }
  return best;
}

let bubbleTimer = null;

export function mountAssistant(){
  if(document.getElementById("assistantWidget")) return;

  const root = document.createElement("div");
  root.id = "assistantWidget";
  root.className = "assistant-widget";
  root.innerHTML = `
    <div class="assistant-bubble" id="assistantBubble" hidden></div>
    <div class="assistant-panel" id="assistantPanel" hidden>
      <div class="assistant-panel-head">
        <img src="/assets/img/mascotte.png" alt="" class="assistant-panel-avatar">
        <div class="assistant-panel-title">Besoin d'aide ?</div>
        <button class="assistant-close" id="assistantClose" aria-label="Fermer">✕</button>
      </div>
      <div class="assistant-panel-body" id="assistantBody"></div>
      <form class="assistant-panel-input" id="assistantForm">
        <input type="text" id="assistantInput" placeholder="Pose ta question..." autocomplete="off">
        <button type="submit" class="btn btn-gold btn-sm">➤</button>
      </form>
    </div>
    <button class="assistant-avatar" id="assistantAvatar" aria-label="Assistant">
      <img src="/assets/img/mascotte.png" alt="Assistant">
    </button>
  `;
  document.body.appendChild(root);

  const panel = root.querySelector("#assistantPanel");
  const body = root.querySelector("#assistantBody");
  const avatar = root.querySelector("#assistantAvatar");

  function renderMenu(){
    body.innerHTML = `
      <div class="assistant-msg">Choisis une question ci-dessous, ou écris directement la tienne.</div>
      <div class="assistant-topics">
        ${FAQ.map((item, i) => `<button class="assistant-topic" data-i="${i}">${item.icon} ${item.q}</button>`).join("")}
      </div>
    `;
    body.querySelectorAll(".assistant-topic").forEach(btn => {
      btn.addEventListener("click", () => {
        const item = FAQ[Number(btn.dataset.i)];
        if(item.rules) renderRulesMenu(); else renderAnswer(item.q, item.a);
      });
    });
  }

  function renderRulesMenu(){
    body.innerHTML = `
      <button class="assistant-back" id="assistantBack1">← Retour</button>
      <div class="assistant-msg">Quel jeu t'intéresse ?</div>
      <div class="assistant-topics">
        ${GAME_RULES.map((g, i) => `<button class="assistant-topic" data-i="${i}">${g.icon} ${g.label}</button>`).join("")}
      </div>
    `;
    body.querySelector("#assistantBack1").addEventListener("click", renderMenu);
    body.querySelectorAll(".assistant-topic").forEach(btn => {
      const g = GAME_RULES[Number(btn.dataset.i)];
      btn.addEventListener("click", () => renderAnswer(`${g.icon} ${g.label}`, `<ul class="assistant-rules">${g.lines.map(l => `<li>${l}</li>`).join("")}</ul>`, renderRulesMenu));
    });
  }

  function renderAnswer(question, html, backFn){
    body.innerHTML = `
      <button class="assistant-back" id="assistantBack2">← Retour</button>
      <div class="assistant-msg assistant-msg-q">${question}</div>
      <div class="assistant-msg">${html}</div>
    `;
    body.querySelector("#assistantBack2").addEventListener("click", backFn || renderMenu);
  }

  function openPanel(){
    if(!panel.hidden) return;
    panel.hidden = false;
    root.querySelector("#assistantBubble").hidden = true;
    renderMenu();
    requestAnimationFrame(() => panel.classList.add("assistant-panel-open"));
  }
  function closePanel(){
    panel.classList.remove("assistant-panel-open");
    setTimeout(() => { panel.hidden = true; }, 180);
  }

  /* Ouverture au survol (la souris passe sur la mascotte) plutôt qu'au
     clic — le clic reste actif en secours pour le tactile. Un court
     délai à la sortie évite une fermeture intempestive quand la souris
     traverse le petit espace entre l'avatar et le panneau. */
  let closeTimer = null;
  function cancelClose(){ clearTimeout(closeTimer); }
  function scheduleClose(){ cancelClose(); closeTimer = setTimeout(closePanel, 250); }

  avatar.addEventListener("mouseenter", () => { cancelClose(); openPanel(); });
  avatar.addEventListener("mouseleave", scheduleClose);
  avatar.addEventListener("focus", openPanel);
  avatar.addEventListener("click", openPanel);
  panel.addEventListener("mouseenter", cancelClose);
  panel.addEventListener("mouseleave", scheduleClose);
  root.querySelector("#assistantClose").addEventListener("click", () => { cancelClose(); closePanel(); });

  root.querySelector("#assistantForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = root.querySelector("#assistantInput");
    const text = input.value.trim();
    if(!text) return;
    input.value = "";
    const match = findAnswer(text);
    if(!match){
      renderAnswer(text, "Je n'ai pas bien compris ta question — essaie une des questions ci-dessus, ou contacte directement un Hôte / l'Intendance en jeu.");
    } else if(match.rules){
      renderRulesMenu();
    } else {
      renderAnswer(text, match.a);
    }
  });
}

/* Petite réaction (bulle de dialogue) après une mise gagnée/perdue — pas
   besoin d'ouvrir le panneau complet. Appelé depuis chaque page de jeu au
   moment où le résultat de la mise est connu. */
export function reactToOutcome(won){
  const bubbleEl = document.getElementById("assistantBubble");
  const panelEl = document.getElementById("assistantPanel");
  if(!bubbleEl || (panelEl && !panelEl.hidden)) return;
  const quips = won ? WIN_QUIPS : LOSE_QUIPS;
  const text = quips[Math.floor(Math.random() * quips.length)];
  bubbleEl.textContent = text;
  bubbleEl.hidden = false;
  bubbleEl.classList.remove(won ? "assistant-bubble-lose" : "assistant-bubble-win");
  bubbleEl.classList.add(won ? "assistant-bubble-win" : "assistant-bubble-lose");
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => { bubbleEl.hidden = true; }, 4500);
}
