// Tests des sessions par appareil : le jeton porte l'identifiant de la session, chaque requête vérifie qu'elle
// existe et n'est pas révoquée ; liste des appareils, « Déconnecter », « Déconnecter tous les autres ».
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const { creerApp } = require('../src/app');
const { migrer } = require('../src/db/migrate');
const { pool } = require('../src/db/pool');
const { avecComptesPrets } = require('./aide');

let serveur;
let base;
const suffixe = Date.now();
const lettres = String(suffixe).replace(/\d/g, (chiffre) => 'abcdefghij'[chiffre]);
const membres = {};
const adresse = (cle) => `session-${cle}-${suffixe}@palabre.test`;
const ANDROID = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0';

async function appelBrut(chemin, { methode = 'GET', donnees, cookie, agent, entetes = {} } = {}) {
  const headers = { ...entetes };
  if (donnees) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  if (agent) headers['User-Agent'] = agent;
  const r = await fetch(`${base}${chemin}`, { method: methode, headers, body: donnees ? JSON.stringify(donnees) : undefined });
  const texte = await r.text();
  let corps = {};
  try { corps = JSON.parse(texte); } catch { /* une page HTML */ }
  return { statut: r.status, corps, texte, entetes: r.headers };
}
const appel = avecComptesPrets(appelBrut);
// Le cookie de session parmi ceux que pose une réponse.
const cookieDe = (reponse) => reponse.entetes.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('palabre_session='));
const connexion = (cle, agent) => appelBrut('/api/auth/connexion', { methode: 'POST', agent, donnees: { email: adresse(cle), motDePasse: 'motdepasse1' } });
const moi = async (cookie) => (await appelBrut('/api/auth/moi', { cookie })).corps.utilisateur;
const sessionsDe = async (cookie) => (await appelBrut('/api/parametres/sessions', { cookie })).corps.sessions;

async function inscrire(cle) {
  const r = await appel('/api/auth/inscription', { methode: 'POST', agent: WINDOWS, donnees: { type: 'client', prenom: cle, nomFamille: `Session${lettres}`, email: adresse(cle), motDePasse: 'motdepasse1', pays: 'Burkina Faso', ville: 'Koudougou', whatsapp: '+22670000009' } });
  assert.equal(r.statut, 201, JSON.stringify(r.corps));
  membres[cle] = { cookie: cookieDe(r), id: r.corps.utilisateur.id };
}

test.before(async () => {
  await migrer();
  serveur = creerApp().listen(0);
  base = `http://localhost:${serveur.address().port}`;
  for (const cle of ['awa', 'bintou']) await inscrire(cle);
});

test.after(async () => {
  await pool.query('DELETE FROM utilisateurs WHERE email LIKE $1', [`session-%-${suffixe}@palabre.test`]);
  await new Promise((fini) => serveur.close(fini));
  await pool.end();
});

test('le jeton porte l\'identifiant de la session ; sans session en base, il ne vaut rien', async () => {
  const jeton = decodeURIComponent(membres.awa.cookie.split('=')[1]);
  const { id, sid } = jwt.verify(jeton, config.jwtSecret);
  assert.equal(id, membres.awa.id);
  assert.match(sid, /^[0-9a-f]{32}$/);
  const { rows: [ligne] } = await pool.query('SELECT utilisateur_id, appareil, revoquee_le FROM sessions WHERE id = $1', [sid]);
  assert.deepEqual({ ...ligne }, { utilisateur_id: membres.awa.id, appareil: 'Firefox sur Windows', revoquee_le: null });

  // Un jeton parfaitement signé, mais sans session, avec une session inventée, ou avec la session d'une autre.
  const signer = (contenu) => `palabre_session=${jwt.sign(contenu, config.jwtSecret, { expiresIn: '1h' })}`;
  const { sid: sidBintou } = jwt.verify(decodeURIComponent(membres.bintou.cookie.split('=')[1]), config.jwtSecret);
  assert.equal(await moi(signer({ id: membres.awa.id })), null, 'ancien format, sans session');
  assert.equal(await moi(signer({ id: membres.awa.id, sid: 'a'.repeat(32) })), null, 'session inventée');
  assert.equal(await moi(signer({ id: membres.awa.id, sid: sidBintou })), null, 'session d\'un autre membre');
  assert.equal(await moi(signer({ id: membres.awa.id, sid: { $ne: '' } })), null, 'session qui n\'est pas un texte');
  assert.equal((await moi(membres.awa.cookie)).id, membres.awa.id);
});

