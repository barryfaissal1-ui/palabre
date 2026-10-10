// Crée ou met à jour les tables : `npm run migrate` (force l'application), et à chaque démarrage du serveur.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pool } = require('./pool');

const VERROU_MIGRATION = 20261025; // numéro arbitraire, propre à Palabre
const ESSAIS = 5;
// 40P01 : interblocage détecté par PostgreSQL ; 55P03 : verrou non obtenu à temps.
const A_REESSAYER = new Set(['40P01', '55P03']);

// Applique schema.sql, SEULEMENT s'il a changé depuis la dernière fois.
//
// Pourquoi : pour ajouter une colonne ou une contrainte, PostgreSQL verrouille la table entière, même quand il n'y a
// finalement rien à faire. Rejouer tout le fichier à chaque démarrage verrouillait donc presque toutes les tables,
// l'une après l'autre. Si le site écrivait au même moment (un autre fichier de tests, le serveur de développement),
// les deux pouvaient s'attendre l'un l'autre : PostgreSQL en arrêtait un (« interblocage détecté »). C'est ce qui
// faisait échouer des tests au hasard, surtout au premier lancement après un git pull.
//
// Maintenant : on garde l'empreinte (SHA-256) du fichier appliqué dans la table « schema_applique ». Même empreinte :
// rien n'est rejoué, aucune table n'est verrouillée. Fichier modifié : il est appliqué une fois, et si un
// interblocage survient quand même pendant cette unique fois, on réessaie.
async function migrer({ forcer = false } = {}) {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  // Les fins de ligne (Windows ou Linux) ne doivent pas changer l'empreinte.
  const empreinte = crypto.createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
  for (let essai = 1; ; essai += 1) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Verrou : si deux serveurs (ou deux fichiers de tests) démarrent en même temps,
      // le second attend que le premier ait fini, puis constate qu'il n'y a plus rien à faire.
      await client.query('SELECT pg_advisory_xact_lock($1)', [VERROU_MIGRATION]);
      await client.query('CREATE TABLE IF NOT EXISTS schema_applique (unique_ligne BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (unique_ligne), empreinte TEXT NOT NULL, applique_le TIMESTAMPTZ NOT NULL DEFAULT now())');
      const { rows } = await client.query('SELECT empreinte FROM schema_applique');
      const aJour = !forcer && rows[0] && rows[0].empreinte === empreinte;
      if (!aJour) {
        await client.query(sql);
        await client.query(
          `INSERT INTO schema_applique (unique_ligne, empreinte) VALUES (TRUE, $1)
           ON CONFLICT (unique_ligne) DO UPDATE SET empreinte = EXCLUDED.empreinte, applique_le = now()`,
          [empreinte],
        );
      }
      await client.query('COMMIT');
      return { applique: !aJour };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (!A_REESSAYER.has(err.code) || essai >= ESSAIS) throw err;
      await new Promise((suite) => setTimeout(suite, 200 * essai)); // on laisse passer l'autre, puis on recommence
    } finally {
      client.release();
    }
  }
}

if (require.main === module) {
  // À la main, on applique toujours : c'est la commande à lancer si la base a été modifiée en dehors du site.
  migrer({ forcer: true })
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
