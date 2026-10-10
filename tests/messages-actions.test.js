// Tests des réactions, des réponses et de la suppression de messages (conversations privées et groupes).
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
const membres = {}; // awa et bintou (amies), cheick (ami d'Awa, autre conversation), dao (inconnu), kadi (cliente)
const nom = (cle) => `${cle} Action${lettres}`;
const JPEG_1PX = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

async function appelBrut(chemin, { methode = 'GET', donnees, qui } = {}) {
  const headers = {};
  if (donnees) headers['Content-Type'] = 'application/json';
  if (qui) headers.Cookie = membres[qui].cookie;
  const r = await fetch(`${base}${chemin}`, { method: methode, headers, body: donnees ? JSON.stringify(donnees) : undefined });
  return { statut: r.status, corps: await r.json().catch(() => ({})), entetes: r.headers };
}
const appel = avecComptesPrets(appelBrut);
const poster = (qui, chemin, donnees = {}) => appel(chemin, { methode: 'POST', qui, donnees });
const ecrireA = (qui, a, texte, extra = {}) => poster(qui, `/api/messages/avec/${membres[a].identifiant}`, { texte, ...extra });
const reagir = (qui, id, emoji) => poster(qui, `/api/messages/message/${id}/reaction`, { emoji });
const supprimer = (qui, id, pourTous) => appel(`/api/messages/message/${id}`, { methode: 'DELETE', qui, donnees: { pourTous } });
const messages = async (qui, conversation) => (await appel(`/api/messages/conversations/${conversation}`, { qui })).corps.messages;

let conversation; // celle d'Awa et Bintou
let m1; // le premier message d'Awa

test.before(async () => {
  await migrer();
  serveur = creerApp().listen(0);
  base = `http://localhost:${serveur.address().port}`;
  for (const [cle, type] of Object.entries({ awa: 'dev', bintou: 'dev', cheick: 'dev', dao: 'dev', kadi: 'client' })) {
    const email = `action-${cle}-${suffixe}@palabre.test`;
    const r = await appel('/api/auth/inscription', { methode: 'POST', donnees: { type, prenom: cle, nomFamille: `Action${lettres}`, email, motDePasse: 'motdepasse1', pays: 'Burkina Faso', ville: 'Koudougou' } });
    assert.equal(r.statut, 201);
    membres[cle] = { cookie: r.entetes.get('set-cookie').split(';')[0], identifiant: r.corps.utilisateur.identifiant };
  }
  for (const ami of ['bintou', 'cheick']) {
    await poster('awa', '/api/amis/demandes', { identifiant: membres[ami].identifiant });
    await poster(ami, `/api/amis/demandes/${membres.awa.identifiant}/accepter`);
  }
  const premier = await ecrireA('awa', 'bintou', 'Premier message');
  conversation = premier.corps.conversationId;
  m1 = premier.corps.message.id;
});

test.after(async () => {
  await pool.query('DELETE FROM utilisateurs WHERE email LIKE $1', [`action-%-${suffixe}@palabre.test`]);
  await new Promise((fini) => serveur.close(fini));
  await pool.end();
});

test('réactions : une par personne et par message, on la change ou on l\'enlève', async () => {
  let r = await reagir('bintou', m1, '❤️');
  assert.equal(r.statut, 200);
  assert.deepEqual(r.corps.message.reactions, [{ emoji: '❤️', nombre: 1, moi: true, qui: [nom('bintou')] }]);
  // En choisir une autre remplace la première : toujours une seule réaction de Bintou.
  r = await reagir('bintou', m1, '👍');
  assert.deepEqual(r.corps.message.reactions, [{ emoji: '👍', nombre: 1, moi: true, qui: [nom('bintou')] }]);
  r = await reagir('awa', m1, '👍');
  assert.deepEqual(r.corps.message.reactions, [{ emoji: '👍', nombre: 2, moi: true, qui: [nom('bintou'), nom('awa')] }]);
  assert.equal((await pool.query('SELECT count(*)::int AS nb FROM message_reactions WHERE message_id = $1', [m1])).rows[0].nb, 2);
  // Vue par Bintou dans la conversation.
  assert.deepEqual((await messages('bintou', conversation))[0].reactions, [{ emoji: '👍', nombre: 2, moi: true, qui: [nom('bintou'), nom('awa')] }]);

  r = await appel(`/api/messages/message/${m1}/reaction`, { methode: 'DELETE', qui: 'bintou', donnees: {} });
  assert.deepEqual(r.corps.message.reactions, [{ emoji: '👍', nombre: 1, moi: false, qui: [nom('awa')] }]);

  // Seules les six réactions prévues sont acceptées ; un extérieur ne voit même pas le message.
  for (const emoji of ['🔥', 'x', '', '<script>']) assert.equal((await reagir('bintou', m1, emoji)).statut, 400, emoji);
  assert.equal((await reagir('cheick', m1, '👍')).statut, 404);
  assert.equal((await reagir('dao', m1, '👍')).statut, 404);
  assert.equal((await appelBrut(`/api/messages/message/${m1}/reaction`, { methode: 'POST', donnees: { emoji: '👍' } })).statut, 401);
  assert.equal((await reagir('awa', 999999999, '👍')).statut, 404);
});

