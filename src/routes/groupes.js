// Conversations de groupe : le groupe d'une équipe éclair (chef, membres qui ont accepté, puis le client choisi).
// Monté sous /api/messages/groupes par routes/messages.js, donc toujours derrière exigerConnexion.
//
// Règle unique d'accès : il faut être un membre ACTUEL du groupe (ligne dans conversation_membres, sans date de
// départ). Pour tout autre, le groupe « n'existe pas » (404) : ni lecture, ni écriture, ni même son titre.
// Les conversations privées gardent leurs propres règles (routes/messages.js, droitDEcrire()) : rien n'y change.
const express = require('express');
const db = require('../db/pool');
const v = require('../utils/validation');
const { controler } = require('../utils/moderation');
const { apercuMembre, COLONNES_MEMBRE, limiteParMembre } = require('../utils/membres');
const { notifier, court } = require('../utils/notifications');
const { messageSysteme } = require('../utils/groupes');
const { lireMessages, lireMessage, messagesModifies, origineValide, lireContenu, enregistrerPiece } = require('../utils/messages');
const { presenceVue, signalerEcriture, finEcriture, quiEcrit } = require('../utils/presence');

const router = express.Router();
// La même limite pour les conversations privées et les groupes : 30 messages par minute et par membre.
const limiteMessages = limiteParMembre(30, 1, 'Tu écris très vite. Attends une minute avant d\'envoyer d\'autres messages.');

// Mes groupes ($1 = moi) : ceux dont je suis membre actuel.
const MIEN = `c.type = 'groupe' AND EXISTS (SELECT 1 FROM conversation_membres moi
                WHERE moi.conversation_id = c.id AND moi.membre_id = $1 AND moi.quitte_le IS NULL)`;
// Messages des autres que je n'ai pas lus (les messages système ne comptent pas).
const NON_LUS = `(SELECT count(*)::int FROM messages m
    WHERE m.conversation_id = c.id AND m.auteur_id <> $1 AND m.masque = FALSE AND m.systeme = FALSE
      AND m.id > COALESCE((SELECT l.dernier_lu_id FROM conversation_lectures l
                            WHERE l.conversation_id = c.id AND l.membre_id = $1), 0))`;

// Le groupe de l'adresse, seulement si j'en suis membre actuel. Sinon 404.
async function monGroupe(valeurId, moi) {
  const id = v.idPositif(valeurId);
  const { rows } = id ? await db.query(
    `SELECT c.id, c.titre, c.equipe_id, c.ferme_le, d.id AS demande_id, d.titre AS demande_titre, d.statut AS demande_statut,
            d.client_id, e.chef_id, cm.role AS mon_role, cm.sourdine
       FROM conversations c
       JOIN conversation_membres cm ON cm.conversation_id = c.id AND cm.membre_id = $1 AND cm.quitte_le IS NULL
       LEFT JOIN equipes e ON e.id = c.equipe_id
       LEFT JOIN demandes d ON d.id = e.demande_id AND d.masque = FALSE
      WHERE c.id = $2 AND c.type = 'groupe'`,
    [moi.id, id],
  ) : { rows: [] };
  if (!rows[0]) throw new v.ErreurHttp(404, 'Cette conversation n\'existe pas.');
  return rows[0];
}

// Les membres actuels, avec leur rôle dans l'équipe et jusqu'où ils ont lu. Un compte bloqué n'est pas montré.
async function membresDuGroupe(groupe, moi) {
  const { rows } = await db.query(
    `SELECT u.id, cm.role, em.role AS role_equipe, u.vu_le, u.masquer_presence, ${COLONNES_MEMBRE},
            COALESCE((SELECT l.dernier_lu_id FROM conversation_lectures l WHERE l.conversation_id = cm.conversation_id AND l.membre_id = u.id), 0) AS lu_jusqua
       FROM conversation_membres cm
       JOIN utilisateurs u ON u.id = cm.membre_id AND u.bloque = FALSE
       LEFT JOIN equipe_membres em ON em.equipe_id = $2 AND em.dev_id = u.id
      WHERE cm.conversation_id = $1 AND cm.quitte_le IS NULL
      ORDER BY (cm.role = 'admin') DESC, cm.rejoint_le, u.id`,
    [groupe.id, groupe.equipe_id],
  );
  return rows.map((ligne) => ({
    ...apercuMembre(ligne),
    estMoi: ligne.id === moi.id,
    chef: ligne.role === 'admin',
    estClient: ligne.id === groupe.client_id,
    roleEquipe: ligne.role_equipe,
    luJusqua: ligne.lu_jusqua,
    presence: ligne.id === moi.id ? null : presenceVue(moi, ligne),
  }));
}

