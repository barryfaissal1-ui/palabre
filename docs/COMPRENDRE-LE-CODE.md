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

## 9. L'application installable (PWA)

- `public/manifest.json` : nom, couleurs et icônes de l'appli quand on l'ajoute à l'écran d'accueil.
- `public/sw.js` : le « service worker » garde une copie des fichiers de l'interface. Les pages s'ouvrent vite, même avec une connexion faible. Les données (`/api`) ne sont jamais mises en cache, pour toujours être à jour. À chaque modification de l'interface, on augmente `VERSION` pour forcer la mise à jour chez tout le monde.

## 10. Les tests automatiques

`npm test` lance des tests qui démarrent un vrai serveur et vérifient, entre autres : inscription, refus d'un mauvais mot de passe, protection CSRF, modification de profil, identifiants réservés, confidentialité du numéro WhatsApp, envoi et remplacement de photo, refus d'un faux fichier image.

Pour le réseau social (`tests/social.test.js`) : fil réservé aux membres, chargement par 10 sans doublon, j'aime compté une seule fois, commentaires, suppression réservée à l'auteur, demandes d'amis (envoyer, accepter, refuser, demandes croisées, tricher en acceptant sa propre demande), filtre « Mes amis », signalements (en double, de son propre contenu, d'une cible inconnue).

Pour les demandes (`tests/demandes.test.js`) : publication réservée aux clients, chargement par 10, proposition en solo invisible pour les autres développeurs, invitation limitée aux amis développeurs, envoi de la proposition d'équipe seulement quand tous ont répondu, cas où tous refusent, choix du client (une seule fois, par le bon client), notifications de chaque événement et impossibilité de lire celles d'un autre.

Les fichiers de tests démarrent en même temps et chacun met la base à jour : `migrer()` prend donc un verrou PostgreSQL (`pg_advisory_xact_lock`) pour que le second attende le premier.

## 11. Questions probables du jury

- **Qu'est-ce qui empêche un développeur de copier l'offre d'un concurrent ?** Le serveur ne lui envoie que ses propres propositions. Même en appelant l'API à la main, il ne reçoit rien d'autre.
- **Pourquoi la proposition d'équipe attend-elle toutes les réponses ?** Pour que le client reçoive une équipe réelle, avec des membres qui se sont engagés, et non une liste de noms que le chef a écrite seul.
- **Que se passe-t-il si le client clique deux fois sur « Choisir » ?** La demande est verrouillée dans la transaction : le second clic trouve une demande déjà attribuée et reçoit un refus.

- **Pourquoi le fil est-il chargé avec « avant tel numéro » plutôt qu'avec « page 2, page 3 » ?** Avec des numéros de page, une nouvelle publication décale tout et on revoit une publication déjà lue. Avec « avant le numéro X », la suite est toujours la bonne, et la base répond vite grâce à la clé primaire.
- **Comment empêchez-vous le spam et le harcèlement ?** Limites d'envoi par membre, une seule demande d'ami possible (pas de relance après un refus), bouton « Signaler » partout, et possibilité pour un administrateur de masquer un contenu ou de bloquer un compte.

- **Pourquoi pas de framework (React…) côté interface ?** Pour des pages très légères, rapides sur les téléphones modestes et en 3G, sans étape de compilation.
- **Pourquoi PostgreSQL ?** Les données de Palabre sont très reliées entre elles (membres, amis, demandes, équipes, avis) : une base relationnelle garantit leur cohérence.
- **Comment empêchez-vous les faux avis ?** Un avis n'est accepté que si le client est l'auteur de la demande, qu'elle est terminée, et que le dev faisait partie de la proposition retenue (règle vérifiée par le serveur).
- **Que se passe-t-il si quelqu'un vole la base ?** Il n'obtient ni mots de passe (empreintes bcrypt) ni liens de réinitialisation utilisables (empreintes SHA-256).
