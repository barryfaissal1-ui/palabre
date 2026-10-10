# Déclaration d'usage de l'intelligence artificielle

Déclaration exigée par l'article 6 du règlement CADEV 2026. À compléter par l'équipe au fil du projet.

## Outils utilisés

- **Claude (Anthropic)**, y compris Claude Code : conception du plan, génération et revue de code, rédaction de textes, et réalisation des visuels (logo, image de partage, illustrations des états vides, motif de la bannière des profils).

## Parties concernées

| Partie | Usage de l'IA |
| --- | --- |
| Plan du projet, choix techniques | Proposés par l'IA, discutés et validés par l'équipe |
| Schéma de la base de données (`src/db/schema.sql`) | Généré par l'IA à partir du plan de l'équipe |
| Authentification (`src/routes/auth.js`, `src/middleware/auth.js`) | Générée par l'IA, relue par l'équipe |
| Profils et photos (`src/routes/profils.js`, `src/utils/images.js`, `public/js/profil.js`, `public/js/modifier-profil.js`) | Générés par l'IA, relus par l'équipe |
| Réseau social : fil, j'aime, commentaires, amis, signalements (`src/routes/publications.js`, `src/routes/amis.js`, `src/routes/signalements.js`, `src/utils/membres.js`, `public/js/fil.js`, `public/js/amis.js`, `tests/social.test.js`) | Généré par l'IA à partir de la demande de l'équipe, relu par l'équipe |
| Demandes, équipes éclair et notifications (`src/routes/demandes.js`, `src/routes/equipes.js`, `src/routes/notifications.js`, `src/utils/notifications.js`, `public/js/demandes.js`, `public/js/demande.js`, `public/js/notifications.js`, `tests/demandes.test.js`) | Généré par l'IA à partir de la demande de l'équipe, relu par l'équipe |
| Profil prouvé, vitrine et partage (`src/routes/projets.js`, `src/routes/avis.js`, `src/routes/devs.js`, `src/routes/pages.js`, `src/utils/liens.js`, `public/js/projets.js`, `public/js/projet.js`, `public/js/chercher.js`, `public/js/vitrine.js`, `tests/preuves.test.js`) | Généré par l'IA à partir de la demande de l'équipe, relu par l'équipe |
| Tableau de bord administrateur (`src/routes/admin.js`, `src/db/admin.js`, `public/js/admin.js`, `tests/admin.test.js`) | Généré par l'IA à partir de la demande de l'équipe, relu par l'équipe |
| Calculateur de prix (`public/js/calcul-prix.js`, `public/js/calculateur.js`, `tests/calculateur.test.js`) | Généré par l'IA ; la grille de prix (`public/js/grille-prix.js`) a été fournie par l'équipe |
| Guide `docs/COMPRENDRE-LE-CODE.md` | Rédigé par l'IA pour l'équipe |
| Interface (`public/`) | Générée par l'IA, adaptée par l'équipe |
| Système de design (`public/css/style.css`, fonctions `icone`, `toast`, `confirmer`, `etatVide`, `chargement` de `public/js/app.js`) | Généré par l'IA à partir des demandes de l'équipe, relu par l'équipe |
| Refonte « réseau social » : anneau de preuve, recherche de membres, « Disponibles maintenant », preuve sociale du fil, couverture et onglets du profil (`public/js/publication.js`, `public/js/fil.js`, `public/js/profil.js`, `src/routes/devs.js`, `src/routes/publications.js`, `src/routes/profils.js`, `tests/preuve-sociale.test.js`) | Généré par l'IA à partir du cahier des charges rédigé par l'équipe, relu par l'équipe |
| Pages Connexion et Inscription avec l'animation de la « lame » (`public/connexion.html`, `public/js/acces.js`) | Générées par l'IA à partir du cahier des charges rédigé par l'équipe, sans code repris d'ailleurs ; relues par l'équipe |
| Version ordinateur en 3 colonnes, pages « À propos » et « Conditions », contenu et images de démonstration (`scripts/demo.js`, `docs/COMPTES-DEMO.md`) | Générés par l'IA à partir du cahier des charges rédigé par l'équipe ; textes des pages à relire par l'équipe |
| Messagerie privée « Palabre Messages » (`src/routes/messages.js`, `public/messages.html`, `public/js/messages.js`, `tests/messages.test.js`) | Générée par l'IA à partir du cahier des charges rédigé par l'équipe (règles, tables et routes définies par l'équipe), relue par l'équipe |
| Inscription en deux étapes : code de confirmation de l'email, champ piège, heure d'ouverture signée, page « Ton profil de dev » et ses contrôles (`src/utils/inscription.js`, `src/utils/profil-dev.js`, `public/confirmer-email.html`, `public/bienvenue.html`, `tests/inscription.test.js`) | Générée par l'IA à partir du cahier des charges rédigé par l'équipe (règles, durées et limites fixées par l'équipe), relue par l'équipe |
| Vidéos dans le fil (`src/utils/videos.js`, `videoPublication()` dans `public/js/publication.js`, tests dans `tests/social.test.js`) | Générées par l'IA à partir du cahier des charges rédigé par l'équipe ; les vidéos de démonstration sont des cours publics en français, choisis et vérifiés avec l'IA |
| Publication Facebook depuis l'administration (texte préparé, limite de 5 par jour) dans `src/routes/admin.js` et `public/js/admin.js` | Générée par l'IA à partir du cahier des charges rédigé par l'équipe |
| Préparation de la mise en ligne : contrôles de configuration, compression, cache par empreinte (`src/utils/statique.js`), pages d'erreur (`src/vues/`), mesures en 3G (`docs/PERFORMANCE.md`), relecture de sécurité et ses corrections (`docs/AUDIT-SECURITE.md`, `tests/securite.test.js`), guide de déploiement | Réalisés par l'IA à la demande de l'équipe ; les mesures ont été faites par l'IA sur le site local ; le guide de déploiement est à vérifier par l'équipe sur l'écran réel de Systalink |
| Défilement infini (`chargementInfini()` dans `public/js/app.js`, `tests/listes.test.js`) | Généré par l'IA à partir du cahier des charges rédigé par l'équipe |
| Partage des publications (`partager()` dans `public/js/app.js`, page publique `public/publication.html`, `public/js/page-publication.js`, `tests/partage.test.js`) et les deux comptes de démonstration « tout tester » | Généré par l'IA à partir du cahier des charges rédigé par l'équipe |
| Défi de la semaine (`src/routes/defis.js`, `public/defis.html`, `public/js/defis.js`, `tests/defis.test.js`) et ses deux défis de démonstration (énoncés et réponses inventés) | Généré par l'IA à partir du cahier des charges rédigé par l'équipe |
| Illustrations des états vides et motif de la bannière (`public/icons/illustrations.svg`, `public/icons/motif-banniere.svg`) | Dessinés avec l'IA (Claude Code) pour le concours, sans source externe |
| Icônes (`public/icons/icones.svg`) | Icônes Lucide (licence ISC), assemblées en un fichier avec l'IA |
| Image de partage Facebook / WhatsApp (`public/img/palabre-partage-1200x630.png`) | Visuel réalisé avec Claude (Anthropic) à partir du logo et des couleurs de l'équipe |
| Logo | Créé par l'équipe avec Claude Code ; icônes dérivées générées automatiquement |

## Maîtrise par l'équipe

L'équipe relit chaque partie et doit être capable d'expliquer au jury le fonctionnement de toute la solution : sessions par cookie httpOnly et JWT, hachage bcrypt des mots de passe, jetons de réinitialisation à usage unique, confirmation de l'email par un code haché à essais limités, protections contre les robots (champ piège, heure d'ouverture signée), limitation des tentatives, protections de sécurité (Helmet, requêtes JSON uniquement), vérification des liens sans risque pour le réseau interne (SSRF), avis réservés aux vrais clients, balises de partage Open Graph.
