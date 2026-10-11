// Tests de la protection contre les essais de mots de passe : verrou par compte (sans révéler que le compte
// existe), email au propriétaire, et mots de passe refusés (trop courants, ou contenant le nom de la personne).
const test = require('node:test');
const assert = require('node:assert/strict');
const { creerApp } = require('../src/app');
const { migrer } = require('../src/db/migrate');
const { pool } = require('../src/db/pool');
const { MOTS_COURANTS, normaliser, tropCourant, contientLeNom } = require('../src/utils/mots-de-passe');
const { validerCompte, jetonAncien, emailsEnvoyes } = require('./aide');

let serveur;
let base;
const suffixe = Date.now();
const lettres = String(suffixe).replace(/\d/g, (chiffre) => 'abcdefghij'[chiffre]);
const adresse = (cle) => `mdp-${cle}-${suffixe}@palabre.test`;
const BON = 'kolatier-vert-48';
const membres = {};

// Chaque appel peut venir d'une adresse IP différente (en-tête du proxy) : ce fichier teste la limite PAR COMPTE,
// qui doit tenir même quand l'attaquant change d'adresse à chaque essai.
let numero = 0;
async function appel(chemin, { methode = 'GET', donnees, cookie, ip } = {}) {
  numero += 1;
  const headers = { 'X-Forwarded-For': ip || `10.40.${Math.floor(numero / 250)}.${(numero % 250) + 1}` };
  if (donnees) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const r = await fetch(`${base}${chemin}`, { method: methode, headers, body: donnees ? JSON.stringify(donnees) : undefined });
  const texte = await r.text();
  let corps = {};
  try { corps = JSON.parse(texte); } catch { /* une page HTML */ }
  return { statut: r.status, corps, cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('palabre_session=')) };
}
const connexion = (cle, motDePasse = BON, options = {}) => appel('/api/auth/connexion', { methode: 'POST', donnees: { email: adresse(cle), motDePasse }, ...options });
const inscription = (cle, motDePasse, prenom = cle, nomFamille = `Secret${lettres}`) => appel('/api/auth/inscription', {
  methode: 'POST',
  donnees: { type: 'client', prenom, nomFamille, email: adresse(cle), motDePasse, pays: 'Burkina Faso', ville: 'Koudougou', whatsapp: '+22670000009', jeton: jetonAncien() },
});
async function inscrire(cle, prenom = cle) {
  const r = await inscription(cle, BON, prenom);
  assert.equal(r.statut, 201, JSON.stringify(r.corps));
  await validerCompte(adresse(cle));
  membres[cle] = { id: r.corps.utilisateur.id, identifiant: r.corps.utilisateur.identifiant, cookie: r.cookie };
}
const compte = async (cle) => (await pool.query('SELECT echecs_connexion, echecs_depuis, connexion_bloquee_jusqu_a FROM utilisateurs WHERE id = $1', [membres[cle].id])).rows[0];
const emailsEssais = (cle) => emailsEnvoyes.filter((m) => m.a === adresse(cle) && /essaie de se connecter|trying to log in/.test(m.sujet));

test.before(async () => {
  await migrer();
  serveur = creerApp().listen(0);
  base = `http://localhost:${serveur.address().port}`;
  for (const cle of ['awa', 'bintou', 'cheick', 'drissa']) await inscrire(cle);
  await inscrire('zenabou', 'Zénabou');
});

test.after(async () => {
  await pool.query('DELETE FROM utilisateurs WHERE email LIKE $1', [`mdp-%-${suffixe}@palabre.test`]);
  await new Promise((fini) => serveur.close(fini));
  await pool.end();
});

test('la liste maison : au moins 300 mots, tous écrits en minuscules sans accent, avec ceux que l\'équipe a nommés', () => {
  assert.ok(MOTS_COURANTS.size >= 300, `${MOTS_COURANTS.size} mots`);
  for (const mot of MOTS_COURANTS) assert.equal(mot, normaliser(mot), mot);
  for (const mot of ['12345678', 'azerty123', 'motdepasse', 'password', 'qwerty', 'burkina', 'palabre', 'motdepasse2026']) assert.ok(MOTS_COURANTS.has(mot), mot);
});

