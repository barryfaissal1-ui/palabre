// Tests des appels audio et vidéo : qui peut appeler qui, la mise en relation, l'historique, les identifiants TURN.
// (Le son et l'image eux-mêmes passent d'un navigateur à l'autre, pas par le serveur : ils ne se testent pas ici.)
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { creerApp } = require('../src/app');
const config = require('../src/config');
const { migrer } = require('../src/db/migrate');
const { pool } = require('../src/db/pool');
const { serveursIce } = require('../src/routes/appels');
const { avecComptesPrets } = require('./aide');

let serveur;
let base;
const suffixe = Date.now();
const lettres = String(suffixe).replace(/\d/g, (chiffre) => 'abcdefghij'[chiffre]);
const membres = {}; // awa ; ses amis bintou, cheick, dao, elie ; fanta (inconnue) ; kadi (cliente)
const nom = (cle) => `${cle} Appel${lettres}`;

async function appelBrut(chemin, { methode = 'GET', donnees, qui } = {}) {
  const headers = {};
  if (donnees) headers['Content-Type'] = 'application/json';
  if (qui) headers.Cookie = membres[qui].cookie;
  const r = await fetch(`${base}${chemin}`, { method: methode, headers, body: donnees ? JSON.stringify(donnees) : undefined });
  return { statut: r.status, corps: await r.json().catch(() => ({})), entetes: r.headers };
}
const api = avecComptesPrets(appelBrut);
const poster = (qui, chemin, donnees = {}) => api(chemin, { methode: 'POST', qui, donnees });
const appeler = (qui, conversationId, type = 'audio') => poster(qui, '/api/messages/appels', { conversationId, type });
const action = (qui, id, quoi, donnees) => poster(qui, `/api/messages/appels/${id}/${quoi}`, donnees);
const lire = async (qui, id, apres = 0) => (await api(`/api/messages/appels/${id}?apres=${apres}`, { qui })).corps;
const entrant = async (qui) => (await api('/api/messages/appels/entrant', { qui })).corps.appel;
const conversationAvec = async (a, b) => (await poster(a, `/api/messages/avec/${membres[b].identifiant}`, { texte: 'Bonjour' })).corps.conversationId;
const historique = async (qui, conversation) => (await api(`/api/messages/conversations/${conversation}`, { qui })).corps.messages.filter((m) => m.appel).map((m) => m.appel);

let conversation; // Awa et Bintou

test.before(async () => {
  await migrer();
  serveur = creerApp().listen(0);
  base = `http://localhost:${serveur.address().port}`;
  for (const [cle, type] of Object.entries({ awa: 'dev', bintou: 'dev', cheick: 'dev', dao: 'dev', elie: 'dev', fanta: 'dev', kadi: 'client' })) {
    const email = `appel-${cle}-${suffixe}@palabre.test`;
    const r = await api('/api/auth/inscription', { methode: 'POST', donnees: { type, prenom: cle, nomFamille: `Appel${lettres}`, email, motDePasse: 'motdepasse1', pays: 'Burkina Faso', ville: 'Koudougou' } });
    assert.equal(r.statut, 201);
    const { rows } = await pool.query('SELECT id FROM utilisateurs WHERE email = $1', [email]);
    membres[cle] = { cookie: r.entetes.get('set-cookie').split(';')[0], identifiant: r.corps.utilisateur.identifiant, id: rows[0].id };
  }
  for (const ami of ['bintou', 'cheick', 'dao', 'elie']) {
    await poster('awa', '/api/amis/demandes', { identifiant: membres[ami].identifiant });
    await poster(ami, `/api/amis/demandes/${membres.awa.identifiant}/accepter`);
  }
  conversation = await conversationAvec('awa', 'bintou');
});

test.after(async () => {
  await pool.query('DELETE FROM utilisateurs WHERE email LIKE $1', [`appel-%-${suffixe}@palabre.test`]);
  await new Promise((fini) => serveur.close(fini));
  await pool.end();
});

