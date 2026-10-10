// Appels audio et vidéo dans Palabre (WebRTC). Monté sous /api/messages/appels par routes/messages.js.
//
// Le son et l'image ne passent PAS par ce serveur : ils vont directement d'un téléphone à l'autre (ou par un relais
// TURN quand le réseau l'impose). Ce serveur ne fait que la « mise en relation » :
//   - dire qui appelle qui, qui a décroché, qui a raccroché ;
//   - transporter les petits messages techniques que les deux navigateurs s'échangent pour se trouver
//     (offre, réponse, candidats ICE) : la table appel_signaux, que chacun relit chaque seconde PENDANT un appel ;
//   - donner à chaque navigateur la liste des serveurs STUN / TURN, avec des identifiants TURN valables une heure.
//
// Qui peut appeler qui : exactement ceux qui peuvent s'écrire. En privé, la règle est droitDEcrire() (amis, client et
// dev liés par une proposition ; jamais un inconnu, jamais un membre bloqué). Dans le groupe d'une équipe éclair :
// ses membres, en audio seulement, quatre personnes au plus.
const express = require('express');
const crypto = require('node:crypto');
const config = require('../config');
const db = require('../db/pool');
const v = require('../utils/validation');
const push = require('../utils/push');
const { apercuMembre, COLONNES_MEMBRE, limiteParMembre } = require('../utils/membres');
const { notifier } = require('../utils/notifications');

const SONNERIE_S = 30;      // sans réponse au bout de 30 secondes : « Appel manqué »
const ABSENCE_S = 20;       // un participant qui ne donne plus signe de vie depuis 20 secondes est considéré parti
const MAX_PARTICIPANTS = 4; // appel de groupe : chacun est relié directement à chacun, au-delà le téléphone ne suit plus
const TYPES_SIGNAUX = ['offre', 'reponse', 'candidat', 'relance'];
const DUREE_TURN_S = 3600;

// Les serveurs que le navigateur utilisera pour trouver un chemin vers l'autre.
// STUN : « quelle est mon adresse vue d'Internet ? » (gratuit, public). TURN : un relais à nous, pour les réseaux
// qui empêchent la liaison directe. Le navigateur reçoit des identifiants TURN TEMPORAIRES, calculés avec le secret
// partagé avec le serveur TURN (méthode « TURN REST API » de coturn) ; le secret lui-même ne sort jamais d'ici.
function serveursIce(membreId) {
  const serveurs = [{ urls: config.appels.stun }];
  if (config.appels.turnUrls.length && config.appels.turnSecret) {
    const identifiant = `${Math.floor(Date.now() / 1000) + DUREE_TURN_S}:${membreId}`; // « valable jusqu'à » : membre
    const motDePasse = crypto.createHmac('sha1', config.appels.turnSecret).update(identifiant).digest('base64');
    serveurs.push({ urls: config.appels.turnUrls, username: identifiant, credential: motDePasse });
  }
  return serveurs;
}

// Ce membre est-il déjà dans un appel (qui sonne ou en cours) ? Un seul appel à la fois.
async function occupe(executeur, membreId, saufAppel = 0) {
  const { rowCount } = await executeur.query(
    `SELECT 1 FROM appel_participants p JOIN appels a ON a.id = p.appel_id
      WHERE p.membre_id = $1 AND a.id <> $2 AND a.statut IN ('sonne', 'en_cours')
        AND p.etat = 'present' AND p.vu_le > now() - make_interval(secs => $3)`,
    [membreId, saufAppel, ABSENCE_S],
  );
  return rowCount > 0;
}