test('trop courant : le mot entier, ou ce qu\'il en reste sans chiffres, signes, majuscules ni accents', () => {
  for (const refuse of ['12345678', 'Azerty123', 'MOTDEPASSE', 'Mot De Passe', 'pàsswörd', 'P@ssw0rd', 'Burkina2026!', 'palabre-226', '!!Qwerty!!', 'aaaaaaaa', '12121212', '0123456789', '98765432', 'Koudougou1', 'jesus-2000', 'Bonjour 1990']) {
    assert.ok(tropCourant(refuse), refuse);
  }
  for (const accepte of [BON, 'Palabre-Jury-2026', 'baobab-de-koudougou-7', 'tout-nouveau-secret', '7 chèvres au marché', 'xK9#mQ2$vL']) {
    assert.ok(!tropCourant(accepte), accepte);
  }
});

test('contient le prénom, le nom ou l\'identifiant : avec ou sans accent, majuscule ou tiret', () => {
  assert.ok(contientLeNom('zenabou-koala-91', ['Zénabou', 'Sawadogo']));
  assert.ok(contientLeNom('Rouge_SAWADOGO_77', ['Zénabou', 'Sawadogo']));
  assert.ok(contientLeNom('xx-zenabousawadogo-xx', ['zenabou-sawadogo']));
  assert.ok(contientLeNom('mon-zenabou-9', ['zenabou-sawadogo']), 'un morceau de l\'identifiant suffit');
  assert.ok(!contientLeNom(BON, ['Zénabou', 'Sawadogo', 'zenabou-sawadogo']));
  assert.ok(!contientLeNom('alambic-rouge-12', ['Al', 'Ba']), 'moins de 3 lettres : pas comparé');
});

test('inscription : mot de passe court, courant ou contenant le nom refusé, avec l\'erreur sous le champ', async () => {
  const refus = async (motDePasse, code, prenom = 'Rasmata') => {
    const r = await inscription(`refus-${numero}`, motDePasse, prenom, 'Kaboré');
    assert.deepEqual([r.statut, r.corps.champ, r.corps.code], [400, 'motDePasse', code], motDePasse);
  };
  await refus('court', 'le-mot-de-passe-doit-faire-au-moins-8-caracteres');
  for (const courant of ['12345678', 'Azerty123', 'motdepasse', 'Burkina2026!', 'Pàssword1']) await refus(courant, 'mot-de-passe-trop-courant');
  for (const proche of ['rasmata-koala-91', 'Soleil-KABORE-2026', 'xxrasmataxx77']) await refus(proche, 'mot-de-passe-contient-le-nom');
  const { rows } = await pool.query('SELECT 1 FROM utilisateurs WHERE email LIKE $1', [`mdp-refus-%-${suffixe}@palabre.test`]);
  assert.equal(rows.length, 0, 'aucun compte créé');
  // En anglais, le message est traduit et le code reste le même.
  const r = await fetch(`${base}/api/auth/inscription`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: 'langue=en', 'X-Forwarded-For': '10.41.0.1' }, body: JSON.stringify({ type: 'client', prenom: 'Rasmata', nomFamille: 'Kaboré', email: adresse('refus-en'), motDePasse: 'azerty123', pays: 'Burkina Faso', ville: 'Koudougou', whatsapp: '+22670000009', jeton: jetonAncien() }) });
  assert.match((await r.json()).erreur, /too common/);
});

