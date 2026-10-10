// Tests des conversations de groupe : le groupe d'une équipe éclair suit la vie de l'équipe.
// (Les conversations privées gardent leurs règles : tests/messages.test.js, inchangé, doit continuer à passer.)
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
const membres = {}; // awa (cheffe), bintou, cheick (invités), dao (hors équipe), kadi (cliente)
const nom = (cle) => `${cle} Groupe${lettres}`;
const JPEG_1PX = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
const DEMANDE = { titre: 'Application de livraison pour un restaurant', description: 'Les clients commandent, le livreur suit sa tournée, le gérant voit les paiements.', budgetFcfa: 900000, delai: '2 mois', categorie: 'appli-mobile' };

async function appelBrut(chemin, { methode = 'GET', donnees, qui } = {}) {
  const headers = {};
  if (donnees) headers['Content-Type'] = 'application/json';
  if (qui) headers.Cookie = membres[qui].cookie;
  const r = await fetch(`${base}${chemin}`, { method: methode, headers, body: donnees ? JSON.stringify(donnees) : undefined });
  const texte = await r.text();
  let corps;
  try { corps = JSON.parse(texte); } catch { corps = texte; }
  return { statut: r.status, corps, entetes: r.headers };
}
const appel = avecComptesPrets(appelBrut);
const poster = (qui, chemin, donnees = {}) => appel(chemin, { methode: 'POST', qui, donnees });
const groupe = (qui, id) => appel(`/api/messages/groupes/${id}`, { qui });
const ecrire = (qui, id, texte, extra = {}) => poster(qui, `/api/messages/groupes/${id}`, { texte, ...extra });
const liste = async (qui) => (await appel('/api/messages/conversations', { qui })).corps;
const notifications = async (qui, groupeId) => (await pool.query(
  'SELECT texte, nombre, lien, lue FROM notifications WHERE utilisateur_id = $1 AND type = \'message\' AND cible_id = $2 ORDER BY id DESC', [membres[qui].id, groupeId],
)).rows;

// Une demande de Kadi, et l'équipe d'Awa qui invite « invites ». Renvoie { demandeId, equipeId, groupeId, propositionId }.
async function equipe(invites) {
  const demandeId = (await poster('kadi', '/api/demandes', DEMANDE)).corps.demande.id;
  const r = await poster('awa', `/api/demandes/${demandeId}/equipes`, {
    message: 'À plusieurs, nous livrons en six semaines.', montantFcfa: 850000, roleChef: 'Serveur et paiement',
    membres: invites.map((cle) => ({ identifiant: membres[cle].identifiant, role: `Rôle de ${cle}` })),
  });
  assert.equal(r.statut, 201, JSON.stringify(r.corps));
  const proposition = r.corps.propositions.find((p) => p.equipe);
  return { demandeId, equipeId: proposition.equipe.id, groupeId: proposition.equipe.groupeId, propositionId: proposition.id };
}

let e1; // l'équipe principale des tests

test.before(async () => {
  await migrer();
  serveur = creerApp().listen(0);
  base = `http://localhost:${serveur.address().port}`;
  for (const [cle, type] of Object.entries({ awa: 'dev', bintou: 'dev', cheick: 'dev', dao: 'dev', kadi: 'client' })) {
    const email = `groupe-${cle}-${suffixe}@palabre.test`;
    const r = await appel('/api/auth/inscription', { methode: 'POST', donnees: { type, prenom: cle, nomFamille: `Groupe${lettres}`, email, motDePasse: 'motdepasse1', pays: 'Burkina Faso', ville: 'Koudougou' } });
    assert.equal(r.statut, 201);
    const { rows } = await pool.query('SELECT id FROM utilisateurs WHERE email = $1', [email]);
    membres[cle] = { cookie: r.entetes.get('set-cookie').split(';')[0], identifiant: r.corps.utilisateur.identifiant, id: rows[0].id };
  }
  for (const ami of ['bintou', 'cheick']) {
    await poster('awa', '/api/amis/demandes', { identifiant: membres[ami].identifiant });
    await poster(ami, `/api/amis/demandes/${membres.awa.identifiant}/accepter`);
  }
});