test('serveurs ICE : STUN toujours ; TURN avec des identifiants temporaires, jamais le secret', async () => {
  const sans = (await api('/api/messages/appels/config', { qui: 'awa' })).corps;
  assert.deepEqual(sans.iceServers.map((s) => Object.keys(s).join()), ['urls'], 'sans TURN configuré : STUN seulement, et tout marche quand même');
  assert.ok(sans.iceServers[0].urls.every((u) => u.startsWith('stun:')));
  assert.equal((await appelBrut('/api/messages/appels/config')).statut, 401);

  config.appels.turnUrls = ['turns:turn.exemple.test:443?transport=tcp', 'turn:turn.exemple.test:3478'];
  config.appels.turnSecret = 'un-secret-partage-avec-coturn';
  try {
    const reponse = await api('/api/messages/appels/config', { qui: 'awa' });
    const turn = reponse.corps.iceServers[1];
    assert.deepEqual(turn.urls, config.appels.turnUrls);
    // L'identifiant : « valable jusqu'à (dans une heure) : numéro du membre ». Le mot de passe : sa signature.
    const [expire, membre] = turn.username.split(':').map(Number);
    assert.equal(membre, membres.awa.id);
    assert.ok(expire > Date.now() / 1000 + 3500 && expire <= Date.now() / 1000 + 3600);
    assert.equal(turn.credential, crypto.createHmac('sha1', 'un-secret-partage-avec-coturn').update(turn.username).digest('base64'), 'exactement ce que coturn recalcule de son côté');
    assert.ok(!JSON.stringify(reponse.corps).includes('un-secret-partage-avec-coturn'), 'le secret ne sort jamais');
    assert.equal(reponse.entetes.get('cache-control'), 'no-store');
    assert.notEqual(serveursIce(membres.bintou.id)[1].username, turn.username, 'des identifiants propres à chaque membre');
  } finally {
    config.appels.turnUrls = [];
    config.appels.turnSecret = '';
  }
});

test('qui peut appeler : ceux qui peuvent s\'écrire, jamais un inconnu ni un membre bloqué', async () => {
  // Une inconnue : sa demande de message n'est pas acceptée, elle ne peut pas appeler (et Awa non plus).
  const demande = await conversationAvec('fanta', 'awa');
  assert.equal((await appeler('fanta', demande)).statut, 403);
  assert.equal((await appeler('awa', demande)).statut, 403);
  // Quelqu'un d'extérieur à la conversation : elle « n'existe pas ».
  assert.equal((await appeler('cheick', conversation)).statut, 404);
  assert.equal((await appelBrut('/api/messages/appels', { methode: 'POST', donnees: { conversationId: conversation, type: 'audio' } })).statut, 401);
  assert.equal((await appeler('awa', 999999999)).statut, 404);
  assert.equal((await appeler('awa', conversation, 'hologramme')).statut, 400);
  // Blocage, dans un sens comme dans l'autre.
  const avecDao = await conversationAvec('awa', 'dao');
  await poster('dao', `/api/messages/blocages/${membres.awa.identifiant}`);
  assert.equal((await appeler('awa', avecDao)).statut, 404, 'bloquée par Dao : elle ne voit même plus la conversation');
  assert.equal((await appeler('dao', avecDao)).statut, 403, 'celui qui bloque ne peut pas appeler non plus');
  await api(`/api/messages/blocages/${membres.awa.identifiant}`, { methode: 'DELETE', qui: 'dao', donnees: {} });
  assert.equal(await entrant('awa'), null, 'aucune de ces tentatives n\'a fait sonner personne');
});