test('changer ou réinitialiser son mot de passe : les mêmes règles, avec l\'identifiant en plus', async () => {
  const { cookie, identifiant } = membres.zenabou;
  const changer = (nouveau) => appel('/api/parametres/mot-de-passe', { methode: 'PUT', cookie, donnees: { ancien: BON, nouveau } });
  assert.match((await changer('qwerty123')).corps.erreur, /trop courant/);
  assert.match((await changer('zenabou-koala-91')).corps.erreur, /ni ton prénom/);
  assert.match((await changer(`${identifiant}-91`)).corps.erreur, /ni ton prénom/);
  assert.equal((await connexion('zenabou')).statut, 200, 'le mot de passe n\'a pas changé');

  await appel('/api/auth/mot-de-passe-oublie', { methode: 'POST', donnees: { email: adresse('zenabou') } });
  const jeton = /jeton=([0-9a-f]{64})/.exec(emailsEnvoyes.filter((m) => m.a === adresse('zenabou')).pop().texte)[1];
  const reinitialiser = (motDePasse) => appel('/api/auth/reinitialiser', { methode: 'POST', donnees: { jeton, motDePasse } });
  assert.match((await reinitialiser('motdepasse')).corps.erreur, /trop courant/);
  assert.match((await reinitialiser('ZENABOU_2026_ok')).corps.erreur, /ni ton prénom/);
  // Un refus ne consomme pas le lien : un bon mot de passe passe ensuite.
  assert.equal((await reinitialiser('calebasse-pleine-63')).statut, 200);
});

test('10 mots de passe faux en 15 minutes : compte verrouillé, même réponse qu\'un mot de passe faux, email au propriétaire', async () => {
  const inconnu = await appel('/api/auth/connexion', { methode: 'POST', donnees: { email: `personne-${suffixe}@palabre.test`, motDePasse: 'peu-importe-12' } });
  assert.deepEqual([inconnu.statut, inconnu.corps], [401, { erreur: 'Email ou mot de passe incorrect.', code: 'email-ou-mot-de-passe-incorrect' }]);

  // Neuf essais faux, chacun depuis une adresse IP différente : pas encore de verrou.
  for (let essai = 1; essai <= 9; essai += 1) assert.deepEqual((await connexion('awa', `faux-essai-${essai}`)).corps, inconnu.corps);
  assert.equal((await compte('awa')).echecs_connexion, 9);
  assert.equal((await compte('awa')).connexion_bloquee_jusqu_a, null);
  assert.equal(emailsEssais('awa').length, 0);
  // Le dixième ferme le compte.
  assert.deepEqual((await connexion('awa', 'faux-essai-10')).corps, inconnu.corps);
  const verrou = (await compte('awa')).connexion_bloquee_jusqu_a;
  assert.ok(Math.abs(new Date(verrou).getTime() - Date.now() - 15 * 60000) < 30000, 'verrou de 15 minutes');

  // Même le BON mot de passe est refusé, avec exactement la réponse d'un compte qui n'existe pas.
  const bon = await connexion('awa');
  assert.deepEqual([bon.statut, bon.corps, bon.cookie], [401, inconnu.corps, undefined]);
  // Les essais suivants ne rallongent pas le verrou et n'envoient pas d'autre email.
  await connexion('awa', 'faux-essai-11');
  assert.equal(new Date((await compte('awa')).connexion_bloquee_jusqu_a).getTime(), new Date(verrou).getTime());

  // Le propriétaire est prévenu, une seule fois, avec un lien vers le choix d'un nouveau mot de passe.
  const emails = emailsEssais('awa');
  assert.equal(emails.length, 1);
  assert.equal(emails[0].sujet, 'Quelqu\'un essaie de se connecter à ton compte Palabre');
  assert.match(emails[0].texte, /10 mots de passe faux/);
  assert.match(emails[0].texte, /15 minutes/);
  assert.match(emails[0].texte, /\/mot-de-passe-oublie/);
  assert.ok(!/\d+\.\d+\.\d+\.\d+/.test(emails[0].texte + emails[0].html), 'pas d\'adresse IP');
  // Dix essais sur une adresse sans compte : même réponse, aucun email à personne.
  const avant = emailsEnvoyes.length;
  for (let essai = 0; essai < 10; essai += 1) await appel('/api/auth/connexion', { methode: 'POST', donnees: { email: `personne-${suffixe}@palabre.test`, motDePasse: `faux-${essai}-faux` } });
  assert.equal(emailsEnvoyes.length, avant);
});