function versGroupe(groupe, membres) {
  return {
    id: groupe.id,
    titre: groupe.titre,
    ferme: Boolean(groupe.ferme_le),
    demande: groupe.demande_id ? { id: groupe.demande_id, titre: groupe.demande_titre } : null,
    membres,
    jeSuisChef: groupe.mon_role === 'admin',
    sourdine: groupe.sourdine,
    peutEcrire: !groupe.ferme_le,
    raison: groupe.ferme_le ? 'Cette équipe a été dissoute. La discussion reste lisible.' : null,
  };
}

// Mes groupes, pour la liste des conversations (appelé par routes/messages.js).
// Un seul aller-retour : le dernier message et son auteur (LATERAL), les premiers membres pour les avatars empilés.
async function listerGroupes(moi) {
  const { rows } = await db.query(
    `SELECT c.id, c.titre, c.ferme_le, c.dernier_message_le, ${NON_LUS} AS non_lus,
            dernier.texte AS dernier_texte, dernier.cree_le AS dernier_le, dernier.auteur_id AS dernier_auteur,
            dernier.systeme AS dernier_systeme, dernier.prenom AS dernier_prenom, dernier.fichier_id IS NOT NULL AS dernier_image,
            (SELECT count(*)::int FROM conversation_membres n WHERE n.conversation_id = c.id AND n.quitte_le IS NULL) AS nb_membres,
            (SELECT json_agg(to_jsonb(t)) FROM (
               SELECT ${COLONNES_MEMBRE} FROM conversation_membres cm2
                 JOIN utilisateurs u ON u.id = cm2.membre_id AND u.bloque = FALSE
                WHERE cm2.conversation_id = c.id AND cm2.quitte_le IS NULL AND cm2.membre_id <> $1
                ORDER BY cm2.rejoint_le LIMIT 3) t) AS apercus
       FROM conversations c
       LEFT JOIN LATERAL (
         SELECT m.texte, m.cree_le, m.auteur_id, m.systeme, m.fichier_id, a.prenom FROM messages m
           JOIN utilisateurs a ON a.id = m.auteur_id
          WHERE m.conversation_id = c.id AND m.masque = FALSE ORDER BY m.id DESC LIMIT 1
       ) dernier ON TRUE
      WHERE ${MIEN}
      ORDER BY c.dernier_message_le DESC
      LIMIT 50`,
    [moi.id],
  );
  return rows.map((ligne) => ({
    id: ligne.id,
    type: 'groupe',
    titre: ligne.titre,
    ferme: Boolean(ligne.ferme_le),
    nbMembres: ligne.nb_membres,
    membres: (ligne.apercus || []).map(apercuMembre),
    actifLe: ligne.dernier_message_le,
    dernierMessage: ligne.dernier_le ? {
      texte: ligne.dernier_texte, creeLe: ligne.dernier_le, estMoi: ligne.dernier_auteur === moi.id && !ligne.dernier_systeme,
      systeme: ligne.dernier_systeme, prenom: ligne.dernier_prenom, aImage: ligne.dernier_image,
    } : null,
    nonLus: ligne.non_lus,
  }));
}

// Total des messages de groupe non lus (pour la pastille de l'en-tête, ajouté à celui des conversations privées).
async function compterNonLusGroupes(moiId) {
  const { rows: [total] } = await db.query(`SELECT COALESCE(sum(${NON_LUS}), 0)::int AS nb FROM conversations c WHERE ${MIEN}`, [moiId]);
  return total.nb;
}

// ---------- Lire ----------

// Le groupe et ses messages, par paquets de 30 : GET /api/messages/groupes/:id?avant=<id>
router.get('/:id', async (req, res) => {
  const moi = req.utilisateur;
  const groupe = await monGroupe(req.params.id, moi);
  const [{ rows: [{ maintenant }] }, page, membres] = await Promise.all([
    db.query('SELECT now() AS maintenant'),
    lireMessages(groupe.id, moi, { avant: v.idPositif(req.query.avant) }),
    membresDuGroupe(groupe, moi),
  ]);
  res.json({ groupe: versGroupe(groupe, membres), messages: page.messages, precedent: page.precedent, maintenant });
});

