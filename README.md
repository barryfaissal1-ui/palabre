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
- [ ] Calculateur de prix, publication Facebook, défi de la semaine

## Comprendre le code

Explications détaillées, partie par partie : [docs/COMPRENDRE-LE-CODE.md](docs/COMPRENDRE-LE-CODE.md)

## Déclarations pour le concours

- Composants tiers et licences : [LICENCES.md](LICENCES.md)
- Usage de l'intelligence artificielle : [DECLARATION-IA.md](DECLARATION-IA.md)
