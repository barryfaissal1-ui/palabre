// Tests de « Désactiver temporairement » et de la suppression en douceur : compte invisible mais conversations
// gardées, retour par la reconnexion, suppression différée de 30 jours, annulation, puis suppression définitive
// par la tâche de ménage.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { creerApp } = require('../src/app');
const { migrer } = require('../src/db/migrate');
const { pool } = require('../src/db/pool');
const { purger, lancerMenage, DELAI_SUPPRESSION_JOURS } = require('../src/utils/purge');
const { avecComptesPrets, emailsEnvoyes } = require('./aide');

let serveur;
let base;
const suffixe = Date.now();
const lettres = String(suffixe).replace(/\d/g, (chiffre) => 'abcdefghij'[chiffre]);
const adresse = (cle) => `pause-${cle}-${suffixe}@palabre.test`;
const BON = 'kolatier-vert-48';
const membres = {};
let numero = 0;

async function appelBrut(chemin, { methode = 'GET', donnees, qui, cookie, langue } = {}) {
  numero += 1;
  const headers = { 'X-Forwarded-For': `10.70.${Math.floor(numero / 250)}.${(numero % 250) + 1}` };
  if (donnees) headers['Content-Type'] = 'application/json';
  const cookies = [qui ? membres[qui].cookie : cookie, langue ? `langue=${langue}` : null].filter(Boolean);
  if (cookies.length) headers.Cookie = cookies.join('; ');
  const r = await fetch(`${base}${chemin}`, { method: methode, headers, body: donnees ? JSON.stringify(donnees) : undefined });
  const texte = await r.text();
  let corps = {};
  try { corps = JSON.parse(texte); } catch { /* une page HTML */ }
  return { statut: r.status, corps, texte, cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('palabre_session=')) };
}
const appel = avecComptesPrets(appelBrut);
const poster = (qui, chemin, donnees = {}) => appel(chemin, { methode: 'POST', qui, donnees });
const connexion = (cle) => appelBrut('/api/auth/connexion', { methode: 'POST', donnees: { email: adresse(cle), motDePasse: BON } });
const moi = async (cookie) => (await appelBrut('/api/auth/moi', { cookie })).corps.utilisateur;
const ligne = async (cle) => (await pool.query('SELECT id, desactive_le, suppression_prevue_le FROM utilisateurs WHERE id = $1', [membres[cle].id])).rows[0];

async function inscrire(cle, type = 'dev') {
  const r = await appel('/api/auth/inscription', { methode: 'POST', donnees: { type, prenom: cle, nomFamille: `Pause${lettres}`, email: adresse(cle), motDePasse: BON, pays: 'Burkina Faso', ville: 'Koudougou', ...(type === 'client' ? { whatsapp: '+22670000009' } : {}) } });
  assert.equal(r.statut, 201, JSON.stringify(r.corps));
  membres[cle] = { cookie: r.cookie, identifiant: r.corps.utilisateur.identifiant, id: r.corps.utilisateur.id };
}
// Tout ce que les autres voient d'un membre : son profil, sa page, sa publication, le fil, la recherche, la liste
// d'amis de Bintou, les propositions reçues par Kadi.
async function visible(cle) {
  const m = membres[cle];
  return {
    profil: (await appel(`/api/profils/${m.identifiant}`, { qui: 'bintou' })).statut,
    profilVisiteur: (await appelBrut(`/api/profils/${m.identifiant}`)).statut,
    page: (await appelBrut(`/${m.identifiant}`)).statut,
    publication: (await appelBrut(`/api/publications/${m.publication}`)).statut,
    // le fil d'un auteur (l'onglet Publications de son profil) : le fil général est limité à 10, d'autres tests y publient
    fil: (await appel(`/api/publications?auteur=${m.identifiant}`, { qui: 'bintou' })).texte.includes(m.identifiant),
    // recherche par le nom de famille propre à ce fichier : d'autres tests ont aussi une « awa »
    recherche: (await appel(`/api/devs?q=Pause${lettres}`, { qui: 'bintou' })).texte.includes(m.identifiant),
    amis: (await appel('/api/amis', { qui: 'bintou' })).texte.includes(m.identifiant),
    proposition: (await appel(`/api/demandes/${membres.kadi.demande}`, { qui: 'kadi' })).texte.includes(m.identifiant),
  };
}
const PARTOUT = { profil: 200, profilVisiteur: 200, page: 200, publication: 200, fil: true, recherche: true, amis: true, proposition: true };
const NULLE_PART = { profil: 404, profilVisiteur: 404, page: 404, publication: 404, fil: false, recherche: false, amis: false, proposition: false };

