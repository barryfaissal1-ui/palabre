// Notifications du membre connecté : liste et passage à « lue ».
const express = require('express');
const db = require('../db/pool');
const v = require('../utils/validation');
const { exigerConnexion } = require('../middleware/auth');

const router = express.Router();
const MAX_AFFICHEES = 30;

router.use(exigerConnexion);

// Mes dernières notifications : GET /api/notifications
router.get('/', async (req, res) => {
  const moi = req.utilisateur;
  const { rows } = await db.query(
    `SELECT id, type, texte, lien, lue, cree_le FROM notifications
      WHERE utilisateur_id = $1 ORDER BY id DESC LIMIT $2`,
    [moi.id, MAX_AFFICHEES],
  );
  const compte = await db.query(
    'SELECT count(*)::int AS nb FROM notifications WHERE utilisateur_id = $1 AND lue = FALSE',
    [moi.id],
  );
  res.json({
    notifications: rows.map((n) => ({ id: n.id, type: n.type, texte: n.texte, lien: n.lien, lue: n.lue, creeLe: n.cree_le })),
    nonLues: compte.rows[0].nb,
  });
});

// Marquer comme lue(s) : POST /api/notifications/lues  { id? }  — sans id : toutes.
// La condition utilisateur_id = moi empêche de toucher aux notifications de quelqu'un d'autre.
router.post('/lues', async (req, res) => {
  const moi = req.utilisateur;
  const id = v.idPositif(req.body?.id);
  await db.query(
    `UPDATE notifications SET lue = TRUE
      WHERE utilisateur_id = $1 AND lue = FALSE AND ($2::int IS NULL OR id = $2)`,
    [moi.id, id],
  );
  const { rows } = await db.query(
    'SELECT count(*)::int AS nb FROM notifications WHERE utilisateur_id = $1 AND lue = FALSE',
    [moi.id],
  );
  res.json({ nonLues: rows[0].nb });
});

module.exports = router;
