// Gestion de la session : un jeton JWT dans un cookie httpOnly (inaccessible au JavaScript du navigateur).
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db/pool');

const NOM_COOKIE = 'palabre_session';
const DUREE_SESSION_JOURS = 30;

function ouvrirSession(res, utilisateur) {
  const jeton = jwt.sign({ id: utilisateur.id }, config.jwtSecret, {
    expiresIn: `${DUREE_SESSION_JOURS}d`,
  });
  res.cookie(NOM_COOKIE, jeton, {
    httpOnly: true,
    secure: config.production,
    sameSite: 'lax',
    maxAge: DUREE_SESSION_JOURS * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

function fermerSession(res) {
  res.clearCookie(NOM_COOKIE, { path: '/' });
}

// Ajoute req.utilisateur si la session est valide (sinon laisse vide).
async function chargerUtilisateur(req, res, next) {
  const jeton = req.cookies?.[NOM_COOKIE];
  if (!jeton) return next();
  try {
    const { id } = jwt.verify(jeton, config.jwtSecret);
    const { rows } = await db.query(
      `SELECT id, type, est_admin, nom, prenom, nom_famille, identifiant, email, pays, ville, whatsapp, bio, avatar, couverture, disponible
         FROM utilisateurs WHERE id = $1 AND bloque = FALSE`,
      [id],
    );
    if (rows[0]) req.utilisateur = rows[0];
    else fermerSession(res);
  } catch {
    fermerSession(res);
  }
  next();
}

function exigerConnexion(req, res, next) {
  if (!req.utilisateur) return res.status(401).json({ erreur: 'Connecte-toi pour continuer.' });
  next();
}

function exigerAdmin(req, res, next) {
  if (!req.utilisateur?.est_admin) return res.status(403).json({ erreur: 'Accès réservé aux administrateurs.' });
  next();
}

// Certaines actions sont réservées à un type de compte : publier une demande (client), proposer (dev).
function exigerClient(req, res, next) {
  if (req.utilisateur?.type !== 'client') return res.status(403).json({ erreur: 'Action réservée aux comptes client.' });
  next();
}

function exigerDev(req, res, next) {
  if (req.utilisateur?.type !== 'dev') return res.status(403).json({ erreur: 'Action réservée aux comptes développeur.' });
  next();
}

module.exports = { ouvrirSession, fermerSession, chargerUtilisateur, exigerConnexion, exigerAdmin, exigerClient, exigerDev };
