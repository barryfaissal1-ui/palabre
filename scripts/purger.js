// npm run purger : lance le ménage à la main (le serveur le fait tout seul au démarrage puis toutes les heures).
// Supprime pour de bon les comptes dont la suppression a été demandée il y a 30 jours, vide la corbeille des
// publications de plus de 30 jours, le journal de sécurité de plus de 90 jours, les sessions et les codes périmés.
const { migrer } = require('../src/db/migrate');
const { pool } = require('../src/db/pool');
const { purger } = require('../src/utils/purge');

migrer()
  .then(() => purger())
  .then((bilan) => console.log('Ménage terminé :', JSON.stringify(bilan)))
  .catch((err) => { console.error('Ménage impossible :', err.message); process.exitCode = 1; })
  .finally(() => pool.end());
