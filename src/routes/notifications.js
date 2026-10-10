// Notifications du membre connecté : liste et passage à « lue ».
const express = require('express');
const db = require('../db/pool');
const v = require('../utils/validation');
const { exigerConnexion } = require('../middleware/auth');
const { apercuMembre, COLONNES_MEMBRE, limiteParMembre } = require('../utils/membres');
const push = require('../utils/push');

const router = express.Router();
const PAR_PAGE = 10;
const MAX_APPAREILS = 10; // abonnements push gardés par membre : au-delà, le plus ancien est retiré
const limiteAbonnements = limiteParMembre(30, 60, 'Trop de changements. Réessaie plus tard.');

router.use(exigerConnexion);

// Mes notifications, les plus récentes d'abord, par 10 : GET /api/notifications?avant=<id>
// « avant » est le numéro de la dernière notification déjà affichée (la page les charge en défilant).
router.get('/', async (req, res) => {
  const moi = req.utilisateur;
  const avant = v.idPositif(req.query.avant);
  const { rows: toutes } = await db.query(
    // « u » est la personne qui a fait l'action (la dernière, pour une notification regroupée) : son avatar
    // s'affiche à côté. Un compte bloqué ou supprimé n'est pas montré.
    `SELECT n.id, n.type, n.texte, n.lien, n.lue, n.cree_le, n.nombre, n.cible_type, u.id AS acteur_present, ${COLONNES_MEMBRE}
       FROM notifications n
       LEFT JOIN utilisateurs u ON u.id = n.acteur_id AND u.bloque = FALSE
      WHERE n.utilisateur_id = $1 AND ($3::int IS NULL OR n.id < $3) ORDER BY n.id DESC LIMIT $2`,
    [moi.id, PAR_PAGE + 1, avant], // une de plus pour savoir s'il en reste
  );
  const rows = toutes.slice(0, PAR_PAGE);
  const compte = await db.query(
    'SELECT count(*)::int AS nb FROM notifications WHERE utilisateur_id = $1 AND lue = FALSE',
    [moi.id],
  );
  res.json({
    notifications: rows.map((n) => ({
      id: n.id, type: n.type, texte: n.texte, lien: n.lien, lue: n.lue, creeLe: n.cree_le, nombre: n.nombre,
      acteur: n.acteur_present ? apercuMembre(n) : null,
    })),
    nonLues: compte.rows[0].nb,
    suivant: toutes.length > PAR_PAGE ? rows[rows.length - 1].id : null,
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

// ---------- Notifications push (src/utils/push.js) ----------

// Les familles de notifications qu'un membre peut couper : une famille absente de ses réglages vaut « oui ».
function preferencesPush(enregistrees) {
  const choisies = (enregistrees && enregistrees.push) || {};
  return Object.fromEntries(Object.keys(push.FAMILLES).map((famille) => [famille, choisies[famille] !== false]));
}

// Où en est le push : GET /api/notifications/push
// actif : le site a ses clés VAPID ; clePublique : celle que le navigateur doit présenter pour s'abonner.
router.get('/push', async (req, res) => {
  const { rows: [membre] } = await db.query('SELECT preferences_notifications AS preferences FROM utilisateurs WHERE id = $1', [req.utilisateur.id]);
  res.json({ actif: push.pushActif(), clePublique: push.clePublique(), preferences: preferencesPush(membre.preferences) });
});

// Abonner cet appareil : POST /api/notifications/push  { endpoint, cles: { p256dh, auth }, appareil? }
router.post('/push', limiteAbonnements, async (req, res) => {
  const moi = req.utilisateur;
  if (!push.pushActif()) throw new v.ErreurValidation('Les notifications push ne sont pas activées sur ce site.');
  // L'adresse doit être celle d'un vrai service de push (Google, Mozilla, Apple, Microsoft), jamais une autre.
  const abonnement = push.lireAbonnement(req.body);
  if (!abonnement) throw new v.ErreurValidation('Cet abonnement n\'est pas reconnu.', 'endpoint');
  const appareil = v.texte(req.body.appareil, 'appareil', { optionnel: true, max: 80 });
  await db.transaction(async (client) => {
    // Un appareil n'a qu'un abonnement : si quelqu'un d'autre s'y connecte ensuite, il devient le sien.
    await client.query(
      `INSERT INTO abonnements_push (utilisateur_id, endpoint, p256dh, auth, appareil) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (endpoint) DO UPDATE
         SET utilisateur_id = EXCLUDED.utilisateur_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, appareil = EXCLUDED.appareil, cree_le = now()`,
      [moi.id, abonnement.endpoint, abonnement.p256dh, abonnement.auth, appareil],
    );
    await client.query(
      `DELETE FROM abonnements_push WHERE utilisateur_id = $1
          AND id NOT IN (SELECT id FROM abonnements_push WHERE utilisateur_id = $1 ORDER BY id DESC LIMIT $2)`,
      [moi.id, MAX_APPAREILS],
    );
  });
  res.status(201).json({ ok: true });
});

// Désabonner cet appareil : DELETE /api/notifications/push  { endpoint }
// « utilisateur_id = moi » : on ne peut retirer que ses propres abonnements.
router.delete('/push', async (req, res) => {
  const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint : '';
  const { rowCount } = await db.query('DELETE FROM abonnements_push WHERE utilisateur_id = $1 AND endpoint = $2', [req.utilisateur.id, endpoint]);
  res.json({ ok: true, retire: rowCount > 0 });
});

// Choisir ce qu'on reçoit en push : PUT /api/notifications/push/preferences  { messages, demandes, equipes, social, defis }
// La cloche du site n'est pas concernée : elle garde toujours tout.
router.put('/push/preferences', async (req, res) => {
  const corps = req.body || {};
  const choix = {};
  for (const famille of Object.keys(push.FAMILLES)) {
    if (typeof corps[famille] !== 'boolean') throw new v.ErreurValidation('Choix illisible.', famille);
    choix[famille] = corps[famille];
  }
  // jsonb_set : seule la partie « push » des réglages est remplacée.
  const { rows: [membre] } = await db.query(
    `UPDATE utilisateurs SET preferences_notifications = jsonb_set(preferences_notifications, '{push}', $2::jsonb)
      WHERE id = $1 RETURNING preferences_notifications AS preferences`,
    [req.utilisateur.id, JSON.stringify(choix)],
  );
  res.json({ preferences: preferencesPush(membre.preferences) });
});

module.exports = router;
