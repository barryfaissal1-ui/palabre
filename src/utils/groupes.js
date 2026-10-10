// Le groupe de discussion d'une équipe éclair : sa vie suit celle de l'équipe.
//   équipe créée            → groupe créé, le chef en est l'administrateur
//   un invité accepte       → il entre dans le groupe
//   le client choisit       → il entre dans le groupe
//   l'équipe est dissoute   → le groupe est fermé (lecture seule)
// Ces fonctions reçoivent le client de la transaction en cours : le groupe change en même temps que l'équipe,
// ou pas du tout. Les routes de lecture et d'écriture sont dans src/routes/groupes.js.
const { court } = require('./notifications');

// Un message « système », affiché au centre de la conversation : « Awa a rejoint l'équipe ».
// Il est rattaché à la personne concernée (auteur_id), mais ne compte pas comme un message d'elle.
async function messageSysteme(client, groupeId, membreId, texte) {
  await client.query('INSERT INTO messages (conversation_id, auteur_id, texte, systeme) VALUES ($1, $2, $3, TRUE)', [groupeId, membreId, texte]);
  await client.query('UPDATE conversations SET dernier_message_le = now() WHERE id = $1', [groupeId]);
}

async function creerGroupeEquipe(client, { equipeId, chef, titreDemande }) {
  const { rows: [groupe] } = await client.query(
    `INSERT INTO conversations (type, titre, equipe_id, cree_par, statut) VALUES ('groupe', $1, $2, $3, 'acceptee') RETURNING id`,
    [`Équipe : ${court(titreDemande, 60)}`, equipeId, chef.id],
  );
  await client.query('INSERT INTO conversation_membres (conversation_id, membre_id, role) VALUES ($1, $2, \'admin\')', [groupe.id, chef.id]);
  await messageSysteme(client, groupe.id, chef.id, `${chef.nom} a créé l'équipe.`);
  return groupe.id;
}

// Le numéro du groupe de cette équipe (null si elle n'en a pas).
async function groupeDeLEquipe(executeur, equipeId) {
  const { rows: [groupe] } = await executeur.query('SELECT id FROM conversations WHERE equipe_id = $1 AND type = \'groupe\'', [equipeId]);
  return groupe ? groupe.id : null;
}

// Fait entrer un membre dans le groupe de l'équipe (ou le fait revenir s'il l'avait quitté).
// Il ne verra pas comme « non lus » les messages écrits avant son arrivée.
async function entrerDansLeGroupe(client, equipeId, membre, texte) {
  const groupeId = await groupeDeLEquipe(client, equipeId);
  if (!groupeId) return null;
  const { rows: [deja] } = await client.query('SELECT quitte_le FROM conversation_membres WHERE conversation_id = $1 AND membre_id = $2', [groupeId, membre.id]);
  if (deja && !deja.quitte_le) return groupeId; // déjà dans le groupe : rien à faire, rien à annoncer
  await client.query(
    `INSERT INTO conversation_membres (conversation_id, membre_id, role) VALUES ($1, $2, 'membre')
     ON CONFLICT (conversation_id, membre_id) DO UPDATE SET quitte_le = NULL, rejoint_le = now()`,
    [groupeId, membre.id],
  );
  await client.query(
    `INSERT INTO conversation_lectures (conversation_id, membre_id, dernier_lu_id)
     SELECT $1, $2, COALESCE(max(id), 0) FROM messages WHERE conversation_id = $1
     ON CONFLICT (conversation_id, membre_id) DO UPDATE SET dernier_lu_id = EXCLUDED.dernier_lu_id`,
    [groupeId, membre.id],
  );
  await messageSysteme(client, groupeId, membre.id, texte);
  return groupeId;
}

// L'équipe est dissoute : le groupe reste lisible par ses membres, mais plus personne n'y écrit.
// À appeler AVANT de supprimer l'équipe (ensuite le lien equipe_id est effacé par la base).
async function fermerGroupeEquipe(client, equipeId, chef) {
  const groupeId = await groupeDeLEquipe(client, equipeId);
  if (!groupeId) return;
  await messageSysteme(client, groupeId, chef.id, 'Cette équipe a été dissoute.');
  await client.query('UPDATE conversations SET ferme_le = now() WHERE id = $1', [groupeId]);
}

module.exports = { creerGroupeEquipe, groupeDeLEquipe, entrerDansLeGroupe, fermerGroupeEquipe, messageSysteme };
