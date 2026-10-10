# Mettre Palabre en ligne sur Systalink Datacloud

Guide pour Barry. Compte une heure la première fois. Fais un premier essai vers le 20 octobre, la version finale le 22 ou le 23.

> Je n'ai pas vu l'écran de Systalink : les noms exacts des boutons peuvent différer un peu. Les **valeurs** à saisir, elles, sont celles de ce guide. Ce qui est à vérifier sur place est marqué « à vérifier ».

Il te faut : le compte Systalink de l'équipe, le code promo -40 %, et le dépôt GitHub à jour (`git push` fait).

## 1. Créer la base PostgreSQL 17

1. Dans Systalink, crée un produit **Base de données PostgreSQL**, version **17**.
2. Note ce que Systalink te donne : hôte, port, nom de la base, utilisateur, mot de passe. Souvent il donne aussi une adresse complète qui commence par `postgres://`.
3. Tu n'as **aucune table à créer** : Palabre les crée tout seul à son premier démarrage.

L'adresse complète a cette forme, c'est elle qu'on mettra dans `DATABASE_URL` :

```
postgres://UTILISATEUR:MOT_DE_PASSE@HOTE:PORT/NOM_DE_LA_BASE
```

Si le mot de passe contient `@`, `:`, `/` ou `#`, change-le pour un mot de passe fait de lettres et de chiffres : ces caractères cassent l'adresse.

## 2. Créer le service web Node.js depuis GitHub

1. Crée un produit **Service web Node.js** et relie-le au dépôt GitHub de Palabre, branche `main`.
2. Version de Node.js : **20 ou plus** (22 ou 24 conviennent).
3. Commande d'installation : `npm install` (ou `npm ci`).
4. Commande de démarrage : **`npm start`**
5. Port : Palabre écoute sur le port donné par la variable `PORT`. Si Systalink fournit `PORT` tout seul, ne fais rien. S'il te demande un numéro, mets `3000` et ajoute la variable `PORT=3000` (à vérifier).

Ne démarre pas encore : il manque les variables.

## 3. Les variables d'environnement, une par une

À saisir dans la page « Variables d'environnement » du service web.

| Variable | Valeur | À quoi elle sert |
| --- | --- | --- |
| `NODE_ENV` | `production` | Active les réglages de production (cookie sécurisé, contrôles au démarrage). |
| `URL_PUBLIQUE` | `https://ton-domaine` | L'adresse du site, **en https, sans « / » à la fin**. Elle sert aux liens des emails et aux cartes Facebook / WhatsApp. |
| `DATABASE_URL` | l'adresse `postgres://…` de l'étape 1 | La base de données. |
| `DATABASE_SSL` | `true` si la base est jointe par internet, `false` si elle est sur le réseau privé de Systalink | Chiffre la liaison avec la base. Voir « En cas de problème ». |
| `JWT_SECRET` | une longue clé au hasard (voir ci-dessous) | Signe les sessions. **Ne la montre à personne, ne la mets jamais sur GitHub.** |
| `SMTP_HOST` | serveur d'envoi de l'E-mail Pro | Envoi des emails. |
| `SMTP_PORT` | `465` ou `587` | Voir l'étape 4. |
| `SMTP_USER` | l'adresse email complète, par exemple `no-reply@ton-domaine` | |
| `SMTP_PASS` | le mot de passe de cette boîte | |
| `SMTP_FROM` | `Palabre <no-reply@ton-domaine>` | Le nom affiché comme expéditeur. L'adresse doit être celle de `SMTP_USER`. |

### Générer `JWT_SECRET`

Sur ton ordinateur, dans un terminal :

```
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Copie la ligne affichée (96 caractères) dans `JWT_SECRET`. Garde-la aussi dans un endroit sûr : si tu la changes plus tard, tous les membres seront déconnectés.

**Palabre refuse de démarrer** en production si `JWT_SECRET` est absent, fait moins de 32 caractères ou vaut encore `a-remplacer`, et si `URL_PUBLIQUE` n'est pas une adresse en https. Le journal du service affiche alors « Configuration invalide : … » avec l'explication.

## 4. Brancher l'E-mail Pro (SMTP)

1. Crée le produit **E-mail Pro** et une boîte, par exemple `no-reply@ton-domaine`.
2. Dans l'aide de Systalink, trouve les réglages **SMTP** (envoi) : le nom du serveur et le port.
3. Port `465` = liaison chiffrée dès le départ. Port `587` = chiffrée juste après. Palabre gère les deux : mets celui que Systalink indique.
4. Remplis les cinq variables `SMTP_…` du tableau.

Sans `SMTP_HOST`, les emails ne partent pas : le code à 6 chiffres est seulement écrit dans le journal du serveur, et **personne ne peut s'inscrire** sans y avoir accès. Le journal affiche un avertissement au démarrage dans ce cas.

## 5. Le nom de domaine

1. Dans le service web, ajoute ton nom de domaine et suis les instructions de Systalink pour le relier (enregistrement DNS).
2. Active le **certificat https** (souvent une case « SSL » ou « Let's Encrypt »).
3. Vérifie que `URL_PUBLIQUE` est exactement cette adresse, avec `https://`.

