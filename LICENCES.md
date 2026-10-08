# Composants tiers et licences

Déclaration exigée par l'article 6 du règlement CADEV 2026. Aucun composant sous licence à réciprocité (GPL, AGPL, LGPL).

## Bibliothèques serveur (npm)

| Composant | Version | Licence |
| --- | --- | --- |
| bcryptjs | 3.0.3 | BSD-3-Clause |
| cookie-parser | 1.4.7 | MIT |
| dotenv | 18.0.6 | BSD-2-Clause |
| express | 5.2.1 | MIT |
| express-rate-limit | 8.7.1 | MIT |
| helmet | 8.3.0 | MIT |
| jsonwebtoken | 9.0.3 | MIT |
| nodemailer | 10.0.16 | MIT-0 |
| pg | 8.23.1 | MIT |

Toutes les dépendances indirectes sont sous licences permissives (MIT, ISC, BSD, Apache-2.0, MIT-0). Vérification :

```
npx license-checker-rseidelsohn --production --onlyAllow "MIT;ISC;BSD-2-Clause;BSD-3-Clause;Apache-2.0;MIT-0;0BSD;BlueOak-1.0.0" --excludePackages palabre@0.1.0
```

## Police

| Composant | Licence |
| --- | --- |
| Bricolage Grotesque (fichiers dans `public/fonts`) | SIL Open Font License 1.1 (`public/fonts/LICENSE-OFL.txt`) |

## Base de données

PostgreSQL : PostgreSQL License (permissive).

## Code de l'équipe

Le reste du code (dossiers `src`, `public`, `tests`) a été écrit par l'équipe Palabre pendant le concours.
