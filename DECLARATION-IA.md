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
| Interface (`public/`) | Générée par l'IA, adaptée par l'équipe |
| Logo et icônes | Première version générée par l'IA |

## Maîtrise par l'équipe

L'équipe relit chaque partie et doit être capable d'expliquer au jury le fonctionnement de toute la solution : sessions par cookie httpOnly et JWT, hachage bcrypt des mots de passe, jetons de réinitialisation à usage unique, limitation des tentatives, protections de sécurité (Helmet, requêtes JSON uniquement).
