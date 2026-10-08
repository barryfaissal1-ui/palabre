// Donne ou retire le rôle administrateur à un compte existant.
//   npm run admin -- email@exemple.com            donne le rôle
//   npm run admin -- email@exemple.com retirer    le retire
// Il n'existe volontairement aucune page ni route pour cela : il faut avoir accès au serveur.
const { pool } = require('./pool');

async function changerRole(email, admin) {
  const { rows } = await pool.query(
    'UPDATE utilisateurs SET est_admin = $2 WHERE email = $1 RETURNING nom, identifiant',
    [String(email).trim().toLowerCase(), admin],
  );
  return rows[0] || null;
}

if (require.main === module) {
  const [email, option] = process.argv.slice(2);
  if (!email) {
    console.error('Indique l\'email du compte : npm run admin -- email@exemple.com');
    process.exit(1);
  }
  const admin = option !== 'retirer';
  changerRole(email, admin)
    .then((membre) => {
      if (!membre) {
        console.error(`Aucun compte avec l'email ${email}. Inscris-toi d'abord sur le site.`);
        process.exitCode = 1;
      } else {
        console.log(`${membre.nom} (${membre.identifiant}) ${admin ? 'est maintenant administrateur' : 'n\'est plus administrateur'}.`);
      }
      return pool.end();
    })
    .catch((err) => {
      console.error('Échec :', err.message);
      process.exit(1);
    });
}

module.exports = { changerRole };