test('appareils connectés : la liste, « Cet appareil », jamais d\'adresse IP ni d\'identifiant de session', async () => {
  const telephone = cookieDe(await connexion('awa', ANDROID));
  const liste = await sessionsDe(membres.awa.cookie);
  assert.equal(liste.length, 2);
  assert.deepEqual(liste.map((s) => [s.appareil, s.actuelle]), [['Firefox sur Windows', true], ['Chrome sur Android', false]]);
  assert.ok(liste.every((s) => /^[0-9a-f]{16}$/.test(s.cle) && s.lieu === null && s.vuLe && s.creeLe));
  // Vue du téléphone, c'est lui « cet appareil ».
  assert.deepEqual((await sessionsDe(telephone)).map((s) => [s.appareil, s.actuelle]), [['Chrome sur Android', true], ['Firefox sur Windows', false]]);
  // Rien de secret ne sort : ni l'adresse IP (pourtant gardée en base), ni l'identifiant des sessions.
  const { rows } = await pool.query('SELECT id, ip FROM sessions WHERE utilisateur_id = $1', [membres.awa.id]);
  assert.ok(rows.every((s) => s.ip));
  const sorti = JSON.stringify((await appelBrut('/api/parametres', { cookie: membres.awa.cookie })).corps) + JSON.stringify(liste);
  for (const s of rows) assert.ok(!sorti.includes(s.id) && !sorti.includes(s.ip));
  assert.ok(!/\d+\.\d+\.\d+\.\d+|::1|::ffff/.test(sorti));
  // En anglais, le nom de l'appareil est traduit.
  const enAnglais = (await appelBrut('/api/parametres/sessions', { cookie: `${membres.awa.cookie}; langue=en` })).corps.sessions;
  assert.deepEqual(enAnglais.map((s) => s.appareil), ['Firefox on Windows', 'Chrome on Android']);
  // Visiteur : refusé.
  assert.equal((await appelBrut('/api/parametres/sessions')).statut, 401);
  membres.awa.telephone = telephone;
});

test('« Déconnecter » un appareil : sa session est refusée tout de suite, même avec son cookie intact', async () => {
  const { telephone } = membres.awa;
  assert.ok(await moi(telephone));
  const cle = (await sessionsDe(membres.awa.cookie)).find((s) => !s.actuelle).cle;
  // Bintou ne peut pas déconnecter l'appareil d'Awa, même en connaissant son empreinte.
  assert.equal((await appelBrut(`/api/parametres/sessions/${cle}`, { methode: 'DELETE', cookie: membres.bintou.cookie, donnees: {} })).statut, 404);
  assert.ok(await moi(telephone));

  const ferme = await appelBrut(`/api/parametres/sessions/${cle}`, { methode: 'DELETE', cookie: membres.awa.cookie, donnees: {} });
  assert.deepEqual([ferme.statut, ferme.corps.ici], [200, false]);
  assert.equal(await moi(telephone), null);
  assert.equal((await appelBrut('/api/parametres', { cookie: telephone })).statut, 401);
  assert.equal((await appelBrut('/api/publications', { cookie: telephone })).statut, 401);
  assert.equal((await sessionsDe(membres.awa.cookie)).length, 1);
  // Une deuxième fois : déjà fait.
  assert.equal((await appelBrut(`/api/parametres/sessions/${cle}`, { methode: 'DELETE', cookie: membres.awa.cookie, donnees: {} })).statut, 404);
  assert.equal((await appelBrut('/api/parametres/sessions/pas-une-cle', { methode: 'DELETE', cookie: membres.awa.cookie, donnees: {} })).statut, 404);
});

test('se déconnecter révoque la session côté serveur : le cookie gardé de côté ne marche plus', async () => {
  const cookie = cookieDe(await connexion('bintou', ANDROID));
  assert.ok(await moi(cookie));
  const sortie = await appelBrut('/api/auth/deconnexion', { methode: 'POST', cookie, donnees: {} });
  assert.equal(sortie.statut, 200);
  assert.match(sortie.entetes.getSetCookie().join(' '), /palabre_session=;/);
  // Quelqu'un qui aurait copié le cookie avant la déconnexion ne peut plus s'en servir.
  assert.equal(await moi(cookie), null);
  const { sid } = jwt.verify(decodeURIComponent(cookie.split('=')[1]), config.jwtSecret);
  assert.ok((await pool.query('SELECT revoquee_le FROM sessions WHERE id = $1', [sid])).rows[0].revoquee_le);
  // L'autre appareil de Bintou n'est pas touché.
  assert.ok(await moi(membres.bintou.cookie));
});

