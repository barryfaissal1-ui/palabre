// Recherche de développeurs : par compétence, pays, ville et disponibilité. Ouverte à tous.
const express = require('express');
const db = require('../db/pool');
const v = require('../utils/validation');
const { exigerConnexion } = require('../middleware/auth');
const { apercuMembre, COLONNES_MEMBRE, NB_PROJETS_VERIFIES } = require('../utils/membres');

const router = express.Router();
const PAR_PAGE = 10;
const MAX_PAGE = 100;
const MAX_DISPONIBLES = 15;

// Dans un LIKE ou un ILIKE, % et _ sont des jokers : on les neutralise pour chercher le texte tel quel.
const sansJokers = (texte) => texte.replace(/[\\%_]/g, '\\$&');

// « Disponibles maintenant » en haut du fil : GET /api/devs/disponibles (membres connectés).
// Au plus 15 devs disponibles : d'abord mes amis, puis ma ville, puis mon pays, puis les plus prouvés.
router.get('/disponibles', exigerConnexion, async (req, res) => {
  const moi = req.utilisateur;
  const { rows } = await db.query(
    `SELECT ${COLONNES_MEMBRE},
            EXISTS (SELECT 1 FROM amities a
                     WHERE a.statut = 'acceptee'
                       AND LEAST(a.demandeur_id, a.receveur_id) = LEAST($1, u.id)
                       AND GREATEST(a.demandeur_id, a.receveur_id) = GREATEST($1, u.id)) AS est_ami
       FROM utilisateurs u
      WHERE u.type = 'dev' AND u.disponible AND u.bloque = FALSE AND u.id <> $1
      ORDER BY est_ami DESC,
               (lower(u.ville) = lower($2) AND u.pays = $3) DESC,
               (u.pays = $3) DESC,
               nb_projets_verifies DESC,
               u.id DESC
      LIMIT $4`,
    [moi.id, moi.ville, moi.pays, MAX_DISPONIBLES],
  );
  res.json({ devs: rows.map((ligne) => ({ ...apercuMembre(ligne), estAmi: ligne.est_ami })) });
});

// GET /api/devs?competence=<id>&pays=<nom>&ville=<texte>&disponible=1&page=<n>&q=<nom>
// Avec « q » (au moins 2 lettres), c'est la recherche de l'en-tête : tous les membres dont le nom contient ce texte,
// devs comme clients, ceux dont le nom commence par ce texte en premier.
// Ni email ni numéro WhatsApp dans la réponse : pour contacter un dev, on passe par son profil.
router.get('/', async (req, res) => {
  const competence = v.idPositif(req.query.competence);
  const pays = v.PAYS.includes(req.query.pays) ? req.query.pays : null;
  const ville = typeof req.query.ville === 'string' ? req.query.ville.trim().toLowerCase().slice(0, 60) : '';
  const disponible = req.query.disponible === '1';
  const page = Math.min(v.idPositif(req.query.page) || 1, MAX_PAGE);

  let nom = null;
  if (req.query.q !== undefined) {
    nom = v.texte(req.query.q, 'q', { max: 60 });
    if (nom.length < 2) throw new v.ErreurValidation('Écris au moins 2 lettres.', 'q');
  }
  const motifVille = ville ? `%${sansJokers(ville)}%` : null;
  const motifNom = nom ? `%${sansJokers(nom)}%` : null;
  const motifDebut = nom ? `${sansJokers(nom)}%` : null;

  const { rows } = await db.query(
    `SELECT ${COLONNES_MEMBRE}, u.disponible, u.bio,
            (SELECT array_agg(c.nom ORDER BY c.nom) FROM utilisateur_competences uc
               JOIN competences c ON c.id = uc.competence_id
              WHERE uc.utilisateur_id = u.id) AS competences,
            (SELECT count(*)::int FROM projets p WHERE p.dev_id = u.id AND p.masque = FALSE) AS nb_projets,
            ${NB_PROJETS_VERIFIES} AS projets_verifies,
            notes.moyenne, notes.nb AS nb_avis
       FROM utilisateurs u
       LEFT JOIN LATERAL (
         SELECT round(avg(a.note), 1)::float AS moyenne, count(*)::int AS nb FROM avis a WHERE a.dev_id = u.id
       ) notes ON TRUE
      WHERE u.bloque = FALSE
        AND (u.type = 'dev' OR $7::text IS NOT NULL)
        AND ($7::text IS NULL OR u.nom ILIKE $7 ESCAPE '\\')
        AND ($1::int IS NULL OR EXISTS (
              SELECT 1 FROM utilisateur_competences uc WHERE uc.utilisateur_id = u.id AND uc.competence_id = $1))
        AND ($2::text IS NULL OR u.pays = $2)
        AND ($3::text IS NULL OR lower(u.ville) LIKE $3 ESCAPE '\\')
        AND ($4::boolean = FALSE OR u.disponible)
      ORDER BY ($8::text IS NOT NULL AND u.nom ILIKE $8 ESCAPE '\\') DESC, u.disponible DESC, notes.moyenne DESC NULLS LAST, projets_verifies DESC, u.id DESC
      LIMIT $5 OFFSET $6`,
    [competence, pays, motifVille, disponible, PAR_PAGE + 1, (page - 1) * PAR_PAGE, motifNom, motifDebut],
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
