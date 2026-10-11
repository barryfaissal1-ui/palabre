// Projets réalisés par les devs : la vitrine (publique) et le « profil prouvé ».
const express = require('express');
const db = require('../db/pool');
const v = require('../utils/validation');
const { exigerConnexion, exigerDev } = require('../middleware/auth');
const { lireImageDataUrl } = require('../utils/images');
const { normaliserLien, verifierLien } = require('../utils/liens');
const { apercuMembre, COLONNES_MEMBRE, limiteParMembre } = require('../utils/membres');

const router = express.Router();
const PAR_PAGE = 9;
const MAX_PROJETS = 20;
const SECTEURS = Object.keys(v.SECTEURS_PROJET);

const limiteProjets = limiteParMembre(15, 60, 'Tu ajoutes beaucoup de projets. Réessaie plus tard.');
const limiteVerifications = limiteParMembre(20, 60, 'Trop de vérifications. Réessaie plus tard.');

// Un projet avec son auteur. Les projets masqués par un administrateur et ceux des comptes bloqués n'apparaissent jamais.
const SELECTION = `
  SELECT p.id, p.dev_id, p.titre, p.description, p.secteur, p.lien, p.image, p.lien_verifie_le, p.cree_le,
         ${COLONNES_MEMBRE}
    FROM projets p
    JOIN utilisateurs u ON u.id = p.dev_id
   WHERE u.bloque = FALSE AND u.desactive_le IS NULL AND p.masque = FALSE`;

function versProjet(ligne, moi) {
  return {
    id: ligne.id,
    titre: ligne.titre,
    description: ligne.description,
    secteur: ligne.secteur,
    nomSecteur: v.SECTEURS_PROJET[ligne.secteur] || 'Autre',
    lien: ligne.lien,
    lienVerifie: Boolean(ligne.lien && ligne.lien_verifie_le),
    image: ligne.image ? `/fichiers/${ligne.image}` : null,
    creeLe: ligne.cree_le,
    dev: apercuMembre(ligne),
    estMoi: Boolean(moi && moi.id === ligne.dev_id),
  };
}

async function lireProjet(valeurId, moi) {
  const id = v.idPositif(valeurId);
  const { rows } = id ? await db.query(`${SELECTION} AND p.id = $1`, [id]) : { rows: [] };
  if (!rows[0]) throw new v.ErreurHttp(404, 'Ce projet n\'existe plus.');
  return { ligne: rows[0], projet: versProjet(rows[0], moi) };
}

// Projets d'un dev, pour sa page profil (utilisé par routes/profils.js).
async function projetsDe(devId, moi) {
  const { rows } = await db.query(`${SELECTION} AND p.dev_id = $1 ORDER BY p.id DESC`, [devId]);
  return rows.map((ligne) => versProjet(ligne, moi));
}

// Visite le lien et note la date si le site répond ; efface le badge sinon.
async function verifierEtNoter(projetId, lien) {
  const repond = lien ? await verifierLien(lien) : false;
  await db.query(
    'UPDATE projets SET lien_verifie_le = CASE WHEN $2::boolean THEN now() ELSE NULL END WHERE id = $1',
    [projetId, repond],
  );
  return repond;
}

// La vitrine : GET /api/projets?secteur=<id>&avant=<id> — ouverte à tous, même sans compte.
router.get('/', async (req, res) => {
  const avant = v.idPositif(req.query.avant);
  const secteur = SECTEURS.includes(req.query.secteur) ? req.query.secteur : null;
  const { rows } = await db.query(
    `${SELECTION}
       AND ($1::int IS NULL OR p.id < $1)
       AND ($2::text IS NULL OR p.secteur = $2)
     ORDER BY p.id DESC
     LIMIT $3`,
    [avant, secteur, PAR_PAGE + 1],
  );
  const page = rows.slice(0, PAR_PAGE);
  res.json({
    projets: page.map((ligne) => versProjet(ligne, req.utilisateur)),
    suivant: rows.length > PAR_PAGE ? page[page.length - 1].id : null,
  });
});

// Un projet : GET /api/projets/:id — public.
router.get('/:id', async (req, res) => {
  const { projet } = await lireProjet(req.params.id, req.utilisateur);
  res.json({ projet });
});

// Ajouter un projet : POST /api/projets  { titre, description?, secteur, lien?, image?, publierFacebook? }
router.post('/', exigerConnexion, exigerDev, limiteProjets, async (req, res) => {
  const corps = req.body || {};
  const moi = req.utilisateur;
  const donnees = {
    titre: v.texte(corps.titre, 'titre', { min: 3, max: 100 }),
    description: v.texte(corps.description, 'description', { max: 1000, optionnel: true }),
    secteur: v.parmi(corps.secteur, SECTEURS, 'secteur'),
    lien: normaliserLien(corps.lien),
    // Accord du dev pour une publication sur la page Facebook de Palabre (validée ensuite par un administrateur).
    publierFacebook: corps.publierFacebook === true,
  };
  const image = corps.image ? lireImageDataUrl(corps.image) : null;

  const id = await db.transaction(async (client) => {
    const { rows: [compte] } = await client.query('SELECT count(*)::int AS nb FROM projets WHERE dev_id = $1', [moi.id]);
    if (compte.nb >= MAX_PROJETS) throw new v.ErreurValidation(`${MAX_PROJETS} projets au maximum.`);
    let imageId = null;
    if (image) {
      const fichier = await client.query(
        'INSERT INTO fichiers (proprietaire_id, type_mime, taille, donnees) VALUES ($1, $2, $3, $4) RETURNING id',
        [moi.id, image.typeMime, image.donnees.length, image.donnees],
      );
      imageId = fichier.rows[0].id;
    }
    const { rows } = await client.query(
      `INSERT INTO projets (dev_id, titre, description, secteur, lien, image, publier_facebook, statut_facebook)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [moi.id, donnees.titre, donnees.description, donnees.secteur, donnees.lien, imageId,
        donnees.publierFacebook, donnees.publierFacebook ? 'en_attente' : 'non'],
    );
    return rows[0].id;
  });

  // La visite du lien se fait après l'enregistrement : même si elle échoue, le projet est gardé (sans badge).
  await verifierEtNoter(id, donnees.lien);
  const { projet } = await lireProjet(id, moi);
  res.status(201).json({ projet });
});

// Revérifier le lien de son projet : POST /api/projets/:id/verifier
router.post('/:id/verifier', exigerConnexion, limiteVerifications, async (req, res) => {
  const moi = req.utilisateur;
  const { ligne } = await lireProjet(req.params.id, moi);
  if (ligne.dev_id !== moi.id) throw new v.ErreurHttp(403, 'Ce projet ne t\'appartient pas.');
  await verifierEtNoter(ligne.id, ligne.lien);
  const { projet } = await lireProjet(ligne.id, moi);
  res.json({ projet });
});

// Supprimer son projet : DELETE /api/projets/:id — son image part avec.
router.delete('/:id', exigerConnexion, async (req, res) => {
  const moi = req.utilisateur;
  const { ligne } = await lireProjet(req.params.id, moi);
  if (ligne.dev_id !== moi.id && !moi.est_admin) throw new v.ErreurHttp(403, 'Ce projet ne t\'appartient pas.');
  await db.transaction(async (client) => {
    await client.query('DELETE FROM projets WHERE id = $1', [ligne.id]);
    if (ligne.image) await client.query('DELETE FROM fichiers WHERE id = $1', [ligne.image]);
  });
  res.json({ ok: true });
});

module.exports = router;
module.exports.projetsDe = projetsDe;
module.exports.lireProjet = lireProjet;