test('« Déconnecter tous les autres » : seul cet appareil reste ; se déconnecter « ici » efface le cookie', async () => {
  const autres = [cookieDe(await connexion('bintou', ANDROID)), cookieDe(await connexion('bintou', WINDOWS))];
  assert.equal((await sessionsDe(membres.bintou.cookie)).length, 3);
  assert.equal((await appelBrut('/api/parametres/deconnecter-autres', { methode: 'POST', cookie: membres.bintou.cookie, donnees: {} })).statut, 200);
  for (const cookie of autres) assert.equal(await moi(cookie), null);
  const reste = await sessionsDe(membres.bintou.cookie);
  assert.deepEqual(reste.map((s) => s.actuelle), [true]);

  const ici = await appelBrut(`/api/parametres/sessions/${reste[0].cle}`, { methode: 'DELETE', cookie: membres.bintou.cookie, donnees: {} });
  assert.deepEqual([ici.statut, ici.corps.ici], [200, true]);
  assert.match(ici.entetes.getSetCookie().join(' '), /palabre_session=;/);
  assert.equal(await moi(membres.bintou.cookie), null);
});

test('mot de passe réinitialisé : toutes les sessions sont révoquées', async () => {
  const { emailsEnvoyes } = require('./aide');
  const cookie = cookieDe(await connexion('bintou', ANDROID));
  assert.ok(await moi(cookie));
  await appelBrut('/api/auth/mot-de-passe-oublie', { methode: 'POST', donnees: { email: adresse('bintou') } });
  const jeton = /jeton=([0-9a-f]{64})/.exec(emailsEnvoyes.filter((m) => m.a === adresse('bintou')).pop().texte)[1];
  assert.equal((await appelBrut('/api/auth/reinitialiser', { methode: 'POST', donnees: { jeton, motDePasse: 'un-autre-secret-42' } })).statut, 200);
  assert.equal(await moi(cookie), null);
  const { rows: [{ ouvertes }] } = await pool.query('SELECT count(*)::int AS ouvertes FROM sessions WHERE utilisateur_id = $1 AND revoquee_le IS NULL', [membres.bintou.id]);
  assert.equal(ouvertes, 0);
});

test('lieu approximatif : seulement si l\'hébergeur le donne dans un en-tête déclaré', async () => {
  // Sans réglage, un en-tête envoyé par le visiteur n'est pas cru.
  const sans = cookieDe(await appelBrut('/api/auth/connexion', { methode: 'POST', agent: ANDROID, entetes: { 'X-Pays': 'Burkina Faso', 'X-Ville': 'Koudougou' }, donnees: { email: adresse('awa'), motDePasse: 'motdepasse1' } }));
  assert.equal((await sessionsDe(sans))[0].lieu, null);
  // Avec ENTETE_PAYS et ENTETE_VILLE, le lieu est gardé et affiché ; une valeur bizarre est écartée.
  Object.assign(config, { entetePays: 'x-pays', enteteVille: 'x-ville' });
  try {
    const avec = cookieDe(await appelBrut('/api/auth/connexion', { methode: 'POST', agent: ANDROID, entetes: { 'X-Pays': 'Burkina Faso', 'X-Ville': 'Koudougou' }, donnees: { email: adresse('awa'), motDePasse: 'motdepasse1' } }));
    assert.equal((await sessionsDe(avec))[0].lieu, 'Koudougou, Burkina Faso');
    const bizarre = cookieDe(await appelBrut('/api/auth/connexion', { methode: 'POST', agent: ANDROID, entetes: { 'X-Pays': '<script>1</script>', 'X-Ville': 'x'.repeat(90) }, donnees: { email: adresse('awa'), motDePasse: 'motdepasse1' } }));
    assert.equal((await sessionsDe(bizarre))[0].lieu, null);
  } finally {
    Object.assign(config, { entetePays: '', enteteVille: '' });
  }
});
