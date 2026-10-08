// Signalements : un membre prévient l'équipe qu'une publication, un commentaire ou un profil pose problème.
// Les signalements seront traités dans le tableau de bord administrateur.
const express = require('express');
const db = require('../db/pool');
const v = require('../utils/validation');
const { exigerConnexion } = require('../middleware/auth');
const { limiteParMembre } = require('../utils/membres');

const router = express.Router();
const limiteSignalements = limiteParMembre(20, 60, 'Trop de signalements. Réessaie plus tard.');

// Pour chaque type de cible : comment retrouver sa ligne et son auteur.
// Un profil est désigné par son identifiant public, le reste par son numéro.
const CIBLES = {
  publication: (cible) => ['SELECT id, auteur_id FROM publications WHERE id = $1', v.idPositif(cible)],
  commentaire: (cible) => ['SELECT id, auteur_id FROM commentaires WHERE id = $1', v.idPositif(cible)],
  profil: (cible) => [
    'SELECT id, id AS auteur_id FROM utilisateurs WHERE identifiant = $1',
    typeof cible === 'string' ? cible.trim().toLowerCase() : null,
  ],
};

// Signaler : POST /api/signalements  { cibleType, cible, motif }
router.post('/', exigerConnexion, limiteSignalements, async (req, res) => {
  const corps = req.body || {};
  const moi = req.utilisateur;
  const cibleType = v.parmi(corps.cibleType, Object.keys(CIBLES), 'cibleType');
  const motif = v.texte(corps.motif, 'motif', { min: 3, max: 500 });

  const [requete, valeur] = CIBLES[cibleType](corps.cible);
  const { rows } = valeur === null ? { rows: [] } : await db.query(requete, [valeur]);
  if (!rows[0]) return res.status(404).json({ erreur: 'Ce contenu n\'existe plus.' });
  if (rows[0].auteur_id === moi.id) {
    throw new v.ErreurValidation('Tu ne peux pas signaler ton propre contenu.', 'cible');
  }

  // Un membre ne signale qu'une fois la même cible (contrainte UNIQUE de la table).
  const { rowCount } = await db.query(
    `INSERT INTO signalements (auteur_id, cible_type, cible_id, motif) VALUES ($1, $2, $3, $4)
     ON CONFLICT (auteur_id, cible_type, cible_id) DO NOTHING`,
    [moi.id, cibleType, rows[0].id, motif],
  );
  res.status(rowCount ? 201 : 200).json({ ok: true, dejaSignale: rowCount === 0 });
});

module.exports = router;
