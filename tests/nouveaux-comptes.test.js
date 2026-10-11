// Tests des limites des trois premiers jours d'un compte : aucun lien (publications, commentaires, présentation),
// 5 publications, 20 commentaires et 10 demandes d'ami par jour. Après trois jours, plus rien de tout cela.
const test = require('node:test');
const assert = require('node:assert/strict');
const { creerApp } = require('../src/app');
const { migrer } = require('../src/db/migrate');
const { pool } = require('../src/db/pool');
const { estNouveau, dateCourte, LIMITES, DUREE_JOURS } = require('../src/utils/nouveaux-comptes');
const { avecComptesPrets } = require('./aide');

let serveur;
let base;
const suffixe = Date.now();
const lettres = String(suffixe).replace(/\d/g, (chiffre) => 'abcdefghij'[chiffre]);
const adresse = (cle) => `neuf-${cle}-${suffixe}@palabre.test`;
const membres = {};

async function appelBrut(chemin, { methode = 'GET', donnees, qui, langue } = {}) {
  const headers = {};
  if (donnees) headers['Content-Type'] = 'application/json';
  const cookies = [qui ? membres[qui].cookie : null, langue ? `langue=${langue}` : null].filter(Boolean);
  if (cookies.length) headers.Cookie = cookies.join('; ');
  const r = await fetch(`${base}${chemin}`, { method: methode, headers, body: donnees ? JSON.stringify(donnees) : undefined });
  const texte = await r.text();
  let corps = {};
  try { corps = JSON.parse(texte); } catch { /* une page HTML */ }
  return { statut: r.status, corps, entetes: r.headers };
}
const appel = avecComptesPrets(appelBrut);
const poster = (qui, chemin, donnees = {}) => appel(chemin, { methode: 'POST', qui, donnees });
const publier = (qui, texte, plus = {}) => poster(qui, '/api/publications', { type: 'idee', texte, ...plus });
// L'aide des tests vieillit les comptes de quatre jours : ici on les remet à l'âge voulu.
const age = (cle, intervalle) => pool.query(`UPDATE utilisateurs SET cree_le = now() - interval '${intervalle}' WHERE id = $1`, [membres[cle].id]);
const profilDe = async (cle, bio) => {
  const moi = (await appel('/api/auth/moi', { qui: cle })).corps.utilisateur;
  return appel('/api/profils/moi', { methode: 'PUT', qui: cle, donnees: { prenom: moi.prenom, nomFamille: moi.nomFamille, identifiant: moi.identifiant, pays: 'Burkina Faso', ville: 'Koudougou', bio } });
};

test.before(async () => {
  await migrer();
  serveur = creerApp().listen(0);
  base = `http://localhost:${serveur.address().port}`;
  for (const cle of ['awa', 'bintou', 'cheick', 'demo', 'chef']) {
    const r = await appel('/api/auth/inscription', { methode: 'POST', donnees: { type: 'dev', prenom: cle, nomFamille: `Neuf${lettres}`, email: adresse(cle), motDePasse: 'kolatier-vert-48', pays: 'Burkina Faso', ville: 'Koudougou' } });
    assert.equal(r.statut, 201, JSON.stringify(r.corps));
    membres[cle] = { cookie: r.entetes.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('palabre_session=')), identifiant: r.corps.utilisateur.identifiant, id: r.corps.utilisateur.id };
  }
  for (const cle of ['awa', 'cheick', 'demo', 'chef']) await age(cle, '1 hour'); // des comptes tout neufs
  await pool.query('UPDATE utilisateurs SET email = $2 WHERE id = $1', [membres.demo.id, `neuf-${suffixe}@demo.palabre.dev`]);
  await pool.query('UPDATE utilisateurs SET est_admin = TRUE WHERE id = $1', [membres.chef.id]);
});

test.after(async () => {
  await pool.query('DELETE FROM utilisateurs WHERE email LIKE $1 OR email = $2 OR email LIKE $3', [`neuf-%-${suffixe}@palabre.test`, `neuf-${suffixe}@demo.palabre.dev`, `cible-%-${suffixe}@palabre.test`]);
  await new Promise((fini) => serveur.close(fini));
  await pool.end();
});

