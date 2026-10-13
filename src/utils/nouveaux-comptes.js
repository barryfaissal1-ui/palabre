// Les trois premiers jours d'un compte.
//
// Un compte créé pour faire du spam agit vite : des liens partout, des dizaines de publications, des demandes d'ami
// à tout le monde. Pendant ses 3 premiers jours, un compte ne peut donc ni mettre de lien (publications,
// commentaires, présentation), ni dépasser 5 publications, 20 commentaires et 10 demandes d'ami par jour.
// Un vrai membre ne s'en aperçoit presque pas ; un robot est arrêté tout de suite.
// Les comptes de démonstration (…@demo.palabre.dev) et les administrateurs ne sont pas concernés.
const db = require('../db/pool');
const { ErreurValidation, ErreurHttp } = require('./validation');
const { contientUnLien } = require('./moderation');

const DUREE_JOURS = 3;
const LIMITES = { publication: 5, commentaire: 20, demande_ami: 10 };
const COMPTAGES = {
  publication: 'SELECT count(*)::int AS nb FROM publications WHERE auteur_id = $1 AND cree_le > now() - interval \'24 hours\'',
  commentaire: 'SELECT count(*)::int AS nb FROM commentaires WHERE auteur_id = $1 AND cree_le > now() - interval \'24 hours\'',
  demande_ami: 'SELECT count(*)::int AS nb FROM amities WHERE demandeur_id = $1 AND cree_le > now() - interval \'24 hours\'',
};
const PHRASES = {
  publication: `Pendant tes ${DUREE_JOURS} premiers jours sur Palabre, tu peux publier ${LIMITES.publication} fois par jour. Reviens demain.`,
  commentaire: `Pendant tes ${DUREE_JOURS} premiers jours sur Palabre, tu peux écrire ${LIMITES.commentaire} commentaires par jour. Reviens demain.`,
  demande_ami: `Pendant tes ${DUREE_JOURS} premiers jours sur Palabre, tu peux envoyer ${LIMITES.demande_ami} demandes d'ami par jour. Reviens demain.`,
};

const estDeDemonstration = (utilisateur) => /@demo\.palabre\.dev$/.test(utilisateur.email || '');
const finDeLaPeriode = (utilisateur) => new Date(new Date(utilisateur.cree_le).getTime() + DUREE_JOURS * 24 * 3600 * 1000);

function estNouveau(utilisateur) {
  if (utilisateur.est_admin || estDeDemonstration(utilisateur)) return false;
  return finDeLaPeriode(utilisateur).getTime() > Date.now();
}

// « 14/10/2026 » : jour, mois, année, lu de la même façon en français et en anglais d'Afrique. En heure GMT.
function dateCourte(date) {
  const deux = (n) => String(n).padStart(2, '0');
  return `${deux(date.getUTCDate())}/${deux(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
}

// Pas de lien pendant les 3 premiers jours : [[texte, 'champ'], …]. Le message dit à partir de quand ce sera possible.
function refuserLesLiens(utilisateur, textes) {
  if (!estNouveau(utilisateur)) return;
  for (const [texte, champ] of textes) {
    if (texte && contientUnLien(texte)) {
      throw new ErreurValidation(`Tu pourras ajouter des liens à partir du ${dateCourte(finDeLaPeriode(utilisateur))}.`, champ);
    }
  }
}

// Limite par jour, comptée en base (elle tient donc même si le serveur redémarre). sorte : 'publication',
// 'commentaire' ou 'demande_ami'.
async function limiterNouveauCompte(utilisateur, sorte) {
  if (!estNouveau(utilisateur)) return;
  const { rows: [compte] } = await db.query(COMPTAGES[sorte], [utilisateur.id]);
  if (compte.nb >= LIMITES[sorte]) throw new ErreurHttp(429, PHRASES[sorte]);
}

module.exports = { DUREE_JOURS, LIMITES, estDeDemonstration, estNouveau, finDeLaPeriode, dateCourte, refuserLesLiens, limiterNouveauCompte };
