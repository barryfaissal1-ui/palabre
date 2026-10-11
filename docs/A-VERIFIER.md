# À vérifier : paramètres, confidentialité et site en deux langues (11 octobre 2026)

Ce qui suit a été fait sans que tu puisses le voir. Tout est testé par le serveur et parcouru dans Chrome (téléphone 390 px et ordinateur, clair et sombre, en français et en anglais), mais plusieurs choix sont les miens : dis-moi ceux qui ne te conviennent pas.

## À essayer toi-même

**Paramètres**
- [ ] Ouvre `/parametres` sur ton téléphone : la liste, une rubrique, le retour. Sur ordinateur : le menu de l'avatar en haut à droite.
- [ ] Change un réglage de confidentialité avec le compte `adama@demo.palabre.dev`, puis regarde son profil et ses publications avec un autre compte, et sans compte.
- [ ] **Change d'email avec une vraie adresse** : je n'ai vérifié l'envoi du code que dans les tests (aucun vrai email n'est parti).
- [ ] **Supprime un compte que tu as créé pour l'essai**, après avoir écrit à quelqu'un : chez l'autre, la conversation doit rester, sous le nom « Membre parti ».
- [ ] « Télécharger mes données » sur un téléphone : le fichier doit arriver dans les téléchargements.

**Langues**
- [ ] **Relis l'anglais.** C'est moi qui l'ai écrit, et aucun anglophone ne l'a relu. Les deux fichiers se lisent côte à côte : `public/langues/fr.js` et `public/langues/en.js` (mêmes clés, même ordre). Les pages `/a-propos` et `/conditions` surtout.
- [ ] Connecte-toi avec `kwame@demo.palabre.dev` : tout le site doit être en anglais.
- [ ] Les captures de la version anglaise sont dans `docs/captures/anglais/`, celles des paramètres dans `docs/captures/parametres/`.

## Mes choix, à valider

- **Première visite : anglais si le téléphone est en anglais.** C'est ce que tu as demandé. Attention : beaucoup de téléphones vendus en Afrique francophone sont réglés en anglais. Un visiteur burkinabè peut donc arriver sur un site en anglais, avec seulement le petit lien « Français » en bas de page pour revenir. Si tu préfères le français pour tout le monde à la première visite, c'est une ligne à changer dans `public/js/app.js` et une dans `src/utils/langue.js`.
- **Accès aux paramètres sur téléphone** : l'avatar de l'en-tête n'existe pas sur téléphone (il est dans le menu du bas, où il mène au profil). J'ai donc mis un bouton « Paramètres » sur son propre profil, à côté de « Modifier mon profil ». Le menu de l'avatar existe sur ordinateur et tablette.
- **« Qui peut m'appeler : mes amis et mes clients »** est la valeur par défaut, et elle garde le comportement d'avant : un inconnu dont tu as accepté la demande de message peut aussi t'appeler. Le texte d'aide le dit (« Un appel n'est possible que dans une conversation que tu as acceptée »).
- **Liste d'amis cachée** : la liste n'est plus donnée, mais le **nombre** d'amis reste affiché sur le profil.
- **Suppression d'un compte** : les avis qu'un client a laissés à des devs partent avec lui (ce sont ses données). Si tu préfères qu'ils restent sous « Membre parti », dis-le.
- **Liste des pays** : j'ai ajouté 21 pays anglophones et lusophones (Ghana, Nigeria, Kenya, Afrique du Sud…), sinon un Ghanéen ne pouvait pas s'inscrire.
- **Code des erreurs** : il est fabriqué à partir de la phrase française (« Adresse email invalide. » donne `adresse-email-invalide`). Si on réécrit une phrase, son code change.

## Ce qui n'est pas traduit, volontairement

- Ce qu'écrivent les membres : publications, commentaires, messages, demandes, propositions, projets.
- Les messages « système » d'un groupe (« Awa a rejoint l'équipe ») et le titre d'un groupe (« Équipe : … ») : ils sont écrits en base une fois pour toutes, en français.
- Les notifications **déjà reçues** : elles gardent la langue qu'avait le membre quand elles sont arrivées.
- Le texte proposé à l'administrateur pour la page Facebook « Palabre Dev » (la page est en français).
- Les noms des compétences (ce sont des noms de technologies) et les noms des villes.
- La page `/admin` est traduite, mais les motifs de signalement que l'équipe y lit restent en français.

## Ce que je n'ai pas pu vérifier

- **Aucun vrai email** n'est parti : ni le code de changement d'adresse, ni les emails en anglais.
- **Aucun vrai push** (comme avant) : les titres en anglais sont vérifiés par les tests seulement.
- **Un texte anglais trop long sur un très petit écran** (360 px) : je n'ai parcouru le site qu'en 390 px et 1280 px.

