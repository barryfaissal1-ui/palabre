// Inscription, connexion, déconnexion, mot de passe oublié.
const express = require('express');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db/pool');
const config = require('../config');
const v = require('../utils/validation');
const { envoyerEmail } = require('../utils/mailer');
const { ouvrirSession, fermerSession } = require('../middleware/auth');

const router = express.Router();
const COUT_BCRYPT = 12;
const DUREE_JETON_MIN = 60;
// Hash factice : on compare quand même quand l'email n'existe pas, pour ne pas révéler les comptes par le temps de réponse.
const HASH_FACTICE = bcrypt.hashSync('mot-de-passe-factice', COUT_BCRYPT);

// Limite les tentatives pour freiner les attaques par force brute.
const limiteSensible = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { erreur: 'Trop de tentatives. Réessaie dans quelques minutes.' },
});

// Profil complet du membre connecté (avec son email) : n'est envoyé qu'à lui-même.
function profilPrive(u) {
  return {
    id: u.id,
    type: u.type,
    estAdmin: u.est_admin,
    nom: u.nom,
    identifiant: u.identifiant,
    email: u.email,
    pays: u.pays,
    ville: u.ville,
    whatsapp: u.whatsapp,
    bio: u.bio,
    avatar: u.avatar ? `/fichiers/${u.avatar}` : null,
    disponible: u.disponible,
  };
}

async function identifiantLibre(nom) {
  let base = v.versIdentifiant(nom).padEnd(3, '0');
  if (v.IDENTIFIANTS_RESERVES.has(base)) base = `${base}-dev`;
  for (let i = 0; i < 50; i += 1) {
    const candidat = i === 0 ? base : `${base}-${i + 1}`;
    const { rowCount } = await db.query('SELECT 1 FROM utilisateurs WHERE identifiant = $1', [candidat]);
    if (rowCount === 0) return candidat;
  }
  return `${base}-${crypto.randomInt(1000, 9999)}`;
}

