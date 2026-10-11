// Tests des notifications : nouvelles notifications (j'aime, commentaire, message…), regroupement, jamais pour soi.
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
const membres = {}; // awa (autrice), bintou, cheick, dao, elie (devs), fanta (inconnue d'Awa)
const nom = (cle) => `${cle} Notif${lettres}`;

async function appelBrut(chemin, { methode = 'GET', donnees, qui } = {}) {
  const headers = {};
  if (donnees) headers['Content-Type'] = 'application/json';
  if (qui) headers.Cookie = membres[qui].cookie;
  const r = await fetch(`${base}${chemin}`, { method: methode, headers, body: donnees ? JSON.stringify(donnees) : undefined });
  return { statut: r.status, corps: await r.json().catch(() => ({})), entetes: r.headers };
}
const appel = avecComptesPrets(appelBrut);
const poster = (qui, chemin, donnees = {}) => appel(chemin, { methode: 'POST', qui, donnees });
const supprimer = (qui, chemin) => appel(chemin, { methode: 'DELETE', qui, donnees: {} });
// Les notifications d'un membre, d'un type donné (les plus récentes d'abord), lues en base : tout, pas une page de 10.
async function notifications(qui, type) {
  const { rows } = await pool.query(
    'SELECT n.id, n.type, n.texte, n.lien, n.lue, n.nombre, n.acteurs, n.acteur_id, n.cible_id FROM notifications n WHERE n.utilisateur_id = $1 AND ($2::text IS NULL OR n.type = $2) ORDER BY n.id DESC',
    [membres[qui].id, type || null],
  );
  return rows;
}
const publier = async (qui, texte) => (await poster(qui, '/api/publications', { type: 'idee', texte })).corps.publication.id;
async function devenirAmis(a, b) {
  await poster(a, '/api/amis/demandes', { identifiant: membres[b].identifiant });
  assert.equal((await poster(b, `/api/amis/demandes/${membres[a].identifiant}/accepter`)).statut, 200);
}

test.before(async () => {
  await migrer();
  serveur = creerApp().listen(0);
  base = `http://localhost:${serveur.address().port}`;
  for (const cle of ['awa', 'bintou', 'cheick', 'dao', 'elie', 'fanta']) {
    const email = `notif-${cle}-${suffixe}@palabre.test`;
    const r = await appel('/api/auth/inscription', { methode: 'POST', donnees: { type: 'dev', prenom: cle, nomFamille: `Notif${lettres}`, email, motDePasse: 'kolatier-vert-48', pays: 'Burkina Faso', ville: 'Koudougou' } });
    assert.equal(r.statut, 201);
    const { rows } = await pool.query('SELECT id FROM utilisateurs WHERE email = $1', [email]);
    membres[cle] = { cookie: r.entetes.get('set-cookie').split(';')[0], identifiant: r.corps.utilisateur.identifiant, id: rows[0].id, email };
  }
});

test.after(async () => {
  await pool.query('DELETE FROM utilisateurs WHERE email LIKE $1', [`notif-%-${suffixe}@palabre.test`]);
  await new Promise((fini) => serveur.close(fini));
  await pool.end();
});

test('j\'aime : regroupés en une seule notification, la dernière personne en premier', async () => {
  const id = await publier('awa', 'Publication aimée');
  await poster('bintou', `/api/publications/${id}/jaime`);
  let [notification, ...reste] = await notifications('awa', 'jaime');
  assert.equal(reste.length, 0);
  assert.equal(notification.texte, `${nom('bintou')} a aimé ta publication.`);
  assert.equal(notification.lien, `/publication/${id}`);

  await poster('cheick', `/api/publications/${id}/jaime`);
  [notification, ...reste] = await notifications('awa', 'jaime');
  assert.equal(reste.length, 0, 'toujours une seule notification');
  assert.equal(notification.texte, `${nom('cheick')} et 1 autre ont aimé ta publication.`);

  await poster('dao', `/api/publications/${id}/jaime`);
  await poster('elie', `/api/publications/${id}/jaime`);
  [notification, ...reste] = await notifications('awa', 'jaime');
  assert.equal(reste.length, 0);
  assert.equal(notification.texte, `${nom('elie')} et 3 autres ont aimé ta publication.`);
  assert.equal(notification.nombre, 4);
  assert.deepEqual(notification.acteurs, [membres.elie.id, membres.dao.id, membres.cheick.id, membres.bintou.id]);
  assert.equal(notification.acteur_id, membres.elie.id);

  // Un second clic sur « J'aime » ne compte pas deux fois.
  await poster('elie', `/api/publications/${id}/jaime`);
  assert.equal((await notifications('awa', 'jaime'))[0].nombre, 4);

  // L'API envoie la personne (pour son avatar) et le nombre ; jamais d'email.
  const { corps } = await appel('/api/notifications', { qui: 'awa' });
  const vue = corps.notifications.find((n) => n.type === 'jaime');
  assert.equal(vue.acteur.identifiant, membres.elie.identifiant);
  assert.equal(vue.nombre, 4);
  assert.ok(!JSON.stringify(corps).includes('@palabre.test'));
});

