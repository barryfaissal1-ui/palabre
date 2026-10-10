// Tests des notifications push : abonnement, envoi chiffré, préférences, abonnements expirés, site sans clés.
// Aucun vrai service de push n'est appelé : l'envoi (push.transport) est remplacé, et le test joue le rôle du
// téléphone en déchiffrant le message avec les clés de « l'appareil ».
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { creerApp } = require('../src/app');
const { migrer } = require('../src/db/migrate');
const { pool } = require('../src/db/pool');
const push = require('../src/utils/push');
const { notifier } = require('../src/utils/notifications');
const { avecComptesPrets } = require('./aide');

let serveur;
let base;
const suffixe = Date.now();
const lettres = String(suffixe).replace(/\d/g, (chiffre) => 'abcdefghij'[chiffre]);
const membres = {};
const nom = (cle) => `${cle} Push${lettres}`;
const envois = []; // ce que le serveur a voulu envoyer aux services de push
let reponseDuService = () => ({ ok: true, status: 201 });
const attendre = (ms) => new Promise((suite) => setTimeout(suite, ms));

async function appelBrut(chemin, { methode = 'GET', donnees, qui } = {}) {
  const headers = {};
  if (donnees) headers['Content-Type'] = 'application/json';
  if (qui) headers.Cookie = membres[qui].cookie;
  const r = await fetch(`${base}${chemin}`, { method: methode, headers, body: donnees ? JSON.stringify(donnees) : undefined });
  return { statut: r.status, corps: await r.json().catch(() => ({})), entetes: r.headers };
}
const appel = avecComptesPrets(appelBrut);
const poster = (qui, chemin, donnees = {}) => appel(chemin, { methode: 'POST', qui, donnees });

// Un faux téléphone : sa paire de clés, son secret, et l'adresse que lui aurait donnée le service de push.
function appareil(nomAppareil) {
  const cles = crypto.createECDH('prime256v1');
  cles.generateKeys();
  const auth = crypto.randomBytes(16);
  const endpoint = `https://fcm.googleapis.com/fcm/send/${nomAppareil}-${suffixe}`;
  return { cles, auth, endpoint, abonnement: { endpoint, cles: { p256dh: cles.getPublicKey().toString('base64url'), auth: auth.toString('base64url') }, appareil: 'Chrome sur Android' } };
}
// Ce que fait le téléphone à la réception (RFC 8291) : retrouver la clé avec SES clés privées, puis déchiffrer.
function dechiffrer(corps, telephone) {
  const sel = corps.subarray(0, 16);
  const cleServeur = corps.subarray(21, 21 + corps[20]);
  const chiffre = corps.subarray(21 + corps[20]);
  const hkdf = (selUtilise, materiau, info, taille) => Buffer.from(crypto.hkdfSync('sha256', materiau, selUtilise, info, taille));
  const materiau = hkdf(telephone.auth, telephone.cles.computeSecret(cleServeur), Buffer.concat([Buffer.from('WebPush: info\0'), telephone.cles.getPublicKey(), cleServeur]), 32);
  const dechiffre = crypto.createDecipheriv('aes-128-gcm', hkdf(sel, materiau, Buffer.from('Content-Encoding: aes128gcm\0'), 16), hkdf(sel, materiau, Buffer.from('Content-Encoding: nonce\0'), 12));
  dechiffre.setAuthTag(chiffre.subarray(-16));
  const clair = Buffer.concat([dechiffre.update(chiffre.subarray(0, -16)), dechiffre.final()]);
  return JSON.parse(clair.subarray(0, clair.lastIndexOf(2)).toString());
}
// Les push partent juste après la réponse du site : on attend qu'il y en ait « nombre », ou un court délai.
async function pushRecus(nombre = 1) {
  for (let i = 0; i < 60 && envois.length < nombre; i += 1) await attendre(25);
  await attendre(60);
  return envois.splice(0);
}
const publier = async (qui, texte) => (await poster(qui, '/api/publications', { type: 'idee', texte })).corps.publication.id;
const abonnements = async (qui) => (await pool.query('SELECT endpoint, appareil FROM abonnements_push WHERE utilisateur_id = $1 ORDER BY id', [membres[qui].id])).rows;

let telephoneAwa;
let clesDuSite;

