// Tests de la veille (GET /api/messages/veille) : les messages arrivés depuis la dernière fois, pour la carte d'arrivée.
// (L'appel qui sonne, renvoyé par la même route, est testé dans tests/appels.test.js.)
const test = require('node:test');
const assert = require('node:assert/strict');
const { creerApp } = require('../src/app');
const { migrer } = require('../src/db/migrate');
const { pool } = require('../src/db/pool');
const { avecComptesPrets } = require('./aide');

let serveur;
let base;
const suffixe = Date.now();
const lettres = String(suffixe).replace(/\d/g, (chiffre) => 'abcdefghij'[chiffre]);
const membres = {}; // awa et bintou (amies), cheick (ami d'Awa), dao (inconnu), kadi (cliente)

async function appelBrut(chemin, { methode = 'GET', donnees, qui } = {}) {
  const headers = {};
  if (donnees) headers['Content-Type'] = 'application/json';
  if (qui) headers.Cookie = membres[qui].cookie;
  const r = await fetch(`${base}${chemin}`, { method: methode, headers, body: donnees ? JSON.stringify(donnees) : undefined });
  return { statut: r.status, corps: await r.json().catch(() => ({})), entetes: r.headers };
}
const appel = avecComptesPrets(appelBrut);
const poster = (qui, chemin, donnees = {}) => appel(chemin, { methode: 'POST', qui, donnees });
const ecrireA = (qui, a, texte) => poster(qui, `/api/messages/avec/${membres[a].identifiant}`, { texte });
const veille = async (qui, apres) => (await appel(`/api/messages/veille${apres ? `?apres=${apres}` : ''}`, { qui })).corps;

test.before(async () => {
  await migrer();
  serveur = creerApp().listen(0);
  base = `http://localhost:${serveur.address().port}`;
  for (const [cle, type] of Object.entries({ awa: 'dev', bintou: 'dev', cheick: 'dev', dao: 'dev', kadi: 'client' })) {
    const email = `veille-${cle}-${suffixe}@palabre.test`;
    const r = await appel('/api/auth/inscription', { methode: 'POST', donnees: { type, prenom: cle, nomFamille: `Veille${lettres}`, email, motDePasse: 'kolatier-vert-48', pays: 'Burkina Faso', ville: 'Koudougou' } });
    assert.equal(r.statut, 201);
    membres[cle] = { cookie: r.entetes.get('set-cookie').split(';')[0], identifiant: r.corps.utilisateur.identifiant };
  }
  for (const ami of ['bintou', 'cheick']) {
    await poster('awa', '/api/amis/demandes', { identifiant: membres[ami].identifiant });
    await poster(ami, `/api/amis/demandes/${membres.awa.identifiant}/accepter`);
  }
});

test.after(async () => {
  await pool.query('DELETE FROM utilisateurs WHERE email LIKE $1', [`veille-%-${suffixe}@palabre.test`]);
  await new Promise((fini) => serveur.close(fini));
  await pool.end();
});

test('première visite : aucun message, seulement le point de départ ; visiteur refusé', async () => {
  await ecrireA('bintou', 'awa', 'Un message d\'avant la première visite');
  const depart = await veille('awa');
  assert.deepEqual(depart.messages, [], 'on n\'annonce pas les anciens messages');
  assert.ok(depart.dernier > 0);
  assert.equal(depart.appel, null);
  assert.equal((await appelBrut('/api/messages/veille')).statut, 401);
  // Un numéro farfelu est ignoré, sans erreur.
  assert.deepEqual((await veille('awa', 'abc')).messages, []);
});

test('un message reçu depuis : l\'auteur et un aperçu de 60 caractères, jamais ses propres messages', async () => {
  const { dernier } = await veille('awa');
  const long = `Voici un long message : ${'bla '.repeat(30)}et le secret est tout à la fin.`;
  const envoye = (await ecrireA('bintou', 'awa', long)).corps;
  await ecrireA('awa', 'bintou', 'Ma réponse, que je ne dois pas me voir annoncer');
  const apres = await veille('awa', dernier);
  assert.equal(apres.messages.length, 1);
  const [message] = apres.messages;
  assert.deepEqual([message.id, message.conversationId, message.groupe], [envoye.message.id, envoye.conversationId, false]);
  assert.equal(message.auteur.identifiant, membres.bintou.identifiant);
  assert.equal(message.apercu.length, 60);
  assert.ok(long.startsWith(message.apercu.slice(0, -1)) && !message.apercu.includes('secret'));
  assert.ok(apres.dernier > dernier);
  assert.ok(!JSON.stringify(apres).includes('@palabre.test'), 'jamais d\'email');
  // Relu avec le nouveau point de départ : plus rien, le message n'est annoncé qu'une fois.
  assert.deepEqual((await veille('awa', apres.dernier)).messages, []);
  // Cheick, qui n'est pas dans cette conversation, ne voit rien passer.
  assert.deepEqual((await veille('cheick', dernier)).messages, []);
});

