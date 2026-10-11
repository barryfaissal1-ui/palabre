// Notifications push : prévenir un membre sur son téléphone, même quand le site est fermé.
//
// Comment ça marche : le navigateur du membre s'abonne auprès du service de push de son fabricant (Google pour
// Chrome, Mozilla pour Firefox, Apple pour Safari) et nous donne une adresse (« endpoint ») et deux clés. Pour le
// prévenir, le serveur envoie à cette adresse un petit message CHIFFRÉ avec ses clés : le service de push le
// transporte sans pouvoir le lire, et le téléphone le déchiffre et l'affiche (public/sw.js).
//
// Pas de bibliothèque : la plus connue (web-push) est sous licence MPL-2.0, qui n'est pas dans la liste permise par
// le concours. Tout est écrit ici avec le module « crypto » de Node, en suivant les normes du Web Push :
//   RFC 8291 (chiffrement du message), RFC 8188 (format aes128gcm), RFC 8292 (VAPID : notre signature).
const crypto = require('node:crypto');
const config = require('../config');
const db = require('../db/pool');

const b64 = (octets) => Buffer.from(octets).toString('base64url');
const depuisB64 = (texte) => Buffer.from(String(texte), 'base64url');

// Le serveur n'écrit qu'aux services de push connus. Sans cette liste, un membre pourrait s'« abonner » avec
// l'adresse d'une machine interne et faire envoyer des requêtes par notre serveur (attaque SSRF).
const HOTES_PERMIS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /\.push\.apple\.com$/, /\.notify\.windows\.com$/];

// Ce qu'on peut couper dans les réglages : chaque type de notification appartient à une famille.
// La cloche du site, elle, garde toujours tout.
const FAMILLES = {
  messages: ['message', 'demande_message', 'appel', 'appel_manque'],
  demandes: ['nouvelle_proposition', 'proposition_acceptee', 'avis_recu'],
  equipes: ['invitation_equipe', 'equipe_reponses'],
  social: ['jaime', 'commentaire', 'reponse_commentaire', 'demande_ami', 'ami_accepte', 'projet_facebook'],
  defis: ['defi_gagne'],
};
const familleDe = (type) => Object.keys(FAMILLES).find((famille) => FAMILLES[famille].includes(type)) || 'social';

// Les clés VAPID identifient notre serveur auprès des services de push. Sans elles, le push est simplement éteint.
function clesVapid() {
  const { publique, privee, sujet } = config.vapid;
  if (!publique || !privee) return null;
  try {
    const point = depuisB64(publique); // 65 octets : 0x04, puis X (32) et Y (32)
    if (point.length !== 65 || point[0] !== 4 || depuisB64(privee).length !== 32) return null;
    const cle = crypto.createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', d: privee, x: b64(point.subarray(1, 33)), y: b64(point.subarray(33)) } });
    return { publique, cle, sujet: sujet || 'mailto:contact@palabre.dev' };
  } catch {
    return null;
  }
}
let vapid = clesVapid();
const pushActif = () => Boolean(vapid);

// Une paire de clés VAPID toute neuve (npm run cles-push).
function genererCles() {
  const paire = crypto.createECDH('prime256v1');
  paire.generateKeys();
  return { publique: b64(paire.getPublicKey()), privee: b64(paire.getPrivateKey()) };
}

// Vérifie un abonnement envoyé par le navigateur. Renvoie { endpoint, p256dh, auth } ou null.
function lireAbonnement(corps) {
  const endpoint = corps && typeof corps.endpoint === 'string' ? corps.endpoint.trim() : '';
  const cles = (corps && corps.cles) || {};
  let adresse;
  try { adresse = new URL(endpoint); } catch { return null; }
  if (adresse.protocol !== 'https:' || endpoint.length > 1000 || !HOTES_PERMIS.some((hote) => hote.test(adresse.hostname))) return null;
  if (typeof cles.p256dh !== 'string' || typeof cles.auth !== 'string') return null;
  const point = depuisB64(cles.p256dh);
  if (point.length !== 65 || point[0] !== 4 || depuisB64(cles.auth).length !== 16) return null;
  return { endpoint, p256dh: b64(point), auth: b64(depuisB64(cles.auth)) };
}

const hkdf = (sel, materiau, info, taille) => Buffer.from(crypto.hkdfSync('sha256', materiau, sel, info, taille));

