// Connexion unique (pool) à PostgreSQL, partagée par toute l'application.
const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
  // Toutes les connexions occupées, ou base injoignable : une erreur après 10 secondes plutôt qu'une attente sans fin.
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('Erreur inattendue de la base de données :', err.message);
});

// Exécute plusieurs requêtes en « tout ou rien » : si l'une échoue, aucune n'est gardée.
// travail reçoit le client à utiliser pour toutes les requêtes de la transaction.
async function transaction(travail) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resultat = await travail(client);
    await client.query('COMMIT');
    return resultat;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  transaction,
  query: (texte, valeurs) => pool.query(texte, valeurs),
};