test.after(async () => {
  await pool.query('DELETE FROM utilisateurs WHERE email LIKE $1', [`groupe-%-${suffixe}@palabre.test`]);
  await new Promise((fini) => serveur.close(fini));
  await pool.end();
});

test('le groupe naît avec l\'équipe : la cheffe en est l\'administratrice, les invités n\'y sont pas encore', async () => {
  e1 = await equipe(['bintou', 'cheick']);
  assert.ok(e1.groupeId, 'la cheffe reçoit le numéro du groupe avec sa proposition');
  const { statut, corps } = await groupe('awa', e1.groupeId);
  assert.equal(statut, 200);
  assert.equal(corps.groupe.titre, `Équipe : ${DEMANDE.titre}`);
  assert.equal(corps.groupe.jeSuisChef, true);
  assert.deepEqual(corps.groupe.membres.map((m) => [m.identifiant, m.chef, m.roleEquipe]), [[membres.awa.identifiant, true, 'Serveur et paiement']]);
  assert.deepEqual(corps.messages.map((m) => [m.systeme, m.texte]), [[true, `${nom('awa')} a créé l'équipe.`]]);
  assert.deepEqual(corps.groupe.demande, { id: e1.demandeId, titre: DEMANDE.titre });
  // Invités qui n'ont pas répondu, membre extérieur, cliente : pour eux le groupe n'existe pas. Visiteur : 401.
  for (const qui of ['bintou', 'cheick', 'dao', 'kadi']) assert.equal((await groupe(qui, e1.groupeId)).statut, 404, qui);
  assert.equal((await appelBrut(`/api/messages/groupes/${e1.groupeId}`)).statut, 401);
  assert.equal((await groupe('awa', 999999999)).statut, 404);
});

test('accepter fait entrer dans le groupe, refuser non', async () => {
  assert.ok([200, 201].includes((await poster('bintou', `/api/equipes/${e1.equipeId}/accepter`)).statut));
  assert.equal((await groupe('bintou', e1.groupeId)).statut, 200);
  await poster('cheick', `/api/equipes/${e1.equipeId}/refuser`);
  assert.equal((await groupe('cheick', e1.groupeId)).statut, 404, 'celui qui refuse n\'entre pas');
  const { corps } = await groupe('bintou', e1.groupeId);
  assert.deepEqual(corps.groupe.membres.map((m) => [m.identifiant, m.chef, m.estMoi, m.roleEquipe]), [
    [membres.awa.identifiant, true, false, 'Serveur et paiement'], [membres.bintou.identifiant, false, true, 'Rôle de bintou'],
  ]);
  assert.equal(corps.groupe.jeSuisChef, false);
  assert.equal(corps.messages[corps.messages.length - 1].texte, `${nom('bintou')} a rejoint l'équipe.`);
  // Bintou voit maintenant « Discussion de l'équipe » sur la page de la demande ; Cheick non.
  const pourBintou = (await appel(`/api/demandes/${e1.demandeId}`, { qui: 'bintou' })).corps.propositions.find((p) => p.equipe);
  assert.equal(pourBintou.equipe.groupeId, e1.groupeId);
  assert.ok(!JSON.stringify((await appel(`/api/demandes/${e1.demandeId}`, { qui: 'dao' })).corps).includes(`"groupeId":${e1.groupeId}`));
});

