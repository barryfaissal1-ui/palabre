// Tests de « Paramètres et confidentialité » : chaque réglage est vérifié sur le SERVEUR (les routes refusent ou
// cachent vraiment), puis le compte : email, mot de passe, autres appareils, export des données, suppression.
const test = require('node:test');
const assert = require('node:assert/strict');
const { creerApp } = require('../src/app');
const { migrer } = require('../src/db/migrate');
const { pool } = require('../src/db/pool');
const { avecComptesPrets, dernierCode } = require('./aide');

let serveur;
let base;
const suffixe = Date.now();
const lettres = String(suffixe).replace(/\d/g, (chiffre) => 'abcdefghij'[chiffre]);
// awa et bintou sont amies ; cheick ne connaît personne ; kadi est une cliente à qui awa a fait une proposition.
const membres = {};
const adresse = (cle) => `param-${cle}-${suffixe}@palabre.test`;
const attendre = (ms) => new Promise((suite) => setTimeout(suite, ms));

async function appelBrut(chemin, { methode = 'GET', donnees, qui, cookie } = {}) {
  const headers = {};
  if (donnees) headers['Content-Type'] = 'application/json';
  if (qui) headers.Cookie = membres[qui].cookie;
  if (cookie) headers.Cookie = cookie;
  const r = await fetch(`${base}${chemin}`, { method: methode, headers, body: donnees ? JSON.stringify(donnees) : undefined });
  const texte = await r.text();
  let corps = {};
  try { corps = JSON.parse(texte); } catch { /* une page HTML */ }
  return { statut: r.status, corps, texte, entetes: r.headers };
}
const appel = avecComptesPrets(appelBrut);
const poster = (qui, chemin, donnees = {}) => appel(chemin, { methode: 'POST', qui, donnees });
const regler = (qui, cle, valeur) => appel('/api/parametres/confidentialite', { methode: 'PUT', qui, donnees: { cle, valeur } });
const cookieDe = (reponse) => reponse.entetes.get('set-cookie').split(';')[0];
const connexion = (email, motDePasse = 'motdepasse1') => appelBrut('/api/auth/connexion', { methode: 'POST', donnees: { email, motDePasse } });
const moi = async (cookie) => (await appelBrut('/api/auth/moi', { cookie })).corps.utilisateur;

async function inscrire(cle, type = 'dev') {
  const r = await appel('/api/auth/inscription', { methode: 'POST', donnees: { type, prenom: cle, nomFamille: `Param${lettres}`, email: adresse(cle), motDePasse: 'motdepasse1', pays: 'Burkina Faso', ville: 'Koudougou', ...(type === 'client' ? { whatsapp: '+22670000009' } : {}) } });
  assert.equal(r.statut, 201);
  membres[cle] = { cookie: cookieDe(r), identifiant: r.corps.utilisateur.identifiant, id: r.corps.utilisateur.id };
}
const amis = async (a, b) => {
  await poster(a, '/api/amis/demandes', { identifiant: membres[b].identifiant });
  await poster(b, `/api/amis/demandes/${membres[a].identifiant}/accepter`);
};
const DEMANDE = { titre: 'Site pour une coopérative de karité', description: 'Présenter les produits, prendre les commandes et suivre les livraisons.', budgetFcfa: 400000, delai: '1 mois', categorie: 'site-web' };

test.before(async () => {
  await migrer();
  serveur = creerApp().listen(0);
  base = `http://localhost:${serveur.address().port}`;
  for (const cle of ['awa', 'bintou', 'cheick', 'dao', 'ese']) await inscrire(cle);
  await inscrire('kadi', 'client');
  await amis('awa', 'bintou');
  await pool.query('UPDATE utilisateurs SET whatsapp = $2 WHERE id = $1', [membres.awa.id, '+22670000001']);
  // Awa propose ses services à Kadi : elles sont « cliente et dev », elles peuvent s'écrire librement.
  membres.kadi.demande = (await poster('kadi', '/api/demandes', DEMANDE)).corps.demande.id;
  assert.equal((await poster('awa', `/api/demandes/${membres.kadi.demande}/propositions`, { message: 'Je peux le faire en trois semaines.', montantFcfa: 380000 })).statut, 201);
});

