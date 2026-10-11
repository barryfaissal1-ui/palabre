// Tests des signalements qui cachent un contenu, des sanctions progressives, de la suspension en lecture seule,
// de la contestation et du journal de modération.
const test = require('node:test');
const assert = require('node:assert/strict');
const { creerApp } = require('../src/app');
const { migrer } = require('../src/db/migrate');
const { pool } = require('../src/db/pool');
const { purgerJournalModeration, CATEGORIES } = require('../src/utils/sanctions');
const { avecComptesPrets, emailsEnvoyes } = require('./aide');

let serveur;
let base;
const suffixe = Date.now();
const lettres = String(suffixe).replace(/\d/g, (chiffre) => 'abcdefghij'[chiffre]);
const adresse = (cle) => `sanction-${cle}-${suffixe}@palabre.test`;
const membres = {};
let numero = 0;

async function appelBrut(chemin, { methode = 'GET', donnees, qui, langue } = {}) {
  numero += 1;
  const headers = { 'X-Forwarded-For': `10.95.${Math.floor(numero / 250)}.${(numero % 250) + 1}` };
  if (donnees) headers['Content-Type'] = 'application/json';
  const cookies = [qui ? membres[qui].cookie : null, langue ? `langue=${langue}` : null].filter(Boolean);
  if (cookies.length) headers.Cookie = cookies.join('; ');
  const r = await fetch(`${base}${chemin}`, { method: methode, headers, body: donnees ? JSON.stringify(donnees) : undefined });
  const texte = await r.text();
  let corps = {};
  try { corps = JSON.parse(texte); } catch { /* une page HTML */ }
  return { statut: r.status, corps, texte, entetes: r.headers };
}
const appel = avecComptesPrets(appelBrut);
const poster = (qui, chemin, donnees = {}) => appel(chemin, { methode: 'POST', qui, donnees });
const publier = async (qui, texte) => (await poster(qui, '/api/publications', { type: 'idee', texte })).corps.publication;
const signaler = (qui, cible, plus = { categorie: 'spam' }, cibleType = 'publication') => poster(qui, '/api/signalements', { cibleType, cible, ...plus });
const visible = async (id) => (await appel(`/api/publications/${id}`, { qui: 'temoin' })).statut === 200;
const sanctionsDe = async (qui) => (await appel('/api/sanctions', { qui })).corps.sanctions;
const compte = async (cle) => (await pool.query('SELECT bloque, suspendu_jusqu_a, signalements_rejetes FROM utilisateurs WHERE id = $1', [membres[cle].id])).rows[0];
const emailsDe = (cle, sujet) => emailsEnvoyes.filter((m) => m.a === adresse(cle) && sujet.test(m.sujet));
const notificationsDe = async (cle, type) => (await pool.query('SELECT texte, lien FROM notifications WHERE utilisateur_id = $1 AND type = $2 ORDER BY id', [membres[cle].id, type])).rows;
// La carte d'un contenu dans la file « À modérer » (retrouvée par son numéro, lu en base).
const enFile = async (cibleId) => {
  const { rows: [ligne] } = await pool.query('SELECT id FROM moderation_attente WHERE cible_type = \'publication\' AND cible_id = $1 AND decide_le IS NULL', [cibleId]);
  if (!ligne) return null;
  return (await appel('/api/admin/moderation/attente', { qui: 'chef' })).corps.attente.find((a) => a.id === ligne.id);
};
const decider = (id, donnees) => poster('chef', `/api/admin/moderation/attente/${id}`, donnees);

