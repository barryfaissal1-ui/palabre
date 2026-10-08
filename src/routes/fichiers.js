// Diffusion des images stockées en base : GET /fichiers/:id
const express = require('express');
const db = require('../db/pool');

const router = express.Router();
const FORMAT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get('/:id', async (req, res) => {
  if (!FORMAT_UUID.test(req.params.id)) return res.status(404).end();

  const { rows } = await db.query('SELECT type_mime, donnees FROM fichiers WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).end();

  res.set({
    'Content-Type': rows[0].type_mime,
    // Une image ne change jamais : une nouvelle photo reçoit un nouvel identifiant.
    // Le navigateur peut donc la garder en cache un an, ce qui économise les données mobiles.
    'Cache-Control': 'public, max-age=31536000, immutable',
  });
  res.send(rows[0].donnees);
});

module.exports = router;
