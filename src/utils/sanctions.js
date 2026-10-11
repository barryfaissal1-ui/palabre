// Sanctions progressives, signalements qui cachent un contenu, et journal de modération.
//
// Sanctions (table « sanctions ») : première faute, un avertissement ; deuxième, une suspension de 7 jours (le
// membre se connecte et lit, mais ne publie ni n'écrit plus) ; troisième, l'exclusion (compte bloqué). Un
// administrateur peut toujours choisir tout de suite une sanction plus forte pour une faute grave.
// Chaque sanction peut être contestée une fois par le membre ; un administrateur peut l'annuler.
// Tout ce que décide un administrateur est noté dans « journal_moderation » (qui, quoi, quand), gardé un an.
const crypto = require('node:crypto');
const config = require('../config');
const db = require('../db/pool');
const mailer = require('./mailer'); // appelé par « mailer.envoyerEmail » : les tests peuvent le remplacer
const { ErreurValidation } = require('./validation');
const { emailSanction } = require('./gabarit-email');
const { notifier } = require('./notifications');
const { mettreEnAttente, TABLES } = require('./moderation');
const sessions = require('./sessions');

const TYPES = ['avertissement', 'suspension', 'exclusion'];
const DUREE_SUSPENSION_JOURS = 7;
const SEUIL_SIGNALEMENTS = 3;       // signalements de membres différents qui cachent un contenu
const AGE_MIN_SIGNALEUR_JOURS = 3;  // un compte plus récent peut signaler, mais ne compte pas dans ce seuil
const MAX_SIGNALEMENTS_REJETES = 3; // au-delà, les signalements de ce membre ne comptent plus dans le seuil
const DUREE_JOURNAL_JOURS = 365;

const hacher = (texte) => crypto.createHash('sha256').update(texte).digest('hex');

// Les motifs proposés dans la fenêtre « Signaler ». La page envoie le code ; le libellé français est écrit ici,
// car c'est l'équipe qui le lit dans /admin.
const CATEGORIES = {
  arnaque: 'Arnaque', insulte: 'Insulte ou harcèlement', haine: 'Haine', sexuel: 'Contenu sexuel',
  violence: 'Violence ou menace', faux_profil: 'Faux profil', spam: 'Spam', autre: 'Autre',
};

const PHRASES = {
  avertissement: 'Tu as reçu un avertissement de l\'équipe Palabre. Lis-le, et relis les règles de la communauté.',
  suspension: `Ton compte est suspendu pour ${DUREE_SUSPENSION_JOURS} jours. Tu peux te connecter et lire, mais plus publier ni écrire.`,
  cache: 'Un de tes contenus a été signalé par plusieurs membres : il est caché en attendant la vérification de l\'équipe.',
  annulee: 'Bonne nouvelle : l\'équipe Palabre a annulé une sanction prise contre ton compte.',
  contestationRejetee: 'L\'équipe Palabre a relu ta contestation : la sanction est maintenue.',
};

// Une ligne du journal de modération. À appeler dans la transaction de la décision.
async function journalModeration(client, adminId, action, { cibleType = null, cibleId = null, membreId = null, detail = null } = {}) {
  await client.query(
    'INSERT INTO journal_moderation (admin_id, action, cible_type, cible_id, membre_id, detail) VALUES ($1, $2, $3, $4, $5, $6)',
    [adminId, action, cibleType, cibleId, membreId, detail ? String(detail).slice(0, 300) : null],
  );
}

// La sanction qui vient pour ce membre, d'après celles qu'il a déjà (les sanctions annulées ne comptent pas).
async function sanctionSuivante(client, membreId) {
  const { rows: [compte] } = await client.query('SELECT count(*)::int AS nb FROM sanctions WHERE utilisateur_id = $1 AND annulee_le IS NULL', [membreId]);
  return TYPES[Math.min(compte.nb, TYPES.length - 1)];
}

