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
src/routes/            auth.js, profils.js, fichiers.js, references.js, publications.js, amis.js, signalements.js, demandes.js, equipes.js, notifications.js, projets.js, avis.js, devs.js, pages.js (accueil, profil et projet avec balises de partage), admin.js
src/middleware/auth.js session (cookie httpOnly + JWT), exigerConnexion, exigerAdmin
src/utils/             validation.js (dont IDENTIFIANTS_RESERVES), images.js, mailer.js, membres.js (aperçu d'un membre, état d'amitié, limites par membre), notifications.js (notifier), liens.js (vérification des liens)
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
npm run admin -- email@exemple.com   # donne le rôle administrateur à un compte
npm run demo       # peuple la base avec un contenu de démonstration (npm run demo -- retirer pour l'enlever)
npm run photos     # prépare les photos posées dans public/img/fond/ (WebP + JPEG, 1080 px)
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
- Style : utiliser les variables de `public/css/style.css`. Le **vert feuillage** est la couleur d'action (`--action` : boutons, liens, j'aime actif, onglet actif) ; la terre cuite (`--accent`) ne sert qu'aux petits accents (pastilles de compteur, badge « Question »). Tailles de texte : seulement `--t-13`, `--t-15`, `--t-17`, `--t-20`, `--t-24` (exceptions voulues : grand titre de l'accueil, champs de saisie en 16 px pour l'iPhone). Texte courant en police du système, Bricolage pour les noms, les titres et le logo. Ombres `--ombre-1` à `--ombre-3`, coins `--rayon-petit`, `--rayon`, `--rayon-grand`. Pas de libellés en MAJUSCULES espacées, pas d'infos collées par « · » (écrire « Site web, il y a 15 h »), pas de flèche « → » dans les boutons. Mobile d'abord, zones tactiles de 44 px minimum, focus clavier visible, mode sombre, animations coupées par `prefers-reduced-motion`.
- Système de design (fonctions de `public/js/app.js`, à réutiliser plutôt que réinventer) :
  - membres : **toujours** `avatar(personne, taille)` (photo ou initiales sur une teinte stable, avec l'anneau de preuve ; tailles `nav`, `mini`, `moyen`, `rangee`, `grand`, `profil`) et `nomMembre(membre)` (nom + badge feuille « Profil prouvé »). Ils ont besoin de `nbProjetsVerifies` : côté serveur, passer par `COLONNES_MEMBRE` et `apercuMembre()` de `src/utils/membres.js`, jamais une requête par membre ;
  - actions secondaires (copier le lien, signaler, supprimer) : dans un menu « … » créé par `menuOptions(() => [{ texte, icone, action, danger }])`, jamais en boutons séparés ; copie d'un lien : `copierLien(url)` ;
  - teintes d'avatar : jamais de vert (réservé à l'anneau de preuve et aux actions) ;
  - publications : `cartePublication()` et `filPublications()` de `public/js/publication.js` (fil et onglet « Publications » du profil). Sur téléphone, un fil est bord à bord (classe `.fil-social`, blocs `.bloc-fil`) ;
  - mouvement : rare. Pas d'animation d'apparition sur les cartes ; seulement le pop du cœur, l'ouverture des commentaires, une publication qu'on vient d'écrire, les fenêtres et les toasts ;
  - icônes : `icone('nom')` (Lucide, sprite `public/icons/icones.svg` ; pour en ajouter une, reprendre son tracé chez Lucide et noter son nom en commentaire). Un bouton sans texte porte un `aria-label` ;
  - **jamais** `alert()`, `confirm()` ni `prompt()` : utiliser `toast(texte, 'succes' | 'erreur')` et `await confirmer('Question ? Explication.', { bouton, danger })` ;
  - liste vide : `etatVide(illustration, titre, texte, bouton)` (illustrations dans `public/icons/illustrations.svg`) ;
  - chargement : `const fini = chargement(zone, 3)` puis `fini()` (squelettes), jamais un simple texte « Chargement… » ;
  - `append()` écrit le mot « null » pour une valeur vide : passer par `el()` ou filtrer avec `.filter(Boolean)`.
- Chaque fonctionnalité : **tests** dans `tests/`, vérification réelle dans le navigateur (téléphone 390 px de large), puis mise à jour de `docs/COMPRENDRE-LE-CODE.md`, du README (Avancement), de `LICENCES.md` et de `DECLARATION-IA.md` si besoin.
- Toujours `git pull` avant de commencer, commits clairs en français, puis `git push`.

## Avancement