# À vérifier : messagerie et appels (travail en 7 parties du 10 octobre 2026)

## Où en est chaque partie

| Partie | État | Commit |
| --- | --- | --- |
| 0. Avatars dans toutes les notifications, exemples officiels des normes du push | Faite | `a9b067d` |
| 1. Conversations de groupe des équipes éclair | Faite | `e20f8d8` |
| 2. Réactions, réponses, suppression | Faite | `baf1dbc` |
| 3. « Écrit… », « Vu par », « En ligne » | Faite | `aa23f91` |
| 4. Messages vocaux | Faite | `31057be` |
| 5. Appels audio et vidéo | Faite pour l'essentiel, voir « Pas fait » | `6d16e60` |
| 6. Style « arbre à palabres » des appels et des notifications | Faite (complétée par les finitions ci-dessous) | `6d16e60` (le même) |

Les parties 5 et 6 sont dans un seul commit : l'écran d'appel a été écrit directement dans le style demandé.

## Finitions du 10 octobre 2026 (toutes faites)

| Point | Commit |
| --- | --- |
| 1. Le menu « … » d'une bulle reste dans la conversation (ordinateur, tablette, téléphone) | `b08f5ff` |
| 2. Carte d'arrivée d'un message sur les autres pages | `11e9269` |
| 3. Son à l'arrivée d'un message et réglage « Son des messages » | `04068e8` |
| 4. Un titre clair pour chaque push | `6a2083f` |
| 5. Appel entrant vérifié toutes les 5 secondes par la veille | `201ddda` |
| 6. Captures du toast et de l'appel entrant en 360 px | avec ce document |
| En plus : `/modifier-profil` ne dépasse plus à droite sur téléphone | `c10cbf0` |

À essayer toi-même pour ces finitions :

- [ ] **Le son sur un vrai téléphone.** Je l'ai vérifié en comptant les notes lancées dans Chrome (784 Hz puis 1047 Hz), pas à l'oreille. Dis-moi s'il est trop fort, trop faible ou trop aigu : le volume et les notes sont deux nombres dans `sonMessage()`.
- [ ] **Le son après un changement de page sur iPhone.** Safari ne laisse jouer un son qu'après un toucher sur la page : la première carte après avoir ouvert une page sans la toucher peut arriver en silence. C'est voulu (on se tait sans erreur), mais à constater.
- [ ] **Les titres des push sur un vrai téléphone**, quand le push marchera en ligne : le titre doit tenir sur une ligne de l'écran verrouillé.
- [ ] **Relire les titres** dans `TITRES_PUSH` (`src/utils/notifications.js`) : ce sont mes mots, change ceux qui ne sonnent pas juste.
- [ ] **La spécialité et l'expérience sont maintenant l'une sous l'autre** sur téléphone dans `/modifier-profil` (elles étaient coupées par « … »). Dis-moi si tu préférais côte à côte.

## Pas fait, ou fait autrement

**Partie 5**
- **Pas de WebSocket** (bibliothèque `ws`). On ne sait pas si Systalink les accepte : j'ai écrit seulement la version « de secours » demandée, une requête par seconde pendant un appel. Elle marche partout. À décider après le premier essai en ligne.
- **Le bouton haut-parleur n'existe pas.** Un site web ne peut pas basculer entre l'écouteur et le haut-parleur d'un téléphone ; le navigateur choisit seul.
- L'appel entrant s'affiche maintenant **en 5 secondes au plus** sur toutes les pages (la veille), tant que l'onglet est visible ; la pastille des messages est revenue à 60 secondes. La sonnerie dure 30 secondes.
- **Appel de groupe à trois ou quatre : non vérifié dans le navigateur.** Le serveur est testé (quatre présents au plus, chacun parle à chacun), le code du navigateur est le même que pour deux, mais je n'ai essayé qu'à deux.
- **Reconnexion après un changement de réseau : non vérifiée.** Le code est là (« Reconnexion… », 15 secondes) ; je n'ai pas pu couper le réseau au milieu d'un appel dans mon navigateur de test.

**Partie 6**
- La carte d'arrivée, le son des messages et les titres des push sont faits (voir « Finitions »).
- **Push d'un groupe** : son titre est le nom du groupe, et le texte « Kofi : … ». Je l'ai laissé ainsi, c'est plus utile que « Nouveau message de Kofi » quand on est dans plusieurs équipes.
- **Captures** : elles sont dans `docs/captures/`, pour le téléphone 390 px et l'ordinateur, en clair et en sombre (appel entrant, sortant, audio en cours, vidéo en cours, terminé, manqué). S'y ajoutent la carte d'arrivée (`toast-message-…`, téléphone 390 px et ordinateur) et l'appel entrant sur un petit téléphone de 360 × 640 px, audio et vidéo (`appel-entrant-telephone-360-…`, `appel-video-entrant-telephone-360-…`).
- Les boutons « Décrocher » et « Refuser » dans la notification du téléphone sont écrits, mais **aucun vrai push n'a pu être envoyé** depuis mon navigateur de test (voir plus bas).

