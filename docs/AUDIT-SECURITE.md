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

## Risques connus, acceptés pour le concours

| Risque | Pourquoi il est accepté | Ce qu'on pourrait faire ensuite |
| --- | --- | --- |
| L'inscription dit « Un compte existe déjà avec cet email » : on peut savoir si une adresse est inscrite. | C'est le message que tout le monde attend ; l'inscription est limitée à 20 essais par 15 minutes et protégée contre les robots. | Répondre toujours « Regarde ta boîte email » et envoyer un email différent selon le cas. |
| La limite de connexion est par adresse IP, pas par compte : une attaque venant de milliers d'adresses n'est pas freinée. | Les mots de passe font 8 caractères au moins et bcrypt est lent. | Ralentir aussi par compte visé. |
| Se déconnecter efface le cookie mais ne détruit pas le jeton côté serveur. | Il faudrait une table des sessions ; le jeton reste dans un cookie `httpOnly`. | Table des sessions, ou durée plus courte. |
| Les images publiques d'un contenu masqué ou d'un compte bloqué restent accessibles à qui connaît leur adresse. | L'adresse est impossible à deviner et le contenu n'est plus affiché nulle part. | Vérifier le contenu parent avant de servir l'image. |
| Les limites d'envoi sont gardées en mémoire : elles repartent de zéro quand le serveur redémarre, et ne sont pas partagées entre deux serveurs. | Palabre tourne sur un seul serveur. | Les garder dans PostgreSQL ou Redis. |
| Un compte dont l'email n'est jamais confirmé reste en base. | Il ne peut rien faire sur le site. | Supprimer chaque nuit les comptes non confirmés de plus de 7 jours. |
| Un signalement peut viser un contenu déjà masqué. | Sans conséquence : l'administrateur le classe. | Refuser le signalement. |
