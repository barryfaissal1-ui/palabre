// Protections de l'inscription contre les robots : heure d'ouverture signée et code de confirmation de l'email.
const crypto = require('node:crypto');
const config = require('../config');
const db = require('../db/pool');
const { ErreurValidation, ErreurHttp } = require('./validation');
const mailer = require('./mailer'); // appelé par « mailer.envoyerEmail » : la démonstration et les tests peuvent le remplacer

const DELAI_MIN_MS = 3000; // un humain ne remplit pas le formulaire en moins de 3 secondes
const DUREE_MAX_MS = 6 * 60 * 60 * 1000; // une page restée ouverte plus de 6 heures doit être rechargée
const DUREE_CODE_MIN = 15;
const MAX_ESSAIS = 5;
const MAX_ENVOIS_PAR_HEURE = 5; // renvois, en plus du premier code envoyé à l'inscription

// Signature : seul le serveur connaît le secret, donc lui seul peut fabriquer une signature juste.
function signer(texte) {
  return crypto.createHmac('sha256', config.jwtSecret).update(texte).digest('hex');
}

// Comparaison en temps constant : le temps de réponse ne révèle pas à quel caractère la comparaison échoue.
function egales(a, b) {
  const [x, y] = [Buffer.from(String(a)), Buffer.from(String(b))];
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ---------- Heure d'ouverture de la page ----------
// Le navigateur reçoit « heure.signature » à l'ouverture du formulaire et le renvoie avec l'inscription.
// Il ne peut pas tricher sur l'heure : s'il la change, la signature ne correspond plus.
function jetonOuverture(instant = Date.now()) {
  return `${instant}.${signer(`ouverture:${instant}`)}`;
}

function verifierOuverture(jeton, maintenant = Date.now()) {
  const [instant, signature] = typeof jeton === 'string' ? jeton.split('.') : [];
  if (!instant || !signature || !/^\d{1,15}$/.test(instant) || !egales(signature, signer(`ouverture:${instant}`))) {
    throw new ErreurValidation('Inscription impossible pour le moment. Recharge la page et réessaie.');
  }
  const age = maintenant - Number(instant);
  if (age < DELAI_MIN_MS) throw new ErreurValidation('Envoi trop rapide. Attends quelques secondes, puis réessaie.');
  if (age > DUREE_MAX_MS) throw new ErreurValidation('Cette page est restée ouverte trop longtemps. Recharge-la et réessaie.');
}

// ---------- Code de confirmation ----------
// L'empreinte dépend du membre et du secret du serveur : une copie de la base ne suffit pas à retrouver les codes.
function empreinteCode(utilisateurId, code) {
  return signer(`code:${utilisateurId}:${code}`);
}

// Fabrique un nouveau code, le garde (haché) et l'envoie. `renvoi` applique les limites du bouton « Renvoyer le code ».
async function envoyerCode(utilisateur, { renvoi = false } = {}) {
  if (renvoi) {
    const { rows: [envois] } = await db.query(
      `SELECT count(*) FILTER (WHERE cree_le > now() - interval '1 minute')::int AS minute,
              count(*) FILTER (WHERE cree_le > now() - interval '1 hour')::int AS heure
         FROM confirmations_email WHERE utilisateur_id = $1`,
      [utilisateur.id],
    );
    if (envois.minute >= 1) throw new ErreurHttp(429, 'Un code vient de partir. Attends une minute avant d\'en demander un autre.');
    if (envois.heure >= MAX_ENVOIS_PAR_HEURE + 1) throw new ErreurHttp(429, 'Trop de codes demandés. Réessaie dans une heure.');
  }
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0'); // randomInt : hasard de qualité cryptographique
  await db.query(
    `INSERT INTO confirmations_email (utilisateur_id, code_hash, expire_le)
     VALUES ($1, $2, now() + make_interval(mins => $3))`,
    [utilisateur.id, empreinteCode(utilisateur.id, code), DUREE_CODE_MIN],
  );
  await mailer.envoyerEmail({
    a: utilisateur.email,
    sujet: `Palabre – Ton code de confirmation : ${code}`,
    texte: `Bonjour ${utilisateur.prenom || utilisateur.nom},\n\nTon code de confirmation Palabre : ${code}\n\nIl est valable ${DUREE_CODE_MIN} minutes. Si tu n'as pas créé de compte, ignore simplement cet email.\n\nL'équipe Palabre`,
  });
}

// Vérifie le code saisi. Seul le dernier code envoyé compte ; chaque erreur consomme un des 5 essais.
async function confirmerCode(utilisateur, valeur) {
  const code = typeof valeur === 'string' ? valeur.replace(/\s/g, '') : '';
  if (!/^\d{6}$/.test(code)) throw new ErreurValidation('Le code fait 6 chiffres.', 'code');

  return db.transaction(async (client) => {
    // FOR UPDATE : deux essais envoyés au même instant passent l'un après l'autre, le compteur ne peut pas être contourné.
    const { rows: [dernier] } = await client.query(
      `SELECT id, code_hash, essais, expire_le > now() AS valable FROM confirmations_email
        WHERE utilisateur_id = $1 ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [utilisateur.id],
    );
    if (!dernier || !dernier.valable) return { erreur: 'Ce code a expiré. Demande un nouveau code.' };
    if (dernier.essais >= MAX_ESSAIS) return { erreur: 'Trop d\'essais. Demande un nouveau code.' };
    if (!egales(dernier.code_hash, empreinteCode(utilisateur.id, code))) {
      await client.query('UPDATE confirmations_email SET essais = essais + 1 WHERE id = $1', [dernier.id]);
      const restants = MAX_ESSAIS - dernier.essais - 1;
      return { erreur: restants > 0 ? `Code incorrect. Il te reste ${restants} essai${restants > 1 ? 's' : ''}.` : 'Code incorrect. Demande un nouveau code.' };
    }
    await client.query('UPDATE utilisateurs SET email_confirme_le = now() WHERE id = $1', [utilisateur.id]);
    await client.query('DELETE FROM confirmations_email WHERE utilisateur_id = $1', [utilisateur.id]);
    return { erreur: null };
  });
}

module.exports = { jetonOuverture, verifierOuverture, envoyerCode, confirmerCode, DELAI_MIN_MS };
