# Configuration — Sphère de l'Intendance

## 1. Créer le projet Firebase

1. Va sur [console.firebase.google.com](https://console.firebase.google.com) → **Ajouter un projet**.
2. Une fois créé, clique sur l'icône **Web `</>`** pour ajouter une app web.
3. Copie l'objet `firebaseConfig` affiché et colle-le dans [`assets/js/firebase-config.js`](assets/js/firebase-config.js) à la place des `"REMPLACE_MOI"`.

## 2. Activer Firestore

1. Dans le menu de gauche : **Compilation → Firestore Database → Créer une base de données**.
2. Choisis le mode **production**.
3. Une fois créée, va dans l'onglet **Règles** et colle le contenu de [`firestore.rules`](firestore.rules) à la racine du projet, puis **Publier**.

> ⚠️ Ce site n'utilise pas de vrais comptes Firebase Authentication (pas d'email/mot de passe) : le rôle du staff est vérifié par un code PIN stocké en base, comme sur les autres sites de l'Ordre. Les règles Firestore fournies valident la forme des données mais ne peuvent pas garantir une séparation des rôles infalsifiable — voir les commentaires en tête de `firestore.rules`.

## 3. Créer le premier compte Admin

Dans Firestore, crée manuellement une collection `staff` avec un premier document (id auto) :

| Champ | Valeur exemple |
|---|---|
| `name` | `Ton Nom` |
| `steamId` | `76561198XXXXXXXXX` |
| `role` | `admin` |
| `pin` | `A7K2-DEMON-9X` *(choisis un code long, pas "1234")* |
| `active` | `true` |

Ce compte pourra ensuite ajouter les Hôtes et Croupiers directement depuis le Dashboard Admin (`admin.html`), sans repasser par la console Firebase.

## 4. Déploiement sur GitHub Pages

Ce site est 100% statique (HTML/CSS/JS, aucun build) :

1. Pousse le contenu de ce dossier sur un repo GitHub.
2. Dans **Settings → Pages** du repo, choisis la branche `main` et le dossier `/ (root)`.
3. Le site sera accessible à `https://<ton-user>.github.io/<repo>/`.

## 5. Structure des données Firestore

### `staff/{id}`
```
name, steamId, pin, role: 'hote'|'croupier'|'admin', active: bool, createdAt,
pinConfigured: bool, pinSetAt
```
`pinConfigured: false` = code temporaire, le membre doit en choisir un à sa prochaine connexion (`login.html`). Passe à `true` avec `pinSetAt` renseigné une fois configuré. L'Admin peut réinitialiser (`resetStaffPin` dans `assets/js/session.js`).

### `playerCards/{id}`
```
steamId, playerName, balance (tokens), status: 'active'|'suspended',
createdAt, createdBy, createdByName, lastTransactionAt
```
Une carte est considérée **expirée** si `lastTransactionAt` date de plus de 24h — calculé côté client (`assets/js/cards.js`), pas besoin de fonction planifiée serveur puisqu'il n'y a pas de backend. Une carte **suspendue** (`status: 'suspended'`, via l'Hôte ou l'Admin) ne peut plus miser/jouer tant qu'elle n'est pas réactivée, mais reste modifiable en dépôt/retrait à la caisse.

### `transactions/{id}`
```
cardId, steamId, playerName, type: 'depot'|'retrait'|'mise'|'gain'|'perte',
amount, balanceAfter, staffId, staffName, gameId, note, createdAt
```
Registre financier immuable (aucune modification/suppression), utilisé pour l'historique de chaque carte et les totaux de l'Intendance.

### `logs/{id}`
```
action, detail, steamId, playerName, staffId, staffName, amount, gameId, createdAt
```
Journal d'audit global (toute action, pas seulement financière) affiché en direct sur le Dashboard Admin.

### `tables/{id}` (ex: `tables/roulette-1`)
État live d'une table de Roulette ou de Blackjack, lu en temps réel par tous les écrans via `onSnapshot`.

### `crashRounds/{id}`
État d'une manche du Crash Game (heure de départ, point de crash, joueurs engagés).
