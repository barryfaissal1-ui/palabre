// Validation en deux étapes et alerte de nouvelle connexion.
//
// Deux étapes (réglage du membre, coupé par défaut) : depuis un appareil qui n'est pas « de confiance », le bon mot de
// passe ne suffit pas. Le serveur envoie un code à 6 chiffres par email (mêmes règles que le code d'inscription :
// src/utils/inscription.js) et n'ouvre la session qu'une fois le code saisi. Entre les deux, le navigateur ne porte
// qu'un petit cookie d'attente de 15 minutes, qui ne donne accès à rien.
// Codes de secours : 8 codes à usage unique, montrés une seule fois, pour le jour où la boîte email est inaccessible.
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db/pool');
const mailer = require('./mailer'); // appelé par « mailer.envoyerEmail » : les tests peuvent le remplacer
const { emailAlerteConnexion } = require('./gabarit-email');
const { typeAppareil, lieuDe } = require('./sessions');

const COOKIE_ATTENTE = 'palabre_etape2';
const DUREE_ATTENTE_MIN = 15;
const NB_CODES_SECOURS = 8;
const MAX_ESSAIS = 5;
const DUREE_ALERTE_H = 24;
// Sans i, l, o, 0 ni 1 : des caractères qu'on confond en recopiant un code à la main.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

const signer = (texte) => crypto.createHmac('sha256', config.jwtSecret).update(texte).digest('hex');
const hacher = (texte) => crypto.createHash('sha256').update(texte).digest('hex');

// ---------- Le cookie d'attente entre le mot de passe et le code ----------
function poserAttente(res, utilisateurId) {
  const jeton = jwt.sign({ id: utilisateurId, etape: 2 }, config.jwtSecret, { expiresIn: `${DUREE_ATTENTE_MIN}m` });
  res.cookie(COOKIE_ATTENTE, jeton, { httpOnly: true, secure: config.production, sameSite: 'lax', maxAge: DUREE_ATTENTE_MIN * 60 * 1000, path: '/' });
}

// Le numéro du membre qui a donné le bon mot de passe et attend son code, ou null.
function lireAttente(req) {
  try {
    const { id, etape } = jwt.verify(req.cookies?.[COOKIE_ATTENTE] || '', config.jwtSecret);
    return etape === 2 && Number.isInteger(id) ? id : null; // un jeton de session (sans « etape ») ne passe pas ici
  } catch {
    return null;
  }
}

function effacerAttente(res) {
  res.clearCookie(COOKIE_ATTENTE, { path: '/' });
}

// « a•••@gmail.com » : assez pour reconnaître sa boîte, pas assez pour l'apprendre à quelqu'un d'autre.
function masquerEmail(email) {
  const [nom, domaine] = String(email).split('@');
  return `${nom.slice(0, 1)}${'•'.repeat(Math.max(2, Math.min(6, nom.length - 1)))}@${domaine}`;
}

// ---------- Codes de secours ----------
const normaliser = (valeur) => String(valeur || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const empreinteSecours = (utilisateurId, code) => signer(`secours:${utilisateurId}:${normaliser(code)}`);

// Fabrique 8 nouveaux codes (les anciens sont effacés) et les renvoie EN CLAIR : c'est la seule fois où ils existent
// ainsi. La base ne garde que leur empreinte.
async function creerCodesSecours(utilisateurId, executeur = db) {
  const codes = Array.from({ length: NB_CODES_SECOURS }, () => {
    const lettres = Array.from({ length: 8 }, () => ALPHABET[crypto.randomInt(0, ALPHABET.length)]).join('');
    return `${lettres.slice(0, 4)}-${lettres.slice(4)}`;
  });
  await executeur.query('DELETE FROM codes_secours WHERE utilisateur_id = $1', [utilisateurId]);
  for (const code of codes) {
    await executeur.query('INSERT INTO codes_secours (utilisateur_id, code_hash) VALUES ($1, $2)', [utilisateurId, empreinteSecours(utilisateurId, code)]);
  }
  return codes;
}

// Essaie un code de secours à la place du code reçu par email. Un code ne sert qu'une fois. Les erreurs comptent
// dans les mêmes 5 essais que le code à 6 chiffres : on ne peut pas en essayer des milliers.
async function utiliserCodeSecours(utilisateur, valeur) {
  return db.transaction(async (client) => {
    const { rows: [attente] } = await client.query(
      `SELECT id, essais, expire_le > now() AS valable FROM confirmations_email
        WHERE utilisateur_id = $1 AND motif = 'connexion' ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [utilisateur.id],
    );
    if (!attente || !attente.valable) return { erreur: 'Ce code a expiré. Demande un nouveau code.' };
    if (attente.essais >= MAX_ESSAIS) return { erreur: 'Trop d\'essais. Demande un nouveau code.' };
    const { rows: [code] } = normaliser(valeur).length === 8
      ? await client.query('UPDATE codes_secours SET utilise_le = now() WHERE utilisateur_id = $1 AND code_hash = $2 AND utilise_le IS NULL RETURNING id', [utilisateur.id, empreinteSecours(utilisateur.id, valeur)])
      : { rows: [] };
    if (!code) {
      await client.query('UPDATE confirmations_email SET essais = essais + 1 WHERE id = $1', [attente.id]);
      return { erreur: 'Code de secours incorrect ou déjà utilisé.' };
    }
    await client.query('DELETE FROM confirmations_email WHERE utilisateur_id = $1 AND motif = \'connexion\'', [utilisateur.id]);
    return { erreur: null };
  });
}

// ---------- Alerte : « Nouvelle connexion à ton compte Palabre » ----------
// Envoyée quand une session s'ouvre depuis un appareil inconnu. L'email porte un lien « Ce n'était pas moi », à usage
// unique et valable 24 heures : la base n'en garde que l'empreinte.
async function alerterNouvelleConnexion(utilisateur, req, sessionId) {
  const jeton = crypto.randomBytes(32).toString('hex');
  await db.query(
    'INSERT INTO alertes_connexion (utilisateur_id, jeton_hash, session_id, expire_le) VALUES ($1, $2, $3, now() + make_interval(hours => $4))',
    [utilisateur.id, hacher(jeton), sessionId, DUREE_ALERTE_H],
  );
  const { pays } = lieuDe(req);
  await mailer.envoyerEmail({
    a: utilisateur.email,
    ...emailAlerteConnexion({
      prenom: utilisateur.prenom || utilisateur.nom,
      appareil: typeAppareil(req.get('user-agent')),
      date: new Date(),
      pays,
      lien: `${config.urlPublique}/pas-moi?jeton=${jeton}`,
      langue: utilisateur.langue || 'fr',
    }),
  });
}

module.exports = { poserAttente, lireAttente, effacerAttente, masquerEmail, creerCodesSecours, utiliserCodeSecours, alerterNouvelleConnexion, hacher, NB_CODES_SECOURS };