## Ce que tu dois essayer toi-même

- [ ] **Un vrai appel entre deux téléphones**, en données mobiles (Orange, Moov, Telecel), puis l'un en Wi-Fi. C'est le point le plus important : je n'ai vérifié qu'entre deux navigateurs du même ordinateur, là où la liaison directe marche toujours. Si l'appel sonne mais qu'on ne s'entend pas, il faut le relais TURN : `docs/APPELS-TURN.md`.
- [ ] **Le guide TURN** : je n'ai pas eu de serveur pour le jouer. Il suit la documentation de coturn, mais aucune commande n'a été exécutée.
- [ ] **Passer du Wi-Fi à la 4G pendant un appel** : « Reconnexion… » doit s'afficher, puis l'appel reprendre.
- [ ] **Un appel à trois ou quatre** dans le groupe de l'équipe de Fatoumata.
- [ ] **Les messages vocaux sur un iPhone** (format MP4) et sur un vrai Android : enregistrer, envoyer, écouter. J'ai utilisé le micro factice de Chrome.
- [ ] **L'appui long et le glissement** sur une bulle, avec un vrai doigt (menu, répondre).
- [ ] **Le push**, toujours pas vérifié de bout en bout (voir la section du push plus bas).
- [ ] **Les tracés d'icônes** ajoutés de mémoire : téléphone, micro, pause, répondre, sourire, copier.

## Ce qui a surpris

- **Un test échouait parfois au premier lancement** (« le fil est chargé par 10 ») : il lisait le fil général pendant que d'autres tests publiaient. Corrigé (`76846c7`). Une fois, il a échoué pendant que je commitais la partie 1 : ce commit est parti avec un test instable, corrigé dans le commit suivant. Depuis, je ne commite que si la suite passe deux fois de suite.
- **Un test du défi a échoué une fois**, juste après un changement de schéma, puis plus jamais sur huit lancements. Je n'ai pas trouvé la cause. Si tu le revois, garde le message d'erreur.
- **Trois défauts trouvés dans le navigateur, pas par les tests** : le menu d'une bulle se refermait tout seul toutes les 5 secondes ; « glisser pour annuler » envoyait quand même le message vocal ; les réponses « occupé » et « appel terminé » sortaient en erreur 500. Tous corrigés.
- **Les comptes de démonstration ont été recréés deux fois** pendant ce travail (notifications, puis discussion de groupe).

---

# À vérifier après le travail de nuit du 10 octobre 2026

Les 4 parties sont faites, testées et poussées. **137 tests automatiques passent.** Chaque partie a été vérifiée dans Chrome en téléphone 390 px et ordinateur 1280 px, en clair et en sombre.

## 1. Ce qui est fait

| Partie | En bref | Où regarder |
| --- | --- | --- |
| 1. Vidéos dans le fil | Un lien YouTube, TikTok ou Facebook par publication. Seuls la plateforme et l'identifiant sont gardés. Rien n'est chargé avant le toucher. | `/fil`, bouton « Vidéo » |
| 2. Publication Facebook (plan B) | Section « À publier sur Facebook » dans `/admin` : texte prêt, « Copier le texte », « Ouvrir Facebook », « Marquer comme publié », 5 par jour au plus. | `/admin` |
| 3. Prêt pour la mise en ligne | Contrôles au démarrage, compression, cache long, pages 404 et 500, `robots.txt`, relecture de sécurité (8 corrections), guide de déploiement. | `docs/DEPLOIEMENT-SYSTALINK.md`, `docs/AUDIT-SECURITE.md`, `docs/PERFORMANCE.md` |
| 4. Défi de la semaine | Création dans `/admin`, page `/defis`, réponses, vote, gagnant désigné tout seul, badge sur le profil, encadré à droite et carte dans le fil. | `/defis` |

En 3G simulée, les pages pèsent environ deux fois moins et s'affichent en 3 secondes au lieu de 6 à 10 (détail dans `docs/PERFORMANCE.md`).

## 2. Ce que tu dois tester toi-même

Lance `npm run demo` une fois (il ajoute les vidéos et les défis aux comptes de démonstration, sans rien doubler), puis `npm start`.

### Ce que je n'ai pas pu vérifier

