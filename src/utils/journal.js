// Journal de sécurité d'un compte (table « journal_securite ») : ce qui s'est passé d'important, et depuis quel
// appareil. Le membre le lit dans /parametres, rubrique Sécurité : c'est ce qui lui permet de voir par lui-même
// qu'un inconnu a essayé d'entrer. On n'y garde ni adresse IP ni texte libre : un type, un appareil, une date.
const db = require('../db/pool');
const { typeAppareil } = require('./sessions');

const TYPES = ['connexion', 'connexion_refusee', 'nouvel_appareil', 'mot_de_passe_change', 'email_change',
  'deux_etapes_active', 'deux_etapes_coupee', 'session_revoquee', 'compte_desactive', 'compte_reactive'];
const NB_AFFICHES = 30;
const DUREE_JOURS = 90;

// journaliser(membre, 'connexion', req) : l'appareil est lu dans la requête (« Chrome sur Android »).
// Pour « session_revoquee », on passe plutôt le nom de l'appareil qui vient d'être déconnecté ({ appareil }).
// Dans une transaction, passer le client en dernier : l'événement n'existe que si l'action a vraiment eu lieu.
async function journaliser(utilisateurId, type, req, { appareil } = {}, executeur = db) {
  if (!TYPES.includes(type)) throw new Error(`Type d'événement inconnu : ${type}`);
  const nom = appareil !== undefined ? appareil : typeAppareil(req && req.get ? req.get('user-agent') : '');
  await executeur.query('INSERT INTO journal_securite (utilisateur_id, type, appareil) VALUES ($1, $2, $3)', [utilisateurId, type, nom]);
}

// Les 30 derniers événements du membre, le plus récent d'abord.
async function journalDe(utilisateurId) {
  const { rows } = await db.query(
    `SELECT type, appareil, cree_le FROM journal_securite
      WHERE utilisateur_id = $1 AND cree_le > now() - make_interval(days => $2) ORDER BY id DESC LIMIT $3`,
    [utilisateurId, DUREE_JOURS, NB_AFFICHES],
  );
  return rows.map((ligne) => ({ type: ligne.type, appareil: ligne.appareil, le: ligne.cree_le }));
}

// Le journal n'est gardé que 90 jours (appelé par la tâche de ménage, src/utils/purge.js). Renvoie le nombre de lignes retirées.
async function purgerJournal() {
  const { rowCount } = await db.query('DELETE FROM journal_securite WHERE cree_le < now() - make_interval(days => $1)', [DUREE_JOURS]);
  return rowCount;
}

module.exports = { TYPES, NB_AFFICHES, DUREE_JOURS, journaliser, journalDe, purgerJournal };