// Termine un appel et laisse une ligne dans la conversation (« Appel audio, 4 min », « Appel manqué »).
async function clore(client, appel, statut) {
  const { rowCount } = await client.query(
    `UPDATE appels SET statut = $2, fin_le = now() WHERE id = $1 AND statut IN ('sonne', 'en_cours')`,
    [appel.id, statut],
  );
  if (rowCount === 0) return;
  await client.query('DELETE FROM appel_signaux WHERE appel_id = $1', [appel.id]);
  await client.query(
    'INSERT INTO messages (conversation_id, auteur_id, texte, systeme, appel_id) VALUES ($1, $2, $3, TRUE, $4)',
    [appel.conversation_id, appel.appelant_id, statut === 'termine' ? (appel.type === 'video' ? 'Appel vidéo' : 'Appel audio') : 'Appel manqué', appel.id],
  );
  await client.query('UPDATE conversations SET dernier_message_le = now() WHERE id = $1', [appel.conversation_id]);
  if (statut === 'termine') return;
  // Appel manqué : la cloche (et le push) le disent à ceux qui n'ont pas décroché.
  const { rows: absents } = await client.query(
    `SELECT p.membre_id, u.nom FROM appel_participants p JOIN utilisateurs u ON u.id = $2
      WHERE p.appel_id = $1 AND p.etat = 'invite'`,
    [appel.id, appel.appelant_id],
  );
  const { rows: [conversation] } = await client.query('SELECT type FROM conversations WHERE id = $1', [appel.conversation_id]);
  const lien = conversation.type === 'groupe' ? `/messages/groupe/${appel.conversation_id}` : `/messages/${appel.conversation_id}`;
  for (const absent of absents) {
    await notifier(client, absent.membre_id, 'appel_manque', `Appel manqué de ${absent.nom}.`, lien, { acteur: { id: appel.appelant_id } });
  }
}

// Remet les appels en ordre, à chaque lecture (pas de tâche programmée) :
//  - une sonnerie de plus de 30 secondes devient « Appel manqué » ;
//  - un appel en cours où il reste moins de deux personnes présentes (les autres ont fermé la page) est terminé.
// SKIP LOCKED : deux lectures au même instant ne traitent pas le même appel deux fois.
async function entretenir() {
  await db.transaction(async (client) => {
    const { rows } = await client.query(
      `SELECT a.id, a.conversation_id, a.appelant_id, a.type, a.statut,
              a.statut = 'sonne' AND a.cree_le < now() - make_interval(secs => $1) AS trop_long,
              (SELECT count(*)::int FROM appel_participants p
                WHERE p.appel_id = a.id AND p.etat = 'present' AND p.vu_le > now() - make_interval(secs => $2)) AS presents
         FROM appels a
        WHERE a.statut IN ('sonne', 'en_cours')
        FOR UPDATE OF a SKIP LOCKED`,
      [SONNERIE_S, ABSENCE_S],
    );
    for (const appel of rows) {
      if (appel.statut === 'sonne' && (appel.trop_long || appel.presents === 0)) await clore(client, appel, 'manque');
      else if (appel.statut === 'en_cours' && appel.presents < 2) await clore(client, appel, 'termine');
    }
  });
}

// L'appel qui sonne pour moi en ce moment (ou null) : affiché par toutes les pages du site.
async function appelEntrant(moiId) {
  const { rows: [ligne] } = await db.query(
    `SELECT a.id, a.type, a.conversation_id, c.type AS type_conversation, c.titre, ${COLONNES_MEMBRE}
       FROM appels a
       JOIN appel_participants p ON p.appel_id = a.id AND p.membre_id = $1 AND p.etat = 'invite'
       JOIN conversations c ON c.id = a.conversation_id
       JOIN utilisateurs u ON u.id = a.appelant_id AND u.bloque = FALSE
      WHERE a.statut IN ('sonne', 'en_cours') AND (a.statut = 'en_cours' OR a.cree_le > now() - make_interval(secs => $2))
        AND (a.statut = 'sonne' OR c.type = 'groupe')
      ORDER BY a.id DESC LIMIT 1`,
    [moiId, SONNERIE_S],
  );
  if (!ligne) return null;
  return { id: ligne.id, type: ligne.type, conversationId: ligne.conversation_id, groupe: ligne.type_conversation === 'groupe', titre: ligne.titre, appelant: apercuMembre(ligne) };
}

