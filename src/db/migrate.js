// Crée ou met à jour les tables : `npm run migrate`.
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('./pool');

async function migrer() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
}

if (require.main === module) {
  migrer()
    .then(() => {
      console.log('Base de données à jour.');
      return pool.end();
    })
    .catch((err) => {
      console.error('Échec de la migration :', err.message);
      process.exit(1);
    });
}

module.exports = { migrer };
