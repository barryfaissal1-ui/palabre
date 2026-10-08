// Point d'entrée : met la base à jour puis démarre le serveur.
const config = require('./src/config');
const { creerApp } = require('./src/app');
const { migrer } = require('./src/db/migrate');

async function demarrer() {
  await migrer();
  const app = creerApp();
  app.listen(config.port, () => {
    console.log(`Palabre démarré sur le port ${config.port}`);
  });
}

demarrer().catch((err) => {
  console.error('Impossible de démarrer :', err.message);
  process.exit(1);
});
