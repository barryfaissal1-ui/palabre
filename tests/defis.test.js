// Tests du défi de la semaine : création par l'administrateur, réponses, vote, désignation du gagnant.
const test = require('node:test');
const assert = require('node:assert/strict');
const { creerApp } = require('../src/app');
const { migrer } = require('../src/db/migrate');
const { pool } = require('../src/db/pool');
const { changerRole } = require('../src/db/admin');
const liens = require('../src/utils/liens');
const { avecComptesPrets } = require('./aide');

let serveur;
let base;
const suffixe = Date.now();
const lettres = String(suffixe).replace(/\d/g, (chiffre) => 'abcdefghij'[chiffre]);
const membres = {}; // chef (admin), awa, bintou, cheick (devs), dao (dev au profil incomplet), kadi (cliente)
let misDeCote = []; // défis déjà présents dans la base (démonstration) : { id, statut }, cachés le temps des tests
let defi; // le défi créé par les tests

// Pas d'internet dans les tests : seul « github.com » répond.
const vraiVerifierLien = liens.verifierLien;
liens.verifierLien = async (lien) => lien.includes('github.com');

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
const dans = (heures) => new Date(Date.now() + heures * 3600 * 1000).toISOString();
const TEXTE = 'Je propose une file d\'attente de SMS avec reprise automatique en cas de coupure réseau.';
const courant = async (qui) => (await appel('/api/defis/courant', { qui })).corps;
const repondre = (qui, donnees = { texte: TEXTE }) => poster(qui, `/api/defis/${defi}/reponse`, donnees);
const voter = (qui, pour) => poster(qui, `/api/defis/${defi}/vote`, { reponseId: pour });
// Fait « avancer l'horloge » : on recule une date du défi au lieu d'attendre.
const passer = (colonne) => pool.query(`UPDATE defis SET ${colonne} = now() - interval '1 minute' WHERE id = $1`, [defi]);

test.before(async () => {
  await migrer();
  serveur = creerApp().listen(0);
  base = `http://localhost:${serveur.address().port}`;
  // Un seul défi peut être en cours : ceux qui sont déjà dans la base sont mis de côté, puis remis à la fin.
  misDeCote = (await pool.query('SELECT id, statut FROM defis WHERE statut IN (\'ouvert\', \'termine\')')).rows;
  await pool.query('UPDATE defis SET statut = \'refuse\' WHERE id = ANY($1)', [misDeCote.map((d) => d.id)]);
  for (const [cle, type] of Object.entries({ chef: 'dev', awa: 'dev', bintou: 'dev', cheick: 'dev', dao: 'dev', kadi: 'client' })) {
    const email = `defi-${cle}-${suffixe}@palabre.test`;
    const r = await appel('/api/auth/inscription', { methode: 'POST', donnees: { type, prenom: cle, nomFamille: `Defi${lettres}`, email, motDePasse: 'kolatier-vert-48', pays: 'Burkina Faso', ville: 'Koudougou' } });
    assert.equal(r.statut, 201);
    membres[cle] = { cookie: r.entetes.get('set-cookie').split(';')[0], identifiant: r.corps.utilisateur.identifiant, email };
  }
  await changerRole(membres.chef.email, true);
  await pool.query('UPDATE utilisateurs SET profil_complete_le = NULL WHERE email = $1', [membres.dao.email]);
});

test.after(async () => {
  liens.verifierLien = vraiVerifierLien;
  await pool.query('DELETE FROM defis WHERE titre LIKE $1', [`%${suffixe}`]);
  for (const ancien of misDeCote) await pool.query('UPDATE defis SET statut = $2 WHERE id = $1', [ancien.id, ancien.statut]);
  await pool.query('DELETE FROM utilisateurs WHERE email = ANY($1)', [Object.values(membres).map((m) => m.email)]);
  serveur.close();
  await pool.end();
});