test('un appel de bout en bout : sonnerie, décrocher, échange technique, raccrocher, ligne dans la conversation', async () => {
  const lance = await appeler('awa', conversation, 'video');
  assert.equal(lance.statut, 201, JSON.stringify(lance.corps));
  const { id } = lance.corps.appel;
  assert.equal(lance.corps.appel.statut, 'sonne');
  assert.deepEqual(lance.corps.appel.participants.map((p) => [p.identifiant, p.etat]).sort(), [[membres.awa.identifiant, 'present'], [membres.bintou.identifiant, 'invite']].sort());

  // Ça sonne chez Bintou, sur n'importe quelle page (route de la pastille) ; pas chez Awa ni chez Cheick.
  const sonne = await entrant('bintou');
  assert.deepEqual([sonne.id, sonne.type, sonne.conversationId, sonne.groupe, sonne.appelant.identifiant], [id, 'video', conversation, false, membres.awa.identifiant]);
  assert.equal((await api('/api/messages/non-lus', { qui: 'bintou' })).corps.appel.id, id);
  assert.equal(await entrant('awa'), null);
  assert.equal(await entrant('cheick'), null);
  assert.equal((await api(`/api/messages/appels/${id}`, { qui: 'cheick' })).statut, 404, 'un extérieur ne voit pas l\'appel');
  // Tant qu'elle n'a pas décroché, Bintou ne peut rien envoyer dans l'appel.
  assert.equal((await action('bintou', id, 'signal', { pour: membres.awa.identifiant, type: 'offre', contenu: {} })).statut, 410);

  const decroche = await action('bintou', id, 'accepter');
  assert.equal(decroche.statut, 200);
  assert.equal(decroche.corps.appel.statut, 'en_cours');
  assert.equal(await entrant('bintou'), null, 'ça ne sonne plus');

  // Les messages techniques : le serveur les porte à leur destinataire, à lui seul, dans l'ordre.
  assert.equal((await action('awa', id, 'signal', { pour: membres.bintou.identifiant, type: 'offre', contenu: { sdp: 'v=0 offre' } })).statut, 201);
  assert.equal((await action('awa', id, 'signal', { pour: membres.bintou.identifiant, type: 'candidat', contenu: { candidate: 'candidate:1' } })).statut, 201);
  const pourBintou = await lire('bintou', id);
  assert.deepEqual(pourBintou.signaux.map((s) => [s.de, s.type, s.contenu]), [[membres.awa.identifiant, 'offre', { sdp: 'v=0 offre' }], [membres.awa.identifiant, 'candidat', { candidate: 'candidate:1' }]]);
  assert.deepEqual((await lire('awa', id)).signaux, [], 'celle qui envoie ne reçoit pas ses propres messages');
  assert.deepEqual((await lire('bintou', id, pourBintou.signaux[1].id)).signaux, [], '« apres » : rien n\'est relu deux fois');
  await action('bintou', id, 'signal', { pour: membres.awa.identifiant, type: 'reponse', contenu: { sdp: 'v=0 reponse' } });
  assert.deepEqual((await lire('awa', id)).signaux.map((s) => s.type), ['reponse']);
  // Refusés : un type inconnu, un destinataire hors de l'appel, un message énorme.
  assert.equal((await action('awa', id, 'signal', { pour: membres.bintou.identifiant, type: 'virus', contenu: {} })).statut, 400);
  assert.equal((await action('awa', id, 'signal', { pour: membres.cheick.identifiant, type: 'offre', contenu: {} })).statut, 404);
  assert.equal((await action('awa', id, 'signal', { pour: membres.bintou.identifiant, type: 'offre', contenu: { sdp: 'x'.repeat(21000) } })).statut, 400);
  assert.equal((await action('cheick', id, 'signal', { pour: membres.awa.identifiant, type: 'offre', contenu: {} })).statut, 404);

  // On fait durer l'appel deux minutes (en reculant son début), puis Awa raccroche.
  await pool.query('UPDATE appels SET debut_le = now() - interval \'125 seconds\' WHERE id = $1', [id]);
  assert.equal((await action('awa', id, 'raccrocher')).statut, 200);
  assert.equal((await lire('bintou', id)).appel.statut, 'termine');
  assert.equal((await pool.query('SELECT 1 FROM appel_signaux WHERE appel_id = $1', [id])).rowCount, 0, 'les messages techniques sont effacés');
  // La conversation garde une ligne : « Appel vidéo », 2 minutes, lancé par Awa.
  const [ligneAwa] = (await historique('awa', conversation)).slice(-1);
  assert.deepEqual([ligneAwa.type, ligneAwa.statut, ligneAwa.parMoi], ['video', 'termine', true]);
  assert.ok(ligneAwa.duree >= 124 && ligneAwa.duree <= 127);
  assert.equal((await historique('bintou', conversation)).pop().parMoi, false);
  assert.equal((await action('bintou', id, 'accepter')).statut, 410, 'on ne décroche pas un appel terminé');
});

