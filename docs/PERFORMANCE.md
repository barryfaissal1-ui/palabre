# Performance en 3G

Mesures faites le 10 octobre 2026, avant et après les optimisations de la partie « prêt pour la mise en ligne ».

## Comment c'est mesuré

- Chrome piloté par un script, écran de téléphone (390 px, écran dense ×2).
- **3G simulée** : 400 kb/s en téléchargement et en envoi, 400 ms d'attente par requête.
- Le service worker est mis de côté, pour mesurer le vrai réseau.
- **1re visite** : cache du navigateur vidé. **2e visite** : la même page rouverte juste après.
- Site local avec le contenu de démonstration (`npm run demo`), connecté avec un compte de démonstration pour le fil et le profil.

Le cahier des charges demandait Playwright. La mesure a été faite avec le même mécanisme (le protocole de pilotage de Chrome, celui que Playwright utilise lui-même pour brider le réseau), mais sans installer Playwright : cela évitait une dépendance de plus de 150 Mo pour une mesure ponctuelle.

« Affichage » = le moment où la page est construite (`DOMContentLoaded`). « Chargée » = tout ce que la page demande au départ est arrivé (`load`).

## Résultats

### Première visite (rien en cache)

| Page | Poids avant | Poids après | Affichage avant | Affichage après | Chargée avant | Chargée après |
| --- | --- | --- | --- | --- | --- | --- |
| Accueil | 564 Ko | **260 Ko** | 9,7 s | **3,3 s** | 11,9 s | **5,7 s** |
| Connexion | 355 Ko | **169 Ko** | 6,5 s | **2,9 s** | 7,8 s | **4,2 s** |
| Fil | 437 Ko | **207 Ko** | 6,5 s | **2,9 s** | 6,5 s | **2,9 s** |
| Profil | 426 Ko | **238 Ko** | 6,3 s | **2,8 s** | 6,3 s | **2,8 s** |

### Deuxième visite (cache du navigateur)

| Page | Requêtes au réseau avant | après | Poids avant | Poids après | Chargée avant | Chargée après |
| --- | --- | --- | --- | --- | --- | --- |
| Accueil | 22 | **7** | 17 Ko | **6 Ko** | 1,8 s | **0,9 s** |
| Connexion | 16 | **6** | 15 Ko | **6 Ko** | 1,9 s | **1,0 s** |
| Fil | 21 | **8** | 16 Ko | **7 Ko** | 1,6 s | **0,9 s** |
| Profil | 18 | **7** | 15 Ko | **6 Ko** | 1,5 s | **0,5 s** |

En résumé : les pages pèsent environ **deux fois moins** et s'affichent en **3 secondes au lieu de 6 à 10** à la première visite.

## Ce qui était lourd, et ce qui a été fait

| Problème constaté | Correction | Gain |
| --- | --- | --- |
| La feuille de style (101 Ko) et les scripts partaient sans compression | Compression des réponses en texte (paquet `compression`, licence MIT) : pages, style, scripts, icônes SVG, réponses de l'API | style : 101 → 26 Ko ; `app.js` : 41 → 14 Ko |
| Le logo de l'en-tête était un PNG de 256 px (50 Ko) affiché en 32 px, sur toutes les pages | Nouveau fichier `logo-96.webp` | 50 → 3 Ko par page |
| L'arbre de l'accueil (PNG de 132 Ko) était téléchargé même quand il est caché par la photo de fond | Version WebP (27 Ko) et `loading="lazy"` : une image cachée n'est plus téléchargée | 132 → 0 Ko quand il y a une photo |
| À chaque visite, le navigateur redemandait au serveur si chaque fichier avait changé (une vingtaine de requêtes, 400 ms chacune) | Adresse **versionnée** pour le style et les scripts (`/css/style.css?v=empreinte`), gardés un an sans rien redemander ; polices gardées un an ; logos et photos 30 jours | 22 → 7 requêtes à la 2e visite |
| Miniatures YouTube de 480 px (environ 30 Ko chacune) sur téléphone | Petite miniature (320 px) sur téléphone | environ 15 Ko de moins par vidéo |
| Photos de profil chargées même hors de l'écran | `loading="lazy"` sur les avatars | variable |

## Ce qui reste, et pourquoi

- **Photo de fond de l'accueil (81 Ko)** : c'est le fichier le plus lourd de la première visite. Elle est déjà en WebP à 1080 px. On pourrait en faire une version de 720 px pour les téléphones (environ 40 Ko).
- **Icône 192 px (33 Ko)** : demandée par le navigateur lui-même à cause du manifeste de l'application installable. Elle n'est téléchargée qu'une fois.
- **Deux polices (22 Ko chacune)** : Bricolage en deux graisses, gardées un an.
- **Couverture d'un profil (jusqu'à 80 Ko)** : image choisie par le membre, déjà réduite dans son navigateur.
- Le service worker télécharge en arrière-plan les pages du site après la première visite (pour le hors-ligne). Ce téléchargement se fait une fois, après l'affichage, et n'est pas compté ci-dessus.

## Refaire la mesure

Sur le site en ligne, le plus simple : les outils de développement de Chrome, onglet « Réseau », réglage « 3G lente », cache désactivé. Comparer avec les chiffres ci-dessus.