test('pas d\'annonce pour une demande de message non acceptée, un membre bloqué, un message supprimé', async () => {
  let { dernier } = await veille('awa');
  // Dao, un inconnu : sa demande de message n'est pas annoncée par une carte.
  await ecrireA('dao', 'awa', 'Bonjour, on ne se connaît pas.');
  assert.deepEqual((await veille('awa', dernier)).messages, []);
  // Cheick écrit, puis supprime son message pour tout le monde avant qu'Awa ne regarde.
  const efface = (await ecrireA('cheick', 'awa', 'Oups, mauvais destinataire')).corps.message.id;
  await appel(`/api/messages/message/${efface}`, { methode: 'DELETE', qui: 'cheick', donnees: { pourTous: true } });
  assert.deepEqual((await veille('awa', dernier)).messages, []);
  // Awa bloque Cheick : ses messages suivants ne sont plus annoncés.
  ({ dernier } = await veille('awa'));
  await poster('awa', `/api/messages/blocages/${membres.cheick.identifiant}`);
  await pool.query('INSERT INTO messages (conversation_id, auteur_id, texte) SELECT c.id, u.id, \'Message d\'\'un bloqué\' FROM conversations c JOIN utilisateurs u ON u.identifiant = $1 WHERE u.id IN (c.membre_a, c.membre_b) AND c.type = \'privee\' LIMIT 1', [membres.cheick.identifiant]);
  assert.deepEqual((await veille('awa', dernier)).messages, []);
  await appel(`/api/messages/blocages/${membres.cheick.identifiant}`, { methode: 'DELETE', qui: 'awa', donnees: {} });
});

test('réglage « Son des messages » : activé par défaut, gardé côté serveur', async () => {
  const son = async (qui) => (await appel('/api/auth/moi', { qui })).corps.utilisateur.sonMessages;
  const regler = (qui, actif) => appel('/api/profils/moi/son-messages', { methode: 'PUT', qui, donnees: { actif } });
  assert.equal(await son('awa'), true);
  assert.deepEqual((await regler('awa', false)).corps, { sonMessages: false });
  assert.equal(await son('awa'), false);
  assert.equal(await son('bintou'), true, 'le réglage d\'Awa ne touche pas Bintou');
  assert.equal((await regler('awa', 'non')).statut, 400);
  assert.equal((await appelBrut('/api/profils/moi/son-messages', { methode: 'PUT', donnees: { actif: false } })).statut, 401);
  // Il n'efface pas les autres réglages de notifications (ceux du push), et inversement.
  await appel('/api/notifications/push/preferences', { methode: 'PUT', qui: 'awa', donnees: { messages: true, demandes: false, equipes: true, social: true, defis: true } });
  assert.equal(await son('awa'), false);
  await regler('awa', true);
  assert.equal((await appel('/api/notifications/push', { qui: 'awa' })).corps.preferences.demandes, false);
  assert.equal(await son('awa'), true);
});

test('groupe : annoncé à ses membres avec son titre, sauf s\'il est en sourdine ; vocal et photo ont leur mot', async () => {
  const demande = (await poster('kadi', '/api/demandes', { titre: 'Site pour une librairie', description: 'Un catalogue, la réservation des livres et le paiement Mobile Money.', budgetFcfa: 300000, delai: '1 mois', categorie: 'site-web' })).corps.demande.id;
  const equipe = (await poster('awa', `/api/demandes/${demande}/equipes`, { message: 'À deux, en un mois.', montantFcfa: 280000, roleChef: 'Serveur', membres: [{ identifiant: membres.bintou.identifiant, role: 'Interface' }] })).corps.propositions.find((p) => p.equipe).equipe;
  await poster('bintou', `/api/equipes/${equipe.id}/accepter`);
  const groupe = equipe.groupeId;
  let { dernier } = await veille('awa');
  await poster('bintou', `/api/messages/groupes/${groupe}`, { texte: 'Bonjour l\'équipe' });
  const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(500, 7)]).toString('base64');
  await poster('bintou', `/api/messages/groupes/${groupe}`, { vocal: { donnees: `data:audio/webm;base64,${webm}`, duree: 4 } });
  const vus = await veille('awa', dernier);
  assert.deepEqual(vus.messages.map((m) => [m.groupe, m.titre, m.auteur.prenom, m.apercu]), [
    [true, 'Équipe : Site pour une librairie', 'bintou', 'Bonjour l\'équipe'], [true, 'Équipe : Site pour une librairie', 'bintou', 'Message vocal'],
  ]);
  assert.deepEqual((await veille('cheick', dernier)).messages, [], 'pas pour quelqu\'un d\'extérieur au groupe');
  assert.deepEqual((await veille('bintou', dernier)).messages, [], 'pas pour celle qui écrit');

  // Awa met le groupe en sourdine : plus de carte pour lui.
  ({ dernier } = vus);
  await poster('awa', `/api/messages/groupes/${groupe}/sourdine`, { active: true });
  await poster('bintou', `/api/messages/groupes/${groupe}`, { texte: 'Tu m\'entends ?' });
  assert.deepEqual((await veille('awa', dernier)).messages, []);
  // Les messages système (« a rejoint l'équipe ») ne sont jamais annoncés.
  await poster('awa', `/api/messages/groupes/${groupe}/sourdine`, { active: false });
  ({ dernier } = await veille('awa'));
  await appel(`/api/messages/groupes/${groupe}`, { methode: 'PUT', qui: 'awa', donnees: { titre: 'Librairie en ligne' } });
  assert.deepEqual((await veille('bintou', dernier)).messages, []);
});
