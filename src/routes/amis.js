// Amis : envoyer, accepter, refuser une demande ; liste de ses amis.
// Une seule ligne de la table amities relie deux membres, quel que soit le sens de la demande.
const express = require('express');
const db = require('../db/pool');
const v = require('../utils/validation');
const { exigerConnexion } = require('../middleware/auth');
const { apercuMembre, COLONNES_MEMBRE, limiteParMembre } = require('../utils/membres');
const { notifier } = require('../utils/notifications');

const router = express.Router();
const limiteDemandes = limiteParMembre(40, 60, 'Trop de demandes d\'amis. Réessaie plus tard.');

router.use(exigerConnexion);

// Retrouve le membre visé par son identifiant de profil ; répond 404 s'il n'existe pas.
async function membreVise(valeur, res) {
  const identifiant = typeof valeur === 'string' ? valeur.trim().toLowerCase() : '';
  const { rows } = await db.query(
    'SELECT id, identifiant FROM utilisateurs WHERE identifiant = $1 AND bloque = FALSE AND desactive_le IS NULL',
    [identifiant],
  );
  if (rows[0]) return rows[0];
  res.status(404).json({ erreur: 'Ce membre n\'existe pas.' });
  return null;
}

// Mes amis et mes demandes en attente : GET /api/amis
router.get('/', async (req, res) => {
  const moi = req.utilisateur;
  const { rows } = await db.query(
    `SELECT a.statut, a.demandeur_id, ${COLONNES_MEMBRE}
       FROM amities a
       JOIN utilisateurs u ON u.id = CASE WHEN a.demandeur_id = $1 THEN a.receveur_id ELSE a.demandeur_id END
      WHERE $1 IN (a.demandeur_id, a.receveur_id)
        AND a.statut IN ('acceptee', 'en_attente')
        AND u.bloque = FALSE AND u.desactive_le IS NULL
      ORDER BY u.nom`,
    [moi.id],
  );
  res.json({
    amis: rows.filter((l) => l.statut === 'acceptee').map(apercuMembre),
    recues: rows.filter((l) => l.statut === 'en_attente' && l.demandeur_id !== moi.id).map(apercuMembre),
    envoyees: rows.filter((l) => l.statut === 'en_attente' && l.demandeur_id === moi.id).map(apercuMembre),
  });
});

// Envoyer une demande : POST /api/amis/demandes  { identifiant }
router.post('/demandes', limiteDemandes, async (req, res) => {
  const moi = req.utilisateur;
  const autre = await membreVise(req.body?.identifiant, res);
  if (!autre) return;
  if (autre.id === moi.id) {
    throw new v.ErreurValidation('Tu ne peux pas t\'ajouter toi-même.', 'identifiant');
  }

  const client = await db.pool.connect();
  let etat;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT demandeur_id, statut FROM amities
        WHERE (demandeur_id = $1 AND receveur_id = $2) OR (demandeur_id = $2 AND receveur_id = $1)
        FOR UPDATE`,
      [moi.id, autre.id],
    );
    const lien = rows[0];

    if (lien && lien.statut === 'acceptee') {
      throw new v.ErreurValidation('Vous êtes déjà amis.', 'identifiant');
    }
    if (lien && lien.demandeur_id === moi.id) {
      // En attente ou refusée : dans les deux cas, on ne peut pas insister.
      throw new v.ErreurValidation('Tu as déjà envoyé une demande à ce membre.', 'identifiant');
    }
    if (lien && lien.statut === 'en_attente') {
      // L'autre m'avait déjà demandé : les deux sont d'accord, on devient amis tout de suite.
      await client.query(
        'UPDATE amities SET statut = \'acceptee\' WHERE demandeur_id = $1 AND receveur_id = $2',
        [autre.id, moi.id],
      );
      await notifier(client, autre.id, 'ami_accepte', `${moi.nom} et toi êtes maintenant amis.`, `/${moi.identifiant}`, { acteur: moi });
      etat = 'amis';
    } else {
      // Aucune ligne, ou une ancienne demande de l'autre que j'avais refusée : je peux demander à mon tour.
      await client.query('DELETE FROM amities WHERE demandeur_id = $1 AND receveur_id = $2', [autre.id, moi.id]);
      await client.query('INSERT INTO amities (demandeur_id, receveur_id) VALUES ($1, $2)', [moi.id, autre.id]);
      await notifier(client, autre.id, 'demande_ami', `${moi.nom} veut t'ajouter en ami.`, '/amis', { acteur: moi });
      etat = 'envoyee';
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    // Deux demandes croisées au même instant : l'index unique sur la paire en refuse une.
    if (err.code === '23505') {
      throw new v.ErreurValidation('Une demande existe déjà entre vous. Recharge la page.', 'identifiant');
    }
    throw err;
  } finally {
    client.release();
  }
  res.status(201).json({ amitie: etat });
});

// Répondre à une demande reçue : POST /api/amis/demandes/:identifiant/accepter (ou /refuser)
async function repondre(req, res, statut) {
  const moi = req.utilisateur;
  const autre = await membreVise(req.params.identifiant, res);
  if (!autre) return;
  // Seul celui qui a reçu la demande peut y répondre, et seulement tant qu'elle est en attente.
  const { rowCount } = await db.query(
    `UPDATE amities SET statut = $3
      WHERE demandeur_id = $1 AND receveur_id = $2 AND statut = 'en_attente'`,
    [autre.id, moi.id, statut],
  );
  if (rowCount === 0) return res.status(404).json({ erreur: 'Aucune demande en attente de ce membre.' });
  if (statut === 'acceptee') {
    await notifier(db, autre.id, 'ami_accepte', `${moi.nom} a accepté ta demande d'ami.`, `/${moi.identifiant}`, { acteur: moi });
  }
  res.json({ amitie: statut === 'acceptee' ? 'amis' : 'aucune' });
}

router.post('/demandes/:identifiant/accepter', (req, res) => repondre(req, res, 'acceptee'));
router.post('/demandes/:identifiant/refuser', (req, res) => repondre(req, res, 'refusee'));

// Retirer un ami, ou annuler une demande que j'ai envoyée : DELETE /api/amis/:identifiant
router.delete('/:identifiant', async (req, res) => {
  const moi = req.utilisateur;
  const autre = await membreVise(req.params.identifiant, res);
  if (!autre) return;
  const { rowCount } = await db.query(
    `DELETE FROM amities
      WHERE (statut = 'acceptee' AND ((demandeur_id = $1 AND receveur_id = $2) OR (demandeur_id = $2 AND receveur_id = $1)))
         OR (statut = 'en_attente' AND demandeur_id = $1 AND receveur_id = $2)`,
    [moi.id, autre.id],
  );
  if (rowCount === 0) return res.status(404).json({ erreur: 'Rien à retirer avec ce membre.' });
  res.json({ amitie: 'aucune' });
});

module.exports = router;
