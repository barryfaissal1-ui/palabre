// Gestion de la session : un jeton JWT dans un cookie httpOnly (inaccessible au JavaScript du navigateur).
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db/pool');
const { noterActivite } = require('../utils/presence');

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
    const { id, iat } = jwt.verify(jeton, config.jwtSecret); // iat : la date d'ouverture de la session, en secondes
    const { rows } = await db.query(
      `SELECT id, type, est_admin, nom, prenom, nom_famille, identifiant, email, pays, ville, whatsapp, bio, avatar, couverture, disponible,
              email_confirme_le, profil_complete_le, specialite, experience,
              lien_github, lien_github_verifie_le, lien_gitlab, lien_gitlab_verifie_le,
              lien_portfolio, lien_portfolio_verifie_le, lien_linkedin, lien_linkedin_verifie_le, sessions_depuis,
              vu_le, masquer_presence, preferences_notifications
         FROM utilisateurs WHERE id = $1 AND bloque = FALSE`,
      [id],
    );
    // Mot de passe réinitialisé depuis : cette session a été ouverte avec l'ancien, elle est fermée.
    // (Si quelqu'un avait volé le mot de passe ou un téléphone resté connecté, il est déconnecté lui aussi.)
    const perimee = rows[0] && rows[0].sessions_depuis && iat * 1000 < rows[0].sessions_depuis.getTime() - 1000;
    if (rows[0] && !perimee) {
      req.utilisateur = rows[0];
      noterActivite(rows[0]); // « en ligne » : noté au plus une fois par minute, sans faire attendre la requête
    } else fermerSession(res);
  } catch {
    fermerSession(res);
  }
  next();
}

function exigerConnexion(req, res, next) {
  if (!req.utilisateur) return res.status(401).json({ erreur: 'Connecte-toi pour continuer.' });
  next();
}

// Un membre qui n'a pas encore saisi le code reçu par email ne peut rien faire d'autre que le saisir.
// Placé sur tout /api : seules les routes /api/auth (code, renvoi, « moi », déconnexion) restent ouvertes.
function exigerEmailConfirme(req, res, next) {
  if (!req.utilisateur || req.utilisateur.email_confirme_le || req.path.startsWith('/auth/')) return next();
  res.status(403).json({ erreur: 'Confirme d\'abord ton email avec le code reçu.', suite: '/confirmer-email' });
}

// Un dev qui n'a pas rempli « Ton profil de dev » peut regarder le site, mais pas répondre aux demandes.
// La date de naissance n'est jamais chargée dans req.utilisateur : seule compte la date où le profil a été complété.
function profilDevIncomplet(utilisateur) {
  return utilisateur.type === 'dev' && !utilisateur.profil_complete_le;
}
const MESSAGE_PROFIL_INCOMPLET = 'Termine ton profil de dev pour répondre aux demandes.';

function exigerProfilComplet(req, res, next) {
  if (!profilDevIncomplet(req.utilisateur)) return next();
  res.status(403).json({ erreur: MESSAGE_PROFIL_INCOMPLET, suite: '/bienvenue' });
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

module.exports = { ouvrirSession, fermerSession, chargerUtilisateur, exigerConnexion, exigerAdmin, exigerClient, exigerDev,
  exigerEmailConfirme, exigerProfilComplet, profilDevIncomplet, MESSAGE_PROFIL_INCOMPLET };