test.before(async () => {
  await migrer();
  serveur = creerApp().listen(0);
  base = `http://localhost:${serveur.address().port}`;
  push.transport = async (adresse, options) => { envois.push({ adresse, options }); return reponseDuService(adresse); };
  for (const cle of ['awa', 'bintou', 'cheick']) {
    const email = `push-${cle}-${suffixe}@palabre.test`;
    const r = await appel('/api/auth/inscription', { methode: 'POST', donnees: { type: 'dev', prenom: cle, nomFamille: `Push${lettres}`, email, motDePasse: 'motdepasse1', pays: 'Burkina Faso', ville: 'Koudougou' } });
    assert.equal(r.statut, 201);
    const { rows } = await pool.query('SELECT id FROM utilisateurs WHERE email = $1', [email]);
    membres[cle] = { cookie: r.entetes.get('set-cookie').split(';')[0], identifiant: r.corps.utilisateur.identifiant, id: rows[0].id };
  }
  telephoneAwa = appareil('awa');
});

test.after(async () => {
  await pool.query('DELETE FROM utilisateurs WHERE email LIKE $1', [`push-%-${suffixe}@palabre.test`]);
  await new Promise((fini) => serveur.close(fini));
  await pool.end();
});

test('sans clés VAPID : le site marche, notifier() ne plante pas, aucun push ne part', async () => {
  push.reglerCles({ publique: '', privee: '' });
  assert.equal(push.pushActif(), false);
  const etat = await appel('/api/notifications/push', { qui: 'awa' });
  assert.equal(etat.statut, 200);
  assert.equal(etat.corps.actif, false);
  assert.equal(etat.corps.clePublique, null);
  assert.equal((await poster('awa', '/api/notifications/push', telephoneAwa.abonnement)).statut, 400);

  // Les notifications de la cloche continuent d'arriver.
  const id = await publier('awa', 'Sans clés');
  assert.equal((await poster('bintou', `/api/publications/${id}/jaime`)).statut, 200);
  await notifier(pool, membres.awa.id, 'defi_gagne', 'Bravo.', '/defis');
  assert.equal(await push.envoyerPush(membres.awa.id, 'jaime', { texte: 'x' }), 0);
  assert.equal((await pushRecus(0)).length, 0);
  const { rows } = await pool.query('SELECT type FROM notifications WHERE utilisateur_id = $1 ORDER BY id', [membres.awa.id]);
  assert.deepEqual(rows.map((r) => r.type), ['jaime', 'defi_gagne']);
  // Des clés mal écrites ne font pas planter le serveur : le push reste simplement éteint.
  push.reglerCles({ publique: 'pas-une-cle', privee: 'non-plus' });
  assert.equal(push.pushActif(), false);
});

test('abonnement : enregistré pour cet appareil, refusé si l\'adresse n\'est pas un vrai service de push', async () => {
  clesDuSite = push.genererCles();
  push.reglerCles({ ...clesDuSite, sujet: 'mailto:equipe@palabre.test' });
  const etat = (await appel('/api/notifications/push', { qui: 'awa' })).corps;
  assert.equal(etat.actif, true);
  assert.equal(etat.clePublique, clesDuSite.publique);
  assert.ok(!JSON.stringify(etat).includes(clesDuSite.privee), 'la clé privée ne sort jamais');
  assert.deepEqual(etat.preferences, { messages: true, demandes: true, equipes: true, social: true, defis: true });

  assert.equal((await appelBrut('/api/notifications/push', { methode: 'POST', donnees: telephoneAwa.abonnement })).statut, 401);
  assert.equal((await poster('awa', '/api/notifications/push', telephoneAwa.abonnement)).statut, 201);
  assert.equal((await poster('awa', '/api/notifications/push', telephoneAwa.abonnement)).statut, 201, 's\'abonner deux fois ne fait pas de doublon');
  assert.deepEqual(await abonnements('awa'), [{ endpoint: telephoneAwa.endpoint, appareil: 'Chrome sur Android' }]);

  // Le serveur n'écrit qu'aux services de push connus : pas à une machine interne, ni à un site qui leur ressemble.
  const bon = telephoneAwa.abonnement;
  for (const endpoint of ['http://fcm.googleapis.com/fcm/send/x', 'https://localhost/x', 'https://169.254.169.254/latest', 'https://fcm.googleapis.com.pirate.test/x', 'https://exemple.test/push', 'pas une adresse', '']) {
    assert.equal((await poster('bintou', '/api/notifications/push', { ...bon, endpoint })).statut, 400, endpoint);
  }
  for (const cles of [{ p256dh: 'trop-court', auth: bon.cles.auth }, { p256dh: bon.cles.p256dh, auth: 'abc' }, {}]) {
    assert.equal((await poster('bintou', '/api/notifications/push', { endpoint: 'https://fcm.googleapis.com/fcm/send/b', cles })).statut, 400);
  }
  assert.deepEqual(await abonnements('bintou'), []);
});