Sans https, la connexion ne fonctionne pas en production : le cookie de session n'est envoyé qu'en https.

## 6. Démarrer

Lance le déploiement. Dans le journal du service, tu dois lire :

```
Palabre démarré sur le port … (production, https://ton-domaine)
```

Ouvre `https://ton-domaine/api/sante` : la réponse doit être `{"ok":true}`.

## 7. Les comptes de démonstration et ton compte administrateur

Ces deux commandes se lancent **sur le serveur** (console ou terminal du service web chez Systalink, à vérifier). Si Systalink ne donne pas de console, lance-les depuis ton ordinateur en mettant d'abord dans ton fichier `.env` local le `DATABASE_URL` de production (et `DATABASE_SSL=true`), puis remets ton `.env` comme avant.

Comptes pour le jury :

```
npm run demo -- --forcer
```

`--forcer` est obligatoire en production : c'est un garde-fou, car le mot de passe de ces comptes est écrit dans `docs/COMPTES-DEMO.md`.

Ton rôle d'administrateur : inscris-toi d'abord sur le site avec ton vrai email, puis :

```
npm run admin -- ton-email@exemple.com
```

## 8. Liste de vérification après la mise en ligne

À faire sur un vrai téléphone, en données mobiles.

- [ ] `https://ton-domaine` s'ouvre, avec le cadenas https.
- [ ] `http://ton-domaine` (sans s) renvoie vers https.
- [ ] **Inscription** avec une vraie adresse : le code à 6 chiffres arrive par email (regarde aussi les indésirables).
- [ ] Le code est accepté ; un dev arrive sur « Ton profil de dev », un client sur le site.
- [ ] **Connexion**, puis fermeture et réouverture du navigateur : tu es toujours connecté.
- [ ] **Mot de passe oublié** : l'email arrive, et son lien commence bien par `https://ton-domaine`.
- [ ] **Photo** de profil : elle s'envoie et s'affiche.
- [ ] **Publication** dans le fil, avec une image, puis avec un lien YouTube : la vidéo se lit.
- [ ] **Message** privé entre deux comptes, avec une photo.
- [ ] **Demande** publiée par un client, **proposition** envoyée par un dev, notification reçue.
- [ ] **Projet** ajouté avec un lien : le badge « Lien vérifié » apparaît.
- [ ] `/admin` s'ouvre avec ton compte, et pas avec un autre.
- [ ] Un lien de profil collé dans **WhatsApp** affiche une carte avec le nom et l'image.
- [ ] Le même lien dans l'outil de Facebook (« Sharing Debugger ») affiche la carte.
- [ ] Sur téléphone, le navigateur propose **d'installer** Palabre.
- [ ] Une adresse inventée (`/nimporte/quoi`) affiche la page « Cette page n'existe pas ».
- [ ] Connexion avec un compte de démonstration de `docs/COMPTES-DEMO.md`.

## En cas de problème

| Ce que tu vois | Cause probable | Quoi faire |
| --- | --- | --- |
| Journal : « Configuration invalide : JWT_SECRET… » | Clé absente, trop courte ou d'exemple | Refais l'étape « Générer JWT_SECRET ». |
| Journal : « Configuration invalide : URL_PUBLIQUE… » | Adresse sans `https://` ou avec un chemin | Mets `https://ton-domaine`, rien d'autre. |
| Journal : « Impossible de démarrer : … SSL … » ou « no pg_hba.conf entry » | La base exige (ou refuse) une liaison chiffrée | Inverse `DATABASE_SSL` (`true` ↔ `false`). |
| Journal : « Impossible de démarrer : … password authentication failed » | Mauvais utilisateur ou mot de passe dans `DATABASE_URL` | Recopie l'adresse depuis Systalink. |
| Le site s'ouvre mais on ne reste pas connecté | Site ouvert en http, ou https pas encore actif | Active le certificat, ouvre en https. |
| Le code d'inscription n'arrive pas | SMTP mal réglé | Regarde le journal au moment de l'inscription : l'erreur d'envoi y est écrite. Vérifie `SMTP_HOST`, le port, `SMTP_USER` et `SMTP_PASS`. |
| Les emails arrivent en indésirables | Le domaine n'autorise pas encore l'envoi | Dans les réglages DNS du domaine, ajoute les enregistrements SPF et DKIM indiqués par Systalink. |
| « Trop de tentatives » dès les premiers essais | Tous les visiteurs semblent venir de la même adresse | À me signaler : il faudra régler `trust proxy` selon le nombre de relais de Systalink. |
| Une ancienne version du site s'affiche sur un téléphone | Le service worker garde l'ancienne | Ferme et rouvre le site ; la nouvelle version arrive au chargement suivant. |

## Mettre à jour le site ensuite

`git push` sur `main`, puis relance le déploiement dans Systalink (ou active le déploiement automatique s'il existe). Les nouvelles tables et colonnes se créent toutes seules au démarrage : il n'y a jamais de commande de base de données à lancer.
