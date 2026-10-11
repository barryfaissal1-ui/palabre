// Les sessions, une par appareil connecté (table « sessions »).
//
// Le cookie de session contient un jeton signé (JWT) qui porte le numéro du membre ET l'identifiant de sa session.
// À chaque requête, le serveur vérifie que cette session existe encore et n'a pas été révoquée : se déconnecter,
// ou déconnecter un autre appareil depuis /parametres, coupe donc vraiment l'accès (effacer le cookie ne suffirait
// pas : une copie du cookie resterait valable).
const crypto = require('node:crypto');
const db = require('../db/pool');
const config = require('../config');

const DUREE_SESSION_JOURS = 30;
const INTERVALLE_VU_S = 60; // « actif il y a… » : noté au plus une fois par minute

// « Chrome sur Android », « Safari sur iPhone »… d'après l'en-tête User-Agent. On ne garde que ces deux mots.
function typeAppareil(agent) {
  const a = String(agent || '');
  const navigateur = [[/Edg\//, 'Edge'], [/OPR\/|Opera/, 'Opera'], [/Firefox\//, 'Firefox'], [/Chrome\//, 'Chrome'], [/Safari\//, 'Safari']].find(([motif]) => motif.test(a));
  const systeme = [[/Android/, 'Android'], [/iPhone/, 'iPhone'], [/iPad/, 'iPad'], [/Windows/, 'Windows'], [/Mac OS X/, 'Mac'], [/Linux/, 'Linux']].find(([motif]) => motif.test(a));
  if (!navigateur && !systeme) return 'Appareil inconnu';
  return [navigateur ? navigateur[1] : 'Navigateur', systeme ? `sur ${systeme[1]}` : null].filter(Boolean).join(' ');
}

// Le lieu approximatif d'une requête. Palabre n'a pas de base « adresse IP → ville » (ce serait une bibliothèque de
// plus, et des données à tenir à jour). Certains hébergeurs ou proxys ajoutent eux-mêmes le pays et la ville dans
// un en-tête : si ENTETE_PAYS / ENTETE_VILLE donnent le nom de ces en-têtes, on les lit ; sinon, pas de lieu.
// (Sans ce réglage on ne lit rien : un en-tête que personne ne contrôle pourrait être écrit par le visiteur.)
function lieuDe(req) {
  const lire = (nom) => {
    const valeur = nom && req && req.get ? String(req.get(nom) || '').trim() : '';
    return /^[\p{L}\p{M} .'’-]{2,60}$/u.test(valeur) ? valeur : null;
  };
  return { pays: lire(config.entetePays), ville: lire(config.enteteVille) };
}

// Ouvre une session pour ce membre et renvoie son identifiant (32 caractères au hasard).
async function creerSession(req, utilisateurId, executeur = db) {
  const id = crypto.randomBytes(16).toString('hex');
  const { pays, ville } = lieuDe(req);
  await executeur.query(
    'INSERT INTO sessions (id, utilisateur_id, appareil, ip, pays, ville) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, utilisateurId, typeAppareil(req && req.get ? req.get('user-agent') : ''), (req && req.ip) || null, pays, ville],
  );
  return id;
}

// « Actif il y a 2 h » : sans faire attendre la requête, et au plus une fois par minute.
function noterPassage(session) {
  if (session.vuLe && Date.now() - new Date(session.vuLe).getTime() < INTERVALLE_VU_S * 1000) return;
  db.query('UPDATE sessions SET vu_le = now() WHERE id = $1 AND vu_le < now() - make_interval(secs => $2)', [session.id, INTERVALLE_VU_S]).catch(() => {});
}

// La page ne reçoit jamais l'identifiant d'une session, seulement cette empreinte courte : elle suffit à désigner
// « cet appareil-là » dans la liste, et ne sert à rien d'autre.
const CLE_PUBLIQUE = 'left(encode(sha256(convert_to(s.id, \'UTF8\')), \'hex\'), 16)';

// Les appareils connectés d'un membre, le plus récemment actif d'abord. Jamais l'adresse IP.
async function sessionsDe(utilisateurId, sessionActuelle) {
  const { rows } = await db.query(
    `SELECT ${CLE_PUBLIQUE} AS cle, s.id, s.appareil, s.pays, s.ville, s.cree_le, s.vu_le
       FROM sessions s
      WHERE s.utilisateur_id = $1 AND s.revoquee_le IS NULL AND s.cree_le > now() - make_interval(days => $2)
      ORDER BY (s.id = $3) DESC, s.vu_le DESC LIMIT 50`,
    [utilisateurId, DUREE_SESSION_JOURS, sessionActuelle || ''],
  );
  return rows.map((s) => ({
    cle: s.cle,
    appareil: s.appareil,
    lieu: [s.ville, s.pays].filter(Boolean).join(', ') || null,
    creeLe: s.cree_le,
    vuLe: s.vu_le,
    actuelle: s.id === sessionActuelle,
  }));
}

// Révoque une session désignée par son empreinte publique. Renvoie son identifiant, ou null si elle n'est pas à moi.
async function revoquerParCle(utilisateurId, cle, executeur = db) {
  const { rows } = await executeur.query(
    `UPDATE sessions s SET revoquee_le = now() WHERE s.utilisateur_id = $1 AND s.revoquee_le IS NULL AND ${CLE_PUBLIQUE} = $2 RETURNING s.id, s.appareil`,
    [utilisateurId, String(cle || '')],
  );
  return rows[0] || null;
}

async function revoquer(sessionId, executeur = db) {
  if (sessionId) await executeur.query('UPDATE sessions SET revoquee_le = now() WHERE id = $1 AND revoquee_le IS NULL', [sessionId]);
}

// Toutes les sessions d'un membre, sauf éventuellement une (« Déconnecter tous les autres »). Renvoie leur nombre.
async function revoquerToutes(utilisateurId, { sauf = null } = {}, executeur = db) {
  const { rowCount } = await executeur.query(
    'UPDATE sessions SET revoquee_le = now() WHERE utilisateur_id = $1 AND revoquee_le IS NULL AND ($2::text IS NULL OR id <> $2)',
    [utilisateurId, sauf],
  );
  return rowCount;
}

module.exports = { DUREE_SESSION_JOURS, typeAppareil, lieuDe, creerSession, noterPassage, sessionsDe, revoquer, revoquerParCle, revoquerToutes };
