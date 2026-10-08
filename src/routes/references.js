// Listes de référence utilisées par les formulaires (pays, compétences).
const express = require('express');
const db = require('../db/pool');
const { PAYS, CATEGORIES_DEMANDE, SECTEURS_PROJET } = require('../utils/validation');

const router = express.Router();

router.get('/pays', (req, res) => {
  res.json({ pays: PAYS });
});

router.get('/categories', (req, res) => {
  res.json({ categories: Object.entries(CATEGORIES_DEMANDE).map(([id, nom]) => ({ id, nom })) });
});

router.get('/secteurs', (req, res) => {
  res.json({ secteurs: Object.entries(SECTEURS_PROJET).map(([id, nom]) => ({ id, nom })) });
});

router.get('/competences', async (req, res) => {
  const { rows } = await db.query('SELECT id, nom FROM competences ORDER BY nom');
  res.json({ competences: rows });
});

module.exports = router;