// Sanctionne un membre (dans la transaction « client »). type : 'avertissement', 'suspension', 'exclusion', ou rien
// pour suivre la progression. Renvoie { sanction, apres } : « apres » envoie la notification et l'email, à appeler
// une fois la transaction terminée.
async function sanctionner(client, { membreId, adminId, type = null, motif, cibleType = null, cibleId = null }) {
  const { rows: [membre] } = await client.query('SELECT id, est_admin, email, prenom, nom, langue, bloque FROM utilisateurs WHERE id = $1 FOR UPDATE', [membreId]);
  if (!membre) throw new ErreurValidation('Ce membre n\'existe plus.', 'membre');
  if (membre.est_admin) throw new ErreurValidation('Un administrateur ne peut pas être sanctionné depuis le site.', 'membre');
  const sorte = TYPES.includes(type) ? type : await sanctionSuivante(client, membreId);
  const jeton = crypto.randomBytes(32).toString('hex'); // le lien « Contester » de l'email, gardé haché
  const { rows: [sanction] } = await client.query(
    `INSERT INTO sanctions (utilisateur_id, type, motif, cible_type, cible_id, decide_par, fin, jeton_hash)
     VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $2 = 'suspension' THEN now() + make_interval(hours => $7 * 24) END, $8)
     RETURNING id, type, motif, debut, fin`,
    [membreId, sorte, motif, cibleType, cibleId, adminId, DUREE_SUSPENSION_JOURS, hacher(jeton)],
  );
  if (sorte === 'suspension') await client.query('UPDATE utilisateurs SET suspendu_jusqu_a = $2 WHERE id = $1', [membreId, sanction.fin]);
  if (sorte === 'exclusion') {
    await client.query('UPDATE utilisateurs SET bloque = TRUE WHERE id = $1', [membreId]);
    await sessions.revoquerToutes(membreId, {}, client);
  }
  await journalModeration(client, adminId, `sanction_${sorte}`, { cibleType, cibleId, membreId, detail: motif });
  const apres = async () => {
    // Un exclu ne se connecte plus : il n'a pas de cloche à lire, seulement l'email.
    if (sorte !== 'exclusion') await notifier(db, membreId, 'sanction', PHRASES[sorte], '/sanctions');
    try {
      await mailer.envoyerEmail({
        a: membre.email,
        ...emailSanction({ prenom: membre.prenom || membre.nom, type: sorte, motif, fin: sanction.fin, lien: `${config.urlPublique}/sanctions?jeton=${jeton}`, langue: membre.langue || 'fr' }),
      });
    } catch (err) {
      console.error('Email de sanction impossible :', err.message);
    }
  };
  return { sanction, apres };
}

// Annule une sanction (dans une transaction) : le compte retrouve ce qu'elle lui avait retiré.
async function annulerSanction(client, sanctionId, adminId) {
  const { rows: [sanction] } = await client.query('SELECT id, utilisateur_id, type, contestee_le FROM sanctions WHERE id = $1 AND annulee_le IS NULL FOR UPDATE', [sanctionId]);
  if (!sanction) return null;
  await client.query(
    `UPDATE sanctions SET annulee_le = now(), annulee_par = $2,
            contestation_decision = CASE WHEN contestee_le IS NOT NULL THEN 'acceptee' ELSE contestation_decision END,
            contestation_decidee_le = CASE WHEN contestee_le IS NOT NULL THEN now() ELSE contestation_decidee_le END
      WHERE id = $1`,
    [sanction.id, adminId],
  );
  if (sanction.type === 'suspension') {
    // S'il lui reste une autre suspension en cours, c'est elle qui fixe la date.
    await client.query(
      `UPDATE utilisateurs SET suspendu_jusqu_a = (SELECT max(fin) FROM sanctions WHERE utilisateur_id = $1 AND type = 'suspension' AND annulee_le IS NULL AND fin > now())
        WHERE id = $1`,
      [sanction.utilisateur_id],
    );
  }
  if (sanction.type === 'exclusion') await client.query('UPDATE utilisateurs SET bloque = FALSE WHERE id = $1', [sanction.utilisateur_id]);
  await journalModeration(client, adminId, 'sanction_annulee', { membreId: sanction.utilisateur_id, detail: sanction.type });
  await notifier(client, sanction.utilisateur_id, 'sanction_annulee', PHRASES.annulee, '/sanctions');
  return sanction;
}