test.before(async () => {
  await migrer();
  serveur = creerApp().listen(0);
  base = `http://localhost:${serveur.address().port}`;
  for (const cle of ['awa', 'bintou', 'moussa']) await inscrire(cle);
  await inscrire('kadi', 'client');
  for (const cle of ['awa', 'moussa']) {
    await poster(cle, '/api/amis/demandes', { identifiant: membres.bintou.identifiant });
    await poster('bintou', `/api/amis/demandes/${membres[cle].identifiant}/accepter`);
    membres[cle].publication = (await poster(cle, '/api/publications', { type: 'idee', texte: `Une idée de ${cle} pour la pause ${suffixe}` })).corps.publication.id;
    membres[cle].conversation = (await poster(cle, `/api/messages/avec/${membres.bintou.identifiant}`, { texte: `Bonjour Bintou, c'est ${cle}.` })).corps.conversationId;
    await poster('bintou', `/api/messages/conversations/${membres[cle].conversation}`, { texte: 'Bonjour, bien reçu.' });
  }
  membres.kadi.demande = (await poster('kadi', '/api/demandes', { titre: 'Application de livraison de repas', description: 'Commander, payer par mobile money et suivre le livreur sur une carte.', budgetFcfa: 900000, delai: '2 mois', categorie: 'site-web' })).corps.demande.id;
  for (const cle of ['awa', 'moussa']) assert.equal((await poster(cle, `/api/demandes/${membres.kadi.demande}/propositions`, { message: 'Je peux le faire en six semaines.', montantFcfa: 850000 })).statut, 201);
});

test.after(async () => {
  await pool.query('DELETE FROM utilisateurs WHERE email LIKE $1 OR identifiant LIKE \'membre-parti-%\' AND cree_le > now() - interval \'10 minutes\' AND NOT EXISTS (SELECT 1 FROM conversations c WHERE utilisateurs.id IN (c.membre_a, c.membre_b))', [`pause-%-${suffixe}@palabre.test`]);
  await new Promise((fini) => serveur.close(fini));
  await pool.end();
});

test('désactiver : mot de passe exigé ; le compte devient invisible partout et toutes ses sessions sont fermées', async () => {
  assert.deepEqual(await visible('awa'), PARTOUT);
  const autreAppareil = (await connexion('awa')).cookie;
  const desactiver = (motDePasse, options = { qui: 'awa' }) => appelBrut('/api/parametres/desactiver', { methode: 'POST', donnees: { motDePasse }, ...options });
  assert.equal((await desactiver('pas-le-bon')).statut, 400);
  assert.equal((await desactiver(undefined)).statut, 400);
  assert.equal((await desactiver(BON, {})).statut, 401);
  assert.equal((await ligne('awa')).desactive_le, null);

  assert.equal((await desactiver(BON)).statut, 200);
  assert.ok((await ligne('awa')).desactive_le);
  assert.equal((await ligne('awa')).suppression_prevue_le, null, 'une pause n\'est pas une suppression');
  assert.equal(await moi(membres.awa.cookie), null);
  assert.equal(await moi(autreAppareil), null, 'l\'autre appareil est déconnecté aussi');
  assert.deepEqual(await visible('awa'), NULLE_PART);
  // Moussa, lui, n'a pas bougé.
  assert.deepEqual(await visible('moussa'), PARTOUT);
  // Rien n'est supprimé.
  const { rows: [reste] } = await pool.query('SELECT (SELECT count(*)::int FROM publications WHERE auteur_id = $1) AS publications, (SELECT count(*)::int FROM propositions WHERE dev_id = $1) AS propositions, (SELECT count(*)::int FROM messages WHERE auteur_id = $1) AS messages', [membres.awa.id]);
  assert.deepEqual({ ...reste }, { publications: 1, propositions: 1, messages: 1 });
});