test('le verrou ne bloque pas la réinitialisation, qui rouvre le compte tout de suite', async () => {
  assert.equal((await connexion('awa')).statut, 401, 'toujours verrouillé');
  const demande = await appel('/api/auth/mot-de-passe-oublie', { methode: 'POST', donnees: { email: adresse('awa') } });
  assert.equal(demande.statut, 200);
  const jeton = /reinitialiser\?jeton=([0-9a-f]{64})/.exec(emailsEnvoyes.filter((m) => m.a === adresse('awa') && /reinitialiser\?jeton=/.test(m.texte)).pop().texte)[1];
  assert.equal((await appel('/api/auth/reinitialiser', { methode: 'POST', donnees: { jeton, motDePasse: 'fromager-geant-27' } })).statut, 200);
  assert.deepEqual({ ...(await compte('awa')) }, { echecs_connexion: 0, echecs_depuis: null, connexion_bloquee_jusqu_a: null });
  assert.equal((await connexion('awa', 'fromager-geant-27')).statut, 200);
});

test('le verrou tombe tout seul après 15 minutes ; une bonne connexion remet le compteur à zéro', async () => {
  for (let essai = 0; essai < 10; essai += 1) await connexion('bintou', `faux-${essai}-faux`);
  assert.equal((await connexion('bintou')).statut, 401);
  // Seize minutes plus tard (on recule la date en base au lieu d'attendre).
  await pool.query('UPDATE utilisateurs SET connexion_bloquee_jusqu_a = now() - interval \'1 minute\' WHERE id = $1', [membres.bintou.id]);
  assert.equal((await connexion('bintou')).statut, 200);
  assert.deepEqual({ ...(await compte('bintou')) }, { echecs_connexion: 0, echecs_depuis: null, connexion_bloquee_jusqu_a: null });

  // Cinq erreurs, une bonne connexion, puis neuf erreurs : jamais dix à la suite, donc pas de verrou.
  for (let essai = 0; essai < 5; essai += 1) await connexion('cheick', `faux-${essai}-faux`);
  assert.equal((await connexion('cheick')).statut, 200);
  assert.equal((await compte('cheick')).echecs_connexion, 0);
  for (let essai = 0; essai < 9; essai += 1) await connexion('cheick', `faux-${essai}-faux`);
  assert.equal((await connexion('cheick')).statut, 200);
  assert.equal(emailsEssais('cheick').length, 0);
});

test('les 15 minutes sont une fenêtre : des erreurs anciennes ne comptent plus', async () => {
  for (let essai = 0; essai < 9; essai += 1) await connexion('drissa', `faux-${essai}-faux`);
  // Les neuf erreurs datent maintenant de 20 minutes.
  await pool.query('UPDATE utilisateurs SET echecs_depuis = now() - interval \'20 minutes\' WHERE id = $1', [membres.drissa.id]);
  await connexion('drissa', 'encore-un-faux');
  const etat = await compte('drissa');
  assert.equal(etat.echecs_connexion, 1, 'le compte repart de 1');
  assert.equal(etat.connexion_bloquee_jusqu_a, null);
  assert.equal((await connexion('drissa')).statut, 200);
});

test('dix essais envoyés au même instant sont bien comptés dix fois', async () => {
  await pool.query('UPDATE utilisateurs SET echecs_connexion = 0, echecs_depuis = NULL, connexion_bloquee_jusqu_a = NULL WHERE id = $1', [membres.drissa.id]);
  await Promise.all(Array.from({ length: 10 }, (_, essai) => connexion('drissa', `rafale-${essai}-faux`)));
  assert.ok((await compte('drissa')).connexion_bloquee_jusqu_a, 'verrouillé');
  assert.equal((await connexion('drissa')).statut, 401);
  assert.equal(emailsEssais('drissa').length, 1);
});
