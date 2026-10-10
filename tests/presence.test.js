// Tests de la présence dans la messagerie : « écrit… », « en ligne », statut masqué, « vu par » dans un groupe.
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
const membres = {}; // awa et bintou (amies), cheick (inconnu), dao (ami d'Awa, hors conversation), kadi (cliente)

async function appelBrut(chemin, { methode = 'GET', donnees, qui } = {}) {
  const headers = {};
  if (donnees) headers['Content-Type'] = 'application/json';
  if (qui) headers.Cookie = membres[qui].cookie;
  const r = await fetch(`${base}${chemin}`, { method: methode, headers, body: donnees ? JSON.stringify(donnees) : undefined });
  return { statut: r.status, corps: await r.json().catch(() => ({})), entetes: r.headers };
}
const appel = avecComptesPrets(appelBrut);
const poster = (qui, chemin, donnees = {}) => appel(chemin, { methode: 'POST', qui, donnees });
const nouveaux = async (qui, id, groupe = false) => (await appel(`/api/messages/${groupe ? 'groupes' : 'conversations'}/${id}/nouveaux?apres=0`, { qui })).corps;
const vuLe = async (cle) => (await pool.query('SELECT vu_le FROM utilisateurs WHERE id = $1', [membres[cle].id])).rows[0].vu_le;
const attendre = (ms) => new Promise((suite) => setTimeout(suite, ms));
const cacher = (qui, masquer) => appel('/api/profils/moi/presence', { methode: 'PUT', qui, donnees: { masquer } });

let conversation;

test.before(async () => {
  await migrer();
  serveur = creerApp().listen(0);
  base = `http://localhost:${serveur.address().port}`;
  for (const [cle, type] of Object.entries({ awa: 'dev', bintou: 'dev', cheick: 'dev', dao: 'dev', kadi: 'client' })) {
    const email = `presence-${cle}-${suffixe}@palabre.test`;
    const r = await appel('/api/auth/inscription', { methode: 'POST', donnees: { type, prenom: cle, nomFamille: `Presence${lettres}`, email, motDePasse: 'motdepasse1', pays: 'Burkina Faso', ville: 'Koudougou' } });
    assert.equal(r.statut, 201);
    const { rows } = await pool.query('SELECT id FROM utilisateurs WHERE email = $1', [email]);
    membres[cle] = { cookie: r.entetes.get('set-cookie').split(';')[0], identifiant: r.corps.utilisateur.identifiant, id: rows[0].id };
  }
  for (const ami of ['bintou', 'dao']) {
    await poster('awa', '/api/amis/demandes', { identifiant: membres[ami].identifiant });
    await poster(ami, `/api/amis/demandes/${membres.awa.identifiant}/accepter`);
  }
  conversation = (await poster('awa', `/api/messages/avec/${membres.bintou.identifiant}`, { texte: 'Salut Bintou' })).corps.conversationId;
});

test.after(async () => {
  await pool.query('DELETE FROM utilisateurs WHERE email LIKE $1', [`presence-%-${suffixe}@palabre.test`]);
  await new Promise((fini) => serveur.close(fini));
  await pool.end();
});

test('« écrit… » : vu par l\'autre pendant 6 secondes, jamais par soi, effacé à l\'envoi', async () => {
  assert.deepEqual((await nouveaux('bintou', conversation)).ecrivent, []);
  assert.equal((await poster('awa', `/api/messages/conversations/${conversation}/ecrit`)).statut, 200);
  assert.deepEqual((await nouveaux('bintou', conversation)).ecrivent, ['awa']);
  assert.deepEqual((await nouveaux('awa', conversation)).ecrivent, [], 'on ne se voit pas écrire');
  // Le signal dure 6 secondes : au-delà, il s'efface tout seul (ici on avance l'horloge en base).
  const { rows: [ligne] } = await pool.query('SELECT jusqu_a - now() AS reste FROM ecritures WHERE conversation_id = $1 AND membre_id = $2', [conversation, membres.awa.id]);
  assert.ok(ligne.reste.seconds >= 4 && ligne.reste.seconds <= 6);
  await pool.query('UPDATE ecritures SET jusqu_a = now() - interval \'1 second\' WHERE conversation_id = $1', [conversation]);
  assert.deepEqual((await nouveaux('bintou', conversation)).ecrivent, []);
  // Envoyer le message arrête « écrit… » tout de suite.
  await poster('awa', `/api/messages/conversations/${conversation}/ecrit`);
  await poster('awa', `/api/messages/conversations/${conversation}`, { texte: 'Voilà, c\'est écrit' });
  assert.deepEqual((await nouveaux('bintou', conversation)).ecrivent, []);
  // Un extérieur ne peut ni signaler ni lire ; un visiteur non plus.
  assert.equal((await poster('dao', `/api/messages/conversations/${conversation}/ecrit`)).statut, 404);
  assert.equal((await appelBrut(`/api/messages/conversations/${conversation}/ecrit`, { methode: 'POST', donnees: {} })).statut, 401);
});

