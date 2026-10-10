// Ce que les conversations privées et les groupes ont en commun : lire des messages (avec leurs réactions et
// le message auquel ils répondent) et les mettre en forme pour le navigateur.
// Les règles d'ACCÈS ne sont pas ici : chaque famille garde les siennes (routes/messages.js et routes/groupes.js).
const db = require('../db/pool');
const { apercuMembre, COLONNES_MEMBRE } = require('./membres');

// Les six réactions proposées. La liste est fermée : le serveur n'enregistre rien d'autre.
const REACTIONS = ['❤️', '😂', '👍', '😮', '😢', '🙏'];
// Pendant ce délai, l'auteur peut supprimer son message pour tout le monde.
const DELAI_SUPPRESSION_MIN = 15;
const PAR_PAGE = 30;

// $1 : la conversation, $2 : le membre connecté.
// Tout arrive en une requête : l'auteur, les réactions regroupées par émoji, et un aperçu du message d'origine
// quand c'est une réponse. Un message que j'ai « supprimé pour moi » n'est pas rendu.
const SELECTION = `
  SELECT m.id, m.texte, m.fichier_id, m.cree_le, m.auteur_id, m.systeme, m.supprime_le, ${COLONNES_MEMBRE},
         (SELECT COALESCE(json_agg(json_build_object('emoji', r.emoji, 'nombre', r.nombre, 'moi', r.moi, 'qui', r.qui)), '[]'::json)
            FROM (SELECT mr.emoji, count(*)::int AS nombre, bool_or(mr.membre_id = $2) AS moi,
                         (array_agg(ru.nom ORDER BY mr.cree_le))[1:20] AS qui
                    FROM message_reactions mr
                    JOIN utilisateurs ru ON ru.id = mr.membre_id AND ru.bloque = FALSE
                   WHERE mr.message_id = m.id
                   GROUP BY mr.emoji
                   ORDER BY min(mr.cree_le)) r) AS reactions,
         (SELECT json_build_object(
                   'id', o.id,
                   'texte', CASE WHEN o.supprime_le IS NOT NULL OR o.masque THEN NULL ELSE left(o.texte, 90) END,
                   'prenom', ou.prenom, 'image', o.fichier_id IS NOT NULL)
            FROM messages o JOIN utilisateurs ou ON ou.id = o.auteur_id
           WHERE o.id = m.reponse_a AND o.conversation_id = m.conversation_id) AS origine
    FROM messages m
    JOIN utilisateurs u ON u.id = m.auteur_id
   WHERE m.conversation_id = $1 AND m.masque = FALSE
     AND NOT EXISTS (SELECT 1 FROM messages_masques mm WHERE mm.message_id = m.id AND mm.membre_id = $2)`;

function versMessage(ligne, moi) {
  const supprime = Boolean(ligne.supprime_le);
  const estMoi = ligne.auteur_id === moi.id && !ligne.systeme;
  return {
    id: ligne.id,
    // Un message supprimé pour tout le monde n'a plus ni texte ni photo : ils ont été effacés de la base.
    texte: supprime ? null : ligne.texte,
    image: !supprime && ligne.fichier_id ? `/fichiers/${ligne.fichier_id}` : null,
    creeLe: ligne.cree_le,
    estMoi,
    systeme: ligne.systeme,
    supprime,
    auteur: apercuMembre(ligne),
    reactions: supprime ? [] : (ligne.reactions || []),
    reponse: ligne.origine || null,
    // Le bouton « Supprimer pour tout le monde » : l'auteur seulement, pendant 15 minutes (le serveur revérifie).
    supprimable: estMoi && !supprime && Date.now() - new Date(ligne.cree_le).getTime() < DELAI_SUPPRESSION_MIN * 60000,
  };
}

// Une page de messages : les 30 d'avant « avant » (du plus ancien au plus récent), ou ceux d'après « apres ».
// Renvoie { messages, precedent }.
async function lireMessages(conversationId, moi, { avant = null, apres = null } = {}) {
  if (apres !== null) {
    const { rows } = await db.query(`${SELECTION} AND m.id > $3 ORDER BY m.id LIMIT 100`, [conversationId, moi.id, apres]);
    return { messages: rows.map((m) => versMessage(m, moi)), precedent: null };
  }
  const { rows } = await db.query(`${SELECTION} AND ($3::int IS NULL OR m.id < $3) ORDER BY m.id DESC LIMIT $4`, [conversationId, moi.id, avant, PAR_PAGE + 1]);
  const page = rows.slice(0, PAR_PAGE);
  return { messages: page.reverse().map((m) => versMessage(m, moi)), precedent: rows.length > PAR_PAGE ? page[0].id : null };
}

// Un seul message, dans sa forme complète (juste après l'avoir écrit, ou après une réaction).
async function lireMessage(conversationId, messageId, moi, executeur = db) {
  const { rows } = await executeur.query(`${SELECTION} AND m.id = $3`, [conversationId, moi.id, messageId]);
  return rows[0] ? versMessage(rows[0], moi) : null;
}

// Les messages déjà affichés qui ont changé depuis « depuis » (réaction ajoutée, message supprimé) :
// la page les redessine sans tout recharger. « jusquA » : le dernier message qu'elle connaît.
async function messagesModifies(conversationId, moi, depuis, jusquA) {
  const date = depuis ? new Date(depuis) : null;
  if (!date || Number.isNaN(date.getTime())) return [];
  const { rows } = await db.query(`${SELECTION} AND m.modifie_le > $3 AND m.id <= $4 ORDER BY m.id LIMIT 100`, [conversationId, moi.id, date, jusquA]);
  return rows.map((m) => versMessage(m, moi));
}

// Le message auquel on répond doit être dans la même conversation (et pas un message système). Sinon : pas de citation.
async function origineValide(executeur, conversationId, valeur) {
  const id = Number.isInteger(valeur) && valeur > 0 ? valeur : null;
  if (!id) return null;
  const { rows } = await executeur.query('SELECT id FROM messages WHERE id = $1 AND conversation_id = $2 AND masque = FALSE AND systeme = FALSE', [id, conversationId]);
  return rows[0] ? id : null;
}

module.exports = { REACTIONS, DELAI_SUPPRESSION_MIN, lireMessages, lireMessage, messagesModifies, origineValide, versMessage };