test('écrire et lire : seuls les membres ; une seule notification par groupe ; la liste et la pastille suivent', async () => {
  const premier = await ecrire('awa', e1.groupeId, 'Bienvenue dans l\'équipe. Voici un message assez confidentiel.');
  assert.equal(premier.statut, 201);
  assert.equal(premier.corps.message.auteur.identifiant, membres.awa.identifiant);
  await ecrire('awa', e1.groupeId, 'On se répartit le travail demain ?');
  // Personne d'autre ne lit ni n'écrit.
  for (const qui of ['cheick', 'dao', 'kadi']) {
    assert.equal((await ecrire(qui, e1.groupeId, 'Je m\'incruste')).statut, 404, qui);
    assert.equal((await appel(`/api/messages/groupes/${e1.groupeId}/nouveaux?apres=0`, { qui })).statut, 404, qui);
  }
  assert.equal((await ecrire('bintou', e1.groupeId, '')).statut, 400);

  // Bintou : une seule notification, qui compte les messages ; rien pour celle qui écrit.
  let pourBintou = await notifications('bintou', e1.groupeId);
  assert.equal(pourBintou.length, 1);
  assert.equal(pourBintou[0].texte, `2 nouveaux messages dans « Équipe : ${DEMANDE.titre} ».`.replace(DEMANDE.titre, DEMANDE.titre.slice(0, 50 - 'Équipe : '.length - 1) + '…'));
  assert.equal(pourBintou[0].lien, `/messages/groupe/${e1.groupeId}`);
  assert.ok(!pourBintou[0].texte.includes('confidentiel'));
  assert.equal((await notifications('awa', e1.groupeId)).length, 0);

  // La liste : le groupe y est, avec son titre, ses membres et ses non lus ; les conversations privées n'ont pas bougé.
  const vue = await liste('bintou');
  const dansLaListe = vue.groupes.find((g) => g.id === e1.groupeId);
  assert.equal(dansLaListe.type, 'groupe');
  assert.equal(dansLaListe.nonLus, 2);
  assert.equal(dansLaListe.nbMembres, 2);
  assert.deepEqual(dansLaListe.membres.map((m) => m.identifiant), [membres.awa.identifiant]);
  assert.equal(dansLaListe.dernierMessage.texte, 'On se répartit le travail demain ?');
  assert.ok(vue.conversations.every((c) => c.type === 'privee'));
  assert.ok(!(await liste('dao')).groupes.some((g) => g.id === e1.groupeId));
  assert.equal((await appel('/api/messages/non-lus', { qui: 'bintou' })).corps.nonLus, 2, 'la pastille compte les groupes');

  // Lire : plus de non lus, la notification est lue ; les nouveaux messages arrivent par « nouveaux ».
  assert.equal((await poster('bintou', `/api/messages/groupes/${e1.groupeId}/lu`)).statut, 200);
  assert.equal((await appel('/api/messages/non-lus', { qui: 'bintou' })).corps.nonLus, 0);
  assert.equal((await notifications('bintou', e1.groupeId))[0].lue, true);
  const dernierId = (await groupe('bintou', e1.groupeId)).corps.messages.pop().id;
  await ecrire('awa', e1.groupeId, 'Un de plus');
  const nouveaux = (await appel(`/api/messages/groupes/${e1.groupeId}/nouveaux?apres=${dernierId}`, { qui: 'bintou' })).corps;
  assert.deepEqual(nouveaux.messages.map((m) => [m.texte, m.estMoi, m.auteur.prenom]), [['Un de plus', false, 'awa']]);
  pourBintou = await notifications('bintou', e1.groupeId);
  assert.equal(pourBintou[0].texte.startsWith(`${nom('awa')} a écrit dans «`), true);
});

