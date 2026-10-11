// Tests de la messagerie privée : amis, demandes de message, refus, blocage, client et dev, intrus, non lus, limites.
const test = require('node:test');
const assert = require('node:assert/strict');
const { creerApp } = require('../src/app');
const { migrer } = require('../src/db/migrate');
const { pool } = require('../src/db/pool');
const { avecComptesPrets } = require('./aide');

let serveur;
let base;
const suffixe = Date.now();
// Le même suffixe écrit en lettres : un nom de famille n'accepte pas les chiffres.
const lettres = String(suffixe).replace(/\d/g, (chiffre) => 'abcdefghij'[chiffre]);
const membres = {}; // cle → { cookie, identifiant, email, id }
const emailsDirects = []; // comptes créés directement en base (destinataires du test des limites)

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
// Les comptes créés par ces tests sont aussitôt « prêts » : email confirmé, profil de dev complet (voir tests/aide.js).
const appel = avecComptesPrets(appelBrut);
const poster = (qui, chemin, donnees = {}) => appel(chemin, { methode: 'POST', qui, donnees });
const ecrireA = (qui, a, texte, extra = {}) => poster(qui, `/api/messages/avec/${membres[a].identifiant}`, { texte, ...extra });
const liste = async (qui, onglet = 'principal') => (await appel(`/api/messages/conversations?onglet=${onglet}`, { qui })).corps;
const avec = (corpsListe, cle) => corpsListe.conversations.find((c) => c.autre.identifiant === membres[cle].identifiant);

// Une vraie petite image JPEG (1 × 1 pixel), encodée en base64.
const JPEG_1PX = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

async function devenirAmis(a, b) {
  await pool.query('INSERT INTO amities (demandeur_id, receveur_id, statut) VALUES ($1, $2, \'acceptee\')', [membres[a].id, membres[b].id]);
}

test.before(async () => {
  await migrer();
  serveur = creerApp().listen(0);
  base = `http://localhost:${serveur.address().port}`;
  // awa et bintou sont amies ; cheick et eve sont des devs inconnus ; dao est cliente ;
  // flo, gus et hugo servent au test des limites.
  for (const [cle, type] of [['awa', 'dev'], ['bintou', 'dev'], ['cheick', 'dev'], ['dao', 'client'], ['eve', 'dev'], ['flo', 'dev'], ['gus', 'dev'], ['hugo', 'dev']]) {
    const email = `messages-${cle}-${suffixe}@palabre.test`;
    const r = await appel('/api/auth/inscription', {
      methode: 'POST',
      donnees: { type, prenom: cle, nomFamille: `Msg${lettres}`, email, motDePasse: 'kolatier-vert-48', pays: 'Burkina Faso', ville: 'Koudougou' },
    });
    assert.equal(r.statut, 201);
    const { rows } = await pool.query('SELECT id FROM utilisateurs WHERE email = $1', [email]);
    membres[cle] = { cookie: r.entetes.get('set-cookie').split(';')[0], identifiant: r.corps.utilisateur.identifiant, email, id: rows[0].id };
  }
  await devenirAmis('awa', 'bintou');
  await devenirAmis('flo', 'gus');
});

test.after(async () => {
  // Conversations, messages, lectures, blocages et images partent avec les comptes (ON DELETE CASCADE).
  await pool.query('DELETE FROM utilisateurs WHERE email = ANY($1)', [[...Object.values(membres).map((m) => m.email), ...emailsDirects]]);
  serveur.close();
  await pool.end();
});

test('la messagerie est réservée aux membres connectés', async () => {
  for (const chemin of ['/api/messages/conversations', '/api/messages/non-lus', '/api/messages/conversations/1']) {
    assert.equal((await appel(chemin)).statut, 401, chemin);
  }
  assert.equal((await appel(`/api/messages/avec/${membres.awa.identifiant}`, { methode: 'POST', donnees: { texte: 'Bonjour' } })).statut, 401);
});

