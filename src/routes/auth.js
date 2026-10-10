// Inscription, connexion, déconnexion, mot de passe oublié.
const express = require('express');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db/pool');
const config = require('../config');
const v = require('../utils/validation');
const mailer = require('../utils/mailer'); // appelé par « mailer.envoyerEmail » : les tests peuvent le remplacer
const { emailMotDePasse } = require('../utils/gabarit-email');
const { ouvrirSession, fermerSession, exigerConnexion, profilDevIncomplet } = require('../middleware/auth');
const { jetonOuverture, verifierOuverture, envoyerCode, confirmerCode } = require('../utils/inscription');
const { liensPublics } = require('../utils/profil-dev');
const { compterNonLus } = require('./messages');

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

// La saisie du code a sa propre limite par adresse IP, en plus des 5 essais permis par code.
const limiteCodes = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { erreur: 'Trop de tentatives. Réessaie dans quelques minutes.' },
});

// Profil complet du membre connecté (avec son email) : n'est envoyé qu'à lui-même.
function profilPrive(u) {
  return {
    presenceMasquee: Boolean(u.masquer_presence),
    id: u.id,
    type: u.type,
    estAdmin: u.est_admin,
    nom: u.nom, // le nom affiché : « Prénom Nom »
    prenom: u.prenom,
    nomFamille: u.nom_famille,
    identifiant: u.identifiant,
    email: u.email,
    pays: u.pays,
    ville: u.ville,
    whatsapp: u.whatsapp,
    bio: u.bio,
    avatar: u.avatar ? `/fichiers/${u.avatar}` : null,
    disponible: u.disponible,
    // Les deux étapes de l'inscription : le site s'en sert pour envoyer vers /confirmer-email ou afficher le bandeau.
    emailConfirme: Boolean(u.email_confirme_le),
    profilComplet: !profilDevIncomplet(u), // toujours vrai pour un client : il n'a pas de page 2
    specialite: u.specialite || null,
    experience: u.experience || null,
    liens: liensPublics(u),
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

// Heure d'ouverture du formulaire, signée : GET /api/auth/jeton-inscription (demandée par la page à son ouverture).
router.get('/jeton-inscription', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ jeton: jetonOuverture() });
});

