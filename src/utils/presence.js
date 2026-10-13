// Présence dans la messagerie : « en ligne », « actif il y a 2 h », et « Awa écrit… ».
// Aucune connexion permanente : tout repose sur les requêtes que les pages font déjà.
const db = require('../db/pool');

const EN_LIGNE_MIN = 5;      // actif il y a moins de 5 minutes : point vert
const INTERVALLE_VU_S = 60;  // on ne note « vu » qu'une fois par minute au plus, pas à chaque requête
const DUREE_ECRITURE_S = 6;  // « écrit… » s'efface tout seul 6 secondes après le dernier signal

// Appelée à chaque requête d'un membre connecté (src/middleware/auth.js). Elle n'écrit en base qu'une fois par
// minute, et sans faire attendre la requête : une panne ici ne doit gêner personne.
function noterActivite(utilisateur) {
  if (utilisateur.vu_le && Date.now() - new Date(utilisateur.vu_le).getTime() < INTERVALLE_VU_S * 1000) return;
  db.query(
    `UPDATE utilisateurs SET vu_le = now() WHERE id = $1 AND (vu_le IS NULL OR vu_le < now() - make_interval(secs => $2))`,
    [utilisateur.id, INTERVALLE_VU_S],
  ).catch(() => {});
}

// Ce que « moi » peut savoir de la présence d'un autre : { enLigne, vuLe }, ou null.
// Règle de réciprocité : qui cache son statut ne voit pas celui des autres.
function presenceVue(moi, autre) {
  if (moi.masquer_presence || autre.masquer_presence || !autre.vu_le) return null;
  const enLigne = Date.now() - new Date(autre.vu_le).getTime() < EN_LIGNE_MIN * 60000;
  return { enLigne, vuLe: enLigne ? null : autre.vu_le };
}

// « J'écris dans cette conversation » : gardé 6 secondes. La page le renvoie au plus toutes les 3 secondes.
async function signalerEcriture(conversationId, membreId) {
  await db.query(
    `INSERT INTO ecritures (conversation_id, membre_id, jusqu_a) VALUES ($1, $2, now() + make_interval(secs => $3))
     ON CONFLICT (conversation_id, membre_id) DO UPDATE SET jusqu_a = EXCLUDED.jusqu_a`,
    [conversationId, membreId, DUREE_ECRITURE_S],
  );
}
// Le message est parti : on n'écrit plus.
const finEcriture = (executeur, conversationId, membreId) => executeur.query('DELETE FROM ecritures WHERE conversation_id = $1 AND membre_id = $2', [conversationId, membreId]);

// Les prénoms de ceux qui écrivent en ce moment dans la conversation (sans moi, sans les comptes bloqués).
async function quiEcrit(conversationId, moiId) {
  const { rows } = await db.query(
    `SELECT u.prenom FROM ecritures e JOIN utilisateurs u ON u.id = e.membre_id AND u.bloque = FALSE AND u.desactive_le IS NULL
      WHERE e.conversation_id = $1 AND e.membre_id <> $2 AND e.jusqu_a > now()
      ORDER BY e.jusqu_a DESC LIMIT 3`,
    [conversationId, moiId],
  );
  return rows.map((ligne) => ligne.prenom);
}

module.exports = { noterActivite, presenceVue, signalerEcriture, finEcriture, quiEcrit, EN_LIGNE_MIN };
