# Composants tiers et licences

Déclaration exigée par l'article 6 du règlement CADEV 2026. Aucun composant sous licence à réciprocité (GPL, AGPL, LGPL).

## Bibliothèques serveur (npm)

| Composant | Version | Licence |
| --- | --- | --- |
| bcryptjs | 3.0.3 | BSD-3-Clause |
| compression | 1.8.2 | MIT |

Les notifications push n'utilisent **aucune bibliothèque** : `web-push`, la plus répandue, est sous licence MPL-2.0, qui n'est pas dans la liste permise par le concours. Le chiffrement et la signature sont écrits dans `src/utils/push.js` avec le module `crypto` de Node.js, d'après les normes publiques RFC 8291, RFC 8188 et RFC 8292.

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

## Outils de développement (npm, absents du site en ligne)

| Composant | Version | Licence | Usage |
| --- | --- | --- | --- |
| @jsquash/jpeg | 1.6.0 | Apache-2.0 | lire et écrire les JPEG (`npm run photos`) |
| @jsquash/png | 3.1.1 | Apache-2.0 | lire les PNG |
| @jsquash/resize | 2.1.1 | Apache-2.0 | réduire les photos à 1080 px |
| @jsquash/webp | 1.5.0 | Apache-2.0 | écrire les WebP |

Ces outils ne servent qu'à préparer les photos de fond sur l'ordinateur de l'équipe ; le serveur en ligne ne les charge jamais.
La bibliothèque `sharp` a été écartée : son code est sous Apache-2.0, mais les binaires `libvips` qu'elle installe sont sous **LGPL-3.0**, licence interdite par le règlement.

## Photos de fond (`public/img/fond/`)

Photos affichées en haut de l'accueil et dans le panneau vert de la page de connexion. Elles viennent de Pexels et d'Unsplash, dont les licences permettent l'usage gratuit, y compris commercial, sans obligation de citer l'auteur. L'équipe note quand même la source de chaque photo :

| Fichier | Auteur | Source | Lien de la photo |
| --- | --- | --- | --- |
| `fond-1-*` | Naboth Otieno | Pexels | https://www.pexels.com/photo/man-working-on-computer-in-an-office-19805876/ |
| `fond-2-*` | Tima Miroshnichenko | Pexels | https://www.pexels.com/photo/man-in-red-and-black-plaid-dress-shirt-using-laptop-5702315/ |
| `fond-3-*` | Domingos Henriques | Pexels | https://www.pexels.com/photo/woman-sitting-and-working-in-office-17471222/ |
| `fond-4-*` | Mikhail Nilov | Pexels | https://www.pexels.com/photo/a-man-sitting-on-a-chair-inside-a-conference-room-smiling-at-the-camera-9301747/ |
| `fond-5-*` | Studio Dydx Dominic | Pexels | https://www.pexels.com/photo/team-collaborating-on-engineering-project-39850239/ |

Les photos ont été recadrées en 16:9 et étalonnées aux couleurs de Palabre (blancs vers la crème du site, ombres vers le vert feuillage, couleurs vives adoucies), puis exportées en deux tailles : 1080 px (téléphones) et 1920 px (ordinateurs), en WebP avec une copie JPEG. Usage : fond décoratif uniquement, sans nom ni légende, sans laisser croire que ces personnes sont membres de Palabre ou recommandent le site (règle de la licence Pexels).

Licences : https://www.pexels.com/license/ et https://unsplash.com/license

## Icônes

| Composant | Version | Licence |
| --- | --- | --- |
| Lucide (38 icônes, rangées dans `public/icons/icones.svg`) | 1.53.0 | ISC (`public/icons/LICENSE-LUCIDE.txt`) |

Le motif du fond des pages de connexion et d'inscription (`public/icons/motif-acces.svg`) reprend 12 autres tracés Lucide (même licence) et 2 dessins de l'équipe, signalés en commentaire dans le fichier.

Les tracés des icônes sont repris tels quels du paquet `lucide-static` ; le nom d'origine de chaque icône est noté en commentaire dans le fichier. Ce n'est pas une dépendance npm : seul le fichier SVG est dans le projet.

Les illustrations des états vides (`public/icons/illustrations.svg`) et le motif de la bannière des profils (`public/icons/motif-banniere.svg`) ont été dessinés par l'équipe pour le concours.

## Police

| Composant | Licence |
| --- | --- |
| Bricolage Grotesque (fichiers dans `public/fonts`) | SIL Open Font License 1.1 (`public/fonts/LICENSE-OFL.txt`) |

## Base de données

PostgreSQL : PostgreSQL License (permissive).

## Code de l'équipe

Le reste du code (dossiers `src`, `public`, `tests`) a été écrit par l'équipe Palabre pendant le concours.