test('une réaction posée après coup arrive aux pages ouvertes par « modifies »', async () => {
  const ouverture = (await appel(`/api/messages/conversations/${conversation}`, { qui: 'awa' })).corps;
  const calme = (await appel(`/api/messages/conversations/${conversation}/nouveaux?apres=${m1}&depuis=${encodeURIComponent(ouverture.maintenant)}`, { qui: 'awa' })).corps;
  assert.deepEqual(calme.modifies, []);
  await reagir('bintou', m1, '😂');
  const apres = (await appel(`/api/messages/conversations/${conversation}/nouveaux?apres=${m1}&depuis=${encodeURIComponent(calme.maintenant)}`, { qui: 'awa' })).corps;
  assert.deepEqual(apres.modifies.map((m) => [m.id, m.reactions.map((x) => x.emoji).sort()]), [[m1, ['👍', '😂']]]);
  assert.deepEqual(apres.messages, []);
  // Une date illisible ne casse rien.
  assert.deepEqual((await appel(`/api/messages/conversations/${conversation}/nouveaux?apres=${m1}&depuis=nimportequoi`, { qui: 'awa' })).corps.modifies, []);
});

test('répondre : la réponse porte une courte citation du message d\'origine, de la même conversation seulement', async () => {
  const reponse = await ecrireA('bintou', 'awa', 'Je réponds au premier', { reponseA: m1 });
  assert.equal(reponse.statut, 201);
  assert.deepEqual(reponse.corps.message.reponse, { id: m1, texte: 'Premier message', prenom: 'awa', image: false });
  assert.deepEqual((await messages('awa', conversation)).pop().reponse.id, m1);

  // Un message d'une AUTRE conversation ne peut pas être cité ici : la citation est ignorée, rien ne fuit.
  const ailleurs = await ecrireA('awa', 'cheick', 'Secret entre Awa et Cheick');
  const tentative = await ecrireA('bintou', 'awa', 'Je cite ce que je ne vois pas', { reponseA: ailleurs.corps.message.id });
  assert.equal(tentative.statut, 201);
  assert.equal(tentative.corps.message.reponse, null);
  for (const faux of ['abc', -1, 0, 999999999, { id: m1 }]) assert.equal((await ecrireA('bintou', 'awa', 'Citation farfelue', { reponseA: faux })).corps.message.reponse, null);
});

test('supprimer pour tout le monde : l\'auteur, pendant 15 minutes ; le texte et la photo sont effacés de la base', async () => {
  const { corps } = await ecrireA('awa', 'bintou', 'Message à effacer, avec un secret', { image: JPEG_1PX });
  const { id, image } = corps.message;
  assert.equal(corps.message.supprimable, true);
  await reagir('bintou', id, '😮');
  const citation = await ecrireA('bintou', 'awa', 'Je cite le message', { reponseA: id });
  assert.equal((await fetch(`${base}${image}`, { headers: { Cookie: membres.bintou.cookie } })).status, 200);

  assert.equal((await supprimer('bintou', id, true)).statut, 403, 'pas le message d\'une autre');
  assert.equal((await supprimer('dao', id, true)).statut, 404);
  const fait = await supprimer('awa', id, true);
  assert.equal(fait.statut, 200);
  assert.deepEqual([fait.corps.message.supprime, fait.corps.message.texte, fait.corps.message.image, fait.corps.message.reactions], [true, null, null, []]);

  // En base : plus de texte, plus de photo, plus de réaction.
  const { rows: [ligne] } = await pool.query('SELECT texte, fichier_id, supprime_le FROM messages WHERE id = $1', [id]);
  assert.equal(ligne.texte, 'Message supprimé');
  assert.equal(ligne.fichier_id, null);
  assert.ok(ligne.supprime_le);
  assert.equal((await pool.query('SELECT 1 FROM fichiers WHERE id = $1', [image.split('/').pop()])).rowCount, 0, 'la photo est supprimée, pas seulement détachée');
  assert.equal((await fetch(`${base}${image}`, { headers: { Cookie: membres.bintou.cookie } })).status, 404);
  assert.equal((await pool.query('SELECT 1 FROM message_reactions WHERE message_id = $1', [id])).rowCount, 0);

  // Chez Bintou : une bulle « supprimé », et la citation ne montre plus le texte.
  const vus = await messages('bintou', conversation);
  const bulle = vus.find((m) => m.id === id);
  assert.deepEqual([bulle.supprime, bulle.texte, bulle.supprimable], [true, null, false]);
  assert.equal(vus.find((m) => m.id === citation.corps.message.id).reponse.texte, null);
  assert.ok(!JSON.stringify(vus).includes('secret'));
  assert.equal((await reagir('bintou', id, '👍')).statut, 400, 'on ne réagit pas à un message supprimé');
  assert.equal((await supprimer('awa', id, true)).statut, 400, 'pas deux fois');

  // Après 15 minutes : plus pour tout le monde, seulement pour soi.
  const vieux = (await ecrireA('awa', 'bintou', 'Message de la veille')).corps.message.id;
  await pool.query('UPDATE messages SET cree_le = now() - interval \'16 minutes\' WHERE id = $1', [vieux]);
  assert.equal((await messages('awa', conversation)).find((m) => m.id === vieux).supprimable, false);
  const tropTard = await supprimer('awa', vieux, true);
  assert.equal(tropTard.statut, 400);
  assert.match(tropTard.corps.erreur, /15 minutes/);
  assert.equal((await pool.query('SELECT texte FROM messages WHERE id = $1', [vieux])).rows[0].texte, 'Message de la veille');
});

