# 🎨 DessinTel — le téléphone dessiné

Le téléphone arabe en dessins. Chacun écrit une phrase, le voisin la dessine, le suivant devine le dessin, le suivant dessine sa réponse… À la fin, on rejoue tous les carnets page par page, sur les téléphones et sur la TV.

- **Un téléphone par joueur**, de 3 à 16 joueurs. Tout le monde joue en même temps, personne n’attend son tour.
- **Maître du jeu** (`host.html`) : il crée la salle, affiche le QR code, lance la partie et tourne les pages de la révélation. **Il peut jouer aussi** (bouton « 🙋 Je joue aussi »).
- **Joueur** (`play.html`) : écrire, dessiner au doigt, deviner, puis réagir pendant la révélation et voter.
- **Écran TV** (`tv.html`, optionnel) : le QR code, l’avancement des manches avec le minuteur, puis la révélation en grand, avec l’étape précédente et la nouvelle côte à côte.

C’est une appli web statique, sans rien à installer. Supabase Realtime transporte les messages en temps réel, comme pour *Undercover famille* et *BUZZ!*.

▶️ **Jouer en ligne** : <https://dessintel.cdesmottes.fr>

---

## 🎲 Déroulé d’une partie

1. **Salon** : les joueurs scannent le QR code et choisissent leur prénom (liste des joueurs enregistrés du groupe qui joue) ou en tapent un.
2. **Manche 1** : chacun écrit une phrase dans son propre carnet. Le bouton **🎲 Me proposer une phrase** pioche dans 146 idées adaptées aux enfants.
3. **Manches suivantes** : les carnets tournent. Tu reçois uniquement la dernière page du carnet qu’on te passe : une phrase, tu la dessines ; un dessin, tu écris ce que tu crois voir.
4. **La grande révélation** : carnet par carnet, page par page. Les dessins se redessinent trait par trait. Le maître du jeu tourne les pages, et **le propriétaire du carnet peut aussi le faire depuis son téléphone**. Tout le monde peut réagir avec 😂 ❤️ 😮 👏.
5. **Les trophées** : chacun vote (pas pour soi) pour 🎨 *le plus beau dessin*, 😂 *le plus drôle* et 🕵️ *le meilleur pour deviner*. Le 💖 *coup de cœur du public* revient à l’étape qui a reçu le plus de réactions. Il n’y a pas de score.

**Rotation** : à la manche *r*, le carnet *b* est entre les mains du joueur *(b + r) mod N* (l’ordre des joueurs est tiré au hasard). Personne ne reçoit son propre carnet après la première manche, et personne ne touche deux fois au même.

**Minuteur** : quand le temps est écoulé, chaque téléphone envoie ce qu’il a (un dessin à moitié fini, c’est encore plus drôle). Un joueur qui n’a rien fait passe son tour : le suivant reçoit alors la dernière vraie page du carnet. Le bouton **✏️ Modifier** permet de corriger sa copie tant que la manche n’est pas finie.

**Réglages ⚙️** (chez le maître du jeu, entre deux parties) : temps pour écrire (20 s à 1 min 30, ou sans minuteur), temps pour dessiner (45 s à 3 min, ou sans), nombre d’étapes par carnet (tour complet ou 4, 6, 8, 10), sons, lien de l’écran TV, nouvelle salle.

**Pendant une manche**, le maître du jeu voit qui a fini, peut **⏭ passer le tour** d’un joueur parti ou **⏩ terminer la manche**. Dans le salon, il peut retirer un joueur.

**📸 Enregistrer** : à la fin d’un carnet, une image PNG du carnet complet se crée, à partager sur WhatsApp.

## 👥 Joueurs enregistrés et groupes

Même gestion que dans *BUZZ!* (bouton 👥 du maître du jeu) : joueurs avec prénom, avatar et couleur, rangés dans des groupes (Famille, Amis, Travail… renommables). Le groupe choisi limite les prénoms proposés sur les téléphones.

**Import depuis Undercover** : dans Undercover, « Exporter mes données », copie le code `UCF2:…` (ou le fichier `.json`) et colle-le dans « 📥 Importer depuis Undercover ». Rien n’est effacé, les doublons de prénom sont réunis.

## 🛡️ Solidité

- **Brouillons** : la phrase ou le dessin en cours est gardé sur le téléphone. Si la page se recharge, on reprend où on en était.
- Un joueur qui recharge sa page ou dont le téléphone se met en veille retrouve sa place, son carnet en cours et ses brouillons. S’il change de téléphone, il tape le même prénom et reprend sa place.
- Si le maître du jeu recharge sa page, la partie est restaurée depuis la mémoire de son navigateur (tous les carnets y sont).
- Une copie non confirmée par le maître du jeu est renvoyée automatiquement.
- L’écran reste allumé pendant la partie quand le navigateur le permet.

---

## 🖌️ Pourquoi les dessins sont des traits et pas des images

Un dessin est une liste de traits : `[couleur, épaisseur, x0, y0, x1, y1, …]`, avec des coordonnées entières de 0 à 1000. Les points sont simplifiés (algorithme de Ramer-Douglas-Peucker) à la fin de chaque trait.

