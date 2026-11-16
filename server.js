// Point d'entrée : met la base à jour puis démarre le serveur.
// La configuration est lue en premier : s'il manque un réglage indispensable en production (clé secrète, adresse
// du site, base de données), le serveur s'arrête tout de suite avec un message clair, au lieu de démarrer mal réglé.
let config;
try {
  config = require('./src/config');
} catch (err) {
  console.error(`Configuration invalide : ${err.message}`);
  // Aide au diagnostic chez l'hébergeur : quelles variables sont bien arrivées (longueur seulement, jamais la
  // valeur d'un secret). URL_PUBLIQUE n'est pas secrète : on l'affiche entre guillemets pour voir un espace en trop.
  const attendues = ['NODE_ENV', 'URL_PUBLIQUE', 'DATABASE_URL', 'DATABASE_SSL', 'JWT_SECRET', 'PORT'];
  console.error('Variables reçues : ' + attendues.map((nom) => {
    const valeur = process.env[nom];
    if (valeur === undefined) return `${nom} absente`;
    return nom === 'URL_PUBLIQUE' ? `${nom}=${JSON.stringify(valeur)}` : `${nom} (${valeur.length} caractères)`;
  }).join(', '));
  process.exit(1);
}
const { creerApp } = require('./src/app');
const { migrer } = require('./src/db/migrate');
const { lancerMenage } = require('./src/utils/purge');

async function demarrer() {
  await migrer();
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
  console.error('Impossible de démarrer :', err.message);
  process.exit(1);
});