module.exports = function appels({ maConversation, droitDEcrire, monGroupe }) {
  const router = express.Router();
  const limiteAppels = limiteParMembre(20, 60, 'Tu as lancé beaucoup d\'appels. Réessaie dans une heure.');

  // L'appel de l'adresse, si j'en suis participant. Sinon 404.
  async function monAppel(valeurId, moi, executeur = db) {
    const id = v.idPositif(valeurId);
    const { rows: [appel] } = id ? await executeur.query(
      `SELECT a.id, a.conversation_id, a.appelant_id, a.type, a.statut, a.cree_le, a.debut_le, c.type AS type_conversation, p.etat AS mon_etat
         FROM appels a
         JOIN appel_participants p ON p.appel_id = a.id AND p.membre_id = $2
         JOIN conversations c ON c.id = a.conversation_id
        WHERE a.id = $1`,
      [id, moi.id],
    ) : { rows: [] };
    if (!appel) throw new v.ErreurHttp(404, 'Cet appel n\'existe pas.');
    return appel;
  }

  async function etat(appelId, moi) {
    const { rows: [appel] } = await db.query('SELECT a.id, a.type, a.statut, a.conversation_id, a.debut_le, c.type AS type_conversation FROM appels a JOIN conversations c ON c.id = a.conversation_id WHERE a.id = $1', [appelId]);
    const { rows } = await db.query(
      `SELECT u.id, p.etat, p.vu_le > now() - make_interval(secs => $2) AS vivant, ${COLONNES_MEMBRE}
         FROM appel_participants p JOIN utilisateurs u ON u.id = p.membre_id WHERE p.appel_id = $1 ORDER BY u.id`,
      [appelId, ABSENCE_S],
    );
    return {
      id: appel.id,
      type: appel.type,
      statut: appel.statut,
      conversationId: appel.conversation_id,
      groupe: appel.type_conversation === 'groupe',
      debutLe: appel.debut_le,
      participants: rows.map((ligne) => ({ ...apercuMembre(ligne), estMoi: ligne.id === moi.id, etat: ligne.etat === 'present' && !ligne.vivant ? 'parti' : ligne.etat })),
    };
  }

  // Les serveurs STUN / TURN pour ce membre : GET /api/messages/appels/config
  router.get('/config', (req, res) => {
    res.set('Cache-Control', 'no-store').json({ iceServers: serveursIce(req.utilisateur.id), validite: DUREE_TURN_S });
  });

  // L'appel qui sonne pour moi : GET /api/messages/appels/entrant
  router.get('/entrant', async (req, res) => {
    await entretenir();
    res.json({ appel: await appelEntrant(req.utilisateur.id) });
  });

  // Lancer un appel : POST /api/messages/appels  { conversationId, type: 'audio' | 'video' }
  router.post('/', limiteAppels, async (req, res) => {
    const moi = req.utilisateur;
    const type = v.parmi(req.body?.type, ['audio', 'video'], 'type');
    const conversationId = v.idPositif(req.body?.conversationId);
    const { rows: [conversation] } = conversationId ? await db.query('SELECT id, type FROM conversations WHERE id = $1', [conversationId]) : { rows: [] };
    if (!conversation) throw new v.ErreurHttp(404, 'Cette conversation n\'existe pas.');

    let invites;
    if (conversation.type === 'groupe') {
      const groupe = await monGroupe(conversation.id, moi); // 404 si je n'en suis pas membre
      if (groupe.ferme_le) throw new v.ErreurHttp(403, 'Cette équipe a été dissoute.');
      if (type !== 'audio') throw new v.ErreurValidation('Dans un groupe, les appels sont en audio seulement.', 'type');
      invites = (await db.query(
        `SELECT cm.membre_id FROM conversation_membres cm JOIN utilisateurs u ON u.id = cm.membre_id AND u.bloque = FALSE
          WHERE cm.conversation_id = $1 AND cm.quitte_le IS NULL AND cm.membre_id <> $2`,
        [conversation.id, moi.id],
      )).rows.map((ligne) => ligne.membre_id);
      if (invites.length === 0) throw new v.ErreurValidation('Tu es seul dans ce groupe.');
    } else {
      // Mêmes règles que pour écrire : conversation acceptée, pas de blocage dans un sens ni dans l'autre.
      const ligne = await maConversation(conversation.id, moi); // 404 si je n'y ai pas accès
      const droit = await droitDEcrire(db, moi, ligne.autre_id, ligne);
      if (ligne.statut !== 'acceptee' || !droit.peutEcrire) {
        throw new v.ErreurHttp(403, droit.raison || 'Tu pourras appeler ce membre quand il aura accepté ta demande de message.');
      }
      invites = [ligne.autre_id];
    }

    await entretenir();
    const resultat = await db.transaction(async (client) => {
      // Un verrou par conversation : deux personnes qui s'appellent au même instant ne créent pas deux appels.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`appel:${conversation.id}`]);
      if (await occupe(client, moi.id)) throw new v.ErreurHttp(409, 'Tu es déjà en appel.');
      const { rows: [enCours] } = await client.query('SELECT id FROM appels WHERE conversation_id = $1 AND statut IN (\'sonne\', \'en_cours\') ORDER BY id DESC LIMIT 1', [conversation.id]);
      if (enCours) return { existant: enCours.id }; // un appel existe déjà ici : la page proposera de le rejoindre

      const { rows: [appel] } = await client.query(
        'INSERT INTO appels (conversation_id, appelant_id, type) VALUES ($1, $2, $3) RETURNING id, conversation_id, appelant_id, type',
        [conversation.id, moi.id, type],
      );
      await client.query('INSERT INTO appel_participants (appel_id, membre_id, etat) VALUES ($1, $2, \'present\')', [appel.id, moi.id]);
      // En privé, si l'autre est déjà en appel : « Occupé ». Il verra un appel manqué.
      if (conversation.type !== 'groupe' && await occupe(client, invites[0])) {
        await client.query('INSERT INTO appel_participants (appel_id, membre_id) VALUES ($1, $2)', [appel.id, invites[0]]);
        await clore(client, appel, 'manque');
        return { occupe: true };
      }
      for (const membreId of invites) await client.query('INSERT INTO appel_participants (appel_id, membre_id) VALUES ($1, $2)', [appel.id, membreId]);
      return { appel };
    });
    if (resultat.occupe) return res.status(200).json({ occupe: true });
    if (resultat.existant) return res.status(200).json({ existant: true, appel: await etat(resultat.existant, moi) });

    // Le téléphone de chaque invité sonne, même site fermé : un push « Awa t'appelle ». Rien dans la cloche tant
    // que l'appel n'est pas manqué.
    const lien = conversation.type === 'groupe' ? `/messages/groupe/${conversation.id}?appel=${resultat.appel.id}` : `/messages/${conversation.id}?appel=${resultat.appel.id}`;
    for (const membreId of invites) {
      push.envoyerPush(membreId, 'appel', { titre: `${moi.nom} t'appelle`, texte: type === 'video' ? 'Appel vidéo Palabre' : 'Appel audio Palabre', lien, tag: `appel-${resultat.appel.id}`, appel: resultat.appel.id });
    }
    return res.status(201).json({ appel: await etat(resultat.appel.id, moi) });
  });

  // Décrocher (ou rejoindre un appel de groupe en cours) : POST /api/messages/appels/:id/accepter
  router.post('/:id/accepter', async (req, res) => {
    const moi = req.utilisateur;
    await entretenir();
    await db.transaction(async (client) => {
      const appel = await monAppel(req.params.id, moi, client);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`appel:${appel.conversation_id}`]);
      const { rows: [frais] } = await client.query('SELECT statut FROM appels WHERE id = $1 FOR UPDATE', [appel.id]);
      if (!['sonne', 'en_cours'].includes(frais.statut)) throw new v.ErreurHttp(410, 'Cet appel est terminé.');
      if (await occupe(client, moi.id, appel.id)) throw new v.ErreurHttp(409, 'Tu es déjà en appel.');
      const { rows: [compte] } = await client.query(
        `SELECT count(*)::int AS presents FROM appel_participants
          WHERE appel_id = $1 AND etat = 'present' AND membre_id <> $2 AND vu_le > now() - make_interval(secs => $3)`,
        [appel.id, moi.id, ABSENCE_S],
      );
      if (compte.presents >= MAX_PARTICIPANTS) throw new v.ErreurHttp(409, `L'appel est complet (${MAX_PARTICIPANTS} personnes).`);
      await client.query('UPDATE appel_participants SET etat = \'present\', vu_le = now() WHERE appel_id = $1 AND membre_id = $2', [appel.id, moi.id]);
      await client.query('UPDATE appels SET statut = \'en_cours\', debut_le = COALESCE(debut_le, now()) WHERE id = $1', [appel.id]);
    });
    res.json({ appel: await etat(v.idPositif(req.params.id), moi) });
  });

  // Refuser : POST /api/messages/appels/:id/refuser. En privé, l'appel s'arrête là ; dans un groupe, les autres continuent.
  router.post('/:id/refuser', async (req, res) => {
    const moi = req.utilisateur;
    await db.transaction(async (client) => {
      const appel = await monAppel(req.params.id, moi, client);
      await client.query('UPDATE appel_participants SET etat = \'refuse\' WHERE appel_id = $1 AND membre_id = $2 AND etat = \'invite\'', [appel.id, moi.id]);
      if (appel.type_conversation !== 'groupe' && appel.statut === 'sonne') await clore(client, appel, 'manque');
    });
    await entretenir();
    res.json({ ok: true });
  });

  // Raccrocher : POST /api/messages/appels/:id/raccrocher
  router.post('/:id/raccrocher', async (req, res) => {
    const moi = req.utilisateur;
    await db.transaction(async (client) => {
      const appel = await monAppel(req.params.id, moi, client);
      await client.query('UPDATE appel_participants SET etat = \'parti\' WHERE appel_id = $1 AND membre_id = $2', [appel.id, moi.id]);
      // L'appelant raccroche avant que quiconque décroche : c'est un appel manqué pour les invités.
      if (appel.statut === 'sonne' && appel.appelant_id === moi.id) await clore(client, appel, 'manque');
      else if (appel.statut === 'en_cours') {
        const { rows: [reste] } = await client.query(
          `SELECT count(*)::int AS presents FROM appel_participants WHERE appel_id = $1 AND etat = 'present' AND vu_le > now() - make_interval(secs => $2)`,
          [appel.id, ABSENCE_S],
        );
        if (reste.presents < 2) await clore(client, appel, 'termine');
      }
    });
    res.json({ ok: true });
  });

  // Envoyer un message technique à un autre participant : POST /api/messages/appels/:id/signal  { pour, type, contenu }
  // (offre, réponse, candidat ICE, demande de relance). Le serveur le transporte sans le lire.
  router.post('/:id/signal', async (req, res) => {
    const moi = req.utilisateur;
    const appel = await monAppel(req.params.id, moi);
    if (appel.mon_etat !== 'present' || !['sonne', 'en_cours'].includes(appel.statut)) throw new v.ErreurHttp(410, 'Cet appel est terminé.');
    const type = v.parmi(req.body?.type, TYPES_SIGNAUX, 'type');
    const contenu = JSON.stringify(req.body?.contenu ?? null);
    if (contenu.length > 20000) throw new v.ErreurValidation('Message technique trop long.', 'contenu');
    const pour = typeof req.body?.pour === 'string' ? req.body.pour.toLowerCase() : '';
    const { rowCount } = await db.query(
      `INSERT INTO appel_signaux (appel_id, de_id, pour_id, type, contenu)
       SELECT $1, $2, p.membre_id, $4, $5::jsonb
         FROM appel_participants p JOIN utilisateurs u ON u.id = p.membre_id
        WHERE p.appel_id = $1 AND u.identifiant = $3 AND p.membre_id <> $2 AND p.etat = 'present'`,
      [appel.id, moi.id, pour, type, contenu],
    );
    if (rowCount === 0) throw new v.ErreurHttp(404, 'Ce participant n\'est pas dans l\'appel.');
    res.status(201).json({ ok: true });
  });

  // L'état de l'appel et les messages techniques qui me sont destinés : GET /api/messages/appels/:id?apres=<id>
  // Interrogé chaque seconde, et seulement pendant un appel (qui sonne ou en cours). Sert aussi de « je suis là ».
  router.get('/:id', async (req, res) => {
    const moi = req.utilisateur;
    const appel = await monAppel(req.params.id, moi);
    if (appel.mon_etat === 'present') await db.query('UPDATE appel_participants SET vu_le = now() WHERE appel_id = $1 AND membre_id = $2', [appel.id, moi.id]);
    await entretenir();
    const { rows: signaux } = await db.query(
      `SELECT s.id, s.type, s.contenu, u.identifiant AS de FROM appel_signaux s JOIN utilisateurs u ON u.id = s.de_id
        WHERE s.appel_id = $1 AND s.pour_id = $2 AND s.id > $3 ORDER BY s.id LIMIT 200`,
      [appel.id, moi.id, v.idPositif(req.query.apres) || 0],
    );
    res.set('Cache-Control', 'no-store').json({ appel: await etat(appel.id, moi), signaux: signaux.map((s) => ({ id: Number(s.id), de: s.de, type: s.type, contenu: s.contenu })) });
  });

  return router;
};
module.exports.appelEntrant = appelEntrant;
module.exports.entretenir = entretenir;
module.exports.serveursIce = serveursIce;
module.exports.SONNERIE_S = SONNERIE_S;