test('demande de message non acceptée : ni « écrit… » ni présence ne sont révélés', async () => {
  const demande = (await poster('cheick', `/api/messages/avec/${membres.awa.identifiant}`, { texte: 'Bonjour, on ne se connaît pas.' })).corps.conversationId;
  // Awa lit la demande et commence à répondre : Cheick ne doit rien en savoir tant qu'elle n'a pas accepté.
  await poster('awa', `/api/messages/conversations/${demande}/ecrit`);
  const vuParCheick = await nouveaux('cheick', demande);
  assert.deepEqual(vuParCheick.ecrivent, []);
  assert.equal(vuParCheick.presence, null);
  assert.equal((await appel(`/api/messages/conversations/${demande}`, { qui: 'cheick' })).corps.conversation.presence, null);
  assert.equal((await pool.query('SELECT 1 FROM ecritures WHERE conversation_id = $1', [demande])).rowCount, 0);
});

test('« en ligne » : noté par les requêtes du membre, au plus une fois par minute', async () => {
  await appel('/api/auth/moi', { qui: 'bintou' });
  await attendre(120);
  const premiere = await vuLe('bintou');
  assert.ok(premiere && Date.now() - premiere.getTime() < 60000);
  // D'autres requêtes dans la minute ne réécrivent pas en base.
  for (let i = 0; i < 3; i += 1) await appel('/api/auth/moi', { qui: 'bintou' });
  await attendre(120);
  assert.equal((await vuLe('bintou')).getTime(), premiere.getTime());
  // Une minute plus tard (on recule la date en base), la requête suivante la met à jour.
  await pool.query('UPDATE utilisateurs SET vu_le = now() - interval \'3 minutes\' WHERE id = $1', [membres.bintou.id]);
  await appel('/api/auth/moi', { qui: 'bintou' });
  await attendre(150);
  assert.ok(Date.now() - (await vuLe('bintou')).getTime() < 60000);
  // Un visiteur (sans session) ne fait rien planter et ne note rien pour personne.
  assert.equal((await appelBrut('/api/sante')).statut, 200);
});

test('présence de l\'autre dans la messagerie : point vert sous 5 minutes, sinon « actif il y a… »', async () => {
  let vue = (await appel(`/api/messages/conversations/${conversation}`, { qui: 'awa' })).corps.conversation.presence;
  assert.deepEqual(vue, { enLigne: true, vuLe: null });
  assert.deepEqual((await nouveaux('awa', conversation)).presence, { enLigne: true, vuLe: null });
  const liste = (await appel('/api/messages/conversations', { qui: 'awa' })).corps.conversations.find((c) => c.id === conversation);
  assert.deepEqual(liste.presence, { enLigne: true, vuLe: null });

  await pool.query('UPDATE utilisateurs SET vu_le = now() - interval \'2 hours\' WHERE id = $1', [membres.bintou.id]);
  vue = (await appel(`/api/messages/conversations/${conversation}`, { qui: 'awa' })).corps.conversation.presence;
  assert.equal(vue.enLigne, false);
  assert.ok(Math.abs(Date.now() - new Date(vue.vuLe).getTime() - 2 * 3600000) < 60000);
  // La présence ne sort que par la messagerie : pas par le profil public, la recherche ni l'aperçu d'un membre.
  for (const chemin of [`/api/profils/${membres.bintou.identifiant}`, `/api/devs?q=${membres.bintou.identifiant.slice(0, 6)}`, '/api/publications']) {
    const texte = JSON.stringify((await appel(chemin, { qui: 'awa' })).corps);
    assert.ok(!/vu_le|vuLe|enLigne|masquer_presence/.test(texte), chemin);
  }
});

