# Revue du code avant la mise en ligne (12 octobre 2026)

Ce document est le **rapport** du 12 octobre, écrit sans rien modifier au site. Les corrections ont été faites le 13 octobre : leur suivi est à la fin, dans « Suivi des corrections ». Le texte de chaque problème est resté tel qu'il a été écrit (les numéros de ligne sont ceux d'avant les corrections).

## À retenir

- **1 problème grave** : les comptes de démonstration ont un mot de passe public, et rien n'empêche un inconnu de le changer avant le passage du jury (S1).
- **7 problèmes moyens**, dont quatre se corrigent en quelques lignes : la redirection après connexion (S2), les membres déconnectés quand la base a un raté (E1), un index manquant (B1), les limites comptées par adresse IP (P1).
- **27 petits problèmes**, sans danger immédiat.
- Les points les plus surveillés sont bons : aucune route n'oublie de vérifier qui demande, l'email, la date de naissance et l'adresse IP ne sortent nulle part, aucun texte de membre n'est inséré comme du code.

## Ce qui a été relu, et comment

| Lecture | Fichiers |
| --- | --- |
| **En entier, ligne par ligne** | `server.js`, tout `src/` (routes, outils, `middleware`, `db`), `src/db/schema.sql`. Dans `public/js` : `app.js`, `publication.js`, `fil.js`, `messages.js`, `formulaires.js`, `parametres.js`, `demande.js`, `demandes.js`, `profil.js`, `appels.js`, `push.js`, `admin.js`, `defis.js`, `notifications.js`, `bienvenue.js`, `pas-moi.js`, `bon-retour.js`, `sanctions.js`, `page-publication.js`, `theme.js`, et `public/sw.js`. |
| **En partie** (le démarrage de la page, puis une recherche par motifs dans tout le fichier) | `modifier-profil.js`, `amis.js`, `recherche.js`, `chercher.js`, `vitrine.js`, `projet.js`, `projets.js`, `calculateur.js`, `confirmer-email.js`, `acces.js`. Dans `scripts/demo.js` : seulement le mot de passe et les options de production. |
| **Pas relu cette fois** | `assistant.js` et `assistant-recherche.js` (relus et testés lors des deux tâches précédentes), `calcul-prix.js`, `grille-prix.js`, `date-naissance.js`, `fonds.js`, les listes de mots de `moderation-listes.js` et de `mots-de-passe.js`, `scripts/optimiser-photos.mjs`, les deux dictionnaires `public/langues/`. |

Les fichiers « en partie » et « pas relus » peuvent donc cacher des problèmes que ce rapport ne voit pas.

Tout ce qui suit a été lu dans le code. Deux points ont en plus été essayés avec Node : la redirection S2, et la casse des noms de fichiers (voir la partie 6). Les tests du projet n'ont pas été relancés, puisque rien n'a changé.

Gravité : **GRAVE** = à corriger avant la mise en ligne ; **MOYEN** = gênant, à corriger vite ; **PETIT** = sans urgence.

---

## 1. Erreurs de logique

### L1. PETIT. Supprimer le compte d'un chef d'équipe peut effacer la discussion de toute l'équipe
- **Où** : `src/utils/purge.js:43-72`, `src/db/schema.sql:351`.
- **Ce qui ne va pas** : `conversations.cree_par` est en `ON DELETE CASCADE`. Le ménage ne rattache `cree_par` au compte « Membre parti » que si le membre a écrit au moins un vrai message (`aEcrit`). Un chef qui n'a jamais écrit dans le groupe (il n'a que le message système « a créé l'équipe ») est supprimé sans ce rattachement : la base supprime alors le groupe et tous les messages de ses coéquipiers. La ligne 69 voulait seulement fermer le groupe.
- **Exemple** : Awa crée une équipe, ses trois amis discutent dans le groupe, elle ne répond jamais. Elle supprime son compte. Trente jours plus tard, la discussion des trois autres disparaît.
- **Délai** : la suppression n'a lieu que 30 jours après la demande, donc pas avant la fin du concours.
- **Correction** : rattacher `cree_par` à « Membre parti » (ou passer la clé en `ON DELETE SET NULL`) pour tous les groupes, avant le `DELETE`, même quand `aEcrit` est faux.

### L2. PETIT. Le groupe d'une équipe reste ouvert quand le client supprime son compte
- **Où** : `src/utils/purge.js:68-69`, `src/routes/groupes.js:274-276`.
- **Ce qui ne va pas** : le ménage ferme les groupes des équipes dont le membre est le **chef**, pas ceux des équipes qui répondaient à **ses demandes**. Ses demandes partent en cascade, les équipes aussi, et le groupe perd son lien (`equipe_id` vide) sans être fermé. Le chef ne peut plus le quitter : la route lui répond « dissous l'équipe depuis la page de la demande », page qui n'existe plus.
- **Correction** : dans `supprimerDefinitivement()`, fermer aussi les groupes des équipes liées aux demandes du client ; dans `/quitter`, laisser partir le chef quand `equipe_id` est vide.