// Le format « aes128gcm » (RFC 8188) : un en-tête (sel, taille des blocs, identifiant de clé) puis le contenu chiffré.
// materiau : le secret de départ ; la clé de chiffrement et le « nonce » en sont dérivés avec le sel.
// Un seul bloc suffit : nos messages font quelques centaines d'octets, la norme en permet 4096.
function aes128gcm(materiau, sel, identifiantCle, clair) {
  const cle = hkdf(sel, materiau, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(sel, materiau, Buffer.from('Content-Encoding: nonce\0'), 12);
  const chiffre = crypto.createCipheriv('aes-128-gcm', cle, nonce);
  // 0x02 : « dernier bloc », exigé par la norme.
  const corps = Buffer.concat([chiffre.update(Buffer.concat([Buffer.from(clair), Buffer.from([2])])), chiffre.final(), chiffre.getAuthTag()]);
  const entete = Buffer.alloc(21);
  sel.copy(entete, 0);
  entete.writeUInt32BE(4096, 16); // taille d'un bloc
  entete[20] = identifiantCle.length;
  return Buffer.concat([entete, identifiantCle, corps]);
}

// Chiffre le message pour UN appareil (RFC 8291). Seul cet appareil pourra le lire.
// clePrivee et sel : tirés au hasard à chaque message. Ils ne sont fournis que par les tests, qui rejouent
// l'exemple officiel de la norme (annexe A) pour vérifier le résultat octet par octet.
function chiffrer(abonnement, texteClair, { clePrivee = null, sel = crypto.randomBytes(16) } = {}) {
  const cleAppareil = depuisB64(abonnement.p256dh);
  const secretAppareil = depuisB64(abonnement.auth);
  // Une paire de clés jetable par message : avec la clé publique de l'appareil, elle donne un secret commun (ECDH).
  const jetable = crypto.createECDH('prime256v1');
  if (clePrivee) jetable.setPrivateKey(clePrivee);
  else jetable.generateKeys();
  const cleJetable = jetable.getPublicKey();
  const secretCommun = jetable.computeSecret(cleAppareil);
  const materiau = hkdf(secretAppareil, secretCommun, Buffer.concat([Buffer.from('WebPush: info\0'), cleAppareil, cleJetable]), 32);
  return aes128gcm(materiau, sel, cleJetable, texteClair);
}

// L'en-tête « Authorization » : un jeton signé avec notre clé privée, valable 12 heures, pour ce service de push.
function enteteVapid(endpoint) {
  const base = (objet) => b64(JSON.stringify(objet));
  const contenu = `${base({ typ: 'JWT', alg: 'ES256' })}.${base({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: vapid.sujet })}`;
  const signature = crypto.sign('sha256', Buffer.from(contenu), { key: vapid.cle, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${contenu}.${b64(signature)}, k=${vapid.publique}`;
}

// Envoie un push à tous les appareils d'un membre, s'il n'a pas coupé cette famille de notifications.
// Ne lève jamais d'erreur : un push raté ne doit pas faire échouer l'action du site. Renvoie le nombre d'envois réussis.
// message : { titre, texte, lien, tag }. Jamais plus privé que le nom et un aperçu de 60 caractères.
async function envoyerPush(utilisateurId, type, message) {
  if (!vapid) return 0;
  try {
    const { rows: [membre] } = await db.query('SELECT preferences_notifications AS preferences, langue FROM utilisateurs WHERE id = $1 AND bloque = FALSE', [utilisateurId]);
    if (!membre || ((membre.preferences || {}).push || {})[familleDe(type)] === false) return 0;
    const { rows: abonnements } = await db.query('SELECT id, endpoint, p256dh, auth FROM abonnements_push WHERE utilisateur_id = $1', [utilisateurId]);
    // Le titre et le texte sont écrits en français par le code ; ils partent dans la langue du destinataire.
    const { traduire } = require('./textes');
    const langue = membre.langue || 'fr';
    const charge = JSON.stringify({ titre: traduire(langue, message.titre || 'Palabre'), texte: traduire(langue, message.texte), lien: message.lien || '/notifications', tag: message.tag || type, ...(message.appel ? { appel: message.appel } : {}) });
    // « Topic » : le service de push remplace un message pas encore remis par le suivant du même sujet.
    const sujet = crypto.createHash('sha256').update(message.tag || type).digest('base64url').slice(0, 32);
    const resultats = await Promise.all(abonnements.map(async (abonnement) => {
      try {
        const reponse = await module.exports.transport(abonnement.endpoint, {
          method: 'POST',
          headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'normal', Topic: sujet, Authorization: enteteVapid(abonnement.endpoint) },
          body: chiffrer(abonnement, charge),
          signal: AbortSignal.timeout(8000),
        });
        // 404 ou 410 : l'abonnement n'existe plus (application désinstallée, permission retirée) : on l'oublie.
        if (reponse.status === 404 || reponse.status === 410) await db.query('DELETE FROM abonnements_push WHERE id = $1', [abonnement.id]);
        else if (!reponse.ok) console.error(`Push refusé (${reponse.status}) par ${new URL(abonnement.endpoint).hostname}`);
        return reponse.ok;
      } catch (erreur) {
        console.error('Push non envoyé :', erreur.message);
        return false;
      }
    }));
    return resultats.filter(Boolean).length;
  } catch (erreur) {
    console.error('Push non envoyé :', erreur.message);
    return 0;
  }
}

module.exports = {
  pushActif, genererCles, lireAbonnement, chiffrer, aes128gcm, envoyerPush, familleDe, FAMILLES,
  clePublique: () => (vapid ? vapid.publique : null),
  // Remplaçables par les tests : l'envoi lui-même, et les clés (pour essayer « avec » et « sans »).
  transport: (adresse, options) => fetch(adresse, options),
  reglerCles: (cles) => { config.vapid = { ...config.vapid, ...cles }; vapid = clesVapid(); },
};