test('pendant la pause : la conversation reste chez l\'autre, sous le nom « Membre indisponible », sans rien d\'elle', async () => {
  const liste = await appel('/api/messages/conversations', { qui: 'bintou' });
  const conversation = liste.corps.conversations.find((c) => c.id === membres.awa.conversation);
  assert.ok(conversation, 'la conversation est toujours dans la liste');
  assert.deepEqual(conversation.autre, { nom: 'Membre indisponible', prenom: 'Membre', identifiant: 'membre-indisponible', type: 'dev', ville: null, pays: null, avatar: null, nbProjetsVerifies: 0, indisponible: true });
  const detail = await appel(`/api/messages/conversations/${membres.awa.conversation}`, { qui: 'bintou' });
  assert.equal(detail.statut, 200);
  assert.ok(detail.texte.includes('Bonjour Bintou, c\'est awa.') && detail.texte.includes('Bonjour, bien reçu.'), 'les messages sont toujours lisibles');
  for (const reponse of [liste, detail]) assert.ok(!reponse.texte.includes(membres.awa.identifiant) && !reponse.texte.includes(`awa Pause${lettres}`), 'ni son nom ni son identifiant');
  // On ne peut ni lui écrire, ni l'appeler, ni ouvrir une nouvelle conversation avec elle.
  const ecrit = await poster('bintou', `/api/messages/conversations/${membres.awa.conversation}`, { texte: 'Tu es là ?' });
  assert.equal(ecrit.statut, 403);
  assert.match(ecrit.corps.erreur, /indisponible pour le moment/);
  assert.equal((await poster('bintou', '/api/messages/appels', { conversationId: membres.awa.conversation, type: 'audio' })).statut, 403);
  assert.equal((await poster('moussa', `/api/messages/avec/${membres.awa.identifiant}`, { texte: 'Bonjour Awa.' })).statut, 404);
  // En anglais, le nom donné par le serveur est traduit.
  const enAnglais = await appel('/api/messages/conversations', { qui: 'bintou', langue: 'en' });
  assert.equal(enAnglais.corps.conversations.find((c) => c.id === membres.awa.conversation).autre.nom, 'Unavailable member');
});

test('se reconnecter : la session ne sert qu\'à réactiver ; « Réactiver mon compte » rend tout comme avant', async () => {
  const retour = await connexion('awa');
  assert.equal(retour.statut, 200);
  assert.deepEqual([retour.corps.utilisateur.desactive, retour.corps.utilisateur.suppressionPrevueLe], [true, null]);
  membres.awa.cookie = retour.cookie;
  // Tant que le compte n'est pas réactivé, l'API ne répond à rien d'autre que /api/auth.
  for (const chemin of ['/api/publications', '/api/parametres', '/api/messages/conversations', '/api/profils/moi']) {
    const refus = await appelBrut(chemin, { qui: 'awa' });
    assert.deepEqual([refus.statut, refus.corps.suite, refus.corps.code], [403, '/bon-retour', 'compte-desactive'], chemin);
  }
  assert.equal((await poster('awa', '/api/publications', { type: 'idee', texte: 'Je publie pendant ma pause ?' })).statut, 403);
  assert.equal((await moi(membres.awa.cookie)).desactive, true);
  assert.deepEqual(await visible('awa'), NULLE_PART, 'se reconnecter ne suffit pas : il faut réactiver');
  assert.equal((await appelBrut('/bon-retour')).statut, 200);
  assert.equal((await appelBrut('/api/auth/reactiver', { methode: 'POST', donnees: {} })).statut, 401);

  const reactive = await appelBrut('/api/auth/reactiver', { methode: 'POST', qui: 'awa', donnees: {} });
  assert.equal(reactive.statut, 200);
  assert.equal((await moi(membres.awa.cookie)).desactive, false);
  assert.deepEqual(await visible('awa'), PARTOUT);
  const conversation = (await appel('/api/messages/conversations', { qui: 'bintou' })).corps.conversations.find((c) => c.id === membres.awa.conversation);
  assert.equal(conversation.autre.identifiant, membres.awa.identifiant);
  assert.equal((await poster('bintou', `/api/messages/conversations/${membres.awa.conversation}`, { texte: 'Contente de te revoir.' })).statut, 201);
  // Le journal de sécurité garde la trace des deux moments.
  const journal = (await appel('/api/parametres/journal', { qui: 'awa' })).corps.journal.map((e) => e.type);
  assert.ok(journal.indexOf('compte_reactive') >= 0 && journal.indexOf('compte_reactive') < journal.indexOf('compte_desactive'), journal.join(' '));
});