### L3. PETIT. Un membre désactivé ne peut plus être débloqué
- **Où** : `src/utils/membres.js:10-12` (l'identifiant devient `membre-indisponible`), utilisé par `public/js/parametres.js:465`, `public/js/messages.js:856`, `public/js/admin.js:322` ; côté serveur `src/routes/messages.js:110-115` et `src/routes/admin.js:392-398`.
- **Ce qui ne va pas** : pour un compte désactivé, `apercuMembre()` remplace l'identifiant par `membre-indisponible`. Toute page qui s'en sert ensuite pour agir appelle une adresse qui n'existe pas.
- **Exemple** : Kofi bloque Awa, puis Awa désactive son compte. Dans Paramètres, « Membres bloqués », le bouton « Débloquer » répond « Ce membre n'existe pas ». Même chose dans `/admin` pour un membre bloqué par l'équipe puis désactivé.
- **Correction** : pour ces deux listes, envoyer une clé qui ne dépend pas de l'identifiant public (par exemple un numéro de blocage), et ne pas exiger un compte actif pour débloquer.

### L4. PETIT. « d'Yao », « d'Youssouf » dans les notifications
- **Où** : `src/utils/notifications.js:151-153`.
- **Ce qui ne va pas** : la fonction `deNom()` du serveur met une apostrophe devant tout nom qui commence par « y ». Celle du navigateur (`public/js/app.js:405`) fait bien la différence, pas celle du serveur.
- **Exemple** : le push « Nouveau message d'Yao », la notification « L'équipe d'Youssouf Traoré a envoyé une proposition ».
- **Correction** : reprendre dans le serveur la règle de `app.js` (« y » suivi d'une voyelle = « de »).

### L5. PETIT. Au-delà de 200 commentaires, les plus récents ne s'affichent plus
- **Où** : `src/routes/publications.js:436-448`.
- **Ce qui ne va pas** : la liste est triée du plus ancien au plus récent et coupée à 200. Le 201e commentaire est compté mais jamais montré ; celui qui vient de l'écrire le voit, puis le perd en rechargeant.
- **Correction** : garder les 200 **derniers** (tri décroissant puis remise en ordre), ou paginer.

### L6. PETIT. Une liste d'amis cachée s'affiche comme « pas encore d'amis »
- **Où** : `public/js/profil.js:267-295` ; le serveur envoie pourtant `amisVisibles` (`src/routes/profils.js:76`) et `cachee: true` (`:122`).
- **Ce qui ne va pas** : la page ne lit aucune de ces deux informations. Pour un membre qui a réglé « Qui peut voir ma liste d'amis : moi », l'onglet Amis dit qu'il n'a pas d'amis, alors que le haut du profil affiche « 12 amis ».
- **Correction** : ne pas montrer l'onglet quand `amisVisibles` est faux, ou afficher « Cette liste est privée ».

**Dates et fuseaux horaires : rien trouvé.** Les échéances (48 heures, 30 jours, phases du défi, 5 publications Facebook par jour) sont calculées par la base ou en heure GMT, jamais avec l'heure du navigateur. Les dates du défi sont converties en heure universelle avant l'envoi (`public/js/admin.js:356`).

---

## 2. Sécurité

### S1. GRAVE. N'importe qui peut prendre les comptes de démonstration du jury
- **Où** : `scripts/demo.js:29` (mot de passe `Palabre-Jury-2026`), `docs/COMPTES-DEMO.md:5` (écrit dans le dépôt public), `src/routes/parametres.js:171`, `:215`, `:350`, `:360`, `src/utils/nouveaux-comptes.js:25`.
- **Ce qui ne va pas** : le mot de passe est public, et le serveur traite ces comptes comme des comptes normaux. Rien n'interdit de changer leur mot de passe, d'allumer la validation en deux étapes, de les désactiver ou de les supprimer. Ils sont de plus dispensés des limites des nouveaux comptes (liens, 5 publications par jour).
- **Exemple** : la veille du passage du jury, un concurrent ouvre `dev@demo.palabre.dev` avec le mot de passe du dépôt, allume la validation en deux étapes, et part. Le jury ne peut plus entrer. Ou bien il publie des liens de publicité au nom de « Awa », sans aucune limite. Avec `--admin`, il aurait aussi le tableau de bord.
- **Correction** : au choix. Soit refuser, pour les comptes `@demo.palabre.dev`, les routes qui changent le mot de passe, l'email, les deux étapes, la désactivation et la suppression. Soit créer les comptes en production avec un mot de passe lu dans une variable d'environnement, donné au jury en privé et absent du dépôt. La seconde solution règle aussi le problème des publications.

### S2. MOYEN. Le lien « suite » peut envoyer vers un autre site après la connexion
- **Où** : `public/js/formulaires.js:7-10`, `public/js/bienvenue.js:6-9`, `public/js/confirmer-email.js:26-29`.
- **Ce qui ne va pas** : le contrôle refuse `//autre-site` mais pas `/` suivi d'une tabulation ou d'un saut de ligne. Le navigateur retire ces caractères avant de lire l'adresse : `/%09/evil.example` devient `//evil.example`, donc un autre site. Vérifié avec Node : le contrôle répond « accepté » et l'adresse obtenue est `https://evil.example/`.
- **Exemple** : quelqu'un partage sur WhatsApp `palabre.dev/connexion?suite=/%09/faux-palabre.example`. La personne se connecte vraiment sur Palabre, puis arrive sur une copie du site qui lui redemande son mot de passe.
- **Correction** : dans les trois fichiers, construire `new URL(suite, location.origin)` et n'accepter que si `origin` est celui du site (ou refuser tout caractère de contrôle). Trois lignes à changer ; une seule fonction partagée dans `app.js` éviterait les trois copies.

### S3. MOYEN. Une photo privée reste lisible sur le téléphone après la déconnexion
- **Où** : `src/routes/fichiers.js:43`, `public/sw.js:107-114`.
- **Ce qui ne va pas** : la photo (ou le vocal) d'un message est servie avec `Cache-Control: private, max-age=1 an, immutable`. Le navigateur la garde un an sans jamais redemander au serveur, qui ne peut donc plus vérifier le droit de la voir. Le service worker la range en plus dans son propre cache (il garde tout ce qui n'est pas `/api/`).
- **Exemple** : dans un cybercafé, Mariam ouvre une photo reçue (elle s'ouvre dans un onglet), puis se déconnecte. La personne suivante retrouve l'adresse dans l'historique et voit la photo, sans compte.
- **Correction** : pour les pièces des messages, répondre `Cache-Control: private, no-cache` (le navigateur revérifie à chaque fois), et ne pas mettre `/fichiers/` dans le cache du service worker.

### S4. MOYEN. Les notifications push continuent après une déconnexion
- **Où** : `public/js/app.js:1261-1265` ; `push.js` n'est chargé que par `fil.html` et `parametres.html` ; côté serveur `src/routes/auth.js:315-340` (« Ce n'était pas moi »), `:427-465` (nouveau mot de passe), `src/routes/parametres.js:168`, `:190`, `:201`.
- **Ce qui ne va pas** : deux choses. (1) `seDeconnecter()` ne coupe le push que si `push.js` est chargé, donc seulement depuis le fil et les paramètres ; depuis toute autre page, l'abonnement reste. (2) Aucune des routes qui ferment des sessions ne supprime les lignes de `abonnements_push`.
- **Exemple** : un intrus entre dans le compte de Kofi et active les notifications. Kofi clique « Ce n'était pas moi » et change son mot de passe : l'intrus est déconnecté, mais son téléphone reçoit toujours « Nouveau message d'Awa » avec les 60 premiers caractères de chaque message.
- **Correction** : supprimer les abonnements push du membre dans les routes qui révoquent toutes ses sessions, et déplacer la coupure du push de `push.js` vers `app.js` pour qu'elle marche depuis toutes les pages.

### S5. PETIT. « Mot de passe oublié » laisse deviner si un email est inscrit
- **Où** : `src/routes/auth.js:408-424`.
- **Ce qui ne va pas** : le commentaire promet « toujours la même réponse ». Mais l'email n'est envoyé (et attendu) que si le compte existe : la réponse est plus lente dans ce cas, et si l'envoi échoue, le serveur répond « erreur 500 » seulement pour un email inscrit.
- **Correction** : envoyer l'email sans l'attendre, avec un `catch` qui écrit dans le journal du serveur.

### S6. PETIT. Le prénom d'un compte désactivé sort encore par trois endroits de la messagerie
- **Où** : `src/utils/messages.js:24` (qui a réagi), `:36` (prénom dans une citation), `src/utils/presence.js:39-46` (« écrit… »).
- **Ce qui ne va pas** : partout ailleurs le compte désactivé s'appelle « Membre indisponible ». Ces trois requêtes lisent directement `nom` ou `prenom`.
- **Correction** : y ajouter la condition `desactive_le IS NULL`, ou rendre le texte « Membre indisponible ».

### S7. PETIT. Trois listes n'écartent pas un compte bloqué ou supprimé
- **Où** : `src/routes/demandes.js:75-82` (membres d'une équipe : un compte bloqué garde son nom et sa photo), `src/routes/amis.js:18-27` (on peut envoyer une demande d'ami à un compte « Membre parti »), `src/routes/admin.js:37-38` et `:368-375` (les comptes « Membre parti » sont comptés parmi les développeurs et les clients, et listés dans « Derniers inscrits »).
- **Correction** : ajouter `u.bloque = FALSE` dans la première, `supprime_le IS NULL` dans les autres.

### S8. PETIT. Un compte d'une heure peut publier des liens dans une demande ou un projet
- **Où** : `src/routes/demandes.js:183-205`, `src/routes/projets.js:92-104`, `src/routes/defis.js:157-161`.
- **Ce qui ne va pas** : `refuserLesLiens()` (pas de lien pendant 3 jours) n'est appelé que pour les publications, les commentaires et la présentation. Les liens dangereux restent refusés par le filtre, mais pas la simple publicité.
- **Exemple** : un compte client créé à l'instant publie 20 demandes par heure avec le lien de sa boutique dans la description.
- **Correction** : appeler `refuserLesLiens()` sur le titre et la description des demandes et des projets, et sur le texte d'une réponse au défi.

**Rien trouvé sur les points suivants :**
- **Droits** : chaque route qui modifie ou montre quelque chose vérifie le propriétaire, le membre de la conversation ou du groupe, ou le rôle administrateur. Les conversations privées, les groupes, les appels, les réactions, la corbeille, les sessions et les sanctions ont été suivis un par un.
- **Données privées** : l'email, la date de naissance et l'adresse IP ne sortent par aucune route (l'âge seulement, pour l'administrateur). Le numéro WhatsApp n'est jamais envoyé à un visiteur. Les publications « amis seulement » suivent la même condition dans le fil, le profil, la recherche, la page publique et les balises de partage.
- **Texte des membres** : aucun `innerHTML` avec une valeur ; les pages préparées par le serveur et les emails échappent tout.
- **Liens des emails** : `/pas-moi`, `/annuler-suppression` et `/sanctions?jeton=` n'agissent que par un bouton.

---

## 3. Actions faites en même temps

### C1. PETIT. Deux inscriptions au même instant donnent « Une erreur est survenue »
- **Où** : `src/routes/auth.js:132-148`.
- **Ce qui ne va pas** : l'email est vérifié, puis le compte est créé un peu plus tard (après le calcul du mot de passe). Deux envois très proches passent tous les deux la vérification ; le second bute sur la contrainte d'unicité, qui n'est pas rattrapée. Même chose pour deux personnes du même nom qui reçoivent le même identifiant.
- **Exemple** : le formulaire ouvert dans deux onglets. Le compte est bien créé, mais le second onglet affiche une erreur.
- **Correction** : rattraper l'erreur `23505` et répondre « Un compte existe déjà avec cet email » (ou réessayer avec un autre identifiant).

### C2. PETIT. Un contenu retenu par le filtre est visible un court instant
- **Où** : `src/routes/publications.js:461-472` (commentaire), `src/routes/demandes.js:194-202` (demande).
- **Ce qui ne va pas** : le contenu est enregistré, puis caché dans une **seconde** transaction. Entre les deux il est visible ; et si la seconde échoue, il le reste. Les publications et les projets font bien les deux dans la même transaction.
- **Correction** : faire l'insertion et `mettreEnAttente()` dans la même transaction, comme pour les publications.

### C3. PETIT. Pendant un appel sur un réseau lent, les mêmes signaux sont traités deux fois
- **Où** : `public/js/appels.js:293-327` et `:350`.
- **Ce qui ne va pas** : `tour()` est lancé chaque seconde par `setInterval`, sans vérifier que le tour précédent est fini. Si une réponse met plus d'une seconde (3G), deux tours partent avec le même numéro `apres` et reçoivent les mêmes messages techniques. Les erreurs sont avalées par un `catch`, donc l'effet exact dépend du navigateur.
- **Correction** : un drapeau « tour en cours » qui fait sauter le tour suivant.

**Ce qui est bien protégé** : j'aime (clé primaire), demandes d'ami croisées (index unique sur la paire), choix du client (`FOR UPDATE`), réponses aux invitations d'équipe, vote et gagnant du défi (`SKIP LOCKED`), code de confirmation (compteur verrouillé), notifications regroupées (verrou), appels croisés (verrou par conversation), publications Facebook du jour (verrou), première conversation entre deux membres (`ON CONFLICT`).

---

## 4. Erreurs non rattrapées

### E1. MOYEN. Un raté de la base de données déconnecte les membres
- **Où** : `src/middleware/auth.js:51-72`.
- **Ce qui ne va pas** : le `try` contient à la fois la vérification du jeton et la requête SQL. Le `catch` efface le cookie de session dans les deux cas. Une panne passagère de la base (redémarrage, toutes les connexions occupées) est donc traitée comme un jeton faux.
- **Exemple** : la base de Systalink redémarre pendant dix secondes. Tous les membres qui font une requête à ce moment-là perdent leur session et doivent se reconnecter.
- **Correction** : n'effacer le cookie que si `jwt.verify` échoue ; pour une erreur SQL, appeler `next(err)` (réponse 500, session gardée).

### E2. PETIT. Une requête ratée renvoie un membre connecté vers la page de connexion
- **Où** : `public/js/app.js:118-123`, puis `fil.js:245-250`, `messages.js:1307-1312`, `demandes.js:173-179`, `parametres.js:524-529` et les autres pages de membre.
- **Ce qui ne va pas** : `utilisateurConnecte()` rend `null` pour toute erreur de `/api/auth/moi` (pas de réseau, délai dépassé, erreur 500). Les pages lisent `null` comme « visiteur » et redirigent vers `/connexion`.
- **Exemple** : en 3G, la requête échoue ; le membre, toujours connecté, se retrouve devant le formulaire de connexion.
- **Correction** : distinguer « pas connecté » (réponse reçue, `utilisateur: null`) de « pas de réponse » (afficher « Réessayer », sans rediriger).

### E3. PETIT. Trois pages restent vides si leur première requête échoue
- **Où** : `public/js/demandes.js:180`, `public/js/modifier-profil.js:209-221`, `public/js/projets.js:142`.
- **Ce qui ne va pas** : ces `await api(…)` sont au démarrage de la page, sans `try`. En cas d'échec, la suite ne s'exécute pas : ni liste, ni formulaire, ni message d'erreur (sur « Modifier mon profil », les squelettes de chargement restent pour toujours).
- **Correction** : les entourer d'un `try` qui affiche `etatVide(…)` avec le message de l'erreur, comme le font les autres pages.

### E4. PETIT. Aucun délai maximum pour l'email et pour la base
- **Où** : `src/utils/mailer.js:8-13`, `src/db/pool.js:5-9`.
- **Ce qui ne va pas** : sans réglage, la bibliothèque d'email attend jusqu'à 2 minutes un serveur qui ne répond pas, et le réservoir de connexions à la base attend sans limite. L'inscription et la connexion en deux étapes attendent l'email avant de répondre.
- **Exemple** : le serveur d'email de Systalink est lent : le bouton « Créer mon compte » tourne deux minutes.
- **Correction** : `connectionTimeout`, `greetingTimeout` et `socketTimeout` d'une dizaine de secondes pour l'email ; `connectionTimeoutMillis` pour la base.

**Côté serveur, aucune promesse perdue trouvée** : les envois qui ne sont pas attendus (push, « vu le », ménage) ont tous leur `catch`, et Express 5 rattrape les erreurs des routes `async`. Il n'y a pas de filet `unhandledRejection` dans `server.js`, mais rien dans le code relu n'en a besoin.

---

## 5. Base de données

### B1. MOYEN. Chaque image servie parcourt toute la table des messages
- **Où** : `src/routes/fichiers.js:13-19` ; index manquant dans `src/db/schema.sql` (les index de `messages` sont lignes 454 et 539).
- **Ce qui ne va pas** : pour savoir si une image est privée, la route fait `LEFT JOIN messages m ON m.fichier_id = f.id`. Il n'y a pas d'index sur `messages.fichier_id` : PostgreSQL lit donc toute la table `messages` pour chaque avatar et chaque photo de publication demandés.
- **Exemple** : une page du fil charge une quinzaine d'images ; avec 50 000 messages en base, cela fait quinze lectures complètes de la table.
- **Correction** : `CREATE INDEX IF NOT EXISTS idx_messages_fichier ON messages (fichier_id) WHERE fichier_id IS NOT NULL;`

### B2. PETIT. Les notifications ne sont jamais nettoyées, et leur liste n'a pas le bon index
- **Où** : `src/routes/notifications.js:21-29`, `src/db/schema.sql:545`, `src/utils/purge.js` (rien sur `notifications`), `src/routes/publications.js:546-548`.
- **Ce qui ne va pas** : la liste est triée par `id`, mais l'index est `(utilisateur_id, lue, cree_le)` : la base trie toutes les notifications du membre à chaque page. Rien ne supprime les vieilles notifications. Et la suppression de la notification « meilleure réponse » ne filtre pas sur le membre : elle parcourt toutes les notifications non lues du site.
- **Correction** : un index `(utilisateur_id, id DESC)`, une ligne dans le ménage (par exemple les notifications lues de plus de 6 mois), et `utilisateur_id` dans la suppression.

### B3. PETIT. Chaque lecture du défi ouvre une transaction, même quand il n'y a rien à faire
- **Où** : `src/routes/defis.js:29-59`, appelé par `defiCourant()` (`:83-87`).
- **Ce qui ne va pas** : `/api/defis/resume` est demandé par presque toutes les pages (encadré de droite, carte du fil). À chaque fois : ouverture d'une transaction, lecture verrouillée, fermeture. `appels.entretenir()` montre la bonne façon : une lecture simple d'abord.
- **Correction** : commencer par `SELECT 1 FROM defis WHERE statut = 'ouvert' AND fin_vote_le <= now() LIMIT 1` et n'ouvrir la transaction que s'il y a une ligne.

### B4. PETIT. Supprimer le compte de l'administrateur supprime tous les défis qu'il a créés
- **Où** : `src/db/schema.sql:227` (`defis.auteur_id … ON DELETE CASCADE`).
- **Exemple** : Barry crée les défis, puis supprime un jour son compte : les défis, leurs réponses et leurs votes partent, et les badges « Gagnant du défi » avec eux.
- **Correction** : `ON DELETE SET NULL` (et la colonne sans `NOT NULL`).

**Requêtes dans une boucle : rien trouvé.** Le fil, les conversations, les groupes, les propositions et la recherche font tout en une requête (sous-requêtes et `LATERAL`). Les seules boucles sont bornées : prévenir les membres d'un groupe (quelques personnes), les 10 derniers commentateurs.

---

## 6. Mise en ligne sur Systalink

### P1. MOYEN. Les limites par adresse IP peuvent bloquer des personnes qui partagent la même adresse
- **Où** : `src/routes/auth.js:34-40` (`limiteSensible`), `src/routes/profils.js:30-36` (`limiteEnvoiImages`), `src/app.js:86-93`.
- **Ce qui ne va pas** : `limiteSensible` permet 20 essais par quart d'heure et par adresse IP, pour l'inscription, la connexion, le mot de passe oublié et trois autres routes **ensemble**, réussites comprises. Or beaucoup d'abonnés d'un opérateur mobile sortent par la même adresse IP (`CLAUDE.md` le rappelle pour les limites par membre).
- **Exemple** : le jour où le lien circule sur Facebook, vingt personnes du même opérateur s'inscrivent ou se connectent en un quart d'heure. La vingt et unième lit « Trop de tentatives. Réessaie dans quelques minutes. »
- **Correction** : ne compter que les échecs pour la connexion (`skipSuccessfulRequests`), donner à l'inscription sa propre limite plus large, et compter les envois d'images par membre.

### P2. MOYEN, à vérifier le jour de la mise en ligne. Le réglage `trust proxy`
- **Où** : `src/app.js:19`. Déjà noté dans `docs/DEPLOIEMENT-SYSTALINK.md` (ligne 164).
- **Ce qui ne va pas** : le code suppose **un** relais devant le serveur. S'il y en a deux chez Systalink, tous les visiteurs auront la même adresse IP aux yeux du site, et la limite P1 vaudra pour tout le monde à la fois. S'il n'y en a aucun, un visiteur pourra écrire lui-même son adresse et contourner les limites.
- **Correction** : après le premier déploiement, regarder l'adresse que le serveur voit (elle est enregistrée dans `sessions.ip`) et la comparer à la vraie ; régler le nombre de relais en conséquence.

### P3. PETIT. La liaison chiffrée avec la base ne vérifie pas le certificat
- **Où** : `src/db/pool.js:7` (`rejectUnauthorized: false`).
- **Ce qui ne va pas** : avec `DATABASE_SSL=true`, la liaison est chiffrée mais le serveur de base de données n'est pas authentifié. Sans gravité si la base est sur le réseau interne de Systalink.
- **Correction** : si Systalink fournit son certificat, le donner à `ssl.ca` et retirer cette option.

### P4. PETIT, à vérifier. La recherche sans accents dépend du réglage de la base
- **Où** : `src/routes/publications.js:238-240`.
- **Ce qui ne va pas** : la recherche met le texte en minuscules avec `lower()`, puis retire les accents des minuscules. Si la base est créée avec la locale « C », `lower()` ne touche pas aux majuscules accentuées : chercher « election » ne trouvera pas une publication qui commence par « Élection ».
- **Correction** : après la mise en ligne, essayer `SELECT lower('ÉTÉ')` ; si la réponse n'est pas « été », ajouter les majuscules accentuées à la liste de `translate()`.

### P5. PETIT. Le cache du service worker grossit sans limite
- **Où** : `public/sw.js:107-119`.
- **Ce qui ne va pas** : toute réponse hors `/api/` est gardée (chaque profil visité, chaque image), et le cache n'est vidé que quand `VERSION` change. Après la mise en ligne, `VERSION` ne changera plus. Autre détail : pour une image introuvable hors connexion, le secours rend la page d'accueil.
- **Correction** : ne garder que les fichiers de l'interface (pages, `/css/`, `/js/`, `/icons/`, `/fonts/`), et réserver le secours `/` aux demandes de page.

**Vérifié, sans problème :**
- **Noms de fichiers** : Linux distingue majuscules et minuscules, pas Windows. Un script a comparé tous les `require('./…')` et toutes les adresses `/css`, `/js`, `/icons`, `/img`, `/fonts`, `/langues` aux fichiers réels : tout correspond exactement.
- **Fuseau du serveur** : sans effet (voir la partie 1).
- **PostgreSQL 17** : les fonctions utilisées (`gen_random_uuid`, `make_interval`, `num_nonnulls`, tables `UNLOGGED`, verrous) existent toutes ; aucune extension n'est nécessaire.
- **Configuration** : le serveur refuse de démarrer en production sans `JWT_SECRET` solide, sans `URL_PUBLIQUE` en https ou sans `DATABASE_URL` ; `.env` n'est pas dans le dépôt ; les cookies sont `secure` en production.

---

## 7. Règles de CLAUDE.md non respectées

### R1. PETIT. Quelques textes écrits en dur, non traduits
- `public/js/messages.js:847` : `'Vu'` sous le dernier message lu (reste « Vu » en anglais).
- `public/js/messages.js:125` : `'x1,5'` (la virgule française pour la vitesse d'un vocal).
- `public/js/admin.js:107` : `', par '`.
- `public/sw.js:131` et `:140` : « Tu as une nouvelle notification. », « Décrocher », « Refuser » (les boutons de la notification d'un appel).
- **Correction** : une clé par texte dans `fr.js` et `en.js`. Pour `sw.js`, qui ne lit pas les dictionnaires, envoyer les libellés dans le message push.

### R2. PETIT. Le pays n'est pas traduit dans six affichages
- **Où** : `public/js/admin.js:318`, `amis.js:33`, `defis.js:118`, `demande.js:68`, `profil.js:285`, `projet.js:8` écrivent `[ville, pays].join(', ')`.
- **Exemple** : en anglais, « Abidjan, Côte d'Ivoire » au lieu de « Abidjan, Ivory Coast ».
- **Correction** : `lieuDe(membre)`, comme ailleurs.

### R3. PETIT. Quatre décisions d'administrateur ne sont pas écrites dans le journal de modération
- **Où** : suppression d'une publication (`src/routes/publications.js:371-396`), d'un commentaire (`:529-543`), d'un projet (`src/routes/projets.js:145-154`), et déblocage d'un membre (`src/routes/admin.js:392-399`).
- **Correction** : un appel à `journalModeration()` dans chacune, dans la même transaction.

### R4. PETIT. Le type `appel_manque` manque dans la page des notifications
- **Où** : `public/js/notifications.js:7-29`. Le serveur crée ce type (`src/routes/appels.js:76`).
- **Ce qui ne va pas** : la ligne s'affiche avec la cloche par défaut, au lieu de l'icône du téléphone.
- **Correction** : `appel_manque: ['telephone', 'terre']` dans `TYPES`.

### R5. PETIT. Deux écarts mineurs
- `src/routes/parametres.js:171-181` : le changement de mot de passe, la fermeture des autres sessions et la ligne du journal ne sont pas dans une même transaction (la règle demande `journaliser()` dans la transaction de l'action).
- `public/js/formulaires.js:105` : `select.innerHTML = ''` pour vider une liste. Sans danger (aucune donnée), mais la règle dit « jamais ». `select.replaceChildren()` fait la même chose.

**Rien trouvé sur le reste** : aucun `alert`, `confirm` ou `prompt` ; aucun script ni style en ligne dans les pages ; `theme.js` est chargé avant la feuille de style partout ; aucun `@media (prefers-color-scheme)` dans le CSS ; les tailles de texte suivent l'échelle (les seules valeurs en dur sont les champs en 16 px, exception voulue) ; pas de libellé en majuscules espacées ; `logo-256.png` n'est utilisé nulle part ; les listes longues passent par `chargementInfini()` et le partage par `partager()`.

---

## Résumé

| Gravité | Nombre | Lesquels |
| --- | --- | --- |
| **GRAVE** | 1 | S1 |
| **MOYEN** | 7 | S2, S3, S4, E1, B1, P1, P2 |
| **PETIT** | 27 | L1 à L6, S5 à S8, C1 à C3, E2 à E4, B2 à B4, P3 à P5, R1 à R5 |
| **Total** | **35** | |

Par catégorie : logique 6, sécurité 8, actions en même temps 3, erreurs non rattrapées 4, base de données 4, mise en ligne 5, règles de CLAUDE.md 5.

**Ordre conseillé avant le 20 octobre** : S1 (comptes de démonstration), puis les corrections courtes S2, E1, B1 et P1, puis S3 et S4. P2 ne peut se vérifier qu'une fois le site en ligne.

---

## Suivi des corrections (13 octobre 2026)

31 problèmes corrigés, 1 en partie, 3 qui ne peuvent se régler qu'une fois le site en ligne. Les tests passent tous (365), dont `tests/revue.test.js`, écrit pour ces corrections.

| | État | Ce qui a été fait |
| --- | --- | --- |
| **S1** | Corrigé | `refuserCompteDemo` (`src/routes/parametres.js`) : un compte `@demo.palabre.dev` ne peut plus changer son mot de passe, son email, son identifiant, ses deux étapes, ni être désactivé, supprimé, ni déconnecter les autres appareils (403). En plus : `MOT_DE_PASSE_DEMO` permet de créer les comptes en ligne avec un mot de passe absent du dépôt. |
| **S2** | Corrigé | Une seule fonction `suiteDemandee()` dans `app.js` : caractères de contrôle refusés, puis adresse comparée telle que le navigateur la comprend. Essayée avec Node sur 6 fausses adresses. |
| **S3** | Corrigé | Pièces des messages en `private, no-cache` ; le service worker ne touche plus à `/fichiers/`. |
| **S4** | Corrigé | Les abonnements push partent avec les sessions fermées de force (`oublierPush()` dans `src/utils/sessions.js`) ; `couperPush()` est dans `app.js` (la déconnexion le fait depuis toutes les pages) ; un appareil resté connecté redonne le sien (`resynchroniser()`). |
| **E1** | Corrigé | Seul un jeton faux efface le cookie ; une erreur de la base donne une erreur 500, session gardée. |
| **B1** | Corrigé | Index `idx_messages_fichier`. |
| **P1** | Corrigé | Connexion : seuls les échecs comptent. Inscription : sa propre limite (60 par quart d'heure, refus non comptés). Envois d'images : par membre. |
| **P2** | À faire en ligne | Vérifier `trust proxy` après le premier déploiement. |
| L1, L2 | Corrigés | `supprimerDefinitivement()` garde le groupe d'un chef qui n'a jamais écrit, et ferme les groupes des équipes liées aux demandes du client ; un chef peut quitter un groupe qui n'a plus d'équipe. |
| L3 | Corrigé en partie | Débloquer depuis Paramètres (`DELETE /api/parametres/bloques/:cle`) et depuis `/admin` fonctionne pour un compte désactivé. Le menu « Débloquer » à l'intérieur d'une conversation passe encore par l'identifiant : pour un compte désactivé, il faut passer par Paramètres. |
| L4, L5, L6 | Corrigés | « de Yao » côté serveur ; les 200 derniers commentaires ; « Liste privée » sur le profil. |
| S5, S6, S7, S8 | Corrigés | Email du mot de passe oublié envoyé sans faire attendre ; rien d'un compte désactivé dans les réactions, les citations et « écrit… » ; trois listes filtrées ; `refuserLesLiens()` pour les demandes, les projets et les réponses au défi. |
| C1, C2, C3 | Corrigés | Erreur `23505` rattrapée à l'inscription ; contenu et mise en attente dans la même transaction ; un seul tour de la boucle d'appel à la fois. |
| E2, E3, E4 | Corrigés | `versConnexion()` et `pageEnPanne()` dans `app.js` (un serveur qui ne répond pas n'est plus pris pour « pas connecté ») ; délais de 10 secondes pour l'email et la base. |
| B2, B3, B4 | Corrigés | Deux index, notifications lues de plus de 180 jours nettoyées ; lecture simple avant la transaction du défi ; `defis.auteur_id` en `ON DELETE SET NULL`. |
| P3, P4 | À faire en ligne | Certificat de la base (si Systalink le fournit) ; `SELECT lower('ÉTÉ')` sur la base en ligne. |
| P5 | Corrigé | Le service worker ne garde que les pages de sa liste et les fichiers de l'interface. |
| R1 à R5 | Corrigés | Textes passés par `t()` (les boutons de la notification d'un appel arrivent dans le push) ; `lieuDe()` aux six endroits ; quatre décisions écrites dans `journalModeration()` ; `appel_manque` dans `TYPES` ; mot de passe, sessions et journal dans une transaction ; plus de `innerHTML`. |

**Ce qui n'a pas été vérifié** : ces corrections ont été testées par les tests automatiques, pas dans un navigateur. À essayer à la main avant la mise en ligne : la connexion avec `?suite=`, la déconnexion depuis une page autre que le fil (le push doit être coupé), l'ouverture d'une photo de message après déconnexion, un appel sur une connexion lente, et la page du fil avec le serveur arrêté (« Réessayer » au lieu du formulaire de connexion).
