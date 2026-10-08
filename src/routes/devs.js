// Recherche de développeurs : par compétence, pays, ville et disponibilité. Ouverte à tous.
const express = require('express');
const db = require('../db/pool');
const v = require('../utils/validation');
const { apercuMembre, COLONNES_MEMBRE } = require('../utils/membres');

const router = express.Router();
const PAR_PAGE = 10;
const MAX_PAGE = 100;

// GET /api/devs?competence=<id>&pays=<nom>&ville=<texte>&disponible=1&page=<n>
// Ni email ni numéro WhatsApp dans la réponse : pour contacter un dev, on passe par son profil.
router.get('/', async (req, res) => {
  const competence = v.idPositif(req.query.competence);
  const pays = v.PAYS.includes(req.query.pays) ? req.query.pays : null;
  const ville = typeof req.query.ville === 'string' ? req.query.ville.trim().toLowerCase().slice(0, 60) : '';
  const disponible = req.query.disponible === '1';
  const page = Math.min(v.idPositif(req.query.page) || 1, MAX_PAGE);

  // Dans un LIKE, % et _ sont des jokers : on les neutralise pour chercher le texte tel quel.
  const motifVille = ville ? `%${ville.replace(/[\\%_]/g, '\\$&')}%` : null;

  const { rows } = await db.query(
    `SELECT ${COLONNES_MEMBRE}, u.disponible, u.bio,
            (SELECT array_agg(c.nom ORDER BY c.nom) FROM utilisateur_competences uc
               JOIN competences c ON c.id = uc.competence_id
              WHERE uc.utilisateur_id = u.id) AS competences,
            (SELECT count(*)::int FROM projets p WHERE p.dev_id = u.id AND p.masque = FALSE) AS nb_projets,
            (SELECT count(*)::int FROM projets p
              WHERE p.dev_id = u.id AND p.masque = FALSE AND p.lien IS NOT NULL AND p.lien_verifie_le IS NOT NULL) AS projets_verifies,
            notes.moyenne, notes.nb AS nb_avis
       FROM utilisateurs u
       LEFT JOIN LATERAL (
         SELECT round(avg(a.note), 1)::float AS moyenne, count(*)::int AS nb FROM avis a WHERE a.dev_id = u.id
       ) notes ON TRUE
      WHERE u.type = 'dev' AND u.bloque = FALSE
        AND ($1::int IS NULL OR EXISTS (
              SELECT 1 FROM utilisateur_competences uc WHERE uc.utilisateur_id = u.id AND uc.competence_id = $1))
        AND ($2::text IS NULL OR u.pays = $2)
        AND ($3::text IS NULL OR lower(u.ville) LIKE $3 ESCAPE '\\')
        AND ($4::boolean = FALSE OR u.disponible)
      ORDER BY u.disponible DESC, notes.moyenne DESC NULLS LAST, projets_verifies DESC, u.id DESC
      LIMIT $5 OFFSET $6`,
    [competence, pays, motifVille, disponible, PAR_PAGE + 1, (page - 1) * PAR_PAGE],
  );

  res.json({
    devs: rows.slice(0, PAR_PAGE).map((ligne) => ({
      ...apercuMembre(ligne),
      disponible: ligne.disponible,
      bio: ligne.bio,
      competences: ligne.competences || [],
      nbProjets: ligne.nb_projets,
      projetsVerifies: ligne.projets_verifies,
      noteMoyenne: ligne.moyenne,
      nbAvis: ligne.nb_avis,
    })),
    pageSuivante: rows.length > PAR_PAGE && page < MAX_PAGE ? page + 1 : null,
  });
});

module.exports = router;
