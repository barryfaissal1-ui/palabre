// Tests des corrections de la relecture de sécurité (docs/AUDIT-SECURITE.md) : un test par correction.
const test = require('node:test');
const assert = require('node:assert/strict');
const { creerApp } = require('../src/app');
const { migrer } = require('../src/db/migrate');
const { pool } = require('../src/db/pool');
const { avecComptesPrets, emailsEnvoyes } = require('./aide');

let serveur;
let base;
const suffixe = Date.now();
const lettres = String(suffixe).replace(/\d/g, (chiffre) => 'abcdefghij'[chiffre]);
const membres = {}; // awa, bintou, cheick (devs), kadi (cliente)
const JPEG_1PX = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

async function appelBrut(chemin, { methode = 'GET', donnees, qui, cookie } = {}) {
  const headers = {};
  if (donnees) headers['Content-Type'] = 'application/json';
  if (qui) headers.Cookie = membres[qui].cookie;
  if (cookie) headers.Cookie = cookie;
  const r = await fetch(`${base}${chemin}`, { method: methode, headers, body: donnees ? JSON.stringify(donnees) : undefined });
  const texte = await r.text();
  let corps;
  try { corps = JSON.parse(texte); } catch { corps = texte; }
  return { statut: r.status, corps, entetes: r.headers };
}
const appel = avecComptesPrets(appelBrut);
const poster = (qui, chemin, donnees = {}) => appel(chemin, { methode: 'POST', qui, donnees });
const DEMANDE = { titre: 'Site pour mon restaurant', description: 'Je veux un site avec le menu, les horaires et la commande par WhatsApp.', budgetFcfa: 250000, delai: '3 semaines', categorie: 'site-web' };
const PROPOSITION = { message: 'Bonjour, je peux réaliser ce projet dans les délais.', montantFcfa: 200000 };

test.before(async () => {
  await migrer();
  serveur = creerApp().listen(0);
  base = `http://localhost:${serveur.address().port}`;
  for (const [cle, type] of Object.entries({ awa: 'dev', bintou: 'dev', cheick: 'dev', kadi: 'client' })) {
    const email = `secu-${cle}-${suffixe}@palabre.test`;
    const r = await appel('/api/auth/inscription', { methode: 'POST', donnees: { type, prenom: cle, nomFamille: `Secu${lettres}`, email, motDePasse: 'motdepasse1', pays: 'Burkina Faso', ville: 'Koudougou' } });
    assert.equal(r.statut, 201);
    membres[cle] = { cookie: r.entetes.get('set-cookie').split(';')[0], identifiant: r.corps.utilisateur.identifiant, email };
  }
  await poster('awa', '/api/amis/demandes', { identifiant: membres.bintou.identifiant });
  await poster('bintou', `/api/amis/demandes/${membres.awa.identifiant}/accepter`);
});

test.after(async () => {
  await pool.query('DELETE FROM utilisateurs WHERE email = ANY($1)', [Object.values(membres).map((m) => m.email)]);
  serveur.close();
  await pool.end();
});

test('photo d\'un message privé : visible des deux membres de la conversation, de personne d\'autre', async () => {
  const envoi = await poster('awa', `/api/messages/avec/${membres.bintou.identifiant}`, { texte: 'Regarde ce croquis.', image: JPEG_1PX });
  assert.equal(envoi.statut, 201);
  const photo = envoi.corps.message.image;
  const lire = (options) => fetch(`${base}${photo}`, options);
  const avec = (qui) => ({ headers: { Cookie: membres[qui].cookie } });

  for (const qui of ['awa', 'bintou']) {
    const r = await lire(avec(qui));
    assert.equal(r.status, 200, qui);
    assert.equal(r.headers.get('content-type'), 'image/jpeg');
    assert.match(r.headers.get('cache-control'), /^private,/, 'jamais dans un cache partagé');
  }
  // Un visiteur, un autre membre, un cookie fantaisiste : la photo « n'existe pas ».
  assert.equal((await lire()).status, 404, 'visiteur');
  assert.equal((await lire(avec('cheick'))).status, 404, 'membre étranger à la conversation');
  assert.equal((await lire(avec('kadi'))).status, 404);
  assert.equal((await lire({ headers: { Cookie: 'palabre_session=nimporte.quoi.ici' } })).status, 404);
  // Message masqué par un administrateur : sa photo ne sort plus, même pour les deux membres.
  await pool.query('UPDATE messages SET masque = TRUE WHERE id = $1', [envoi.corps.message.id]);
  assert.equal((await lire(avec('awa'))).status, 404);

  // Les images publiques (photo de profil, publication) restent ouvertes à tous, avec leur cache d'un an.
  const avatar = (await poster('awa', '/api/profils/moi/avatar', { image: JPEG_1PX })).corps.avatar;
  const publique = await fetch(`${base}${avatar}`);
  assert.equal(publique.status, 200);
  assert.equal(publique.headers.get('cache-control'), 'public, max-age=31536000, immutable');
});