test('appel manqué : sans réponse en 30 secondes, refusé, ou appelant qui raccroche avant', async () => {
  // Sans réponse : la sonnerie dure 30 secondes (on recule l'heure de l'appel).
  const un = (await appeler('awa', conversation)).corps.appel.id;
  await pool.query('UPDATE appels SET cree_le = now() - interval \'31 seconds\' WHERE id = $1', [un]);
  assert.equal(await entrant('bintou'), null, 'ça ne sonne plus');
  assert.equal((await lire('awa', un)).appel.statut, 'manque');
  assert.deepEqual((await historique('bintou', conversation)).pop().statut, 'manque');
  const { rows: cloche } = await pool.query('SELECT texte, lien FROM notifications WHERE utilisateur_id = $1 AND type = \'appel_manque\' ORDER BY id DESC', [membres.bintou.id]);
  assert.deepEqual([cloche.length, cloche[0].texte, cloche[0].lien], [1, `Appel manqué de ${nom('awa')}.`, `/messages/${conversation}`]);
  assert.equal((await pool.query('SELECT 1 FROM notifications WHERE utilisateur_id = $1 AND type = \'appel_manque\'', [membres.awa.id])).rowCount, 0, 'rien pour celle qui appelait');

  // Refusé.
  const deux = (await appeler('awa', conversation)).corps.appel.id;
  assert.equal((await action('bintou', deux, 'refuser')).statut, 200);
  assert.equal((await lire('awa', deux)).appel.statut, 'manque');
  assert.equal((await action('cheick', deux, 'refuser')).statut, 404);
  // L'appelante raccroche avant qu'on décroche.
  const trois = (await appeler('awa', conversation)).corps.appel.id;
  await action('awa', trois, 'raccrocher');
  assert.equal((await lire('bintou', trois)).appel.statut, 'manque');
  assert.equal(await entrant('bintou'), null);
  assert.equal((await historique('awa', conversation)).filter((a) => a.statut === 'manque').length, 3);
});

test('un seul appel à la fois : « Occupé », et deux appels croisés n\'en font qu\'un', async () => {
  const avecCheick = await conversationAvec('awa', 'cheick');
  const premier = (await appeler('awa', conversation)).corps.appel.id;
  await action('bintou', premier, 'accepter');
  // Awa est en appel : elle ne peut pas en lancer un autre.
  assert.equal((await appeler('awa', avecCheick)).statut, 409);
  // Cheick appelle Awa, qui est occupée : pas de sonnerie, un appel manqué pour elle.
  const occupee = await appeler('cheick', avecCheick);
  assert.equal(occupee.statut, 200);
  assert.equal(occupee.corps.occupe, true);
  assert.equal(await entrant('awa'), null);
  assert.equal((await historique('awa', avecCheick)).pop().statut, 'manque');
  // Bintou, déjà en appel avec Awa, « rappelle » dans la même conversation : on lui rend l'appel en cours.
  const croise = await appeler('bintou', conversation);
  assert.equal(croise.statut, 409, 'elle est déjà en appel');
  await action('awa', premier, 'raccrocher');

  // Deux personnes qui s'appellent au même instant : un seul appel est créé.
  const [a, b] = await Promise.all([appeler('awa', conversation), appeler('bintou', conversation)]);
  const cree = [a, b].filter((r) => r.statut === 201);
  const rejoint = [a, b].filter((r) => r.corps.existant);
  assert.equal(cree.length, 1);
  assert.equal(rejoint.length, 1);
  assert.equal(rejoint[0].corps.appel.id, cree[0].corps.appel.id);
  await action('awa', cree[0].corps.appel.id, 'raccrocher');
  await action('bintou', cree[0].corps.appel.id, 'raccrocher');
});