// Un nouveau signalement vient d'être enregistré : si trois membres différents (inscrits depuis plus de 3 jours,
// et dont les signalements ne sont pas régulièrement rejetés) ont signalé ce contenu, il est caché en attendant
// la décision d'un administrateur, et son auteur est prévenu. Seuls les contenus publics qu'on sait cacher sont
// concernés (publication, commentaire, demande, projet).
async function cacherSiTropSignale(client, cibleType, cibleId, auteurId) {
  if (!TABLES[cibleType]) return false;
  const { rows: [compte] } = await client.query(
    `SELECT count(*)::int AS nb FROM signalements s JOIN utilisateurs u ON u.id = s.auteur_id
      WHERE s.cible_type = $1 AND s.cible_id = $2 AND s.statut = 'ouvert' AND u.bloque = FALSE
        AND u.cree_le < now() - make_interval(days => $3) AND u.signalements_rejetes < $4`,
    [cibleType, cibleId, AGE_MIN_SIGNALEUR_JOURS, MAX_SIGNALEMENTS_REJETES],
  );
  if (compte.nb < SEUIL_SIGNALEMENTS) return false;
  const { rows: [contenu] } = await client.query(`SELECT masque FROM ${TABLES[cibleType]} WHERE id = $1 FOR UPDATE`, [cibleId]);
  if (!contenu || contenu.masque) return false;
  await mettreEnAttente(client, cibleType, cibleId, auteurId, 'signalements');
  await notifier(client, auteurId, 'contenu_cache', PHRASES.cache, '/regles');
  return true;
}

// Compte suspendu : lecture seule. Placé sur tout /api. Lire reste possible ; les seules écritures permises sont
// celles qui ne publient rien : se déconnecter, contester, régler son compte, marquer comme lu.
const ECRITURES_PERMISES = /^\/(auth|sanctions|parametres|notifications)(\/|$)|\/(lu|lues|ecrit)$/;
function dateCourte(date) {
  const deux = (n) => String(n).padStart(2, '0');
  return `${deux(date.getUTCDate())}/${deux(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
}
const estSuspendu = (utilisateur) => Boolean(utilisateur.suspendu_jusqu_a && new Date(utilisateur.suspendu_jusqu_a).getTime() > Date.now());
function exigerNonSuspendu(req, res, next) {
  if (!req.utilisateur || !estSuspendu(req.utilisateur) || req.method === 'GET' || req.method === 'HEAD' || ECRITURES_PERMISES.test(req.path)) return next();
  res.status(403).json({ erreur: `Ton compte est suspendu jusqu'au ${dateCourte(new Date(req.utilisateur.suspendu_jusqu_a))}. Tu peux lire, mais pas publier ni écrire.`, suite: '/sanctions' });
}

// Le journal de modération n'est gardé qu'un an (appelé par le ménage, src/utils/purge.js).
async function purgerJournalModeration() {
  const { rowCount } = await db.query('DELETE FROM journal_moderation WHERE cree_le < now() - make_interval(days => $1)', [DUREE_JOURNAL_JOURS]);
  return rowCount;
}

module.exports = { TYPES, CATEGORIES, PHRASES, DUREE_SUSPENSION_JOURS, SEUIL_SIGNALEMENTS, MAX_SIGNALEMENTS_REJETES, hacher,
  sanctionner, annulerSanction, sanctionSuivante, cacherSiTropSignale, journalModeration, exigerNonSuspendu, estSuspendu, purgerJournalModeration };