test('photo dans un groupe : visible par ses membres seulement', async () => {
  const { corps } = await ecrire('bintou', e1.groupeId, 'La maquette', { image: JPEG_1PX });
  assert.match(corps.message.image, /^\/fichiers\//);
  const voir = async (qui) => (await fetch(`${base}${corps.message.image}`, { headers: qui ? { Cookie: membres[qui].cookie } : {} })).status;
  assert.equal(await voir('awa'), 200);
  assert.equal(await voir('bintou'), 200);
  assert.equal(await voir('dao'), 404);
  assert.equal(await voir('cheick'), 404);
  assert.equal(await voir(null), 404);
});

test('sourdine : plus de notification pour ce groupe, mais les messages restent comptés', async () => {
  await poster('bintou', `/api/messages/groupes/${e1.groupeId}/lu`);
  assert.equal((await poster('bintou', `/api/messages/groupes/${e1.groupeId}/sourdine`, { active: true })).corps.sourdine, true);
  assert.equal((await groupe('bintou', e1.groupeId)).corps.groupe.sourdine, true);
  const avant = (await notifications('bintou', e1.groupeId)).length;
  await ecrire('awa', e1.groupeId, 'Message pendant la sourdine');
  assert.equal((await notifications('bintou', e1.groupeId)).length, avant, 'aucune nouvelle notification');
  assert.equal((await liste('bintou')).groupes.find((g) => g.id === e1.groupeId).nonLus, 1);
  assert.equal((await poster('bintou', `/api/messages/groupes/${e1.groupeId}/sourdine`, { active: 'oui' })).statut, 400);
  await poster('bintou', `/api/messages/groupes/${e1.groupeId}/sourdine`, { active: false });
  assert.equal((await poster('dao', `/api/messages/groupes/${e1.groupeId}/sourdine`, { active: true })).statut, 404);
});

test('renommer : la cheffe seulement, et un message l\'annonce', async () => {
  const modifier = (qui, titre) => appel(`/api/messages/groupes/${e1.groupeId}`, { methode: 'PUT', qui, donnees: { titre } });
  assert.equal((await modifier('bintou', 'Mon titre')).statut, 403);
  assert.equal((await modifier('dao', 'Mon titre')).statut, 404);
  assert.equal((await modifier('awa', 'ab')).statut, 400);
  assert.equal((await modifier('awa', 'Livraison <b>resto</b>')).statut, 200);
  const { corps } = await groupe('bintou', e1.groupeId);
  assert.equal(corps.groupe.titre, 'Livraison <b>resto</b>', 'gardé tel quel : la page l\'affiche avec textContent');
  assert.equal(corps.messages[corps.messages.length - 1].texte, `${nom('awa')} a renommé le groupe : « Livraison <b>resto</b> ».`);
});

test('le client choisit l\'équipe : il entre dans le groupe', async () => {
  assert.equal((await groupe('kadi', e1.groupeId)).statut, 404, 'pas avant son choix');
  assert.equal((await poster('kadi', `/api/demandes/${e1.demandeId}/choisir`, { propositionId: e1.propositionId })).statut, 200);
  const { statut, corps } = await groupe('kadi', e1.groupeId);
  assert.equal(statut, 200);
  const moi = corps.groupe.membres.find((m) => m.estMoi);
  assert.equal(moi.estClient, true);
  assert.equal(moi.roleEquipe, null);
  assert.equal(corps.messages[corps.messages.length - 1].texte, `${nom('kadi')}, qui a publié la demande, a choisi l'équipe et rejoint le groupe.`);
  // Elle ne reçoit pas comme « non lus » les messages écrits avant son arrivée, et peut écrire.
  assert.equal((await liste('kadi')).groupes.find((g) => g.id === e1.groupeId).nonLus, 0);
  assert.equal((await ecrire('kadi', e1.groupeId, 'Bonjour à toute l\'équipe')).statut, 201);
  assert.equal((await appel(`/api/demandes/${e1.demandeId}`, { qui: 'kadi' })).corps.propositions.find((p) => p.equipe).equipe.groupeId, e1.groupeId);
});

test('quitter : avant le choix du client on quitte aussi l\'équipe ; après, seulement le groupe ; la cheffe ne quitte pas', async () => {
  // Après le choix (équipe 1) : Bintou quitte le groupe mais reste engagée dans l'équipe.
  const apres = await poster('bintou', `/api/messages/groupes/${e1.groupeId}/quitter`);
  assert.equal(apres.statut, 200);
  assert.equal(apres.corps.quitteLEquipe, false);
  assert.equal((await pool.query('SELECT statut FROM equipe_membres WHERE equipe_id = $1 AND dev_id = $2', [e1.equipeId, membres.bintou.id])).rows[0].statut, 'accepte');
  assert.equal((await groupe('bintou', e1.groupeId)).statut, 404, 'partie : elle ne lit plus rien');
  assert.equal((await ecrire('bintou', e1.groupeId, 'Encore moi')).statut, 404);
  assert.ok(!(await liste('bintou')).groupes.some((g) => g.id === e1.groupeId));
  await ecrire('awa', e1.groupeId, 'Message après le départ de Bintou');
  assert.equal((await appel('/api/messages/non-lus', { qui: 'bintou' })).corps.nonLus, 0, 'elle ne reçoit plus les nouveaux messages');
  assert.equal((await groupe('awa', e1.groupeId)).corps.messages.some((m) => m.systeme && m.texte === `${nom('bintou')} a quitté le groupe.`), true);
  assert.equal((await poster('awa', `/api/messages/groupes/${e1.groupeId}/quitter`)).statut, 400, 'la cheffe dissout, elle ne quitte pas');

  // Avant le choix (équipe 2) : quitter le groupe, c'est quitter l'équipe.
  const e2 = await equipe(['bintou']);
  await poster('bintou', `/api/equipes/${e2.equipeId}/accepter`);
  const avant = await poster('bintou', `/api/messages/groupes/${e2.groupeId}/quitter`);
  assert.equal(avant.corps.quitteLEquipe, true);
  assert.equal((await pool.query('SELECT statut FROM equipe_membres WHERE equipe_id = $1 AND dev_id = $2', [e2.equipeId, membres.bintou.id])).rows[0].statut, 'refuse');
  assert.equal((await groupe('awa', e2.groupeId)).corps.messages.pop().texte, `${nom('bintou')} a quitté l'équipe.`);

  // Équipe dissoute : le groupe est fermé. Lisible, mais plus personne n'écrit.
  assert.equal((await appel(`/api/equipes/${e2.equipeId}`, { methode: 'DELETE', qui: 'awa', donnees: {} })).statut, 200);
  const ferme = await groupe('awa', e2.groupeId);
  assert.equal(ferme.statut, 200);
  assert.equal(ferme.corps.groupe.ferme, true);
  assert.equal(ferme.corps.groupe.peutEcrire, false);
  assert.equal(ferme.corps.messages.pop().texte, 'Cette équipe a été dissoute.');
  assert.equal((await ecrire('awa', e2.groupeId, 'Y a quelqu\'un ?')).statut, 403);
  assert.equal((await liste('awa')).groupes.find((g) => g.id === e2.groupeId).ferme, true);
});

test('signaler un message de groupe : un membre le peut, un extérieur non ; les conversations privées ont leurs membres', async () => {
  const { corps } = await ecrire('kadi', e1.groupeId, 'Un message à signaler');
  const signaler = (qui) => poster(qui, '/api/signalements', { cibleType: 'message', cible: corps.message.id, motif: 'Spam ou arnaque' });
  assert.equal((await signaler('awa')).statut, 201);
  assert.equal((await signaler('dao')).statut, 404);
  assert.equal((await signaler('bintou')).statut, 404, 'partie du groupe : elle ne le voit plus');

  // Une conversation privée créée maintenant a ses deux lignes dans conversation_membres, et n'est pas un groupe.
  const prive = await poster('awa', `/api/messages/avec/${membres.bintou.identifiant}`, { texte: 'En privé' });
  const { rows } = await pool.query('SELECT membre_id, role FROM conversation_membres WHERE conversation_id = $1 ORDER BY membre_id', [prive.corps.conversationId]);
  assert.deepEqual(rows.map((r) => r.membre_id), [membres.awa.id, membres.bintou.id].sort((a, b) => a - b));
  assert.equal((await groupe('awa', prive.corps.conversationId)).statut, 404, 'une conversation privée ne s\'ouvre pas comme un groupe');
  assert.equal((await appel(`/api/messages/conversations/${e1.groupeId}`, { qui: 'awa' })).statut, 404, 'et un groupe ne s\'ouvre pas comme une conversation privée');
});