test('supprimer : le compte est désactivé 30 jours, la date est annoncée, un email propose d\'annuler', async () => {
  const supprimer = (motDePasse) => appelBrut('/api/parametres/compte', { methode: 'DELETE', qui: 'awa', donnees: { motDePasse } });
  assert.equal((await supprimer('pas-le-bon')).statut, 400);
  const demande = await supprimer(BON);
  assert.equal(demande.statut, 200);
  const prevue = new Date(demande.corps.suppressionPrevueLe).getTime();
  assert.equal(DELAI_SUPPRESSION_JOURS, 30);
  assert.ok(Math.abs(prevue - Date.now() - 30 * 86400000) < 60000, 'dans 30 jours');
  assert.equal(await moi(membres.awa.cookie), null);
  assert.deepEqual(await visible('awa'), NULLE_PART);
  // Rien n'est supprimé, et le ménage ne touche pas un compte dont l'échéance n'est pas arrivée.
  await purger();
  assert.ok((await ligne('awa')).suppression_prevue_le);
  const { rows: [{ nb }] } = await pool.query('SELECT count(*)::int AS nb FROM publications WHERE auteur_id = $1', [membres.awa.id]);
  assert.equal(nb, 1);

  const email = emailsEnvoyes.filter((m) => m.a === adresse('awa') && /sera supprimé/.test(m.sujet)).pop();
  assert.match(email.sujet, /^Ton compte Palabre sera supprimé le \d{1,2} \S+ \d{4}$/);
  assert.match(email.texte, /dans 30 jours/);
  assert.match(email.texte, /\/annuler-suppression\?jeton=[0-9a-f]{64}/);
  assert.match(email.html, /Annuler la suppression/);
  const jeton = /annuler-suppression\?jeton=([0-9a-f]{64})/.exec(email.texte)[1];
  const { rows: [garde] } = await pool.query('SELECT jeton_hash FROM annulations_suppression WHERE utilisateur_id = $1', [membres.awa.id]);
  assert.notEqual(garde.jeton_hash, jeton, 'le jeton est gardé haché');
  membres.awa.jeton = jeton;
});

test('annuler en se reconnectant : la page « Bon retour » connaît la date, réactiver annule la suppression', async () => {
  const retour = await connexion('awa');
  assert.equal(retour.corps.utilisateur.desactive, true);
  assert.ok(Math.abs(new Date(retour.corps.utilisateur.suppressionPrevueLe).getTime() - Date.now() - 30 * 86400000) < 120000);
  membres.awa.cookie = retour.cookie;
  assert.equal((await appelBrut('/api/auth/reactiver', { methode: 'POST', qui: 'awa', donnees: {} })).statut, 200);
  assert.deepEqual({ ...(await ligne('awa')) }, { id: membres.awa.id, desactive_le: null, suppression_prevue_le: null });
  assert.deepEqual(await visible('awa'), PARTOUT);
  // Le lien de l'email ne sert plus à rien.
  assert.equal((await appelBrut('/api/auth/annuler-suppression', { methode: 'POST', donnees: { jeton: membres.awa.jeton } })).statut, 400);
});

test('annuler par le lien de l\'email : ouvrir la page ne fait rien, le bouton réactive, le lien ne sert qu\'une fois', async () => {
  assert.equal((await appelBrut('/api/parametres/compte', { methode: 'DELETE', qui: 'awa', donnees: { motDePasse: BON } })).statut, 200);
  const jeton = /annuler-suppression\?jeton=([0-9a-f]{64})/.exec(emailsEnvoyes.filter((m) => m.a === adresse('awa') && /sera supprimé/.test(m.sujet)).pop().texte)[1];
  assert.notEqual(jeton, membres.awa.jeton, 'un nouveau lien à chaque demande');
  const annuler = (valeur) => appelBrut('/api/auth/annuler-suppression', { methode: 'POST', donnees: { jeton: valeur } });
  assert.equal((await appelBrut(`/annuler-suppression?jeton=${jeton}`)).statut, 200);
  assert.ok((await ligne('awa')).suppression_prevue_le, 'ouvrir la page ne change rien');
  assert.equal((await annuler('f'.repeat(64))).statut, 400);
  assert.equal((await annuler(membres.awa.jeton)).statut, 400, 'l\'ancien lien ne marche plus');

  const annule = await annuler(jeton);
  assert.deepEqual([annule.statut, annule.corps.suite], [200, '/connexion']);
  assert.deepEqual({ ...(await ligne('awa')) }, { id: membres.awa.id, desactive_le: null, suppression_prevue_le: null });
  assert.equal((await annuler(jeton)).statut, 400);
  const retour = await connexion('awa');
  assert.equal(retour.corps.utilisateur.desactive, false);
  membres.awa.cookie = retour.cookie;
  assert.deepEqual(await visible('awa'), PARTOUT);
});