test('un compte est « nouveau » pendant 3 jours ; les comptes de démonstration et les administrateurs ne le sont pas', () => {
  const ilYA = (heures) => new Date(Date.now() - heures * 3600 * 1000);
  assert.equal(DUREE_JOURS, 3);
  assert.equal(estNouveau({ cree_le: ilYA(1), email: 'a@exemple.bf' }), true);
  assert.equal(estNouveau({ cree_le: ilYA(71), email: 'a@exemple.bf' }), true);
  assert.equal(estNouveau({ cree_le: ilYA(73), email: 'a@exemple.bf' }), false);
  assert.equal(estNouveau({ cree_le: ilYA(1), email: 'awa@demo.palabre.dev' }), false);
  assert.equal(estNouveau({ cree_le: ilYA(1), email: 'a@exemple.bf', est_admin: true }), false);
  assert.equal(estNouveau({ cree_le: ilYA(1), email: 'faux@demo.palabre.dev.exemple.bf' }), true, 'une adresse qui imite celle de la démo');
  assert.equal(dateCourte(new Date('2026-10-14T23:30:00Z')), '14/10/2026');
});

test('nouveau compte : aucun lien dans une publication, un commentaire ou la présentation, avec la date où ce sera possible', async () => {
  const { rows: [{ cree_le: creeLe }] } = await pool.query('SELECT cree_le FROM utilisateurs WHERE id = $1', [membres.awa.id]);
  const date = dateCourte(new Date(new Date(creeLe).getTime() + 3 * 86400000));
  const attendu = { erreur: `Tu pourras ajouter des liens à partir du ${date}.`, code: 'liens-nouveau-compte' };

  for (const texte of ['Mon site : https://mon-site.bf', 'Regarde github.com/awa/projet', 'www.exemple.com est en ligne']) {
    const refus = await publier('awa', texte);
    assert.deepEqual([refus.statut, refus.corps.champ, refus.corps.erreur, refus.corps.code], [400, 'texte', attendu.erreur, attendu.code], texte);
  }
  // Le lien d'une vidéo est un lien aussi.
  const video = await publier('awa', 'Ma démonstration en vidéo', { video: 'https://youtu.be/dQw4w9WgXcQ' });
  assert.deepEqual([video.statut, video.corps.champ, video.corps.code], [400, 'video', attendu.code]);
  // Sans lien, tout va bien ; un nom de technologie ou une adresse email n'est pas un lien.
  const correcte = await publier('awa', 'Je débute avec node.js et socket.io, écrivez-moi : awa@exemple.bf');
  assert.equal(correcte.statut, 201, JSON.stringify(correcte.corps));
  const id = correcte.corps.publication.id;
  const commentaire = await poster('awa', `/api/publications/${id}/commentaires`, { texte: 'La suite sur mon-blog.com' });
  assert.deepEqual([commentaire.statut, commentaire.corps.champ, commentaire.corps.code], [400, 'texte', attendu.code]);
  // Ni en modifiant après coup.
  assert.equal((await appel(`/api/publications/${id}`, { methode: 'PUT', qui: 'awa', donnees: { texte: 'Finalement : mon-site.bf' } })).corps.code, attendu.code);
  const bio = await profilDe('awa', 'Développeuse web. Mon portfolio : awa-dev.com');
  assert.deepEqual([bio.statut, bio.corps.champ, bio.corps.code], [400, 'bio', attendu.code]);
  assert.equal((await profilDe('awa', 'Développeuse web à Koudougou.')).statut, 200);
  // En anglais : le même code, la même date.
  const enAnglais = await appel('/api/publications', { methode: 'POST', qui: 'awa', langue: 'en', donnees: { type: 'idee', texte: 'See mon-site.bf' } });
  assert.equal(enAnglais.corps.erreur, `You will be able to add links from ${date}.`);
});

test('nouveau compte : 5 publications par jour, la sixième est refusée', async () => {
  assert.equal(LIMITES.publication, 5);
  // Awa a déjà publié une fois dans le test précédent.
  for (let n = 2; n <= 5; n += 1) assert.equal((await publier('awa', `Publication numéro ${n} du jour.`)).statut, 201, `publication ${n}`);
  const sixieme = await publier('awa', 'Publication numéro 6 du jour.');
  assert.deepEqual([sixieme.statut, sixieme.corps.code], [429, 'publications-nouveau-compte']);
  assert.match(sixieme.corps.erreur, /tu peux publier 5 fois par jour/);
  // Demain : les publications d'hier ne comptent plus.
  await pool.query('UPDATE publications SET cree_le = cree_le - interval \'25 hours\' WHERE auteur_id = $1', [membres.awa.id]);
  assert.equal((await publier('awa', 'Première publication du lendemain.')).statut, 201);
});

