// Aides communes aux tests, pour l'inscription en deux étapes.
// La plupart des tests ont besoin de comptes prêts à servir : email confirmé et, pour un dev, profil complet.
// Seul tests/inscription.test.js vérifie les étapes elles-mêmes (code, champ piège, envoi trop rapide, page 2).
const mailer = require('../src/utils/mailer');
const { jetonOuverture } = require('../src/utils/inscription');
const { pool } = require('../src/db/pool');

// Les emails ne partent pas (et n'encombrent pas la console) : ils sont gardés ici pour que les tests les relisent.
const emailsEnvoyes = [];
mailer.envoyerEmail = async (message) => { emailsEnvoyes.push(message); };

// Le dernier code à 6 chiffres envoyé à cette adresse (lu dans le texte de l'email, comme le ferait le membre).
function dernierCode(adresse) {
  const motif = /code de confirmation Palabre : (\d{6})/;
  const message = emailsEnvoyes.filter((m) => m.a === adresse && motif.test(m.texte)).pop();
  return message ? motif.exec(message.texte)[1] : null;
}

// Le dernier email envoyé à cette adresse dont le sujet correspond (alerte de connexion, code de connexion…).
const dernierEmail = (adresse, sujet = /./) => emailsEnvoyes.filter((m) => m.a === adresse && sujet.test(m.sujet)).pop() || null;

// Heure d'ouverture du formulaire, signée comme le fait le serveur, mais datée de 10 secondes plus tôt :
// les tests n'ont pas à attendre les 3 secondes imposées aux inscriptions.
const jetonAncien = () => jetonOuverture(Date.now() - 10000);

// Rend un compte « prêt » directement en base : email confirmé, et profil complet si c'est un dev.
async function validerCompte(email) {
  await pool.query(
    `UPDATE utilisateurs
        SET email_confirme_le = now(), profil_complete_le = CASE WHEN type = 'dev' THEN now() END
      WHERE email = $1`,
    [email],
  );
}

// Enveloppe la fonction « appel » d'un fichier de tests : toute inscription reçoit un jeton d'ouverture valable,
// et le compte créé est aussitôt rendu prêt. Le reste des appels passe tel quel.
function avecComptesPrets(appel) {
  return async (chemin, options = {}) => {
    if (!chemin.endsWith('/auth/inscription')) return appel(chemin, options);
    const reponse = await appel(chemin, { ...options, donnees: { jeton: jetonAncien(), ...options.donnees } });
    if (reponse.statut === 201) await validerCompte(options.donnees.email);
    return reponse;
  };
}

module.exports = { avecComptesPrets, validerCompte, jetonAncien, dernierCode, dernierEmail, emailsEnvoyes };