test('jamais de notification pour ses propres actions', async () => {
  const id = await publier('dao', 'Je m\'aime bien');
  await poster('dao', `/api/publications/${id}/jaime`);
  await poster('dao', `/api/publications/${id}/commentaires`, { texte: 'Je me réponds.' });
  assert.equal((await notifications('dao')).filter((n) => n.cible_id === id).length, 0);
});

test('ne plus aimer : on sort de la notification non lue ; lue, un nouveau j\'aime en crée une autre', async () => {
  const id = await publier('awa', 'Aimée puis plus aimée');
  await poster('bintou', `/api/publications/${id}/jaime`);
  await poster('cheick', `/api/publications/${id}/jaime`);
  await supprimer('cheick', `/api/publications/${id}/jaime`);
  let liste = (await notifications('awa', 'jaime')).filter((n) => n.cible_id === id);
  assert.equal(liste.length, 1);
  assert.equal(liste[0].texte, `${nom('bintou')} a aimé ta publication.`);
  assert.equal(liste[0].acteur_id, membres.bintou.id);
  await supprimer('bintou', `/api/publications/${id}/jaime`);
  assert.equal((await notifications('awa', 'jaime')).filter((n) => n.cible_id === id).length, 0, 'plus personne : la notification disparaît');

  // Une notification déjà lue n'est plus touchée : le j'aime suivant en ouvre une nouvelle.
  await poster('bintou', `/api/publications/${id}/jaime`);
  await poster('awa', '/api/notifications/lues');
  await poster('cheick', `/api/publications/${id}/jaime`);
  liste = (await notifications('awa', 'jaime')).filter((n) => n.cible_id === id);
  assert.deepEqual(liste.map((n) => [n.lue, n.nombre]), [[false, 1], [true, 1]]);
});

test('j\'aime au même instant : une seule notification, personne n\'est oublié', async () => {
  const id = await publier('awa', 'Quatre j\'aime d\'un coup');
  await Promise.all(['bintou', 'cheick', 'dao', 'elie'].map((qui) => poster(qui, `/api/publications/${id}/jaime`)));
  const liste = (await notifications('awa', 'jaime')).filter((n) => n.cible_id === id);
  assert.equal(liste.length, 1);
  assert.equal(liste[0].nombre, 4);
  assert.equal(new Set(liste[0].acteurs).size, 4);
});

test('commentaires : l\'auteur est prévenu (regroupé), ceux qui ont commenté avant aussi', async () => {
  const id = await publier('awa', 'Publication commentée');
  await poster('bintou', `/api/publications/${id}/commentaires`, { texte: 'Premier commentaire' });
  await poster('cheick', `/api/publications/${id}/commentaires`, { texte: 'Deuxième commentaire' });
  await poster('cheick', `/api/publications/${id}/commentaires`, { texte: 'Encore moi' });
  const pourAwa = (await notifications('awa', 'commentaire')).filter((n) => n.cible_id === id);
  assert.equal(pourAwa.length, 1);
  assert.equal(pourAwa[0].texte, `${nom('cheick')} et 1 autre ont commenté ta publication.`);
  assert.equal(pourAwa[0].nombre, 2, 'deux personnes, même si l\'une a écrit deux fois');

  // Bintou avait commenté avant Cheick : elle apprend que la discussion continue. Cheick n'est pas prévenu de lui-même.
  const pourBintou = (await notifications('bintou', 'reponse_commentaire')).filter((n) => n.cible_id === id);
  assert.equal(pourBintou.length, 1);
  assert.equal(pourBintou[0].texte, `${nom('cheick')} a répondu sous une publication que tu as commentée.`);
  assert.equal((await notifications('cheick', 'reponse_commentaire')).filter((n) => n.cible_id === id).length, 0);

  // L'autrice répond sous sa publication : rien pour elle, mais Bintou et Cheick sont prévenus.
  await poster('awa', `/api/publications/${id}/commentaires`, { texte: 'Merci à vous deux' });
  assert.equal((await notifications('awa', 'commentaire')).filter((n) => n.cible_id === id)[0].nombre, 2);
  assert.equal((await notifications('awa', 'reponse_commentaire')).filter((n) => n.cible_id === id).length, 0);
  assert.equal((await notifications('cheick', 'reponse_commentaire')).filter((n) => n.cible_id === id)[0].texte, `${nom('awa')} a répondu sous une publication que tu as commentée.`);
  assert.equal((await notifications('bintou', 'reponse_commentaire')).filter((n) => n.cible_id === id)[0].texte, `${nom('awa')} et 1 autre ont répondu sous une publication que tu as commentée.`);
});