test('après 30 jours : le ménage supprime le compte pour de bon, avec les règles déjà en place', async () => {
  assert.equal((await appelBrut('/api/parametres/compte', { methode: 'DELETE', qui: 'moussa', donnees: { motDePasse: BON } })).statut, 200);
  // Au 29e jour : toujours là.
  await pool.query('UPDATE utilisateurs SET suppression_prevue_le = now() + interval \'1 day\' WHERE id = $1', [membres.moussa.id]);
  await purger();
  assert.ok(await ligne('moussa'));
  // L'échéance est passée : le ménage (lancé au démarrage du serveur puis toutes les heures) fait le travail.
  await pool.query('UPDATE utilisateurs SET suppression_prevue_le = now() - interval \'1 minute\' WHERE id = $1', [membres.moussa.id]);
  const bilan = await purger();
  assert.ok(bilan.comptes >= 1, JSON.stringify(bilan));
  assert.equal(await ligne('moussa'), undefined);
  assert.equal((await connexion('moussa')).statut, 401);
  const { rows: [{ nb }] } = await pool.query('SELECT count(*)::int AS nb FROM publications WHERE id = $1', [membres.moussa.publication]);
  assert.equal(nb, 0, 'ses publications sont parties');
  // Bintou garde la conversation : les messages de Moussa sont ceux de « Membre parti ».
  const detail = await appel(`/api/messages/conversations/${membres.moussa.conversation}`, { qui: 'bintou' });
  assert.equal(detail.statut, 200);
  assert.ok(detail.texte.includes('Bonjour Bintou, c\'est moussa.') && detail.texte.includes('Membre parti'));
  assert.ok(!detail.texte.includes(membres.moussa.identifiant));
  // Un deuxième passage ne trouve plus rien à supprimer pour ce compte.
  await purger();
  assert.equal((await pool.query('SELECT count(*)::int AS nb FROM utilisateurs WHERE email = $1', [adresse('moussa')])).rows[0].nb, 0);
});

test('le ménage tourne tout seul : au démarrage puis à intervalle, sans retenir le serveur ; « npm run purger » existe', async () => {
  const minuterie = lancerMenage(3600000);
  try {
    assert.equal(minuterie.hasRef(), false, 'la minuterie n\'empêche pas le serveur de s\'arrêter');
  } finally {
    clearInterval(minuterie);
  }
  await new Promise((suite) => setTimeout(suite, 300)); // le premier passage, lancé tout de suite, se termine
  const racine = path.join(__dirname, '..');
  assert.equal(JSON.parse(fs.readFileSync(path.join(racine, 'package.json'), 'utf8')).scripts.purger, 'node scripts/purger.js');
  assert.match(fs.readFileSync(path.join(racine, 'server.js'), 'utf8'), /lancerMenage\(\)/);
});

test('l\'administrateur ne peut pas supprimer un compte depuis le site (il peut le bloquer)', async () => {
  await pool.query('UPDATE utilisateurs SET est_admin = TRUE WHERE id = $1', [membres.bintou.id]);
  for (const chemin of [`/api/admin/membres/${membres.kadi.identifiant}`, `/api/admin/utilisateurs/${membres.kadi.id}`, `/api/profils/${membres.kadi.identifiant}`]) {
    const essai = await appelBrut(chemin, { methode: 'DELETE', qui: 'bintou', donnees: {} });
    assert.equal(essai.statut, 404, chemin);
  }
  assert.ok(await ligne('kadi'));
  // Aucune route du tableau de bord ne supprime une ligne de la table des membres.
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'admin.js'), 'utf8');
  assert.ok(!/DELETE\s+FROM\s+utilisateurs/i.test(source));
  // Et une administratrice ne peut pas demander la suppression du compte d'un autre : la route ne connaît que « moi ».
  assert.equal((await appelBrut('/api/parametres/compte', { methode: 'DELETE', qui: 'bintou', donnees: { motDePasse: BON, identifiant: membres.kadi.identifiant } })).statut, 200);
  assert.equal((await ligne('kadi')).suppression_prevue_le, null);
  assert.ok((await ligne('bintou')).suppression_prevue_le, 'c\'est son propre compte qu\'elle vient de mettre en suppression');
});
