# Comptes de démonstration

Ces comptes sont créés par `npm run demo` (`scripts/demo.js`). Ils servent à tester le site et à le montrer au jury sans avoir à s'inscrire.

**Mot de passe, le même pour tous : `Palabre-Jury-2026`**

Pour se connecter : ouvrir `/connexion`, saisir l'email d'un compte ci-dessous et ce mot de passe.

Ces comptes sont déjà **confirmés et complets** : pas de code à saisir, pas de « profil de dev » à remplir. Leurs adresses email n'existent pas : aucun email ne leur est envoyé. Pour voir l'inscription en deux étapes, crée un nouveau compte (en local, le code à 6 chiffres s'affiche dans la console du serveur). Idrissa et Ibrahim n'ont pas de lien : leur profil montre la mention « Profil à confirmer ».

## Les deux comptes pour tout tester

Si tu ne dois en retenir que deux, ce sont ceux-là. Dès la connexion, ils ont **quelque chose à faire dans chaque fonction du site**. Un compte ne peut pas être développeur et client à la fois : il en faut donc un de chaque.

| Compte | Email | Rôle |
| --- | --- | --- |
| Moussa Compaoré | `dev@demo.palabre.dev` | développeur, et **administrateur** (en local) |
| Rasmata Ilboudo | `client@demo.palabre.dev` | cliente |

### Avec `dev@demo.palabre.dev` (Moussa, développeur)

| Fonction | Ce qui l'attend |
| --- | --- |
| Notifications | 11 non lues : demandes d'amis, invitation d'équipe, proposition acceptée, avis reçu, demande de message |
| Amis (`/amis`) | 5 amis, **2 demandes reçues** (Mariam, Aminata) à accepter ou refuser, 1 demande envoyée (Oumar) à annuler |
| Fil | 2 publications à lui avec j'aime et commentaires ; publier une idée, une question, un projet, une photo, une vidéo ; aimer, commenter, signaler |
| Demandes | une proposition **en attente** (l'auberge), une **acceptée** sur une demande terminée (la caisse), une **non retenue** (la paie) ; proposer seul sur une demande ouverte |
| Équipe éclair | **une invitation à accepter ou refuser** (équipe de Fatoumata, livraison) ; en former une lui-même avec ses 5 amis sur une demande ouverte |
| Messages | une conversation avec Awa (amie) **à lire**, une avec Rasmata (cliente), et **une demande de message** d'Ibrahim, un inconnu (accepter, refuser, bloquer) |
| Profil | couverture, 4 projets (3 au lien vérifié : anneau de preuve et badge « Profil prouvé »), 1 avis 5 étoiles, onglets Publications / Projets / Avis / Amis |
| Projets (`/projets`) | ajouter un projet, faire vérifier un lien, proposer un projet pour Facebook |
| Défi (`/defis`) | voter pour une réponse |
| Modifier le profil | photo, couverture, compétences, liens, disponibilité, WhatsApp |
| Administration (`/admin`) | statistiques, **2 contenus signalés** (un commentaire publicitaire signalé deux fois, une publication une fois) à masquer, classer ou sanctionner, **1 projet à valider** pour Facebook, **1 projet à publier**, derniers inscrits avec leur âge, création d'un défi |

### Avec `client@demo.palabre.dev` (Rasmata, cliente)

| Fonction | Ce qui l'attend |
| --- | --- |
| Notifications | 8 non lues : propositions reçues, demande d'ami |
| Ses demandes | une **terminée avec avis** (la caisse) ; une **ouverte avec 3 propositions à départager** (l'auberge) ; une **ouverte avec une équipe éclair en formation** (la livraison : la proposition arrive quand Moussa a répondu à l'invitation) ; une **attribuée** à Kofi (la paie), qu'elle peut **terminer puis noter** |
| Publier | une nouvelle demande, ou passer par le calculateur `/calculateur` qui pré-remplit le formulaire |
| Messages | une conversation avec Moussa, une avec Kofi **à lire** ; écrire à un développeur qui lui a fait une proposition |
| Amis | **1 demande reçue** (Bintou) |
| Chercher (`/chercher`) | trouver un développeur par compétence, ville, disponibilité |
| Défi | voter (un client ne répond pas au défi) |

### Un parcours complet, à deux fenêtres

Ouvre Moussa dans une fenêtre et Rasmata dans une fenêtre privée :

1. Moussa accepte l'invitation d'équipe (cloche, ou la demande « Application de livraison ») : la proposition de l'équipe part chez Rasmata.
2. Rasmata ouvre sa demande, choisit l'équipe, puis écrit à Fatoumata.
3. Rasmata termine la demande « Logiciel de paie » et laisse un avis à Kofi.
4. Moussa ouvre `/admin`, masque le commentaire signalé, valide son projet pour Facebook, puis le marque comme publié.

Une fois ces actions faites, elles ne sont plus « à faire ». Pour tout remettre comme au début : `npm run demo -- retirer`, puis `npm run demo`.

### Ce que ces comptes ne montrent pas

- **L'inscription** (code à 6 chiffres, page « Ton profil de dev ») : il faut créer un nouveau compte.
- **Répondre au défi** : le défi de démonstration est en phase de vote. Moussa peut créer un nouveau défi dans `/admin` une fois celui-ci terminé ou supprimé.
- **Le rôle administrateur sur le site en ligne** : voir « À savoir » plus bas.

## Développeurs

| Nom | Email | Ville | À voir avec ce compte |
| --- | --- | --- | --- |
| Awa Ouédraogo | `awa@demo.palabre.dev` | Koudougou, Burkina Faso | le fil, ses amis, les suggestions « Devs à découvrir » |
| Bintou Traoré | `bintou@demo.palabre.dev` | Koudougou, Burkina Faso | un avis 5 étoiles, une photo de couverture, 6 projets vérifiés |
| Cheick Diallo | `cheick@demo.palabre.dev` | Ouagadougou, Burkina Faso | une proposition refusée |
| Fatoumata Koné | `fatou@demo.palabre.dev` | Abidjan, Côte d'Ivoire | l'anneau de preuve plein (11 projets), cheffe d'une équipe éclair retenue |
| Idrissa Sawadogo | `idrissa@demo.palabre.dev` | Bobo-Dioulasso, Burkina Faso | un débutant : aucun projet, donc pas d'anneau |
| Mariam Sow | `mariam@demo.palabre.dev` | Dakar, Sénégal | |
| Kofi Mensah | `kofi@demo.palabre.dev` | Lomé, Togo | un avis 5 étoiles, 8 projets vérifiés |
| Oumar Bah | `oumar@demo.palabre.dev` | Bamako, Mali | un dev « occupé » (absent de « Disponibles maintenant ») |
| Aminata Diop | `aminata@demo.palabre.dev` | Thiès, Sénégal | |
| Yao Kouassi | `yao@demo.palabre.dev` | Bouaké, Côte d'Ivoire | membre de l'équipe éclair de Fatoumata |
| Nadège Mbarga | `nadege@demo.palabre.dev` | Douala, Cameroun | |
| Ibrahim Maïga | `ibrahim@demo.palabre.dev` | Niamey, Niger | une proposition en attente |

## Clients

| Nom | Email | Ville | À voir avec ce compte |
| --- | --- | --- | --- |
| Salimata Dao | `salimata@demo.palabre.dev` | Ouagadougou, Burkina Faso | une demande terminée avec avis, une demande ouverte avec 2 propositions à départager |
| Pascal Zongo | `pascal@demo.palabre.dev` | Koudougou, Burkina Faso | une demande terminée avec avis, une demande ouverte sans proposition |
| Esther Akakpo | `esther@demo.palabre.dev` | Cotonou, Bénin | une demande attribuée à une équipe éclair |

## Ce que contient la démonstration

- 17 membres (15 + les deux comptes pour tout tester), 22 amitiés ;
- 21 publications (idées, questions, projets, dont 3 avec une vidéo) avec leurs j'aime et leurs commentaires, étalées sur une semaine ;
- des projets pour 10 développeurs, avec des anneaux de preuve de 1 à 11 segments ;
- 10 demandes de clients : 3 terminées avec avis, 1 attribuée à une équipe éclair, 1 attribuée à un développeur, 5 ouvertes ;
- 2 défis de la semaine : un terminé (gagné par Fatoumata), un en phase de vote ;
- 3 signalements à traiter et 2 projets proposés pour Facebook, visibles dans `/admin` ;
- 8 conversations privées (4 autour des deux comptes pour tout tester), dont : Awa et Bintou (amies), Salimata et Bintou (cliente et développeuse, à propos de la boutique), Esther et Fatoumata (cliente et cheffe d'équipe), et une **demande de message en attente** d'Idrissa chez Fatoumata (onglet « Demandes » de `fatou@demo.palabre.dev`).

## À savoir

- **Les liens des projets sont inventés** (`https://demo.palabre.dev/…`) et marqués « vérifiés » directement en base, pour montrer l'anneau de preuve. Sur le vrai site, ce badge n'est donné que si le serveur a réellement visité le lien.
- **Les images sont dessinées par le script** (de fausses captures d'écran pour les projets, des dégradés à motif fin pour les couvertures, différents pour chaque développeur) : aucune photo de personne.
- **`dev@demo.palabre.dev` est administrateur en local seulement.** Sur le site en ligne (`NODE_ENV=production`), il ne l'est pas, sauf si on lance `npm run demo -- --forcer --admin`. Raison : le mot de passe de ces comptes est écrit dans ce fichier, public sur GitHub ; un administrateur peut masquer des contenus et bloquer des membres. Si le jury doit voir `/admin` en ligne, mieux vaut un compte à part, avec un mot de passe donné seulement au jury : `npm run admin -- son-email`.
- Aucun autre compte de démonstration n'est administrateur.

## Commandes

```
npm run demo              # crée les comptes ; ne fait rien s'ils existent déjà
npm run demo -- retirer   # retire les comptes et tout leur contenu
npm run demo -- --forcer  # nécessaire si NODE_ENV=production (mise en ligne pour le jury)
npm run demo -- --forcer --admin   # en production : donne aussi /admin à dev@demo.palabre.dev (voir « À savoir »)
```

Tous les comptes ont un email en `@demo.palabre.dev` : c'est ce qui permet de les retirer d'un coup, sans toucher aux vrais membres.
