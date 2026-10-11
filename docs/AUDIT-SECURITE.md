# Relecture de sécurité des routes

Relecture faite le 10 octobre 2026 sur tous les fichiers de `src/routes/`, avec cinq questions pour chaque route :

1. **Contrôle d'accès** : qui a le droit d'appeler cette route, et de toucher à cette ligne précise ?
2. **Requêtes paramétrées** : aucune valeur venue d'un membre n'est-elle collée dans le SQL ?
3. **Validation** : chaque entrée passe-t-elle par `src/utils/validation.js` ?
4. **Limites d'envoi** : peut-on appeler la route en boucle ?
5. **Données privées** : email, date de naissance, numéro WhatsApp pour les non connectés.

## Ce qui a été corrigé

Chaque correction a son test dans `tests/securite.test.js`.

| N° | Problème trouvé | Gravité | Correction | Fichier |
| --- | --- | --- | --- | --- |
| 1 | **Photos des messages privés lisibles par quiconque en avait l'adresse.** `/fichiers/:id` servait toutes les images sans regarder qui demandait. L'adresse est impossible à deviner, mais un lien copié ou un historique partagé suffisait. | Moyenne | Une image jointe à un message n'est servie qu'aux deux membres de la conversation (404 pour tous les autres, et si le message a été masqué). Cache « privé ». | `src/routes/fichiers.js` |
| 2 | **Changer son mot de passe ne déconnectait personne.** Après une réinitialisation, une session ouverte avec l'ancien mot de passe restait valable 30 jours (téléphone perdu, mot de passe volé). | Moyenne | Colonne `utilisateurs.sessions_depuis` : toute session ouverte avant la réinitialisation est refusée. | `src/middleware/auth.js`, `src/routes/auth.js` |
| 3 | **Aucune limite pour les visiteurs sur l'API ouverte** (recherche de devs, vitrine, profils) : un robot pouvait tout aspirer. | Faible | 300 appels par minute et par adresse IP pour les visiteurs (les membres ne sont pas concernés). | `src/app.js` |
| 4 | **Un seul compte pouvait recopier tous les numéros WhatsApp** en lisant les profils en boucle. | Moyenne | Lecture des profils limitée à 150 par 10 minutes, par membre (par IP pour un visiteur). | `src/routes/profils.js` |
| 5 | **Le titre d'une demande masquée par un administrateur restait affiché** sous l'avis correspondant, sur le profil du dev. | Faible | Le titre n'est plus envoyé si la demande est masquée (l'avis reste). | `src/routes/avis.js` |
| 6 | **La proposition d'un compte bloqué restait visible du client et pouvait être choisie.** | Faible | Elle n'est plus montrée et ne peut plus être choisie. | `src/routes/demandes.js` |
| 7 | **Une adresse mal écrite (`/%E0`) provoquait une erreur 500** et une trace dans le journal. | Faible | Réponse 400 (API) ou page 404 (site). | `src/app.js` |
| 8 | **Les j'aime n'avaient aucune limite** (écritures en base en boucle). | Faible | 300 par 15 minutes et par membre. | `src/routes/publications.js` |

## Ce qui a été vérifié et jugé correct

| Fichier | Contrôle d'accès | Points vérifiés |
| --- | --- | --- |
| `auth.js` | Ouvert (inscription, connexion) ; session pour le code | Mots de passe hachés (bcrypt, coût 12) ; même réponse et même durée que l'email existe ou non (connexion, mot de passe oublié) ; jeton de réinitialisation haché, à usage unique, 60 minutes ; code de confirmation haché, 5 essais ; 20 tentatives par 15 minutes ; champ piège et heure d'ouverture signée. |
| `profils.js` | Lecture ouverte, modification réservée au propriétaire (`WHERE id = moi`) | Email jamais renvoyé ; WhatsApp seulement pour un membre connecté ; date de naissance absente de toutes les réponses ; `est_admin` impossible à modifier ; images vérifiées par leurs premiers octets. |
| `publications.js` | Membres connectés | Suppression réservée à l'auteur ou à un administrateur ; contenus masqués et comptes bloqués écartés par toutes les requêtes ; lien vidéo réduit à une plateforme et un identifiant. |
| `amis.js` | Membres connectés | Seul le destinataire répond à une demande ; un refus n'est pas révélé ; demandes croisées gérées par un verrou. |
| `demandes.js`, `equipes.js` | Clients pour publier et choisir, devs au profil complet pour proposer | Un dev ne reçoit jamais les propositions des concurrents ; seul le client propriétaire choisit, une seule fois (verrou) ; on n'invite que ses amis développeurs. |
| `messages.js` | Membres connectés | Une conversation dont on ne fait pas partie répond 404 partout ; un blocage n'est jamais révélé ; 30 messages par minute, 10 nouveaux contacts par jour. |
| `projets.js`, `avis.js` | Lecture ouverte, écriture réservée | Liens contrôlés contre les adresses internes (SSRF) à trois étapes ; avis réservé au client d'une demande terminée, pour le dev retenu, une seule fois. |
| `devs.js` | Ouvert | Ni email ni WhatsApp ; jokers `%` et `_` neutralisés dans la recherche ; 100 pages au plus. |
| `signalements.js` | Membres connectés | Un message ne peut être signalé que par un membre de sa conversation ; un seul signalement par membre et par contenu. |
| `notifications.js` | Membres connectés | Chaque requête porte `utilisateur_id = moi`. |
| `admin.js` | `exigerAdmin` sur tout le fichier | Le rôle ne se donne que par une commande sur le serveur ; un administrateur ne peut pas être bloqué ; noms de tables écrits dans le code, jamais reçus. |
| `pages.js` | Ouvert | Texte des membres échappé avant d'entrer dans le HTML ; adresses internes seulement pour le paramètre `suite`. |
| `fichiers.js` | Ouvert (sauf photos de messages, voir n° 1) | Identifiant au format UUID ; type de fichier fixé à l'envoi. |
| `references.js` | Ouvert | Listes fixes, aucune entrée. |

