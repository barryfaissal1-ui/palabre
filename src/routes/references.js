// Listes de référence utilisées par les formulaires (pays, compétences).
const express = require('express');
const db = require('../db/pool');
const { PAYS } = require('../utils/validation');

const router = express.Router();

router.get('/pays', (req, res) => {
  res.json({ pays: PAYS });
});

router.get('/competences', async (req, res) => {
  const { rows } = await db.query('SELECT id, nom FROM competences ORDER BY nom');
  res.json({ competences: rows });
});

module.exports = router;
