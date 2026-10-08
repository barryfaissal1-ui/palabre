# Déclaration d'usage de l'intelligence artificielle

Déclaration exigée par l'article 6 du règlement CADEV 2026. À compléter par l'équipe au fil du projet.

## Outils utilisés

- **Claude (Anthropic)**, y compris Claude Code : conception du plan, génération et revue de code, rédaction de textes.

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
| Guide `docs/COMPRENDRE-LE-CODE.md` | Rédigé par l'IA pour l'équipe |
| Interface (`public/`) | Générée par l'IA, adaptée par l'équipe |
| Logo | Créé par l'équipe avec Claude Code ; icônes dérivées générées automatiquement |

## Maîtrise par l'équipe

L'équipe relit chaque partie et doit être capable d'expliquer au jury le fonctionnement de toute la solution : sessions par cookie httpOnly et JWT, hachage bcrypt des mots de passe, jetons de réinitialisation à usage unique, limitation des tentatives, protections de sécurité (Helmet, requêtes JSON uniquement), vérification des liens sans risque pour le réseau interne (SSRF), avis réservés aux vrais clients, balises de partage Open Graph.