- C’est **léger** : quelques dizaines de Ko par dessin. Un message Supabase gratuit est limité à 256 Ko. Si un dessin très chargé dépasse 180 Ko, il est simplifié davantage automatiquement.
- C’est **net à toutes les tailles**, de l’écran du téléphone à la TV.
- On peut **rejouer le dessin trait par trait** pendant la révélation.

Outils : 14 couleurs, 4 épaisseurs, gomme, 🪣 couleur de fond, annuler, tout effacer. Un deuxième doigt posé sur l’écran annule le trait en cours (pratique contre les appuis de la paume).

## 🔒 Ce qui circule

- L’état de la partie diffusé à tous ne contient **ni les phrases ni les dessins** : le maître du jeu envoie à chaque joueur uniquement la page qu’il doit traiter, puis, pendant la révélation, les pages au fur et à mesure qu’elles sont montrées.
- Les votes : tout le monde voit **qui** a voté, pas **pour qui**.
- Rien n’est enregistré chez Supabase (aucune table, uniquement les canaux *Broadcast* et *Presence*).
- Limite assumée, comme pour BUZZ! : les messages ne sont pas signés et passent par un canal public. Un joueur très bricoleur qui connaît le code de la salle pourrait lire les messages ou en envoyer de faux. C’est acceptable pour un jeu en famille ou entre amis.

---

## 🚀 Mise en ligne

### 1. Supabase

> ✅ **Déjà fait** : `js/config.js` utilise le même projet Supabase que *Undercover famille* et *BUZZ!*. Les canaux `dessintel:XXXX` ne se mélangent pas avec ceux des autres jeux.

Pour un projet séparé : crée un projet gratuit sur <https://supabase.com> (région West EU), copie la **Project URL** et la clé **publishable** dans `js/config.js`, et vérifie dans **Realtime → Settings** que l’accès public est autorisé. Aucune table ni script SQL. Ne mets jamais la clé `secret` / `service_role` dans le code.

### 2. GitHub Pages

1. Pousse le contenu de ce dossier à la racine du dépôt.
2. **Settings → Pages → Build and deployment** : **Deploy from a branch**, branche `main`, dossier `/ (root)`.
3. Domaine : le fichier `CNAME` contient `dessintel.cdesmottes.fr`. Chez ton registrar DNS, crée un enregistrement **CNAME** `dessintel` → `<ton-pseudo-github>.github.io`, puis coche **Enforce HTTPS**.
   Pour utiliser l’adresse `https://<pseudo>.github.io/<depot>/` à la place, supprime le fichier `CNAME` : tous les liens de l’appli sont relatifs.

> Le **HTTPS** est indispensable (maintien de l’écran allumé, son, partage d’image). GitHub Pages le fournit.

Les pages contiennent `<meta name="robots" content="noindex, …">` : le jeu n’apparaît pas dans les moteurs de recherche, comme Undercover.

---

## 🧪 Tester sans réseau (mode local)

Ajoute `?local=1` à l’adresse : les onglets d’un **même navigateur** jouent entre eux, chacun avec sa propre identité.

```bash
python -m http.server 8000
# maître du jeu : http://localhost:8000/host.html?local=1&r=TEST
# joueurs       : http://localhost:8000/play.html?local=1&r=TEST  (un onglet par joueur)
# TV            : http://localhost:8000/tv.html?local=1&r=TEST
```

`&lat=300` simule jusqu’à 300 ms de latence réseau.

Tests automatiques (Node 18 ou plus) :

```bash
node --test tests/*.test.mjs
```

Ils couvrent la rotation des carnets, l’alternance phrase / dessin, les tours passés, le minuteur, la révélation, les exclusions, le changement de téléphone, les votes et trophées, la simplification et la taille des dessins, et les joueurs enregistrés.

---

## 🗂️ Fichiers

```
index.html        accueil (rejoindre / créer / écran TV)
host.html         maître du jeu
play.html         joueur
tv.html           écran du salon
css/style.css     tout le style
js/config.js      ⚙️ URL + clé Supabase
js/game.js        règles : rotation, manches, tours passés, révélation, votes (pur, testé)
js/draw.js        ardoise, traits compacts, rejeu, image du carnet
js/task.js        écran « écrire / dessiner » (joueurs et maître du jeu)
js/ui.js          rendu partagé (avancement, carnet révélé, trophées)
js/phrases.js     les 146 phrases du bouton 🎲
js/roster.js      joueurs enregistrés et groupes, import Undercover (testé)
js/transport.js   Supabase Realtime (Broadcast + Presence) ou mode local
js/fx.js          sons synthétisés, vibrations, confettis, réactions
js/common.js      outils partagés (stockage, QR code, horloge du maître du jeu)
js/host.js · play.js · tv.js · home.js   logique de chaque page
js/vendor/        supabase-js 2.119.2 et qrcode-generator 1.4.4 (licence MIT)
tests/            tests des règles, du dessin et des joueurs enregistrés
```

**Limites connues** :

- Il faut une connexion internet (Wi-Fi ou 4G).
- L’iPhone ne permet pas la vibration depuis un site web.
- Le maître du jeu doit garder la page ouverte : c’est son téléphone qui garde les carnets.

## 📄 Licence

MIT. Fait avec ❤️ pour les soirées en famille. [cdesmottes.fr](https://cdesmottes.fr)