test.before(async () => {
  await migrer();
  serveur = creerApp().listen(0);
  base = `http://localhost:${serveur.address().port}`;
  for (const cle of ['awa', 'bintou', 'cheick', 'drissa', 'ese', 'fatou', 'temoin', 'neuf', 'chef']) {
    const r = await appel('/api/auth/inscription', { methode: 'POST', donnees: { type: 'dev', prenom: cle, nomFamille: `Sanction${lettres}`, email: adresse(cle), motDePasse: 'kolatier-vert-48', pays: 'Burkina Faso', ville: 'Koudougou' } });
    assert.equal(r.statut, 201, JSON.stringify(r.corps));
    membres[cle] = { cookie: r.entetes.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('palabre_session=')), identifiant: r.corps.utilisateur.identifiant, id: r.corps.utilisateur.id };
  }
  await pool.query('UPDATE utilisateurs SET est_admin = TRUE WHERE id = $1', [membres.chef.id]);
  await pool.query('UPDATE utilisateurs SET cree_le = now() - interval \'1 hour\' WHERE id = $1', [membres.neuf.id]); // un compte de moins de 3 jours
});

test.after(async () => {
  await pool.query('DELETE FROM journal_moderation WHERE admin_id = $1', [membres.chef.id]);
  await pool.query('DELETE FROM utilisateurs WHERE email LIKE $1', [`sanction-%-${suffixe}@palabre.test`]);
  await new Promise((fini) => serveur.close(fini));
  await pool.end();
});

test('signalement : un motif de la liste, avec ou sans précision ; le libellé lu par l\'équipe est écrit par le serveur', async () => {
  const publication = await publier('awa', 'Une publication à signaler pour essayer les motifs.');
  assert.deepEqual(Object.keys(CATEGORIES), ['arnaque', 'insulte', 'haine', 'sexuel', 'violence', 'faux_profil', 'spam', 'autre']);
  assert.equal((await signaler('bintou', publication.id, { categorie: 'publicite' })).statut, 400);
  assert.equal((await signaler('bintou', publication.id, {})).statut, 400, 'ni motif de la liste ni texte');
  assert.equal((await signaler('bintou', publication.id, { categorie: 'arnaque', motif: 'Il demande 5 000 F avant de commencer.' })).statut, 201);
  assert.equal((await signaler('cheick', publication.id, { categorie: 'haine' })).statut, 201, 'le texte est facultatif');
  assert.equal((await signaler('drissa', publication.id, { motif: 'Un texte libre, comme avant.' }, 'publication')).statut, 201);
  const { rows } = await pool.query('SELECT categorie, motif FROM signalements WHERE cible_type = \'publication\' AND cible_id = $1 ORDER BY id', [publication.id]);
  assert.deepEqual(rows.map((r) => ({ ...r })), [
    { categorie: 'arnaque', motif: 'Arnaque : Il demande 5 000 F avant de commencer.' },
    { categorie: 'haine', motif: 'Haine' },
    { categorie: null, motif: 'Un texte libre, comme avant.' },
  ]);
  membres.awa.premiere = publication.id;
});

test('3 membres différents : le contenu est caché automatiquement, l\'auteur est prévenu, il entre dans la file', async () => {
  // Le test précédent a fait trois signalements de trois membres : la publication est déjà cachée.
  assert.equal(await visible(membres.awa.premiere), false);
  const carte = await enFile(membres.awa.premiere);
  assert.deepEqual([carte.raison, carte.cibleType, carte.auteur.identifiant, carte.motifs.length], ['signalements', 'publication', membres.awa.identifiant, 3]);
  const prevenue = await notificationsDe('awa', 'contenu_cache');
  assert.equal(prevenue.length, 1);
  assert.match(prevenue[0].texte, /signalé par plusieurs membres : il est caché/);

  // Deux signalements ne suffisent pas.
  const autre = await publier('awa', 'Deux signalements seulement.');
  await signaler('bintou', autre.id);
  await signaler('cheick', autre.id);
  assert.equal(await visible(autre.id), true);
  membres.awa.autre = autre.id;
});