test('messages : une seule notification par conversation, mise à jour tant qu\'elle n\'est pas lue', async () => {
  await devenirAmis('awa', 'bintou');
  const premier = await poster('awa', `/api/messages/avec/${membres.bintou.identifiant}`, { texte: 'Salut Bintou, un message assez confidentiel.' });
  assert.equal(premier.statut, 201);
  const conversation = premier.corps.conversationId;
  await poster('awa', `/api/messages/avec/${membres.bintou.identifiant}`, { texte: 'Deuxième message' });
  await poster('awa', `/api/messages/avec/${membres.bintou.identifiant}`, { texte: 'Troisième message' });
  let liste = await notifications('bintou', 'message');
  assert.equal(liste.length, 1, 'jamais une notification par message');
  assert.equal(liste[0].texte, `${nom('awa')} t'a envoyé 3 messages.`);
  assert.equal(liste[0].nombre, 3);
  assert.equal(liste[0].lien, `/messages/${conversation}`);
  assert.ok(!liste[0].texte.includes('confidentiel'), 'le contenu du message n\'est pas dans la cloche');
  assert.equal((await notifications('awa', 'message')).length, 0, 'rien pour celle qui écrit');

  // Bintou ouvre la conversation : la notification est lue. Le message suivant en ouvre une nouvelle.
  assert.equal((await poster('bintou', `/api/messages/conversations/${conversation}/lu`)).statut, 200);
  assert.equal((await notifications('bintou', 'message'))[0].lue, true);
  await poster('awa', `/api/messages/avec/${membres.bintou.identifiant}`, { texte: 'Un autre jour' });
  liste = await notifications('bintou', 'message');
  assert.deepEqual(liste.map((n) => [n.lue, n.texte]), [[false, `${nom('awa')} t'a envoyé un message.`], [true, `${nom('awa')} t'a envoyé 3 messages.`]]);

  // Bintou répond : c'est Awa qui est prévenue, une fois.
  await poster('bintou', `/api/messages/avec/${membres.awa.identifiant}`, { texte: 'Bien reçu' });
  assert.equal((await notifications('awa', 'message')).length, 1);
});

test('demande de message d\'une inconnue : annoncée une fois, pas à chaque message', async () => {
  await poster('fanta', `/api/messages/avec/${membres.awa.identifiant}`, { texte: 'Bonjour, on ne se connaît pas.' });
  await poster('fanta', `/api/messages/avec/${membres.awa.identifiant}`, { texte: 'Vous êtes là ?' });
  const deFanta = (await notifications('awa')).filter((n) => n.acteur_id === membres.fanta.id);
  assert.deepEqual(deFanta.map((n) => n.type), ['demande_message']);
});

test('ami accepté et demande d\'ami : la personne est jointe à la notification', async () => {
  await devenirAmis('cheick', 'dao');
  const [acceptee] = await notifications('cheick', 'ami_accepte');
  assert.equal(acceptee.texte, `${nom('dao')} a accepté ta demande d'ami.`);
  assert.equal(acceptee.acteur_id, membres.dao.id);
  const [demande] = await notifications('dao', 'demande_ami');
  assert.equal(demande.acteur_id, membres.cheick.id);
});

test('tout marquer comme lu, ou une seule ; jamais celles d\'un autre', async () => {
  const id = await publier('elie', 'Pour les lectures');
  await poster('awa', `/api/publications/${id}/jaime`);
  await poster('awa', `/api/publications/${id}/commentaires`, { texte: 'Bien vu' });
  const avant = (await appel('/api/notifications', { qui: 'elie' })).corps;
  assert.ok(avant.nonLues >= 2);
  // Bintou ne peut pas marquer comme lue une notification d'Elie.
  await poster('bintou', '/api/notifications/lues', { id: avant.notifications[0].id });
  assert.equal((await appel('/api/notifications', { qui: 'elie' })).corps.nonLues, avant.nonLues);
  assert.equal((await poster('elie', '/api/notifications/lues', { id: avant.notifications[0].id })).corps.nonLues, avant.nonLues - 1);
  assert.equal((await poster('elie', '/api/notifications/lues')).corps.nonLues, 0);
  assert.ok((await notifications('elie')).every((n) => n.lue));
});

test('la notification d\'un membre bloqué ou supprimé reste lisible, sans son avatar', async () => {
  const id = await publier('elie', 'Aimée par un compte qui sera bloqué');
  await poster('fanta', `/api/publications/${id}/jaime`);
  await pool.query('UPDATE utilisateurs SET bloque = TRUE WHERE id = $1', [membres.fanta.id]);
  const { corps } = await appel('/api/notifications', { qui: 'elie' });
  const vue = corps.notifications.find((n) => n.type === 'jaime' && n.texte.startsWith(nom('fanta')));
  assert.equal(vue.acteur, null);
  await pool.query('UPDATE utilisateurs SET bloque = FALSE WHERE id = $1', [membres.fanta.id]);
});