test.after(async () => {
  await pool.query('DELETE FROM utilisateurs WHERE email LIKE $1 OR identifiant LIKE \'membre-parti-%\' AND cree_le > now() - interval \'10 minutes\' AND NOT EXISTS (SELECT 1 FROM conversations c WHERE utilisateurs.id IN (c.membre_a, c.membre_b))', [`param-%-${suffixe}@palabre.test`]);
  await new Promise((fini) => serveur.close(fini));
  await pool.end();
});

test('réglages par défaut = le comportement d\'avant ; clé ou valeur inconnue refusée ; visiteur refusé', async () => {
  const { corps, statut } = await appel('/api/parametres', { qui: 'awa' });
  assert.equal(statut, 200);
  assert.deepEqual(corps.confidentialite, { publications: 'tous', listeAmis: 'membres', whatsapp: 'membres', messages: 'tous', appels: 'proches', equipes: 'amis', recherche: true, presence: true });
  assert.equal(corps.compte.email, adresse('awa'));
  assert.ok(!JSON.stringify(corps).includes('naissance'));
  assert.equal((await regler('awa', 'publications', 'personne')).statut, 400);
  assert.equal((await regler('awa', 'motDePasse', 'tous')).statut, 400);
  assert.equal((await regler('awa', '__proto__', 'tous')).statut, 400);
  assert.equal((await regler('awa', 'recherche', 'non')).statut, 400);
  assert.equal((await appelBrut('/api/parametres')).statut, 401);
  assert.equal((await appelBrut('/api/parametres/confidentialite', { methode: 'PUT', donnees: { cle: 'publications', valeur: 'amis' } })).statut, 401);
  // Un réglage ne touche que lui-même, et que son membre.
  await regler('awa', 'equipes', 'personne');
  await regler('awa', 'equipes', 'amis');
  assert.equal((await appel('/api/parametres', { qui: 'awa' })).corps.confidentialite.publications, 'tous');
  assert.equal((await appel('/api/parametres', { qui: 'bintou' })).corps.confidentialite.equipes, 'amis');
});

test('publications réservées aux amis : invisibles pour un autre membre et pour un visiteur, partout', async () => {
  const texte = `Secret de fabrication ${suffixe}`;
  const id = (await poster('awa', '/api/publications', { type: 'idee', texte })).corps.publication.id;
  const lire = (qui) => (qui ? appel(`/api/publications/${id}`, { qui }) : appelBrut(`/api/publications/${id}`));
  const dansLeFil = async (qui) => (await appel(`/api/publications?auteur=${membres.awa.identifiant}`, { qui })).corps.publications.some((p) => p.id === id);
  const page = async () => (await appelBrut(`/publication/${id}`)).texte;
  // Par défaut : tout le monde, y compris un visiteur et les balises de partage.
  assert.equal((await lire()).statut, 200);
  assert.ok((await page()).includes(texte));

  assert.equal((await regler('awa', 'publications', 'amis')).statut, 200);
  assert.equal((await lire('cheick')).statut, 404);
  assert.equal((await lire()).statut, 404);
  assert.equal(await dansLeFil('cheick'), false);
  assert.equal((await poster('cheick', `/api/publications/${id}/jaime`)).statut, 404, 'pas de j\'aime sur ce qu\'on ne peut pas voir');
  assert.equal((await poster('cheick', `/api/publications/${id}/commentaires`, { texte: 'Je passe quand même ?' })).statut, 404);
  assert.equal((await appel(`/api/publications/${id}/commentaires`, { qui: 'cheick' })).statut, 404);
  assert.ok(!(await page()).includes(texte), 'rien dans les balises de partage');
  // Son amie et elle-même la voient toujours.
  assert.equal((await lire('bintou')).statut, 200);
  assert.equal(await dansLeFil('bintou'), true);
  assert.equal(await dansLeFil('awa'), true);
  assert.equal((await poster('bintou', `/api/publications/${id}/jaime`)).statut, 200);

  // Membres de Palabre : un membre oui, un visiteur non.
  await regler('awa', 'publications', 'membres');
  assert.equal((await lire('cheick')).statut, 200);
  assert.equal(await dansLeFil('cheick'), true);
  assert.equal((await lire()).statut, 404);
  assert.ok(!(await page()).includes(texte));
  await regler('awa', 'publications', 'tous');
  assert.equal((await lire()).statut, 200);
});

