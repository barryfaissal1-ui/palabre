# À vérifier : messagerie et appels (travail en 7 parties du 10 octobre 2026)

## Où en est chaque partie

| Partie | État | Commit |
| --- | --- | --- |
| 0. Avatars dans toutes les notifications, exemples officiels des normes du push | Faite | `a9b067d` |
| 1. Conversations de groupe des équipes éclair | Faite | `e20f8d8` |
| 2. Réactions, réponses, suppression | Faite | `baf1dbc` |
| 3. « Écrit… », « Vu par », « En ligne » | Faite | `aa23f91` |
| 4. Messages vocaux | Faite | `31057be` |
| 5. Appels audio et vidéo | Faite pour l'essentiel, voir « Pas fait » | commit « Appels audio et vidéo » |
| 6. Style « arbre à palabres » des appels et des notifications | **Partielle**, voir « Pas fait » | dans le même commit que la partie 5 |

Les parties 5 et 6 sont dans un seul commit : l'écran d'appel a été écrit directement dans le style demandé.

## Pas fait, ou fait autrement

**Partie 5**
- **Pas de WebSocket** (bibliothèque `ws`). On ne sait pas si Systalink les accepte : j'ai écrit seulement la version « de secours » demandée, une requête par seconde pendant un appel. Elle marche partout. À décider après le premier essai en ligne.
- **Le bouton haut-parleur n'existe pas.** Un site web ne peut pas basculer entre l'écouteur et le haut-parleur d'un téléphone ; le navigateur choisit seul.
- **L'appel entrant met jusqu'à 20 secondes à s'afficher** sur une page autre que la messagerie (5 secondes dans une conversation ouverte). Pour cela, la requête de la pastille des messages est passée de 60 à 20 secondes sur tout le site. La sonnerie dure 30 secondes.
- **Appel de groupe à trois ou quatre : non vérifié dans le navigateur.** Le serveur est testé (quatre présents au plus, chacun parle à chacun), le code du navigateur est le même que pour deux, mais je n'ai essayé qu'à deux.
- **Reconnexion après un changement de réseau : non vérifiée.** Le code est là (« Reconnexion… », 15 secondes) ; je n'ai pas pu couper le réseau au milieu d'un appel dans mon navigateur de test.

**Partie 6**
- **Pas de carte « toast » en verre** quand un message arrive sur une autre page.
- **Pas de son à l'arrivée d'un message**, ni de réglage « son des messages » dans le profil. Seule la sonnerie des appels existe.
- **Les titres des push ne sont pas tous refaits** : « Awa t'appelle » et le nom de la personne pour un message, oui ; les autres gardent « Palabre » en titre et la phrase en dessous.
- **Captures** : elles sont dans `docs/captures/`, pour le téléphone 390 px et l'ordinateur, en clair et en sombre (appel entrant, sortant, audio en cours, vidéo en cours, terminé, manqué). **Pas de capture en 360 px, pas de capture du toast** (il n'existe pas).
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