test('créer un défi : réservé à l\'administrateur, dates contrôlées, un seul à la fois', async () => {
  const fiche = { titre: `Envoyer des SMS sans réseau stable ${suffixe}`, probleme: 'Un commerçant veut prévenir ses clients par SMS, mais le réseau coupe souvent. Comment être sûr que chaque message part une fois, et une seule ?', finReponsesLe: dans(24), finVoteLe: dans(72) };
  assert.equal((await appel('/api/admin/defis', { methode: 'POST', donnees: fiche })).statut, 401);
  assert.equal((await poster('awa', '/api/admin/defis', fiche)).statut, 403);
  assert.equal((await appel('/api/admin/defis', { qui: 'kadi' })).statut, 403);
  for (const [extra, champ] of [
    [{ titre: 'Hop' }, 'titre'], [{ probleme: 'Trop court' }, 'probleme'], [{ finReponsesLe: 'demain' }, 'finReponsesLe'],
    [{ finReponsesLe: dans(-1) }, 'finReponsesLe'], [{ finVoteLe: dans(12) }, 'finVoteLe'], [{ finVoteLe: dans(24 * 90) }, 'finVoteLe'], [{ finVoteLe: undefined }, 'finVoteLe'],
  ]) {
    const r = await poster('chef', '/api/admin/defis', { ...fiche, ...extra });
    assert.equal(r.statut, 400, champ);
    assert.equal(r.corps.champ, champ);
  }
  assert.equal((await courant()).defi, null, 'aucun défi pour l\'instant');

  const cree = await poster('chef', '/api/admin/defis', fiche);
  assert.equal(cree.statut, 201);
  defi = cree.corps.id;
  const deuxieme = await poster('chef', '/api/admin/defis', { ...fiche, titre: `Un autre défi ${suffixe}` });
  assert.equal(deuxieme.statut, 400);
  assert.match(deuxieme.corps.erreur, /déjà en cours/);

  // Tout le monde peut le lire, même sans compte.
  const vu = await courant();
  assert.equal(vu.defi.id, defi);
  assert.equal(vu.defi.phase, 'reponses');
  assert.equal(vu.defi.nbReponses, 0);
  assert.equal(vu.peutRepondre, false);
  const resume = (await appel('/api/defis/resume')).corps.defi;
  assert.equal(resume.titre, fiche.titre);
  assert.equal(resume.probleme, undefined, 'le résumé ne porte pas tout l\'énoncé');
});

test('répondre : un dev au profil complet, une seule réponse, modifiable tant que c\'est ouvert', async () => {
  assert.equal((await appel(`/api/defis/${defi}/reponse`, { methode: 'POST', donnees: { texte: TEXTE } })).statut, 401);
  assert.equal((await repondre('kadi')).statut, 403, 'une cliente ne répond pas');
  const incomplet = await repondre('dao');
  assert.equal(incomplet.statut, 403);
  assert.equal(incomplet.corps.suite, '/bienvenue');
  assert.equal((await courant('dao')).profilIncomplet, true);
  // Texte de 20 à 2000 caractères, lien contrôlé comme ceux des projets.
  assert.equal((await repondre('awa', { texte: 'Trop court.' })).corps.champ, 'texte');
  assert.equal((await repondre('awa', { texte: 'x'.repeat(2001) })).corps.champ, 'texte');
  assert.equal((await repondre('awa', { texte: TEXTE, lien: 'http://127.0.0.1/admin' })).corps.champ, 'lien');
  assert.equal((await repondre('awa', { texte: TEXTE, lien: 'javascript:alert(1)' })).corps.champ, 'lien');
  assert.equal((await poster('awa', '/api/defis/999999999/reponse', { texte: TEXTE })).statut, 404);

  const premiere = await repondre('awa', { texte: TEXTE, lien: 'github.com/awa/sms' });
  assert.equal(premiere.statut, 201);
  assert.equal(premiere.corps.lienVerifie, true);
  // Répondre de nouveau, c'est modifier sa réponse : toujours une seule ligne.
  const seconde = await repondre('awa', { texte: `${TEXTE} Version 2.`, lien: 'https://exemple.org/sms' });
  assert.equal(seconde.statut, 200);
  assert.equal(seconde.corps.modifiee, true);
  assert.equal(seconde.corps.reponseId, premiere.corps.reponseId);
  const { rows } = await pool.query('SELECT texte FROM defi_reponses WHERE defi_id = $1', [defi]);
  assert.equal(rows.length, 1);
  assert.match(rows[0].texte, /Version 2\.$/);

  assert.equal((await repondre('bintou', { texte: `${TEXTE} (Bintou)` })).statut, 201);
  assert.equal((await repondre('cheick', { texte: `${TEXTE} (Cheick)` })).statut, 201);
  // Retirer sa réponse, puis la remettre.
  assert.equal((await appel(`/api/defis/${defi}/reponse`, { methode: 'DELETE', qui: 'cheick', donnees: {} })).statut, 200);
  assert.equal((await appel(`/api/defis/${defi}/reponse`, { methode: 'DELETE', qui: 'cheick', donnees: {} })).statut, 404);
  assert.equal((await repondre('cheick', { texte: `${TEXTE} (Cheick)` })).statut, 201);

  const vu = await courant('awa');
  assert.equal(vu.peutRepondre, true);
  assert.equal(vu.peutVoter, false);
  assert.equal(vu.reponses.length, 3);
  const mienne = vu.reponses.find((r) => r.estMoi);
  assert.equal(mienne.auteur.identifiant, membres.awa.identifiant);
  assert.equal(mienne.lien, 'https://exemple.org/sms');
  assert.equal(mienne.lienVerifie, false, 'le nouveau lien a été revisité');
  assert.ok(!JSON.stringify(vu).includes('@palabre.test'), 'jamais d\'email');
  // Le vote n'est pas encore ouvert.
  const tropTot = await voter('kadi', mienne.id);
  assert.equal(tropTot.statut, 400);
  assert.match(tropTot.corps.erreur, /pas encore ouvert/);
});