router.post('/inscription', limiteSensible, async (req, res) => {
  const corps = req.body || {};
  const donnees = {
    type: v.typeCompte(corps.type),
    nom: v.texte(corps.nom, 'nom', { min: 2, max: 80 }),
    email: v.email(corps.email),
    motDePasse: v.motDePasse(corps.motDePasse),
    pays: v.pays(corps.pays),
    ville: v.texte(corps.ville, 'ville', { min: 2, max: 60 }),
    whatsapp: v.whatsapp(corps.whatsapp),
  };

  const existe = await db.query('SELECT 1 FROM utilisateurs WHERE email = $1', [donnees.email]);
  if (existe.rowCount > 0) {
    throw new v.ErreurValidation('Un compte existe déjà avec cet email.', 'email');
  }

  const hash = await bcrypt.hash(donnees.motDePasse, COUT_BCRYPT);
  const identifiant = await identifiantLibre(donnees.nom);
  const { rows } = await db.query(
    `INSERT INTO utilisateurs (type, nom, identifiant, email, mot_de_passe_hash, pays, ville, whatsapp)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [donnees.type, donnees.nom, identifiant, donnees.email, hash, donnees.pays, donnees.ville, donnees.whatsapp],
  );

  ouvrirSession(res, rows[0]);
  res.status(201).json({ utilisateur: profilPrive(rows[0]) });
});

router.post('/connexion', limiteSensible, async (req, res) => {
  const corps = req.body || {};
  const email = v.email(corps.email);
  const motDePasse = typeof corps.motDePasse === 'string' ? corps.motDePasse : '';

  const { rows } = await db.query('SELECT * FROM utilisateurs WHERE email = $1', [email]);
  const utilisateur = rows[0];
  const valide = await bcrypt.compare(motDePasse, utilisateur?.mot_de_passe_hash || HASH_FACTICE);

  if (!utilisateur || !valide) {
    return res.status(401).json({ erreur: 'Email ou mot de passe incorrect.' });
  }
  if (utilisateur.bloque) {
    return res.status(403).json({ erreur: 'Ce compte a été suspendu. Contacte l\'équipe Palabre.' });
  }

  ouvrirSession(res, utilisateur);
  res.json({ utilisateur: profilPrive(utilisateur) });
});

router.post('/deconnexion', (req, res) => {
  fermerSession(res);
  res.json({ ok: true });
});

// Renvoie le membre connecté, ou null pour un visiteur (pas d'erreur : c'est un cas normal).
router.get('/moi', async (req, res) => {
  if (!req.utilisateur) return res.json({ utilisateur: null });
  // Nombre de demandes d'amis à traiter : affiché en pastille dans le menu.
  const { rows } = await db.query(
    `SELECT count(*)::int AS nb FROM amities a
       JOIN utilisateurs u ON u.id = a.demandeur_id
      WHERE a.receveur_id = $1 AND a.statut = 'en_attente' AND u.bloque = FALSE`,
    [req.utilisateur.id],
  );
  res.json({ utilisateur: { ...profilPrive(req.utilisateur), demandesAmis: rows[0].nb } });
});

// Toujours la même réponse, que l'email existe ou non (on ne révèle pas qui est inscrit).
router.post('/mot-de-passe-oublie', limiteSensible, async (req, res) => {
  const email = v.email(req.body?.email);
  const { rows } = await db.query('SELECT id, nom FROM utilisateurs WHERE email = $1 AND bloque = FALSE', [email]);

  if (rows[0]) {
    const jeton = crypto.randomBytes(32).toString('hex');
    const jetonHash = crypto.createHash('sha256').update(jeton).digest('hex');
    await db.query(
      `INSERT INTO reinitialisations_mdp (utilisateur_id, jeton_hash, expire_le)
       VALUES ($1, $2, now() + make_interval(mins => $3))`,
      [rows[0].id, jetonHash, DUREE_JETON_MIN],
    );
    const lien = `${config.urlPublique}/reinitialiser?jeton=${jeton}`;
    await envoyerEmail({
      a: email,
      sujet: 'Palabre – Réinitialise ton mot de passe',
      texte: `Bonjour ${rows[0].nom},\n\nPour choisir un nouveau mot de passe, ouvre ce lien (valable ${DUREE_JETON_MIN} minutes) :\n${lien}\n\nSi tu n'as rien demandé, ignore simplement cet email.\n\nL'équipe Palabre`,
    });
  }

  res.json({ message: 'Si un compte existe avec cet email, un lien de réinitialisation vient d\'être envoyé.' });
});

router.post('/reinitialiser', limiteSensible, async (req, res) => {
  const jeton = typeof req.body?.jeton === 'string' ? req.body.jeton : '';
  const motDePasse = v.motDePasse(req.body?.motDePasse);
  const jetonHash = crypto.createHash('sha256').update(jeton).digest('hex');

  const { rows } = await db.query(
    `SELECT id, utilisateur_id FROM reinitialisations_mdp
      WHERE jeton_hash = $1 AND utilise_le IS NULL AND expire_le > now()`,
    [jetonHash],
  );
  if (!rows[0]) {
    return res.status(400).json({ erreur: 'Ce lien n\'est plus valable. Fais une nouvelle demande.' });
  }

  const hash = await bcrypt.hash(motDePasse, COUT_BCRYPT);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE utilisateurs SET mot_de_passe_hash = $1 WHERE id = $2', [hash, rows[0].utilisateur_id]);
    await client.query('UPDATE reinitialisations_mdp SET utilise_le = now() WHERE utilisateur_id = $1 AND utilise_le IS NULL', [rows[0].utilisateur_id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  res.json({ message: 'Mot de passe modifié. Tu peux te connecter.' });
});

module.exports = router;
module.exports.profilPrive = profilPrive;