Fait :
- [x] Base de données complète (toutes les tables du plan)
- [x] Inscription, connexion, déconnexion, mot de passe oublié par email
- [x] PWA installable, logo de l'équipe, couleurs du site alignées sur le logo
- [x] Profils : page publique `/:identifiant`, modification, 15 compétences max, photo, disponibilité, WhatsApp protégé
- [x] Réseau social : fil `/fil` (idée / question / projet, image facultative, chargé par 10, filtre « Mes amis »), j'aime, commentaires, amis (`/amis`, bouton sur les profils), bouton « Signaler » (fenêtre commune `signaler()` dans `public/js/app.js`)
- [x] Demandes et équipes éclair : liste `/demandes`, page `/demande?id=…`, proposition solo, équipe éclair (amis invités avec un rôle, proposition envoyée quand tous ont répondu), choix du client, notifications `/notifications` avec cloche. Pour prévenir un membre : `notifier()` de `src/utils/notifications.js`. Sur téléphone, les liens du menu sont une barre fixe en bas (`.nav-liens`).
- [x] Profil prouvé, vitrine et partage : projets (`/projets` pour gérer, `/projets/:id` page publique) avec badge « Lien vérifié » (`src/utils/liens.js`, protégé contre les adresses internes), avis protégés (`src/routes/avis.js`), recherche de devs `/chercher`, vitrine par secteur sur l'accueil, balises Open Graph ajoutées par le serveur (`src/routes/pages.js`). L'accord du dev pour Facebook est déjà enregistré (`projets.publier_facebook`, `statut_facebook = 'en_attente'`).
- [x] Tableau de bord administrateur `/admin` (`src/routes/admin.js`) : statistiques, signalements regroupés par contenu (masquer / bloquer / classer), projets proposés pour Facebook (`statut_facebook` : `en_attente` → `valide` ou `refuse`), membres bloqués. Rôle admin : `npm run admin -- email` (jamais depuis le site). Les projets ont maintenant une colonne `masque`.
- [x] Calculateur « Combien coûte mon projet ? » `/calculateur`, ouvert à tous : grille dans `public/js/grille-prix.js` (seul fichier à modifier pour un prix), calcul dans `public/js/calcul-prix.js` (dans le navigateur, testé par `tests/calculateur.test.js`), bouton vers `/demandes?publier=1&categorie=…&budget=…` qui pré-remplit le formulaire. L'inscription et la connexion suivent le paramètre `suite` (adresse interne seulement).
- [x] Photos de fond : 5 photos Pexels dans `public/img/fond/`, déjà recadrées et étalonnées, en `fond-N-1080` et `fond-N-1920` (WebP + JPEG). **Ne pas relancer `npm run photos` dessus** (le script ne sert qu'à préparer une nouvelle photo d'origine ; jSquash en dépendance de développement, **pas sharp** : ses binaires libvips sont LGPL). Affichage : `photosDeFond()` et `balisePhoto()` de `src/routes/pages.js` (srcset 1080w/1920w, `sizes="100vw"`, petite taille imposée aux téléphones, une seule photo dans la page) et `public/js/fonds.js` (fondu, rien de plus sur connexion lente). Photos en vraies couleurs sous un dégradé ou un voile vert ; après tout changement de photo ou de voile, revérifier le contraste du texte. Chaque photo est notée dans `LICENCES.md`.
- [x] Pages d'accès : `/connexion` et `/inscription` sont une seule page (`public/connexion.html`, servie par `src/routes/pages.js` qui écrit `data-vue`), avec l'animation de la « lame » (`public/js/acces.js`, clip-path seulement). Une photo posée dans `public/img/fond/` s'affiche dans le panneau vert. L'envoi reste dans `formulaires.js`.
- [x] Refonte du design, étape C (qualité « réseau social ») : couleurs et typographie (vert = action, police du système en 15 px), avatars à teinte stable, **anneau de preuve** et badge feuille (`nbProjetsVerifies` dans `apercuMembre`), en-tête compacte de 56 px avec recherche de membres (`GET /api/devs?q=`), rangée « Disponibles maintenant » (`GET /api/devs/disponibles`), fil bord à bord avec preuve sociale et 2 derniers commentaires (LATERAL, une seule requête), profil avec couverture (`utilisateurs.couverture`, `POST/DELETE /api/profils/moi/couverture`), amis en commun et onglets Publications / Projets / Avis / Amis (`?auteur=` sur le fil, `GET /api/profils/:identifiant/amis`), menu du bas à 5 onglets. Il n'y a pas eu d'étape B.
- [x] Refonte du design, étape A : système de design appliqué à toutes les pages (icônes Lucide, menu du bas avec icônes, badges de type et cœur animé dans le fil, zone « Publier » compacte, bannière et chiffres sur le profil, ombres, animations, squelettes, toasts, fenêtre de confirmation, états vides illustrés).

À faire, dans cet ordre :
1. **Finitions (suite)** : publication automatique sur Facebook des projets `valide` (ou plan B : bouton « publier » dans `/admin`), défi de la semaine en dernier.
2. **Mise en ligne Systalink** vers le 20 octobre (premier essai), version finale le 22-23, contenu de démo, tests sur plusieurs téléphones et en 3G, comptes de démo pour le jury.