test('supprimer pour moi : le message disparaît de mon écran seulement', async () => {
  const id = (await ecrireA('awa', 'bintou', 'Bintou ne veut plus le voir')).corps.message.id;
  const r = await supprimer('bintou', id, false);
  assert.equal(r.statut, 200);
  assert.equal(r.corps.supprime, 'pour-moi');
  assert.ok(!(await messages('bintou', conversation)).some((m) => m.id === id));
  assert.ok((await messages('awa', conversation)).some((m) => m.id === id && m.texte === 'Bintou ne veut plus le voir'), 'Awa le garde');
  assert.equal((await reagir('bintou', id, '👍')).statut, 404, 'pour Bintou il n\'existe plus');
  assert.equal((await supprimer('bintou', id, false)).statut, 404);
});

test('dans un groupe : mêmes actions pour les membres, rien pour les autres ni dans un groupe fermé', async () => {
  const demande = (await poster('kadi', '/api/demandes', { titre: 'Site pour un restaurant', description: 'Un site avec le menu, les horaires et la commande par WhatsApp.', budgetFcfa: 250000, delai: '3 semaines', categorie: 'site-web' })).corps.demande.id;
  const equipe = (await poster('awa', `/api/demandes/${demande}/equipes`, { message: 'À deux, en trois semaines.', montantFcfa: 240000, roleChef: 'Serveur', membres: [{ identifiant: membres.bintou.identifiant, role: 'Interface' }] })).corps.propositions.find((p) => p.equipe).equipe;
  await poster('bintou', `/api/equipes/${equipe.id}/accepter`);
  const groupe = equipe.groupeId;
  const id = (await poster('awa', `/api/messages/groupes/${groupe}`, { texte: 'Message du groupe' })).corps.message.id;

  assert.deepEqual((await reagir('bintou', id, '🙏')).corps.message.reactions, [{ emoji: '🙏', nombre: 1, moi: true, qui: [nom('bintou')] }]);
  assert.equal((await reagir('cheick', id, '👍')).statut, 404);
  const reponse = await poster('bintou', `/api/messages/groupes/${groupe}`, { texte: 'Bien reçu', reponseA: id });
  assert.deepEqual(reponse.corps.message.reponse, { id, texte: 'Message du groupe', prenom: 'awa', image: false });
  assert.equal((await poster('bintou', `/api/messages/groupes/${groupe}`, { texte: 'Citation privée', reponseA: m1 })).corps.message.reponse, null);
  // Un message système ne reçoit ni réaction ni suppression pour tous.
  const systeme = (await pool.query('SELECT id FROM messages WHERE conversation_id = $1 AND systeme ORDER BY id LIMIT 1', [groupe])).rows[0].id;
  assert.equal((await reagir('awa', systeme, '👍')).statut, 400);
  assert.equal((await supprimer('awa', systeme, true)).statut, 403);
  assert.equal((await supprimer('awa', id, true)).corps.message.supprime, true);

  // Équipe dissoute : le groupe est fermé, plus de réaction.
  const autre = (await poster('awa', `/api/messages/groupes/${groupe}`, { texte: 'Avant la dissolution' })).corps.message.id;
  await appel(`/api/equipes/${equipe.id}`, { methode: 'DELETE', qui: 'awa', donnees: {} });
  assert.equal((await reagir('bintou', autre, '👍')).statut, 403);
});