test('un participant qui disparaît (page fermée, réseau perdu) : l\'appel se termine tout seul', async () => {
  const id = (await appeler('awa', conversation)).corps.appel.id;
  await action('bintou', id, 'accepter');
  // Bintou ne donne plus signe de vie depuis 21 secondes.
  await pool.query('UPDATE appel_participants SET vu_le = now() - interval \'21 seconds\' WHERE appel_id = $1 AND membre_id = $2', [id, membres.bintou.id]);
  const vu = await lire('awa', id);
  assert.equal(vu.appel.statut, 'termine');
  assert.equal((await historique('awa', conversation)).pop().statut, 'termine');
});

test('appel de groupe : audio seulement, membres seulement, quatre personnes au plus', async () => {
  const demande = (await poster('kadi', '/api/demandes', { titre: 'Plateforme de cours en ligne', description: 'Des cours en vidéo, des exercices, un suivi des élèves.', budgetFcfa: 1500000, delai: '3 mois', categorie: 'site-web' })).corps.demande.id;
  const invites = ['bintou', 'cheick', 'dao', 'elie'];
  const equipe = (await poster('awa', `/api/demandes/${demande}/equipes`, { message: 'À cinq, nous livrons en trois mois.', montantFcfa: 1400000, roleChef: 'Cheffe de projet', membres: invites.map((cle) => ({ identifiant: membres[cle].identifiant, role: 'Développement' })) })).corps.propositions.find((p) => p.equipe).equipe;
  for (const cle of invites) await poster(cle, `/api/equipes/${equipe.id}/accepter`);
  const groupe = equipe.groupeId;

  assert.equal((await appeler('awa', groupe, 'video')).statut, 400, 'pas de vidéo dans un groupe');
  assert.equal((await appeler('fanta', groupe)).statut, 404, 'il faut être membre');
  const lance = await appeler('awa', groupe);
  assert.equal(lance.statut, 201);
  const { id } = lance.corps.appel;
  assert.equal(lance.corps.appel.groupe, true);
  assert.equal(lance.corps.appel.participants.length, 5);
  assert.deepEqual([(await entrant('bintou')).id, (await entrant('bintou')).groupe], [id, true]);
  assert.equal(await entrant('fanta'), null);

  // Trois décrochent : ils sont quatre. Le cinquième est refusé : l'appel est complet.
  for (const cle of ['bintou', 'cheick', 'dao']) assert.equal((await action(cle, id, 'accepter')).statut, 200, cle);
  const complet = await action('elie', id, 'accepter');
  assert.equal(complet.statut, 409);
  assert.match(complet.corps.erreur, /complet/);
  // Chacun parle à chacun : un message technique de Bintou pour Cheick n'arrive ni à Awa ni à Dao.
  await action('bintou', id, 'signal', { pour: membres.cheick.identifiant, type: 'offre', contenu: { sdp: 'bintou→cheick' } });
  assert.equal((await lire('cheick', id)).signaux.length, 1);
  assert.equal((await lire('awa', id)).signaux.length, 0);
  assert.equal((await lire('dao', id)).signaux.length, 0);
  // Un membre raccroche : les autres continuent ; une place se libère pour le cinquième.
  await action('dao', id, 'raccrocher');
  assert.equal((await lire('awa', id)).appel.statut, 'en_cours');
  assert.equal((await action('elie', id, 'accepter')).statut, 200);
  for (const cle of ['bintou', 'cheick', 'elie']) await action(cle, id, 'raccrocher');
  assert.equal((await lire('awa', id)).appel.statut, 'termine', 'seule dans l\'appel : il se termine');
});

test('limite : 20 appels lancés par heure et par membre', async () => {
  const avecElie = await conversationAvec('elie', 'awa');
  let dernier;
  for (let i = 0; i < 21; i += 1) {
    dernier = await appeler('elie', avecElie);
    if (dernier.statut === 201) await action('elie', dernier.corps.appel.id, 'raccrocher');
    if (dernier.statut === 429) break;
  }
  assert.equal(dernier.statut, 429);
  assert.match(dernier.corps.erreur, /beaucoup d'appels/);
});
