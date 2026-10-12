# Palabre et le thème de la CADEV 2026

Le thème de la Coupe d'Afrique des Développeurs 2026 : *« Une plateforme d'échange pour les développeurs, par les développeurs et pour les développeurs. »* Les développeurs doivent pouvoir **se retrouver, échanger, poser des questions, partager leurs connaissances, présenter leurs projets et collaborer**.

Ce document reprend le sujet morceau par morceau et montre, pour chacun, ce que nous avons construit et où le voir sur le site. Pour tout essayer, les comptes de démonstration sont dans [COMPTES-DEMO.md](COMPTES-DEMO.md).

---

## Le titre

| Le sujet dit | Ce que Palabre y répond |
| --- | --- |
| **Une plateforme d'échange** | Un fil d'actualité avec commentaires, une messagerie privée, des groupes de discussion, des messages vocaux et des appels. On ne vient pas seulement regarder : on parle. |
| **Pour les développeurs** | Un profil pensé pour les devs (compétences, spécialité, expérience, GitHub, projets vérifiés, disponibilité) et du travail : les demandes publiées par des clients. |
| **Par les développeurs** | Palabre est né d'un problème vécu par un développeur burkinabè qui cherchait des clients. Sur le site aussi, ce sont les devs qui font vivre la communauté : défi de la semaine, équipes éclair, entraide. |
| **Africaine** | Budgets en FCFA, site léger pensé pour la 3G, installable sur n'importe quel téléphone, en français et en anglais, avec une protection contre les arnaques au paiement d'avance. |

---

## Les six verbes du sujet

### Se retrouver
Profils publics avec un lien court, recherche de développeurs, « Devs à découvrir », « Disponibles maintenant », amis et amis en commun.
**Où le voir :** la barre de recherche en haut, la page `/chercher`, un profil (bouton « Ajouter en ami »).

### Échanger
Messagerie privée avec messages vocaux, réactions et réponses, appels audio et vidéo, « en ligne » et « écrit… », notifications sur le téléphone. Un inconnu ne peut pas écrire librement : il envoie une demande de message, que l'on accepte ou non.
**Où le voir :** l'onglet Messages.

### Poser des questions
Les publications de type **Question** dans le fil. Une question ne se perd plus : le filtre **« Questions »** les rassemble, et le filtre **« Sans réponse »** montre celles qui attendent encore de l'aide. Quand un commentaire a résolu le problème, l'auteur de la question le marque comme **« Meilleure réponse »** : il passe en premier, et la question porte le badge **« Résolue »**.
**Où le voir :** le fil `/fil`, les puces sous « Tout le monde / Mes amis » ; le menu « … » d'un commentaire sous sa propre question.

### Partager ses connaissances
Les publications de type **Idée**, les vidéos YouTube, TikTok et Facebook dans le fil, et le **défi de la semaine** : un problème concret, chaque développeur propose sa solution, la communauté vote.
Le fil est aussi une **base de savoir** : la **recherche** retrouve une ancienne question par ses mots ou par ceux de sa meilleure réponse, les questions résolues en premier. Et celui qui aide est reconnu : son profil affiche le nombre de ses **réponses retenues**, à côté de ses projets vérifiés.
**Où le voir :** la barre de recherche en haut (résultats « Membres » et « Publications »), la page `/recherche`, les chiffres d'un profil, et la page `/defis`.

### Présenter ses projets
Chaque développeur montre ses réalisations. Le site vérifie automatiquement que le lien du projet est vraiment en ligne : le projet reçoit alors le badge **« Lien vérifié »**, et le profil un anneau vert. Seul un client qui a réellement travaillé avec un développeur peut laisser un avis. Les projets apparaissent aussi dans la vitrine de l'accueil et se partagent sur WhatsApp et Facebook avec une carte d'aperçu.
**Où le voir :** l'onglet Projets d'un profil, la vitrine de l'accueil.

### Collaborer
Les **équipes éclair** : pour une demande trop grosse pour une seule personne, un développeur invite ses amis de la plateforme, chacun avec un rôle (design, mobile, serveur…). La proposition part au client quand tous ont accepté, et l'équipe a son propre groupe de discussion.
**Où le voir :** une demande, bouton « Former une équipe », puis le groupe de l'équipe dans les Messages.

---

## Les questions « À vous de décider »

| Question du sujet | Notre réponse |
| --- | --- |
| Comment les développeurs **se rencontrent** | Par la recherche, les suggestions, les profils partagés et les amis en commun, comme sur un réseau social. |
| Comment ils **échangent** | En public dans le fil, où une question garde sa meilleure réponse et se retrouve par la recherche ; en privé dans la messagerie (texte, vocaux, appels), sans quitter l'application. |
| Comment ils **partagent leurs projets** | Avec des projets prouvés par un lien vérifié, visibles même sans compte. |
| Comment ils **collaborent** | Avec les équipes éclair et leur groupe de discussion. |
| Ce qui rend la plateforme **réellement utile** | Les clients qui publient de vraies demandes avec un budget en FCFA : les développeurs y trouvent du travail, pas seulement des discussions. Et le calculateur « Combien coûte mon projet ? » aide les clients à fixer un budget juste. |

---

## La meilleure expérience possible

- **Le téléphone d'abord** : site léger en 3G, installable comme une application.
- **Pour tous** : français et anglais, mode sombre, navigation au clavier, textes simples.
- **Une identité** : l'arbre à palabres, le lieu où l'on se réunit pour parler et décider ensemble.
- **Une aide toujours là** : le Griot répond aux questions des visiteurs, sans rien enregistrer.
- **La confiance** : règles de la communauté acceptées à l'inscription, filtre contre les insultes et les arnaques, signalements et sanctions avec possibilité de contester, comptes protégés (alerte de connexion, validation en deux étapes), réglages de confidentialité vérifiés par le serveur.

Le détail technique est dans [COMPRENDRE-LE-CODE.md](COMPRENDRE-LE-CODE.md) et [AUDIT-SECURITE.md](AUDIT-SECURITE.md).

---

## Prochaines étapes

- Publier automatiquement les projets et défis gagnants sur la page Facebook « Palabre Dev ».