**Requêtes SQL** : toutes paramétrées. Les rares morceaux de SQL assemblés (`COLONNES_MEMBRE`, conditions de `lirePropositions`, colonnes des liens du dev, tables des signalements) viennent de constantes écrites dans le code, jamais d'une valeur envoyée par un membre.

**En-têtes** : Helmet (CSP stricte, pas de script ni de style en ligne, `X-Content-Type-Options`, HSTS en https), cookie de session `httpOnly`, `secure` en production, `SameSite=Lax`, requêtes de modification en JSON seulement.

## Ajout du 10 octobre : une publication lisible sans compte

Pour le partage, `GET /api/publications/:id` et la page `/publication/:id` répondent aux visiteurs. Ce qui a été vérifié (`tests/partage.test.js`) : c'est la seule route des publications ouverte ; elle ne renvoie ni email ni numéro WhatsApp ; une publication masquée ou d'un membre bloqué donne 404 ; le texte du membre est échappé dans les balises de partage ; la lecture est limitée à 150 par 10 minutes par adresse, pour qu'on ne puisse pas recopier le fil numéro par numéro. Les liens de partage (WhatsApp, Facebook, X) sont de simples liens : aucun script extérieur n'est chargé, la CSP n'a pas changé.

## Protection des comptes (ajout du 11 octobre)

Cette partie répond à une question simple : **que se passe-t-il si quelqu'un d'autre connaît mon mot de passe, ou essaie de le deviner ?** Six protections, chacune vérifiée par des tests.

### 1. Une session par appareil, que le serveur peut fermer

Avant, se déconnecter effaçait seulement le cookie. Maintenant chaque connexion crée une ligne dans la table `sessions` (identifiant au hasard, appareil « Chrome sur Android », dernière activité). Le jeton du cookie porte l'identifiant de cette session, et **chaque requête vérifie qu'elle existe et n'est pas révoquée** (dans la même requête SQL que le membre, donc sans ralentir).

