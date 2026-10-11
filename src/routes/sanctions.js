// « Mes sanctions » (page /sanctions) : le membre voit les sanctions prises contre son compte et peut contester
// chacune une fois. Deux façons d'y arriver : connecté, ou par le lien de l'email (un exclu ne peut plus se
// connecter : le jeton du lien, à usage limité à CETTE sanction, lui permet quand même de contester).
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db/pool');
const v = require('../utils/validation');
const { exigerConnexion } = require('../middleware/auth');
const { controler } = require('../utils/moderation');
const { hacher } = require('../utils/sanctions');

const router = express.Router();
const limiteLiens = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { erreur: 'Trop de tentatives. Réessaie dans quelques minutes.' },
});

const COLONNES = 'id, type, motif, debut, fin, annulee_le, contestation, contestee_le, contestation_decision';
function versSanction(ligne) {
  return {
    id: ligne.id,
    type: ligne.type, // 'avertissement', 'suspension' ou 'exclusion'
    motif: ligne.motif,
    debut: ligne.debut,
    fin: ligne.fin, // la fin d'une suspension
    annulee: Boolean(ligne.annulee_le),
    // La contestation : rien tant qu'il n'a pas contesté ; ensuite son texte et, plus tard, la décision.
    contestation: ligne.contestee_le ? { texte: ligne.contestation, le: ligne.contestee_le, decision: ligne.contestation_decision } : null,
    contestable: !ligne.annulee_le && !ligne.contestee_le,
  };
}

// Enregistre la contestation : une seule par sanction, et pas sur une sanction déjà annulée.
async function contester(req, condition, valeurs) {
  const texte = v.texte(req.body?.texte, 'texte', { min: 20, max: 1000 });
  await controler(req, [[texte, 'texte']], { mode: 'prive' }); // pas d'insulte, même pour contester
  const { rows } = await db.query(
    `UPDATE sanctions SET contestation = $1, contestee_le = now() WHERE ${condition} AND contestee_le IS NULL AND annulee_le IS NULL RETURNING ${COLONNES}`,
    [texte, ...valeurs],
  );
  if (!rows[0]) throw new v.ErreurValidation('Cette sanction ne peut plus être contestée : elle l\'a déjà été, ou elle a été annulée.', 'texte');
  return versSanction(rows[0]);
}

// ---------- Par le lien de l'email (sans connexion) ----------
// GET /api/sanctions/lien?jeton=…  →  la sanction que ce lien désigne, et rien d'autre.
router.get('/lien', limiteLiens, async (req, res) => {
  const { rows } = await db.query(`SELECT ${COLONNES} FROM sanctions WHERE jeton_hash = $1`, [hacher(String(req.query.jeton || ''))]);
  if (!rows[0]) throw new v.ErreurHttp(404, 'Ce lien n\'est pas valable.');
  res.set('Cache-Control', 'no-store').json({ sanctions: [versSanction(rows[0])] });
});

// POST /api/sanctions/lien  { jeton, texte }
router.post('/lien', limiteLiens, async (req, res) => {
  res.json({ sanction: await contester(req, 'jeton_hash = $2', [hacher(String(req.body?.jeton || ''))]) });
});

// ---------- Connecté ----------
router.use(exigerConnexion);

// GET /api/sanctions : mes sanctions, la plus récente d'abord.
router.get('/', async (req, res) => {
  const { rows } = await db.query(`SELECT ${COLONNES} FROM sanctions WHERE utilisateur_id = $1 ORDER BY id DESC LIMIT 50`, [req.utilisateur.id]);
  res.set('Cache-Control', 'no-store').json({ sanctions: rows.map(versSanction) });
});

// POST /api/sanctions/:id/contester  { texte }  — seulement une sanction qui est à moi.
router.post('/:id/contester', async (req, res) => {
  res.json({ sanction: await contester(req, 'id = $2 AND utilisateur_id = $3', [v.idPositif(req.params.id), req.utilisateur.id]) });
});

module.exports = router;