test('un j\'aime envoie un push chiffré, signé par le site, que seul l\'appareil peut lire', async () => {
  const id = await publier('awa', 'Publication avec push');
  await poster('bintou', `/api/publications/${id}/jaime`);
  const [envoi, ...autres] = await pushRecus();
  assert.equal(autres.length, 0);
  assert.equal(envoi.adresse, telephoneAwa.endpoint);
  assert.equal(envoi.options.method, 'POST');
  assert.equal(envoi.options.headers['Content-Encoding'], 'aes128gcm');
  assert.equal(envoi.options.headers.TTL, '86400');
  assert.match(envoi.options.headers.Topic, /^[A-Za-z0-9_-]{1,32}$/);

  // Le message en transit est illisible…
  assert.ok(!envoi.options.body.toString('latin1').includes('aimé'));
  // … mais l'appareil, avec ses clés, retrouve le titre, le texte, le lien et le tag.
  assert.deepEqual(dechiffrer(envoi.options.body, telephoneAwa), {
    titre: 'Palabre', texte: `${nom('bintou')} a aimé ta publication.`, lien: `/publication/${id}`, tag: `jaime-publication-${id}`,
  });

  // La signature VAPID : un jeton ES256 pour ce service de push, vérifiable avec la clé publique du site.
  const [, jeton, clePublique] = /^vapid t=([^,]+), k=(.+)$/.exec(envoi.options.headers.Authorization);
  assert.equal(clePublique, clesDuSite.publique);
  const [entete, contenu, signature] = jeton.split('.');
  const point = Buffer.from(clesDuSite.publique, 'base64url');
  const cle = crypto.createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url') } });
  assert.ok(crypto.verify('sha256', Buffer.from(`${entete}.${contenu}`), { key: cle, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')));
  const revendications = JSON.parse(Buffer.from(contenu, 'base64url'));
  assert.equal(revendications.aud, 'https://fcm.googleapis.com');
  assert.equal(revendications.sub, 'mailto:equipe@palabre.test');
  assert.ok(revendications.exp > Date.now() / 1000 && revendications.exp <= Date.now() / 1000 + 24 * 3600);

  // Jamais de push pour ses propres actions.
  await poster('awa', `/api/publications/${id}/jaime`);
  assert.equal((await pushRecus(0)).length, 0);
});

test('message : le push porte le nom et un aperçu de 60 caractères, jamais le message entier', async () => {
  await poster('awa', '/api/amis/demandes', { identifiant: membres.bintou.identifiant });
  await poster('bintou', `/api/amis/demandes/${membres.awa.identifiant}/accepter`);
  await pushRecus(1); // « Bintou a accepté ta demande d'ami »
  const long = `Voici un long message : ${'bla '.repeat(40)}et le secret est tout à la fin.`;
  const { corps } = await poster('bintou', `/api/messages/avec/${membres.awa.identifiant}`, { texte: long });
  const [envoi] = await pushRecus();
  const recu = dechiffrer(envoi.options.body, telephoneAwa);
  assert.equal(recu.titre, nom('bintou'));
  assert.equal(recu.texte.length, 60);
  assert.ok(long.startsWith(recu.texte.slice(0, -1)) && recu.texte.endsWith('…'));
  assert.ok(!recu.texte.includes('secret'));
  assert.equal(recu.lien, `/messages/${corps.conversationId}`);
  assert.equal(recu.tag, `message-conversation-${corps.conversationId}`, 'même tag : le message suivant remplace la notification');
});

test('préférences : une famille coupée n\'arrive plus en push, mais reste dans la cloche', async () => {
  const choix = { messages: true, demandes: true, equipes: true, social: false, defis: true };
  const r = await appel('/api/notifications/push/preferences', { methode: 'PUT', qui: 'awa', donnees: choix });
  assert.equal(r.statut, 200);
  assert.deepEqual(r.corps.preferences, choix);
  assert.deepEqual((await appel('/api/notifications/push', { qui: 'awa' })).corps.preferences, choix);

  const id = await publier('awa', 'J\'aime sans push');
  await poster('cheick', `/api/publications/${id}/jaime`);
  assert.equal((await pushRecus(0)).length, 0, 'pas de push pour un j\'aime');
  const { rows } = await pool.query('SELECT 1 FROM notifications WHERE utilisateur_id = $1 AND type = \'jaime\' AND cible_id = $2', [membres.awa.id, id]);
  assert.equal(rows.length, 1, 'la cloche garde tout');
  // Les messages, eux, arrivent toujours.
  await poster('bintou', `/api/messages/avec/${membres.awa.identifiant}`, { texte: 'Toujours là ?' });
  assert.equal((await pushRecus()).length, 1);

  // Un choix incomplet ou mal écrit est refusé ; les préférences d'un autre ne bougent pas.
  assert.equal((await appel('/api/notifications/push/preferences', { methode: 'PUT', qui: 'awa', donnees: { messages: 'non' } })).statut, 400);
  assert.equal((await appel('/api/notifications/push/preferences', { methode: 'PUT', donnees: choix })).statut, 401);
  assert.equal((await appel('/api/notifications/push', { qui: 'bintou' })).corps.preferences.social, true);
  await appel('/api/notifications/push/preferences', { methode: 'PUT', qui: 'awa', donnees: { ...choix, social: true } });
});

test('abonnement expiré (410) : supprimé ; service en panne : rien ne plante', async () => {
  const second = appareil('awa-vieux');
  assert.equal((await poster('awa', '/api/notifications/push', { ...second.abonnement, appareil: 'Firefox sur Windows' })).statut, 201);
  assert.equal((await abonnements('awa')).length, 2);
  reponseDuService = (adresse) => (adresse === second.endpoint ? { ok: false, status: 410 } : { ok: true, status: 201 });
  assert.equal(await push.envoyerPush(membres.awa.id, 'defi_gagne', { texte: 'Bravo.' }), 1);
  assert.deepEqual((await abonnements('awa')).map((a) => a.endpoint), [telephoneAwa.endpoint], 'l\'abonnement expiré est oublié');
  envois.length = 0;

  // Service de push injoignable ou en erreur : l'action du membre réussit quand même.
  push.transport = async () => { throw new Error('réseau coupé'); };
  const erreurs = [];
  const consoleErreur = console.error;
  console.error = (...texte) => erreurs.push(texte.join(' '));
  try {
    assert.equal(await push.envoyerPush(membres.awa.id, 'defi_gagne', { texte: 'Bravo.' }), 0);
    const id = await publier('awa', 'Pendant la panne');
    assert.equal((await poster('cheick', `/api/publications/${id}/jaime`)).statut, 200);
    await attendre(150);
  } finally {
    console.error = consoleErreur;
    push.transport = async (adresse, options) => { envois.push({ adresse, options }); return reponseDuService(adresse); };
    reponseDuService = () => ({ ok: true, status: 201 });
  }
  assert.ok(erreurs.some((e) => /Push non envoyé/.test(e)), 'l\'erreur est seulement notée dans la console');
  assert.equal((await abonnements('awa')).length, 1, 'une panne ne supprime pas l\'abonnement');
});

test('désabonnement : seulement le sien ; un appareil qui change de mains change de membre', async () => {
  // Cheick ne peut pas retirer l'abonnement d'Awa.
  const pasLeMien = await appel('/api/notifications/push', { methode: 'DELETE', qui: 'cheick', donnees: { endpoint: telephoneAwa.endpoint } });
  assert.equal(pasLeMien.corps.retire, false);
  assert.equal((await abonnements('awa')).length, 1);
  // Cheick se connecte sur le téléphone d'Awa et s'abonne : l'appareil est maintenant le sien, plus celui d'Awa.
  assert.equal((await poster('cheick', '/api/notifications/push', telephoneAwa.abonnement)).statut, 201);
  assert.equal((await abonnements('awa')).length, 0);
  assert.equal((await abonnements('cheick')).length, 1);
  const id = await publier('awa', 'Awa n\'a plus d\'appareil');
  await poster('bintou', `/api/publications/${id}/jaime`);
  assert.equal((await pushRecus(0)).length, 0);

  const retire = await appel('/api/notifications/push', { methode: 'DELETE', qui: 'cheick', donnees: { endpoint: telephoneAwa.endpoint } });
  assert.equal(retire.corps.retire, true);
  assert.equal((await abonnements('cheick')).length, 0);
  assert.equal((await appelBrut('/api/notifications/push', { methode: 'DELETE', donnees: { endpoint: 'x' } })).statut, 401);
});

// ---------- Les exemples officiels des normes ----------
// Les tests plus haut déchiffrent avec notre propre code : ils prouvent que chiffrement et déchiffrement s'accordent,
// pas qu'ils suivent la norme. Ici on rejoue les exemples publiés dans les RFC, avec leurs clés et leur sel fixés :
// le résultat doit être identique OCTET PAR OCTET. C'est la preuve qu'un vrai téléphone saura lire nos messages.
const b64 = (texte) => Buffer.from(texte, 'base64url');

test('RFC 8188, section 3.1 : le format aes128gcm, exemple officiel', () => {
  // « I am the walrus », clé et sel donnés par la norme, sans identifiant de clé.
  const resultat = push.aes128gcm(b64('yqdlZ-tYemfogSmv7Ws5PQ'), b64('I1BsxtFttlv3u_Oo94xnmw'), Buffer.alloc(0), 'I am the walrus');
  assert.equal(resultat.toString('base64url'), 'I1BsxtFttlv3u_Oo94xnmwAAEAAA-NAVub2qFgBEuQKRapoZu-IxkIva3MEB1PD-ly8Thjg');
});

test('RFC 8291, annexe A : le message push chiffré, exemple officiel, octet par octet', () => {
  const norme = {
    clair: 'When I grow up, I want to be a watermelon',
    clePriveeServeur: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
    clePubliqueServeur: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
    clePriveeAppareil: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
    clePubliqueAppareil: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    secretAppareil: 'BTBZMqHH6r4Tts7J_aSIgg',
    sel: 'DGv6ra1nlYgDCS1FRnbzlw',
    attendu: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
  };
  // Les clés de l'exemple sont cohérentes entre elles (garde-fou contre une faute de recopie dans ce fichier).
  for (const [privee, publique] of [[norme.clePriveeServeur, norme.clePubliqueServeur], [norme.clePriveeAppareil, norme.clePubliqueAppareil]]) {
    const paire = crypto.createECDH('prime256v1');
    paire.setPrivateKey(b64(privee));
    assert.equal(paire.getPublicKey().toString('base64url'), publique);
  }
  // Notre chiffrement, avec la clé jetable et le sel de la norme, donne exactement le message de la norme.
  const resultat = push.chiffrer({ p256dh: norme.clePubliqueAppareil, auth: norme.secretAppareil }, norme.clair, { clePrivee: b64(norme.clePriveeServeur), sel: b64(norme.sel) });
  assert.equal(resultat.toString('base64url'), norme.attendu);

  // Et le message de la norme, relu avec les clés de l'appareil, redonne le texte d'origine.
  const telephone = { cles: crypto.createECDH('prime256v1'), auth: b64(norme.secretAppareil) };
  telephone.cles.setPrivateKey(b64(norme.clePriveeAppareil));
  const corps = b64(norme.attendu);
  const sel = corps.subarray(0, 16);
  const cleServeur = corps.subarray(21, 21 + corps[20]);
  const hk = (s, m, info, taille) => Buffer.from(crypto.hkdfSync('sha256', m, s, info, taille));
  const secret = telephone.cles.computeSecret(cleServeur);
  assert.equal(secret.toString('base64url'), 'kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs', 'secret commun (ECDH) de la norme');
  const materiau = hk(telephone.auth, secret, Buffer.concat([Buffer.from('WebPush: info\0'), telephone.cles.getPublicKey(), cleServeur]), 32);
  assert.equal(materiau.toString('base64url'), 'S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg', 'matériau de clé (IKM) de la norme');
  assert.equal(hk(sel, materiau, Buffer.from('Content-Encoding: aes128gcm\0'), 16).toString('base64url'), 'oIhVW04MRdy2XN9CiKLxTg', 'clé de chiffrement (CEK) de la norme');
  assert.equal(hk(sel, materiau, Buffer.from('Content-Encoding: nonce\0'), 12).toString('base64url'), '4h_95klXJ5E_qnoN', 'nonce de la norme');
  const dechiffre = crypto.createDecipheriv('aes-128-gcm', hk(sel, materiau, Buffer.from('Content-Encoding: aes128gcm\0'), 16), hk(sel, materiau, Buffer.from('Content-Encoding: nonce\0'), 12));
  const chiffre = corps.subarray(21 + corps[20]);
  dechiffre.setAuthTag(chiffre.subarray(-16));
  const clair = Buffer.concat([dechiffre.update(chiffre.subarray(0, -16)), dechiffre.final()]);
  assert.equal(clair.subarray(0, clair.length - 1).toString(), norme.clair);
  assert.equal(clair[clair.length - 1], 2, 'le dernier octet est le marqueur « dernier bloc »');
});

test('familles : chaque type de notification appartient à une famille réglable', () => {
  assert.equal(push.familleDe('message'), 'messages');
  assert.equal(push.familleDe('nouvelle_proposition'), 'demandes');
  assert.equal(push.familleDe('invitation_equipe'), 'equipes');
  assert.equal(push.familleDe('jaime'), 'social');
  assert.equal(push.familleDe('defi_gagne'), 'defis');
  assert.equal(push.familleDe('type_inconnu'), 'social');
  assert.deepEqual(Object.keys(push.FAMILLES), ['messages', 'demandes', 'equipes', 'social', 'defis']);
});