test('liste d\'amis et numéro WhatsApp : cachés selon le réglage, jamais pour soi', async () => {
  const listeVue = async (qui) => (await appel(`/api/profils/${membres.awa.identifiant}/amis`, { qui })).corps;
  const profil = async (qui) => (await (qui ? appel(`/api/profils/${membres.awa.identifiant}`, { qui }) : appelBrut(`/api/profils/${membres.awa.identifiant}`))).corps.profil;
  assert.equal((await listeVue('cheick')).amis.length, 1);
  assert.equal((await profil('cheick')).whatsapp, '+22670000001');
  assert.equal((await profil()).whatsappMasque, true);

  await regler('awa', 'listeAmis', 'amis');
  assert.deepEqual(await listeVue('cheick'), { amis: [], cachee: true });
  assert.equal((await profil('cheick')).amisVisibles, false);
  assert.equal((await listeVue('bintou')).amis.length, 1);
  await regler('awa', 'listeAmis', 'moi');
  assert.deepEqual(await listeVue('bintou'), { amis: [], cachee: true });
  assert.equal((await listeVue('awa')).amis.length, 1);
  assert.equal((await profil('awa')).amisVisibles, true);

  await regler('awa', 'whatsapp', 'amis');
  assert.equal((await profil('cheick')).whatsapp, null);
  assert.equal((await profil('bintou')).whatsapp, '+22670000001');
  assert.equal((await profil()).whatsappMasque, false, 'on ne promet pas le numéro à un visiteur');
  await regler('awa', 'whatsapp', 'personne');
  assert.equal((await profil('bintou')).whatsapp, null);
  assert.equal((await profil('awa')).whatsapp, '+22670000001');
  // Le profil public reste entier : c'est la vitrine du dev.
  assert.equal((await profil()).nom, `awa Param${lettres}`);
  await regler('awa', 'listeAmis', 'membres');
});