router.post('/inscription', limiteSensible, async (req, res) => {
  const corps = req.body || {};
  // Champ piège : invisible pour une personne, mais un robot qui remplit tous les champs le remplit aussi.
  // La réponse reste vague, pour ne pas lui expliquer ce qui l'a trahi.
  if (corps.siteWeb !== undefined && corps.siteWeb !== '') {
    throw new v.ErreurValidation('Inscription impossible pour le moment. Réessaie plus tard.');
  }
  // Formulaire envoyé moins de 3 secondes après l'ouverture de la page : ce n'est pas une personne.
  verifierOuverture(corps.jeton);
  const donnees = {
    type: v.typeCompte(corps.type),
    prenom: v.nomPropre(corps.prenom, 'prenom'),
    nomFamille: v.nomPropre(corps.nomFamille, 'nomFamille'),
    email: v.email(corps.email),
    motDePasse: v.motDePasse(corps.motDePasse),
    pays: v.pays(corps.pays),
    ville: v.texte(corps.ville, 'ville', { min: 2, max: 60 }),
    // Le dev donne son numéro à l'étape 2 (« Ton profil de dev ») ; le client, ici.
    whatsapp: corps.type === 'client' ? v.whatsapp(corps.whatsapp) : null,
  };

  const existe = await db.query('SELECT 1 FROM utilisateurs WHERE email = $1', [donnees.email]);
  if (existe.rowCount > 0) {
    throw new v.ErreurValidation('Un compte existe déjà avec cet email.', 'email');
  }

  const hash = await bcrypt.hash(donnees.motDePasse, COUT_BCRYPT);
  // Le nom affiché partout sur le site : « Prénom Nom ». Il est gardé dans sa propre colonne, recalculée ici.
  const nom = `${donnees.prenom} ${donnees.nomFamille}`;
  const identifiant = await identifiantLibre(nom);
  const { rows } = await db.query(
    `INSERT INTO utilisateurs (type, nom, prenom, nom_famille, identifiant, email, mot_de_passe_hash, pays, ville, whatsapp)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [donnees.type, nom, donnees.prenom, donnees.nomFamille, identifiant, donnees.email, hash, donnees.pays, donnees.ville, donnees.whatsapp],
  );

  // Le compte existe, mais il ne sert à rien tant que le code envoyé par email n'a pas été saisi.
  try {
    await envoyerCode(rows[0]);
  } catch (err) {
    console.error('Envoi du code de confirmation impossible :', err.message); // « Renvoyer le code » reste possible
  }
  ouvrirSession(res, rows[0]);
  res.status(201).json({ utilisateur: profilPrive(rows[0]) });
});

// Saisir le code reçu par email : POST /api/auth/confirmer-email  { code }
router.post('/confirmer-email', exigerConnexion, limiteCodes, async (req, res) => {
  const moi = req.utilisateur;
  if (!moi.email_confirme_le) {
    const { erreur } = await confirmerCode(moi, req.body?.code);
    if (erreur) return res.status(400).json({ erreur, champ: 'code' });
  }
  res.json({ ok: true, profilComplet: !profilDevIncomplet(moi) });
});

// Bouton « Renvoyer le code » : POST /api/auth/renvoyer-code (1 par minute, 5 par heure)
router.post('/renvoyer-code', exigerConnexion, async (req, res) => {
  if (req.utilisateur.email_confirme_le) throw new v.ErreurValidation('Ton email est déjà confirmé.');
  await envoyerCode(req.utilisateur, { renvoi: true });
  res.json({ message: 'Un nouveau code vient de partir. Regarde ta boîte de réception.' });
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
  // Compteurs du menu : demandes d'amis à traiter et notifications non lues (la cloche).
  const { rows } = await db.query(
    `SELECT (SELECT count(*)::int FROM amities a
               JOIN utilisateurs u ON u.id = a.demandeur_id
              WHERE a.receveur_id = $1 AND a.statut = 'en_attente' AND u.bloque = FALSE) AS demandes_amis,
            (SELECT count(*)::int FROM notifications n
              WHERE n.utilisateur_id = $1 AND n.lue = FALSE) AS notifications,
            (SELECT count(*)::int FROM projets pv
              WHERE pv.dev_id = $1 AND pv.masque = FALSE AND pv.lien IS NOT NULL AND pv.lien_verifie_le IS NOT NULL) AS nb_projets_verifies`,
    [req.utilisateur.id],
  );
  res.json({
    utilisateur: { ...profilPrive(req.utilisateur), demandesAmis: rows[0].demandes_amis, notifications: rows[0].notifications, nbProjetsVerifies: rows[0].nb_projets_verifies, messagesNonLus: await compterNonLus(req.utilisateur.id) },
  });
});

// Toujours la même réponse, que l'email existe ou non (on ne révèle pas qui est inscrit).
router.post('/mot-de-passe-oublie', limiteSensible, async (req, res) => {
  const email = v.email(req.body?.email);
  const { rows } = await db.query('SELECT id, nom, prenom FROM utilisateurs WHERE email = $1 AND bloque = FALSE', [email]);

  if (rows[0]) {
    const jeton = crypto.randomBytes(32).toString('hex');
    const jetonHash = crypto.createHash('sha256').update(jeton).digest('hex');
    await db.query(
      `INSERT INTO reinitialisations_mdp (utilisateur_id, jeton_hash, expire_le)
       VALUES ($1, $2, now() + make_interval(mins => $3))`,
      [rows[0].id, jetonHash, DUREE_JETON_MIN],
    );
    const lien = `${config.urlPublique}/reinitialiser?jeton=${jeton}`;
    await mailer.envoyerEmail({ a: email, ...emailMotDePasse({ prenom: rows[0].prenom || rows[0].nom, lien, dureeMin: DUREE_JETON_MIN }) });
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
    // Avoir reçu ce lien prouve que la boîte email est bien la sienne : l'email est confirmé du même coup.
    await client.query(
      'UPDATE utilisateurs SET mot_de_passe_hash = $1, email_confirme_le = COALESCE(email_confirme_le, now()), sessions_depuis = now() WHERE id = $2',
      [hash, rows[0].utilisateur_id],
    );
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