- Se déconnecter révoque la session en base : une copie du cookie ne vaut plus rien.
- Dans Paramètres, rubrique Sécurité, « Appareils connectés » montre chaque appareil, avec « Déconnecter » pour chacun et « Déconnecter tous les autres ».
- L'adresse IP est gardée pour les alertes, mais **aucune route ne la renvoie**. L'identifiant d'une session non plus : la page reçoit une empreinte courte.
- Tests : `tests/sessions.test.js` (jeton sans session, session inventée, session d'un autre membre, déconnexion à distance).

### 2. Prévenir le propriétaire quand un appareil inconnu entre

Un appareil est « connu » s'il a déjà eu une session valide : il porte alors un cookie d'appareil signé, illisible par les scripts. La base n'en garde que l'empreinte.

- Connexion depuis un appareil inconnu : email « Nouvelle connexion à ton compte Palabre » (appareil, date et heure GMT).
- Le bouton **« Ce n'était pas moi »** de l'email : toutes les sessions sont fermées, le compte est verrouillé, et on arrive sur le choix d'un nouveau mot de passe. Le lien ne sert qu'une fois, dure 24 heures et est gardé haché.
- **Ouvrir le lien ne fait rien** : c'est le bouton de la page qui agit. Certaines messageries ouvrent les liens toutes seules pour les contrôler.

### 3. La validation en deux étapes (au choix du membre)

Quand elle est activée, le bon mot de passe ne suffit plus depuis un appareil qui n'est pas « de confiance » : un code à 6 chiffres part par email, et la session ne s'ouvre qu'avec ce code. Mêmes règles que le code d'inscription : haché, 15 minutes, 5 essais, un renvoi par minute.

- Entre le mot de passe et le code, le navigateur ne porte qu'un cookie d'attente de 15 minutes, **qui ne donne accès à rien** (testé : présenté comme cookie de session, il est refusé).
- 8 codes de secours à usage unique, gardés hachés, montrés une seule fois, pour le jour où la boîte email est inaccessible. Un faux code de secours compte dans les mêmes 5 essais.
- Le mot de passe est redemandé pour activer comme pour couper.
- Tests : `tests/deux-etapes.test.js`.

### 4. Freiner les essais de mots de passe

- **Par compte**, en plus de la limite par adresse IP : 10 mots de passe faux en 15 minutes ferment la connexion à ce compte pendant 15 minutes. Un attaquant qui change d'adresse à chaque essai est arrêté quand même.
- La réponse est **exactement celle d'un mot de passe faux**, même avec le bon mot de passe : on ne révèle ni que le compte existe, ni qu'il est verrouillé. C'est le propriétaire qui est prévenu, par email.
- Le verrou ne bloque pas « mot de passe oublié », qui rouvre le compte.
- **Mots de passe refusés** : moins de 8 caractères, ou dans notre liste maison (`src/utils/mots-de-passe.js`, plus de 500 entrées écrites par l'équipe, aucune bibliothèque), ou contenant le prénom, le nom ou l'identifiant. La comparaison ignore accents, majuscules, chiffres et signes : « Burkina2026! » reste « burkina ».
- Tests : `tests/mots-de-passe.test.js` (dont dix essais envoyés au même instant, comptés dix fois).

### 5. Un journal que le membre lit lui-même

La table `journal_securite` note les connexions, les mots de passe faux, les nouveaux appareils, les changements de mot de passe et d'email, les deux étapes, les appareils déconnectés. Le membre voit les 30 derniers événements dans Paramètres. Ni adresse IP ni texte libre ; gardé 90 jours. Tests : `tests/journal.test.js`.

### 6. Rien d'irréversible sans délai

- Supprimer son compte le désactive d'abord 30 jours ; un email permet d'annuler, se reconnecter aussi. Un intrus qui aurait pris le compte ne peut donc pas le détruire en une minute.
- Une publication supprimée reste 30 jours dans la corbeille de son auteur.
- Un texte modifié garde son ancienne version, lue par l'administrateur seulement : on ne peut pas publier une insulte, attendre un signalement, puis la maquiller.
- L'administrateur ne peut pas supprimer un compte depuis le site.

### Ce que ces protections ne font pas

| Limite | Pourquoi | Ce qu'on pourrait faire ensuite |
| --- | --- | --- |
| Le code des deux étapes part par email : si la boîte email est déjà prise, il ne protège pas. | Sans SMS ni application de codes, l'email est le seul canal sûr dont on dispose. | Codes par application (TOTP). |
| Le verrou par compte permet à un inconnu d'empêcher un membre de se connecter pendant 15 minutes, en se trompant 10 fois exprès. | C'est le prix d'un verrou par compte ; « mot de passe oublié » reste ouvert et rouvre le compte tout de suite. | Verrou progressif, ou seulement pour les appareils inconnus. |
| Le lieu d'une connexion n'est affiché que si l'hébergeur le donne dans un en-tête (`ENTETE_PAYS`, `ENTETE_VILLE`). | Aucune base « adresse IP vers ville » : ce serait une dépendance et des données à tenir à jour. | Brancher l'en-tête de l'hébergeur s'il existe. |
| « Appareil connu » repose sur un cookie : effacer ses cookies redonne une alerte. | Voulu : un navigateur sans cookie est bien un appareil qu'on ne reconnaît pas. | Rien. |
| La photo d'une publication mise à la corbeille reste accessible à qui connaît son adresse, jusqu'à la suppression définitive. | Même cas que les contenus masqués (ligne plus bas) : l'adresse est impossible à deviner. | Vérifier le contenu parent avant de servir l'image. |

## Risques connus, acceptés pour le concours

| Risque | Pourquoi il est accepté | Ce qu'on pourrait faire ensuite |
| --- | --- | --- |
| L'inscription dit « Un compte existe déjà avec cet email » : on peut savoir si une adresse est inscrite. | C'est le message que tout le monde attend ; l'inscription est limitée à 20 essais par 15 minutes et protégée contre les robots. | Répondre toujours « Regarde ta boîte email » et envoyer un email différent selon le cas. |
| Les images publiques d'un contenu masqué ou d'un compte bloqué restent accessibles à qui connaît leur adresse. | L'adresse est impossible à deviner et le contenu n'est plus affiché nulle part. | Vérifier le contenu parent avant de servir l'image. |
| Les limites d'envoi sont gardées en mémoire : elles repartent de zéro quand le serveur redémarre, et ne sont pas partagées entre deux serveurs. | Palabre tourne sur un seul serveur. | Les garder dans PostgreSQL ou Redis. |
| Un compte dont l'email n'est jamais confirmé reste en base. | Il ne peut rien faire sur le site. | Supprimer chaque nuit les comptes non confirmés de plus de 7 jours. |
| Un signalement peut viser un contenu déjà masqué. | Sans conséquence : l'administrateur le classe. | Refuser le signalement. |