test('voter : une fois les réponses closes, un seul vote par membre, jamais pour soi', async () => {
  await passer('fin_reponses_le');
  const vu = await courant('awa');
  assert.equal(vu.defi.phase, 'vote');
  assert.equal(vu.peutRepondre, false);
  assert.equal(vu.peutVoter, true);
  const de = (cle) => vu.reponses.find((r) => r.auteur.identifiant === membres[cle].identifiant).id;
  // Les réponses sont closes : ni nouvelle réponse, ni modification, ni retrait.
  assert.match((await repondre('awa', { texte: `${TEXTE} Version 3.` })).corps.erreur, /closes/);
  assert.equal((await appel(`/api/defis/${defi}/reponse`, { methode: 'DELETE', qui: 'awa', donnees: {} })).statut, 400);

  assert.equal((await appel(`/api/defis/${defi}/vote`, { methode: 'POST', donnees: { reponseId: de('awa') } })).statut, 401);
  const pourSoi = await voter('awa', de('awa'));
  assert.equal(pourSoi.statut, 400);
  assert.match(pourSoi.corps.erreur, /propre réponse/);
  assert.equal((await voter('awa', 999999999)).statut, 404);
  assert.equal((await voter('awa', undefined)).statut, 404);

  // Awa vote pour Bintou, puis change d'avis : toujours un seul vote.
  assert.equal((await voter('awa', de('bintou'))).statut, 200);
  assert.equal((await voter('awa', de('cheick'))).statut, 200);
  const { rows } = await pool.query('SELECT reponse_id FROM defi_votes WHERE defi_id = $1', [defi]);
  assert.deepEqual(rows, [{ reponse_id: de('cheick') }]);
  // Une cliente et un dev au profil incomplet peuvent voter aussi.
  assert.equal((await voter('kadi', de('bintou'))).statut, 200);
  assert.equal((await voter('dao', de('bintou'))).statut, 200);
  assert.equal((await voter('bintou', de('cheick'))).statut, 200);

  // Pendant le vote, les compteurs ne sont pas montrés ; chacun voit seulement son propre vote.
  const pendant = await courant('awa');
  assert.ok(pendant.reponses.every((r) => r.nbVotes === null && r.gagnante === false));
  assert.deepEqual(pendant.reponses.filter((r) => r.monVote).map((r) => r.id), [de('cheick')]);
  assert.ok((await courant()).reponses.every((r) => r.monVote === false), 'un visiteur n\'a pas de vote');
  membres.bintou.reponse = de('bintou');
});

