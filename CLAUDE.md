# Palabre — instructions pour Claude Code

Palabre est le réseau social des développeurs africains, construit pour la **Coupe d'Afrique des Développeurs (CADEV) 2026** organisée par Systalink. Thème du concours : « Construire la plateforme d'échange africaine, pour les devs, par les devs. »

Équipe (Burkina Faso) : Barry Faissal (développeur principal, Koudougou), son ami (design, textes, tests), son petit frère (Facebook/Instagram, contenu de démo, campagne de vote, Ouagadougou). Réponds toujours en **français**, simplement, et explique ce que tu fais : Barry doit pouvoir défendre chaque partie du code devant le jury.

Le plan complet du projet est dans un document Claude partagé, « Plan CADEV 2026 – Palabre ». Ce fichier en reprend l'essentiel.

## Dates à ne jamais oublier (heure GMT = heure de Ouagadougou)

- **25 octobre 2026, 17 h** : clôture des inscriptions et des soumissions. Viser une soumission **avant midi**.
- 25 oct 18 h → 26 oct 23 h 59 : vote des pairs. **Les 3 membres doivent voter**, sinon l'équipe est éliminée.
- 27 → 30 oct : vote du public (10 % de la note max). 31 oct → 1er nov : jury. 2 nov : résultats.
- Notation du jury : qualité technique 30 %, pertinence 25 %, expérience utilisateur 20 %, innovation 15 %, vote du public 10 %.

## Règles du concours qui touchent le code

- Projet **original, écrit pendant le concours** (depuis le 29 septembre 2026). Ne rien reprendre d'un projet existant.
- **Aucune bibliothèque sous licence GPL, AGPL ou LGPL.** Licences permises : MIT, ISC, BSD, Apache-2.0, MIT-0. Vérifier chaque nouvelle dépendance et mettre à jour `LICENCES.md`.
- L'usage de l'IA est autorisé mais doit être déclaré : mettre à jour `DECLARATION-IA.md` à chaque nouvelle partie.
- Déploiement obligatoire sur **Systalink Datacloud** avec au moins un produit payant (service web Node.js depuis GitHub + base PostgreSQL 17 + E-mail Pro), achetés avec le code promo -40 % de l'équipe.

## Le produit

