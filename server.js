// Point d'entrée : met la base à jour puis démarre le serveur.
// La configuration est lue en premier : s'il manque un réglage indispensable en production (clé secrète, adresse
// du site, base de données), le serveur s'arrête tout de suite avec un message clair, au lieu de démarrer mal réglé.
let config;
try {
  config = require('./src/config');
} catch (err) {
  // Aide au diagnostic chez l'hébergeur, sur la même ligne (certains journaux n'en montrent qu'une) : quelles
  // variables sont bien arrivées (longueur seulement, jamais la valeur d'un secret). URL_PUBLIQUE n'est pas secrète :
  // on l'affiche entre guillemets pour voir un espace en trop.
  const attendues = ['NODE_ENV', 'URL_PUBLIQUE', 'DATABASE_URL', 'DATABASE_SSL', 'JWT_SECRET', 'PORT'];
  const recues = attendues.map((nom) => {
    const valeur = process.env[nom];
    if (valeur === undefined) return `${nom} absente`;
    return nom === 'URL_PUBLIQUE' ? `${nom}=${JSON.stringify(valeur)}` : `${nom} (${valeur.length} caractères)`;
  }).join(', ');
  console.error(`Configuration invalide : ${err.message} [Variables reçues : ${recues}]`);
  process.exit(1);
}
const { creerApp } = require('./src/app');
const { migrer } = require('./src/db/migrate');
const { lancerMenage } = require('./src/utils/purge');

// Hôte et port de la base, pour le journal (jamais l'utilisateur ni le mot de passe).
function hoteDeLaBase() {
  try {
    const url = new URL(config.databaseUrl);
    return `${url.hostname}:${url.port || 5432}`;
  } catch {
    return 'adresse illisible';
  }
}

// Chez l'hébergeur, la base peut mettre un moment à accepter les connexions juste après un déploiement :
// on réessaie plusieurs fois avant d'abandonner, au lieu de s'arrêter au premier délai dépassé.
async function migrerAvecEssais(essais = 6, pauseMs = 10000) {
  for (let n = 1; ; n += 1) {
    try {
      await migrer();
      return;
    } catch (err) {
      // Seul un délai dépassé vaut un nouvel essai : un refus net (mauvais port, mot de passe faux) est définitif.
      if (n >= essais || !/timeout|ETIMEDOUT|EAI_AGAIN/i.test(`${err.message} ${err.code || ''}`)) throw err;
      console.warn(`Base de données injoignable (${hoteDeLaBase()}), essai ${n}/${essais} : ${err.message}. Nouvel essai dans ${pauseMs / 1000} s.`);
      await new Promise((r) => setTimeout(r, pauseMs));
    }
  }
}

async function demarrer() {
  await migrerAvecEssais();
  const app = creerApp();
  app.listen(config.port, () => {
    console.log(`Palabre démarré sur le port ${config.port} (${config.production ? `production, ${config.urlPublique}` : 'développement'})`);
    if (config.production && !config.smtp.host) {
      console.warn('ATTENTION : SMTP_HOST est vide. Les codes de confirmation et les liens de mot de passe ne partiront pas par email : ils ne seront écrits que dans ce journal.');
    }
    // Le ménage (comptes à supprimer après 30 jours, corbeille, journal de sécurité, sessions périmées) :
    // une fois maintenant, puis toutes les heures.
    lancerMenage();
  });
}

demarrer().catch((err) => {
  console.error(`Impossible de démarrer : ${err.message} (base ${hoteDeLaBase()})`);
  process.exit(1);
});
