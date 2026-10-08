// Crée ou met à jour les tables : `npm run migrate`.
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('./pool');

const VERROU_MIGRATION = 20261025; // numéro arbitraire, propre à Palabre

async function migrer() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Verrou : si deux serveurs (ou deux fichiers de tests) démarrent en même temps,
    // le second attend que le premier ait fini au lieu de créer les mêmes tables en double.
    await client.query('SELECT pg_advisory_xact_lock($1)', [VERROU_MIGRATION]);
    await client.query(sql);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
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