Deux publics : les **devs** (réseau social : profil, fil d'actualité, amis, entraide) et les **clients** (publient des demandes avec budget en FCFA, reçoivent des propositions).

Fonctions qui distinguent Palabre :
1. **Équipes éclair** : un dev invite des amis de la plateforme à répondre ensemble à une grosse demande, chacun avec un rôle.
2. **Profil prouvé** : projets réalisés avec lien vérifié automatiquement (badge « Lien vérifié ») ; avis possibles seulement par un client dont la demande, terminée, a été attribuée à ce dev.

Attirer les visiteurs : vitrine des réalisations par secteur (page d'accueil), cartes de partage Facebook/WhatsApp (balises Open Graph), lien court de profil `palabre.dev/identifiant`, calculateur « Combien coûte mon projet ? » (grille de prix en FCFA fournie par Barry), défi de la semaine (à faire en dernier, abandonnable), publication automatique sur la page Facebook officielle « Palabre Dev » via l'API Graph de Meta (projets et défis gagnants seulement, avec accord du dev, 3 à 5 publications par jour maximum ; plan B : bouton « publier » dans le tableau de bord admin).

## Technique

- Node.js 20+, **Express 5**, **PostgreSQL** (bibliothèque `pg`), bcryptjs, jsonwebtoken, helmet, express-rate-limit, nodemailer.
- Interface : **HTML, CSS et JavaScript sans framework ni étape de compilation**, en **PWA installable** (manifeste, icônes, service worker), pensée d'abord pour le téléphone et la 3G.
- Les images sont compressées dans le navigateur puis stockées dans la table `fichiers` (bytea), servies par `/fichiers/:id` avec cache d'un an.

### Organisation

```
server.js              démarrage (migration automatique puis écoute)
src/app.js             application Express : sécurité, routes, lien court /:identifiant
src/config.js          variables d'environnement (.env)
src/db/schema.sql      toutes les tables (idempotent, relancé à chaque démarrage)
src/routes/            auth.js, profils.js, fichiers.js, references.js, publications.js, amis.js, signalements.js
src/middleware/auth.js session (cookie httpOnly + JWT), exigerConnexion, exigerAdmin
src/utils/             validation.js (dont IDENTIFIANTS_RESERVES), images.js, mailer.js, membres.js (aperçu d'un membre, état d'amitié, limites par membre)
public/                pages HTML, css/style.css, js/ (app.js = outils communs), sw.js, manifest.json
tests/                 tests node:test qui démarrent un vrai serveur
docs/COMPRENDRE-LE-CODE.md  guide pédagogique pour l'équipe et le jury
```

### Lancer en local

PostgreSQL avec un utilisateur et une base `palabre` (mot de passe `palabre`), puis :

```
npm install
npm start          # http://localhost:3000
npm test           # utilise DATABASE_URL
```

Sans SMTP configuré, les emails (mot de passe oublié) s'affichent dans la console du serveur.

## Règles de code à respecter

- **Noms en français** (variables, fonctions, tables, colonnes, routes), comme le code existant. Commentaires en français, utiles et courts.
- **Sécurité** :
  - requêtes SQL toujours paramétrées (`$1`, `$2`…) ;
  - le texte écrit par les membres est inséré dans les pages avec `textContent` ou la fonction `el()` de `public/js/app.js`, **jamais** avec `innerHTML` ;
  - pas de script ni de style en ligne dans le HTML (la CSP de Helmet les bloque) : tout va dans `public/js/` et `public/css/` ;
  - toute requête qui modifie des données est en JSON (protection CSRF déjà en place) ;
  - valider toutes les entrées côté serveur avec `src/utils/validation.js` (erreurs `ErreurValidation` avec le nom du champ) ;
  - jamais d'email public ; le numéro WhatsApp n'est visible que par les membres connectés.
- Modifications multiples en base : utiliser une **transaction** (`BEGIN` / `COMMIT` / `ROLLBACK`).
- Nouvelle table ou colonne : l'ajouter dans `src/db/schema.sql` de façon idempotente (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN IF NOT EXISTS`).
- Toute nouvelle page ou nouveau script de l'interface : l'ajouter à la liste de `public/sw.js` et **augmenter `VERSION`** (sinon les téléphones gardent l'ancienne version).
- Nouvelles adresses de pages : ajouter le mot à `IDENTIFIANTS_RESERVES` pour qu'aucun membre ne puisse le prendre comme identifiant.
- Style : utiliser les variables de couleur de `public/css/style.css` (couleurs du logo : terre cuite, vert feuillage, noir du tronc, crème) et la police Bricolage pour les titres. Mobile d'abord, zones tactiles de 44 px minimum, focus clavier visible, mode sombre.
- Chaque fonctionnalité : **tests** dans `tests/`, vérification réelle dans le navigateur (téléphone 390 px de large), puis mise à jour de `docs/COMPRENDRE-LE-CODE.md`, du README (Avancement), de `LICENCES.md` et de `DECLARATION-IA.md` si besoin.
- Toujours `git pull` avant de commencer, commits clairs en français, puis `git push`.

## Avancement

Fait :
- [x] Base de données complète (toutes les tables du plan)
- [x] Inscription, connexion, déconnexion, mot de passe oublié par email
- [x] PWA installable, logo de l'équipe, couleurs du site alignées sur le logo
- [x] Profils : page publique `/:identifiant`, modification, 15 compétences max, photo, disponibilité, WhatsApp protégé
- [x] Réseau social : fil `/fil` (idée / question / projet, image facultative, chargé par 10, filtre « Mes amis »), j'aime, commentaires, amis (`/amis`, bouton sur les profils), bouton « Signaler » (fenêtre commune `signaler()` dans `public/js/app.js`)

À faire, dans cet ordre :
1. **Demandes et équipes éclair** : publier une demande (client), propositions solo, création d'équipe, invitations avec rôle, proposition d'équipe, choix du client, **notifications** dans l'appli (cloche avec compteur).
2. **Profil prouvé, vitrine et partage** : projets avec vérification automatique du lien, avis protégés, recherche de devs (compétence, pays, ville, disponibilité), vitrine par secteur sur l'accueil, cartes de partage Open Graph.
3. **Finitions** : tableau de bord administrateur (valider ou bloquer les projets avant Facebook, signalements, statistiques), calculateur de prix, publication automatique Facebook (ou plan B), défi de la semaine en dernier.
4. **Mise en ligne Systalink** vers le 20 octobre (premier essai), version finale le 22-23, contenu de démo, tests sur plusieurs téléphones et en 3G, comptes de démo pour le jury.