test('nouveau compte : 20 commentaires par jour', async () => {
  const publication = (await publier('bintou', 'Une publication à commenter.')).corps.publication;
  // 19 commentaires écrits directement en base, pour ne pas faire 19 appels.
  await pool.query('INSERT INTO commentaires (publication_id, auteur_id, texte) SELECT $1, $2, \'Commentaire \' || n FROM generate_series(1, 19) AS n', [publication.id, membres.cheick.id]);
  assert.equal((await poster('cheick', `/api/publications/${publication.id}/commentaires`, { texte: 'Le vingtième.' })).statut, 201);
  const refus = await poster('cheick', `/api/publications/${publication.id}/commentaires`, { texte: 'Le vingt-et-unième.' });
  assert.deepEqual([refus.statut, refus.corps.code], [429, 'commentaires-nouveau-compte']);
  // Bintou, inscrite depuis plus de trois jours, n'a pas cette limite.
  await pool.query('INSERT INTO commentaires (publication_id, auteur_id, texte) SELECT $1, $2, \'Commentaire \' || n FROM generate_series(1, 25) AS n', [publication.id, membres.bintou.id]);
  assert.equal((await poster('bintou', `/api/publications/${publication.id}/commentaires`, { texte: 'Le vingt-sixième de Bintou.' })).statut, 201);
});

test('nouveau compte : 10 demandes d\'ami par jour', async () => {
  // Onze membres à qui écrire, créés directement en base.
  const { rows: cibles } = await pool.query(
    `INSERT INTO utilisateurs (type, nom, prenom, nom_famille, identifiant, email, mot_de_passe_hash, pays, ville, email_confirme_le)
     SELECT 'client', 'Cible ' || n, 'Cible', 'Numero', 'cible-' || n || '-' || $1, 'cible-' || n || '-' || $1 || '@palabre.test', '!', 'Burkina Faso', 'Koudougou', now()
       FROM generate_series(1, 11) AS n RETURNING identifiant`,
    [String(suffixe)],
  );
  for (let n = 0; n < 10; n += 1) assert.equal((await poster('cheick', '/api/amis/demandes', { identifiant: cibles[n].identifiant })).statut, 201, `demande ${n + 1}`);
  const onzieme = await poster('cheick', '/api/amis/demandes', { identifiant: cibles[10].identifiant });
  assert.deepEqual([onzieme.statut, onzieme.corps.code], [429, 'demandes-ami-nouveau-compte']);
  assert.equal((await pool.query('SELECT count(*)::int AS nb FROM amities WHERE demandeur_id = $1', [membres.cheick.id])).rows[0].nb, 10);
});

test('après 3 jours : les liens sont acceptés et les limites disparaissent', async () => {
  await age('awa', '73 hours');
  await age('cheick', '4 days');
  const avecLien = await publier('awa', 'Mon site est en ligne : https://mon-site.bf');
  assert.equal(avecLien.statut, 201, JSON.stringify(avecLien.corps));
  assert.equal((await profilDe('awa', 'Développeuse web. Mon portfolio : awa-dev.com')).statut, 200);
  for (let n = 0; n < 6; n += 1) assert.equal((await publier('awa', `Publication ${n} d'un compte de plus de trois jours.`)).statut, 201);
  assert.equal((await poster('cheick', `/api/publications/${avecLien.corps.publication.id}/commentaires`, { texte: 'Bravo, je regarde mon-site.bf' })).statut, 201);
  // Le filtre des liens dangereux, lui, vaut toujours.
  assert.equal((await publier('awa', 'Va sur bit.ly/3xYz')).corps.code, 'lien-raccourci');
});

test('comptes de démonstration et administrateurs : jamais concernés, même tout neufs', async () => {
  for (const cle of ['demo', 'chef']) {
    assert.equal((await publier(cle, `Un lien dès le premier jour : https://exemple-${cle}.com`)).statut, 201, cle);
    for (let n = 0; n < 6; n += 1) assert.equal((await publier(cle, `Publication ${n} de ${cle}.`)).statut, 201, `${cle} ${n}`);
  }
});