test('messages et appels : refusés par le serveur selon le réglage', async () => {
  const ecrire = (qui, texte = 'Bonjour Awa') => poster(qui, `/api/messages/avec/${membres.awa.identifiant}`, { texte });
  const appeler = (qui, conversationId) => poster(qui, '/api/messages/appels', { conversationId, type: 'audio' });
  const raccrocher = (qui, reponse) => poster(qui, `/api/messages/appels/${reponse.corps.appel.id}/raccrocher`);

  await regler('awa', 'messages', 'proches');
  const refus = await ecrire('cheick');
  assert.equal(refus.statut, 403);
  assert.match(refus.corps.erreur, /amis et de ses clients/);
  const avecBintou = (await ecrire('bintou')).corps.conversationId;
  const avecKadi = await ecrire('kadi', 'Bonjour, quand peut-on commencer ?');
  assert.equal(avecKadi.statut, 201, 'une cliente à qui elle a fait une proposition peut écrire');
  assert.ok(avecBintou);
  await regler('awa', 'messages', 'tous');
  assert.equal((await ecrire('cheick')).statut, 201, 'de nouveau une simple demande de message');

  // Appels. Personne : même son amie est refusée.
  await regler('awa', 'appels', 'personne');
  const personne = await appeler('bintou', avecBintou);
  assert.equal(personne.statut, 403);
  assert.match(personne.corps.erreur, /ne reçoit pas d'appels/);
  // Amis seulement : son amie passe, sa cliente non.
  await regler('awa', 'appels', 'amis');
  const amie = await appeler('bintou', avecBintou);
  assert.equal(amie.statut, 201);
  await raccrocher('bintou', amie);
  const cliente = await appeler('kadi', avecKadi.corps.conversationId);
  assert.equal(cliente.statut, 403);
  assert.match(cliente.corps.erreur, /que de ses amis/);
  // Par défaut : la cliente peut appeler.
  await regler('awa', 'appels', 'proches');
  const permis = await appeler('kadi', avecKadi.corps.conversationId);
  assert.equal(permis.statut, 201);
  await raccrocher('kadi', permis);
});

test('équipe éclair : un ami qui ne veut pas être invité ne peut pas l\'être', async () => {
  const demande = (await poster('kadi', '/api/demandes', { ...DEMANDE, titre: 'Application de suivi des récoltes' })).corps.demande.id;
  const inviter = () => poster('awa', `/api/demandes/${demande}/equipes`, { message: 'À deux, en un mois.', montantFcfa: 380000, roleChef: 'Serveur', membres: [{ identifiant: membres.bintou.identifiant, role: 'Interface' }] });
  await regler('bintou', 'equipes', 'personne');
  const refus = await inviter();
  assert.equal(refus.statut, 400);
  assert.match(refus.corps.erreur, /ne souhaite pas être invité/);
  const { rows } = await pool.query('SELECT 1 FROM equipes WHERE demande_id = $1', [demande]);
  assert.equal(rows.length, 0, 'aucune équipe créée');
  await regler('bintou', 'equipes', 'amis');
  assert.equal((await inviter()).statut, 201);
});

test('recherche : un dev qui dit non n\'y est plus, sauf pour ses clients ; son profil reste public', async () => {
  const chercher = async (qui) => (await (qui ? appel(`/api/devs?q=Param${lettres}`, { qui }) : appelBrut(`/api/devs?q=Param${lettres}`))).corps.devs.map((d) => d.identifiant);
  assert.ok((await chercher('cheick')).includes(membres.awa.identifiant));
  assert.equal((await regler('awa', 'recherche', false)).statut, 200);
  assert.ok(!(await chercher('cheick')).includes(membres.awa.identifiant));
  assert.ok(!(await chercher()).includes(membres.awa.identifiant));
  assert.ok((await chercher('cheick')).includes(membres.bintou.identifiant), 'les autres y sont toujours');
  assert.ok((await chercher('kadi')).includes(membres.awa.identifiant), 'sa cliente la retrouve');
  for (const route of ['suggestions', 'disponibles']) {
    const { corps } = await appel(`/api/devs/${route}`, { qui: 'cheick' });
    assert.ok(!corps.devs.some((d) => d.identifiant === membres.awa.identifiant), route);
  }
  assert.equal((await appelBrut(`/api/profils/${membres.awa.identifiant}`)).statut, 200);
  await regler('awa', 'recherche', true);
  assert.ok((await chercher('cheick')).includes(membres.awa.identifiant));
});

test('« Afficher quand je suis en ligne » passe par les mêmes réglages', async () => {
  assert.equal((await regler('awa', 'presence', false)).statut, 200);
  assert.equal((await moi(membres.awa.cookie)).presenceMasquee, true);
  assert.equal((await appel('/api/parametres', { qui: 'awa' })).corps.confidentialite.presence, false);
  assert.equal((await regler('awa', 'presence', 'oui')).statut, 400);
  await regler('awa', 'presence', true);
  assert.equal((await moi(membres.awa.cookie)).presenceMasquee, false);
});

test('compte : prénom, nom et identifiant ; changement d\'email avec un code envoyé à la nouvelle adresse', async () => {
  const modifier = (donnees) => appel('/api/parametres/compte', { methode: 'PUT', qui: 'ese', donnees });
  const r = await modifier({ prenom: 'Esther' });
  assert.equal(r.corps.compte.nom, `Esther Param${lettres}`);
  assert.equal((await moi(membres.ese.cookie)).nom, `Esther Param${lettres}`);
  assert.equal((await modifier({ prenom: '<b>x</b>' })).statut, 400);
  const pris = await modifier({ identifiant: membres.awa.identifiant });
  assert.deepEqual([pris.statut, pris.corps.champ], [400, 'identifiant']);
  assert.equal((await modifier({ identifiant: 'parametres' })).statut, 400, 'mot réservé');

  const nouvelle = adresse('ese-neuf');
  const demander = (email, motDePasse) => poster('ese', '/api/parametres/email', { email, motDePasse });
  assert.equal((await demander(nouvelle, 'mauvais-mot')).statut, 400);
  assert.equal((await demander(adresse('awa'), 'motdepasse1')).statut, 400, 'adresse déjà prise');
  assert.equal((await demander(adresse('ese'), 'motdepasse1')).statut, 400, 'la même adresse');
  const codeDInscription = dernierCode(adresse('ese'));
  const envoi = await demander(nouvelle, 'motdepasse1');
  assert.equal(envoi.statut, 200);
  const code = dernierCode(nouvelle);
  assert.match(code, /^\d{6}$/);
  assert.equal(dernierCode(adresse('ese')), codeDInscription, 'rien n\'est envoyé à l\'ancienne adresse');
  // Tant que le code n'est pas saisi, l'ancienne adresse reste la bonne.
  assert.equal((await moi(membres.ese.cookie)).email, adresse('ese'));
  assert.equal((await appel('/api/parametres', { qui: 'ese' })).corps.compte.emailEnAttente, nouvelle);
  assert.equal((await demander(adresse('ese-autre'), 'motdepasse1')).statut, 429, 'un code par minute');
  const faux = await poster('ese', '/api/parametres/email/confirmer', { code: code === '000000' ? '000001' : '000000' });
  assert.deepEqual([faux.statut, faux.corps.champ], [400, 'code']);
  assert.equal((await poster('awa', '/api/parametres/email/confirmer', { code })).statut, 400, 'le code d\'un autre ne sert à rien');
  assert.equal((await poster('ese', '/api/parametres/email/confirmer', { code })).statut, 200);
  assert.equal((await moi(membres.ese.cookie)).email, nouvelle);
  assert.equal((await connexion(nouvelle)).statut, 200);
  assert.equal((await connexion(adresse('ese'))).statut, 401);
  const { rows } = await pool.query('SELECT code_hash FROM changements_email WHERE utilisateur_id = $1', [membres.ese.id]);
  assert.equal(rows.length, 0);
});

test('sécurité : dernière connexion sans adresse IP, déconnexion des autres appareils, changement de mot de passe', async () => {
  const email = adresse('ese-neuf');
  const telephone = await fetch(`${base}/api/auth/connexion`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36' }, body: JSON.stringify({ email, motDePasse: 'motdepasse1' }) });
  const cookieTelephone = telephone.headers.get('set-cookie').split(';')[0];
  const { securite } = (await appelBrut('/api/parametres', { cookie: cookieTelephone })).corps;
  assert.equal(securite.derniereConnexion.appareil, 'Chrome sur Android');
  assert.ok(Date.now() - new Date(securite.derniereConnexion.le).getTime() < 60000);
  assert.ok(!/\d+\.\d+\.\d+\.\d+|::1/.test(JSON.stringify(securite)), 'jamais d\'adresse IP');

  // Les sessions sont datées à la seconde : on laisse passer deux secondes avant de fermer les autres.
  await attendre(2100);
  const ferme = await appelBrut('/api/parametres/deconnecter-autres', { methode: 'POST', cookie: membres.ese.cookie, donnees: {} });
  assert.equal(ferme.statut, 200);
  membres.ese.cookie = cookieDe(ferme); // cet appareil reçoit une session neuve
  assert.equal(await moi(cookieTelephone), null, 'le téléphone est déconnecté');
  assert.equal((await moi(membres.ese.cookie)).email, email);

  const changer = (ancien, nouveau) => appelBrut('/api/parametres/mot-de-passe', { methode: 'PUT', cookie: membres.ese.cookie, donnees: { ancien, nouveau } });
  assert.deepEqual([(await changer('pas-le-bon', 'nouveau-secret-9')).statut, (await changer('motdepasse1', 'court')).statut, (await changer('motdepasse1', 'motdepasse1')).statut], [400, 400, 400]);
  const autre = cookieDe(await connexion(email));
  await attendre(2100);
  const change = await changer('motdepasse1', 'nouveau-secret-9');
  assert.equal(change.statut, 200);
  membres.ese.cookie = cookieDe(change);
  assert.equal(await moi(autre), null, 'changer de mot de passe ferme les autres sessions');
  assert.ok(await moi(membres.ese.cookie));
  assert.equal((await connexion(email)).statut, 401);
  assert.equal((await connexion(email, 'nouveau-secret-9')).statut, 200);
});

test('membres bloqués : la liste, puis débloquer', async () => {
  await poster('awa', `/api/messages/blocages/${membres.cheick.identifiant}`);
  const { corps } = await appel('/api/parametres/bloques', { qui: 'awa' });
  assert.deepEqual(corps.bloques.map((b) => b.identifiant), [membres.cheick.identifiant]);
  assert.ok(!JSON.stringify(corps).includes('@'), 'jamais d\'email');
  assert.deepEqual((await appel('/api/parametres/bloques', { qui: 'cheick' })).corps.bloques, [], 'cheick ne sait pas qu\'il est bloqué');
  await appel(`/api/messages/blocages/${membres.cheick.identifiant}`, { methode: 'DELETE', qui: 'awa', donnees: {} });
  assert.deepEqual((await appel('/api/parametres/bloques', { qui: 'awa' })).corps.bloques, []);
});

test('mes données : tout ce qui est à moi, rien des autres au-delà de leur nom ; 3 par jour', async () => {
  await poster('bintou', `/api/messages/avec/${membres.awa.identifiant}`, { texte: `Réponse privée de Bintou ${suffixe}` });
  const { statut, corps } = await poster('awa', '/api/parametres/export');
  assert.equal(statut, 200);
  const tout = JSON.stringify(corps);
  assert.equal(corps.profil.email, adresse('awa'));
  assert.equal(corps.profil.whatsapp, '+22670000001');
  assert.ok(corps.publications.some((p) => p.texte === `Secret de fabrication ${suffixe}`));
  assert.ok(corps.propositions.some((p) => p.demande === DEMANDE.titre && p.montantFcfa === 380000));
  assert.ok(corps.amis.includes(`bintou Param${lettres}`));
  assert.ok(Array.isArray(corps.commentaires) && Array.isArray(corps.demandes) && Array.isArray(corps.messagesEnvoyes));
  // Des autres : leur nom, rien de plus.
  assert.ok(!tout.includes(adresse('bintou')) && !tout.includes(adresse('kadi')) && !tout.includes('+22670000009'));
  assert.ok(!tout.includes('Réponse privée de Bintou') && !tout.includes('Bonjour Awa'), 'pas les messages reçus');
  assert.ok(!/naissance|mot_de_passe|hash/i.test(tout));
  // Bintou, elle, retrouve son message dans SES données.
  const deBintou = (await poster('bintou', '/api/parametres/export')).corps;
  assert.ok(deBintou.messagesEnvoyes.some((m) => m.texte === `Réponse privée de Bintou ${suffixe}` && m.conversation === `awa Param${lettres}`));
  assert.equal((await poster('awa', '/api/parametres/export')).statut, 200);
  assert.equal((await poster('awa', '/api/parametres/export')).statut, 200);
  assert.equal((await poster('awa', '/api/parametres/export')).statut, 429);
  assert.equal((await appelBrut('/api/parametres/export', { methode: 'POST', donnees: {} })).statut, 401);
});

test('supprimer mon compte : mes données partent, mes messages déjà envoyés deviennent ceux de « Membre parti »', async () => {
  await amis('dao', 'awa');
  const texte = `Dernier message de Dao ${suffixe}`;
  const conversation = (await poster('dao', `/api/messages/avec/${membres.awa.identifiant}`, { texte })).corps.conversationId;
  await poster('awa', `/api/messages/conversations/${conversation}`, { texte: 'Bien reçu, merci Dao.' });
  const publication = (await poster('dao', '/api/publications', { type: 'idee', texte: 'Une idée de Dao' })).corps.publication.id;
  await poster('awa', `/api/publications/${publication}/commentaires`, { texte: 'Bonne idée.' });

  const supprimer = (motDePasse) => appel('/api/parametres/compte', { methode: 'DELETE', qui: 'dao', donnees: { motDePasse } });
  assert.equal((await supprimer('pas-le-bon')).statut, 400);
  assert.equal((await supprimer()).statut, 400);
  assert.equal((await appelBrut('/api/parametres/compte', { methode: 'DELETE', donnees: { motDePasse: 'motdepasse1' } })).statut, 401);
  assert.equal((await supprimer('motdepasse1')).statut, 200);

  // Plus de compte : ni session, ni connexion, ni profil, ni publication.
  assert.equal(await moi(membres.dao.cookie), null);
  assert.equal((await connexion(adresse('dao'))).statut, 401);
  assert.equal((await appelBrut(`/api/profils/${membres.dao.identifiant}`)).statut, 404);
  assert.equal((await appel(`/api/publications/${publication}`, { qui: 'awa' })).statut, 404);
  const { rows: restes } = await pool.query('SELECT 1 FROM utilisateurs WHERE id = $1 OR email = $2 OR nom ILIKE $3', [membres.dao.id, adresse('dao'), 'dao %']);
  assert.equal(restes.length, 0, 'rien de Dao ne reste dans la table des membres');
  assert.ok(!(await appel('/api/amis', { qui: 'awa' })).texte.includes(membres.dao.identifiant));

  // Awa garde sa conversation : ses propres messages, et ceux de Dao sous le nom « Membre parti ».
  const vue = await appel(`/api/messages/conversations/${conversation}`, { qui: 'awa' });
  assert.equal(vue.statut, 200);
  assert.ok(vue.texte.includes(texte) && vue.texte.includes('Bien reçu, merci Dao.') && vue.texte.includes('Membre parti'));
  assert.ok(!vue.texte.includes(membres.dao.identifiant) && !vue.texte.includes(`dao Param${lettres}`));
  const { rows: [parti] } = await pool.query('SELECT u.* FROM messages m JOIN utilisateurs u ON u.id = m.auteur_id WHERE m.conversation_id = $1 AND m.texte = $2', [conversation, texte]);
  assert.deepEqual([parti.nom, parti.mot_de_passe_hash, parti.avatar, parti.whatsapp, parti.bio, Boolean(parti.supprime_le)], ['Membre parti', '!', null, null, null, true]);
  assert.match(parti.email, /^parti-[0-9a-f]+@supprime\.invalid$/);
  // On ne peut ni lui écrire, ni le trouver, ni se connecter à sa place.
  const ecrit = await poster('awa', `/api/messages/conversations/${conversation}`, { texte: 'Tu es encore là ?' });
  assert.equal(ecrit.statut, 403);
  assert.match(ecrit.corps.erreur, /a quitté Palabre/);
  assert.equal((await appelBrut(`/api/profils/${parti.identifiant}`)).statut, 404);
  assert.ok(!(await appel('/api/devs?q=Membre parti', { qui: 'awa' })).corps.devs.some((d) => d.identifiant === parti.identifiant));
  assert.equal((await connexion(parti.email, '!')).statut, 401);
});

test('la page /parametres est servie, mise en cache par le service worker, et son nom est réservé', async () => {
  const page = await appelBrut('/parametres');
  assert.equal(page.statut, 200);
  assert.ok(page.texte.includes('Paramètres et confidentialité') && /\/js\/parametres\.js\?v=/.test(page.texte), 'adresses versionnées par lirePage()');
  for (const cle of ['compte', 'confidentialite', 'notifications', 'securite', 'bloques', 'apparence', 'donnees']) assert.ok(page.texte.includes(`data-rubrique="${cle}"`), cle);
  assert.ok(!/<script(?![^>]*src=)|style="/.test(page.texte), 'ni script ni style en ligne');
  const sw = (await appelBrut('/sw.js')).texte;
  assert.ok(sw.includes("'/parametres'") && sw.includes("'/js/parametres.js'"));
  const { IDENTIFIANTS_RESERVES } = require('../src/utils/validation');
  assert.ok(IDENTIFIANTS_RESERVES.has('parametres'));
});
