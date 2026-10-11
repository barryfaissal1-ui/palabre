// Avis protégés : seul un client qui a vraiment travaillé avec un dev peut le noter.
const express = require('express');
const db = require('../db/pool');
const v = require('../utils/validation');
const { exigerConnexion, exigerClient } = require('../middleware/auth');
const { apercuMembre, COLONNES_MEMBRE, limiteParMembre } = require('../utils/membres');
const { notifier, court } = require('../utils/notifications');

const router = express.Router();
const limiteAvis = limiteParMembre(20, 60, 'Trop d\'avis envoyés. Réessaie plus tard.');

// Avis reçus par un dev, avec leur moyenne (utilisé par routes/profils.js).
// Un client qui a supprimé son compte : son avis reste, sans client ni demande (client: null, « Ancien client » dans la page).
async function avisDe(devId) {
  const { rows } = await db.query(
    `SELECT a.note, a.commentaire, a.cree_le,
            CASE WHEN d.masque THEN NULL ELSE d.titre END AS titre_demande, -- demande masquée par un administrateur : son titre ne ressort pas ici
            ${COLONNES_MEMBRE}
       FROM avis a
       LEFT JOIN utilisateurs u ON u.id = a.client_id
       LEFT JOIN demandes d ON d.id = a.demande_id
      WHERE a.dev_id = $1 AND (a.client_id IS NULL OR u.bloque = FALSE)
      ORDER BY a.id DESC`,
    [devId],
  );
  const somme = rows.reduce((total, ligne) => total + ligne.note, 0);
  return {
    avis: rows.map((ligne) => ({
      note: ligne.note,
      commentaire: ligne.commentaire,
      creeLe: ligne.cree_le,
      titreDemande: ligne.titre_demande,
      client: ligne.identifiant ? apercuMembre(ligne) : null,
    })),
    nbAvis: rows.length,
    noteMoyenne: rows.length ? Math.round((somme / rows.length) * 10) / 10 : null,
  };
}

// Laisser un avis : POST /api/avis  { demandeId, identifiant, note, commentaire? }
// Trois conditions, toutes vérifiées ici par une seule requête :
//   1. la demande appartient au client connecté ;
//   2. elle est terminée ;
//   3. le dev noté est celui de la proposition acceptée, ou un membre (ayant accepté) de l'équipe choisie.
router.post('/', exigerConnexion, exigerClient, limiteAvis, async (req, res) => {
  const corps = req.body || {};
  const moi = req.utilisateur;
  const demandeId = v.idPositif(corps.demandeId);
  const identifiant = typeof corps.identifiant === 'string' ? corps.identifiant.trim().toLowerCase() : '';
  const note = v.entier(corps.note, 'note', { min: 1, max: 5 });
  const commentaire = v.texte(corps.commentaire, 'commentaire', { max: 1000, optionnel: true });

  const { rows: [cible] } = await db.query(
    `SELECT d.id AS demande_id, d.titre, u.id AS dev_id, u.identifiant
       FROM demandes d
       JOIN propositions p ON p.demande_id = d.id AND p.statut = 'acceptee'
       JOIN utilisateurs u ON u.identifiant = $3
      WHERE d.id = $1 AND d.client_id = $2 AND d.statut = 'terminee'
        AND (p.dev_id = u.id OR EXISTS (
              SELECT 1 FROM equipe_membres em
               WHERE em.equipe_id = p.equipe_id AND em.dev_id = u.id AND em.statut = 'accepte'))`,
    [demandeId, moi.id, identifiant],
  );
  if (!cible) {
    throw new v.ErreurHttp(403, 'Tu ne peux noter qu\'un développeur dont tu as accepté la proposition, une fois ta demande terminée.');
  }

  try {
    await db.transaction(async (client) => {
      await client.query(
        'INSERT INTO avis (demande_id, client_id, dev_id, note, commentaire) VALUES ($1, $2, $3, $4, $5)',
        [cible.demande_id, moi.id, cible.dev_id, note, commentaire],
      );
      await notifier(client, cible.dev_id, 'avis_recu',
        `${moi.nom} t'a laissé un avis (${note}/5) pour « ${court(cible.titre)} ».`, `/${cible.identifiant}`, { acteur: moi });
    });
  } catch (err) {
    // Contrainte UNIQUE (demande, dev) : un seul avis par dev et par demande.
    if (err.code === '23505') throw new v.ErreurValidation('Tu as déjà laissé un avis à ce développeur pour cette demande.');
    throw err;
  }
  res.status(201).json({ ok: true });
});

module.exports = router;
module.exports.avisDe = avisDe;
