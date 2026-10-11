# Palabre

Le réseau social des développeurs africains – CADEV 2026.

Les devs partagent leurs projets, s'entraident et forment des équipes éclair. Les clients publient leurs demandes et choisissent un dev ou une équipe en confiance grâce au profil prouvé.

## Technique

- Serveur : Node.js 20+ et Express 5
- Base de données : PostgreSQL 16+
- Interface : HTML, CSS et JavaScript sans framework, en PWA installable
- Hébergement : Systalink Datacloud (service web + base PostgreSQL + E-mail Pro)

## Lancer le projet sur ton ordinateur

1. Installe **Node.js 20 ou plus** et **PostgreSQL**.
2. Crée la base :
   ```
   createuser palabre -P        (mot de passe : palabre)
   createdb palabre -O palabre
   ```
3. Dans le dossier du projet :
   ```
   npm install
   cp .env.example .env         (puis adapte les valeurs)
   npm start
   ```
4. Ouvre http://localhost:3000

Les tables sont créées automatiquement au démarrage (`src/db/schema.sql`). En local, les emails (mot de passe oublié) s'affichent dans la console.

## Compte administrateur

Le tableau de bord `/admin` est réservé aux comptes administrateurs. Inscris-toi sur le site, puis donne le rôle à ton compte depuis le serveur :

```
npm run admin -- ton-email@exemple.com
npm run admin -- ton-email@exemple.com retirer     (pour retirer le rôle)
```

## Tests

```
npm test
```

Les tests utilisent la base indiquée dans `DATABASE_URL`.

## Mise en ligne sur Systalink

