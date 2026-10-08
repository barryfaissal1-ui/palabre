// Connexion unique (pool) à PostgreSQL, partagée par toute l'application.
const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
});

pool.on('error', (err) => {
  console.error('Erreur inattendue de la base de données :', err.message);
});

module.exports = {
  pool,
  query: (texte, valeurs) => pool.query(texte, valeurs),
};
