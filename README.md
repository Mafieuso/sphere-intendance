# Sphère de l'Intendance

Maison de jeu clandestine de l'Ordre (univers Demon Slayer RP — façade humaine, aucune référence démoniaque côté joueurs) — site 100% statique (HTML/CSS/JS, sans build), pensé pour GitHub Pages + Firebase.

**⚠️ Avant d'ouvrir le site : configure Firebase.** Voir [`SETUP.md`](SETUP.md) — sans ça, rien ne fonctionnera (erreurs Firebase dans la console).

## Pages

| Fichier | Rôle | Accès |
|---|---|---|
| `index.html` | Accueil / hub | Public |
| `login.html` | Connexion staff (PIN) | Public |
| `carte.html` | Carte Joueur (solde, historique, accès jeux) | Public (déverrouillage par PIN joueur) |
| `hote.html` | Poste de caisse (créer cartes, dépôt/retrait) | Hôte |
| `croupier.html` | Salle croupier (accès aux tables) | Croupier |
| `admin.html` | Dashboard Intendance (stats, staff, audit) | Admin |
| `spectateur.html` | Vue live en lecture seule | Public |
| `games/coinflip.html` | Pile ou Face (solo, ×1.5) | Joueur |
| `games/dice.html` | Dés (solo, devine 1-6, ×5) | Joueur |
| `games/roulette.html` | Roulette européenne multijoueur | Croupier pilote, joueurs misent, spectateurs observent |
| `games/blackjack.html` | Blackjack multijoueur | Croupier pilote, joueurs misent, spectateurs observent |
| `games/crash.html` | Ascension Fulgurante (crash game, plafond ×10) | Croupier fait décoller, joueurs misent/encaissent |

## Rôles & Permissions

- **Hôte** — vend/reprend des tokens en RP contre des Yens, seul rôle qui crée des cartes et ajuste les soldes directement.
- **Croupier** — ouvre les manches de Roulette/Blackjack, lance la roue, distribue, résout.
- **Admin (Intendance)** — dashboard complet : tokens en circulation, journal d'audit temps réel, gestion du staff.
- **Joueurs** — pas de compte staff ; chaque Carte Joueur a son propre code PIN (donné par l'Hôte à la création) pour se connecter sur `carte.html` et jouer aux jeux solo/multijoueur.

## Règle d'expiration des cartes

Une Carte Joueur sans dépôt/retrait/mise depuis **24h** est marquée « Expirée » (calculé côté client à partir de `lastTransactionAt`, affiché en rouge sur la carte et dans le Dashboard Admin). Comme il n'y a pas de backend, il n'y a pas de purge automatique — la carte reste en base mais n'est plus comptée dans les tokens « en circulation » tant qu'aucune transaction ne la réactive.

## Limites connues (site statique, sans backend)

- **Pas de vrais comptes Firebase Auth** : l'accès staff/joueur repose sur des codes PIN stockés en Firestore, pas sur une authentification serveur infalsifiable. C'est le même modèle que les autres sites de l'Ordre déjà en ligne — voir les commentaires en tête de `firestore.rules`.
- **Roulette / Blackjack** : c'est le navigateur du Croupier qui calcule et distribue les gains après le lancer/la révélation. S'il ferme l'onglet avant la fin de l'animation, la manche reste bloquée — il faut ouvrir une nouvelle manche.
- **Crash Game** : le point de crash est stocké dans le document partagé pour que chaque navigateur puisse calculer localement le multiplicateur ; un joueur techniquement motivé pourrait le lire dans les outils de développement. Accepté comme limite d'un jeu RP sans serveur de jeu dédié.
- **Blackjack** : tous les joueurs à la table jouent simultanément (pas de tour par tour strict) pour rester simple sans backend de synchronisation de tour.

## Démarrage local

Ouvre simplement `index.html` dans un navigateur (double-clic) une fois `assets/js/firebase-config.js` rempli. Aucune installation, aucun `npm install`.

## Déploiement

Voir la section 4 de [`SETUP.md`](SETUP.md).
