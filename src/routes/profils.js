// Profils : consultation publique, modification de son propre profil, photo de profil.
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db/pool');
const v = require('../utils/validation');
const { exigerConnexion } = require('../middleware/auth');
const { lireImageDataUrl } = require('../utils/images');
const { etatAmitie } = require('../utils/membres');

const router = express.Router();
const MAX_COMPETENCES = 15;

const limiteEnvoiImages = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { erreur: 'Trop d\'envois d\'images. Réessaie dans quelques minutes.' },
});

function urlFichier(id) {
  return id ? `/fichiers/${id}` : null;
}

// Ce que tout le monde peut voir d'un profil. L'email n'en fait jamais partie.
// Le numéro WhatsApp n'est montré qu'aux membres connectés, pour limiter la collecte automatique de numéros.
function profilVisible(u, competences, visiteur, amitie = null) {
  return {
    nom: u.nom,
    identifiant: u.identifiant,
    type: u.type,
    pays: u.pays,
    ville: u.ville,
    bio: u.bio,
    avatar: urlFichier(u.avatar),
    disponible: u.disponible,
    competences,
    whatsapp: visiteur ? u.whatsapp : null,
    whatsappMasque: !visiteur && Boolean(u.whatsapp),
    membreDepuis: u.cree_le,
    estMoi: Boolean(visiteur && visiteur.id === u.id),
    // Lien d'amitié avec le visiteur connecté ('aucune', 'envoyee', 'recue', 'amis') ; null sinon.
    amitie,
  };
}

async function competencesDe(utilisateurId) {
  const { rows } = await db.query(
    `SELECT c.id, c.nom FROM utilisateur_competences uc
       JOIN competences c ON c.id = uc.competence_id
      WHERE uc.utilisateur_id = $1
      ORDER BY c.nom`,
    [utilisateurId],
  );
  return rows;
}

// Profil public : GET /api/profils/:identifiant
router.get('/:identifiant', async (req, res) => {
  const identifiant = String(req.params.identifiant || '').toLowerCase();
  const { rows } = await db.query(
    'SELECT * FROM utilisateurs WHERE identifiant = $1 AND bloque = FALSE',
    [identifiant],
  );
  if (!rows[0]) return res.status(404).json({ erreur: 'Ce profil n\'existe pas.' });

  const competences = await competencesDe(rows[0].id);
  const visiteur = req.utilisateur;
  const amitie = visiteur && visiteur.id !== rows[0].id ? await etatAmitie(visiteur.id, rows[0].id) : null;
  res.json({ profil: profilVisible(rows[0], competences, visiteur, amitie) });
});

// Modifier son profil : PUT /api/profils/moi
router.put('/moi', exigerConnexion, async (req, res) => {
  const corps = req.body || {};
  const moi = req.utilisateur;
  const donnees = {
    nom: v.texte(corps.nom, 'nom', { min: 2, max: 80 }),
    identifiant: v.identifiant(corps.identifiant),
    pays: v.pays(corps.pays),
    ville: v.texte(corps.ville, 'ville', { min: 2, max: 60 }),
    whatsapp: v.whatsapp(corps.whatsapp),
    bio: v.texte(corps.bio, 'bio', { max: 500, optionnel: true }),
    disponible: corps.disponible !== false,
  };

  // Les compétences ne concernent que les développeurs.
  let competences = [];
  if (moi.type === 'dev') {
    const ids = Array.isArray(corps.competences) ? corps.competences : [];
    competences = [...new Set(ids.map(Number).filter(Number.isInteger))];
    if (competences.length > MAX_COMPETENCES) {
      throw new v.ErreurValidation(`${MAX_COMPETENCES} compétences au maximum.`, 'competences');
    }
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE utilisateurs
          SET nom = $1, identifiant = $2, pays = $3, ville = $4, whatsapp = $5, bio = $6, disponible = $7
        WHERE id = $8`,
      [donnees.nom, donnees.identifiant, donnees.pays, donnees.ville, donnees.whatsapp, donnees.bio, donnees.disponible, moi.id],
    );
    await client.query('DELETE FROM utilisateur_competences WHERE utilisateur_id = $1', [moi.id]);
    if (competences.length) {
      // Seuls les identifiants qui existent vraiment dans la table competences sont gardés.
      await client.query(
        `INSERT INTO utilisateur_competences (utilisateur_id, competence_id)
         SELECT $1, id FROM competences WHERE id = ANY($2::int[])`,
        [moi.id, competences],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505' && String(err.constraint).includes('identifiant')) {
      throw new v.ErreurValidation('Cet identifiant est déjà pris. Choisis-en un autre.', 'identifiant');
    }
    throw err;
  } finally {
    client.release();
  }

  const { rows } = await db.query('SELECT * FROM utilisateurs WHERE id = $1', [moi.id]);
  res.json({ profil: profilVisible(rows[0], await competencesDe(moi.id), moi) });
});

// Changer sa photo : POST /api/profils/moi/avatar  { image: "data:image/jpeg;base64,..." }
router.post('/moi/avatar', exigerConnexion, limiteEnvoiImages, async (req, res) => {
  const image = lireImageDataUrl(req.body?.image);
  const moi = req.utilisateur;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO fichiers (proprietaire_id, type_mime, taille, donnees)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [moi.id, image.typeMime, image.donnees.length, image.donnees],
    );
    await client.query('UPDATE utilisateurs SET avatar = $1 WHERE id = $2', [rows[0].id, moi.id]);
    if (moi.avatar) {
      await client.query('DELETE FROM fichiers WHERE id = $1 AND proprietaire_id = $2', [moi.avatar, moi.id]);
    }
    await client.query('COMMIT');
    res.status(201).json({ avatar: urlFichier(rows[0].id) });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// Retirer sa photo : DELETE /api/profils/moi/avatar
router.delete('/moi/avatar', exigerConnexion, async (req, res) => {
  const moi = req.utilisateur;
  await db.query('UPDATE utilisateurs SET avatar = NULL WHERE id = $1', [moi.id]);
  if (moi.avatar) {
    await db.query('DELETE FROM fichiers WHERE id = $1 AND proprietaire_id = $2', [moi.avatar, moi.id]);
  }
  res.json({ avatar: null });
});

module.exports = router;
