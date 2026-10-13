# Comprendre le code de Palabre

Ce guide explique comment Palabre fonctionne, partie par partie, pour que chaque membre de l'équipe puisse le présenter et répondre aux questions du jury. Il est complété à chaque nouvelle fonctionnalité.

## 1. Vue d'ensemble

Palabre est une application web en trois couches :

```
Navigateur (public/)  ──  requêtes /api/...  ──>  Serveur Node.js (src/)  ──  SQL  ──>  PostgreSQL
   pages HTML, CSS, JS                               Express, règles, sécurité            les données
```

- **Le navigateur** affiche les pages et envoie les actions de la personne (s'inscrire, modifier son profil…).
- **Le serveur** reçoit ces demandes sur des adresses `/api/...`, vérifie tout (qui demande, données valides), puis lit ou écrit dans la base.
- **La base PostgreSQL** garde toutes les données : comptes, profils, compétences, photos…

Le navigateur ne parle jamais directement à la base : tout passe par le serveur, qui contrôle.

## 2. Le démarrage (`server.js`)

1. `migrer()` lit `src/db/schema.sql` et crée les tables qui n'existent pas encore. Le script peut être relancé sans risque (`CREATE TABLE IF NOT EXISTS`), mais il n'est appliqué **que s'il a changé** : son empreinte (SHA-256) est gardée dans la table `schema_applique`. Sans changement, le démarrage ne touche à aucune table.
2. `creerApp()` (dans `src/app.js`) construit l'application avec ses protections et ses routes.
3. Le serveur écoute sur le port indiqué par `PORT`.

Avant tout cela, `src/config.js` lit les réglages. **En production, le serveur refuse de démarrer** si la clé secrète des sessions (`JWT_SECRET`) est absente, fait moins de 32 caractères ou vaut encore la valeur d'exemple, ou si `URL_PUBLIQUE` n'est pas l'adresse du site en https. Mieux vaut un arrêt avec un message clair (« Configuration invalide : … ») qu'un site en ligne dont n'importe qui pourrait fabriquer les sessions. Le guide de mise en ligne est dans `docs/DEPLOIEMENT-SYSTALINK.md`.

## 3. La sécurité, en résumé

| Menace | Protection dans Palabre | Où |
| --- | --- | --- |
| Vol de mots de passe dans la base | Mots de passe jamais stockés en clair : seulement leur empreinte **bcrypt** (coût 12) | `src/routes/auth.js` |
| Vol de session par un script | Session dans un cookie **httpOnly** (invisible au JavaScript), `secure` en production, `SameSite=Lax` | `src/middleware/auth.js` |
| Requêtes forgées depuis un autre site (CSRF) | Toute modification doit être envoyée en JSON, ce qu'un formulaire d'un autre site ne peut pas faire, plus `SameSite=Lax` | `src/app.js` |
| Essais de mots de passe en masse | Limite de 20 tentatives par 15 minutes | `src/routes/auth.js` |
| Découvrir qui est inscrit | Même message que l'email existe ou non (connexion, mot de passe oublié), même temps de réponse | `src/routes/auth.js` |
| Injection de code dans les pages (XSS) | Le texte des membres est toujours inséré avec `textContent`, jamais interprété comme du HTML ; politique de sécurité du contenu (CSP) stricte via **Helmet** | `public/js/app.js`, `src/app.js` |
| Injection SQL | Toutes les requêtes utilisent des paramètres (`$1`, `$2`…), jamais de texte collé dans le SQL | partout dans `src/routes` |
| Faire visiter une adresse interne par le serveur (SSRF) | Liens des projets contrôlés à la saisie, après le DNS et à chaque redirection | `src/utils/liens.js` |
| Faux avis | Avis réservé au client d'une demande terminée, pour le dev retenu, une seule fois | `src/routes/avis.js` |
| Faux fichiers images | Vérification du vrai format par les premiers octets du fichier, taille limitée à 500 Ko | `src/utils/images.js` |
| Collecte de numéros de téléphone | Le numéro WhatsApp n'est montré qu'aux membres connectés ; l'email n'est jamais public ; lecture des profils limitée à 150 par 10 minutes | `src/routes/profils.js` |
| Photo d'un message privé vue par un tiers | `/fichiers/:id` ne sert la photo d'un message qu'aux deux membres de la conversation | `src/routes/fichiers.js` |
| Session restée ouverte après un changement de mot de passe | Une réinitialisation ferme toutes les sessions ouvertes avant (`sessions_depuis`) | `src/middleware/auth.js` |
| Robot qui aspire l'API ouverte | 300 appels par minute et par adresse IP pour les visiteurs | `src/app.js` |
| Site mal réglé en ligne | Refus de démarrer sans clé secrète solide ni adresse https | `src/config.js` |

La relecture complète des routes, avec ce qui a été corrigé et les risques acceptés, est dans `docs/AUDIT-SECURITE.md`.

## 4. Inscription, connexion, mot de passe oublié

**Inscription** (`POST /api/auth/inscription`) : les champs sont vérifiés (`src/utils/validation.js`), le mot de passe est transformé en empreinte bcrypt, un identifiant de profil est créé à partir du nom (« Barry Faïssal » devient `barry-faissal`, ou `barry-faissal-2` s'il est déjà pris), puis la session est ouverte.

**Prénom et nom** : l'inscription et « Modifier mon profil » demandent deux champs, validés par `nomPropre()` (1 à 50 caractères, lettres avec accents, espaces, tirets et apostrophes). La base garde `prenom`, `nom_famille` et aussi `nom`, le nom affiché « Prénom Nom », recalculé à chaque fois : tout le reste du code continue de lire `nom`. Les comptes plus anciens ont été remplis une seule fois par le schéma (`UPDATE … WHERE prenom IS NULL`). Le vrai prénom est envoyé avec chaque aperçu de membre (`apercuMembre`), pour « Aimé par Awa » ou « Quoi de neuf, Awa ? ».

**Connexion** (`POST /api/auth/connexion`) : on compare le mot de passe à l'empreinte. Si l'email n'existe pas, on compare quand même avec une fausse empreinte, pour que la réponse prenne le même temps.

**Session** : un jeton JWT signé avec `JWT_SECRET`, valable 30 jours, rangé dans un cookie httpOnly. À chaque requête, `chargerUtilisateur` vérifie le jeton et retrouve le membre.

**Mot de passe oublié** : un jeton aléatoire de 64 caractères est envoyé par email. La base ne garde que son empreinte SHA-256 : même quelqu'un qui lirait la base ne pourrait pas s'en servir. Le lien expire au bout d'une heure et ne sert qu'une fois.

## 5. Les profils

**Lien court** : `palabre.dev/aminata-dev` affiche le profil d'Aminata. Le serveur renvoie la page `profil.html` pour toute adresse qui ressemble à un identifiant ; la page lit l'identifiant dans l'adresse et demande les données à `GET /api/profils/aminata-dev`. Certains mots sont réservés (`connexion`, `fil`, `admin`…) pour ne jamais entrer en conflit avec les pages du site.

**Ce que voit chacun :**

| Information | Visiteur | Membre connecté | Le propriétaire |
| --- | --- | --- | --- |
| Nom, ville, pays, présentation, compétences, disponibilité | oui | oui | oui |
| Numéro WhatsApp | non (bouton « Se connecter pour contacter ») | oui (bouton « Contacter sur WhatsApp ») | oui |
| Email | jamais | jamais | seulement via son compte |

**Modification** (`PUT /api/profils/moi`) : nom, lien du profil, pays, ville, WhatsApp, présentation (500 caractères), disponibilité et jusqu'à 15 compétences. Tout est enregistré dans une **transaction** : soit tout est enregistré, soit rien (pas de profil à moitié modifié en cas de coupure).

**Compétences** : une liste fixe (table `competences`) reliée aux membres par la table `utilisateur_competences`. Une liste fixe permet ensuite de chercher « tous les devs Flutter à Ouagadougou » de façon fiable.

## 6. Les photos de profil

1. **Dans le navigateur** (`public/js/modifier-profil.js`) : la photo choisie est recadrée en carré, réduite à 400 × 400 pixels et compressée en JPEG. Une photo de 4 Mo prise au téléphone devient environ 40 Ko : l'envoi est rapide même en 3G.
2. **Sur le serveur** (`src/utils/images.js`) : on vérifie le format réel du fichier et sa taille (500 Ko maximum).
3. **Stockage** : l'image est rangée dans la table `fichiers` de la base. Avantage : elle survit aux redéploiements du serveur, sans payer un service de stockage en plus. L'ancienne photo est supprimée quand on en met une nouvelle.
4. **Affichage** : `GET /fichiers/<identifiant>` renvoie l'image avec un cache d'un an. Chaque nouvelle photo reçoit un nouvel identifiant, donc le navigateur ne retélécharge jamais une photo déjà vue : encore des données mobiles économisées.

## 7. Le réseau social

Tout ce chapitre est réservé aux membres connectés : sans session, le serveur répond 401 et la page renvoie vers la connexion.

### Le fil d'actualité (`src/routes/publications.js`, `public/js/fil.js`)

- **Publier** (`POST /api/publications`) : un type (`idee`, `question` ou `projet`), un texte de 3000 caractères au plus, et une image facultative. L'image est réduite dans le navigateur (1080 px de côté au plus, JPEG) par `reduireImage()` de `public/js/app.js`, puis vérifiée et rangée dans la table `fichiers` comme les photos de profil. L'image et la publication sont enregistrées dans une même **transaction**.
- **Chargement par 10** (`GET /api/publications?avant=<numéro>`) : le serveur renvoie les 10 publications les plus récentes, puis la page envoie le numéro de la dernière affichée pour avoir les 10 d'avant (bouton « Voir plus de publications »). Cette méthode reste rapide même avec des milliers de publications, et ne crée pas de doublon si quelqu'un publie pendant qu'on lit. Pour savoir s'il en reste, le serveur en demande 11 et n'en renvoie que 10.
- **Filtre « Mes amis »** (`?amis=1`) : seulement ses propres publications et celles de ses amis.
- **Suppression** : seul l'auteur (ou un administrateur) peut supprimer une publication ; ses j'aime, ses commentaires et son image partent avec.
- Les publications masquées par un administrateur et celles des comptes bloqués n'apparaissent jamais.

### J'aime et commentaires

- **J'aime** (`POST` et `DELETE /api/publications/:id/jaime`) : la table `jaime` a pour clé primaire le couple (publication, membre). La base elle-même empêche donc d'aimer deux fois : un double clic ne compte pas double.
- **Commentaires** (`GET` et `POST /api/publications/:id/commentaires`) : 1000 caractères au plus, chargés seulement quand on ouvre la zone de commentaires (moins de données en 3G). Chacun peut supprimer les siens.

### Les amis (`src/routes/amis.js`, `public/js/amis.js`)

Une seule ligne de la table `amities` relie deux membres, avec un statut : `en_attente`, `acceptee` ou `refusee`. Un index unique sur la paire empêche d'avoir une demande dans chaque sens.

| Action | Adresse | Règle vérifiée par le serveur |
| --- | --- | --- |
| Envoyer une demande | `POST /api/amis/demandes` | pas à soi-même, pas deux fois, pas si on est déjà amis |
| Accepter / refuser | `POST /api/amis/demandes/:identifiant/accepter` ou `/refuser` | seul celui qui a **reçu** la demande peut répondre |
| Retirer un ami, annuler sa demande | `DELETE /api/amis/:identifiant` | |
| Voir ses amis et ses demandes | `GET /api/amis` | |

Cas particuliers : si deux membres se demandent en même temps, ils deviennent amis tout de suite. Après un refus, celui qui a demandé voit toujours « Demande envoyée » (le refus n'est pas révélé) et ne peut pas insister ; celui qui a refusé peut changer d'avis et demander à son tour. L'envoi d'une demande se fait dans une transaction avec verrou (`FOR UPDATE`).

Sur un profil, le serveur indique le lien avec le visiteur (`amitie` : `aucune`, `envoyee`, `recue`, `amis`) et la page affiche le bon bouton. Le menu montre une pastille avec le nombre de demandes à traiter.

### Les signalements (`src/routes/signalements.js`)

Le bouton « Signaler » (publications, commentaires, profils) ouvre une fenêtre commune, `signaler()` dans `public/js/app.js` : un motif à choisir et une précision facultative. Le serveur vérifie que la cible existe, refuse qu'on signale son propre contenu, et n'enregistre qu'un signalement par membre et par cible. Les signalements seront traités dans le tableau de bord administrateur.

### Protection contre les abus

Les envois sont limités **par membre** et non par adresse IP, car sur les réseaux mobiles beaucoup de personnes partagent la même adresse : 30 publications et 60 commentaires par quart d'heure, 40 demandes d'amis et 20 signalements par heure (`limiteParMembre` dans `src/utils/membres.js`).

Le texte des publications et des commentaires est affiché avec `textContent` : si quelqu'un écrit `<script>` dans un commentaire, on voit ces caractères à l'écran, rien ne s'exécute.

## 8. Les demandes des clients et les équipes éclair

C'est le cœur de Palabre : un client décrit son besoin, les développeurs répondent seuls ou à plusieurs, le client compare et choisit. Tout est réservé aux membres connectés.

### La vie d'une demande

```
ouverte ──(le client choisit une proposition)──> attribuée ──(travail fini)──> terminée
   └────(le client annule)────> annulée
```

- **Publier** (`POST /api/demandes`, comptes **client** seulement) : titre, description, catégorie (liste fixe dans `src/utils/validation.js`), budget en FCFA et délai facultatifs. Le budget accepte « 250 000 » avec des espaces ; sans budget, la page affiche « À discuter ».
- **Liste** (`GET /api/demandes`) : les demandes ouvertes, par 10, avec un filtre par catégorie. L'onglet « Mes demandes » (client) ou « Mes propositions » (dev) retrouve celles où l'on est concerné, quel que soit leur statut.
- **Détail** (`GET /api/demandes/:id`, page `/demande?id=…`) : la demande et les propositions **que l'on a le droit de voir**.

### Qui voit quelles propositions ?

| Qui regarde | Ce qu'il voit |
| --- | --- |
| Le client propriétaire | toutes les propositions qui lui ont été envoyées |
| Un développeur | seulement les siennes : en solo, comme chef d'équipe ou comme invité |
| Un autre client | aucune |

Un développeur ne voit donc jamais l'offre ni le prix d'un concurrent. C'est le serveur qui filtre (`propositionsVisibles` dans `src/routes/demandes.js`), pas la page.

### Proposer seul

`POST /api/demandes/:id/propositions` (comptes **dev**) : un message et un montant facultatif. Un index unique en base garantit une seule proposition en solo par développeur et par demande. Le client reçoit une notification. Le développeur peut retirer sa proposition tant que le client n'a pas choisi.

### L'équipe éclair

1. **Création** (`POST /api/demandes/:id/equipes`) : le chef écrit la proposition, indique son rôle et invite de 1 à 5 **amis développeurs**, chacun avec un rôle. Le serveur vérifie l'amitié en base : impossible d'inviter un inconnu ou un client. L'équipe, ses membres, la proposition (statut `brouillon`) et les notifications d'invitation sont créés dans une seule **transaction**.
2. **Réponses** (`POST /api/equipes/:id/accepter` ou `/refuser`, dans `src/routes/equipes.js`) : seul un invité peut répondre, une seule fois.
3. **Envoi automatique** : quand le dernier invité a répondu, la proposition passe de `brouillon` à `envoyee` et le client est prévenu. Elle part avec ceux qui ont accepté ; ceux qui ont refusé n'apparaissent pas chez le client. Si tout le monde a refusé, rien ne part : le chef est prévenu et peut dissoudre l'équipe.

Tant que la proposition est en `brouillon`, le client ne la voit pas et elle n'est pas comptée. Si deux invités répondent au même instant, un verrou sur l'équipe (`FOR UPDATE`) les fait passer l'un après l'autre : le dernier voit bien que tout le monde a répondu.

### Le choix du client

`POST /api/demandes/:id/choisir` : dans une transaction, la proposition choisie passe à `acceptee`, toutes les autres à `refusee`, et la demande à `attribuee`. Le développeur choisi, ou chaque membre de l'équipe choisie, reçoit une notification. La demande est verrouillée pendant l'opération : un double clic ne peut pas attribuer la demande deux fois.

### Les notifications (`src/routes/notifications.js`, `src/utils/notifications.js`)

La fonction `notifier()` ajoute une ligne dans la table `notifications` : un type, un texte et un lien interne. Quand elle est appelée dans une transaction, la notification est annulée avec le reste si l'action échoue.

| Événement | Qui est prévenu |
| --- | --- |
| Demande d'ami reçue, demande d'ami acceptée | le membre concerné |
| Invitation dans une équipe éclair | chaque invité |
| Nouvelle proposition (solo ou équipe) | le client |
| Proposition choisie | le dev, ou tous les membres de l'équipe |
| Tous les invités ont répondu | le chef d'équipe |

La **cloche** du menu affiche le nombre de notifications non lues (compté dans `GET /api/auth/moi`, donc sans requête supplémentaire). La page `/notifications` liste les 30 dernières ; cliquer sur une notification la marque comme lue puis ouvre la page concernée. Un membre ne peut marquer que ses propres notifications.

### Le menu sur téléphone

Avec « Fil », « Demandes », « Amis », la cloche et la photo, le menu ne tient plus sur 390 px. Sur téléphone, les trois liens principaux forment donc une **barre fixe en bas de l'écran**, à portée de pouce comme dans une application ; sur grand écran ils restent en haut. C'est le même HTML : seule la feuille de style change (`.nav-liens` dans `public/css/style.css`).

## 9. Le profil prouvé, la vitrine et le partage

L'idée : sur Palabre, un développeur ne se contente pas de dire qu'il est bon. Il le **prouve** avec des projets dont le lien fonctionne et des avis laissés par de vrais clients.

### Les projets réalisés (`src/routes/projets.js`, page `/projets`)

Un dev ajoute un projet : titre, description, secteur (liste fixe), lien et capture d'écran facultatifs, et son accord éventuel pour une publication sur la page Facebook. Chaque projet a sa page publique `/projets/12`, visible sans compte. 20 projets au plus par développeur.

### Le badge « Lien vérifié » (`src/utils/liens.js`)

À l'ajout d'un projet, **le serveur visite lui-même le lien**. Si le site répond (code 2xx), il note la date dans `lien_verifie_le` et le badge apparaît partout : profil, vitrine, recherche. Sinon le projet est gardé, sans badge, et le dev peut relancer la vérification.

Ce que le badge prouve : le lien existe et fonctionne. Il ne prouve pas à lui seul que le dev en est l'auteur ; c'est pour cela qu'il y a aussi les avis et le bouton « Signaler » sur chaque projet.

**Le piège à éviter (attaque « SSRF »).** Comme c'est le serveur qui visite, un membre malveillant pourrait lui donner une adresse **interne** (`http://localhost:5432`, `http://192.168.1.1`, l'adresse de la console de l'hébergeur…) pour sonder un réseau auquel il n'a pas accès. Quatre protections, toutes testées :

| Protection | Ce qu'elle bloque |
| --- | --- |
| Contrôle à la saisie (`normaliserLien`) | `localhost`, les IP privées, tout ce qui n'est pas `http`/`https`, les ports, les identifiants dans l'adresse. Les écritures déguisées (`http://2130706433/`, `http://0x7f.0.0.1/`) sont ramenées à leur vraie forme `127.0.0.1`, puis refusées |
| Contrôle après le DNS | un nom d'apparence normale qui mène en réalité à une adresse interne ; une seule adresse interne suffit à refuser |
| Connexion à l'adresse contrôlée | le DNS qui répondrait une adresse publique au contrôle puis une adresse interne à la connexion (« DNS rebinding ») : on se connecte à l'adresse déjà vérifiée, sans redemander |
| Redirections suivies à la main | un site public qui redirige vers une adresse interne : chaque redirection (3 au plus) repasse tous les contrôles |

La liste des plages interdites (10.x, 127.x, 169.254.x, 172.16-31.x, 192.168.x, IPv6 locales…) est tenue par `net.BlockList`, un outil fourni avec Node.js. La visite est limitée à 5 secondes et ne télécharge pas la page : seul le code de réponse est lu.

### Les avis protégés (`src/routes/avis.js`)

`POST /api/avis` : une note de 1 à 5 et un commentaire facultatif. Une seule requête SQL vérifie les trois conditions : la demande appartient au client connecté, elle est **terminée**, et le dev noté est celui de la proposition **acceptée** (ou un membre, ayant accepté, de l'équipe choisie). Une contrainte `UNIQUE (demande, dev)` en base interdit un second avis. Pour une équipe, le client note chaque membre séparément. Le formulaire apparaît sur la page de la demande une fois celle-ci terminée ; le dev reçoit une notification.

Résultat : il est impossible de s'écrire un avis à soi-même, de noter un dev avec qui on n'a pas travaillé, ou de noter deux fois.

### La recherche de devs (`src/routes/devs.js`, page `/chercher`)

Par compétence, pays, ville (une partie du nom suffit, sans tenir compte des majuscules) et disponibilité. Ouverte aux visiteurs, mais sans email ni numéro de téléphone. Les devs disponibles viennent d'abord, puis les mieux notés, puis ceux qui ont le plus de projets vérifiés. Dans la recherche par ville, les caractères `%` et `_` (jokers en SQL) sont neutralisés.

### La vitrine de l'accueil (`public/js/vitrine.js`)

La page d'accueil affiche les projets, par 9, avec un filtre par secteur. Elle est visible sans compte : c'est ce que voit un client qui découvre Palabre.

### Les cartes de partage Facebook / WhatsApp (`src/routes/pages.js`)

Quand on colle un lien dans WhatsApp ou Facebook, leur robot lit la page **sans exécuter le JavaScript**. Il lui faut des balises « Open Graph » (`og:title`, `og:description`, `og:image`, `og:url`) déjà écrites dans le HTML. Pour l'accueil, les profils (`/barry-faissal`) et les projets (`/projets/12`), le serveur remplace donc le `<title>` de la page par un titre et des balises propres au contenu : nom, ville et présentation du dev avec sa photo ; titre et capture d'écran du projet.

Quand la page n'a pas d'image à elle (accueil, calculateur, profil sans photo, projet sans capture), le serveur indique l'image de partage de Palabre, `public/img/palabre-partage-1200x630.png`. Elle fait 1200 × 630 pixels, le format des grandes cartes de Facebook et WhatsApp, et le serveur annonce ces dimensions (`og:image:width`, `og:image:height`) pour que la grande carte s'affiche dès le premier partage.

Deux précautions : le texte des membres est **échappé** (`<` devient `&lt;`…) avant d'entrer dans le HTML, sinon un nom piégé deviendrait du code ; et l'adresse de l'image est complète (avec `URL_PUBLIQUE`), comme l'exigent Facebook et WhatsApp. Un profil ou un projet inconnu renvoie un vrai code 404.

## 10. L'administration (`src/routes/admin.js`, page `/admin`)

### Qui est administrateur ?

Un compte dont la colonne `est_admin` vaut vrai. **Aucune page et aucune route du site ne permet de se donner ce rôle** : il faut avoir accès au serveur et lancer une commande.

```
npm run admin -- email@exemple.com             donne le rôle
npm run admin -- email@exemple.com retirer     le retire
```

Toutes les routes `/api/admin/…` passent par `exigerConnexion` puis `exigerAdmin` : un visiteur reçoit 401, un membre ordinaire 403. La page `/admin` n'est qu'un affichage ; même en bricolant la page, un membre ordinaire n'obtient rien, car c'est le serveur qui refuse.

### Les statistiques

Six compteurs calculés en une seule requête : développeurs, clients, publications, demandes, projets, propositions acceptées. Les comptes bloqués et les contenus masqués ne sont pas comptés.

### Les signalements

Les signalements ouverts sont **regroupés par contenu** : si trois membres signalent la même publication, l'administrateur voit une seule carte avec les trois motifs, le texte signalé et son auteur. Trois décisions possibles :

| Décision | Effet | Statut du signalement |
| --- | --- | --- |
| Masquer le contenu | la colonne `masque` passe à vrai : la publication, le commentaire, la demande ou le projet disparaît pour tout le monde | `traite` |
| Bloquer le membre | la colonne `bloque` passe à vrai : il est déconnecté, ne peut plus se connecter, et son profil comme tout ce qu'il a publié disparaissent | `traite` |
| Classer sans suite | rien ne change | `rejete` |

La décision s'applique à tous les signalements ouverts qui visent le même contenu, dans une transaction. Garde-fous : un profil ne se « masque » pas (on bloque ou on classe), un administrateur ne peut pas être bloqué, et si l'auteur a supprimé son contenu entre-temps la carte l'indique et il ne reste qu'à classer.

Rien n'est supprimé de la base : masquer et bloquer sont réversibles. Une liste « Membres bloqués » permet de débloquer quelqu'un en cas d'erreur.

### Les projets proposés pour Facebook

Seuls les projets dont le dev a coché son accord (`publier_facebook`) arrivent ici, avec le statut `en_attente`. L'administrateur les **valide** (`valide`) ou les **refuse** (`refuse`) ; le dev reçoit une notification. Un projet refusé pour Facebook reste visible sur Palabre.

### À publier sur Facebook (le « plan B »)

Publier automatiquement sur une page Facebook demande une application validée par Meta et un jeton d'accès à garder secret : long à obtenir, et risqué à stocker. Palabre fait plus simple : **l'administrateur publie lui-même**, et le site lui prépare tout.

Pour chaque projet `valide`, la section « À publier sur Facebook » montre :

- un **texte tout prêt**, construit par le serveur (`texteFacebook()` : titre, description raccourcie, nom et ville du dev, secteur, lien public du projet, hashtags), dans une zone de texte modifiable. Il est posé avec `.value` : le titre d'un projet, même piégé, reste du texte ;
- **« Copier le texte »** (presse-papiers) et **« Ouvrir Facebook »**, qui ouvre la fenêtre de partage de Facebook avec l'adresse du projet. Facebook visite cette adresse, lit ses balises Open Graph (chapitre 9) et dessine la carte tout seul ;
- **« Marquer comme publié »** : le projet passe à `publie`, la date est notée dans `publie_facebook_le`, et le dev reçoit « Ton projet a été partagé sur la page Facebook Palabre Dev ».

**5 publications par jour au plus** (règle du plan, pour ne pas lasser les abonnés) : le compteur « Publiés aujourd'hui : 3 / 5 » compte les projets marqués aujourd'hui, en heure GMT. Le contrôle et la mise à jour sont dans une transaction, derrière un verrou PostgreSQL : deux clics au même instant ne peuvent pas faire six.

## 11. Le calculateur « Combien coûte mon projet ? » (page `/calculateur`)

Un visiteur, même sans compte, répond à quatre questions (une par écran, avec une barre de progression) et obtient une fourchette de prix en FCFA. C'est une porte d'entrée pour les clients : ils arrivent avec une question simple et repartent avec une demande publiée.

### Trois fichiers, trois rôles

| Fichier | Rôle |
| --- | --- |
| `public/js/grille-prix.js` | **la grille de prix, et rien d'autre** : c'est le seul fichier à modifier pour changer un montant |
| `public/js/calcul-prix.js` | la fonction `estimerPrix(grille, choix)` : le calcul, sans toucher à la page |
| `public/js/calculateur.js` | l'affichage : les écrans, la barre de progression, le résultat |

Les questions affichées sont construites à partir de la grille : ajouter une option dans la grille l'ajoute à l'écran, sans autre modification.

### Le calcul

```
(prix de base × taille) + options, puis × 1,25 si urgent, arrondi à 5 000 FCFA
```

Il est fait deux fois, avec le prix minimum puis le prix maximum du type de projet : cela donne la fourchette. Exemple : boutique en ligne (200 000 à 450 000), 6 à 15 pages (+30 %), Mobile Money et logo (+100 000), urgent (+25 %) :

- minimum : (200 000 × 1,3 + 100 000) × 1,25 = 450 000
- maximum : (450 000 × 1,3 + 100 000) × 1,25 = 856 250, arrondi à 855 000

La majoration de taille porte sur le prix de base seulement ; celle du délai porte sur le total. Les pourcentages sont appliqués sous la forme « × 130 / 100 » pour ne manipuler que des nombres entiers et éviter les erreurs d'arrondi des nombres à virgule.

**Tout se passe dans le navigateur** : aucune requête au serveur pour calculer, donc le résultat est immédiat même en 3G, et le serveur n'a rien à supporter. Le résultat rappelle que c'est une estimation et que le vrai prix se fixe avec le développeur.

### Du calculateur à la demande

Le bouton « Publier ma demande avec ce budget » ouvre `/demandes?publier=1&categorie=…&budget=…` : le formulaire s'ouvre avec la catégorie et le budget (le milieu de la fourchette) déjà remplis. Un visiteur sans compte passe d'abord par l'inscription en compte client, qui le ramène ensuite au formulaire grâce au paramètre `suite`.

Deux précautions de sécurité :

- `suite` n'est suivi que s'il désigne une page de Palabre (il doit commencer par un seul `/`). Sinon, quelqu'un pourrait fabriquer un lien Palabre qui renvoie vers un site piégé après la connexion.
- la catégorie et le budget lus dans l'adresse ne sont gardés que s'ils sont une catégorie connue et un nombre ; le serveur revérifie de toute façon à l'envoi.

Le bouton « Partager sur WhatsApp » prépare un message avec la fourchette et le lien du calculateur. La page a ses balises de partage, écrites par le serveur comme pour les profils.

## Palabre Messages : la messagerie privée

Les membres s'écrivent en privé (`/messages`). Code : `src/routes/messages.js`, `public/js/messages.js`, `tests/messages.test.js`.

### Qui peut écrire à qui

| Situation | Ce qui se passe |
| --- | --- |
| Deux amis | ils s'écrivent librement |
| Un client et un dev qui lui a envoyé une proposition (seul, ou comme chef d'une équipe éclair) | ils s'écrivent librement ; la conversation rappelle en haut la demande concernée |
| Deux membres sans lien | UN premier message : c'est une « demande de message », rangée à part chez le destinataire |

Le destinataire d'une demande de message choisit : **Accepter** (la conversation devient normale), **Refuser** ou **Bloquer**. Tant que ce n'est pas accepté, l'expéditeur ne peut rien envoyer de plus.

- **Un refus n'est jamais annoncé.** Refuser cache la conversation chez celui qui refuse (table `conversation_masquees`) et ne change rien d'autre : chez l'expéditeur, la demande reste « en attente », avec exactement le même message d'erreur qu'avant. Il ne peut pas savoir s'il a été refusé ou simplement pas encore lu.
- **Lire une demande sans l'accepter ne se voit pas** : la mention « Vu » n'est pas envoyée.
- **Bloquer** (table `blocages`) : le membre bloqué ne peut plus écrire et ne voit plus la conversation. On ne lui dit pas qu'il est bloqué : le serveur répond « Tu ne peux pas écrire à ce membre », ou 404.
- Toutes ces règles sont décidées par **le serveur**, dans une seule fonction, `droitDEcrire()`. La page ne fait qu'afficher sa réponse.

### Les tables

| Table | Rôle |
| --- | --- |
| `conversations` | une ligne par paire de membres. `membre_a < membre_b` et `UNIQUE (membre_a, membre_b)` : il ne peut pas y avoir deux conversations entre les deux mêmes personnes, même si elles s'écrivent au même instant (`ON CONFLICT`) |
| `messages` | le texte (1 à 2000 caractères) et une photo facultative, rangée dans `fichiers` comme les autres images |
| `conversation_lectures` | pour chaque membre, le numéro du dernier message qu'il a lu |
| `blocages` | qui a bloqué qui |
| `conversation_masquees` | conversation cachée d'un seul côté (refus, ou « Supprimer la conversation ») ; elle réapparaît si un nouveau message arrive |

**Non lus et « Vu » avec un seul nombre.** On ne note pas « lu » sur chaque message. On retient seulement, par membre, le numéro du dernier message lu. Les non lus sont les messages de l'autre dont le numéro est plus grand ; « Vu » s'affiche sous mon dernier message quand le « dernier lu » de l'autre l'a atteint. Une ligne à mettre à jour au lieu de cent.

### Sécurité

- **Un intrus reçoit 404**, pas 403 : `maConversation()` vérifie à chaque route que je fais partie de la conversation, et répond comme si elle n'existait pas. On ne peut donc même pas deviner quelles conversations existent en essayant des numéros.
- Le texte d'un message est affiché avec `textContent` : une balise écrite dans un message reste du texte, et un lien n'est pas cliquable (pas d'hameçonnage par lien déguisé).
- **Limites** : 30 messages par minute, et 10 premières prises de contact par jour avec des inconnus (contre le démarchage en masse). La seconde n'est appliquée qu'au moment d'ouvrir une conversation avec quelqu'un qu'on ne connaît pas.
- **Signaler** : on signale le dernier message reçu. Dans `/admin`, l'administrateur ne voit que ce message, jamais le reste de la conversation ; il peut le masquer ou bloquer son auteur.
- La cloche ne sonne que pour une nouvelle demande de message, pas pour chaque message.

### Pas de WebSocket : pourquoi, et comment

Un WebSocket garde une connexion ouverte en permanence : c'est coûteux en batterie et fragile sur un réseau mobile qui coupe souvent. Palabre fait plus simple : la page **redemande** au serveur « quoi de neuf depuis le message n° X ? » (`GET …/nouveaux?apres=X`).

- toutes les **5 secondes**, seulement si une conversation est ouverte **et** que l'onglet est visible ;
- toutes les **60 secondes** pour la pastille de l'en-tête, sur les autres pages ;
- **rien du tout** quand l'onglet est en arrière-plan (`document.hidden`) ; au retour, on rattrape tout de suite.

La réponse à « quoi de neuf ? » est presque toujours une liste vide de quelques octets. Les messages sont chargés par paquets de 30, comme le fil.

### La page

Une seule page pour la liste et la conversation (`/messages` et `/messages/12`) : on passe de l'une à l'autre sans rechargement (`history.pushState`). Sur ordinateur, la liste est à gauche et la conversation à droite. Sur téléphone, la conversation prend tout l'écran, le menu du bas disparaît, et sa hauteur suit la partie visible de l'écran (`visualViewport`) : quand le clavier s'ouvre, la zone d'écriture reste au-dessus.

## 11 bis. L'inscription en deux étapes : contre les robots et les faux profils

Un réseau où l'on confie un projet et un budget attire deux problèmes : les **robots** qui créent des comptes par centaines, et les **faux développeurs**. L'inscription leur oppose quatre barrières.

### Trois protections contre les robots (pour tout le monde)

1. **Le champ piège.** Le formulaire contient un champ « Site web » que personne ne voit : il est sorti de l'écran par le CSS, hors du parcours au clavier (`tabindex="-1"`) et caché aux lecteurs d'écran (`aria-hidden`). Une personne ne le remplit jamais ; un robot qui remplit tous les champs, si. Le serveur refuse alors, avec un message vague : on n'explique pas au robot ce qui l'a trahi.
2. **L'heure d'ouverture signée.** À l'ouverture du formulaire, le navigateur demande au serveur un petit texte : l'heure, suivie d'une **signature** (`src/utils/inscription.js`, `jetonOuverture`). La signature est calculée avec un secret que seul le serveur connaît (HMAC-SHA256). À l'inscription, le serveur relit l'heure : moins de 3 secondes, c'est trop rapide pour une personne. Le navigateur ne peut pas tricher : s'il change l'heure, la signature ne correspond plus. Une simple heure envoyée par le navigateur, sans signature, n'aurait rien prouvé.
3. **Le code reçu par email.** Après l'inscription, un code à 6 chiffres part à l'adresse donnée (`mailer.js` ; sans SMTP, il s'affiche dans la console du serveur, comme le lien du mot de passe oublié). Il est valable 15 minutes.

### Le code : ce qui le rend sûr

- Il est tiré par `crypto.randomInt` (un vrai hasard, pas `Math.random`).
- La base ne garde **jamais le code**, seulement son **empreinte** (table `confirmations_email`, colonne `code_hash`). L'empreinte mélange le code, le numéro du membre et le secret du serveur : quelqu'un qui volerait une copie de la base ne pourrait pas retrouver les codes.
- **5 essais** par code. Sans cette limite, il suffirait d'essayer les 1 000 000 de codes possibles. L'essai et son compteur passent dans une transaction avec `FOR UPDATE` : deux essais envoyés au même instant ne peuvent pas compter pour un seul.
- **« Renvoyer le code »** : un par minute, cinq par heure, comptés en base (une ligne par envoi). Seul le dernier code envoyé est valable.
- Tant que `utilisateurs.email_confirme_le` est vide, le serveur refuse **toutes** les routes de l'API sauf `/api/auth` (`exigerEmailConfirme`, posé une seule fois sur `/api` dans `src/app.js`). Le site, lui, ramène le membre sur `/confirmer-email`. C'est le serveur qui protège ; la redirection n'est qu'un confort.

### La page 2 des développeurs : « Ton profil de dev » (`/bienvenue`)

Un client a fini après le code. Un développeur a une seconde page (`PUT /api/profils/moi/profil-dev`, règles dans `src/utils/profil-dev.js`) :

- **date de naissance**, 18 ans au moins. Elle ne sert qu'à ce contrôle : elle n'est renvoyée par **aucune** route, même pas à son propriétaire, et elle n'est même pas chargée dans la session. Seul l'administrateur voit **l'âge** (pas la date), calculé par la base, dans « Derniers inscrits » de `/admin` ;
- **spécialité** et **années d'expérience**, choisies dans deux listes fixes ;
- **liens** GitHub, GitLab, portfolio, LinkedIn. Chacun passe par `normaliserLien` (adresses internes refusées, voir le chapitre 9), doit être sur le bon site (un lien « GitHub » qui mène ailleurs est refusé), puis le serveur le visite : s'il répond, il porte le badge **« Lien vérifié »**. Un lien qui n'a pas changé n'est pas revisité ;
- un dev qui n'a encore aucun lien peut cocher « Je n'ai pas encore de lien » : il continue, mais son profil porte la mention **« Profil à confirmer »** jusqu'à ce qu'il en ajoute un ;
- numéro WhatsApp (facultatif) et courte présentation (20 à 300 caractères).

### Ce qu'un dev au profil incomplet ne peut pas faire

Tant que `profil_complete_le` est vide, il peut tout regarder, publier dans le fil et écrire à d'autres devs. Mais le serveur répond **403** s'il veut envoyer une proposition, créer ou rejoindre une équipe éclair, ou écrire à un client (`exigerProfilComplet` dans `src/middleware/auth.js`, et un contrôle dans `ecrire()` de la messagerie). La réponse contient `suite: '/bienvenue'`, et le site affiche un bandeau « Termine ton profil de dev pour répondre aux demandes ».

### Les comptes qui existaient déjà

La colonne `email_confirme_le` est créée dans un bloc `DO` du schéma : **au moment où elle est créée**, et seulement là, tous les comptes présents sont marqués confirmés. Un simple `UPDATE … WHERE email_confirme_le IS NULL` rejoué à chaque démarrage aurait confirmé tous les nouveaux inscrits sans code. Les développeurs déjà inscrits, eux, sont envoyés sur `/bienvenue` à leur prochaine connexion. Les comptes de démonstration sont confirmés et complétés par `scripts/demo.js`.

## 11 ter. Les vidéos du fil

Un membre peut joindre **un lien vidéo** à une publication : YouTube, TikTok ou Facebook. Deux soucis guident tout le code : la **sécurité** (ne pas afficher n'importe quelle page dans le fil) et la **3G** (une vidéo pèse lourd).

### On ne garde jamais l'adresse

Le lien collé est lu par `lireLienVideo()` (`src/utils/videos.js`). Pour chaque plateforme, la liste des noms de site est **exacte** (`youtube.com`, `youtu.be`… et non « contient youtube »), et une expression stricte extrait l'identifiant : 11 caractères pour YouTube, un nombre pour TikTok et Facebook. La base ne reçoit que deux petites valeurs, `video_plateforme` et `video_id`, et une contrainte `CHECK` refuse tout le reste même en cas d'écriture directe.

Conséquence : c'est **le site** qui reconstruit l'adresse du lecteur officiel à partir de l'identifiant. Un lien comme `youtube.com.pirate.example`, `youtube.com@pirate.example` ou `javascript:…` n'a aucune chance : il n'est pas reconnu, donc rien n'est enregistré. Les paramètres de suivi (`?si=…`) disparaissent aussi.

### Rien n'est chargé avant le toucher

- **YouTube** : une miniature (une simple image de `i.ytimg.com`, en `loading="lazy"`) et un bouton lecture. Au toucher seulement, le lecteur `youtube-nocookie.com` est créé (la version de YouTube qui ne dépose pas de cookie avant la lecture).
- **TikTok et Facebook** : une carte (« Vidéo TikTok », bouton « Lire la vidéo »). Aucune requête ne part vers eux avant le toucher.
- Sous chaque vidéo : « La vidéo utilise tes données mobiles ».

Sans cela, dix vidéos dans le fil chargeraient dix lecteurs de plusieurs centaines de kilo-octets chacun, que le membre les regarde ou non.

### La CSP n'ouvre que ce qu'il faut

Dans `src/app.js`, deux lignes : `frame-src` (les cadres) autorise seulement `www.youtube-nocookie.com`, `www.tiktok.com` et `www.facebook.com` ; `img-src` ajoute `i.ytimg.com`. Les scripts restent limités au site lui-même. Un détail : Helmet empêche le navigateur de dire d'où il vient, mais YouTube refuse alors de lire ; le cadre porte donc `referrerpolicy="strict-origin-when-cross-origin"`, qui ne donne que le nom du site, jamais la page.

### L'aperçu avant de publier

Le bouton « Vidéo » ouvre un champ. Une demi-seconde après la dernière touche, le navigateur demande au serveur `GET /api/publications/video?lien=…` : les règles ne sont écrites qu'**une fois**, côté serveur, et l'aperçu est dessiné par la même fonction que dans le fil (`videoPublication()` de `public/js/publication.js`).

## 11 quater. Le défi de la semaine

Chaque semaine, l'équipe pose un problème concret. Les développeurs proposent une solution, les membres votent, un gagnant est désigné. Tout est dans `src/routes/defis.js` (et la création dans `src/routes/admin.js`).

### Deux dates, trois phases

Un défi a une **fin des réponses** et une **fin du vote**. Sa phase n'est pas enregistrée : elle se **déduit de l'heure**, par la base elle-même (`PHASE`, un `CASE` en SQL) :

- avant la fin des réponses : `reponses`. Un dev au profil complet répond (20 à 2000 caractères, lien facultatif vérifié par `liens.js`), et peut modifier ou retirer sa réponse ;
- ensuite, jusqu'à la fin du vote : `vote`. Chaque membre connecté vote pour une réponse, et peut changer d'avis ;
- après : `termine`.

C'est l'horloge du serveur qui fait foi : changer l'heure de son téléphone ne permet ni de répondre en retard, ni de voter en avance.

### Les règles sont dans la base, pas seulement dans le code

- **Une seule réponse par dev** : contrainte `UNIQUE (defi_id, dev_id)`. Répondre une seconde fois, c'est modifier (`INSERT … ON CONFLICT … DO UPDATE`).
- **Un seul vote par membre** : la clé primaire de `defi_votes` est `(defi_id, utilisateur_id)`. Changer d'avis remplace la ligne.
- **Pas de vote pour soi** : vérifié dans la transaction du vote.
- **Un seul défi en cours** : la création est refusée s'il en existe un.

Même si quelqu'un appelait l'API cent fois en même temps, la base refuserait le deuxième vote : ce n'est pas le bouton grisé qui protège.

### Les compteurs restent cachés pendant le vote

Pendant le vote, le serveur n'envoie **pas** le nombre de votes de chaque réponse (`nbVotes: null`) : un compteur visible pousserait à voter pour celui qui est déjà en tête. Chacun voit seulement son propre vote. Les compteurs apparaissent à la fin.

### Désigner le gagnant sans tâche programmée

Il n'y a pas de minuteur qui tourne sur le serveur. À chaque lecture du défi, `cloreDefisFinis()` regarde si un vote est terminé ; si oui, elle désigne le gagnant : le plus de votes, et **la réponse la plus ancienne en cas d'égalité**. Sans aucun vote, il n'y a pas de gagnant. Le gagnant reçoit une notification et le badge « Gagnant du défi » sur son profil.

Piège évité : deux lectures au même instant ne doivent pas désigner (ni prévenir) deux fois. La requête prend le défi avec `FOR UPDATE SKIP LOCKED` : la première lecture le verrouille et fait le travail, la seconde le saute.

### Où on le voit

La page `/defis`, un encadré dans la colonne de droite sur ordinateur, et une carte en haut du fil sur téléphone. La carte se ferme : le numéro du défi fermé est gardé dans le navigateur (`localStorage`), et un nouveau défi la fait revenir. Les deux utilisent une route légère, `GET /api/defis/resume`, qui n'envoie ni l'énoncé ni les réponses.

## 11 quinquies. Le partage des publications

Un réseau social grandit quand ses contenus sortent du site. Chaque publication a donc **une adresse publique**, `/publication/12`, qu'on peut envoyer à quelqu'un qui n'a pas de compte.

### Une seule fonction : `partager()`

Dans le menu « … » d'une publication, « Partager » appelle `partager({ titre, texte, url })` de `public/js/app.js`. La même fonction sert aux profils et aux projets.

- **Sur un téléphone**, elle ouvre le menu de partage de l'appareil (`navigator.share`) : WhatsApp, Facebook, Messenger, SMS… Le site ne choisit pas la liste, c'est le téléphone. Si la personne referme le menu, rien ne s'affiche.
- **Sur un ordinateur**, elle ouvre une petite fenêtre avec WhatsApp, Facebook, X et « Copier le lien ». Ce sont de simples liens (`wa.me`, `sharer.php`, `twitter.com/intent/tweet`) ouverts dans un nouvel onglet avec `rel="noopener"` : **aucun script de ces sites n'est chargé dans Palabre**, donc ils ne suivent personne et la page ne s'alourdit pas.

Comment distinguer les deux ? Par `(pointer: coarse)`, « un écran qu'on touche du doigt ». Un ordinateur sous Windows connaît aussi `navigator.share`, mais son menu est pauvre : on lui préfère la fenêtre.

### La page publique, lisible sans compte

`/publication/12` montre l'auteur, le texte, l'image ou la vidéo, le nombre de j'aime et de commentaires, et les 3 derniers commentaires. Deux étapes, comme pour un profil ou un projet :

1. **Le serveur** (`src/routes/pages.js`) écrit dans la page le titre « Prénom Nom sur Palabre », les 160 premiers caractères du texte et l'image : ce sont les balises Open Graph et Twitter que lisent WhatsApp, Facebook et X pour dessiner la carte. Leurs robots n'exécutent pas le JavaScript : sans ces balises écrites d'avance, le lien partagé n'aurait ni titre ni image. Le texte d'un membre passe par `echapper()` : `<script>` devient `&lt;script&gt;`, du texte et non du code.
2. **Le navigateur** (`public/js/page-publication.js`) demande la publication à l'API et l'affiche avec `cartePublication()`, la même carte que dans le fil.

Un **visiteur** voit tout mais ne peut rien faire : à la place de « J'aime » et « Commenter », un bouton « Rejoindre Palabre pour réagir » mène à l'inscription, qui le ramènera sur cette publication (paramètre `suite`). Un **membre connecté** a les vraies actions.

### Ce qui reste protégé

- `GET /api/publications/:id` est **la seule** route des publications ouverte sans compte. Le fil, la liste complète des commentaires, aimer et commenter demandent toujours une session : le serveur le vérifie, cacher les boutons ne suffirait pas.
- Elle n'envoie rien de privé : l'aperçu d'un membre (`apercuMembre()`) ne contient ni email ni numéro WhatsApp.
- Publication supprimée, masquée par un administrateur, ou auteur bloqué : la page 404 du site, sans autre précision.
- **Contre l'aspiration** : 150 lectures par 10 minutes, par membre ou par adresse pour un visiteur (la même règle que pour les profils), en plus des 300 appels par minute des visiteurs. Un robot ne peut pas recopier tout le fil en demandant les numéros un par un.

## 11 sexies. Les listes qui se chargent en défilant

Le fil, les demandes, la recherche de développeurs, les notifications et l'onglet « Publications » d'un profil chargent **10 éléments à la fois**. Avant, il fallait toucher « Voir plus ». Maintenant la suite arrive toute seule quand on approche de la fin, comme sur les réseaux sociaux.

### Une seule fonction pour tout le site

`chargementInfini(liste, chargerSuite, { fin, bouton })` est dans `public/js/app.js`. Chaque page lui donne seulement sa façon de demander la page suivante (`chargerSuite`, qui répond « il en reste » ou « c'est fini »). Tout le reste est écrit une fois :

- **Guetter la fin.** Un repère invisible est posé sous la liste. Un `IntersectionObserver` (un outil du navigateur) prévient quand ce repère arrive à moins de 800 px du bas de l'écran. C'est le navigateur qui surveille : aucun calcul à chaque mouvement du doigt, donc pas de saccade sur un petit téléphone.
- **Un seul chargement à la fois** (`enCours`) : défiler vite ne lance pas deux fois la même page.
- **Pendant le chargement** : deux squelettes en bas de la liste.
- **À la fin** : une phrase discrète (« Tu as tout vu ») et on arrête d'observer. Plus aucun appel ne part.
- **En cas de panne de réseau** : on arrête d'observer et on montre « Réessayer ». Sans cela, chaque défilement relancerait l'appel en boucle et viderait le forfait pour rien.
- **Changement de filtre** : `infini.reprendre()` augmente un compteur (`tour`) ; la réponse d'un ancien filtre, arrivée en retard, est ignorée.
- **Vieux navigateur** sans `IntersectionObserver` : le bouton « Voir plus » réapparaît.

### Côté serveur : rien n'a changé, sauf les notifications

Le serveur envoyait déjà les listes par 10, avec le numéro du dernier élément (`suivant`) ; la page redemande « ceux d'avant ce numéro » (`?avant=`). Cette méthode ne saute et ne répète jamais un élément, même si quelqu'un publie pendant qu'on défile (ce qui arrive avec « page 2, page 3 »). Les notifications, elles, arrivaient par 30 d'un coup : elles suivent maintenant la même règle (`GET /api/notifications?avant=`).

La vitrine de l'accueil garde son bouton « Voir plus de réalisations » : sous elle il y a un bouton et le pied de page, qu'un défilement infini rendrait impossibles à atteindre.

## 11 septies. Les listes de choix et la date de naissance

### Pourquoi refaire les listes du navigateur

Un `<select>` s'affiche différemment sur chaque téléphone, et on ne peut presque pas le styler. `listeChoix(select)` (dans `public/js/app.js`) le remplace par un bouton et une fenêtre de choix « effet verre » : un fond à moitié transparent, et ce qui est derrière est flouté (`backdrop-filter: blur(16px) saturate(140%)`).

- **Sur ordinateur** : un menu flottant accroché au bouton. Il s'ouvre dessous si toute la liste y tient, sinon du côté où il y a le plus de place (donc vers le haut près du bas de l'écran), jamais hors de l'écran ; au-delà de 420 px, la liste défile à l'intérieur. Il est presque opaque : plus transparent, un bouton vert situé derrière se voyait à travers et donnait l'impression que le menu passait dessous.
- **Sur téléphone** : une feuille qui monte du bas de l'écran, avec une poignée, le nom du champ et des choix de 52 px de haut, faciles à toucher. On la ferme en touchant le fond, en glissant la poignée vers le bas, ou avec Échap.
- **Plus de 12 choix** (les pays, les années) : un champ de recherche en haut, qui ignore les accents et les majuscules. Sur téléphone, il ne reçoit pas le focus à l'ouverture : le clavier de l'écran s'ouvrirait et cacherait la liste. Le focus va sur le choix sélectionné.

### Le `<select>` reste dans la page

C'est le choix le plus important. Le `<select>` d'origine n'est pas supprimé : il est caché, et **c'est toujours lui qui porte la valeur**. Conséquences :

- le code des formulaires n'a pas changé : `formulaire.elements.pays.value` marche comme avant ;
- toutes les listes du site sont habillées toutes seules au chargement de la page : pour en ajouter une, on écrit un `<select>` normal dans le HTML ;
- si le script ne se chargeait pas (réseau coupé au mauvais moment), la liste du navigateur resterait utilisable.

Trois détails pour que le bouton dise toujours la vérité : quand une page écrit `select.value = 'x'`, quand le serveur envoie de nouveaux choix (pays, catégories), ou quand la page grise la liste, le bouton se met à jour (un `MutationObserver` et une petite interception de `value`).

### Utilisable au clavier et avec un lecteur d'écran

La fenêtre est un `<dialog>` ouvert avec `showModal()` : le navigateur la place au-dessus de tout (même d'une autre fenêtre, comme celle du signalement), y garde le clavier, la ferme avec Échap et rend le focus au bouton. Par-dessus : flèches, Début, Fin, Entrée, et la recherche par première lettre (« j » va à « Jeux vidéo »). Les rôles ARIA (`listbox`, `option`, `aria-selected`, `aria-expanded`) disent à un lecteur d'écran ce qu'est chaque élément.

### La date de naissance en trois listes

Le calendrier du navigateur oblige à reculer mois par mois jusqu'à son année de naissance. À la place : Jour, Mois (en lettres) et Année (de « il y a 18 ans » jusqu'à 1940), avec le même composant. `public/js/date-naissance.js` assemble les trois valeurs en `AAAA-MM-JJ`, exactement ce que le serveur attendait déjà, et refuse une date qui n'existe pas avec un message clair (« il n'y a pas de 31 février »). La règle des 18 ans reste vérifiée **par le serveur**, comme avant : un contrôle dans le navigateur peut toujours être contourné.

## 11 octies. La page du code : « les feuilles de l'arbre à palabres »

`/confirmer-email` est la première page que voit un nouveau membre après son inscription. On en a fait un moment propre à Palabre : la carte est une grande feuille, le code s'écrit sur six petites feuilles, et quand il est bon, elles forment la couronne d'un arbre à palabres. Dix captures de l'animation sont dans `docs/captures/`.

**Ce qui n'a pas changé : toutes les règles du serveur.** Le code est haché, valable 15 minutes, 5 essais, un renvoi par minute et cinq par heure. La page n'est qu'une façon plus agréable de le saisir : elle envoie toujours `POST /api/auth/confirmer-email` avec `{ code }`.

### Trois fichiers

- `public/confirmer-email.html` : la structure, sans aucun style ni script en ligne ;
- `public/css/confirmer-email.css` : une feuille de style **chargée par cette page seulement**, pour ne pas alourdir les autres pages en 3G ;
- `public/js/confirmer-email.js` : la saisie et le mouvement.

### La forme de feuille

La grande feuille n'est pas une image : c'est un rectangle dont deux coins opposés sont en pointe et les deux autres très arrondis (`border-radius: 12px 200px 12px 200px`), avec des nervures et une queue dessinées en SVG. Sur téléphone les arrondis sont plus petits (64 px), pour que tout tienne. Un test dans le navigateur vérifie par le calcul que le texte, les feuilles et les boutons restent **à l'intérieur** de la forme, à 360, 390 et 1280 px.

### Six champs qui se comportent comme un seul

Chaque petite feuille contient un vrai champ de saisie. Seule la **forme** de la feuille est inclinée ; le chiffre, lui, reste droit et en 24 px. Le script fait le lien entre les six :

- un chiffre tapé fait passer à la feuille suivante, Retour arrière revient à la précédente, les flèches déplacent ;
- tout ce qui n'est pas un chiffre est retiré ;
- un code collé (même avec des espaces) est réparti sur les six feuilles ; `autocomplete="one-time-code"` permet au téléphone de proposer le code reçu ;
- au sixième chiffre, le code part tout seul. Le bouton « Confirmer » reste, pour le clavier et les lecteurs d'écran ;
- chaque champ a son libellé (« Chiffre 3 sur 6 ») et les messages sont annoncés (`role="alert"`, `aria-live`).

### Un mouvement qui ne coûte rien au téléphone

Tout ce qui bouge n'utilise que deux propriétés : `transform` (déplacer, tourner, agrandir) et `opacity` (transparence). Le navigateur les anime sans recalculer la mise en page, ce qui reste fluide sur un petit téléphone : avec le processeur ralenti quatre fois dans Chrome, le tourbillon garde 60 images par seconde. Aucune bibliothèque : c'est `element.animate()`, l'outil d'animation du navigateur.

Comment changer de couleur avec seulement de la transparence ? Par des **calques superposés**. Chaque petite feuille a un calque vert vif (feuille active) et un calque terre cuite (« feuille sèche », quand le code est faux) ; on ne fait que les rendre plus ou moins opaques.

Le déroulement :

1. **Vérification.** Les feuilles décollent et tournent sur une ellipse, décalées les unes des autres ; la grande feuille se balance à peine. Cela dure au moins 800 ms même si le serveur répond tout de suite (sinon on ne verrait rien), et continue tant qu'il n'a pas répondu.
2. **Code bon.** Chaque feuille part de l'endroit exact où elle se trouve (`figer()` lit sa position en plein vol) et se pose en arc de cercle ; le tronc pousse ; le badge « vérifié » apparaît. Titre « Email confirmé », puis redirection au bout d'une seconde et demie.
3. **Code faux.** Les feuilles retombent à leur place, frissonnent, sèchent un instant, puis redeviennent vertes et vides. Le message du serveur s'affiche dessous (« Code incorrect. Il te reste 4 essais. ») et le curseur revient sur la première feuille.

Pour une personne qui a demandé à son téléphone de **réduire les animations**, il n'y a ni tourbillon ni arbre : un fondu, puis la coche.

### Le compte à rebours du renvoi

« Renvoyer dans 0:59 » suit la limite du serveur (un code par minute). L'heure du dernier envoi est gardée dans `sessionStorage` : recharger la page ne remet pas le compteur à zéro. Ce n'est qu'un confort : c'est le serveur qui refuse réellement un second envoi trop rapproché.

### Les emails

`src/utils/gabarit-email.js` fabrique le code de confirmation et le « mot de passe oublié » avec le même gabarit, en deux versions : texte et HTML. Un email n'est pas une page web : Gmail et Outlook retirent les feuilles de style. On écrit donc avec des **tableaux** et des **styles sur chaque balise**, 600 px de large au plus. C'est le seul endroit du projet où les styles en ligne sont permis. Le prénom du membre est échappé (`echapperHtml()`), le logo est appelé par son adresse complète, et l'email du code ne contient **aucun lien** : quelqu'un qui le lirait par-dessus l'épaule n'a rien à cliquer.

## 11 nonies. Les notifications : la cloche, le regroupement et le push

### Une seule porte d'entrée : `notifier()`

Tout ce qui prévient un membre passe par `notifier()` (`src/utils/notifications.js`) : une demande d'ami, une proposition, un j'aime, un commentaire, un message, un avis. Trois règles y sont écrites une fois pour toutes :

- **jamais pour soi** : si la personne qui agit est le membre à prévenir, rien n'est écrit ;
- **la personne est jointe** (`acteur`) : la page affiche son avatar à côté du texte ;
- **le regroupement**.

### Le regroupement : « Awa et 3 autres ont aimé ta publication »

Sans regroupement, dix j'aime feraient dix lignes. Tant qu'une notification du même type sur la même publication **n'est pas lue**, la suivante la remplace : l'ancienne est retirée, une nouvelle est écrite avec la liste des personnes (`acteurs`, la dernière en premier) et leur `nombre`. Elle remonte ainsi en tête de liste.

Deux façons de compter : les **personnes** pour les j'aime et les commentaires, les **messages** pour une conversation (« Awa t'a envoyé 3 messages » : une notification par conversation, jamais une par message).

Deux pièges évités :

- **deux j'aime au même instant** pourraient créer deux notifications. Un verrou (`pg_advisory_xact_lock`) fait passer les écritures l'une après l'autre ; un test en envoie quatre en même temps et vérifie qu'il reste une seule ligne de quatre personnes ;
- **aimer, ne plus aimer, aimer…** pourrait servir à harceler. Celui qui retire son j'aime sort de la notification tant qu'elle n'est pas lue (`retirerActeur()`).

Ouvrir une conversation marque sa notification comme lue. Le texte d'un message n'est jamais copié dans la cloche.

### La page `/notifications`

Trois groupes (« Aujourd'hui », « Cette semaine », « Plus ancien »), et sur chaque ligne l'avatar de la personne avec une petite pastille qui dit de quoi il s'agit (cœur, bulle, valise, équipe, trophée, ami). Une notification non lue a un fond vert très léger et un point vert. La toucher la marque lue et ouvre le bon endroit. Le nom en gras est posé avec `textContent`, comme tout texte venu d'un membre.

### Le push : prévenir un téléphone, même site fermé

Le navigateur du membre s'abonne auprès du **service de push de son fabricant** (Google pour Chrome, Mozilla pour Firefox, Apple pour Safari) et donne au serveur une adresse et deux clés. Pour le prévenir, Palabre envoie à cette adresse un message **chiffré avec ses clés** : le service de push le transporte sans pouvoir le lire, le téléphone le déchiffre et l'affiche (`public/sw.js`, événements `push` et `notificationclick`).

Ce qu'il faut savoir pour le défendre :

- **Aucune bibliothèque.** `web-push`, la plus connue, est sous licence MPL-2.0, absente de la liste permise par le concours. Le chiffrement (RFC 8291) et la signature du serveur (VAPID, RFC 8292) sont écrits dans `src/utils/push.js` avec le module `crypto` de Node.js. Un test joue le rôle du téléphone : il déchiffre le message avec les clés de l'appareil et retrouve le texte.
- **Les clés VAPID** identifient Palabre auprès des services de push. Elles sont dans les variables d'environnement (`npm run cles-push` les fabrique). **Sans elles, le site marche normalement**, sans push.
- **La permission n'est jamais demandée au chargement d'une page.** Seulement quand la personne touche « Activer » (encadré du fil, proposé une fois, ou réglages du profil). Un navigateur à qui l'on pose la question trop tôt la refuse, et ce refus est définitif. Sur iPhone, le push n'existe que pour un site ajouté à l'écran d'accueil : la page l'explique.
- **Le serveur n'écrit qu'aux vrais services de push** (une liste de domaines). Sinon un membre pourrait s'« abonner » avec l'adresse d'une machine interne et faire envoyer des requêtes par notre serveur (attaque dite SSRF).
- **Rien de privé dans le push** : le nom de la personne et, pour un message, un aperçu de 60 caractères au plus.
- **Le push ne bloque rien** : il part après la réponse du site, et une panne du service de push n'apparaît que dans le journal du serveur. Un abonnement qui n'existe plus (réponse 404 ou 410) est supprimé.
- **Le « tag »** : sur le téléphone, la notification suivante du même sujet remplace la précédente au lieu de s'empiler.
- Se déconnecter coupe le push sur l'appareil ; un appareil sur lequel quelqu'un d'autre s'abonne devient le sien.

### Les réglages

Dans « Modifier mon profil », section « Notifications » : activer ou couper le push **sur cet appareil**, et choisir les familles reçues (messages, demandes et propositions, équipes, j'aime et commentaires, défis). Le choix est gardé en JSON dans `utilisateurs.preferences_notifications`. Une famille absente vaut « oui » : un nouveau type de notification est reçu sans rien migrer. **La cloche du site garde toujours tout** : les réglages ne concernent que le push.

## 11 decies. Les conversations de groupe des équipes éclair

Une équipe éclair qui répond ensemble à une demande a besoin d'un endroit pour se parler. Chaque équipe a donc son **groupe de discussion**, dans `/messages`.

### Le groupe suit la vie de l'équipe

| Dans l'équipe | Dans le groupe |
| --- | --- |
| Le chef crée l'équipe | Le groupe est créé, le chef en est l'administrateur |
| Un invité accepte | Il entre dans le groupe (« Awa a rejoint l'équipe ») |
| Un invité refuse | Il n'y entre pas |
| Le client choisit l'équipe | Il entre dans le groupe, un message l'annonce |
| Le chef dissout l'équipe | Le groupe est fermé : on peut le relire, plus personne n'y écrit |

Ces changements sont faits **dans la même transaction** que ceux de l'équipe (`src/utils/groupes.js`) : il ne peut pas exister une équipe sans groupe, ni un membre du groupe qui ne serait pas dans l'équipe.

### Sans casser les conversations privées

La table `conversations` sert aux deux. Une conversation privée garde ses deux colonnes `membre_a` et `membre_b` ; un groupe ne les remplit pas, ses membres sont dans `conversation_membres`. Toutes les requêtes des conversations privées filtrent sur `membre_a` / `membre_b` : **elles ne voient jamais un groupe**, et aucune de leurs règles n'a bougé (amis, client et dev, demandes de message, blocages). Les tests de la messagerie privée sont restés tels quels et passent tous.

Les groupes ont leur propre fichier (`src/routes/groupes.js`) et **une seule règle d'accès** : il faut être membre actuel (une ligne dans `conversation_membres`, sans date de départ). Pour tout autre, le groupe « n'existe pas » : 404 pour lire, écrire, renommer, et même pour une photo qui y a été envoyée (`src/routes/fichiers.js`). Celui qui quitte le groupe ne voit plus rien, y compris les nouveaux messages.

### Quelques choix

- **Messages « système »** (`messages.systeme`) : « Awa a rejoint l'équipe », au centre, sans bulle. Ils ne comptent pas comme messages non lus.
- **Quitter** : avant le choix du client, quitter le groupe c'est quitter l'équipe ; après, seulement le groupe (on reste engagé envers le client). Le chef ne quitte pas : il dissout l'équipe.
- **Notifications** : une seule par groupe et par membre, mise à jour tant qu'elle n'est pas lue (« 3 nouveaux messages dans « Équipe : … » »), push compris. Un membre peut mettre un groupe **en sourdine**.
- **Reprise de l'existant** : la migration crée le groupe des équipes qui existaient déjà, et remplit `conversation_membres` pour les conversations privées. Elle peut être rejouée sans rien doubler.

## 11 undecies. Réagir, répondre, supprimer un message

Ces trois actions marchent de la même façon dans une conversation privée et dans un groupe. Le code est donc écrit une fois : `src/utils/messages.js` (lire les messages avec leurs réactions et leur citation) et `src/routes/messages-actions.js` (réagir, supprimer).

**L'accès n'est pas réinventé.** Pour agir sur un message, le serveur retrouve sa conversation puis applique la règle de cette conversation (`maConversation()` ou `monGroupe()`). Qui ne peut pas la lire reçoit 404.

### Réactions

Six émojis, et pas un de plus : le serveur refuse toute autre valeur. La table `message_reactions` a pour clé primaire le couple (message, membre) : **une réaction par personne et par message**, garantie par la base. En choisir une autre remplace la précédente. Sous la bulle, un compteur par émoji ; le toucher montre qui a réagi.

### Réponses

Un message peut en citer un autre (`messages.reponse_a`). Le serveur vérifie que le message cité est **dans la même conversation** : sinon on pourrait, en devinant un numéro, faire afficher le début d'un message d'une conversation où l'on n'est pas. Une citation invalide est simplement ignorée.

### Suppression

- **Pour tout le monde** : l'auteur seulement, pendant 15 minutes. Le texte et la photo sont **effacés de la base** (la ligne du fichier est supprimée), pas seulement cachés ; il reste une bulle « Message supprimé ».
- **Pour moi** : à tout moment ; le message disparaît de mon écran, les autres le gardent (table `messages_masques`).

### Voir les changements sans recharger

La page demandait déjà toutes les 5 secondes « quoi de neuf après le message n° X ? ». Mais une réaction ou une suppression touche un **ancien** message. Chaque message a donc une date `modifie_le` ; la page envoie l'heure du serveur de sa dernière lecture (`depuis`) et reçoit en plus les messages déjà affichés qui ont changé. **Aucune requête de plus** : la même, un peu plus bavarde. L'heure est celle de la base, lue avant les messages, pour ne rien perdre entre deux tours.

### Sur l'écran

Sur ordinateur, un bouton « … » apparaît à côté de la bulle au survol. Sur téléphone, un **appui long** ouvre le même menu (Répondre, Réagir, Copier, Supprimer, Signaler), et **glisser la bulle vers la droite** répond. Le menu est celui de tout le site (`menuOptions()`).

## 11 duodecies. « Écrit… », « Vu par » et « En ligne »

Ces trois signes de vie existent sans connexion permanente (pas de WebSocket). Tout passe par des requêtes que les pages faisaient déjà : `src/utils/presence.js`.

### « Awa écrit… »

Pendant qu'on tape, la page envoie un petit signal au serveur, **au plus une fois toutes les 3 secondes**. Le serveur le garde 6 secondes (table `ecritures`), puis l'oublie tout seul. L'autre personne l'apprend par la requête qu'elle fait déjà toutes les 5 secondes pour demander les nouveaux messages : **aucune boucle d'appels en plus**. Envoyer le message efface le signal tout de suite.

La table est `UNLOGGED` : ses lignes ne valent que quelques secondes, il est inutile de les protéger contre une panne, et l'écriture coûte moins cher.

Dans une demande de message pas encore acceptée, rien n'est signalé : l'expéditeur ne doit pas savoir qu'on le lit, ni qu'on hésite à répondre.

### « En ligne »

Chaque requête d'un membre connecté passe par `chargerUtilisateur()`. On y note son heure d'activité (`utilisateurs.vu_le`), mais **au plus une fois par minute**, et sans faire attendre la requête : sinon chaque clic écrirait dans la base. Actif il y a moins de 5 minutes : point vert. Sinon : « Actif il y a 2 h ».

Deux protections :

- **La présence ne sort que par la messagerie**, et seulement dans une conversation acceptée ou un groupe dont on est membre. Ni le profil public, ni la recherche, ni le fil ne la montrent : un inconnu ne peut pas savoir quand quelqu'un est connecté.
- **Chacun peut la cacher** (« Modifier mon profil », « Montrer quand je suis en ligne »). La règle est réciproque : qui cache son statut ne voit plus celui des autres.

### « Vu par » dans un groupe

En privé, « Vu » apparaît sous mon dernier message, comme avant. Dans un groupe, le serveur envoie jusqu'où chaque membre a lu, et la page pose le petit avatar de chacun sous le dernier message qu'il a lu.

## 11 terdecies. Les messages vocaux

Dans beaucoup de nos villes, on parle plus volontiers qu'on n'écrit. Un bouton micro dans la zone d'écriture enregistre jusqu'à **une minute**.

### Enregistrer sans vider le forfait

Le navigateur enregistre lui-même (`MediaRecorder`), en Opus à **24 kb/s**, une seule voie : une minute pèse environ 180 Ko, ce qui passe en 3G. Selon le téléphone, le fichier est du WebM (Android, ordinateur) ou du MP4 (iPhone) : le code demande le premier format que le navigateur sait faire.

Deux gestes : toucher le micro puis « Envoyer » ou « Annuler » ; ou le **maintenir appuyé**, relâcher pour envoyer, glisser vers la gauche pour annuler. **Le micro n'est demandé au navigateur qu'au premier appui**, jamais à l'ouverture de la page ; s'il est refusé, un message dit où l'autoriser.

### Le serveur ne fait confiance à rien

Comme pour les images (`src/utils/audio.js`) : type annoncé parmi trois, **premiers octets vérifiés** (un fichier annoncé « audio » qui n'en est pas un est refusé), 400 Ko au plus, durée d'une à soixante secondes. Le son est rangé dans la table `fichiers`, comme les photos, et `messages.vocal_duree` dit qu'il s'agit d'un vocal.

### Écouter : seulement les membres, seulement au toucher

- Le son est servi par `/fichiers/:id` avec la **même règle que les photos de messages** : les membres de la conversation, personne d'autre (404).
- Il n'est **téléchargé qu'au premier toucher** sur « lecture » : une conversation pleine de vocaux ne coûte rien tant qu'on n'écoute pas.
- L'iPhone demande un son par morceaux (`Range: bytes=0-1`…) et refuse de le lire sinon : le serveur sait répondre « 206, voici ce morceau ».
- Le lecteur est écrit à la main : lecture / pause, barre d'avancement (une transformation `scaleX`), durée restante, vitesse x1, x1,5 ou x2.

### Deux défauts trouvés en vérifiant dans le navigateur

- « Glisser pour annuler » puis relâcher le doigt demandait l'annulation **puis** l'envoi : le message partait quand même. Un enregistrement ne peut plus se terminer qu'une fois.
- Un message qu'on venait d'écrire était redessiné cinq secondes plus tard pour rien, ce qui remettait à zéro le lecteur en train de jouer. Le serveur ne signale plus que les messages réellement retouchés, et une bulle dont le son joue n'est jamais redessinée.

## 11 quaterdecies. Les appels audio et vidéo

On appelle depuis une conversation, sans sortir de Palabre et sans WhatsApp : audio ou vidéo à deux, audio jusqu'à quatre dans le groupe d'une équipe éclair. La technique s'appelle WebRTC ; elle est dans tous les navigateurs, aucune bibliothèque n'est ajoutée.

### Le serveur ne transporte pas l'appel

Le son et l'image vont **directement d'un téléphone à l'autre**. Le serveur de Palabre (`src/routes/appels.js`) fait seulement la mise en relation :

- dire qui appelle qui, qui a décroché, qui a raccroché (tables `appels` et `appel_participants`) ;
- porter les petits messages techniques que les navigateurs s'échangent pour se trouver : une « offre », une « réponse », des « candidats » (table `appel_signaux`). Il les transporte sans les lire ;
- donner la liste des serveurs qui aident à trouver un chemin (STUN, et notre relais TURN s'il existe : `docs/APPELS-TURN.md`).

### Sans WebSocket

Pendant un appel, **et seulement pendant un appel**, la page interroge le serveur chaque seconde : c'est ainsi qu'elle reçoit les messages techniques et qu'elle dit « je suis toujours là ». Dès qu'on raccroche, ces requêtes s'arrêtent. Un WebSocket serait plus élégant, mais on ne sait pas encore si l'hébergeur les accepte ; la version actuelle marche partout.

Un appel qui arrive est annoncé par la **veille** (une petite requête que toutes les pages font toutes les 5 secondes quand l'onglet est visible, voir la section 11 quindecies ; une sonnerie dure 30 secondes), par la requête de la conversation ouverte (toutes les 5 secondes aussi), et par une notification push si le site est fermé.

### Qui peut appeler qui

Exactement ceux qui peuvent s'écrire. En privé, c'est la fonction `droitDEcrire()` de la messagerie qui décide : jamais un inconnu, jamais un membre bloqué. Dans un groupe, il faut en être membre. Le code ne réécrit pas ces règles, il les réutilise.

### Les cas qui fâchent

- **Personne ne décroche** : au bout de 30 secondes, « Appel manqué », avec une notification.
- **Déjà en appel** : un seul appel à la fois par membre. L'appelant voit « déjà en appel », l'autre aura un appel manqué.
- **Deux personnes s'appellent au même instant** : un verrou par conversation ; un seul appel est créé, le second le rejoint.
- **Quelqu'un ferme la page ou perd le réseau** : sans nouvelles de lui pendant 20 secondes, il est considéré parti ; s'il reste moins de deux personnes, l'appel se termine.
- **Changement de réseau** (Wi-Fi vers 4G) : « Reconnexion… », la liaison est renégociée pendant 15 secondes, puis on raccroche.

Il n'y a pas de tâche programmée : ces vérifications sont faites à chaque lecture (`entretenir()`), avec `FOR UPDATE SKIP LOCKED` pour que deux lectures simultanées ne traitent pas le même appel deux fois.

### Pensé pour la 3G

Voix en Opus à 24 kb/s environ ; vidéo en 640 × 360, limitée à 350 kb/s ; en 3G ou en économie de données, la caméra démarre éteinte. Le micro et la caméra ne sont demandés qu'au moment d'appeler ou de décrocher. Le script et la feuille de style des appels (`public/js/appels.js`, `public/css/appels.css`) ne sont téléchargés que lorsqu'un appel commence.

### L'identifiant TURN temporaire

Un relais TURN demande un nom et un mot de passe. Donner le même à tout le monde reviendrait à le publier. Palabre calcule donc, pour chaque membre, un identifiant valable **une heure** : le nom contient la date limite, le mot de passe est sa signature (HMAC) avec un secret que seuls Palabre et le relais connaissent. Le secret ne quitte jamais le serveur.

### L'écran d'appel

Il reprend la page du code de confirmation : vert profond, grandes courbes, crème, touches de terre cuite. Autour de l'avatar, trois anneaux de petites feuilles tournent lentement ; ils « respirent » pendant la sonnerie, puis grossissent avec la voix de l'autre (`AnalyserNode`). Décrocher est une feuille verte, Refuser une feuille terre cuite. La sonnerie est fabriquée par le navigateur (deux notes, Web Audio) : aucun fichier son. Tout ce qui bouge n'utilise que `transform` et `opacity`, et s'arrête si l'appareil demande moins d'animations.

## 11 quindecies. Les finitions de la messagerie : veille, carte d'arrivée, son, titres des push

Fichiers : `src/routes/messages.js` (route `/veille`), `public/js/app.js` (`veiller()`, `recevoirVeille()`, `toastMessage()`, `sonMessage()`), `src/utils/notifications.js` (`TITRES_PUSH`), `tests/veille.test.js`, `tests/push.test.js`.

### La veille : une seule petite requête pour deux besoins

Palabre n'a pas de WebSocket. Pour savoir vite qu'on m'appelle ou qu'on m'écrit, chaque page pose la même question au serveur toutes les 5 secondes : `GET /api/messages/veille?apres=412`. La réponse est minuscule : l'appel qui sonne pour moi (ou rien), les messages arrivés après le numéro 412 (5 au plus), et le nouveau numéro à retenir.

- **Seulement quand l'onglet est visible.** Onglet caché ou téléphone verrouillé : plus aucune requête, le forfait n'est pas touché. C'est le push qui prend le relais.
- **La pastille des messages ne change pas de rythme** (une fois par minute). On avait d'abord accéléré la pastille à 20 secondes pour voir les appels : c'était plus lourd pour le serveur et plus lent pour l'appel.
- **Le numéro « apres » est gardé dans `sessionStorage`**, le temps de l'onglet. Changer de page ne fait donc ni oublier ni répéter un message. À la première visite, il n'y a pas de numéro : le serveur ne renvoie aucun message, seulement le point de départ. On n'annonce jamais les vieux messages.
- **Les mêmes règles que pour lire.** La requête SQL de la veille reprend les conditions de la messagerie : conversation privée acceptée, non masquée, sans blocage ; ou groupe dont je suis encore membre. Un groupe **en sourdine** n'annonce rien, une demande de message d'un inconnu non plus, un message supprimé non plus. Et l'aperçu fait 60 caractères au plus : le message entier ne sort jamais par cette route.

### La carte d'arrivée

Quand la veille rapporte un message et que je ne suis pas dans sa conversation, `toastMessage()` pose une carte en haut de l'écran : avatar, nom, aperçu. Elle est en verre (`backdrop-filter`), avec les coins en feuille (8 px et 28 px) comme le reste de Palabre, glisse depuis le haut, s'en va seule après 5 secondes, et la toucher ouvre la conversation. Trois cartes au plus à la fois.

Comment la page sait-elle que la conversation est ouverte ? `public/js/messages.js` écrit son numéro dans `window.Palabre.conversationOuverte` en l'ouvrant, et l'efface en la fermant. `recevoirVeille()` écarte les messages de cette conversation : ils s'affichent déjà dans le fil, une carte en plus serait du bruit.

Le nom, le titre du groupe et l'aperçu viennent des membres : ils sont écrits avec `textContent` (par `el()`), jamais avec `innerHTML`.

### Le son

Deux notes douces (un sol, puis un do) accompagnent la carte. Elles sont **fabriquées par le navigateur** avec Web Audio : un oscillateur par note, un volume qui monte en 20 millisecondes puis s'éteint. Aucun fichier son, donc rien à télécharger et rien de copié d'ailleurs.

Le son suit la carte : pas de carte (conversation ouverte, sourdine, onglet caché), pas de son. Si le navigateur refuse de jouer parce que la personne n'a encore rien touché sur la page, on se tait sans erreur.

Le réglage « Son des messages » est dans `/modifier-profil`. Il est **gardé sur le serveur** (`PUT /api/profils/moi/son-messages`, dans la colonne JSON `preferences_notifications`, à côté des réglages du push) : le membre le retrouve sur tous ses appareils. `jsonb_set` ne change que cette clé, les réglages du push ne bougent pas (un test le vérifie).

### Les titres des push

Sur un écran verrouillé, on ne lit souvent que le titre. Il ne dit donc plus « Palabre » mais ce qui se passe : « Nouveau message de Kofi », « Bintou et 2 autres ont aimé ta publication », « Nouvelle proposition pour ta demande », « Fatoumata t'invite dans son équipe ».

Tout est dans une seule table, `TITRES_PUSH`, une ligne par type de notification. `notifier()` y prend le titre ; quand le titre dit déjà tout (un j'aime), le texte du dessous ne le répète pas (« Touche pour voir ta publication. »). Le test `tests/push.test.js` lit les fichiers de `src/routes/`, relève tous les types passés à `notifier()` et vérifie que chacun a sa ligne : **ajouter un type sans titre fait échouer les tests**.

### Le menu d'une bulle reste dans la conversation

Sur ordinateur, le menu « … » d'une bulle s'ouvrait parfois hors de la conversation (sous l'en-tête, ou derrière la liste de gauche). À l'ouverture, `public/js/messages.js` mesure maintenant le menu et la zone de la conversation, choisit le côté (classes `menu-vers-la-droite`, `menu-vers-la-gauche`, `menu-vers-le-haut`), puis le décale de ce qui manque avec `transform`.

### Un défaut trouvé en vérifiant

En prenant la capture du réglage, la page `/modifier-profil` dépassait à droite sur téléphone (429 px au lieu de 390). La cause : dans une grille CSS, une colonne `1fr` ne descend jamais sous la largeur de son contenu, et deux listes au texte long (« Développement web », « Plus de 5 ans ») ne tenaient pas côte à côte. Les colonnes des formulaires sont maintenant en `minmax(0, 1fr)` (le 0 autorise la colonne à rétrécir), et ces deux listes se placent l'une sous l'autre sur téléphone (classe `champs-larges`).

## 11 sexdecies. Paramètres et confidentialité

Fichiers : `src/routes/parametres.js`, `src/utils/confidentialite.js`, `public/parametres.html`, `public/js/parametres.js`, `tests/parametres.test.js`.

### La page

`/parametres` range tout ce qui se règle en huit rubriques : Compte, Langue, Confidentialité, Notifications, Sécurité, Membres bloqués, Apparence, Mes données. Sur téléphone on voit la liste, puis la rubrique choisie avec un retour. Sur ordinateur, les rubriques sont à gauche et la rubrique ouverte à droite. La rubrique ouverte est écrite dans l'adresse (`/parametres#confidentialite`) : le bouton « retour » du téléphone marche, et on peut envoyer le lien d'une rubrique.

Il n'y a pas de bouton « Enregistrer » : chaque réglage part au serveur dès qu'on le change, et un petit message « Enregistré » le confirme. Si le serveur refuse, le réglage revient à sa valeur d'avant.

### Les réglages de confidentialité : le serveur décide, pas la page

Les réglages sont gardés dans une seule colonne, `utilisateurs.confidentialite`, au format JSON. Une clé absente vaut sa valeur par défaut, et la valeur par défaut est **le comportement d'avant** : un membre qui ne touche à rien ne voit aucune différence.

La règle la plus importante : **chaque réglage est appliqué par le serveur, dans la route qui donne l'information**. Cacher un bouton dans la page ne protège rien, car n'importe qui peut appeler une route à la main.

| Réglage | Où le serveur l'applique |
| --- | --- |
| Qui voit mes publications | dans la requête commune des publications (`publicationsVisibles()`) : le fil, le profil, la page publique et la lecture d'une publication la suivent tous ; un j'aime ou un commentaire sur une publication qu'on ne peut pas voir répond « 404 » ; les balises de partage ne citent rien d'une publication réservée |
| Qui voit ma liste d'amis | `GET /api/profils/:identifiant/amis` |
| Qui voit mon numéro WhatsApp | `profilVisible()` : le numéro n'est tout simplement pas mis dans la réponse |
| Qui peut m'écrire | `droitDEcrire()`, la règle unique de la messagerie |
| Qui peut m'appeler | `POST /api/messages/appels` |
| Qui peut m'inviter dans une équipe | `POST /api/demandes/:id/equipes` |
| Apparaître dans la recherche | les trois requêtes de `src/routes/devs.js` (`dansLaRecherche()`) ; un client à qui le dev a envoyé une proposition le retrouve quand même |

Le profil public d'un dev (nom, spécialité, projets vérifiés, avis) reste toujours visible : c'est sa vitrine.

### Changer d'email, sans perdre son compte

Le code à six chiffres part à la **nouvelle** adresse. Tant qu'il n'est pas saisi, l'ancienne reste la bonne : une faute de frappe dans la nouvelle adresse ne coûte rien. Le mot de passe est redemandé avant, pour qu'un téléphone resté ouvert sur une table ne suffise pas à prendre le compte. Le code est haché, valable 15 minutes, cinq essais.

### Déconnecter les autres appareils

Chaque session porte sa date d'ouverture. La colonne `sessions_depuis` dit : « toute session ouverte avant cette date est refusée ». Pour fermer les autres appareils, on met cette date à maintenant, puis on rouvre une session neuve pour l'appareil qui a fait la demande. Changer de mot de passe fait la même chose.

La « dernière connexion » montre la date et le type d'appareil (« Chrome sur Android »), lu dans l'en-tête que le navigateur envoie. L'adresse IP n'est ni gardée ni affichée.

### Supprimer son compte

Depuis le 11 octobre, la suppression est différée de 30 jours et faite par la tâche de ménage (voir « 11 octodecies »). Ce qui suit décrit ce que fait la suppression définitive, une fois ce délai passé.

Toutes les tables sont reliées au compte par `ON DELETE CASCADE` : supprimer la ligne du membre supprime ses publications, ses commentaires, ses projets, ses demandes, ses propositions, ses amitiés, ses photos.

Première exception : **les avis qu'un client a laissés à des devs**. Ils font partie de la preuve du travail du dev (c'est le « profil prouvé »). Juste avant la suppression, dans la même transaction, on vide `client_id` et `demande_id` de ces avis : ils ne sont plus reliés à rien du client, donc la cascade ne les emporte pas. La note et le texte restent, la moyenne du dev ne bouge pas. La route du profil renvoie alors `client: null`, et la page écrit « Ancien client » : pas de nom, pas d'avatar, pas de lien, pas de titre de demande.

Deuxième exception, qui demande plus de soin : les messages déjà envoyés à d'autres. Ils font partie de **leurs** conversations. Avant de supprimer le compte, ces messages sont donc rattachés à un compte vide, appelé « Membre parti » : pas de nom, pas d'email utilisable, pas de photo, un mot de passe impossible. Personne ne peut s'y connecter, lui écrire, ni le trouver. Les photos et les vocaux, eux, sont effacés pour de bon (il reste « Message supprimé »).

### Télécharger ses données

Un fichier JSON avec son profil, ses publications, ses commentaires, ses messages envoyés, ses demandes et ses propositions. Des autres membres, il ne contient que le nom : jamais leur email, leur numéro, ni leurs messages. Trois téléchargements par jour, comptés dans la table `exports_donnees`. La date de naissance n'y est pas : elle ne sort de la base par aucune route.

## 11 septdecies. Le site en deux langues

Fichiers : `public/langues/fr.js`, `public/langues/en.js`, `public/js/app.js` (`t()`, `traduirePage()`, `changerLangue()`), `src/utils/langue.js`, `src/utils/textes.js`, `tests/langues.test.js`, `tests/textes-serveur.test.js`.

### Une clé, deux textes

Chaque texte du site a une **clé** (`fil.publier`, `demande.statut.ouverte`) et deux valeurs : une dans `fr.js`, une dans `en.js`. Les deux fichiers ont exactement les mêmes clés, dans le même ordre : on peut les lire côte à côte.

- Dans un script : `t('fil.publier')`.
- Dans une page HTML : `<button data-t="fil.publier">Publier</button>`. La page reste écrite en français ; en anglais, `traduirePage()` remplace le texte de chaque balise marquée. Pour un attribut : `data-t-placeholder`, `data-t-aria-label`, `data-t-title`, `data-t-alt`.

Sans framework ni bibliothèque : `t()` fait une vingtaine de lignes.

### Les trois pièges d'une traduction

1. **Les pluriels.** « 1 réponse », « 3 réponses » : la clé porte les deux formes, `{ un: '{n} réponse', autres: '{n} réponses' }`, et `t('cle', { n: 3 })` choisit. C'est le navigateur qui connaît la règle de chaque langue (`Intl.PluralRules`) : en français « 0 réponse » est au singulier, en anglais « 0 replies » est au pluriel.
2. **L'ordre des mots.** « Profil de Kofi » devient « Kofi's profile » : on ne colle jamais deux morceaux de phrase. La phrase entière est dans le dictionnaire, avec un trou : `'Profil {deNom}'` et `"{nom}'s profile"`.
3. **Les dates et les nombres.** « il y a 5 min » et « 5 min. ago », « 250 000 FCFA » et « 250,000 FCFA » : écrits par le navigateur (`Intl.RelativeTimeFormat`, `Intl.NumberFormat`), pas par nous.

### Ce qui ne change jamais : les valeurs

La base garde des identifiants (`site-web`, `plus-5`) ou le nom français d'un pays (`Côte d'Ivoire`). Seul l'**affichage** est traduit. Passer le site en anglais ne modifie donc aucune donnée, et un membre francophone et un membre anglophone voient le même profil, chacun dans sa langue.

Ce que les membres écrivent (publications, messages, demandes) n'est jamais traduit.

### Quelle langue pour qui ?

Dans l'ordre : le cookie `langue` (le choix fait sur cet appareil), la langue du compte (`utilisateurs.langue`, qui suit le membre sur tous ses appareils), puis la langue du navigateur.

**À la première visite**, il n'y a ni cookie ni compte. La langue du navigateur ne suffit pas : beaucoup de téléphones vendus en Afrique francophone sont réglés en anglais. Le script (`languePremiereVisite()` dans `public/js/app.js`) regarde donc aussi le **fuseau horaire** de l'appareil (`Intl.DateTimeFormat().resolvedOptions().timeZone`, par exemple `Africa/Ouagadougou`). Anglais seulement si le navigateur est en anglais ET que le fuseau est celui d'un pays africain anglophone (une liste de 19 fuseaux : Lagos, Accra, Nairobi…) ou d'un pays hors d'Afrique. Sinon, français. Le fuseau ne quitte jamais l'appareil : il sert au choix, puis seul le cookie `langue` est gardé.

Le serveur, lui, ne connaît pas le fuseau : sans cookie, il choisit d'après l'en-tête `Accept-Language`. Il peut donc envoyer la première page en anglais à un téléphone du Burkina réglé en anglais. Le script le voit (`<html lang="en">` alors qu'il vient de choisir le français) et réécrit la page en français avant qu'elle s'affiche. Dès la page suivante, le cookie est là et le serveur envoie directement la bonne langue. `tests/premiere-visite.test.js` exécute ce début de script dans un faux navigateur, avec chaque fuseau.

Le choix se fait à un seul endroit pour un membre, `/parametres`, rubrique Langue. Un visiteur a un petit lien en bas des pages publiques. Il n'y a pas de bouton de langue dans l'en-tête.

### Le serveur parle aussi les deux langues

Le serveur lit les mêmes dictionnaires que le navigateur (`require('../../public/langues/fr.js')`) : il n'y a qu'une liste de textes pour tout le site.

Dans le code du serveur, les messages restent écrits en français, là où on les lit : `throw new ErreurValidation('Adresse email invalide.')`. Juste avant l'envoi d'une réponse, `src/app.js` fait deux choses :

- il ajoute à chaque erreur un **code stable**, `adresse-email-invalide`, le même dans toutes les langues (un programme s'y fie, le texte est fait pour être lu) ;
- pour une personne qui lit l'anglais, il retrouve la phrase française dans le dictionnaire et rend sa version anglaise. Une phrase à trou comme « Au moins 2 caractères. » est reconnue par une expression régulière fabriquée à partir de son modèle « Au moins {n} caractères. ».

Une notification est écrite dans la langue de celui qui la **reçoit**, pas de celui qui agit : si Awa (français) aime la publication de Kofi (anglais), Kofi lit « Awa liked your post. ». Même règle pour les push et les emails.

Les pages elles-mêmes sont servies déjà traduites, balises de partage comprises : un lien collé dans WhatsApp par un anglophone montre un titre en anglais.

### Comment on sait que rien n'est oublié

Trois tests font ce travail à notre place :

- `fr.js` et `en.js` ont les mêmes clés, les mêmes variables `{nom}`, les mêmes pluriels ;
- un petit lecteur de code parcourt tous les scripts et toutes les pages de l'interface et **échoue s'il trouve un texte français qui ne passe pas par `t()` ou `data-t`** ;
- un autre parcourt le serveur et échoue si une de ses phrases n'a pas sa traduction.

En français, un quatrième contrôle garantit que rien n'a bougé : le texte écrit dans chaque page est, mot pour mot, celui de sa clé.

## 11 octodecies. La sécurité des comptes : sessions, alertes, deux étapes, corbeille

Fichiers : `src/utils/sessions.js`, `appareils.js`, `deux-etapes.js`, `mots-de-passe.js`, `journal.js`, `purge.js`, `src/routes/auth.js`, `src/routes/parametres.js`, `src/routes/publications.js`. Pages : `/parametres` (rubriques Sécurité, Compte, Corbeille), `/confirmer-email?motif=connexion`, `/pas-moi`, `/bon-retour`, `/annuler-suppression`.

### Une session par appareil

Le cookie de session contient un jeton signé (JWT). Avant, il portait seulement le numéro du membre : impossible de fermer UNE session sans fermer toutes les autres. Maintenant il porte aussi l'identifiant d'une ligne de la table `sessions`.

`chargerUtilisateur()` (`src/middleware/auth.js`) lit le membre ET sa session en une seule requête (`JOIN sessions`). Si la session est révoquée, la requête ne rend aucune ligne : il n'y a pas de membre connecté. Révoquer, c'est écrire une date dans `revoquee_le`.

La page ne reçoit jamais l'identifiant d'une session, seulement une empreinte courte (`left(sha256(id), 16)`) qui sert à dire « déconnecte cet appareil-là ». La requête de révocation filtre toujours sur le numéro du membre : on ne peut désigner que ses propres sessions.

### Appareil connu, appareil de confiance

À la première session valide, le navigateur reçoit le cookie `palabre_appareil` : un numéro au hasard suivi de sa signature (HMAC). La base garde l'empreinte du numéro dans `appareils_connus`. Deux niveaux :

- **connu** : pas d'email d'alerte à la connexion ;
- **de confiance** (case « Faire confiance à cet appareil ») : pas de code en deux étapes.

Un cookie fabriqué à la main n'a pas la bonne signature : il est ignoré, l'appareil reste inconnu.

### La connexion, étape par étape (`POST /api/auth/connexion`)

1. Le mot de passe est comparé (toujours, même si l'email n'existe pas, pour que le temps de réponse ne révèle rien).
2. Compte verrouillé pour trop d'essais : même réponse qu'un mot de passe faux.
3. Mot de passe faux : `noterEchec()` augmente le compteur **dans une seule requête SQL** (dix essais au même instant comptent dix). Au dixième : verrou de 15 minutes et email.
4. Compte verrouillé par « Ce n'était pas moi » : il faut choisir un nouveau mot de passe.
5. Deux étapes activées et appareil pas de confiance : un code part, aucun cookie de session, seulement un cookie d'attente. La page du code est la même que celle de l'inscription (`?motif=connexion` change le titre et les routes appelées).
6. Sinon `terminerConnexion()` : la session, le cookie d'appareil, le journal, et l'alerte si l'appareil était inconnu.

### Les mots de passe refusés

`v.motDePasse(valeur, champ, [prénom, nom, identifiant])` appelle `tropCourant()` et `contientLeNom()`. Le mot de passe est « nettoyé » (minuscules, sans accents) puis comparé trois fois : tel quel, sans les signes, et sans les chiffres. La liste est un simple `Set` écrit dans le fichier.

### Le journal

`journaliser(membre, type, req, options, client)`. Dans une transaction, on passe le `client` : l'événement n'existe que si l'action a vraiment eu lieu. La page écrit la phrase à partir du type (`EVENEMENTS` dans `public/js/parametres.js`), donc dans la langue du lecteur.

### Désactiver, supprimer, revenir

Deux colonnes : `desactive_le` et `suppression_prevue_le`.

- **Invisible partout.** Chaque requête qui écartait déjà les comptes bloqués (`u.bloque = FALSE`) écarte aussi les comptes désactivés (`AND u.desactive_le IS NULL`). En plus, `apercuMembre()` rend anonyme tout compte désactivé qui passerait encore : c'est le filet de sécurité.
- **Sauf dans la messagerie**, où les conversations restent : l'autre voit « Membre indisponible », sans photo ni lien, et ne peut ni écrire ni appeler (`droitDEcrire()`).
- **Revenir.** Se reconnecter ouvre une session, mais `exigerCompteActif` ferme toute l'API sauf `/api/auth`. La page `/bon-retour` appelle `POST /api/auth/reactiver`.
- **Supprimer** met le compte en sommeil avec une date à 30 jours (comptés en heures, pour qu'un changement d'heure ne décale rien). `purger()` (`src/utils/purge.js`) fait la suppression définitive : au démarrage du serveur, puis toutes les heures (`setInterval` avec `unref()`, qui n'empêche pas le serveur de s'arrêter), ou à la main par `npm run purger`.

### Modifier et corbeille

- **Modifier** : `PUT /api/publications/:id` et `PUT …/commentaires/:id`. La limite de 48 heures est dans la requête SQL (`cree_le > now() - 48 heures`), jamais d'après l'heure du navigateur. L'ancien texte part dans `historique_textes` dans la même transaction.
- **Corbeille** : `DELETE /api/publications/:id` par son auteur écrit `supprimee_le`. La requête commune `selection()` et `publicationDeLaRoute()` portent `p.supprimee_le IS NULL` : le fil, le profil, la page publique, les j'aime et les commentaires suivent tous. `effacerPublication()` fait la suppression définitive (ligne, photo, historique).

## 11 novodecies. La modération : règles, filtre, sanctions

Fichiers : `src/utils/regles.js`, `moderation.js`, `moderation-listes.js`, `nouveaux-comptes.js`, `sanctions.js`, `src/routes/sanctions.js`, `src/routes/admin.js`, `src/routes/signalements.js`. Pages : `/regles`, `/sanctions`, `/admin`.

### Accepter les règles

`VERSION_REGLES` est un simple numéro. À l'inscription, le serveur exige `accepteRegles === true` (une case cochée dans la page ne prouve rien : on peut appeler l'API sans la page) et garde `regles_acceptees_le` et `regles_version`. Le middleware `exigerReglesAcceptees` compare la version du membre à la version actuelle : si elle est plus ancienne, les requêtes qui lisent (`GET`) passent, les autres reçoivent 403. La page ouvre alors la fenêtre « Les règles ont changé ».

L'adresse de contact vient de `CONTACT_MODERATION`. Elle n'est écrite dans aucune page : la page porte un lien vide `<a data-contact-moderation></a>`, que `avecContact()` (`src/utils/statique.js`) remplit au moment de servir.

### Le filtre, pas à pas (`analyser(texte, langue)`)

1. **Nettoyer.** `motsDe()` met tout en minuscules, retire les accents, remplace les chiffres par les lettres qu'ils imitent (`0` devient `o`, `1` devient `i`, `@` devient `a`), ramène « connnnard » à « connard », et recolle quatre lettres isolées ou plus (« c o n n a r d »).
2. **Comparer par mots entiers.** Chaque mot est cherché dans un `Set`. « connexion » n'est pas « con ». Un mot n'est comparé « réduit » (lettres doubles retirées) que s'il était déguisé : ainsi « niger » n'est jamais confondu avec le mot à deux « g ».
3. **Les expressions** (« fils de pute », « sale noir ») sont cherchées dans la phrase nettoyée, entre deux espaces.
4. **Les liens.** `liensDe()` reconnaît une adresse avec `http`, avec `www.`, ou un nom de site à la terminaison connue. « node.js », « index.html » ou une adresse email ne sont pas des liens. `imiteUneMarque()` compare chaque morceau du domaine au nom des banques et opérateurs : même nom avec un chiffre à la place d'une lettre, ou à une lettre près (`distance()`), ou le vrai nom collé à un mot d'appât (« bonus », « login »).
5. **Les arnaques** sont des expressions régulières, appliquées au texte nettoyé. Elles donnent « en attente », pas « refusé ».

`controler(req, [[texte, 'champ']], { mode })` est ce que les routes appellent. Trois modes : `public` (peut mettre en attente), `strict` (un texte qu'on ne sait pas mettre en attente, comme la présentation : une arnaque y est refusée), `prive` (messages et propositions : insultes et liens seulement).

### « En attente »

Les tables `publications`, `commentaires`, `demandes` et `projets` avaient déjà une colonne `masque`, que toutes les lectures respectent. `mettreEnAttente()` met `masque = TRUE` et inscrit le contenu dans `moderation_attente`, dans la transaction qui le crée. La route répond 202 avec `{ enAttente: true, message }`. Approuver remet `masque = FALSE`. Aucune requête de lecture n'a eu à changer.

### Nouveaux comptes

`estNouveau()` compare `cree_le` à aujourd'hui. `refuserLesLiens()` utilise le même `liensDe()` que le filtre. `limiterNouveauCompte()` compte en base ce que le membre a fait depuis 24 heures.

### Signalements et sanctions

- `cacherSiTropSignale()` est appelé dans la transaction du signalement : il compte les signaleurs qui « pèsent », et à trois, appelle le même `mettreEnAttente()` que le filtre (raison `signalements`).
- `sanctionner()` choisit la sanction d'après le nombre de sanctions non annulées du membre (`TYPES[nombre]`), sauf si l'administrateur en impose une. La fin d'une suspension est recopiée dans `utilisateurs.suspendu_jusqu_a` : le middleware `exigerNonSuspendu` la lit sans requête de plus.
- La notification et l'email partent **après** la transaction (`apres()`) : si la base refuse la sanction, personne n'est prévenu à tort.
- `journalModeration()` écrit dans la même transaction que la décision.

### Le bandeau anti-arnaque

`parleDePaiement(texte)` est appelé au moment de **lire** un message (`versMessage()`) ou une proposition, seulement pour le destinataire. Il n'y a ni colonne ni table : rien n'est gardé, personne ne lit les messages.

## 11 vicies. Le Griot de Palabre : l'aide, sans intelligence artificielle

Fichiers : `public/js/assistant-recherche.js` (les sujets et la recherche), `public/js/assistant.js` (la fenêtre), `public/css/assistant.css`, le bouton dans `public/js/app.js` (`poserGriot()`, `chargerGriot()`), les textes dans `public/langues/fr.js` et `en.js` (famille `assistant.`), `tests/assistant.test.js`.

### Ce que c'est, et ce que ce n'est pas

Un bouton rond « Besoin d'aide ? » ouvre une fenêtre où l'on touche une suggestion ou écrit une question. Le Griot répond en deux ou trois phrases, avec un ou deux boutons vers la bonne page.

Ce n'est **pas** une intelligence artificielle. Il n'y a ni service payant, ni bibliothèque, ni serveur : la question est comparée, **dans le navigateur**, aux mots-clés de 28 sujets. Rien n'est envoyé, rien n'est enregistré, personne ne lit les questions. La fenêtre le dit : « Assistant automatique, pas une personne. »

### La recherche, pas à pas (`chercher(question, index, profil)`)

Règle de départ : **une mauvaise réponse est pire que « je n'ai pas compris »**. Le Griot ne répond que si un sujet se détache nettement.

1. **Nettoyer** : minuscules, accents retirés, ponctuation remplacée par des espaces.
2. **Remettre d'aplomb** les abréviations (`assistant.abreviations` : « koi » devient « quoi », « mdp » devient « motdepasse », « dev » devient « developpeur ») et détacher un article collé (« lequipe » devient « equipe »).
3. **Retirer les mots-outils** (`assistant.mots-vides` : « comment », « mon », « je », « le », « faire », « avoir », « est », « quoi », « pour », « the », « how »…). Ils ne disent rien du sujet : une question faite seulement de mots-outils (« comment je fais ») ne trouve jamais rien.
4. **Comparer** chaque mot restant aux mots-clés des sujets (`proximite()`) : 2 points pour le même mot, 1 point pour un mot proche. « Proche » veut dire le même début à quelques lettres près (« oublier » pour « oublie »), ou **la même première lettre** et une seule faute de frappe (« suprimer »). La première lettre doit être la bonne : sans cette règle, « publie » passait pour « oublie », et « comment je publie mon projet » recevait la réponse sur le mot de passe.
5. **Compter les points** de chaque sujet (`pointsDe()`) : chaque mot de la question compte une fois, et une expression retrouvée d'un seul tenant (« mot de passe », « sans internet ») ajoute 2 points.
6. **Exiger un écart net** : le premier sujet doit avoir au moins une fois et demie les points du deuxième (`ECART`). Sinon, « Je n'ai pas compris ta question » : le Griot ne devine pas.

Trois précisions :

- Un sujet **« faible »** (la présentation de Palabre, les salutations) ne répond que si aucun autre sujet n'a de point : « bonjour, c'est gratuit ? » parle de gratuité, pas de bonjour.
- Un sujet peut mener à **un autre selon la personne** (`autre`) : « publier mon projet » est un projet du profil pour un dev, une demande pour un client.
- **Un mot-clé d'un seul mot n'appartient qu'à un sujet.** S'il était dans deux, ils seraient toujours à égalité, donc jamais de réponse. Un mot à double sens (« équipe », « application », « site », « compte ») ne s'écrit que dans une expression (« équipe éclair », « application mobile », « supprimer mon compte »). Un test le vérifie.

Les mots-clés des deux langues valent toujours : un membre dont le site est en français peut écrire en anglais.

### Adapté à la personne et à la page

- `suggestionsPour(profil, page)` : les six suggestions. Celles de la page d'abord (`PAR_PAGE`), puis les autres sujets de la personne (visiteur, dev ou client).
- `boutonsPour(sujet, profil)` : chaque bouton dit qui a le droit de le voir (`pour`). Un visiteur ne reçoit jamais un lien vers `/parametres` ; un membre ne reçoit jamais « Créer un compte ».
- L'adresse de l'équipe n'est écrite dans aucun script : la fenêtre la lit dans la page `/regles`, où le serveur la pose (`avecContact()`, variable `CONTACT_MODERATION`).

### Chargé au premier toucher

À l'ouverture d'une page, seul le bouton existe (quelques lignes dans `app.js` et `style.css`). `chargerGriot()` ajoute la feuille de style et les deux scripts quand on touche le bouton, comme `chargerAppels()` pour les appels. Le service worker les garde : l'aide s'ouvre aussi hors connexion.

La fenêtre est un `<dialog>` ouvert par `showModal()` : la touche Échap la ferme, le focus reste dedans, et il revient au bouton à la fermeture. Ce que la personne écrit est posé avec `textContent` (`el()`), jamais `innerHTML`.

### Un bouton qui ne gêne pas la lecture

Sur les pages de liste d'un membre connecté (fil, demandes, recherche, profil), le bouton rond se posait sur le texte : un commentaire, le bouton « Commenter ». Il se retire donc quand on fait défiler vers le bas, et revient dès qu'on remonte ou qu'on est en haut de la page (`retirerEnDefilant()` dans `app.js`). Sur les pages publiques, il ne bouge pas.

Trois précautions pour que cela ne coûte rien au téléphone : l'écouteur de défilement est « passif » (il ne peut pas ralentir le doigt), le travail est fait une seule fois par image affichée (`requestAnimationFrame`), et ce travail se résume à poser ou retirer une classe CSS, qui ne change que `transform` et `opacity`. Avec `prefers-reduced-motion`, le bouton disparaît et revient sans glisser. Au clavier, il reprend sa place dès qu'il reçoit le focus. En bas de ces pages, 72 px sont réservés sous le dernier élément.

### Ajouter une question

1. Dans `SUJETS` (`public/js/assistant-recherche.js`), une ligne : `{ id: 'mon-sujet', pour: TOUS, boutons: ['regles'] }`.
2. Dans `public/langues/fr.js` **et** `en.js`, ses trois textes : `assistant.sujet.mon-sujet.question` (la suggestion), `.mots` (les mots-clés, séparés par des virgules) et `.reponse` (2 ou 3 phrases).
3. Dans `tests/assistant.test.js`, deux ou trois phrases comme les gens les écriraient, avec le sujet attendu (test « questions réalistes »).

Bien choisir un mot-clé : se demander **dans quelle autre question ce mot apparaît**. « Supprimer » seul répondrait aussi à « supprimer une publication » : on écrit « supprimer mon compte ». « Combien » seul est gardé, parce que « c'est combien ? » est une vraie question de prix ; en échange, « combien de temps… » reçoit la réponse sur les prix (limite connue).

C'est tout : la fenêtre, la recherche et les suggestions suivent. `tests/assistant.test.js` échoue s'il manque un texte, si la suggestion ne trouve pas sa propre réponse, ou si un bouton n'existe pas. Pour changer seulement une réponse ou ajouter un mot-clé, on ne touche qu'aux fichiers de langue.

**Une réponse ne doit jamais donner un chiffre que le site n'applique pas.** Un test vérifie les valeurs citées (30 jours, une heure, 18 ans, trois signalements) contre le code, et qu'aucun prix n'est écrit : les prix viennent de la grille du calculateur.

## 11 unvicies. La base de savoir : filtres du fil, meilleure réponse, recherche

Fichiers : `src/routes/publications.js` (tout le serveur), `public/js/fil.js` (les puces), `public/js/publication.js` (le badge, la marque, le menu), `public/js/app.js` (`brancherRecherche()`), `public/recherche.html` et `public/js/recherche.js` (la page), `tests/savoir.test.js`.

Le thème de la CADEV demande que les développeurs puissent « poser des questions » et « partager leurs connaissances ». Avant, une question se perdait dans le fil au bout de deux jours. Trois ajouts en font une base de savoir.

### 1. Filtrer le fil par type

Sous « Tout le monde / Mes amis », cinq puces : Tout, Questions, Sans réponse, Idées, Projets. La page envoie `?type=question` (ou `idee`, `projet`, `sans-reponse`) à la route du fil.

**Le tri est fait par le serveur, dans la requête SQL**, pas dans la page. Si la page triait elle-même les 10 publications reçues, « Questions » pourrait en montrer 2, puis 0, puis 4 : le défilement infini ne saurait plus s'il reste quelque chose. Ici, la condition s'ajoute à la requête commune `SELECTION` : les autres règles (corbeille, publications masquées, comptes bloqués ou désactivés, confidentialité, « Mes amis », page suivante) continuent de s'appliquer sans qu'on les réécrive. Un type inconnu ne filtre rien.

### 2. La meilleure réponse

L'auteur d'une question ouvre le menu « … » d'un commentaire et choisit « Meilleure réponse ». Ce commentaire passe en premier avec une marque verte, et la question porte le badge « Résolue ».

- **Une colonne** : `publications.meilleure_reponse_id`, qui pointe vers un commentaire. Une seule colonne, donc une seule meilleure réponse : en choisir une autre remplace la première.
- **Les droits sont vérifiés par le serveur** (`PUT /api/publications/:id/meilleure-reponse`) : seulement l'auteur de la publication, seulement si c'est une question, jamais pour son propre commentaire, et le commentaire doit appartenir à cette publication. Sinon 403 ou 404. Le menu de la page ne fait que cacher le choix à ceux qui n'y ont pas droit.
- **Une transaction** : la question est verrouillée (`FOR UPDATE`), la colonne change, la notification part. Deux clics au même instant ne font pas deux notifications.
- **La question redevient « sans réponse » toute seule** : si le commentaire est supprimé, la base vide la colonne (`ON DELETE SET NULL`). S'il est masqué, ou si son auteur est bloqué ou désactivé, la colonne reste mais la lecture ne le compte plus : la sous-requête `mr` de `SELECTION` ne garde qu'une réponse encore visible. Quand le membre revient, sa réponse aussi.
- **La notification** `meilleure_reponse` prévient l'auteur de la réponse. Si l'auteur de la question change d'avis avant qu'elle soit lue, elle est retirée.
- **Sur le profil** : `nbReponsesRetenues`, à côté des projets vérifiés. C'est une preuve de plus, dans l'esprit du profil prouvé : ce n'est pas le membre qui dit qu'il aide, ce sont ceux qui ont posé la question.

### 3. Chercher dans les publications

La barre de recherche de l'en-tête répond en deux parties, « Membres » et « Publications » (4 au plus, en version légère : `?court=1`). La touche Entrée, ou « Voir toutes les publications », ouvre la page `/recherche?q=…`, avec les mêmes puces de type et le défilement infini.

- **Tous les mots doivent être présents**, dans le texte de la publication ou dans sa meilleure réponse (c'est elle, le savoir). Ni les majuscules ni les accents ne comptent.
- **Les questions résolues viennent d'abord**, puis les plus récentes. La page suivante suit ce double tri grâce à un curseur en deux morceaux (« 1-482 » : résolue ou non, puis le numéro).
- **Pourquoi `LIKE` et pas la recherche plein texte de PostgreSQL** (`to_tsvector`) : celle-ci découpe les mots selon une langue, alors que le fil mêle français, anglais et noms de techniques (« Node.js », « C# »), et elle n'ignore pas les accents sans l'extension `unaccent`. `LIKE` fait ce qu'on attend, sans rien installer chez l'hébergeur. Avec quelques milliers de publications, c'est rapide ; au-delà, il faudra un index.
- **Sûreté** : les mots arrivent en paramètre (`$2::text[]`), jamais collés dans la requête ; les jokers `%` et `_` sont neutralisés ; 6 mots au plus ; 120 recherches par 5 minutes et par membre.
- **Aucune fuite** : la recherche part elle aussi de `SELECTION`. Une publication « amis seulement » ne sort que pour les amis de son auteur, y compris dans la liste courte de l'en-tête et y compris quand le mot cherché n'est que dans la meilleure réponse. `tests/savoir.test.js` le vérifie.
- La recherche de publications est réservée aux membres, comme le fil. Un visiteur garde la recherche de membres.

## 11 duovicies. La revue du code avant la mise en ligne

Avant la mise en ligne, tout le code a été relu à la recherche de vrais problèmes : le rapport est dans `docs/REVUE-CODE.md`, avec le suivi des corrections à la fin. Ce qu'il faut savoir expliquer :

- **Les comptes de démonstration sont verrouillés.** Leur mot de passe est public (le dépôt l'est). Sans protection, n'importe qui pouvait y allumer la validation en deux étapes et fermer la porte au jury. `refuserCompteDemo` (`src/routes/parametres.js`) répond 403 à toute route qui prendrait ou fermerait un compte `@demo.palabre.dev`.
- **Un raté de la base ne déconnecte plus personne.** `chargerUtilisateur()` (`src/middleware/auth.js`) sépare deux cas : un jeton faux efface le cookie ; une erreur de la base donne une erreur 500, et la session reste.
- **Le paramètre `suite`** (où aller après la connexion) n'accepte qu'une adresse du site. Le piège : le navigateur retire les tabulations d'une adresse avant de la lire, donc « /, tabulation, /site.example » devient « //site.example », un autre site. `suiteDemandee()` de `app.js` refuse ces caractères, puis compare l'adresse telle que le navigateur la comprend.
- **Une photo de message privé n'est jamais gardée sans contrôle** : `private, no-cache` oblige le navigateur à redemander au serveur avant chaque affichage (réponse 304, sans renvoyer l'image, si rien n'a changé), et le service worker ne garde pas `/fichiers/`.
- **Le push suit les sessions.** Fermer de force les sessions d'un membre retire aussi ses abonnements push (`oublierPush()` dans `src/utils/sessions.js`) ; un appareil resté connecté redonne le sien tout seul (`resynchroniser()` de `public/js/push.js`).
- **Les limites par adresse IP ne comptent que ce qui ressemble à une attaque** : sur un réseau mobile, des centaines d'abonnés sortent par la même adresse. Une connexion réussie ne compte pas ; l'inscription a sa propre limite.
- **« Pas de réponse » n'est pas « pas connecté ».** Si `/api/auth/moi` échoue deux fois, `versConnexion()` affiche « Réessayer » au lieu d'envoyer un membre connecté vers le formulaire de connexion.

## 12. Le système de design

Un « système de design », c'est un petit nombre de règles visuelles appliquées partout, pour que le site ait l'air d'une seule et même application. Tout est écrit à la main : aucune bibliothèque d'interface, aucun framework, donc des pages qui restent légères en 3G (les icônes pèsent 8 Ko en tout, les illustrations 4 Ko).

Palabre reprend les **principes** des grands réseaux sociaux (le contenu d'abord, la preuve sociale, une en-tête compacte), pas leur apparence : ses couleurs, sa bande tissée et son anneau de preuve n'appartiennent qu'à lui.

### Les réglages communs (`public/css/style.css`, bloc `:root`)

| Réglage | Variables | Rôle |
| --- | --- | --- |
| Couleurs du logo | `--terre-logo`, `--feuille`, `--tronc`, `--creme` | la palette de départ |
| Couleur d'action | `--action`, `--action-survol`, `--sur-action` | **le vert feuillage** : boutons, liens, j'aime actif, onglet actif |
| Petits accents | `--accent` | la terre cuite, seulement pour les pastilles de compteur et le badge « Question » |
| Surfaces | `--papier`, `--surface`, `--surface-2` | le fond neutre, les publications en blanc pur, les zones en retrait |
| Tailles de texte | `--t-13`, `--t-15`, `--t-17`, `--t-20`, `--t-24` | cinq tailles et rien d'autre |
| Teintes d'avatar | `--teinte-0` à `--teinte-5` | terre cuite, prune, ocre, indigo, brun écorce, bleu canard (aucun vert : il est réservé à l'anneau de preuve et aux actions) |
| Ombres | `--ombre-1`, `--ombre-2`, `--ombre-3` | trois niveaux : carte posée, carte survolée, fenêtre au-dessus de la page |
| Coins arrondis | `--rayon-petit`, `--rayon`, `--rayon-grand` | trois tailles seulement |

Changer une valeur ici change tout le site. Le mode sombre (« nuit sous le baobab », un noir-vert et non un noir pur) n'est pas une seconde feuille de style : il redéfinit ces mêmes variables.

**Le texte courant utilise la police du téléphone** (`system-ui`) en 15 px : rien à télécharger, donc rapide en 3G, et net sur tous les écrans. La police Bricolage ne sert qu'aux noms, aux titres et au logo. Deux exceptions à l'échelle, voulues : le grand titre de la page d'accueil, et les champs de saisie en 16 px (en dessous, l'iPhone zoome sur la page dès qu'on touche un champ).

### Mode clair et mode sombre : le choix du membre

Par défaut, le site suit le réglage du téléphone ou de l'ordinateur. Un bouton de l'en-tête (une lune en mode clair, un soleil en mode sombre) permet de choisir soi-même ; le choix est gardé dans le navigateur (`localStorage`), il ne passe pas par le serveur.

- `public/js/theme.js` est le seul script chargé **sans** `defer`, tout en haut de chaque page : il écrit `data-theme="clair"` ou `"sombre"` sur la balise `<html>` avant que la page s'affiche. Sans cela, on verrait un éclair de page blanche avant le passage en sombre.
- Dans le CSS, les couleurs du mode sombre sont sous `:root[data-theme="sombre"]`. Les quelques règles particulières s'écrivent `:where([data-theme="sombre"]) .classe` : `:where` ne compte pas dans la priorité des règles, donc elles se comportent comme avant.
- Le script est un fichier à part, et non du code écrit dans la page : la CSP du site interdit tout script en ligne.

### Les icônes (`public/icons/icones.svg`)

Les icônes viennent de **Lucide** (licence ISC, notée dans `LICENCES.md`). Elles sont rangées dans un seul fichier, un « sprite » : le navigateur le télécharge une fois, puis chaque icône n'est qu'une référence, `<svg class="icone"><use href="/icons/icones.svg#coeur"></use></svg>`. Dans le JavaScript, la fonction `icone('coeur')` de `public/js/app.js` crée cette balise. Les icônes sont dessinées au trait avec `currentColor` : elles prennent toujours la couleur du texte voisin, en clair comme en sombre. Dans le menu, l'onglet de la page où l'on se trouve a son icône **pleine** (une seule règle CSS : `fill: currentColor`).

Une icône seule ne suffit pas pour un lecteur d'écran : les boutons sans texte (loupe, cloche, corbeille) portent un `aria-label`.

### Les composants communs (`public/js/app.js`)

| Fonction | Ce qu'elle fait |
| --- | --- |
| `avatar(personne, taille)` | la photo ou les initiales d'un membre, avec son anneau de preuve |
| `nomMembre(membre)` | son nom, suivi du badge feuille s'il a un projet vérifié |
| `listeChoix(select)` | une liste de choix au style du site, à la place du `<select>` du navigateur (chapitre 11 septies) |
| `chargementInfini(liste, chargerSuite)` | la page suivante d'une liste, chargée toute seule en défilant (chapitre 11 sexies) |
| `partager({ titre, texte, url })` | LE partage du site : menu du téléphone, ou fenêtre WhatsApp / Facebook / X / Copier le lien |
| `menuOptions(lister)` | le bouton « … » (« Plus d'options ») et son petit menu : Copier le lien, Signaler, Supprimer |
| `toast(texte, type)` | petit message qui apparaît en bas de l'écran puis disparaît (« Publié ! », ou une erreur) |
| `confirmer(question, options)` | fenêtre de confirmation ; renvoie une promesse, donc on écrit `if (await confirmer('Supprimer ?'))` |
| `etatVide(illustration, titre, texte, bouton)` | quand une liste est vide : une illustration et un mot d'encouragement |
| `chargement(zone, nombre)` | affiche des « squelettes » gris animés pendant un chargement, et renvoie la fonction qui les retire |

**Il n'y a aucun `alert()` ni `confirm()` du navigateur dans le site** : ils bloquent la page, ne suivent pas le style, et certains navigateurs les masquent. La fenêtre de confirmation utilise la balise `<dialog>` : le navigateur gère lui-même le fond assombri, la touche Échap et le maintien du focus dans la fenêtre. Le focus va d'abord sur « Annuler », pour qu'une touche Entrée trop rapide ne supprime rien.

### Le menu « … »

En haut de chaque publication, sous chaque commentaire et sur le profil d'un autre membre, un bouton « … » ouvre un petit menu : « Copier le lien » (publications et profils), « Signaler », et « Supprimer » si le contenu est à moi ou si je suis administrateur. Le menu se ferme avec la touche Échap, en touchant à côté, ou après un choix ; les flèches du clavier passent d'un choix à l'autre. Montrer « Supprimer » à un administrateur n'est qu'un confort : c'est le serveur qui vérifie le droit de supprimer.

Le premier choix du menu d'une publication est « Partager » ; le lien partagé ou copié est la page publique `/publication/12` (chapitre 11 quinquies). L'ancienne adresse `/fil?publication=12` marche toujours pour les liens déjà envoyés.

### Les avatars sans photo

Un membre sans photo a ses initiales en blanc sur une couleur. Cette couleur n'est pas tirée au hasard : `teinteAvatar()` additionne les lettres de l'identifiant et garde le reste de la division par 6. Le même identifiant donne donc **toujours** la même teinte, sur toutes les pages et tous les téléphones, sans rien enregistrer en base.

### L'anneau de preuve, la signature de Palabre

Autour de la photo d'un dev, un anneau vert découpé en segments : **un segment par projet dont le lien a été vérifié**. De 1 à 8 projets, autant de segments ; au-delà de 8, l'anneau est plein. Pas de projet vérifié, pas d'anneau. D'un coup d'œil, on distingue celui qui a prouvé son travail de celui qui l'affirme seulement.

- **Côté serveur** : `apercuMembre()` (`src/utils/membres.js`) renvoie `nbProjetsVerifies`. Ce nombre est une sous-requête ajoutée à `COLONNES_MEMBRE` : il arrive dans la même requête que le nom et la photo. Il n'y a jamais une requête par membre (ce défaut classique s'appelle « N+1 » : 10 publications demanderaient 11 requêtes).
- **Côté navigateur** : `anneauPreuve(nombre)` dessine l'anneau en SVG, un arc (`<path>`) par segment, avec un peu de trigonométrie pour placer le début et la fin de chaque arc. Le dessin est fait dans un carré de 100 unités : il s'adapte donc à toutes les tailles d'avatar.
- **Le badge feuille** : une petite feuille verte à côté du nom de tout dev qui a au moins un projet vérifié. Son `aria-label` est « Profil prouvé », pour les lecteurs d'écran.

### L'en-tête et la recherche

L'en-tête fait 56 px et reste collée en haut (`position: sticky`) : le logo à gauche ; la loupe, la cloche et l'avatar à droite. Sur téléphone, cinq onglets forment la barre du bas : Fil, Demandes, Devs, Amis, et **son propre avatar**, qui mène à son profil.

La loupe ouvre un panneau plein écran. On tape un nom, les résultats arrivent en direct :

- le navigateur attend **300 ms** après la dernière frappe avant d'interroger le serveur (une requête par mot, pas une par lettre), et ignore la réponse d'une ancienne frappe arrivée en retard ;
- le serveur (`GET /api/devs?q=…`) exige au moins 2 lettres et cherche avec `ILIKE` (sans tenir compte des majuscules) dans une requête paramétrée. Les caractères `%` et `_`, qui sont des jokers pour `ILIKE`, sont neutralisés : on ne peut pas s'en servir pour lister tous les membres ;
- **les accents ne comptent pas** : « ouedraogo » trouve « Ouédraogo ». Le texte tapé passe par `versIdentifiant()` (la fonction qui fabrique l'identifiant à l'inscription : minuscules, sans accents, tirets) et il est comparé à l'identifiant du membre, en plus de son nom.

### Le fil

- **Bord à bord sur téléphone** : les publications vont d'un bord à l'autre de l'écran, sans coins arrondis ni ombre, séparées par une bande de 8 px de la couleur du fond. C'est un fil, pas une pile de cartes. À partir de 640 px de large, elles retrouvent des coins arrondis.
- Le fil commence par la zone de publication (« Quoi de neuf, Awa ? », avec trois raccourcis : Photo, Question, Projet), puis la rangée **« Disponibles maintenant »** : au plus 15 devs disponibles, triés par le serveur (`GET /api/devs/disponibles`) : mes amis d'abord, puis ma ville, puis mon pays, puis ceux qui ont le plus de projets vérifiés.
- **Preuve sociale** : « Aimé par Cheick et 12 autres » (un ami en priorité : un prénom connu donne plus envie de lire qu'un chiffre), le nombre de commentaires, et les 2 derniers commentaires visibles directement. Tout cela arrive **dans la requête du fil**, grâce à deux `LEFT JOIN LATERAL` : une sous-requête exécutée pour chaque publication, mais à l'intérieur de la même requête SQL.
- **J'aime instantané** : le cœur se remplit et fait un petit « pop » **tout de suite**, sans attendre la réponse du serveur ; si le serveur refuse, l'affichage revient en arrière et un message s'affiche.
- **Texte long** : coupé après 5 lignes par le CSS (`line-clamp`), avec « Voir plus ». Le bouton n'apparaît que si le texte dépasse vraiment (on compare sa hauteur réelle à sa hauteur visible).
- **Images** : sur toute la largeur, proportions gardées, au plus 4:5 en hauteur. À l'envoi, le serveur lit la largeur et la hauteur dans les premiers octets du fichier (`src/utils/images.js`, sans bibliothèque) et les range avec la publication. Le navigateur connaît ainsi la forme de l'image avant de la télécharger (attributs `width` et `height`, et `aspect-ratio: 4 / 5` pour une image trop haute) et lui réserve sa place : **la page ne saute pas** pendant le chargement, ce qui compte beaucoup sur une connexion lente.

La carte d'une publication est dans `public/js/publication.js`, partagée par le fil et par l'onglet « Publications » des profils.

### Le profil

En haut, une **photo de couverture** choisie par le membre (réduite à 1200 px de large dans le navigateur, puis vérifiée par le serveur comme la photo de profil ; colonne `utilisateurs.couverture`). Sans couverture, le motif tissé de Palabre. La photo de profil chevauche la couverture ; viennent ensuite le nom avec le badge feuille, la ville, la bio, la disponibilité, les chiffres (projets vérifiés, amis, avis avec la note moyenne) et « N amis en commun » sur le profil de quelqu'un d'autre.

Dessous, quatre onglets qui restent collés sous l'en-tête pendant le défilement : **Publications** (le fil filtré par `?auteur=identifiant`), **Projets**, **Avis**, **Amis**. Les publications et les amis sont réservés aux membres connectés ; un visiteur arrive sur les projets.

### Le mouvement, sans gêner personne

Le mouvement est volontairement rare : le « pop » du cœur, l'ouverture des commentaires, l'arrivée en douceur d'une publication qu'on vient d'écrire, les fenêtres et les toasts. Les publications du fil, elles, n'ont pas d'animation d'apparition : sur un fil qu'on fait défiler, cela fatigue. Certaines personnes sont gênées par les animations (vertiges, migraines) et le demandent dans les réglages de leur téléphone. La dernière règle de la feuille de style, `@media (prefers-reduced-motion: reduce)`, coupe alors **toutes** les animations et transitions du site.

### Ce qui n'a pas changé

Les règles de sécurité restent les mêmes : aucun style ni script en ligne (la CSP les bloque toujours), le texte des membres passe toujours par `textContent` ou `el()`, les zones tactiles font au moins 44 px et le focus au clavier reste visible.

### La version ordinateur : trois colonnes

Le site est pensé d'abord pour le téléphone. À partir de 768 px de large, la page d'un membre connecté gagne des colonnes, sans qu'aucune page HTML ne change : tout tient dans un bloc de la feuille de style (« Version ordinateur et tablette ») et dans trois fonctions de `public/js/app.js`.

| Largeur de l'écran | Mise en page |
| --- | --- |
| moins de 768 px | téléphone : une colonne, barre de navigation en bas |
| 768 à 1099 px | 2 colonnes : la page (680 px au plus) et le panneau de droite (300 px) ; le menu est dans l'en-tête, en icônes |
| 1100 à 1599 px | 3 colonnes : menu 256 px, fil 680 px, panneau 344 px, le tout centré |
| 1600 px et plus | menu 340 px collé à gauche, panneau 360 px collé à droite, fil de 720 px au milieu de l'écran |

- **La grille est posée sur `<body>`** (`display: grid`) : la bande et l'en-tête occupent toute la largeur, puis une ligne porte les trois colonnes. Les largeurs sont des variables (`--col-gauche`, `--col-fil`, `--col-droite`) redéfinies à chaque palier. Entre 1100 et 1340 px environ, l'écran est trop étroit pour 256 + 680 + 344 : c'est le fil qui cède de la place (`minmax(0, 680px)`), jamais les colonnes de côté.
- **Les colonnes de côté restent collées** sous l'en-tête (`position: sticky`) et défilent seules si elles sont plus hautes que l'écran (`max-height` et `overflow-y: auto`).
- **La colonne de gauche** (`colonneGauche()`) : ma carte, les liens avec icône et compteur, le lien de la page courante en vert (`aria-current="page"`), un bouton principal qui dépend du type de compte (« Ajouter un projet » ou « Publier une demande »).
- **Le panneau de droite** (`colonneDroite()`) : les 3 dernières demandes, puis 4 « Devs à découvrir ». Sur téléphone, où il est caché, ses données ne sont **pas demandées au serveur** : rien n'est téléchargé pour rien en 3G.
- **Les suggestions** (`GET /api/devs/suggestions`) : des devs qui ne sont ni mes amis ni liés à moi par une demande en cours, triés par compétences en commun, puis même ville, puis même pays, puis nombre de projets vérifiés. Tout est calculé dans une seule requête SQL. Le bouton « Ajouter » envoie la demande d'ami et devient « Demande envoyée ».
- **La recherche** devient une vraie barre dans l'en-tête, avec les résultats en liste dessous. Elle partage son code avec le panneau plein écran du téléphone (`brancherRecherche()`). La touche `/` y place le curseur.
- **Certaines pages ont leur propre colonne de droite** (classe `page-large` sur `<main>`) : les filtres pour Demandes et Devs, un encadré « en bref » pour le détail d'une demande, et sur le profil une colonne « Présentation » à gauche du contenu des onglets. Sur téléphone, ces mêmes éléments sont simplement dans le fil de la page (`display: contents`).

### Les pages Connexion et Inscription : la « lame »

`/connexion` et `/inscription` sont **une seule page** (`public/connexion.html`) qui contient les deux formulaires. Le serveur (`src/routes/pages.js`) y écrit lequel montrer selon l'adresse (`data-vue`) : en arrivant directement sur `/inscription`, on voit tout de suite le bon formulaire, sans clignotement.

- **Passer de l'un à l'autre sans recharger** : `public/js/acces.js` change l'adresse avec `history.pushState` (les paramètres `?suite=…` suivent), et écoute `popstate` pour que le bouton retour du téléphone fonctionne.
- **La lame** : le panneau vert est fait de quatre couches superposées, découpées par `clip-path: polygon(…)`. La couche du dessus est le fond vert ; les trois autres dépassent de 3, 9 et 20 pixels et dessinent le liseré terre cuite et son halo. Pour l'animation, le CSS ne change que ce `clip-path` : la lame s'étend jusqu'à couvrir la carte, les formulaires s'échangent dessous, puis elle se retire de l'autre côté. Aucun élément ne se déplace vraiment, le navigateur n'a pas de mise en page à recalculer : cela reste fluide sur un petit téléphone.
- **Sur téléphone**, la lame est en haut (environ 34 % de l'écran) : elle descend, puis remonte avec l'autre message.
- **Accessibilité** : le formulaire caché reçoit l'attribut `inert` (ni le clavier ni un lecteur d'écran ne peuvent y entrer) ; après le changement, le focus va au premier champ du nouveau formulaire ; si la personne a demandé moins d'animations, pas de balayage, un simple fondu.
- **Les champs** sont soulignés ; le trait terre cuite qui se dessine de gauche à droite est une transformation (`scaleX`) déclenchée par `:focus-within`. Le bouton œil change le type du champ de `password` à `text`. L'indicateur de force n'est qu'un conseil : la règle des 8 caractères reste vérifiée par le serveur.
- **Le texte du panneau suit le type de compte** : sur l'inscription, le panneau dit « Rejoins le cercle. » à un développeur et « Ton projet mérite les bons devs. » à un client. Les deux versions sont écrites une seule fois, dans la page (attributs `data-dev` et `data-client`). `acces.js` affiche la bonne dès qu'on touche une tuile, avec un fondu court. Et si l'on arrive avec `?type=client` (bouton « J'ai un projet » de l'accueil, calculateur), c'est le serveur qui coche « Client » et écrit le bon texte avant d'envoyer la page : rien ne clignote.
- **Le motif du fond** : de petits dessins au trait sur le thème des développeurs (`</>`, `{ }`, un terminal, une tasse de café, une fusée…), dans l'esprit du fond des discussions WhatsApp. Ils sont rangés dans un seul fichier de moins de 4 Ko, `public/icons/motif-acces.svg` : des tracés Lucide, plus deux dessins de l'équipe (`=>` et le groupe de trois personnes). `acces.js` les dispose sur une grille : chaque case reçoit un dessin, décalé, tourné (de -15° à +15°) et dimensionné par un « hasard » calculé à partir du numéro de la case, donc toujours le même pour un même écran. Une case qui toucherait la carte (ou, sur téléphone, le panneau vert, le formulaire ou un autre dessin) reste vide : rien ne passe sous un champ. 
- **Le motif est vivant**, avec trois mouvements qui s'additionnent, chacun porté par son propre élément emboîté (`<g position> → <g profondeur> → <g vent> → <use>`) pour ne pas se gêner :
  - *le vent* : tous les dessins flottent (± 6 px, ± 6°). Chacun reçoit une des 3 danses, une des 9 durées (6 à 14 s) et un des 8 décalages de départ, soit 216 combinaisons : ils ne sont jamais synchronisés. Tout est en CSS (`@keyframes`), le script ne fait que poser des classes ;
  - *la profondeur* : sur ordinateur, les dessins se décalent à l'opposé de la souris, de 4 px pour les plus petits à 12 px pour les plus grands. Le script n'écrit que deux nombres (`--px`, `--py`) sur le motif, une fois par image affichée (`requestAnimationFrame`), et le CSS fait le calcul pour chaque niveau. Sur téléphone, l'inclinaison de l'appareil joue le même rôle quand le navigateur la donne sans demander d'autorisation ;
  - *l'envol* : connexion ou inscription réussie, le motif monte de 20 px et s'efface en 0,4 s avant le changement de page.
- **Sans gaspiller** : seuls `transform` et `opacity` sont animés (le navigateur n'a rien à recalculer). La souris n'est écoutée que si la page est visible ; onglet caché, l'écoute s'arrête et le flottement est mis en pause. Si la personne a demandé moins d'animations, il n'y a aucun mouvement du tout : ni vent, ni profondeur, ni envol.
- **Le remplissage automatique** : quand le navigateur remplit lui-même l'email et le mot de passe, il peint le champ en bleu pâle et on ne peut pas changer ce fond. La règle `:-webkit-autofill` le recouvre d'une ombre intérieure à la couleur du site, en clair comme en sombre.
- **La photo du panneau** est facultative : voir « Les photos de fond » ci-dessous. Sans photo, le dégradé suffit.
- L'envoi des formulaires, les erreurs sous chaque champ et le paramètre `suite` n'ont pas changé : ils sont toujours dans `public/js/formulaires.js`.

### Les photos de fond

Le haut de l'accueil et le panneau vert de la connexion affichent des photos (`public/img/fond/`), avec un fondu lent de l'une à l'autre. Les cinq photos viennent de Pexels ; elles ont été recadrées et étalonnées aux couleurs de Palabre, et leurs auteurs sont notés dans `LICENCES.md`.

- **Deux formats, deux tailles** : chaque photo existe en WebP et en JPEG de secours, en 1080 px et en 1920 px de large (`fond-1-1080.webp`, `fond-1-1920.jpg`…). `photosDeFond()` (`src/routes/pages.js`) regroupe les fichiers d'une même photo.
- **La bonne taille pour chaque écran** : la balise `<picture>` contient un `srcset` (« voici le fichier de 1080 px et celui de 1920 px ») et `sizes="100vw"` (« l'image occupera toute la largeur de l'écran ») : le navigateur calcule lui-même lequel télécharger. Une première `<source media="(max-width: 767px)">` impose la petite taille aux téléphones : sans elle, un téléphone à écran très dense irait chercher la grande, trois fois plus lourde, ce qu'on ne veut pas en 3G.
- **Lisibilité** : les photos sont en vraies couleurs. Sur l'accueil, un dégradé vert très foncé est posé par-dessus (dense sous le texte, transparent là où la photo se montre) ; dans le panneau de connexion, un voile vert léger (55 %) et, derrière le texte seulement, une ombre verte plus dense aux bords fondus. Le contraste du texte a été mesuré sur les cinq photos, pixel par pixel : il reste au-dessus de 4,5 pour le texte courant et de 3 pour les titres, les seuils d'accessibilité (WCAG AA).
- **Le logo** : quand une photo est présente, c'est elle le visuel principal. Le grand carré du logo est retiré (`.heros:has(.fond-photos)` dans le CSS) ; il ne s'affiche que s'il n'y a pas de photo.
- **Respecter la 3G** : le serveur n'écrit qu'**une** photo dans la page ; les autres sont seulement listées dans l'attribut `data-suivantes`. `public/js/fonds.js` attend que la page soit entièrement chargée, puis demande la photo suivante 8 secondes plus tard, une seule à la fois. Il ne demande **rien** si le navigateur annonce une connexion lente (`navigator.connection` : 2G, 3G, ou économie de données), si la page a mis plus de 4 secondes à charger, ou si la personne a demandé moins d'animations. Au deuxième tour, les photos sont déjà là : plus aucun téléchargement.
- **Ajouter une photo plus tard** : `npm run photos` (`scripts/optimiser-photos.mjs`, outil jSquash sous Apache-2.0, dépendance de développement seulement) réduit une photo d'origine à 1080 px en WebP de moins de 150 Ko avec son JPEG de secours. Il ne touche jamais aux fichiers déjà prêts (`-1080`, `-1920`).

### Le contenu de démonstration

`npm run demo` (`scripts/demo.js`) remplit le site : 15 membres, leurs amitiés, 16 publications avec j'aime et commentaires, des projets, 6 demandes avec propositions, une équipe éclair et 2 avis. La liste des comptes et leur mot de passe sont dans `docs/COMPTES-DEMO.md`.

- Le script passe par la **vraie API** du site : ses données respectent les mêmes règles que celles d'un membre.
- Il ne fait **rien** si les comptes existent déjà (pas de doublons), et **refuse** de tourner en production sans l'option `--forcer`.
- Tous les comptes ont un email en `@demo.palabre.dev` : `npm run demo -- retirer` les enlève d'un coup, avec tout leur contenu.
- Les images sont **dessinées par le script** : il remplit un tableau de pixels (de fausses captures d'écran) et l'enregistre au format PNG. Aucune photo de personne.

## 13. L'application installable (PWA)

- `public/manifest.json` : nom, couleurs et icônes de l'appli quand on l'ajoute à l'écran d'accueil.
- `public/sw.js` : le « service worker » garde une copie des fichiers de l'interface. Les pages s'ouvrent vite, même avec une connexion faible. Les données (`/api`) ne sont jamais mises en cache, pour toujours être à jour. À chaque modification de l'interface, on augmente `VERSION` pour forcer la mise à jour chez tout le monde.

## 13 bis. Rapide en 3G : compression, cache et pages d'erreur

Les chiffres avant / après sont dans `docs/PERFORMANCE.md` : les pages pèsent deux fois moins et s'affichent en 3 secondes au lieu de 6 à 10, en 3G simulée.

- **Compression** (`compression`, licence MIT, une ligne dans `src/app.js`) : le serveur compresse tout ce qui est du texte avant de l'envoyer. La feuille de style passe de 101 à 26 Ko. Les images, déjà compressées, ne sont pas retouchées.
- **Cache long, sans risque de vieille version** (`src/utils/statique.js`). Le souci : si on dit au navigateur « garde `style.css` un an », il ne verra jamais la nouvelle version. La solution : le serveur ajoute dans chaque page une **empreinte** du fichier, `/css/style.css?v=3f2a91c0b4` (les 10 premiers caractères du SHA-1 de son contenu). Tant que le fichier ne change pas, l'adresse ne change pas et le navigateur ne redemande rien. Dès qu'il change, l'empreinte change, donc l'adresse aussi : la nouvelle version est prise aussitôt. Les pages HTML, elles, sont toujours revérifiées : elles sont petites, et ce sont elles qui portent ces adresses.
- **Images** : logo de l'en-tête en WebP de 3 Ko au lieu d'un PNG de 50 Ko, `loading="lazy"` sur les images qui ne sont pas visibles à l'ouverture (une image cachée ou hors de l'écran n'est pas téléchargée).
- **Pages d'erreur** (`src/vues/404.html` et `500.html`) : dans le style du site. La page 500 ne contient aucun détail technique (il reste dans le journal du serveur) et presque aucun script : elle doit s'afficher même quand quelque chose ne va pas. L'API, elle, répond toujours en JSON.
- **`robots.txt`** : dit aux moteurs de recherche de visiter l'accueil, les profils et les projets, et de laisser l'API, l'administration et les pages réservées aux membres.

## 14. Les tests automatiques

Pour la base de savoir (`tests/savoir.test.js`) : le filtre par type avec « Mes amis », la page suivante, la corbeille et la confidentialité ; la meilleure réponse (qui a le droit, changer d'avis, l'enlever, la notification, le compteur du profil, le retour à « sans réponse » quand le commentaire est supprimé ou masqué, ou son auteur désactivé) ; la recherche (mots, accents, questions résolues d'abord, page suivante, corbeille, comptes bloqués ou désactivés, aucune fuite d'une publication « amis seulement »).

Pour le Griot (`tests/assistant.test.js`, sans serveur) : chaque suggestion trouve sa réponse dans les deux langues, les fautes courantes aussi, une cinquantaine de questions réalistes (dont celles qui recevaient une réponse fausse) trouvent le bon sujet, une question hors sujet ou faite de mots-outils donne « pas compris », deux sujets à égalité aussi, aucun mot-clé seul n'est dans deux sujets, un visiteur ne reçoit aucun lien réservé aux membres, les valeurs citées sont celles du code, et rien n'est envoyé au serveur.

Pour la modération : `tests/regles.test.js` (acceptation obligatoire, nouvelle version), `tests/moderation.test.js` (insultes et variantes, mots innocents, arnaque en attente puis approuvée, liens), `tests/nouveaux-comptes.test.js`, `tests/sanctions.test.js` (masquage après 3 signalements, sanctions progressives, lecture seule, contestation, journal), `tests/anti-arnaque.test.js`.

Pour la sécurité des comptes : `tests/sessions.test.js` (session révoquée refusée), `tests/deux-etapes.test.js` (alerte, « Ce n'était pas moi », code, codes de secours), `tests/mots-de-passe.test.js` (verrou par compte, mots de passe refusés), `tests/journal.test.js`, `tests/desactivation.test.js` (pause, suppression différée, annulation, ménage), `tests/corbeille.test.js` (modifier pendant 48 h, corbeille, restauration, purge).

`npm test` lance des tests qui démarrent un vrai serveur et vérifient, entre autres : inscription, refus d'un mauvais mot de passe, protection CSRF, modification de profil, identifiants réservés, confidentialité du numéro WhatsApp, envoi et remplacement de photo, refus d'un faux fichier image.

Pour le réseau social (`tests/social.test.js`) : fil réservé aux membres, chargement par 10 sans doublon, j'aime compté une seule fois, commentaires, suppression réservée à l'auteur, demandes d'amis (envoyer, accepter, refuser, demandes croisées, tricher en acceptant sa propre demande), filtre « Mes amis », signalements (en double, de son propre contenu, d'une cible inconnue).

Pour les vidéos (dans `tests/social.test.js`) : onze formats de liens acceptés, vingt-six liens refusés (autre site, `javascript:`, nom de site piégé, identifiant malformé, lien raccourci), la réponse qui ne contient que la plateforme et l'identifiant, la contrainte de la base, et la CSP.

Pour les demandes (`tests/demandes.test.js`) : publication réservée aux clients, chargement par 10, proposition en solo invisible pour les autres développeurs, invitation limitée aux amis développeurs, envoi de la proposition d'équipe seulement quand tous ont répondu, cas où tous refusent, choix du client (une seule fois, par le bon client), notifications de chaque événement et impossibilité de lire celles d'un autre.

Pour le profil prouvé (`tests/preuves.test.js`) : une vingtaine de liens piégés refusés (localhost, IP privées, écritures déguisées, autres protocoles), un faux DNS qui mène à une adresse interne, une redirection vers une adresse interne, un vrai petit site local qui répond ; avis refusés dans tous les cas interdits (demande non terminée, autre client, dev non retenu, invité qui avait refusé, deuxième avis) ; recherche de devs ; balises de partage avec un nom piégé qui ne doit pas devenir du code.

Pour l'administration (`tests/admin.test.js`) : chaque route refusée aux visiteurs (401) et aux membres ordinaires (403), impossibilité de se nommer administrateur en modifiant son profil, statistiques comparées au contenu réel de la base, les trois décisions sur un signalement et leurs effets visibles (contenu absent du fil, membre déconnecté), administrateur impossible à bloquer, contenu supprimé entre-temps, validation et refus des projets pour Facebook, puis le plan B : texte construit par le serveur, passage de `valide` à `publie`, notification du dev, refus au-delà de 5 par jour, compteur qui repart le lendemain.

Pour le calculateur (`tests/calculateur.test.js`) : cohérence de la grille (chaque type mène à une catégorie de demande qui existe), prix de base de chaque type, majorations de taille et de délai, options, un calcul complet vérifié à la main, tous les résultats possibles multiples de 5 000, refus d'un choix inconnu, page ouverte à tous avec ses balises de partage. Comme le calcul vit dans des fichiers du navigateur, ces fichiers sont écrits pour être aussi chargés par Node.js.

Pour la refonte « réseau social » (`tests/preuve-sociale.test.js`) : `nbProjetsVerifies` (un projet sans lien ou masqué ne compte pas), recherche par nom (2 lettres minimum, majuscules ignorées, jokers `%` et `_` neutralisés, jamais d'email dans la réponse), « Disponibles maintenant » (amis d'abord, ni soi-même, ni les occupés, ni les clients), fil d'un auteur, « Aimé par » (jamais soi-même, un ami avant un inconnu), les 2 derniers commentaires dans l'ordre, taille de l'image lue par le serveur, couverture (envoi, remplacement, retrait, faux fichier refusé), amis en commun, recherche sans accents (« faissal » trouve « Faïssal »), publication seule par son numéro, suggestions de devs (jamais un ami, jamais une demande en cours, compétences en commun d'abord, puis la même ville).

Pour la messagerie (`tests/messages.test.js`) : amis qui s'écrivent (avec photo, une seule conversation par paire), messages par 30, demande de message d'un inconnu (un seul message, onglet à part, une seule notification, pas de « Vu » avant acceptation), refus invisible pour l'expéditeur, blocage et déblocage, client et dev après une proposition, intrus (404 partout, y compris pour signaler), compteur de non lus et « Vu », message signalé visible seul dans `/admin`, suppression d'un seul côté, et les deux limites d'envoi.

Pour l'inscription en deux étapes (`tests/inscription.test.js`) : champ piège, envoi trop rapide, heure d'ouverture absente, falsifiée ou trop ancienne ; code juste, faux, mal écrit, expiré, cinq essais ratés, renvoi limité à un par minute et cinq par heure, code jamais en clair dans la base ; membre non confirmé refusé partout sauf sur `/api/auth` ; dev de moins de 18 ans refusé, 18 ans le jour même accepté ; liens piégés ou sur le mauvais site refusés ; dev au profil incomplet bloqué (403) pour proposer, former ou rejoindre une équipe et écrire à un client, mais libre de regarder et d'écrire à un dev ; dev complet qui passe ; client sans page 2 ; « Profil à confirmer » ; date de naissance absente de neuf réponses différentes, âge visible du seul administrateur. Ces tests remplacent l'envoi d'emails et la visite des liens par de fausses fonctions : ils ne dépendent ni d'une boîte email ni d'internet.

Pour la mise en ligne (`tests/production.test.js`) : le serveur lancé comme chez l'hébergeur refuse de démarrer avec une clé secrète absente, courte ou d'exemple, ou sans adresse https ; réponses compressées ; adresses versionnées dans toutes les pages et cache d'un an ; page 404, page 500 sans détail technique, fichiers du projet jamais servis ; `robots.txt` ; cookie sécurisé. Pour la relecture de sécurité (`tests/securite.test.js`) : un test par correction de `docs/AUDIT-SECURITE.md`.

Pour le défi de la semaine (`tests/defis.test.js`) : création réservée à l'administrateur, dates contrôlées, un seul défi à la fois ; une seule réponse par dev (la seconde la modifie), dev au profil incomplet et cliente refusés ; vote refusé avant l'heure, pour soi-même et pour une réponse inconnue ; un seul vote par membre même en changeant d'avis ; compteurs cachés pendant le vote ; à la fin, gagnant désigné une seule fois malgré quatre lectures simultanées, égalité tranchée par l'ancienneté, notification et badge ; défi sans vote sans gagnant ; suppression. Les tests « avancent l'horloge » en reculant les dates du défi dans la base.

Pour le partage (`tests/partage.test.js`) : page publique visible sans compte ; balises Open Graph et Twitter exactes, avec un texte piégé (`<script>`, `&`, guillemets) neutralisé et coupé à 160 caractères ; ni email ni numéro WhatsApp dans la page ni dans l'API ; les 3 derniers commentaires ; sans compte, impossible de lire le fil, d'aimer ou de commenter ; page 404 pour une publication inconnue, masquée ou d'un membre bloqué ; le commentaire d'un membre bloqué ne sort pas ; l'image jointe devient l'image de la carte.

Pour les listes (`tests/listes.test.js`) : les notifications arrivent par 10, de la plus récente à la plus ancienne, sans doublon ni oubli sur 23, et chacun ne voit que les siennes.

Pour la date de naissance (`tests/date-naissance.test.js`, sans serveur) : la date composée à partir des trois listes est bien `AAAA-MM-JJ`, les dates impossibles (31 février, 29 février 2001, 31 avril) donnent un message clair, les années vont de « il y a 18 ans » à 1940, et la validation du serveur accepte la date composée tout en refusant les moins de 18 ans.

Pour les emails (`tests/emails.test.js`) : le code figure dans la version texte et dans la version HTML, en gros ; l'email du code n'a aucun lien ; un prénom piégé (`<img onerror=…>`) reste du texte ; le logo est en adresse absolue ; « mot de passe oublié » utilise le même gabarit avec son lien ; le code enregistré en base est toujours haché.

Pour les notifications (`tests/notifications.test.js`) : j'aime regroupés avec la dernière personne en premier, quatre j'aime au même instant qui ne font qu'une ligne, ne plus aimer, rien pour ses propres actions, commentaires et réponses, une seule notification par conversation, tout marquer comme lu. Pour le push (`tests/push.test.js`, sans appeler aucun vrai service) : le site sans clés VAPID, l'abonnement et ses refus (adresse interne, faux domaine), le message chiffré que seul l'appareil relit, la signature VAPID vérifiée, l'aperçu de 60 caractères, les préférences respectées, l'abonnement expiré supprimé, la panne qui ne casse rien.

Pour les groupes (`tests/groupes.test.js`) : le groupe naît avec l'équipe ; accepter y fait entrer, refuser non ; seuls les membres lisent et écrivent (404 pour les autres, photos comprises) ; une seule notification par groupe ; la liste et la pastille comptent les groupes ; sourdine ; renommer réservé au chef ; le client entre quand il choisit l'équipe ; quitter avant ou après ce choix ; équipe dissoute, groupe fermé ; signalement d'un message de groupe.

Pour les actions sur les messages (`tests/messages-actions.test.js`) : une réaction par personne, changée ou retirée, six émojis seulement ; les changements arrivent par « modifies » ; une réponse ne peut citer qu'un message de la même conversation ; suppression pour tout le monde par l'auteur seul, pendant 15 minutes, avec le texte et la photo réellement effacés ; suppression pour soi ; les mêmes actions dans un groupe, refusées aux extérieurs et dans un groupe fermé.

Pour la présence (`tests/presence.test.js`) : « écrit… » vu par l'autre seulement, pendant 6 secondes, effacé à l'envoi ; rien de révélé dans une demande de message non acceptée ; l'activité notée au plus une fois par minute ; « en ligne » sous 5 minutes ; la présence absente du profil public, de la recherche et du fil ; statut masqué dans les deux sens ; « vu par » et « écrit… » dans un groupe.

Pour les messages vocaux (`tests/vocaux.test.js`) : le contrôle du fichier (type annoncé, premiers octets, taille, durée) ; l'envoi sans texte ; le son servi aux seuls membres de la conversation, entier ou par morceaux (206), jamais à un extérieur ; la suppression pour tout le monde qui efface le son ; un vocal dans un groupe.

Pour les appels (`tests/appels.test.js`) : les identifiants TURN temporaires (signature vérifiée, secret jamais envoyé) ; qui peut appeler (ami oui ; inconnu, bloqué, extérieur non) ; un appel de bout en bout (sonnerie, décrocher, messages techniques remis à leur seul destinataire, raccrocher, ligne dans la conversation) ; appel manqué après 30 secondes, refusé, ou abandonné ; « occupé » ; deux appels croisés qui n'en font qu'un ; participant disparu ; groupe en audio, quatre au plus ; 20 appels par heure. Le son lui-même ne passe pas par le serveur : il est vérifié dans le navigateur, entre deux sessions.

Les autres fichiers de tests ont besoin de comptes prêts à servir : `tests/aide.js` enveloppe leur fonction d'appel pour que chaque compte créé soit aussitôt confirmé et complet.

Les fichiers de tests démarrent en même temps et chacun met la base à jour : `migrer()` prend donc un verrou PostgreSQL (`pg_advisory_xact_lock`) pour que le second attende le premier.

### Un piège rencontré : des tests qui échouaient « parfois », au premier lancement

Symptôme : après un `git pull`, avec le serveur de développement allumé, des tests échouaient au premier `npm test`, puis passaient au suivant.

Cause : pour ajouter une colonne ou une contrainte, PostgreSQL **verrouille la table entière**, même quand il n'y a finalement rien à faire (`ADD COLUMN IF NOT EXISTS`). Le schéma était rejoué en entier à chaque démarrage : il verrouillait donc presque toutes les tables, l'une après l'autre, dans une seule transaction. Si, au même moment, le site écrivait (un autre fichier de tests déjà lancé, ou le serveur de développement), chacun pouvait attendre un verrou tenu par l'autre. PostgreSQL détecte ce blocage mutuel (« interblocage », `deadlock`) et arrête l'un des deux : soit la migration (tout le fichier de tests échoue), soit une requête du site (un test échoue au hasard). Reproduit volontairement : 132 interblocages en 25 secondes.

Correction, dans `src/db/migrate.js` :

- l'empreinte du schéma appliqué est gardée en base ; même empreinte, rien n'est rejoué et **aucune table n'est verrouillée** ;
- quand le schéma a vraiment changé, il est appliqué une seule fois, et si un interblocage survient pendant cette unique fois, la migration réessaie (jusqu'à 5 fois) ;
- `npm run migrate` applique toujours, pour le cas où la base aurait été modifiée à la main.

C'est aussi mieux pour le site en ligne : un redémarrage ne bloque plus les tables pendant que des membres écrivent.

Deux tests dépendaient en plus de ce qui se trouvait dans la base : la liste « Derniers inscrits » ne montre que 50 comptes (les autres fichiers en créent en même temps) et l'API des notifications n'en envoie plus que 10 à la fois. Ils lisent maintenant ce qu'ils vérifient directement en base, ou datent leurs comptes de « maintenant ».

## 15. Questions probables du jury

- **Vos appels passent par votre serveur ?** Non. Le son va d'un téléphone à l'autre ; le serveur met seulement en relation. Un relais (TURN) n'intervient que si le réseau interdit la liaison directe.
- **Pourquoi pas de WebSocket ?** On ne sait pas si l'hébergeur les accepte. La page interroge le serveur chaque seconde, mais seulement pendant un appel.
- **Un inconnu peut-il m'appeler ?** Non : on ne peut appeler que ceux à qui on peut écrire, et c'est la même fonction qui décide.

- **Comment marche le push, et le service de Google peut-il lire les messages ?** Non : le message est chiffré avec les clés du téléphone avant de partir (RFC 8291). Google ne fait que le transporter.
- **Pourquoi avoir écrit le push vous-mêmes ?** La bibliothèque habituelle est sous licence MPL-2.0, que le règlement ne permet pas. Les normes sont publiques ; tout tient dans un fichier, testé.
- **Dix j'aime font-ils dix notifications ?** Non : une seule, « Awa et 9 autres », tant qu'elle n'est pas lue.

- **L'animation du code ne ralentit-elle pas les petits téléphones ?** Elle n'anime que `transform` et `opacity`, que le navigateur gère sans recalculer la page : 60 images par seconde avec le processeur ralenti quatre fois. Et elle se coupe pour qui a demandé de réduire les animations.
- **Six champs pour un code, est-ce accessible ?** Chaque champ a son libellé, le code peut être collé ou proposé par le téléphone, le clavier seul suffit, et les erreurs sont annoncées aux lecteurs d'écran.

- **Vos tests échouaient parfois : qu'avez-vous fait ?** On a cherché la cause au lieu de relancer : un interblocage entre la mise à jour du schéma et les écritures du site. Le schéma n'est plus rejoué que s'il a changé.

- **Pourquoi ne pas utiliser le `<select>` du navigateur ?** Il est toujours là, caché, et c'est lui qui porte la valeur. On a seulement remplacé son apparence, pour avoir la même sur tous les téléphones et de grandes zones tactiles.
- **Votre liste maison est-elle accessible ?** Oui : clavier seul (flèches, Entrée, Échap, première lettre), rôles ARIA, focus rendu au bouton. C'est un `<dialog>` du navigateur qui gère le clavier et Échap.

- **Le défilement infini ne consomme-t-il pas trop de données ?** Non : 10 éléments à la fois, un seul chargement en cours, et en cas de panne on s'arrête sur « Réessayer » au lieu de rappeler le serveur en boucle.
- **Pourquoi `IntersectionObserver` plutôt qu'écouter le défilement ?** Écouter le défilement fait travailler la page des dizaines de fois par seconde ; ici le navigateur prévient une seule fois, quand le repère approche.

- **Pourquoi une publication est-elle lisible sans compte ?** Pour qu'un lien partagé sur WhatsApp montre quelque chose et donne envie de s'inscrire. Mais une seule route est ouverte, en lecture, limitée à 150 par 10 minutes, et elle ne contient ni email ni numéro.
- **Vous chargez les boutons de partage de Facebook ?** Non. Ce sont de simples liens : aucun script d'un réseau social n'entre dans Palabre.

- **Qu'est-ce qui empêche de voter deux fois au défi ?** La base elle-même : la clé primaire de la table des votes est le couple (défi, membre). Un second vote remplace le premier.
- **Comment le gagnant est-il désigné sans tâche programmée ?** À la première lecture du défi après la fin du vote, dans une transaction qui verrouille le défi (`FOR UPDATE SKIP LOCKED`) : il ne peut pas être désigné deux fois.
- **Pourquoi cacher le nombre de votes pendant le vote ?** Pour que chacun vote pour la réponse qu'il trouve la meilleure, pas pour celle qui est en tête.

- **Comment avez-vous pensé à la 3G ?** Compression, cache d'un an grâce à une empreinte dans l'adresse des fichiers, images légères et chargées seulement quand elles sont visibles, vidéos chargées au toucher, pas de framework. Mesuré en 3G simulée : environ 3 secondes et 200 à 260 Ko à la première visite (`docs/PERFORMANCE.md`).
- **Avez-vous relu la sécurité de votre code ?** Oui, route par route, avec cinq questions (accès, SQL, validation, limites, données privées). Huit corrections, chacune avec son test, et la liste des risques acceptés : `docs/AUDIT-SECURITE.md`.
- **Quelqu'un qui a l'adresse d'une photo envoyée en message privé peut-il la voir ?** Non : le serveur ne la sert qu'aux deux membres de la conversation.

- **Pourquoi la publication sur Facebook n'est-elle pas automatique ?** L'API de Meta exige une application validée et un jeton secret. Le site prépare donc le texte et ouvre la fenêtre de partage ; un administrateur publie en deux clics. Aucun secret Facebook n'est stocké.

- **Un membre peut-il afficher n'importe quelle page dans le fil avec un « lien vidéo » ?** Non. On n'enregistre pas son lien, seulement la plateforme et l'identifiant de la vidéo ; l'adresse du lecteur est reconstruite par le site, et la CSP n'autorise que trois lecteurs officiels.
- **Les vidéos ne ruinent-elles pas le forfait des membres ?** Rien n'est chargé tant qu'on ne touche pas la vidéo : une miniature pour YouTube, une simple carte pour TikTok et Facebook.

- **Comment empêchez-vous les robots de créer des comptes ?** Trois barrières sans captcha (qui gêne les vraies personnes et pèse lourd en 3G) : un champ piège invisible, une heure d'ouverture signée par le serveur (moins de 3 secondes = refus), et un code à 6 chiffres envoyé par email.
- **Pourquoi ne pas garder le code tel quel dans la base ?** Pour la même raison qu'un mot de passe : si la base fuit, les codes en cours ne doivent pas fuir avec elle. On garde une empreinte, et le code n'a que 5 essais et 15 minutes.
- **Que faites-vous de la date de naissance ?** Elle sert à vérifier les 18 ans, rien d'autre. Aucune route ne la renvoie ; l'administrateur ne voit que l'âge.
- **Un faux développeur peut-il répondre aux demandes ?** Pas sans avoir rempli son profil de dev. Et sans aucun lien vers son travail, son profil affiche « Profil à confirmer » : le client est prévenu.

- **Avez-vous utilisé une bibliothèque d'interface (Bootstrap, Tailwind…) ?** Non. Le style est écrit à la main avec des variables CSS ; seules les icônes viennent d'un projet libre (Lucide, licence ISC), sous la forme d'un simple fichier SVG.
- **Que se passe-t-il pour quelqu'un que les animations gênent ?** S'il a activé « réduire les animations » sur son appareil, le site n'en joue aucune.

- **D'où viennent les prix du calculateur ?** D'une grille établie par l'équipe à partir des prix pratiqués, rangée dans un seul fichier (`public/js/grille-prix.js`). Le résultat est une fourchette, présentée comme une estimation.
- **Pourquoi le calcul n'est-il pas fait par le serveur ?** Il n'y a rien de secret ni rien à protéger : le faire dans le navigateur donne une réponse immédiate, même avec une mauvaise connexion.

- **Comment devient-on administrateur ? Un membre peut-il tricher ?** Par une commande lancée sur le serveur, jamais depuis le site. Les routes d'administration vérifient le rôle à chaque appel, côté serveur.
- **Que devient un contenu masqué ou un membre bloqué ?** Il reste en base, mais toutes les requêtes du site l'écartent (`masque = FALSE`, `bloque = FALSE`). Rien n'est perdu et la décision peut être annulée.

- **Votre serveur visite des liens fournis par les membres : n'est-ce pas dangereux ?** Si, sans précaution : c'est l'attaque SSRF. Palabre refuse les adresses internes à la saisie, après la résolution DNS et à chaque redirection, et se connecte à l'adresse qu'il vient de contrôler (voir le chapitre 9).
- **Pourquoi le serveur écrit-il des balises dans la page, alors que le reste est fait en JavaScript ?** Parce que les robots de Facebook et WhatsApp n'exécutent pas le JavaScript. Sans ces balises, un lien partagé s'afficherait sans titre ni image.

- **Qu'est-ce qui empêche un développeur de copier l'offre d'un concurrent ?** Le serveur ne lui envoie que ses propres propositions. Même en appelant l'API à la main, il ne reçoit rien d'autre.
- **Pourquoi la proposition d'équipe attend-elle toutes les réponses ?** Pour que le client reçoive une équipe réelle, avec des membres qui se sont engagés, et non une liste de noms que le chef a écrite seul.
- **Que se passe-t-il si le client clique deux fois sur « Choisir » ?** La demande est verrouillée dans la transaction : le second clic trouve une demande déjà attribuée et reçoit un refus.

- **À quoi sert l'anneau autour des photos ?** C'est la preuve visible du travail : un segment par projet dont Palabre a vérifié le lien. On ne peut pas l'obtenir en le déclarant, seulement en mettant un projet en ligne.
- **Le fil affiche les j'aime et les commentaires de 10 publications : combien de requêtes ?** Une seule. Les compteurs sont des sous-requêtes, le prénom de « Aimé par » et les 2 derniers commentaires viennent de deux `LEFT JOIN LATERAL`.
- **Pourquoi le j'aime s'affiche-t-il avant la réponse du serveur ?** Pour que l'appli paraisse immédiate même en 3G. Le serveur reste le seul juge : s'il refuse, l'affichage revient en arrière.
- **Pourquoi pas de WebSocket pour la messagerie ?** Une connexion ouverte en permanence coûte de la batterie et casse souvent sur un réseau mobile. La page redemande les nouveaux messages toutes les 5 secondes, seulement quand la conversation est à l'écran : la réponse fait quelques octets. C'est plus simple, plus robuste, et suffisant.
- **Comment empêchez-vous qu'un membre soit harcelé en privé ?** Un inconnu ne peut envoyer qu'un seul message, qui attend dans un onglet à part. Le destinataire peut refuser sans que l'autre le sache, bloquer, ou signaler. Et on ne peut contacter que 10 inconnus par jour.
- **Un membre peut-il lire la conversation de deux autres en changeant le numéro dans l'adresse ?** Non. Chaque route vérifie qu'il en fait partie et répond 404 sinon, comme si la conversation n'existait pas.
- **Pourquoi le fil est-il chargé avec « avant tel numéro » plutôt qu'avec « page 2, page 3 » ?** Avec des numéros de page, une nouvelle publication décale tout et on revoit une publication déjà lue. Avec « avant le numéro X », la suite est toujours la bonne, et la base répond vite grâce à la clé primaire.
- **Comment empêchez-vous le spam et le harcèlement ?** Limites d'envoi par membre, une seule demande d'ami possible (pas de relance après un refus), bouton « Signaler » partout, et possibilité pour un administrateur de masquer un contenu ou de bloquer un compte.

- **Pourquoi pas de framework (React…) côté interface ?** Pour des pages très légères, rapides sur les téléphones modestes et en 3G, sans étape de compilation.
- **Pourquoi PostgreSQL ?** Les données de Palabre sont très reliées entre elles (membres, amis, demandes, équipes, avis) : une base relationnelle garantit leur cohérence.
- **Comment empêchez-vous les faux avis ?** Un avis n'est accepté que si le client est l'auteur de la demande, qu'elle est terminée, et que le dev faisait partie de la proposition retenue (règle vérifiée par le serveur).
- **Que se passe-t-il si quelqu'un vole la base ?** Il n'obtient ni mots de passe (empreintes bcrypt) ni liens de réinitialisation utilisables (empreintes SHA-256).
