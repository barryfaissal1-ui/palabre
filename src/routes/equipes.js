// Équipes éclair : répondre à une invitation, dissoudre son équipe.
// La création se fait sur une demande : POST /api/demandes/:id/equipes (routes/demandes.js).
const express = require('express');
const db = require('../db/pool');
const v = require('../utils/validation');
const { exigerConnexion, exigerDev } = require('../middleware/auth');
const { notifier, court, deNom } = require('../utils/notifications');

const router = express.Router();

router.use(exigerConnexion, exigerDev);

// Répondre à une invitation : POST /api/equipes/:id/accepter (ou /refuser)
// Quand le dernier invité a répondu, la proposition de l'équipe part chez le client,
// avec ceux qui ont accepté. Si tout le monde a refusé, elle ne part pas.
async function repondre(req, res, reponse) {
  const moi = req.utilisateur;
  const equipeId = v.idPositif(req.params.id);

  const envoyee = await db.transaction(async (client) => {
    // FOR UPDATE sur l'équipe : si deux invités répondent au même instant, ils passent l'un après l'autre,
    // et le dernier voit bien que tout le monde a répondu.
    const { rows: [equipe] } = await client.query(
      `SELECT e.id, e.chef_id, d.id AS demande_id, d.titre, d.statut, d.client_id, u.nom AS nom_chef
         FROM equipes e
         JOIN demandes d ON d.id = e.demande_id
         JOIN utilisateurs u ON u.id = e.chef_id
        WHERE e.id = $1
        FOR UPDATE OF e`,
      [equipeId],
    );
    const { rowCount } = equipe ? await client.query(
      'UPDATE equipe_membres SET statut = $3 WHERE equipe_id = $1 AND dev_id = $2 AND statut = \'invite\'',
      [equipe.id, moi.id, reponse],
    ) : { rowCount: 0 };
    if (rowCount === 0) throw new v.ErreurHttp(404, 'Aucune invitation en attente pour cette équipe.');
    if (equipe.statut !== 'ouverte') throw new v.ErreurValidation('Cette demande n\'est plus ouverte.');

    const { rows: [bilan] } = await client.query(
      `SELECT count(*) FILTER (WHERE statut = 'invite')::int AS en_attente,
              count(*) FILTER (WHERE statut = 'accepte' AND dev_id <> $2)::int AS ont_accepte
         FROM equipe_membres WHERE equipe_id = $1`,
      [equipe.id, equipe.chef_id],
    );
    if (bilan.en_attente > 0) return false; // on attend encore des réponses

    const lien = `/demande?id=${equipe.demande_id}`;
    if (bilan.ont_accepte === 0) {
      await notifier(client, equipe.chef_id, 'equipe_reponses',
        `Tous tes invités ont refusé pour « ${court(equipe.titre)} ». Dissous l'équipe pour proposer seul ou en former une autre.`, lien);
      return false;
    }
    await client.query(
      'UPDATE propositions SET statut = \'envoyee\', cree_le = now() WHERE equipe_id = $1 AND statut = \'brouillon\'',
      [equipe.id],
    );
    await notifier(client, equipe.client_id, 'nouvelle_proposition',
      `L'équipe ${deNom(equipe.nom_chef)} a envoyé une proposition pour « ${court(equipe.titre)} ».`, lien);
    await notifier(client, equipe.chef_id, 'equipe_reponses',
      `Tous tes invités ont répondu : la proposition de ton équipe pour « ${court(equipe.titre)} » est partie.`, lien);
    return true;
  });

  res.json({ reponse, propositionEnvoyee: envoyee });
}

router.post('/:id/accepter', (req, res) => repondre(req, res, 'accepte'));
router.post('/:id/refuser', (req, res) => repondre(req, res, 'refuse'));

// Dissoudre son équipe, tant que le client ne l'a pas choisie : DELETE /api/equipes/:id
// La proposition et les invitations partent avec l'équipe (ON DELETE CASCADE).
router.delete('/:id', async (req, res) => {
  const { rowCount } = await db.query(
    `DELETE FROM equipes e
      WHERE e.id = $1 AND e.chef_id = $2
        AND NOT EXISTS (SELECT 1 FROM propositions p WHERE p.equipe_id = e.id AND p.statut = 'acceptee')`,
    [v.idPositif(req.params.id), req.utilisateur.id],
  );
  if (rowCount === 0) throw new v.ErreurHttp(404, 'Seul le chef peut dissoudre son équipe, avant le choix du client.');
  res.json({ ok: true });
});

module.exports = router;
