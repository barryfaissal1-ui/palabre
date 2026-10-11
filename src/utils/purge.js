// Le ménage : ce qui doit disparaître tout seul, à son échéance.
//  - les comptes dont la suppression a été demandée il y a 30 jours ;
//  - les publications restées plus de 30 jours dans la corbeille de leur auteur ;
//  - le journal de sécurité de plus de 90 jours, le journal de modération de plus d'un an ;
//  - les sessions fermées ou expirées, les codes et les liens périmés.
// Lancé au démarrage du serveur puis toutes les heures (server.js), et à la main par « npm run purger ».
const crypto = require('node:crypto');
const db = require('../db/pool');
const { purgerJournal } = require('./journal');
const { purgerJournalModeration } = require('./sanctions');

const DELAI_SUPPRESSION_JOURS = 30;
const DUREE_CORBEILLE_JOURS = 30;

// Suppression DÉFINITIVE d'une publication (client : une transaction) : la ligne, sa photo, son historique.
// Ses j'aime et ses commentaires partent avec elle (ON DELETE CASCADE).
async function effacerPublication(client, id) {
  const { rows: [publication] } = await client.query('DELETE FROM publications WHERE id = $1 RETURNING image', [id]);
  if (publication && publication.image) await client.query('DELETE FROM fichiers WHERE id = $1', [publication.image]);
  await client.query('DELETE FROM historique_textes WHERE cible_type = \'publication\' AND cible_id = $1', [id]);
  return Boolean(publication);
}

// La corbeille : les publications supprimées par leur auteur depuis plus de 30 jours partent pour de bon.
// On en profite pour retirer l'historique des textes dont la publication ou le commentaire n'existe plus.
async function purgerCorbeille() {
  const { rows } = await db.query('SELECT id FROM publications WHERE supprimee_le < now() - make_interval(hours => $1 * 24) ORDER BY id LIMIT 500', [DUREE_CORBEILLE_JOURS]);
  for (const { id } of rows) await db.transaction((client) => effacerPublication(client, id));
  await db.query('DELETE FROM historique_textes h WHERE h.cible_type = \'publication\' AND NOT EXISTS (SELECT 1 FROM publications p WHERE p.id = h.cible_id)');
  await db.query('DELETE FROM historique_textes h WHERE h.cible_type = \'commentaire\' AND NOT EXISTS (SELECT 1 FROM commentaires c WHERE c.id = h.cible_id)');
  return rows.length;
}

// Suppression DÉFINITIVE d'un compte, dans une transaction (client). Tout ce qui est au membre est réellement
// supprimé (publications, commentaires, projets, demandes, propositions, amis, photos, vocaux…) : les tables sont
// reliées au compte par ON DELETE CASCADE. Deux choses restent. Les avis qu'il a laissés à des devs, signés « Ancien
// client », sans rien de lui : ils prouvent leur travail. Et le texte des messages qu'il a DÉJÀ envoyés à d'autres :
// ils font partie de leurs conversations ; on les rattache à un compte vide, « Membre parti », qui ne porte plus
// rien de lui (ni nom, ni email, ni photo) et avec lequel personne ne peut se connecter.
async function supprimerDefinitivement(client, membre) {
  // Une demande de message qu'il a envoyée et qui attend encore : elle part avec lui.
  await client.query('DELETE FROM conversations WHERE type = \'privee\' AND statut = \'demande\' AND cree_par = $1', [membre.id]);
  const { rowCount: aEcrit } = await client.query('SELECT 1 FROM messages WHERE auteur_id = $1 AND systeme = FALSE LIMIT 1', [membre.id]);
  if (aEcrit) {
    const hasard = crypto.randomBytes(6).toString('hex');
    const { rows: [parti] } = await client.query(
      `INSERT INTO utilisateurs (type, nom, prenom, nom_famille, identifiant, email, mot_de_passe_hash, pays, ville, disponible, email_confirme_le, supprime_le)
       VALUES ($1, 'Membre parti', 'Membre', 'parti', $2, $3, '!', 'Autre', '—', FALSE, now(), now()) RETURNING id`,
      [membre.type, `membre-parti-${hasard}`, `parti-${hasard}@supprime.invalid`],
    );
    // Photos et vocaux : supprimés pour de bon (le fichier part avec le compte), il reste « Message supprimé ».
    await client.query(
      `UPDATE messages SET texte = 'Message supprimé', fichier_id = NULL, vocal_duree = NULL, supprime_le = now(), modifie_le = now()
        WHERE auteur_id = $1 AND (fichier_id IS NOT NULL OR vocal_duree IS NOT NULL)`,
      [membre.id],
    );
    await client.query('UPDATE messages SET auteur_id = $2, modifie_le = now() WHERE auteur_id = $1', [membre.id, parti.id]);
    // Le nouveau compte a le plus grand numéro : il prend la place « membre_b » (membre_a < membre_b).
    await client.query(
      `UPDATE conversations SET membre_a = CASE WHEN membre_a = $1 THEN membre_b ELSE membre_a END, membre_b = $2
        WHERE type = 'privee' AND $1 IN (membre_a, membre_b)`,
      [membre.id, parti.id],
    );
    await client.query('UPDATE conversations SET cree_par = $2 WHERE cree_par = $1', [membre.id, parti.id]);
    // Dans les groupes, « Membre parti » n'est plus membre : il a quitté.
    await client.query('UPDATE conversation_membres SET membre_id = $2, quitte_le = COALESCE(quitte_le, now()) WHERE membre_id = $1', [membre.id, parti.id]);
  }
  // Les groupes des équipes dont il était le chef sont fermés (l'équipe disparaît avec lui).
  await client.query('UPDATE conversations SET ferme_le = COALESCE(ferme_le, now()) WHERE type = \'groupe\' AND equipe_id IN (SELECT id FROM equipes WHERE chef_id = $1)', [membre.id]);
  // Les avis laissés à des devs restent sur leur profil, sans rien du client (« Ancien client » dans la page).
  await client.query('UPDATE avis SET client_id = NULL, demande_id = NULL WHERE client_id = $1', [membre.id]);
  await client.query('DELETE FROM utilisateurs WHERE id = $1', [membre.id]);
}