test('pas avec 3 signalements du même compte, ni avec des comptes de moins de 3 jours, ni avec un signaleur abusif', async () => {
  const publication = await publier('awa', 'Signalée trois fois par la même personne.');
  assert.equal((await signaler('bintou', publication.id)).statut, 201);
  for (let n = 0; n < 2; n += 1) {
    const encore = await signaler('bintou', publication.id, { categorie: 'insulte' });
    assert.deepEqual([encore.statut, encore.corps.dejaSignale], [200, true]);
  }
  assert.equal(await visible(publication.id), true, 'un seul compte ne compte que pour un');
  // Un compte de moins de 3 jours peut signaler, mais ne compte pas dans le seuil.
  await signaler('cheick', publication.id);
  assert.equal((await signaler('neuf', publication.id)).statut, 201);
  assert.equal(await visible(publication.id), true);
  // Un membre dont trois signalements ont été rejetés ne compte plus non plus.
  await pool.query('UPDATE utilisateurs SET signalements_rejetes = 3 WHERE id = $1', [membres.drissa.id]);
  await signaler('drissa', publication.id);
  assert.equal(await visible(publication.id), true);
  // Un troisième membre de bonne foi : cette fois, le contenu est caché.
  await pool.query('UPDATE utilisateurs SET signalements_rejetes = 0 WHERE id = $1', [membres.drissa.id]);
  await signaler('ese', publication.id);
  assert.equal(await visible(publication.id), false);
  membres.awa.troisFois = publication.id;
});

test('approuver un contenu caché à tort : il redevient visible, et le signalement rejeté compte contre les signaleurs', async () => {
  const carte = await enFile(membres.awa.troisFois);
  assert.equal((await poster('bintou', `/api/admin/moderation/attente/${carte.id}`, { decision: 'approuver' })).statut, 403);
  assert.equal((await decider(carte.id, { decision: 'approuver' })).statut, 200);
  assert.equal(await visible(membres.awa.troisFois), true);
  const { rows } = await pool.query('SELECT DISTINCT statut FROM signalements WHERE cible_type = \'publication\' AND cible_id = $1', [membres.awa.troisFois]);
  assert.deepEqual(rows.map((r) => r.statut), ['rejete']);
  for (const cle of ['bintou', 'cheick', 'drissa', 'ese']) assert.equal((await compte(cle)).signalements_rejetes, 1, cle);
  assert.deepEqual(await sanctionsDe('awa'), [], 'approuver ne sanctionne personne');
});

test('sanctions progressives : avertissement (notification et email), puis suspension de 7 jours, puis exclusion', async () => {
  // 1re faute : avertissement.
  const carte = await enFile(membres.awa.premiere);
  const premiere = await decider(carte.id, { decision: 'sanctionner', motif: 'Publicité répétée pour un site sans rapport.' });
  assert.deepEqual([premiere.statut, premiere.corps.sanction], [200, 'avertissement']);
  assert.equal(await visible(membres.awa.premiere), false, 'le contenu reste caché');
  let liste = await sanctionsDe('awa');
  assert.deepEqual([liste.length, liste[0].type, liste[0].motif, liste[0].fin, liste[0].contestable], [1, 'avertissement', 'Publicité répétée pour un site sans rapport.', null, true]);
  assert.equal((await notificationsDe('awa', 'sanction'))[0].lien, '/sanctions');
  const email = emailsDe('awa', /Avertissement/)[0];
  assert.equal(email.sujet, 'Avertissement de l\'équipe Palabre');
  assert.match(email.texte, /Motif : Publicité répétée pour un site sans rapport\./);
  assert.match(email.texte, /\/sanctions\?jeton=[0-9a-f]{64}/);
  assert.equal((await compte('awa')).suspendu_jusqu_a, null);
  assert.equal((await poster('awa', '/api/publications', { type: 'idee', texte: 'Un avertissement ne m\'empêche pas de publier.' })).statut, 201);

  // 2e faute : suspension de 7 jours.
  for (const cle of ['bintou', 'cheick', 'drissa']) await signaler(cle, membres.awa.autre, { categorie: 'insulte' });
  const deuxieme = await decider((await enFile(membres.awa.autre)).id, { decision: 'sanctionner' });
  assert.equal(deuxieme.corps.sanction, 'suspension');
  liste = await sanctionsDe('awa');
  assert.equal(liste[0].type, 'suspension');
  assert.ok(Math.abs(new Date(liste[0].fin).getTime() - Date.now() - 7 * 86400000) < 60000, 'fin dans 7 jours');
  assert.equal(liste[0].motif, 'Contenu contraire aux règles de la communauté.', 'sans motif écrit : le motif par défaut');
  assert.equal(emailsDe('awa', /suspendu pour 7 jours/).length, 1);
  assert.ok((await compte('awa')).suspendu_jusqu_a);

  // 3e faute : exclusion (sanction directe sur le membre, hors d'un signalement).
  const troisieme = await poster('chef', `/api/admin/membres/${membres.awa.identifiant}/sanctionner`, { motif: 'Insultes en message privé.' });
  assert.deepEqual([troisieme.statut, troisieme.corps.sanction], [201, 'exclusion']);
  assert.equal((await compte('awa')).bloque, true);
  assert.equal((await appel('/api/auth/moi', { qui: 'awa' })).corps.utilisateur, null, 'ses sessions sont fermées');
  const connexion = await appelBrut('/api/auth/connexion', { methode: 'POST', donnees: { email: adresse('awa'), motDePasse: 'kolatier-vert-48' } });
  assert.equal(connexion.statut, 403);
  assert.equal(emailsDe('awa', /compte Palabre est fermé/).length, 1);
  // Ni un membre ordinaire ni un visiteur ne peuvent sanctionner ; un administrateur ne peut pas l'être.
  assert.equal((await poster('bintou', `/api/admin/membres/${membres.cheick.identifiant}/sanctionner`, { motif: 'Je me venge.' })).statut, 403);
  assert.equal((await poster('chef', `/api/admin/membres/${membres.chef.identifiant}/sanctionner`, { motif: 'Moi-même.' })).statut, 400);
});