test('deux amis s\'écrivent librement, avec une photo si besoin', async () => {
  const avant = await appel(`/api/messages/avec/${membres.bintou.identifiant}`, { qui: 'awa' });
  assert.equal(avant.corps.conversationId, null);
  assert.equal(avant.corps.peutEcrire, true);
  assert.equal(avant.corps.seraUneDemande, false); // amies : pas de demande de message

  const premier = await ecrireA('awa', 'bintou', 'Salut Bintou, tu es là ?');
  assert.equal(premier.statut, 201);
  assert.equal(premier.corps.statut, 'acceptee');
  const id = premier.corps.conversationId;
  membres.awa.conv = id;

  const reponse = await poster('bintou', `/api/messages/conversations/${id}`, { texte: 'Oui ! Regarde cette capture.', image: JPEG_1PX });
  assert.equal(reponse.statut, 201);
  assert.match(reponse.corps.message.image, /^\/fichiers\//);
  // La photo d'un message n'est servie qu'aux deux membres de la conversation (voir tests/securite.test.js).
  assert.equal((await fetch(`${base}${reponse.corps.message.image}`, { headers: { Cookie: membres.bintou.cookie } })).status, 200);
  await poster('awa', `/api/messages/conversations/${id}`, { texte: 'Très bien.' });

  // La même conversation des deux côtés, messages du plus ancien au plus récent.
  const vue = await appel(`/api/messages/conversations/${id}`, { qui: 'bintou' });
  assert.equal(vue.statut, 200);
  assert.deepEqual(vue.corps.messages.map((m) => [m.texte, m.estMoi]), [['Salut Bintou, tu es là ?', false], ['Oui ! Regarde cette capture.', true], ['Très bien.', false]]);
  assert.equal(vue.corps.conversation.autre.identifiant, membres.awa.identifiant);
  assert.equal(vue.corps.conversation.peutEcrire, true);
  assert.ok(!('email' in vue.corps.conversation.autre));

  // Écrire de nouveau « à » la même personne ne crée pas une seconde conversation.
  const encore = await ecrireA('bintou', 'awa', 'Autre chose…');
  assert.equal(encore.corps.conversationId, id);
  const { rows } = await pool.query('SELECT count(*)::int AS nb FROM conversations WHERE membre_a = LEAST($1::int, $2::int) AND membre_b = GREATEST($1::int, $2::int)', [membres.awa.id, membres.bintou.id]);
  assert.equal(rows[0].nb, 1);
});

test('message vide, trop long, faux fichier ou à soi-même : refusés', async () => {
  const id = membres.awa.conv;
  assert.equal((await poster('awa', `/api/messages/conversations/${id}`, { texte: '   ' })).statut, 400);
  assert.equal((await poster('awa', `/api/messages/conversations/${id}`, { texte: 'x'.repeat(2001) })).statut, 400);
  assert.equal((await poster('awa', `/api/messages/conversations/${id}`, { texte: 'ok', image: 'data:text/html;base64,PGI+' })).statut, 400);
  assert.equal((await ecrireA('awa', 'awa', 'Moi-même')).statut, 404);
  assert.equal((await poster('awa', '/api/messages/avec/personne-ici', { texte: 'Bonjour' })).statut, 404);
});

test('non lus, pastille et « Vu »', async () => {
  const id = membres.awa.conv;
  const envoi = await poster('bintou', `/api/messages/conversations/${id}`, { texte: 'Tu as vu mon message ?' });
  const dernier = envoi.corps.message.id;

  // Awa a 2 messages de Bintou à lire (« Autre chose… » et celui-ci).
  assert.equal((await appel('/api/messages/non-lus', { qui: 'awa' })).corps.nonLus, 2);
  assert.equal((await appel('/api/auth/moi', { qui: 'awa' })).corps.utilisateur.messagesNonLus, 2);
  assert.equal(avec(await liste('awa'), 'bintou').nonLus, 2);
  assert.equal(avec(await liste('awa'), 'bintou').dernierMessage.texte, 'Tu as vu mon message ?');
  // Bintou, elle, n'a rien à lire : on ne compte jamais ses propres messages.
  assert.equal((await appel('/api/messages/non-lus', { qui: 'bintou' })).corps.nonLus, 0);
  // Tant qu'Awa n'a pas lu, Bintou ne voit pas « Vu ».
  assert.ok((await appel(`/api/messages/conversations/${id}`, { qui: 'bintou' })).corps.conversation.vuJusqua < dernier);

  const lu = await poster('awa', `/api/messages/conversations/${id}/lu`);
  assert.equal(lu.corps.nonLus, 0);
  assert.equal(avec(await liste('awa'), 'bintou').nonLus, 0);

  // L'actualisation de Bintou : aucun nouveau message, mais « Vu » est arrivé.
  const nouveaux = await appel(`/api/messages/conversations/${id}/nouveaux?apres=${dernier}`, { qui: 'bintou' });
  assert.deepEqual(nouveaux.corps.messages, []);
  assert.equal(nouveaux.corps.vuJusqua, dernier);
  // Et seulement les nouveaux messages quand il y en a.
  await poster('awa', `/api/messages/conversations/${id}`, { texte: 'Oui, vu !' });
  const suite = await appel(`/api/messages/conversations/${id}/nouveaux?apres=${dernier}`, { qui: 'bintou' });
  assert.deepEqual(suite.corps.messages.map((m) => m.texte), ['Oui, vu !']);
});

test('les messages sont chargés par 30, du plus récent au plus ancien', async () => {
  await devenirAmis('awa', 'gus');
  const premier = await ecrireA('awa', 'gus', 'Message 1');
  const id = premier.corps.conversationId;
  await pool.query(
    'INSERT INTO messages (conversation_id, auteur_id, texte) SELECT $1, $2, \'Message \' || n FROM generate_series(2, 35) n',
    [id, membres.awa.id],
  );
  const page1 = await appel(`/api/messages/conversations/${id}`, { qui: 'gus' });
  assert.equal(page1.corps.messages.length, 30);
  assert.equal(page1.corps.messages[29].texte, 'Message 35'); // le plus récent en dernier
  assert.equal(page1.corps.messages[0].texte, 'Message 6');
  assert.ok(page1.corps.precedent);
  const page2 = await appel(`/api/messages/conversations/${id}?avant=${page1.corps.precedent}`, { qui: 'gus' });
  assert.deepEqual(page2.corps.messages.map((m) => m.texte), ['Message 1', 'Message 2', 'Message 3', 'Message 4', 'Message 5']);
  assert.equal(page2.corps.precedent, null);
});

test('non-ami : un seul premier message, rangé dans les demandes, jusqu\'à ce qu\'il soit accepté', async () => {
  assert.equal((await appel(`/api/messages/avec/${membres.awa.identifiant}`, { qui: 'cheick' })).corps.seraUneDemande, true);
  const premier = await ecrireA('cheick', 'awa', 'Bonjour Awa, on ne se connaît pas, mais j\'aimerais te parler d\'un projet.');
  assert.equal(premier.statut, 201);
  assert.equal(premier.corps.statut, 'demande');
  const id = premier.corps.conversationId;
  membres.cheick.conv = id;

  // Tant que ce n'est pas accepté : rien de plus, ni par une route ni par l'autre.
  const second = await ecrireA('cheick', 'awa', 'Tu es là ?');
  assert.equal(second.statut, 403);
  assert.match(second.corps.erreur, /demande de message/);
  assert.equal((await poster('cheick', `/api/messages/conversations/${id}`, { texte: 'Allô ?' })).statut, 403);
  assert.equal((await appel(`/api/messages/conversations/${id}`, { qui: 'cheick' })).corps.conversation.peutEcrire, false);

  // Chez Awa : pas dans ses messages, mais dans l'onglet « Demandes », avec une notification.
  assert.equal(avec(await liste('awa'), 'cheick'), undefined);
  const demandes = await liste('awa', 'demandes');
  assert.equal(avec(demandes, 'cheick').id, id);
  assert.ok(demandes.nbDemandes >= 1);
  assert.ok((await liste('awa')).nbDemandes >= 1); // le compteur de l'onglet accompagne aussi l'autre liste
  const { rows: notifications } = await pool.query('SELECT type, lien FROM notifications WHERE utilisateur_id = $1 AND type = \'demande_message\'', [membres.awa.id]);
  assert.equal(notifications.length, 1); // une seule notification : pas une par message
  assert.equal(notifications[0].lien, '/messages?onglet=demandes');
  // Chez Cheick : dans ses messages, marquée « en attente ».
  assert.equal(avec(await liste('cheick'), 'awa').enAttente, true);

  // Awa lit la demande sans l'accepter : Cheick ne voit pas « Vu ».
  const vue = await appel(`/api/messages/conversations/${id}`, { qui: 'awa' });
  assert.equal(vue.corps.conversation.estDemandeRecue, true);
  await poster('awa', `/api/messages/conversations/${id}/lu`);
  assert.equal((await appel(`/api/messages/conversations/${id}`, { qui: 'cheick' })).corps.conversation.vuJusqua, 0);

  // Seul le destinataire peut accepter.
  assert.equal((await poster('cheick', `/api/messages/conversations/${id}/accepter`)).statut, 404);
  assert.equal((await poster('awa', `/api/messages/conversations/${id}/accepter`)).statut, 200);
  assert.equal(avec(await liste('awa'), 'cheick').id, id);
  assert.equal(avec(await liste('awa', 'demandes'), 'cheick'), undefined);
  assert.equal((await ecrireA('cheick', 'awa', 'Merci d\'avoir accepté !')).statut, 201);
});

test('refuser : la demande disparaît chez moi, l\'autre reste « en attente » sans le savoir', async () => {
  const premier = await ecrireA('eve', 'awa', 'Bonjour, tu fais des sites pas chers ?');
  const id = premier.corps.conversationId;
  assert.equal((await poster('eve', `/api/messages/conversations/${id}/refuser`)).statut, 404); // on ne refuse pas sa propre demande
  assert.equal((await poster('awa', `/api/messages/conversations/${id}/refuser`)).statut, 200);

  // Chez Awa : plus rien, nulle part.
  assert.equal(avec(await liste('awa'), 'eve'), undefined);
  assert.equal(avec(await liste('awa', 'demandes'), 'eve'), undefined);
  assert.equal((await appel(`/api/messages/conversations/${id}`, { qui: 'awa' })).statut, 404);

  // Chez Eve : exactement comme avant le refus. Même message d'erreur que pour une demande en attente.
  assert.equal(avec(await liste('eve'), 'awa').enAttente, true);
  const relance = await ecrireA('eve', 'awa', 'Alors ?');
  assert.equal(relance.statut, 403);
  assert.match(relance.corps.erreur, /demande de message/);
  assert.doesNotMatch(relance.corps.erreur, /refus/i);
});

test('bloquer puis débloquer', async () => {
  const id = membres.awa.conv;
  assert.equal((await poster('awa', `/api/messages/blocages/${membres.bintou.identifiant}`)).statut, 200);

  // Bintou ne peut plus écrire à Awa ni voir la conversation ; on ne lui dit pas qu'elle est bloquée.
  const refus = await poster('bintou', `/api/messages/avec/${membres.awa.identifiant}`, { texte: 'Coucou' });
  assert.equal(refus.statut, 403);
  assert.doesNotMatch(refus.corps.erreur, /bloqu/i);
  assert.equal(avec(await liste('bintou'), 'awa'), undefined);
  assert.equal((await appel(`/api/messages/conversations/${id}`, { qui: 'bintou' })).statut, 404);
  assert.equal((await poster('bintou', `/api/messages/conversations/${id}`, { texte: 'Coucou' })).statut, 404);
  assert.equal((await appel('/api/messages/non-lus', { qui: 'bintou' })).corps.nonLus, 0);

  // Awa garde la conversation (pour pouvoir débloquer), mais doit débloquer avant d'écrire.
  assert.equal(avec(await liste('awa'), 'bintou').jeBloque, true);
  const vue = await appel(`/api/messages/conversations/${id}`, { qui: 'awa' });
  assert.equal(vue.corps.conversation.jeBloque, true);
  assert.equal(vue.corps.conversation.peutEcrire, false);
  assert.equal((await poster('awa', `/api/messages/conversations/${id}`, { texte: 'Finalement…' })).statut, 403);

  assert.equal((await appel(`/api/messages/blocages/${membres.bintou.identifiant}`, { methode: 'DELETE', qui: 'awa', donnees: {} })).statut, 200);
  assert.equal((await poster('bintou', `/api/messages/conversations/${id}`, { texte: 'Me revoilà.' })).statut, 201);
  assert.equal(avec(await liste('bintou'), 'awa').id, id);
});

test('client et dev : dès qu\'une proposition est envoyée, ils s\'écrivent sans demande de message', async () => {
  const demande = await poster('dao', '/api/demandes', { titre: 'Site pour ma boutique de test', description: 'Je voudrais un site simple pour présenter ma boutique et mes produits.', categorie: 'site-web' });
  assert.equal(demande.statut, 201);
  const demandeId = demande.corps.demande.id;

  // Avant toute proposition, la cliente est une inconnue pour le dev : ce serait une demande de message.
  assert.equal((await appel(`/api/messages/avec/${membres.cheick.identifiant}`, { qui: 'dao' })).corps.seraUneDemande, true);

  const proposition = await poster('cheick', `/api/demandes/${demandeId}/propositions`, { message: 'Bonjour, je peux réaliser ce site en deux semaines.', montantFcfa: 100000 });
  assert.equal(proposition.statut, 201);

  // La cliente écrit depuis la proposition : conversation ouverte tout de suite, rattachée à la demande.
  const info = await appel(`/api/messages/avec/${membres.cheick.identifiant}?demande=${demandeId}`, { qui: 'dao' });
  assert.equal(info.corps.seraUneDemande, false);
  const message = await ecrireA('dao', 'cheick', 'Bonjour, pouvez-vous me montrer un exemple ?', { demandeId });
  assert.equal(message.statut, 201);
  assert.equal(message.corps.statut, 'acceptee');
  const vue = await appel(`/api/messages/conversations/${message.corps.conversationId}`, { qui: 'cheick' });
  assert.deepEqual(vue.corps.conversation.demande, { id: demandeId, titre: 'Site pour ma boutique de test' });
  assert.equal(vue.corps.conversation.estDemandeRecue, false);
  // Le dev répond librement, et la conversation est dans ses messages, pas dans ses demandes.
  assert.equal((await poster('cheick', `/api/messages/conversations/${message.corps.conversationId}`, { texte: 'Bien sûr, voici un lien.' })).statut, 201);
  assert.equal(avec(await liste('cheick'), 'dao').demande.id, demandeId);
  assert.equal(avec(await liste('cheick', 'demandes'), 'dao'), undefined);

  // Un dev qui n'a rien proposé reste un inconnu pour la cliente.
  assert.equal((await ecrireA('eve', 'dao', 'Bonjour, je fais aussi des sites.')).corps.statut, 'demande');
});

test('un intrus ne peut ni lire ni écrire dans la conversation des autres', async () => {
  const id = membres.awa.conv; // conversation d'Awa et Bintou ; Eve n'en fait pas partie
  assert.equal((await appel(`/api/messages/conversations/${id}`, { qui: 'eve' })).statut, 404);
  assert.equal((await appel(`/api/messages/conversations/${id}/nouveaux?apres=0`, { qui: 'eve' })).statut, 404);
  assert.equal((await poster('eve', `/api/messages/conversations/${id}`, { texte: 'Je m\'incruste' })).statut, 404);
  for (const action of ['lu', 'accepter', 'refuser', 'masquer']) {
    assert.equal((await poster('eve', `/api/messages/conversations/${id}/${action}`)).statut, 404, action);
  }
  assert.equal((await appel('/api/messages/conversations/abc', { qui: 'eve' })).statut, 404);
  // Même réponse pour une conversation qui n'existe pas : impossible de deviner lesquelles existent.
  assert.equal((await appel('/api/messages/conversations/2147483000', { qui: 'eve' })).statut, 404);
  // Ni la signaler : il faut faire partie de la conversation.
  const { rows: [message] } = await pool.query('SELECT id FROM messages WHERE conversation_id = $1 AND auteur_id = $2 LIMIT 1', [id, membres.awa.id]);
  assert.equal((await poster('eve', '/api/signalements', { cibleType: 'message', cible: message.id, motif: 'Spam ou arnaque' })).statut, 404);
});

test('signaler un message : l\'administrateur ne voit que ce message, et peut le masquer', async () => {
  const id = membres.awa.conv;
  const { rows: [message] } = await pool.query('SELECT id, texte FROM messages WHERE conversation_id = $1 AND auteur_id = $2 ORDER BY id LIMIT 1', [id, membres.awa.id]);
  assert.equal((await poster('awa', '/api/signalements', { cibleType: 'message', cible: message.id, motif: 'Spam ou arnaque' })).statut, 400); // pas son propre message
  assert.equal((await poster('bintou', '/api/signalements', { cibleType: 'message', cible: message.id, motif: 'Insultes ou harcèlement' })).statut, 201);

  await pool.query('UPDATE utilisateurs SET est_admin = TRUE WHERE id = $1', [membres.hugo.id]);
  const { corps } = await appel('/api/admin/signalements', { qui: 'hugo' });
  const carte = corps.signalements.find((c) => c.cibleType === 'message' && c.cible && c.cible.texte === message.texte);
  assert.ok(carte, 'le message signalé apparaît dans /admin');
  assert.equal(carte.cible.membre.identifiant, membres.awa.identifiant);
  assert.equal(carte.cible.lien, null); // aucun lien vers la conversation
  assert.ok(!JSON.stringify(carte).includes('Très bien.')); // aucun autre message de la conversation

  assert.equal((await poster('hugo', `/api/admin/signalements/${carte.id}/traiter`, { action: 'masquer' })).statut, 200);
  const vue = await appel(`/api/messages/conversations/${id}`, { qui: 'bintou' });
  assert.ok(!vue.corps.messages.some((m) => m.id === message.id), 'le message masqué a disparu de la conversation');
  await pool.query('UPDATE utilisateurs SET est_admin = FALSE WHERE id = $1', [membres.hugo.id]);
});

test('supprimer la conversation de mon côté : elle revient quand un message arrive', async () => {
  const id = membres.cheick.conv; // Awa et Cheick, acceptée plus haut
  assert.equal((await poster('awa', `/api/messages/conversations/${id}/masquer`)).statut, 200);
  assert.equal(avec(await liste('awa'), 'cheick'), undefined);
  assert.equal(avec(await liste('cheick'), 'awa').id, id); // rien ne change chez Cheick
  assert.equal((await poster('cheick', `/api/messages/conversations/${id}`, { texte: 'Tu es toujours là ?' })).statut, 201);
  assert.equal(avec(await liste('awa'), 'cheick').id, id);
});

test('limite : 30 messages par minute', async () => {
  const premier = await ecrireA('flo', 'gus', 'Message 1');
  assert.equal(premier.statut, 201);
  const id = premier.corps.conversationId;
  for (let n = 2; n <= 30; n += 1) {
    assert.equal((await poster('flo', `/api/messages/conversations/${id}`, { texte: `Message ${n}` })).statut, 201, `message ${n}`);
  }
  const trop = await poster('flo', `/api/messages/conversations/${id}`, { texte: 'Message 31' });
  assert.equal(trop.statut, 429);
  assert.match(trop.corps.erreur, /minute/);
  // La limite est par membre : Gus, lui, peut toujours répondre.
  assert.equal((await poster('gus', `/api/messages/conversations/${id}`, { texte: 'Doucement !' })).statut, 201);
});

test('limite : 10 nouvelles conversations par jour avec des non-amis', async () => {
  // 11 inconnus, créés directement en base (inutile de passer 11 fois par l'inscription).
  const inconnus = [];
  for (let n = 1; n <= 11; n += 1) {
    const email = `messages-inconnu${n}-${suffixe}@palabre.test`;
    emailsDirects.push(email);
    const identifiant = `inconnu${n}-msg${suffixe}`;
    await pool.query(
      `INSERT INTO utilisateurs (type, nom, identifiant, email, mot_de_passe_hash, pays, ville)
       VALUES ('dev', $1, $2, $3, 'pas-un-vrai-hash', 'Burkina Faso', 'Koudougou')`,
      [`Inconnu ${n}`, identifiant, email],
    );
    inconnus.push(identifiant);
  }
  for (const [n, identifiant] of inconnus.slice(0, 10).entries()) {
    const r = await poster('hugo', `/api/messages/avec/${identifiant}`, { texte: 'Bonjour, je me présente.' });
    assert.equal(r.statut, 201, `inconnu ${n + 1}`);
    assert.equal(r.corps.statut, 'demande');
  }
  const onzieme = await poster('hugo', `/api/messages/avec/${inconnus[10]}`, { texte: 'Bonjour, je me présente.' });
  assert.equal(onzieme.statut, 429);
  assert.match(onzieme.corps.erreur, /10 personnes/);
  const { rows } = await pool.query('SELECT count(*)::int AS nb FROM conversations WHERE cree_par = $1', [membres.hugo.id]);
  assert.equal(rows[0].nb, 10); // la onzième n'a pas été créée

  // La limite ne concerne que les inconnus : écrire à un ami reste possible.
  await devenirAmis('hugo', 'gus');
  assert.equal((await ecrireA('hugo', 'gus', 'Salut Gus !')).statut, 201);
});

test('la page /messages/:id est servie, et « messages » ne peut pas être un identifiant', async () => {
  const page = await fetch(`${base}/messages/12`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /data-messagerie/);
  const profil = await appel('/api/profils/moi', {
    methode: 'PUT', qui: 'eve',
    donnees: { prenom: 'Eve', nomFamille: 'Test', identifiant: 'messages', pays: 'Burkina Faso', ville: 'Koudougou' },
  });
  assert.equal(profil.statut, 400);
  assert.equal(profil.corps.champ, 'identifiant');
});
