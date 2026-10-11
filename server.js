// Point d'entrée : met la base à jour puis démarre le serveur.
// La configuration est lue en premier : s'il manque un réglage indispensable en production (clé secrète, adresse
// du site, base de données), le serveur s'arrête tout de suite avec un message clair, au lieu de démarrer mal réglé.
let config;
try {
  config = require('./src/config');
} catch (err) {
  console.error(`Configuration invalide : ${err.message}`);
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