test('faute grave : l\'administrateur choisit directement une sanction plus forte', async () => {
  const publication = await publier('fatou', 'Une publication que l\'équipe juge grave.');
  for (const cle of ['bintou', 'cheick', 'drissa']) await signaler(cle, publication.id, { categorie: 'arnaque' });
  assert.equal((await decider((await enFile(publication.id)).id, { decision: 'sanctionner', sanction: 'peine-de-mort' })).statut, 400);
  const directe = await decider((await enFile(publication.id)).id, { decision: 'sanctionner', sanction: 'suspension', motif: 'Arnaque : demande d\'argent d\'avance.' });
  assert.equal(directe.corps.sanction, 'suspension', 'première faute, mais suspension directe');
  assert.equal((await sanctionsDe('fatou')).length, 1);
});

test('suspension : connexion possible, lecture possible, écriture refusée partout avec la date de fin', async () => {
  const moi = (await appel('/api/auth/moi', { qui: 'fatou' })).corps.utilisateur;
  assert.ok(Math.abs(new Date(moi.suspenduJusquA).getTime() - Date.now() - 7 * 86400000) < 60000);
  assert.equal((await appelBrut('/api/auth/connexion', { methode: 'POST', donnees: { email: adresse('fatou'), motDePasse: 'kolatier-vert-48' } })).statut, 200, 'elle peut se connecter');
  // Lire : oui.
  for (const chemin of ['/api/publications', '/api/messages/conversations', '/api/notifications', '/api/sanctions']) assert.equal((await appel(chemin, { qui: 'fatou' })).statut, 200, chemin);
  // Publier, commenter, écrire, demander en ami : non.
  const tentatives = [
    ['POST', '/api/publications', { type: 'idee', texte: 'Je publie pendant ma suspension ?' }],
    ['POST', `/api/publications/${membres.awa.troisFois}/commentaires`, { texte: 'Un commentaire ?' }],
    ['POST', `/api/publications/${membres.awa.troisFois}/jaime`, {}],
    ['POST', `/api/messages/avec/${membres.bintou.identifiant}`, { texte: 'Un message ?' }],
    ['POST', '/api/amis/demandes', { identifiant: membres.bintou.identifiant }],
    ['POST', '/api/signalements', { cibleType: 'publication', cible: membres.awa.troisFois, categorie: 'spam' }],
    ['PUT', '/api/profils/moi', { bio: 'Une nouvelle présentation.' }],
  ];
  for (const [methode, chemin, donnees] of tentatives) {
    const refus = await appel(chemin, { methode, qui: 'fatou', donnees });
    assert.deepEqual([refus.statut, refus.corps.code, refus.corps.suite], [403, 'compte-suspendu', '/sanctions'], `${methode} ${chemin}`);
    assert.match(refus.corps.erreur, /suspendu jusqu'au \d{2}\/\d{2}\/\d{4}/);
  }
  // Ce qui ne publie rien reste possible : marquer comme lu, régler son compte, se déconnecter.
  assert.equal((await poster('fatou', '/api/notifications/lues')).statut, 200);
  assert.equal((await appel('/api/parametres/langue', { methode: 'PUT', qui: 'fatou', donnees: { langue: 'fr' } })).statut, 200);
  // En anglais.
  assert.match((await appel('/api/publications', { methode: 'POST', qui: 'fatou', langue: 'en', donnees: { type: 'idee', texte: 'While suspended?' } })).corps.erreur, /suspended until \d{2}\/\d{2}\/\d{4}/);
  // La suspension finie (on avance la date), tout redevient possible sans rien faire.
  await pool.query('UPDATE utilisateurs SET suspendu_jusqu_a = now() - interval \'1 minute\' WHERE id = $1', [membres.fatou.id]);
  assert.equal((await appel('/api/auth/moi', { qui: 'fatou' })).corps.utilisateur.suspenduJusquA, null);
  assert.equal((await poster('fatou', '/api/publications', { type: 'idee', texte: 'De retour après ma suspension.' })).statut, 201);
  await pool.query('UPDATE utilisateurs SET suspendu_jusqu_a = now() + interval \'5 days\' WHERE id = $1', [membres.fatou.id]);
});

test('contestation : une fois par sanction, seulement la sienne ; l\'administrateur la voit et peut maintenir', async () => {
  const [sanction] = await sanctionsDe('fatou');
  const contester = (qui, id, texte) => poster(qui, `/api/sanctions/${id}/contester`, { texte });
  assert.equal((await contester('fatou', sanction.id, 'Trop court.')).statut, 400);
  assert.equal((await contester('bintou', sanction.id, 'Je conteste la sanction de quelqu\'un d\'autre, pour voir.')).statut, 400);
  assert.equal((await appelBrut(`/api/sanctions/${sanction.id}/contester`, { methode: 'POST', donnees: { texte: 'Sans être connecté, je conteste quand même.' } })).statut, 401);
  assert.equal((await contester('fatou', sanction.id, 'Espèce de connards, annulez ça tout de suite !')).corps.code, 'texte-insultant');

  // Une membre suspendue peut contester : c'est une des rares écritures qui lui restent.
  const envoyee = await contester('fatou', sanction.id, 'Ce n\'était pas une arnaque : je demandais un acompte, comme convenu avec le client.');
  assert.equal(envoyee.statut, 200);
  assert.deepEqual([envoyee.corps.sanction.contestable, envoyee.corps.sanction.contestation.decision], [false, null]);
  const deuxieme = await contester('fatou', sanction.id, 'Je conteste une deuxième fois la même sanction.');
  assert.deepEqual([deuxieme.statut, deuxieme.corps.code], [400, 'sanction-non-contestable']);

  // L'administrateur la lit dans /admin ; un membre ordinaire n'y a pas accès.
  assert.equal((await appel('/api/admin/moderation/contestations', { qui: 'bintou' })).statut, 403);
  const file = (await appel('/api/admin/moderation/contestations', { qui: 'chef' })).corps.contestations;
  const carte = file.find((c) => c.id === sanction.id);
  assert.deepEqual([carte.type, carte.membre.identifiant], ['suspension', membres.fatou.identifiant]);
  assert.match(carte.texte, /je demandais un acompte/);
  // Il maintient : la membre est prévenue, la suspension reste.
  assert.equal((await poster('chef', `/api/admin/sanctions/${sanction.id}/maintenir`)).statut, 200);
  assert.equal((await poster('chef', `/api/admin/sanctions/${sanction.id}/maintenir`)).statut, 404, 'déjà répondu');
  assert.equal((await sanctionsDe('fatou'))[0].contestation.decision, 'rejetee');
  assert.equal((await notificationsDe('fatou', 'contestation_rejetee')).length, 1);
  assert.ok((await compte('fatou')).suspendu_jusqu_a);
  assert.ok(!(await appel('/api/admin/moderation/contestations', { qui: 'chef' })).corps.contestations.some((c) => c.id === sanction.id));
});

test('annuler une sanction : la suspension tombe, le membre est prévenu, il peut de nouveau publier', async () => {
  const [sanction] = await sanctionsDe('fatou');
  assert.equal((await poster('bintou', `/api/admin/sanctions/${sanction.id}/annuler`)).statut, 403);
  assert.equal((await poster('chef', `/api/admin/sanctions/${sanction.id}/annuler`)).statut, 200);
  assert.equal((await poster('chef', `/api/admin/sanctions/${sanction.id}/annuler`)).statut, 404);
  assert.equal((await compte('fatou')).suspendu_jusqu_a, null);
  assert.deepEqual([(await sanctionsDe('fatou'))[0].annulee, (await sanctionsDe('fatou'))[0].contestable], [true, false]);
  assert.equal((await notificationsDe('fatou', 'sanction_annulee')).length, 1);
  assert.equal((await poster('fatou', '/api/publications', { type: 'idee', texte: 'Ma suspension est annulée.' })).statut, 201);
  // Une sanction annulée ne compte plus : la prochaine faute repart de l'avertissement.
  const suivante = await poster('chef', `/api/admin/membres/${membres.fatou.identifiant}/sanctionner`, { motif: 'Spam dans les commentaires.' });
  assert.equal(suivante.corps.sanction, 'avertissement');
});

test('un membre exclu conteste par le lien de l\'email ; la sanction annulée, son compte est débloqué', async () => {
  const jeton = /sanctions\?jeton=([0-9a-f]{64})/.exec(emailsDe('awa', /compte Palabre est fermé/)[0].texte)[1];
  const { rows: [garde] } = await pool.query('SELECT id, jeton_hash FROM sanctions WHERE utilisateur_id = $1 AND type = \'exclusion\'', [membres.awa.id]);
  assert.notEqual(garde.jeton_hash, jeton, 'le jeton est gardé haché');
  // Le lien montre CETTE sanction, et rien d'autre ; un faux jeton ne montre rien.
  const vue = await appelBrut(`/api/sanctions/lien?jeton=${jeton}`);
  assert.deepEqual([vue.statut, vue.corps.sanctions.length, vue.corps.sanctions[0].type, vue.corps.sanctions[0].id], [200, 1, 'exclusion', garde.id]);
  assert.equal((await appelBrut(`/api/sanctions/lien?jeton=${'f'.repeat(64)}`)).statut, 404);
  assert.equal((await appelBrut('/sanctions?jeton=x')).statut, 200, 'la page s\'ouvre sans compte');

  const conteste = await appelBrut('/api/sanctions/lien', { methode: 'POST', donnees: { jeton, texte: 'Mon compte a été utilisé par quelqu\'un d\'autre, je peux le prouver.' } });
  assert.equal(conteste.statut, 200);
  assert.equal((await appelBrut('/api/sanctions/lien', { methode: 'POST', donnees: { jeton, texte: 'Je conteste encore une fois par le même lien.' } })).statut, 400);
  assert.equal((await poster('chef', `/api/admin/sanctions/${garde.id}/annuler`)).statut, 200);
  assert.equal((await compte('awa')).bloque, false);
  assert.equal((await appelBrut('/api/auth/connexion', { methode: 'POST', donnees: { email: adresse('awa'), motDePasse: 'kolatier-vert-48' } })).statut, 200);
  const { rows: [reponse] } = await pool.query('SELECT contestation_decision FROM sanctions WHERE id = $1', [garde.id]);
  assert.equal(reponse.contestation_decision, 'acceptee');
});

test('signalement traité dans /admin : « Sanctionner » cache le contenu et sanctionne ; « Classer » compte contre le signaleur', async () => {
  const publication = await publier('ese', 'Une publication signalée une seule fois.');
  await signaler('bintou', publication.id, { categorie: 'insulte', motif: 'Ton agressif.' });
  const { rows: [signalement] } = await pool.query('SELECT id FROM signalements WHERE cible_type = \'publication\' AND cible_id = $1', [publication.id]);
  const traitee = await poster('chef', `/api/admin/signalements/${signalement.id}/traiter`, { action: 'sanctionner', motif: 'Ton agressif envers un autre membre.' });
  assert.deepEqual([traitee.statut, traitee.corps.sanction], [200, 'avertissement']);
  assert.equal(await visible(publication.id), false);
  assert.equal((await sanctionsDe('ese'))[0].motif, 'Ton agressif envers un autre membre.');

  const correcte = await publier('ese', 'Une publication tout à fait correcte.');
  const avant = (await compte('cheick')).signalements_rejetes;
  await signaler('cheick', correcte.id, { categorie: 'autre', motif: 'Je n\'aime pas cette personne.' });
  const { rows: [abusif] } = await pool.query('SELECT id FROM signalements WHERE cible_type = \'publication\' AND cible_id = $1', [correcte.id]);
  assert.equal((await poster('chef', `/api/admin/signalements/${abusif.id}/traiter`, { action: 'classer' })).statut, 200);
  assert.equal((await compte('cheick')).signalements_rejetes, avant + 1);
  assert.equal(await visible(correcte.id), true);
});

test('journal de modération : qui a décidé quoi, quand ; réservé aux administrateurs ; gardé un an', async () => {
  assert.equal((await appel('/api/admin/moderation/journal', { qui: 'bintou' })).statut, 403);
  const { rows } = await pool.query('SELECT action, membre_id, detail FROM journal_moderation WHERE admin_id = $1 ORDER BY id', [membres.chef.id]);
  const actions = rows.map((r) => r.action);
  for (const attendue of ['contenu_approuve', 'contenu_retire', 'sanction_avertissement', 'sanction_suspension', 'sanction_exclusion', 'contestation_rejetee', 'sanction_annulee', 'signalement_classer']) assert.ok(actions.includes(attendue), attendue);
  assert.ok(rows.filter((r) => r.action.startsWith('sanction_')).every((r) => r.membre_id));
  const journal = (await appel('/api/admin/moderation/journal', { qui: 'chef' })).corps.journal;
  const ligne = journal.find((j) => j.action === 'sanction_exclusion' && j.membre && j.membre.identifiant === membres.awa.identifiant);
  assert.deepEqual([ligne.detail, ligne.admin], ['Insultes en message privé.', `chef Sanction${lettres}`]);
  assert.ok(Date.now() - new Date(ligne.le).getTime() < 300000);
  // Plus d'un an : effacé par le ménage ; le reste est gardé.
  await pool.query('INSERT INTO journal_moderation (admin_id, action, detail, cree_le) VALUES ($1, \'contenu_retire\', \'vieille décision\', now() - interval \'400 days\')', [membres.chef.id]);
  assert.ok(await purgerJournalModeration() >= 1);
  const { rows: [reste] } = await pool.query('SELECT count(*) FILTER (WHERE detail = \'vieille décision\')::int AS vieilles, count(*)::int AS toutes FROM journal_moderation WHERE admin_id = $1', [membres.chef.id]);
  assert.deepEqual([reste.vieilles, reste.toutes >= rows.length], [0, true]);
});
