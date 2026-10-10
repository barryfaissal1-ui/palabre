// Notifications dans l'appli (la cloche du menu), doublées d'un push sur les appareils du membre.
const db = require('../db/pool');
const push = require('./push');

// Ajoute une notification pour un membre.
//   notifier(executeur, utilisateurId, type, texte, lien, options)
// executeur : « db » en temps normal, ou le client d'une transaction pour que la notification
//   soit annulée avec le reste si l'action échoue.
// lien : toujours une adresse interne du site, construite par le serveur (jamais fournie par un membre).
// options :
//   acteur  { id, nom } : la personne qui a fait l'action (son avatar s'affiche à côté). Si c'est le membre
//           lui-même, RIEN n'est écrit : on ne se prévient jamais de ses propres actions.
//   cible   { type, id } : ce dont parle la notification (publication, conversation…).
//   groupe  'acteurs' ou 'compteur' : au lieu d'empiler les notifications NON LUES sur la même cible, on n'en
//           garde qu'une. 'acteurs' compte les personnes (« Awa et 3 autres ont aimé ta publication ») ;
//           'compteur' compte les événements (« Awa t'a envoyé 3 messages »).
//           « texte » est alors une fonction (nombre) => phrase.
//   push    { titre, texte } : ce qu'affiche le push, s'il doit différer du titre du type (voir TITRES_PUSH) ou du
//           texte de la cloche (aperçu d'un message).
async function notifier(executeur, utilisateurId, type, texte, lien, { acteur = null, cible = null, groupe = null, push: surPush = null } = {}) {
  if (acteur && acteur.id === utilisateurId) return null;
  // Le push part après l'écriture, sans que la requête l'attende : un service de push lent ou en panne ne ralentit
  // ni ne fait échouer l'action du membre. « tag » : sur le téléphone, la notification suivante du même sujet
  // remplace la précédente au lieu de s'empiler.
  const pousser = (phrase, nombre) => {
    if (!push.pushActif()) return;
    const message = { titre: titrePush(type, acteur, nombre), texte: CORPS_PUSH[type] || phrase, ...(surPush || {}), lien, tag: cible ? `${type}-${cible.type}-${cible.id}` : `${type}-${utilisateurId}` };
    setImmediate(() => { push.envoyerPush(utilisateurId, type, message); });
  };
  const inserer = (client, phrase, acteurs, nombre) => client.query(
    `INSERT INTO notifications (utilisateur_id, type, texte, lien, acteur_id, cible_type, cible_id, acteurs, nombre)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [utilisateurId, type, phrase, lien, acteur ? acteur.id : null, cible ? cible.type : null, cible ? cible.id : null, acteurs, nombre],
  );
  if (!groupe || !cible || !acteur) {
    const phrase = typeof texte === 'function' ? texte(1) : texte;
    await inserer(executeur, phrase, acteur ? [acteur.id] : [], 1);
    pousser(phrase, 1);
    return { nombre: 1 };
  }

  // Regroupement. L'ancienne notification non lue est retirée et une nouvelle est écrite : elle remonte ainsi en
  // tête de la liste, avec la dernière personne en premier.
  const regrouper = async (client) => {
    // Verrou : deux j'aime au même instant passent l'un après l'autre, sinon il resterait deux notifications.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`notification:${utilisateurId}:${type}:${cible.type}:${cible.id}`]);
    const { rows } = await client.query(
      `DELETE FROM notifications
        WHERE utilisateur_id = $1 AND type = $2 AND cible_type = $3 AND cible_id = $4 AND lue = FALSE
        RETURNING acteurs, nombre`,
      [utilisateurId, type, cible.type, cible.id],
    );
    const anciens = rows.flatMap((ligne) => ligne.acteurs || []);
    const acteurs = [acteur.id, ...anciens.filter((id) => id !== acteur.id)].slice(0, 100);
    const nombre = groupe === 'compteur' ? rows.reduce((total, ligne) => total + ligne.nombre, 0) + 1 : acteurs.length;
    await inserer(client, texte(nombre), acteurs, nombre);
    return { nombre };
  };
  // Un verrou « de transaction » a besoin d'une transaction : on en ouvre une si l'appelant n'en a pas.
  const resultat = await (typeof executeur.transaction === 'function' ? executeur.transaction(regrouper) : regrouper(executeur));
  pousser(texte(resultat.nombre), resultat.nombre);
  return resultat;
}

// Le titre du push, pour chaque type de notification : sur l'écran verrouillé du téléphone, on comprend ce qui se
// passe sans ouvrir, et ce n'est jamais seulement « Palabre ». « qui » : le prénom de la personne qui a fait l'action.
// Un nouveau type de notification doit avoir sa ligne ici (tests/push.test.js le vérifie).
const TITRES_PUSH = {
  message: (qui) => `Nouveau message ${deNom(qui)}`,
  demande_message: (qui) => `Demande de message ${deNom(qui)}`,
  appel_manque: () => 'Appel manqué',
  jaime: (qui, n) => avecLesAutres(qui, n, 'a aimé ta publication', 'ont aimé ta publication'),
  commentaire: (qui, n) => avecLesAutres(qui, n, 'a commenté ta publication', 'ont commenté ta publication'),
  reponse_commentaire: (qui, n) => avecLesAutres(qui, n, 'a répondu après ton commentaire', 'ont répondu après ton commentaire'),
  demande_ami: (qui) => `${qui} veut t'ajouter en ami`,
  ami_accepte: (qui) => `${qui} et toi êtes maintenant amis`,
  nouvelle_proposition: () => 'Nouvelle proposition pour ta demande',
  proposition_acceptee: () => 'Bonne nouvelle : proposition choisie',
  invitation_equipe: (qui) => `${qui} t'invite dans son équipe`,
  equipe_reponses: () => 'Ton équipe éclair a répondu',
  avis_recu: (qui) => `Nouvel avis ${deNom(qui)}`,
  defi_gagne: () => 'Tu as gagné le défi de la semaine',
  projet_facebook: () => 'Ton projet et la page Facebook',
};
// Quand le titre dit déjà tout, le texte du push ne le répète pas.
const CORPS_PUSH = {
  jaime: 'Touche pour voir ta publication.',
  commentaire: 'Touche pour lire les commentaires.',
  reponse_commentaire: 'Touche pour lire la discussion.',
  demande_ami: 'Touche pour répondre à sa demande.',
};
function titrePush(type, acteur = null, nombre = 1) {
  const qui = (acteur && (acteur.prenom || acteur.nom)) || 'un membre';
  const titre = TITRES_PUSH[type] ? TITRES_PUSH[type](qui, nombre) : 'Du nouveau sur Palabre';
  return titre.charAt(0).toUpperCase() + titre.slice(1);
}

// Quelqu'un revient sur son action (il n'aime plus) : il sort de la notification regroupée, tant qu'elle n'est pas lue.
// S'il était seul, la notification disparaît. « texte » : (nomDuPremier, nombre) => phrase.
async function retirerActeur(utilisateurId, type, cible, acteurId, texte) {
  await db.transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`notification:${utilisateurId}:${type}:${cible.type}:${cible.id}`]);
    const { rows: [ligne] } = await client.query(
      `SELECT id, acteurs FROM notifications
        WHERE utilisateur_id = $1 AND type = $2 AND cible_type = $3 AND cible_id = $4 AND lue = FALSE AND $5 = ANY(acteurs)
        FOR UPDATE`,
      [utilisateurId, type, cible.type, cible.id, acteurId],
    );
    if (!ligne) return;
    const acteurs = ligne.acteurs.filter((id) => id !== acteurId);
    if (acteurs.length === 0) {
      await client.query('DELETE FROM notifications WHERE id = $1', [ligne.id]);
      return;
    }
    const { rows: [premier] } = await client.query('SELECT nom FROM utilisateurs WHERE id = $1', [acteurs[0]]);
    await client.query(
      'UPDATE notifications SET acteurs = $2, nombre = $3, acteur_id = $4, texte = $5 WHERE id = $1',
      [ligne.id, acteurs, acteurs.length, acteurs[0], texte(premier ? premier.nom : 'Un membre', acteurs.length)],
    );
  });
}

// « Awa a aimé… », « Awa et 1 autre ont aimé… », « Awa et 3 autres ont aimé… »
function avecLesAutres(nom, nombre, seul, plusieurs) {
  if (nombre <= 1) return `${nom} ${seul}`;
  return `${nom} et ${nombre - 1} autre${nombre > 2 ? 's' : ''} ${plusieurs}`;
}

// Raccourcit un titre pour le citer dans une notification.
function court(texte, max = 60) {
  return texte.length > max ? `${texte.slice(0, max - 1)}…` : texte;
}

// « de Bintou » mais « d'Awa » : l'élision devant une voyelle.
function deNom(nom) {
  return /^[aeiouyhàâäéèêëîïôöùûü]/i.test(nom) ? `d'${nom}` : `de ${nom}`;
}

module.exports = { notifier, retirerActeur, avecLesAutres, court, deNom, titrePush, TITRES_PUSH };