// Les comptes arrivés à l'échéance des 30 jours. Chacun dans sa propre transaction : une erreur sur l'un n'empêche
// pas les autres. FOR UPDATE SKIP LOCKED : si deux ménages tournent en même temps, ils ne prennent pas le même compte.
async function purgerComptes() {
  let nombre = 0;
  for (;;) {
    const fait = await db.transaction(async (client) => {
      const { rows: [membre] } = await client.query(
        `SELECT id, type FROM utilisateurs
          WHERE suppression_prevue_le IS NOT NULL AND suppression_prevue_le <= now() AND supprime_le IS NULL
          ORDER BY suppression_prevue_le LIMIT 1 FOR UPDATE SKIP LOCKED`,
      );
      if (!membre) return false;
      await supprimerDefinitivement(client, membre);
      return true;
    });
    if (!fait) break;
    nombre += 1;
  }
  return nombre;
}

// Sessions fermées depuis 30 jours ou ouvertes depuis plus de 60 ; codes et liens périmés depuis plus d'un jour.
async function purgerPerimes() {
  const requetes = [
    'DELETE FROM sessions WHERE revoquee_le < now() - interval \'30 days\' OR cree_le < now() - interval \'60 days\'',
    'DELETE FROM confirmations_email WHERE expire_le < now() - interval \'1 day\'',
    'DELETE FROM alertes_connexion WHERE expire_le < now() - interval \'1 day\'',
    'DELETE FROM reinitialisations_mdp WHERE expire_le < now() - interval \'1 day\'',
    'DELETE FROM changements_email WHERE expire_le < now() - interval \'1 day\'',
  ];
  let nombre = 0;
  for (const requete of requetes) nombre += (await db.query(requete)).rowCount;
  return nombre;
}

// Tout le ménage. Renvoie ce qui a été fait (écrit dans le journal du serveur quand il y a quelque chose).
async function purger() {
  const bilan = { comptes: await purgerComptes(), corbeille: await purgerCorbeille(), journal: await purgerJournal(), moderation: await purgerJournalModeration(), perimes: await purgerPerimes() };
  return bilan;
}

// Au démarrage, puis toutes les heures. unref() : cette minuterie n'empêche pas le serveur de s'arrêter.
function lancerMenage(intervalleMs = 60 * 60 * 1000) {
  const passer = () => purger()
    .then((bilan) => { if (Object.values(bilan).some((n) => n > 0)) console.log('Ménage :', JSON.stringify(bilan)); })
    .catch((err) => console.error('Ménage impossible :', err.message));
  passer();
  return setInterval(passer, intervalleMs).unref();
}

module.exports = { DELAI_SUPPRESSION_JOURS, DUREE_CORBEILLE_JOURS, supprimerDefinitivement, effacerPublication, purger, purgerComptes, purgerCorbeille, lancerMenage };
