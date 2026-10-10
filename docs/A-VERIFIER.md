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