// Ce qui est arrivé depuis le message « apres » (interrogé toutes les 5 secondes quand le groupe est ouvert).
router.get('/:id/nouveaux', async (req, res) => {
  const moi = req.utilisateur;
  const groupe = await monGroupe(req.params.id, moi);
  const apres = v.idPositif(req.query.apres) || 0;
  const { rows: [{ maintenant }] } = await db.query('SELECT now() AS maintenant');
  const [nouveaux, modifies, ecrivent, { rows: lectures }] = await Promise.all([
    lireMessages(groupe.id, moi, { apres }),
    messagesModifies(groupe.id, moi, req.query.depuis, apres),
    groupe.ferme_le ? [] : quiEcrit(groupe.id, moi.id),
    // « Vu par » : jusqu'où chaque autre membre a lu (la page pose son petit avatar sous ce message).
    db.query(
      `SELECT u.identifiant, COALESCE(l.dernier_lu_id, 0) AS lu_jusqua
         FROM conversation_membres cm
         JOIN utilisateurs u ON u.id = cm.membre_id AND u.bloque = FALSE
         LEFT JOIN conversation_lectures l ON l.conversation_id = cm.conversation_id AND l.membre_id = cm.membre_id
        WHERE cm.conversation_id = $1 AND cm.quitte_le IS NULL AND cm.membre_id <> $2`,
      [groupe.id, moi.id],
    ),
  ]);
  res.json({
    messages: nouveaux.messages, modifies, maintenant, ferme: Boolean(groupe.ferme_le), titre: groupe.titre,
    ecrivent, lectures: lectures.map((l) => ({ identifiant: l.identifiant, luJusqua: l.lu_jusqua })),
  });
});

// ---------- Écrire ----------

// Envoyer un message au groupe : POST /api/messages/groupes/:id  { texte, image? }
router.post('/:id', limiteMessages, async (req, res) => {
  const moi = req.utilisateur;
  const groupe = await monGroupe(req.params.id, moi);
  if (groupe.ferme_le) throw new v.ErreurHttp(403, 'Cette équipe a été dissoute : on ne peut plus écrire dans ce groupe.');
  const { texte, image, vocal } = lireContenu(req.body || {});
  // Message privé : personne ne le lit ; le filtre ne retient que les insultes et les liens dangereux.
  if (!vocal) await controler(req, [[texte, 'texte']], { mode: 'prive' });

  const message = await db.transaction(async (client) => {
    const fichierId = await enregistrerPiece(client, moi.id, { image, vocal });
    const reponseA = await origineValide(client, groupe.id, req.body?.reponseA);
    const { rows: [cree] } = await client.query(
      'INSERT INTO messages (conversation_id, auteur_id, texte, fichier_id, reponse_a, vocal_duree) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [groupe.id, moi.id, texte, fichierId, reponseA, vocal ? vocal.duree : null],
    );
    await client.query('UPDATE conversations SET dernier_message_le = now() WHERE id = $1', [groupe.id]);
    await finEcriture(client, groupe.id, moi.id);
    await client.query(
      `INSERT INTO conversation_lectures (conversation_id, membre_id, dernier_lu_id) VALUES ($1, $2, $3)
       ON CONFLICT (conversation_id, membre_id) DO UPDATE SET dernier_lu_id = EXCLUDED.dernier_lu_id`,
      [groupe.id, moi.id, cree.id],
    );
    // La cloche et le push : UNE notification par groupe et par membre, mise à jour tant qu'elle n'est pas lue.
    // Un membre qui a mis le groupe en sourdine n'est pas prévenu (il verra quand même la pastille des messages).
    const { rows: autres } = await client.query(
      `SELECT cm.membre_id FROM conversation_membres cm JOIN utilisateurs u ON u.id = cm.membre_id AND u.bloque = FALSE
        WHERE cm.conversation_id = $1 AND cm.quitte_le IS NULL AND cm.sourdine = FALSE AND cm.membre_id <> $2`,
      [groupe.id, moi.id],
    );
    for (const autre of autres) {
      await notifier(client, autre.membre_id, 'message',
        (n) => (n === 1 ? `${moi.nom} a écrit dans « ${court(groupe.titre, 50)} ».` : `${n} nouveaux messages dans « ${court(groupe.titre, 50)} ».`),
        `/messages/groupe/${groupe.id}`, {
          acteur: moi,
          cible: { type: 'conversation', id: groupe.id },
          groupe: 'compteur',
          push: { titre: court(groupe.titre, 50), texte: `${moi.prenom || moi.nom} : ${image && !texte ? 'Photo' : court(texte, 60)}` },
        });
    }
    return lireMessage(groupe.id, cree.id, moi, client);
  });
  res.status(201).json({ message });
});

// « J'écris » : POST /api/messages/groupes/:id/ecrit
router.post('/:id/ecrit', async (req, res) => {
  const groupe = await monGroupe(req.params.id, req.utilisateur);
  if (!groupe.ferme_le) await signalerEcriture(groupe.id, req.utilisateur.id);
  res.json({ ok: true });
});