test('fin du vote : le gagnant est désigné une seule fois (égalité : la réponse la plus ancienne)', async () => {
  await passer('fin_vote_le');
  // Bintou et Cheick ont 2 votes chacun ; Bintou a répondu la première : elle gagne.
  // Plusieurs lectures au même instant ne doivent désigner (et prévenir) qu'une fois.
  const lectures = await Promise.all([courant('awa'), courant('kadi'), courant(), appel('/api/defis/resume')]);
  const fin = lectures[0];
  assert.equal(fin.defi.phase, 'termine');
  assert.equal(fin.peutVoter, false);
  assert.equal(fin.reponses[0].id, membres.bintou.reponse, 'la gagnante est en premier');
  assert.equal(fin.reponses[0].gagnante, true);
  assert.deepEqual(fin.reponses.map((r) => r.nbVotes), [2, 2, 0]);
  assert.equal(fin.reponses.filter((r) => r.gagnante).length, 1);

  const { rows: [enBase] } = await pool.query('SELECT statut, gagnant_reponse_id, (SELECT email FROM utilisateurs WHERE id = gagnant_id) AS email FROM defis WHERE id = $1', [defi]);
  assert.deepEqual(enBase, { statut: 'termine', gagnant_reponse_id: membres.bintou.reponse, email: membres.bintou.email });
  const notifications = (await appel('/api/notifications', { qui: 'bintou' })).corps.notifications.filter((n) => n.type === 'defi_gagne');
  assert.equal(notifications.length, 1);
  assert.match(notifications[0].texte, /a gagné le défi/);
  assert.equal((await appel('/api/notifications', { qui: 'cheick' })).corps.notifications.filter((n) => n.type === 'defi_gagne').length, 0);

  // Le badge « Gagnant du défi » : sur son profil, pas sur celui des autres.
  assert.equal((await appel(`/api/profils/${membres.bintou.identifiant}`)).corps.profil.nbDefisGagnes, 1);
  assert.equal((await appel(`/api/profils/${membres.cheick.identifiant}`)).corps.profil.nbDefisGagnes, 0);
  // Tout est clos.
  assert.match((await voter('kadi', membres.bintou.reponse)).corps.erreur, /terminé/);
  assert.match((await repondre('awa')).corps.erreur, /closes/);
  const liste = (await appel('/api/admin/defis', { qui: 'chef' })).corps.defis.find((d) => d.id === defi);
  assert.equal(liste.phase, 'termine');
  assert.equal(liste.gagnant, `bintou Defi${lettres}`);
  assert.equal(liste.nbVotes, 4);
});

test('défi sans aucun vote : pas de gagnant ; l\'administrateur peut supprimer un défi', async () => {
  const cree = await poster('chef', '/api/admin/defis', { titre: `Défi sans vote ${suffixe}`, probleme: 'Un second défi, auquel une seule personne répond et pour lequel personne ne vote.', finReponsesLe: dans(1), finVoteLe: dans(2) });
  assert.equal(cree.statut, 201, 'le précédent étant terminé, un nouveau défi peut être créé');
  defi = cree.corps.id;
  assert.equal((await courant()).defi.id, defi, 'le défi en cours passe devant le défi terminé');
  assert.equal((await repondre('cheick')).statut, 201);
  await passer('fin_reponses_le');
  await passer('fin_vote_le');
  const fin = await courant('cheick');
  assert.equal(fin.defi.phase, 'termine');
  assert.equal(fin.reponses[0].gagnante, false);
  assert.equal((await pool.query('SELECT gagnant_id FROM defis WHERE id = $1', [defi])).rows[0].gagnant_id, null);
  assert.equal((await appel(`/api/profils/${membres.cheick.identifiant}`)).corps.profil.nbDefisGagnes, 0);

  assert.equal((await appel(`/api/admin/defis/${defi}`, { methode: 'DELETE', qui: 'awa', donnees: {} })).statut, 403);
  assert.equal((await appel(`/api/admin/defis/${defi}`, { methode: 'DELETE', qui: 'chef', donnees: {} })).statut, 200);
  assert.equal((await appel(`/api/admin/defis/${defi}`, { methode: 'DELETE', qui: 'chef', donnees: {} })).statut, 404);
  assert.equal((await pool.query('SELECT count(*)::int AS nb FROM defi_reponses WHERE defi_id = $1', [defi])).rows[0].nb, 0, 'ses réponses partent avec lui');
});

test('page /defis, adresse réservée et service worker', async () => {
  const page = await fetch(`${base}/defis`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>Défi de la semaine/);
  assert.ok(require('../src/utils/validation').IDENTIFIANTS_RESERVES.has('defis'));
  const sw = await (await fetch(`${base}/sw.js`)).text();
  for (const fichier of ['/defis', '/js/defis.js']) assert.ok(sw.includes(`'${fichier}'`), fichier);
});