1. Commander une base **PostgreSQL 17** et un **service web** relié à ce dépôt GitHub (avec le code promo CADEV).
2. Commande de démarrage : `npm start`. Commande de build : `npm install`.
3. Variables d'environnement à renseigner sur Systalink :
   - `NODE_ENV=production`
   - `DATABASE_URL` : l'adresse de la base fournie par Systalink
   - `DATABASE_SSL=true` si Systalink l'exige
   - `JWT_SECRET` : une longue chaîne aléatoire
   - `URL_PUBLIQUE` : l'adresse du site, par exemple https://palabre.dev
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` : les accès E-mail Pro

## Organisation du code

```
server.js              point d'entrée
src/app.js             application Express (sécurité, routes)
src/config.js          configuration (.env)
src/db/schema.sql      toutes les tables
src/routes/            routes de l'API
src/middleware/        session et droits
src/utils/             validation, emails
public/                pages, styles, scripts, PWA
tests/                 tests automatiques
```

## Avancement

- [x] Base de données complète
- [x] Inscription, connexion, déconnexion, mot de passe oublié
- [x] PWA installable (manifeste, icônes, service worker)
- [x] Profils, compétences, photo de profil, liens courts palabre.dev/identifiant
- [x] Fil d'actualité (idée, question, projet, image), j'aime, commentaires, amis, signalement
- [x] Demandes des clients, propositions en solo, équipes éclair, choix du client, notifications (cloche)
- [x] Profil prouvé (projets avec badge « Lien vérifié », avis protégés), recherche de devs, vitrine par secteur, cartes de partage Open Graph
- [x] Tableau de bord administrateur `/admin` : statistiques, signalements, projets proposés pour Facebook
- [x] Calculateur « Combien coûte mon projet ? » `/calculateur` (grille de prix : `public/js/grille-prix.js`)
- [x] Refonte du design, étape A : système de design (icônes Lucide, ombres, animations, toasts, états vides illustrés, squelettes de chargement, mode sombre)
- [x] Prénom et nom saisis séparément (inscription et profil)
- [x] Appels audio et vidéo dans Palabre (WebRTC, sans bibliothèque) : à deux, ou en audio jusqu'à quatre dans le groupe d'une équipe ; écran d'appel aux couleurs de Palabre
- [x] Site en français et en anglais : 1 400 textes dans deux dictionnaires, pluriels, dates et nombres selon la langue, erreurs, notifications et emails dans la langue de chacun
- [x] Paramètres et confidentialité : qui voit mes publications, mes amis, mon numéro ; qui peut m'écrire, m'appeler, m'inviter ; email, mot de passe, autres appareils, téléchargement et suppression de ses données
- [x] Modération : règles de la communauté à accepter, filtre automatique avant publication (insultes, arnaques, liens dangereux, listes maison), limites des comptes de moins de 3 jours, masquage après 3 signalements, sanctions progressives avec contestation, file « À modérer » et journal dans `/admin`, bandeau anti-arnaque
- [x] Sécurité des comptes : sessions par appareil, alerte de nouvelle connexion et « Ce n'était pas moi », validation en deux étapes avec codes de secours, verrou après 10 mots de passe faux, mots de passe trop courants refusés, journal de sécurité
- [x] Désactiver son compte ou le supprimer avec 30 jours pour changer d'avis ; modifier une publication ou un commentaire pendant 48 h ; corbeille de 30 jours
- [x] Réglages du 11 octobre : à la première visite, l'anglais seulement pour un navigateur en anglais dans un pays africain anglophone ou hors d'Afrique (fuseau horaire) ; les avis d'un client qui supprime son compte restent sur le profil du dev, signés « Ancien client »
- [x] Finitions de la messagerie : carte d'arrivée d'un message sur les autres pages, petit son réglable dans le profil, appel entrant vu en 5 secondes, titres clairs des notifications du téléphone
- [x] Messages vocaux d'une minute, légers (24 kb/s), avec un lecteur maison (pause, avancement, vitesse)
- [x] Messagerie vivante sans WebSocket : « Awa écrit… », « En ligne » (masquable), « Vu par » dans les groupes
- [x] Messages : réactions, réponse avec citation, suppression pour tout le monde (15 minutes) ou pour soi
- [x] Conversations de groupe pour les équipes éclair : le groupe naît avec l'équipe, le client y entre quand il la choisit, il se ferme si elle est dissoute
- [x] Notifications : j'aime, commentaires et messages regroupés (« Awa et 3 autres ont aimé ta publication »), page par périodes avec avatars, et notifications push sur le téléphone même site fermé (sans bibliothèque), avec réglages par famille
- [x] Page du code de confirmation « les feuilles de l'arbre à palabres » (six feuilles, tourbillon, arbre qui se forme) et emails HTML aux couleurs de Palabre
- [x] Listes de choix maison à l'effet verre (menu flottant sur ordinateur, feuille du bas sur téléphone, utilisables au clavier) et date de naissance en trois listes
- [x] Listes chargées toutes seules en défilant (fil, demandes, recherche, notifications), 10 éléments à la fois
- [x] Partage des publications : « Partager » dans le menu de chaque publication (menu du téléphone, ou WhatsApp / Facebook / X / copier le lien), page publique `/publication/12` lisible sans compte, avec sa carte de partage
- [x] Vidéos dans le fil : un lien YouTube, TikTok ou Facebook par publication, lecteur chargé seulement au toucher (3G)
- [x] Inscription en deux étapes : code à 6 chiffres reçu par email, champ piège et délai minimum contre les robots, puis « Ton profil de dev » (18 ans minimum, spécialité, expérience, liens vérifiés) avant de pouvoir répondre aux demandes
- [x] Palabre Messages : messagerie privée (amis, client et dev, demandes de message, blocage, signalement, « Vu »), sans WebSocket
- [x] Version ordinateur et tablette en 3 colonnes (menu, fil, panneau), recherche dans l'en-tête
- [x] Contenu de démonstration (`npm run demo`, comptes dans `docs/COMPTES-DEMO.md`), dont deux comptes pour tout essayer : `dev@demo.palabre.dev` et `client@demo.palabre.dev`
- [x] Photos de fond optimisées (accueil et connexion), chargées une par une et jamais sur connexion lente
- [x] Pages Connexion et Inscription réunies en une seule, avec l'animation de la « lame »
- [x] Refonte du design, étape C : qualité « réseau social » (anneau de preuve et badge feuille, en-tête compacte avec recherche de membres, « Disponibles maintenant », fil bord à bord avec preuve sociale et aperçu des commentaires, profil avec couverture et onglets)
- [x] Publication Facebook depuis `/admin` : texte prêt, bouton de partage, « Marquer comme publié », 5 par jour au plus
- [x] Prêt pour la mise en ligne : contrôles au démarrage en production, compression et cache long (`docs/PERFORMANCE.md`), pages 404 et 500, `robots.txt`, relecture de sécurité (`docs/AUDIT-SECURITE.md`), guide `docs/DEPLOIEMENT-SYSTALINK.md`
- [x] Défi de la semaine (`/defis`) : créé dans `/admin`, réponses des devs, vote des membres, gagnant désigné automatiquement, badge sur le profil

## Comprendre le code

Explications détaillées, partie par partie : [docs/COMPRENDRE-LE-CODE.md](docs/COMPRENDRE-LE-CODE.md)

## Déclarations pour le concours

- Composants tiers et licences : [LICENCES.md](LICENCES.md)
- Usage de l'intelligence artificielle : [DECLARATION-IA.md](DECLARATION-IA.md)
