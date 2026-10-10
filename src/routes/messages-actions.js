// Ce qu'on fait SUR un message, dans une conversation privée comme dans un groupe : réagir, supprimer.
// Monté sous /api/messages/message par routes/messages.js (donc derrière exigerConnexion).
//
// L'accès n'est pas réinventé ici : on retrouve la conversation du message, puis on applique SA règle
// (maConversation() pour une conversation privée, monGroupe() pour un groupe). Qui ne peut pas lire la
// conversation reçoit 404, comme si le message n'existait pas.
const express = require('express');
const db = require('../db/pool');
const v = require('../utils/validation');
const { limiteParMembre } = require('../utils/membres');
const { REACTIONS, DELAI_SUPPRESSION_MIN, lireMessage } = require('../utils/messages');

module.exports = function actionsSurMessages({ maConversation, monGroupe }) {
  const router = express.Router();
  const limite = limiteParMembre(120, 1, 'Doucement. Réessaie dans une minute.');

  // Le message de l'adresse, si je peux le lire. Renvoie aussi l'état de sa conversation.
  async function monMessage(valeurId, moi) {
    const id = v.idPositif(valeurId);
    const { rows: [message] } = id ? await db.query(
      `SELECT m.id, m.conversation_id, m.auteur_id, m.systeme, m.supprime_le, m.cree_le, m.fichier_id, c.type
         FROM messages m JOIN conversations c ON c.id = m.conversation_id
        WHERE m.id = $1 AND m.masque = FALSE
          AND NOT EXISTS (SELECT 1 FROM messages_masques mm WHERE mm.message_id = m.id AND mm.membre_id = $2)`,
      [id, moi.id],
    ) : { rows: [] };
    if (!message) throw new v.ErreurHttp(404, 'Ce message n\'existe pas.');
    if (message.type === 'groupe') {
      const groupe = await monGroupe(message.conversation_id, moi); // 404 si je n'en suis pas membre
      message.ouverte = !groupe.ferme_le;
    } else {
      const conversation = await maConversation(message.conversation_id, moi); // 404 si je n'y ai pas accès
      message.ouverte = conversation.statut === 'acceptee';
    }
    return message;
  }
  const toucher = (executeur, id) => executeur.query('UPDATE messages SET modifie_le = now() WHERE id = $1', [id]);

  // Réagir : POST /api/messages/message/:id/reaction  { emoji }
  // Une réaction par personne et par message : en choisir une autre remplace la précédente (clé primaire).
  router.post('/:id/reaction', limite, async (req, res) => {
    const moi = req.utilisateur;
    const emoji = v.parmi(req.body?.emoji, REACTIONS, 'emoji');
    const message = await monMessage(req.params.id, moi);
    if (message.systeme || message.supprime_le) throw new v.ErreurValidation('On ne peut pas réagir à ce message.');
    if (!message.ouverte) throw new v.ErreurHttp(403, 'Cette conversation n\'accepte plus de réactions.');
    await db.transaction(async (client) => {
      await client.query(
        `INSERT INTO message_reactions (message_id, membre_id, emoji) VALUES ($1, $2, $3)
         ON CONFLICT (message_id, membre_id) DO UPDATE SET emoji = EXCLUDED.emoji, cree_le = now()`,
        [message.id, moi.id, emoji],
      );
      await toucher(client, message.id);
    });
    res.json({ message: await lireMessage(message.conversation_id, message.id, moi) });
  });

  // Retirer sa réaction : DELETE /api/messages/message/:id/reaction
  router.delete('/:id/reaction', limite, async (req, res) => {
    const moi = req.utilisateur;
    const message = await monMessage(req.params.id, moi);
    await db.transaction(async (client) => {
      const { rowCount } = await client.query('DELETE FROM message_reactions WHERE message_id = $1 AND membre_id = $2', [message.id, moi.id]);
      if (rowCount) await toucher(client, message.id);
    });
    res.json({ message: await lireMessage(message.conversation_id, message.id, moi) });
  });

  // Supprimer : DELETE /api/messages/message/:id  { pourTous }
  //  - pour tout le monde : l'auteur seulement, pendant 15 minutes. Le texte et la photo sont EFFACÉS de la base
  //    (pas seulement cachés) ; il reste une bulle « Message supprimé ».
  //  - pour moi : le message disparaît de MON écran seulement, à tout moment.
  router.delete('/:id', limite, async (req, res) => {
    const moi = req.utilisateur;
    const message = await monMessage(req.params.id, moi);
    if (req.body?.pourTous !== true) {
      await db.query('INSERT INTO messages_masques (message_id, membre_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [message.id, moi.id]);
      return res.json({ supprime: 'pour-moi' });
    }
    if (message.auteur_id !== moi.id || message.systeme) throw new v.ErreurHttp(403, 'Tu ne peux supprimer pour tout le monde que tes propres messages.');
    if (message.supprime_le) throw new v.ErreurValidation('Ce message est déjà supprimé.');
    if (Date.now() - new Date(message.cree_le).getTime() > DELAI_SUPPRESSION_MIN * 60000) {
      throw new v.ErreurValidation(`Un message ne peut être supprimé pour tout le monde que pendant ${DELAI_SUPPRESSION_MIN} minutes. Tu peux encore le supprimer pour toi.`);
    }
    await db.transaction(async (client) => {
      await client.query(
        'UPDATE messages SET texte = \'Message supprimé\', fichier_id = NULL, supprime_le = now(), modifie_le = now() WHERE id = $1',
        [message.id],
      );
      // La photo (ou le vocal) part vraiment : la ligne du fichier est supprimée, pas seulement détachée.
      if (message.fichier_id) await client.query('DELETE FROM fichiers WHERE id = $1', [message.fichier_id]);
      await client.query('DELETE FROM message_reactions WHERE message_id = $1', [message.id]);
    });
    return res.json({ supprime: 'pour-tous', message: await lireMessage(message.conversation_id, message.id, moi) });
  });

  return router;
};
