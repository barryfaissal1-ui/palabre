// Les appareils connus d'un membre.
//
// À la première connexion réussie, le navigateur reçoit un cookie d'appareil : un numéro au hasard, signé par le
// serveur, gardé un an, illisible par les scripts (httpOnly). La base ne garde que l'empreinte de ce numéro, avec le
// membre : « cet appareil a déjà eu une session valide pour ce compte ».
//  - Appareil CONNU : pas d'email d'alerte à la connexion.
//  - Appareil DE CONFIANCE (case « Faire confiance à cet appareil ») : pas de code de validation en deux étapes.
// Un cookie n'identifie pas une personne : il dit seulement « ce navigateur est déjà passé ». Effacer ses cookies
// suffit à redevenir un appareil inconnu, ce qui est le comportement voulu.
const crypto = require('node:crypto');
const config = require('../config');
const db = require('../db/pool');

const NOM_COOKIE = 'palabre_appareil';
const UN_AN_MS = 365 * 24 * 60 * 60 * 1000;

const signer = (numero) => crypto.createHmac('sha256', config.jwtSecret).update(`appareil:${numero}`).digest('hex');
const empreinte = (numero) => crypto.createHash('sha256').update(numero).digest('hex');
function egales(a, b) {
  const [x, y] = [Buffer.from(String(a)), Buffer.from(String(b))];
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Le numéro d'appareil porté par la requête, ou null (pas de cookie, ou cookie fabriqué : la signature ne colle pas).
function lireAppareil(req) {
  const valeur = req.cookies && req.cookies[NOM_COOKIE];
  const [numero, signature] = typeof valeur === 'string' ? valeur.split('.') : [];
  if (!numero || !signature || !/^[0-9a-f]{32}$/.test(numero) || !egales(signature, signer(numero))) return null;
  return numero;
}

// Donne un numéro à cet appareil s'il n'en a pas, et le renvoie. À appeler APRÈS avoir posé le cookie de session.
function assurerAppareil(req, res) {
  const connu = lireAppareil(req);
  if (connu) return connu;
  const numero = crypto.randomBytes(16).toString('hex');
  res.cookie(NOM_COOKIE, `${numero}.${signer(numero)}`, { httpOnly: true, secure: config.production, sameSite: 'lax', maxAge: UN_AN_MS, path: '/' });
  return numero;
}

// { connu, confiance } pour ce membre et cet appareil.
async function etatAppareil(utilisateurId, numero, executeur = db) {
  if (!numero) return { connu: false, confiance: false };
  const { rows } = await executeur.query('SELECT confiance FROM appareils_connus WHERE utilisateur_id = $1 AND appareil_hash = $2', [utilisateurId, empreinte(numero)]);
  return { connu: rows.length > 0, confiance: rows.length > 0 && rows[0].confiance };
}

// Cet appareil vient d'ouvrir une session valide : il devient connu. `confiance: true` le dispense du code en deux
// étapes ; une fois accordée, la confiance n'est pas retirée par une connexion ordinaire.
async function noterAppareil(utilisateurId, numero, { confiance = false } = {}, executeur = db) {
  await executeur.query(
    `INSERT INTO appareils_connus (utilisateur_id, appareil_hash, confiance) VALUES ($1, $2, $3)
     ON CONFLICT (utilisateur_id, appareil_hash) DO UPDATE SET vu_le = now(), confiance = appareils_connus.confiance OR EXCLUDED.confiance`,
    [utilisateurId, empreinte(numero), confiance],
  );
}

// Tous les appareils redeviennent inconnus (« Ce n'était pas moi », validation en deux étapes coupée puis rallumée).
async function oublierAppareils(utilisateurId, executeur = db) {
  await executeur.query('DELETE FROM appareils_connus WHERE utilisateur_id = $1', [utilisateurId]);
}

module.exports = { NOM_COOKIE, lireAppareil, assurerAppareil, etatAppareil, noterAppareil, oublierAppareils };
