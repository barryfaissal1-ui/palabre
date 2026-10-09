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

1. `migrer()` lit `src/db/schema.sql` et crée les tables qui n'existent pas encore. Le script peut être relancé sans risque (`CREATE TABLE IF NOT EXISTS`).
2. `creerApp()` (dans `src/app.js`) construit l'application avec ses protections et ses routes.
3. Le serveur écoute sur le port indiqué par `PORT`.

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
| Collecte de numéros de téléphone | Le numéro WhatsApp n'est montré qu'aux membres connectés ; l'email n'est jamais public | `src/routes/profils.js` |

## 4. Inscription, connexion, mot de passe oublié

**Inscription** (`POST /api/auth/inscription`) : les champs sont vérifiés (`src/utils/validation.js`), le mot de passe est transformé en empreinte bcrypt, un identifiant de profil est créé à partir du nom (« Barry Faïssal » devient `barry-faissal`, ou `barry-faissal-2` s'il est déjà pris), puis la session est ouverte.

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

Seuls les projets dont le dev a coché son accord (`publier_facebook`) arrivent ici, avec le statut `en_attente`. L'administrateur les **valide** (`valide`) ou les **refuse** (`refuse`) ; le dev reçoit une notification. Un projet refusé pour Facebook reste visible sur Palabre. La publication elle-même sur la page Facebook viendra dans une étape suivante : elle ne prendra que les projets `valide`.

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
| `menuOptions(lister)` | le bouton « … » (« Plus d'options ») et son petit menu : Copier le lien, Signaler, Supprimer |
| `toast(texte, type)` | petit message qui apparaît en bas de l'écran puis disparaît (« Publié ! », ou une erreur) |
| `confirmer(question, options)` | fenêtre de confirmation ; renvoie une promesse, donc on écrit `if (await confirmer('Supprimer ?'))` |
| `etatVide(illustration, titre, texte, bouton)` | quand une liste est vide : une illustration et un mot d'encouragement |
| `chargement(zone, nombre)` | affiche des « squelettes » gris animés pendant un chargement, et renvoie la fonction qui les retire |

**Il n'y a aucun `alert()` ni `confirm()` du navigateur dans le site** : ils bloquent la page, ne suivent pas le style, et certains navigateurs les masquent. La fenêtre de confirmation utilise la balise `<dialog>` : le navigateur gère lui-même le fond assombri, la touche Échap et le maintien du focus dans la fenêtre. Le focus va d'abord sur « Annuler », pour qu'une touche Entrée trop rapide ne supprime rien.

### Le menu « … »

En haut de chaque publication, sous chaque commentaire et sur le profil d'un autre membre, un bouton « … » ouvre un petit menu : « Copier le lien » (publications et profils), « Signaler », et « Supprimer » si le contenu est à moi ou si je suis administrateur. Le menu se ferme avec la touche Échap, en touchant à côté, ou après un choix ; les flèches du clavier passent d'un choix à l'autre. Montrer « Supprimer » à un administrateur n'est qu'un confort : c'est le serveur qui vérifie le droit de supprimer.

Le lien copié d'une publication est `/fil?publication=12` : le fil n'affiche alors que celle-là (`GET /api/publications/:id`).

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

## 14. Les tests automatiques

`npm test` lance des tests qui démarrent un vrai serveur et vérifient, entre autres : inscription, refus d'un mauvais mot de passe, protection CSRF, modification de profil, identifiants réservés, confidentialité du numéro WhatsApp, envoi et remplacement de photo, refus d'un faux fichier image.

Pour le réseau social (`tests/social.test.js`) : fil réservé aux membres, chargement par 10 sans doublon, j'aime compté une seule fois, commentaires, suppression réservée à l'auteur, demandes d'amis (envoyer, accepter, refuser, demandes croisées, tricher en acceptant sa propre demande), filtre « Mes amis », signalements (en double, de son propre contenu, d'une cible inconnue).

Pour les demandes (`tests/demandes.test.js`) : publication réservée aux clients, chargement par 10, proposition en solo invisible pour les autres développeurs, invitation limitée aux amis développeurs, envoi de la proposition d'équipe seulement quand tous ont répondu, cas où tous refusent, choix du client (une seule fois, par le bon client), notifications de chaque événement et impossibilité de lire celles d'un autre.

Pour le profil prouvé (`tests/preuves.test.js`) : une vingtaine de liens piégés refusés (localhost, IP privées, écritures déguisées, autres protocoles), un faux DNS qui mène à une adresse interne, une redirection vers une adresse interne, un vrai petit site local qui répond ; avis refusés dans tous les cas interdits (demande non terminée, autre client, dev non retenu, invité qui avait refusé, deuxième avis) ; recherche de devs ; balises de partage avec un nom piégé qui ne doit pas devenir du code.

Pour l'administration (`tests/admin.test.js`) : chaque route refusée aux visiteurs (401) et aux membres ordinaires (403), impossibilité de se nommer administrateur en modifiant son profil, statistiques comparées au contenu réel de la base, les trois décisions sur un signalement et leurs effets visibles (contenu absent du fil, membre déconnecté), administrateur impossible à bloquer, contenu supprimé entre-temps, validation et refus des projets pour Facebook.

Pour le calculateur (`tests/calculateur.test.js`) : cohérence de la grille (chaque type mène à une catégorie de demande qui existe), prix de base de chaque type, majorations de taille et de délai, options, un calcul complet vérifié à la main, tous les résultats possibles multiples de 5 000, refus d'un choix inconnu, page ouverte à tous avec ses balises de partage. Comme le calcul vit dans des fichiers du navigateur, ces fichiers sont écrits pour être aussi chargés par Node.js.

Pour la refonte « réseau social » (`tests/preuve-sociale.test.js`) : `nbProjetsVerifies` (un projet sans lien ou masqué ne compte pas), recherche par nom (2 lettres minimum, majuscules ignorées, jokers `%` et `_` neutralisés, jamais d'email dans la réponse), « Disponibles maintenant » (amis d'abord, ni soi-même, ni les occupés, ni les clients), fil d'un auteur, « Aimé par » (jamais soi-même, un ami avant un inconnu), les 2 derniers commentaires dans l'ordre, taille de l'image lue par le serveur, couverture (envoi, remplacement, retrait, faux fichier refusé), amis en commun, recherche sans accents (« faissal » trouve « Faïssal »), publication seule par son numéro, suggestions de devs (jamais un ami, jamais une demande en cours, compétences en commun d'abord, puis la même ville).

Pour la messagerie (`tests/messages.test.js`) : amis qui s'écrivent (avec photo, une seule conversation par paire), messages par 30, demande de message d'un inconnu (un seul message, onglet à part, une seule notification, pas de « Vu » avant acceptation), refus invisible pour l'expéditeur, blocage et déblocage, client et dev après une proposition, intrus (404 partout, y compris pour signaler), compteur de non lus et « Vu », message signalé visible seul dans `/admin`, suppression d'un seul côté, et les deux limites d'envoi.

Les fichiers de tests démarrent en même temps et chacun met la base à jour : `migrer()` prend donc un verrou PostgreSQL (`pg_advisory_xact_lock`) pour que le second attende le premier.

## 15. Questions probables du jury

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