test('mot de passe réinitialisé : les sessions ouvertes avec l\'ancien sont fermées', async () => {
  const ancienne = membres.cheick.cookie;
  assert.ok((await appel('/api/auth/moi', { cookie: ancienne })).corps.utilisateur);
  await new Promise((r) => setTimeout(r, 2100)); // la date d'ouverture d'une session est notée à la seconde près
  await appel('/api/auth/mot-de-passe-oublie', { methode: 'POST', donnees: { email: membres.cheick.email } });
  const jeton = /jeton=([0-9a-f]+)/.exec(emailsEnvoyes.filter((m) => m.a === membres.cheick.email).pop().texte)[1];
  assert.equal((await appel('/api/auth/reinitialiser', { methode: 'POST', donnees: { jeton, motDePasse: 'tout-nouveau-secret' } })).statut, 200);

  // L'ancienne session ne vaut plus rien : ni pour lire, ni pour écrire.
  assert.equal((await appel('/api/auth/moi', { cookie: ancienne })).corps.utilisateur, null);
  assert.equal((await appel('/api/publications', { cookie: ancienne })).statut, 401);
  assert.equal((await appel('/api/publications', { methode: 'POST', cookie: ancienne, donnees: { type: 'idee', texte: 'Je ne devrais plus pouvoir écrire.' } })).statut, 401);
  // L'ancien mot de passe non plus ; le nouveau ouvre une session qui, elle, fonctionne.
  assert.equal((await appel('/api/auth/connexion', { methode: 'POST', donnees: { email: membres.cheick.email, motDePasse: 'motdepasse1' } })).statut, 401);
  const connexion = await appel('/api/auth/connexion', { methode: 'POST', donnees: { email: membres.cheick.email, motDePasse: 'tout-nouveau-secret' } });
  assert.equal(connexion.statut, 200);
  membres.cheick.cookie = connexion.entetes.get('set-cookie').split(';')[0];
  assert.equal((await appel('/api/publications', { qui: 'cheick' })).statut, 200);
  // Les sessions des autres membres ne sont pas touchées.
  assert.ok((await appel('/api/auth/moi', { qui: 'awa' })).corps.utilisateur);
});

test('proposition d\'un compte bloqué : ni montrée au client, ni choisissable', async () => {
  const demande = (await poster('kadi', '/api/demandes', DEMANDE)).corps.demande;
  assert.equal((await poster('awa', `/api/demandes/${demande.id}/propositions`, PROPOSITION)).statut, 201);
  assert.equal((await poster('bintou', `/api/demandes/${demande.id}/propositions`, PROPOSITION)).statut, 201);
  const propositions = async () => (await appel(`/api/demandes/${demande.id}`, { qui: 'kadi' })).corps.propositions;
  const deBintou = (await propositions()).find((p) => p.auteur.identifiant === membres.bintou.identifiant);
  assert.ok(deBintou);

  await pool.query('UPDATE utilisateurs SET bloque = TRUE WHERE email = $1', [membres.bintou.email]);
  try {
    assert.deepEqual((await propositions()).map((p) => p.auteur.identifiant), [membres.awa.identifiant]);
    const choix = await poster('kadi', `/api/demandes/${demande.id}/choisir`, { propositionId: deBintou.id });
    assert.equal(choix.statut, 404);
    assert.equal((await appel(`/api/demandes/${demande.id}`, { qui: 'kadi' })).corps.demande.statut, 'ouverte', 'rien n\'a été attribué');
  } finally {
    await pool.query('UPDATE utilisateurs SET bloque = FALSE WHERE email = $1', [membres.bintou.email]);
  }
  membres.kadi.demande = demande.id;
  membres.kadi.propositionAwa = (await propositions()).find((p) => p.auteur.identifiant === membres.awa.identifiant).id;
});

