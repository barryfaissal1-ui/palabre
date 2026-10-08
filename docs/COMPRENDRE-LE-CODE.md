# Comprendre le code de Palabre

Ce guide explique comment Palabre fonctionne, partie par partie, pour que chaque membre de l'équipe puisse le présenter et répondre aux questions du jury. Il est complété à chaque nouvelle fonctionnalité.

## 1. Vue d'ensemble

Palabre est une application web en trois couches :

```
Navigateur (public/)  ──  requêtes /api/...  ──>  Serveur Node.js (src/)  ──  SQL  ──>  PostgreSQL
   pages HTML, CSS, JS                               Express, règles, sécurité            les données
```

- **Le navigateur** affiche les pages et envoie les actions de la personne (s'inscrire, modifier son profil…).
- **Le serveur** reçoit ces demandes sur des adresses `/api/...`, vérifie tout (qui demande, données valides), puis lit ou écrit dans la base.
- **La base PostgreSQL** garde toutes les données : comptes, profils, compétences, photos…

Le navigateur ne parle jamais directement à la base : tout passe par le serveur, qui contrôle.

## 2. Le démarrage (`server.js`)

1. `migrer()` lit `src/db/schema.sql` et crée les tables qui n'existent pas encore. Le script peut être relancé sans risque (`CREATE TABLE IF NOT EXISTS`).
2. `creerApp()` (dans `src/app.js`) construit l'application avec ses protections et ses routes.
3. Le serveur écoute sur le port indiqué par `PORT`.

## 3. La sécurité, en résumé

| Menace | Protection dans Palabre | Où |
| --- | --- | --- |
| Vol de mots de passe dans la base | Mots de passe jamais stockés en clair : seulement leur empreinte **bcrypt** (coût 12) | `src/routes/auth.js` |
| Vol de session par un script | Session dans un cookie **httpOnly** (invisible au JavaScript), `secure` en production, `SameSite=Lax` | `src/middleware/auth.js` |
| Requêtes forgées depuis un autre site (CSRF) | Toute modification doit être envoyée en JSON, ce qu'un formulaire d'un autre site ne peut pas faire, plus `SameSite=Lax` | `src/app.js` |
| Essais de mots de passe en masse | Limite de 20 tentatives par 15 minutes | `src/routes/auth.js` |
| Découvrir qui est inscrit | Même message que l'email existe ou non (connexion, mot de passe oublié), même temps de réponse | `src/routes/auth.js` |
| Injection de code dans les pages (XSS) | Le texte des membres est toujours inséré avec `textContent`, jamais interprété comme du HTML ; politique de sécurité du contenu (CSP) stricte via **Helmet** | `public/js/app.js`, `src/app.js` |
| Injection SQL | Toutes les requêtes utilisent des paramètres (`$1`, `$2`…), jamais de texte collé dans le SQL | partout dans `src/routes` |
| Faux fichiers images | Vérification du vrai format par les premiers octets du fichier, taille limitée à 500 Ko | `src/utils/images.js` |
| Collecte de numéros de téléphone | Le numéro WhatsApp n'est montré qu'aux membres connectés ; l'email n'est jamais public | `src/routes/profils.js` |

## 4. Inscription, connexion, mot de passe oublié

**Inscription** (`POST /api/auth/inscription`) : les champs sont vérifiés (`src/utils/validation.js`), le mot de passe est transformé en empreinte bcrypt, un identifiant de profil est créé à partir du nom (« Barry Faïssal » devient `barry-faissal`, ou `barry-faissal-2` s'il est déjà pris), puis la session est ouverte.

**Connexion** (`POST /api/auth/connexion`) : on compare le mot de passe à l'empreinte. Si l'email n'existe pas, on compare quand même avec une fausse empreinte, pour que la réponse prenne le même temps.

**Session** : un jeton JWT signé avec `JWT_SECRET`, valable 30 jours, rangé dans un cookie httpOnly. À chaque requête, `chargerUtilisateur` vérifie le jeton et retrouve le membre.

**Mot de passe oublié** : un jeton aléatoire de 64 caractères est envoyé par email. La base ne garde que son empreinte SHA-256 : même quelqu'un qui lirait la base ne pourrait pas s'en servir. Le lien expire au bout d'une heure et ne sert qu'une fois.

## 5. Les profils

**Lien court** : `palabre.dev/aminata-dev` affiche le profil d'Aminata. Le serveur renvoie la page `profil.html` pour toute adresse qui ressemble à un identifiant ; la page lit l'identifiant dans l'adresse et demande les données à `GET /api/profils/aminata-dev`. Certains mots sont réservés (`connexion`, `fil`, `admin`…) pour ne jamais entrer en conflit avec les pages du site.

**Ce que voit chacun :**

| Information | Visiteur | Membre connecté | Le propriétaire |
| --- | --- | --- | --- |
| Nom, ville, pays, présentation, compétences, disponibilité | oui | oui | oui |
| Numéro WhatsApp | non (bouton « Se connecter pour contacter ») | oui (bouton « Contacter sur WhatsApp ») | oui |
| Email | jamais | jamais | seulement via son compte |

**Modification** (`PUT /api/profils/moi`) : nom, lien du profil, pays, ville, WhatsApp, présentation (500 caractères), disponibilité et jusqu'à 15 compétences. Tout est enregistré dans une **transaction** : soit tout est enregistré, soit rien (pas de profil à moitié modifié en cas de coupure).

**Compétences** : une liste fixe (table `competences`) reliée aux membres par la table `utilisateur_competences`. Une liste fixe permet ensuite de chercher « tous les devs Flutter à Ouagadougou » de façon fiable.

## 6. Les photos de profil

1. **Dans le navigateur** (`public/js/modifier-profil.js`) : la photo choisie est recadrée en carré, réduite à 400 × 400 pixels et compressée en JPEG. Une photo de 4 Mo prise au téléphone devient environ 40 Ko : l'envoi est rapide même en 3G.
2. **Sur le serveur** (`src/utils/images.js`) : on vérifie le format réel du fichier et sa taille (500 Ko maximum).
3. **Stockage** : l'image est rangée dans la table `fichiers` de la base. Avantage : elle survit aux redéploiements du serveur, sans payer un service de stockage en plus. L'ancienne photo est supprimée quand on en met une nouvelle.
4. **Affichage** : `GET /fichiers/<identifiant>` renvoie l'image avec un cache d'un an. Chaque nouvelle photo reçoit un nouvel identifiant, donc le navigateur ne retélécharge jamais une photo déjà vue : encore des données mobiles économisées.

## 7. L'application installable (PWA)

- `public/manifest.json` : nom, couleurs et icônes de l'appli quand on l'ajoute à l'écran d'accueil.
- `public/sw.js` : le « service worker » garde une copie des fichiers de l'interface. Les pages s'ouvrent vite, même avec une connexion faible. Les données (`/api`) ne sont jamais mises en cache, pour toujours être à jour. À chaque modification de l'interface, on augmente `VERSION` pour forcer la mise à jour chez tout le monde.

## 8. Les tests automatiques

`npm test` lance des tests qui démarrent un vrai serveur et vérifient, entre autres : inscription, refus d'un mauvais mot de passe, protection CSRF, modification de profil, identifiants réservés, confidentialité du numéro WhatsApp, envoi et remplacement de photo, refus d'un faux fichier image.

## 9. Questions probables du jury

- **Pourquoi pas de framework (React…) côté interface ?** Pour des pages très légères, rapides sur les téléphones modestes et en 3G, sans étape de compilation.
- **Pourquoi PostgreSQL ?** Les données de Palabre sont très reliées entre elles (membres, amis, demandes, équipes, avis) : une base relationnelle garantit leur cohérence.
- **Comment empêchez-vous les faux avis ?** Un avis n'est accepté que si le client est l'auteur de la demande, qu'elle est terminée, et que le dev faisait partie de la proposition retenue (règle vérifiée par le serveur).
- **Que se passe-t-il si quelqu'un vole la base ?** Il n'obtient ni mots de passe (empreintes bcrypt) ni liens de réinitialisation utilisables (empreintes SHA-256).