// J'ai lu jusqu'ici : POST /api/messages/groupes/:id/lu
router.post('/:id/lu', async (req, res) => {
  const moi = req.utilisateur;
  const groupe = await monGroupe(req.params.id, moi);
  await db.query(
    `INSERT INTO conversation_lectures (conversation_id, membre_id, dernier_lu_id)
     SELECT $1, $2, COALESCE(max(id), 0) FROM messages WHERE conversation_id = $1
     ON CONFLICT (conversation_id, membre_id) DO UPDATE SET dernier_lu_id = GREATEST(conversation_lectures.dernier_lu_id, EXCLUDED.dernier_lu_id)`,
    [groupe.id, moi.id],
  );
  await db.query(
    `UPDATE notifications SET lue = TRUE
      WHERE utilisateur_id = $1 AND type = 'message' AND cible_type = 'conversation' AND cible_id = $2 AND lue = FALSE`,
    [moi.id, groupe.id],
  );
  res.json({ ok: true });
});

// ---------- Régler ----------

// Renommer le groupe (le chef seulement) : PUT /api/messages/groupes/:id  { titre }
router.put('/:id', async (req, res) => {
  const moi = req.utilisateur;
  const groupe = await monGroupe(req.params.id, moi);
  if (groupe.mon_role !== 'admin') throw new v.ErreurHttp(403, 'Seul le chef de l\'équipe peut renommer le groupe.');
  if (groupe.ferme_le) throw new v.ErreurHttp(403, 'Ce groupe est fermé.');
  const titre = v.texte(req.body?.titre, 'titre', { min: 3, max: 80 });
  await controler(req, [[titre, 'titre']], { mode: 'strict' });
  await db.transaction(async (client) => {
    await client.query('UPDATE conversations SET titre = $2 WHERE id = $1', [groupe.id, titre]);
    await messageSysteme(client, groupe.id, moi.id, `${moi.nom} a renommé le groupe : « ${titre} ».`);
  });
  res.json({ titre });
});

// Sourdine : POST /api/messages/groupes/:id/sourdine  { active } — plus de cloche ni de push pour ce groupe.
router.post('/:id/sourdine', async (req, res) => {
  const moi = req.utilisateur;
  const groupe = await monGroupe(req.params.id, moi);
  if (typeof req.body?.active !== 'boolean') throw new v.ErreurValidation('Choix illisible.', 'active');
  await db.query('UPDATE conversation_membres SET sourdine = $3 WHERE conversation_id = $1 AND membre_id = $2', [groupe.id, moi.id, req.body.active]);
  res.json({ sourdine: req.body.active });
});

// Quitter le groupe : POST /api/messages/groupes/:id/quitter
// Un développeur quitte aussi l'équipe tant que le client n'a pas choisi (ensuite, il reste engagé envers lui).
// Le chef ne quitte pas : il dissout l'équipe depuis la page de la demande.
router.post('/:id/quitter', async (req, res) => {
  const moi = req.utilisateur;
  const groupe = await monGroupe(req.params.id, moi);
  // (Un groupe qui n'a plus d'équipe, parce que la demande a été supprimée, se quitte librement.)
  if (groupe.mon_role === 'admin' && !groupe.ferme_le && groupe.equipe_id) {
    throw new v.ErreurValidation('Tu es le chef de cette équipe : pour partir, dissous l\'équipe depuis la page de la demande.');
  }
  const quitteLEquipe = Boolean(groupe.equipe_id) && groupe.demande_statut === 'ouverte' && moi.id !== groupe.client_id;
  await db.transaction(async (client) => {
    await client.query('UPDATE conversation_membres SET quitte_le = now() WHERE conversation_id = $1 AND membre_id = $2', [groupe.id, moi.id]);
    if (quitteLEquipe) {
      await client.query('UPDATE equipe_membres SET statut = \'refuse\' WHERE equipe_id = $1 AND dev_id = $2', [groupe.equipe_id, moi.id]);
    }
    if (!groupe.ferme_le) await messageSysteme(client, groupe.id, moi.id, `${moi.nom} a quitté ${quitteLEquipe ? 'l\'équipe' : 'le groupe'}.`);
  });
  res.json({ ok: true, quitteLEquipe });
});

module.exports = router;
module.exports.limiteMessages = limiteMessages;
module.exports.monGroupe = monGroupe;
module.exports.listerGroupes = listerGroupes;
module.exports.compterNonLusGroupes = compterNonLusGroupes;