test('avis : le titre d\'une demande masquée par un administrateur ne ressort pas sur le profil', async () => {
  const { demande, propositionAwa } = membres.kadi;
  assert.equal((await poster('kadi', `/api/demandes/${demande}/choisir`, { propositionId: propositionAwa })).statut, 200);
  assert.equal((await poster('kadi', `/api/demandes/${demande}/terminer`)).statut, 200);
  assert.equal((await poster('kadi', '/api/avis', { demandeId: demande, identifiant: membres.awa.identifiant, note: 5, commentaire: 'Travail soigné.' })).statut, 201);
  const avis = async () => (await appel(`/api/profils/${membres.awa.identifiant}`)).corps.profil.avis;
  assert.equal((await avis())[0].titreDemande, DEMANDE.titre);
  await pool.query('UPDATE demandes SET masque = TRUE WHERE id = $1', [demande]);
  const apres = await avis();
  assert.equal(apres.length, 1, 'l\'avis reste : le travail a bien été fait');
  assert.equal(apres[0].titreDemande, null);
  assert.ok(!JSON.stringify(apres).includes(DEMANDE.titre));
});

test('adresse mal écrite : une erreur de la demande (400 ou 404), jamais une erreur du serveur', async () => {
  const api = await appel('/api/profils/%E0%A4%A');
  assert.equal(api.statut, 400);
  assert.equal(api.corps.erreur, 'Adresse illisible.');
  const page = await fetch(`${base}/%E0%A4%A`);
  assert.equal(page.status, 404);
  assert.match(await page.text(), /Cette page n'existe pas/);
  assert.equal((await fetch(`${base}/fichiers/%E0%A4%A`)).status, 404);
});

test('j\'aime : limité comme les autres écritures', async () => {
  const publication = (await poster('awa', '/api/publications', { type: 'idee', texte: 'Une idée à aimer.' })).corps.publication;
  let dernier;
  for (let i = 0; i < 301; i += 1) {
    dernier = await appel(`/api/publications/${publication.id}/jaime`, { methode: i % 2 ? 'DELETE' : 'POST', qui: 'bintou', donnees: {} });
    if (dernier.statut !== 200) break;
  }
  assert.equal(dernier.statut, 429);
  assert.match(dernier.corps.erreur, /j'aime/);
  // La limite est par membre : un autre membre aime sans souci.
  assert.equal((await poster('awa', `/api/publications/${publication.id}/jaime`)).statut, 200);
});

test('lecture des profils : limitée par membre (protège les numéros WhatsApp)', async () => {
  let dernier;
  let lus = 0;
  for (; lus < 151; lus += 1) {
    dernier = await appel(`/api/profils/${membres.awa.identifiant}`, { qui: 'kadi' });
    if (dernier.statut !== 200) break;
  }
  assert.equal(lus, 150);
  assert.equal(dernier.statut, 429);
  assert.match(dernier.corps.erreur, /beaucoup de profils/);
  assert.equal((await appel(`/api/profils/${membres.awa.identifiant}`, { qui: 'bintou' })).statut, 200, 'les autres membres ne sont pas touchés');
});

// En dernier : après ce test, les visiteurs de cette adresse IP sont limités pendant une minute.
test('visiteurs : 300 appels par minute à l\'API, les membres connectés ne sont pas concernés', async () => {
  let dernier;
  let faits = 0;
  for (; faits < 320; faits += 1) {
    dernier = await appelBrut('/api/pays');
    if (dernier.statut !== 200) break;
  }
  assert.equal(dernier.statut, 429);
  assert.ok(faits <= 300 && faits > 250, `refus après ${faits} appels`);
  assert.equal((await appel('/api/pays', { qui: 'awa' })).statut, 200);
  // Les pages et les fichiers du site ne sont pas concernés par cette limite.
  assert.equal((await fetch(`${base}/`)).status, 200);
});