- [ ] **Vidéo Facebook** : je n'ai pas pu en lire une vraie (il me fallait une vidéo publique connue). YouTube et TikTok ont été lus pour de bon. Colle un lien `facebook.com/…/videos/…` et un lien `fb.watch/…` dans une publication, puis touche « Lire la vidéo ». C'est le point le plus incertain de la nuit.
- [ ] **« Ouvrir Facebook »** dans `/admin` : le bouton ouvre bien la fenêtre de partage, mais en local Facebook ne peut pas visiter `localhost`. La carte du projet ne s'affichera qu'avec le site en ligne.
- [ ] **« Copier le texte »** : dans mon navigateur de test, le presse-papiers est refusé (le texte est alors sélectionné, avec un message). Vérifie que la copie marche chez toi.
- [ ] **Un vrai téléphone**, en données mobiles : tout, et surtout les vidéos, la carte du défi dans le fil, et l'installation de l'application.
- [ ] **Le guide Systalink** : je n'ai pas vu leur écran. Les valeurs sont justes, les noms des boutons sont à adapter.
- [ ] **Un vrai envoi d'email** (SMTP) : toujours pas testé.

### À regarder d'un œil critique

- [ ] Les **3 vidéos de démonstration** sont de vrais cours en français (Pierre Giraud, Graven), mais **pas africains** : je n'ai pas trouvé de chaîne africaine que je pouvais vérifier. Si tu en connais, remplace les identifiants dans `VIDEOS` de `scripts/demo.js`.
- [ ] Le **texte Facebook** proposé et ses hashtags (`#Palabre #DevAfrique #TechAfricaine`) : à ton goût ? C'est dans `texteFacebook()` de `src/routes/admin.js`.
- [ ] Les **deux défis de démonstration** (énoncés et réponses inventés) : à relire.
- [ ] Les pages **404** (`/nimporte/quoi`) et le nouveau **petit logo** de l'en-tête : il doit rester net.
- [ ] Après la mise à jour, **reconnecte-toi une fois** si le site te déconnecte, et recharge deux fois si une page garde l'ancien style (service worker).

## 3. Les choix validés

Barry a accepté ces dix choix le 10 octobre 2026. Ils ne sont plus à trancher ; ils restent ici pour pouvoir les expliquer au jury.

1. **Défi sans aucun vote : pas de gagnant.** La règle « le plus de votes, la plus ancienne en cas d'égalité », appliquée à la lettre, ferait gagner une réponse avec zéro vote.
2. **Compteurs de votes cachés pendant le vote**, montrés à la fin, pour ne pas influencer.
3. **Le défi de démonstration est en phase de vote** : le jury peut voter tout de suite, mais personne ne peut y répondre. Pour montrer la réponse, créer un nouveau défi dans `/admin` quand celui-ci sera fini, ou le supprimer.
4. **Le défi est lisible sans compte** (répondre et voter demandent un compte), pour attirer des visiteurs.
5. **Lecture des profils limitée à 150 par 10 minutes** et par membre, pour protéger les numéros WhatsApp.
6. **`URL_PUBLIQUE` obligatoire en https en production** : le serveur refuse de démarrer sans, pour éviter des emails avec des liens vers `localhost`.
7. **Mesure 3G faite sans Playwright** : même bridage du réseau par Chrome, sans installer 150 Mo de plus.
8. **TikTok : les liens raccourcis (`vm.tiktok.com`) sont refusés** avec un message qui demande le lien complet.
9. **Icône TikTok** : une note de musique (Lucide n'a pas de logo TikTok).
10. **Risques de sécurité acceptés** : la liste à la fin de `docs/AUDIT-SECURITE.md`, dont le fait que l'inscription dit si un email est déjà inscrit.

Les vidéos de démonstration restent aussi telles quelles (cours en français, pas africains).

Questions encore ouvertes, des jours précédents : retirer les dessins des marges sur téléphone, faire démarrer les 3 colonnes à 1340 px, relire « À propos » et « Conditions », remplacer les liens de projets de démonstration inventés avant le jury. (La question des photos de messages est réglée : elles sont maintenant réservées aux deux membres.)

## 4. Ce qui a bloqué ou surpris

Rien n'a bloqué. Trois choses à savoir :

- **Des styles ne s'appliquaient pas sur téléphone.** En partie 2, j'avais rangé un bloc de styles à l'intérieur du bloc « ordinateur » sans le voir ; les parties 3 et 4 l'ont suivi. Je l'ai vu sur une capture du défi, corrigé, puis revérifié les trois parties. Si tu as regardé `/admin` ou la page 404 sur téléphone entre deux commits, c'est pour ça qu'elles étaient moins soignées.
- **Une réinitialisation de mot de passe déconnecte maintenant tous les appareils** du membre. C'est une correction de sécurité, mais c'est un changement visible.
- **Les tests du défi mettent de côté les défis de démonstration** le temps de tourner, puis les remettent. Si un test est interrompu en plein milieu, relance `npm run demo -- retirer` puis `npm run demo`.
