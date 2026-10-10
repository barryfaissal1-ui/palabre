// Ce que les conversations privées et les groupes ont en commun : lire des messages (avec leurs réactions et
// le message auquel ils répondent) et les mettre en forme pour le navigateur.
// Les règles d'ACCÈS ne sont pas ici : chaque famille garde les siennes (routes/messages.js et routes/groupes.js).
const db = require('../db/pool');
const v = require('./validation');
const { lireImageDataUrl } = require('./images');
const { lireVocal } = require('./audio');
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
  SELECT m.id, m.texte, m.fichier_id, m.vocal_duree, m.cree_le, m.auteur_id, m.systeme, m.supprime_le, ${COLONNES_MEMBRE},
         (SELECT COALESCE(json_agg(json_build_object('emoji', r.emoji, 'nombre', r.nombre, 'moi', r.moi, 'qui', r.qui)), '[]'::json)
            FROM (SELECT mr.emoji, count(*)::int AS nombre, bool_or(mr.membre_id = $2) AS moi,
                         (array_agg(ru.nom ORDER BY mr.cree_le))[1:20] AS qui
                    FROM message_reactions mr
                    JOIN utilisateurs ru ON ru.id = mr.membre_id AND ru.bloque = FALSE
                   WHERE mr.message_id = m.id
                   GROUP BY mr.emoji
                   ORDER BY min(mr.cree_le)) r) AS reactions,
         (SELECT json_build_object('id', a.id, 'type', a.type, 'statut', a.statut, 'appelant', a.appelant_id,
                                   'duree', GREATEST(0, round(extract(epoch FROM (a.fin_le - a.debut_le))))::int)
            FROM appels a WHERE a.id = m.appel_id) AS appel,
         (SELECT json_build_object(
                   'id', o.id,
                   'texte', CASE WHEN o.supprime_le IS NOT NULL OR o.masque THEN NULL ELSE left(o.texte, 90) END,
                   'prenom', ou.prenom, 'image', o.fichier_id IS NOT NULL AND o.vocal_duree IS NULL)
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
    image: !supprime && ligne.fichier_id && !ligne.vocal_duree ? `/fichiers/${ligne.fichier_id}` : null,
    // Message vocal : l'adresse du son (servi aux seuls membres de la conversation) et sa durée.
    vocal: !supprime && ligne.fichier_id && ligne.vocal_duree ? { url: `/fichiers/${ligne.fichier_id}`, duree: ligne.vocal_duree } : null,
    creeLe: ligne.cree_le,
    estMoi,
    systeme: ligne.systeme,
    supprime,
    auteur: apercuMembre(ligne),
    reactions: supprime ? [] : (ligne.reactions || []),
    reponse: ligne.origine || null,
    // La ligne laissée par un appel : son type, s'il a abouti, sa durée, et si c'est moi qui appelais.
    appel: ligne.appel ? { type: ligne.appel.type, statut: ligne.appel.statut, duree: ligne.appel.duree, parMoi: ligne.appel.appelant === moi.id } : null,
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
  // « modifie_le > cree_le » : seulement les messages vraiment retouchés. Un message qui vient d'être écrit a une
  // date de modification égale à sa création : sans cette condition, il serait renvoyé (et redessiné) pour rien.
  const { rows } = await db.query(`${SELECTION} AND m.modifie_le > $3 AND m.modifie_le > m.cree_le AND m.id <= $4 ORDER BY m.id LIMIT 100`, [conversationId, moi.id, date, jusquA]);
  return rows.map((m) => versMessage(m, moi));
}

// Le message auquel on répond doit être dans la même conversation (et pas un message système). Sinon : pas de citation.
async function origineValide(executeur, conversationId, valeur) {
  const id = Number.isInteger(valeur) && valeur > 0 ? valeur : null;
  if (!id) return null;
  const { rows } = await executeur.query('SELECT id FROM messages WHERE id = $1 AND conversation_id = $2 AND masque = FALSE AND systeme = FALSE', [id, conversationId]);
  return rows[0] ? id : null;
}

// Ce qu'on envoie dans un message : du texte (avec une photo facultative), OU un message vocal.
// Renvoie { texte, image, vocal } déjà contrôlés. Un vocal n'a pas de texte : la base garde « Message vocal »,
// qui sert d'aperçu dans la liste des conversations et dans les notifications.
function lireContenu(corps) {
  const vocal = corps.vocal ? lireVocal(corps.vocal) : null;
  if (vocal && corps.image) throw new v.ErreurValidation('Un message vocal ne porte pas de photo.', 'vocal');
  return {
    texte: vocal ? 'Message vocal' : v.texte(corps.texte, 'texte', { max: 2000 }),
    image: !vocal && corps.image ? lireImageDataUrl(corps.image) : null,
    vocal,
  };
}

// Enregistre la photo ou le son du message dans la table fichiers. Renvoie son identifiant (ou null).
async function enregistrerPiece(client, proprietaireId, { image, vocal }) {
  const piece = image || vocal;
  if (!piece) return null;
  const { rows } = await client.query(
    'INSERT INTO fichiers (proprietaire_id, type_mime, taille, donnees) VALUES ($1, $2, $3, $4) RETURNING id',
    [proprietaireId, piece.typeMime, piece.donnees.length, piece.donnees],
  );
  return rows[0].id;
}

module.exports = { lireContenu, enregistrerPiece, REACTIONS, DELAI_SUPPRESSION_MIN, lireMessages, lireMessage, messagesModifies, origineValide, versMessage };