test('masquer son statut : on ne montre plus le sien, et on ne voit plus celui des autres', async () => {
  await appel('/api/auth/moi', { qui: 'awa' });
  await pool.query('UPDATE utilisateurs SET vu_le = now() WHERE id = ANY($1)', [[membres.awa.id, membres.bintou.id]]);
  const presence = async (qui) => (await appel(`/api/messages/conversations/${conversation}`, { qui })).corps.conversation.presence;
  assert.ok((await presence('awa')).enLigne && (await presence('bintou')).enLigne);

  assert.deepEqual((await cacher('bintou', true)).corps, { presenceMasquee: true });
  assert.equal((await appel('/api/auth/moi', { qui: 'bintou' })).corps.utilisateur.presenceMasquee, true);
  assert.equal(await presence('awa'), null, 'Awa ne voit plus Bintou');
  assert.equal(await presence('bintou'), null, 'et Bintou ne voit plus Awa : c\'est réciproque');
  assert.equal((await nouveaux('awa', conversation)).presence, null);

  assert.equal((await cacher('bintou', 'oui')).statut, 400);
  assert.equal((await appelBrut('/api/profils/moi/presence', { methode: 'PUT', donnees: { masquer: true } })).statut, 401);
  await cacher('bintou', false);
  assert.ok((await presence('awa')).enLigne);
  assert.equal((await appel('/api/auth/moi', { qui: 'awa' })).corps.utilisateur.presenceMasquee, false, 'le réglage de Bintou ne touche pas Awa');
});

test('groupe : « écrit… » et « vu par » (jusqu\'où chacun a lu)', async () => {
  const demande = (await poster('kadi', '/api/demandes', { titre: 'Application pour un salon de coiffure', description: 'Prise de rendez-vous, rappel par SMS, paiement par Mobile Money.', budgetFcfa: 400000, delai: '1 mois', categorie: 'appli-mobile' })).corps.demande.id;
  const equipe = (await poster('awa', `/api/demandes/${demande}/equipes`, { message: 'À trois, en un mois.', montantFcfa: 380000, roleChef: 'Serveur', membres: [{ identifiant: membres.bintou.identifiant, role: 'Interface' }, { identifiant: membres.dao.identifiant, role: 'Tests' }] })).corps.propositions.find((p) => p.equipe).equipe;
  await poster('bintou', `/api/equipes/${equipe.id}/accepter`);
  await poster('dao', `/api/equipes/${equipe.id}/accepter`);
  const groupe = equipe.groupeId;
  const m1 = (await poster('awa', `/api/messages/groupes/${groupe}`, { texte: 'Premier' })).corps.message.id;
  await poster('bintou', `/api/messages/groupes/${groupe}/lu`);
  const m2 = (await poster('awa', `/api/messages/groupes/${groupe}`, { texte: 'Deuxième' })).corps.message.id;
  await poster('dao', `/api/messages/groupes/${groupe}/lu`);

  // Awa voit jusqu'où chacun a lu : Bintou s'est arrêtée au premier, Dao a tout lu. Elle-même n'est pas dans la liste.
  const lectures = Object.fromEntries((await nouveaux('awa', groupe, true)).lectures.map((l) => [l.identifiant, l.luJusqua]));
  assert.deepEqual(lectures, { [membres.bintou.identifiant]: m1, [membres.dao.identifiant]: m2 });
  const ouverture = (await appel(`/api/messages/groupes/${groupe}`, { qui: 'awa' })).corps.groupe.membres;
  assert.equal(ouverture.find((m) => m.identifiant === membres.bintou.identifiant).luJusqua, m1);
  assert.equal(ouverture.find((m) => m.estMoi).presence, null);
  assert.equal(typeof ouverture.find((m) => m.identifiant === membres.dao.identifiant).presence.enLigne, 'boolean');

  // « écrit… » dans le groupe : les deux autres le voient, celui qui écrit non, un extérieur 404.
  await poster('bintou', `/api/messages/groupes/${groupe}/ecrit`);
  await poster('dao', `/api/messages/groupes/${groupe}/ecrit`);
  assert.deepEqual((await nouveaux('awa', groupe, true)).ecrivent.sort(), ['bintou', 'dao']);
  assert.deepEqual((await nouveaux('bintou', groupe, true)).ecrivent, ['dao']);
  assert.equal((await poster('cheick', `/api/messages/groupes/${groupe}/ecrit`)).statut, 404);
});
