// Tests de « modifier » (publication et commentaire, 48 heures, historique lu par l'administrateur seulement) et de
// la corbeille des publications (invisible pour tous, restaurer, supprimer définitivement, purge après 30 jours).
const test = require('node:test');
const assert = require('node:assert/strict');
const { creerApp } = require('../src/app');
const { migrer } = require('../src/db/migrate');
const { pool } = require('../src/db/pool');
const { purger, DUREE_CORBEILLE_JOURS } = require('../src/utils/purge');
const { avecComptesPrets } = require('./aide');

let serveur;
let base;
const suffixe = Date.now();
const lettres = String(suffixe).replace(/\d/g, (chiffre) => 'abcdefghij'[chiffre]);
const adresse = (cle) => `corbeille-${cle}-${suffixe}@palabre.test`;
const membres = {};
const JPEG_1PX = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

async function appelBrut(chemin, { methode = 'GET', donnees, qui, langue } = {}) {
  const headers = {};
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
const modifier = (qui, chemin, texte) => appel(chemin, { methode: 'PUT', qui, donnees: typeof texte === 'object' ? texte : { texte } });
const supprimer = (qui, chemin) => appel(chemin, { methode: 'DELETE', qui, donnees: {} });
const publier = async (qui, texte, plus = {}) => (await poster(qui, '/api/publications', { type: 'idee', texte, ...plus })).corps.publication;
const lire = (qui, id) => appel(`/api/publications/${id}`, { qui });
const corbeilleDe = async (qui) => (await appel('/api/parametres/corbeille', { qui })).corps.publications;
// Tout ce par quoi une publication peut se voir : sa lecture, la page publique, le fil de son auteur.
async function visible(id, auteur) {
  return {
    membre: (await lire('bintou', id)).statut,
    visiteur: (await appelBrut(`/api/publications/${id}`)).statut,
    page: (await appelBrut(`/publication/${id}`)).statut,
    fil: (await appel(`/api/publications?auteur=${membres[auteur].identifiant}`, { qui: 'bintou' })).corps.publications.some((p) => p.id === id),
    sien: (await appel(`/api/publications?auteur=${membres[auteur].identifiant}`, { qui: auteur })).corps.publications.some((p) => p.id === id),
  };
}
const OUI = { membre: 200, visiteur: 200, page: 200, fil: true, sien: true };
const NON = { membre: 404, visiteur: 404, page: 404, fil: false, sien: false };

test.before(async () => {
  await migrer();
  serveur = creerApp().listen(0);
  base = `http://localhost:${serveur.address().port}`;
  for (const cle of ['awa', 'bintou', 'chef']) {
    const r = await appel('/api/auth/inscription', { methode: 'POST', donnees: { type: 'dev', prenom: cle, nomFamille: `Corbeille${lettres}`, email: adresse(cle), motDePasse: 'kolatier-vert-48', pays: 'Burkina Faso', ville: 'Koudougou' } });
    assert.equal(r.statut, 201, JSON.stringify(r.corps));
    membres[cle] = { cookie: r.entetes.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('palabre_session=')), identifiant: r.corps.utilisateur.identifiant, id: r.corps.utilisateur.id };
  }
  await pool.query('UPDATE utilisateurs SET est_admin = TRUE WHERE id = $1', [membres.chef.id]);
});

test.after(async () => {
  await pool.query('DELETE FROM utilisateurs WHERE email LIKE $1', [`corbeille-%-${suffixe}@palabre.test`]);
  await new Promise((fini) => serveur.close(fini));
  await pool.end();
});

test('modifier sa publication : le texte seulement, mention « modifiée », ancien texte gardé', async () => {
  const publication = await publier('awa', 'Une idée avec une fote.', { image: JPEG_1PX });
  assert.deepEqual([publication.modifiee, publication.modifiable], [false, true]);
  assert.equal((await lire('bintou', publication.id)).corps.publication.modifiable, false, 'modifiable pour son auteur seulement');
  const chemin = `/api/publications/${publication.id}`;

  // Seul l'auteur : ni un autre membre, ni un administrateur, ni un visiteur.
  assert.equal((await modifier('bintou', chemin, 'Texte de Bintou')).statut, 403);
  assert.equal((await modifier('chef', chemin, 'Texte du chef')).statut, 403);
  assert.equal((await appelBrut(chemin, { methode: 'PUT', donnees: { texte: 'Texte d\'un visiteur' } })).statut, 401);
  assert.equal((await modifier('awa', chemin, '')).statut, 400);
  assert.equal((await modifier('awa', chemin, 'x'.repeat(3001))).statut, 400);
  assert.equal((await lire('bintou', publication.id)).corps.publication.texte, 'Une idée avec une fote.');

  // Le type, l'image et la vidéo ne changent pas, même si on les envoie.
  const corrigee = await modifier('awa', chemin, { texte: 'Une idée avec une faute corrigée.', type: 'question', image: null, video: 'https://youtu.be/dQw4w9WgXcQ' });
  assert.equal(corrigee.statut, 200);
  const p = corrigee.corps.publication;
  assert.deepEqual([p.texte, p.modifiee, p.type, p.image, p.video], ['Une idée avec une faute corrigée.', true, 'idee', publication.image, null]);
  assert.equal(p.creeLe, publication.creeLe, 'la date de publication ne bouge pas');
  assert.equal((await lire('bintou', publication.id)).corps.publication.modifiee, true);
  // Renvoyer le même texte ne crée pas de version de plus.
  assert.equal((await modifier('awa', chemin, 'Une idée avec une faute corrigée.')).statut, 200);
  const { rows } = await pool.query('SELECT texte, auteur_id FROM historique_textes WHERE cible_type = \'publication\' AND cible_id = $1 ORDER BY id', [publication.id]);
  assert.deepEqual(rows.map((r) => ({ ...r })), [{ texte: 'Une idée avec une fote.', auteur_id: membres.awa.id }]);
  membres.awa.publication = publication.id;
});

test('après 48 heures : la publication et le commentaire ne peuvent plus être modifiés', async () => {
  const publication = await publier('awa', 'Publiée il y a deux jours.');
  const commentaire = (await poster('bintou', `/api/publications/${publication.id}/commentaires`, { texte: 'Commentaire d\'il y a deux jours.' })).corps.commentaire;
  // À 47 heures : encore possible.
  await pool.query('UPDATE publications SET cree_le = now() - interval \'47 hours\' WHERE id = $1', [publication.id]);
  await pool.query('UPDATE commentaires SET cree_le = now() - interval \'47 hours\' WHERE id = $1', [commentaire.id]);
  assert.equal((await modifier('awa', `/api/publications/${publication.id}`, 'Corrigée à la 47e heure.')).statut, 200);
  assert.equal((await modifier('bintou', `/api/publications/${publication.id}/commentaires/${commentaire.id}`, 'Corrigé à la 47e heure.')).statut, 200);
  // À 49 heures : refusé, et le serveur n'annonce plus « modifiable ».
  await pool.query('UPDATE publications SET cree_le = now() - interval \'49 hours\' WHERE id = $1', [publication.id]);
  await pool.query('UPDATE commentaires SET cree_le = now() - interval \'49 hours\' WHERE id = $1', [commentaire.id]);
  const tard = await modifier('awa', `/api/publications/${publication.id}`, 'Trop tard.');
  assert.deepEqual([tard.statut, tard.corps.code], [403, 'publication-plus-modifiable']);
  const tardCommentaire = await modifier('bintou', `/api/publications/${publication.id}/commentaires/${commentaire.id}`, 'Trop tard.');
  assert.deepEqual([tardCommentaire.statut, tardCommentaire.corps.code], [403, 'commentaire-plus-modifiable']);
  const lue = (await lire('awa', publication.id)).corps.publication;
  assert.deepEqual([lue.texte, lue.modifiable, lue.modifiee], ['Corrigée à la 47e heure.', false, true]);
  const commentaires = (await appel(`/api/publications/${publication.id}/commentaires`, { qui: 'bintou' })).corps.commentaires;
  assert.deepEqual([commentaires[0].texte, commentaires[0].modifiable, commentaires[0].modifie], ['Corrigé à la 47e heure.', false, true]);
  // En anglais, le refus est traduit.
  assert.match((await appel(`/api/publications/${publication.id}`, { methode: 'PUT', qui: 'awa', langue: 'en', donnees: { texte: 'Too late.' } })).corps.erreur, /only be edited for 48 hours/);
});

test('modifier son commentaire : par son auteur seulement, mention « modifié », ancien texte gardé', async () => {
  const id = membres.awa.publication;
  const commentaire = (await poster('bintou', `/api/publications/${id}/commentaires`, { texte: 'Bone idée.' })).corps.commentaire;
  assert.deepEqual([commentaire.modifie, commentaire.modifiable], [false, true]);
  const chemin = `/api/publications/${id}/commentaires/${commentaire.id}`;
  assert.equal((await modifier('awa', chemin, 'Texte de l\'auteure de la publication')).statut, 403);
  assert.equal((await modifier('chef', chemin, 'Texte du chef')).statut, 403);
  assert.equal((await modifier('bintou', chemin, '')).statut, 400);
  assert.equal((await modifier('bintou', `/api/publications/${id}/commentaires/999999999`, 'Rien')).statut, 404);
  // Le commentaire d'une autre publication ne se modifie pas par cette adresse.
  const autre = await publier('awa', 'Une autre publication.');
  assert.equal((await modifier('bintou', `/api/publications/${autre.id}/commentaires/${commentaire.id}`, 'Par la mauvaise porte')).statut, 404);

  const corrige = await modifier('bintou', chemin, 'Bonne idée.');
  assert.equal(corrige.statut, 200);
  assert.deepEqual([corrige.corps.commentaire.texte, corrige.corps.commentaire.modifie, corrige.corps.commentaire.auteur.identifiant], ['Bonne idée.', true, membres.bintou.identifiant]);
  // Le fil le montre aussi dans l'aperçu des derniers commentaires.
  const dansLeFil = (await lire('awa', id)).corps.publication.derniersCommentaires.find((c) => c.id === commentaire.id);
  assert.deepEqual([dansLeFil.texte, dansLeFil.modifie], ['Bonne idée.', true]);
  const { rows } = await pool.query('SELECT texte FROM historique_textes WHERE cible_type = \'commentaire\' AND cible_id = $1', [commentaire.id]);
  assert.deepEqual(rows.map((r) => r.texte), ['Bone idée.']);
  membres.bintou.commentaire = commentaire.id;
});

test('l\'ancien texte n\'est visible que par l\'administrateur, dans la carte du signalement', async () => {
  const id = membres.awa.publication;
  // Aucune route ouverte aux membres ne rend l'ancien texte.
  for (const qui of ['awa', 'bintou']) {
    const tout = (await lire(qui, id)).texte + (await appel(`/api/publications/${id}/commentaires`, { qui })).texte + (await appel(`/api/publications?auteur=${membres.awa.identifiant}`, { qui })).texte;
    assert.ok(!tout.includes('fote') && !tout.includes('Bone idée'), qui);
  }
  assert.equal((await appel('/api/admin/signalements', { qui: 'bintou' })).statut, 403);

  const envoi = await poster('bintou', '/api/signalements', { cibleType: 'publication', cible: id, motif: 'Spam ou arnaque' });
  assert.equal(envoi.statut, 201, JSON.stringify(envoi.corps));
  await poster('awa', '/api/signalements', { cibleType: 'commentaire', cible: membres.bintou.commentaire, motif: 'Autre raison' });
  const cartes = (await appel('/api/admin/signalements', { qui: 'chef' })).corps.signalements;
  // La carte ne donne pas le numéro du contenu : on la retrouve par le numéro du signalement, lu en base.
  const carteDe = async (type, cible) => {
    const { rows: [ligne] } = await pool.query('SELECT min(id) AS id FROM signalements WHERE cible_type = $1 AND cible_id = $2', [type, cible]);
    return cartes.find((c) => c.id === ligne.id);
  };
  const cartePublication = await carteDe('publication', id);
  assert.equal(cartePublication.cible.texte, 'Une idée avec une faute corrigée.');
  assert.deepEqual(cartePublication.cible.historique.map((x) => x.texte), ['Une idée avec une fote.']);
  assert.ok(cartePublication.cible.historique[0].remplaceLe);
  const carteCommentaire = await carteDe('commentaire', membres.bintou.commentaire);
  assert.deepEqual(carteCommentaire.cible.historique.map((x) => x.texte), ['Bone idée.']);
});

test('supprimer sa publication : elle part dans la corbeille, invisible pour tous, même pour son auteur dans le fil', async () => {
  const publication = await publier('awa', `À mettre à la corbeille ${suffixe}`, { image: JPEG_1PX });
  await poster('bintou', `/api/publications/${publication.id}/jaime`);
  await poster('bintou', `/api/publications/${publication.id}/commentaires`, { texte: 'Je commente avant la corbeille.' });
  assert.deepEqual(await visible(publication.id, 'awa'), OUI);
  assert.equal((await supprimer('bintou', `/api/publications/${publication.id}`)).statut, 403);

  const mise = await supprimer('awa', `/api/publications/${publication.id}`);
  assert.deepEqual([mise.statut, mise.corps.corbeille], [200, true]);
  assert.deepEqual(await visible(publication.id, 'awa'), NON);
  // Plus rien n'est possible dessus : ni j'aime, ni commentaire, ni modification, ni signalement.
  assert.equal((await poster('bintou', `/api/publications/${publication.id}/jaime`)).statut, 404);
  assert.equal((await poster('bintou', `/api/publications/${publication.id}/commentaires`, { texte: 'Trop tard ?' })).statut, 404);
  assert.equal((await modifier('awa', `/api/publications/${publication.id}`, 'Je la modifie dans la corbeille ?')).statut, 404);
  assert.equal((await poster('bintou', '/api/signalements', { cibleType: 'publication', cible: publication.id, motif: 'Spam ou arnaque' })).statut, 404);

  // Elle est dans MA corbeille, avec sa date d'effacement ; pas dans celle des autres.
  const liste = await corbeilleDe('awa');
  const ligne = liste.find((p) => p.id === publication.id);
  assert.deepEqual([ligne.texte, ligne.type, ligne.avecImage, ligne.avecVideo], [`À mettre à la corbeille ${suffixe}`, 'idee', true, false]);
  assert.equal(DUREE_CORBEILLE_JOURS, 30);
  assert.ok(Math.abs(new Date(ligne.expireLe).getTime() - new Date(ligne.supprimeeLe).getTime() - 30 * 86400000) < 1000, 'effacée 30 jours après');
  assert.deepEqual(await corbeilleDe('bintou'), []);
  assert.equal((await appelBrut('/api/parametres/corbeille')).statut, 401);
  membres.awa.jetee = publication.id;
});

test('restaurer : la publication revient avec ses j\'aime et ses commentaires ; seul son auteur peut la restaurer', async () => {
  const id = membres.awa.jetee;
  assert.equal((await poster('bintou', `/api/parametres/corbeille/${id}/restaurer`)).statut, 404);
  assert.equal((await poster('chef', `/api/parametres/corbeille/${id}/restaurer`)).statut, 404, 'même un administrateur');
  assert.deepEqual(await visible(id, 'awa'), NON);

  assert.equal((await poster('awa', `/api/parametres/corbeille/${id}/restaurer`)).statut, 200);
  assert.deepEqual(await visible(id, 'awa'), OUI);
  const revenue = (await lire('bintou', id)).corps.publication;
  assert.deepEqual([revenue.nbJaime, revenue.nbCommentaires, revenue.jaimeParMoi], [1, 1, true]);
  assert.ok(!(await corbeilleDe('awa')).some((p) => p.id === id));
  // Une deuxième fois, ou une publication qui n'est pas dans la corbeille : rien à restaurer.
  assert.equal((await poster('awa', `/api/parametres/corbeille/${id}/restaurer`)).statut, 404);
  assert.equal((await poster('awa', '/api/parametres/corbeille/abc/restaurer')).statut, 404);
});

test('supprimer définitivement : la publication, sa photo, ses commentaires et son historique partent pour de bon', async () => {
  const id = membres.awa.jetee;
  const { image } = (await lire('awa', id)).corps.publication;
  await modifier('awa', `/api/publications/${id}`, `Modifiée puis jetée ${suffixe}`);
  // On ne peut effacer définitivement que ce qui est déjà dans la corbeille, et seulement la sienne.
  assert.equal((await supprimer('awa', `/api/parametres/corbeille/${id}`)).statut, 404);
  await supprimer('awa', `/api/publications/${id}`);
  assert.equal((await supprimer('bintou', `/api/parametres/corbeille/${id}`)).statut, 404);
  assert.equal((await fetch(`${base}${image}`)).status, 200, 'tant qu\'elle est dans la corbeille, rien n\'est effacé');

  assert.equal((await supprimer('awa', `/api/parametres/corbeille/${id}`)).statut, 200);
  assert.equal((await fetch(`${base}${image}`)).status, 404);
  const { rows: [reste] } = await pool.query(
    `SELECT (SELECT count(*)::int FROM publications WHERE id = $1) AS publications, (SELECT count(*)::int FROM commentaires WHERE publication_id = $1) AS commentaires,
            (SELECT count(*)::int FROM jaime WHERE publication_id = $1) AS jaime, (SELECT count(*)::int FROM historique_textes WHERE cible_type = 'publication' AND cible_id = $1) AS historique`,
    [id],
  );
  assert.deepEqual({ ...reste }, { publications: 0, commentaires: 0, jaime: 0, historique: 0 });
  assert.equal((await poster('awa', `/api/parametres/corbeille/${id}/restaurer`)).statut, 404);
});

test('un administrateur supprime pour de bon (pas de corbeille) ; un commentaire supprimé part tout de suite', async () => {
  const publication = await publier('awa', 'Publication retirée par un administrateur.');
  const commentaire = (await poster('bintou', `/api/publications/${publication.id}/commentaires`, { texte: 'Un commentaire à retirer.' })).corps.commentaire;
  await modifier('bintou', `/api/publications/${publication.id}/commentaires/${commentaire.id}`, 'Un commentaire modifié, à retirer.');
  assert.equal((await supprimer('bintou', `/api/publications/${publication.id}/commentaires/${commentaire.id}`)).statut, 200);
  assert.deepEqual((await appel(`/api/publications/${publication.id}/commentaires`, { qui: 'awa' })).corps.commentaires, []);
  assert.equal((await pool.query('SELECT 1 FROM commentaires WHERE id = $1', [commentaire.id])).rows.length, 0);

  const retiree = await supprimer('chef', `/api/publications/${publication.id}`);
  assert.equal(retiree.statut, 200);
  assert.ok(!retiree.corps.corbeille);
  assert.equal((await pool.query('SELECT 1 FROM publications WHERE id = $1', [publication.id])).rows.length, 0);
  assert.ok(!(await corbeilleDe('awa')).some((p) => p.id === publication.id));
});

test('purge : après 30 jours dans la corbeille, le ménage efface la publication ; avant, il n\'y touche pas', async () => {
  const recente = await publier('awa', 'Dans la corbeille depuis 29 jours.');
  const ancienne = await publier('awa', 'Dans la corbeille depuis 31 jours.', { image: JPEG_1PX });
  const gardee = await publier('awa', 'Jamais supprimée.');
  for (const p of [recente, ancienne]) await supprimer('awa', `/api/publications/${p.id}`);
  await pool.query('UPDATE publications SET supprimee_le = now() - interval \'29 days\' WHERE id = $1', [recente.id]);
  await pool.query('UPDATE publications SET supprimee_le = now() - interval \'31 days\' WHERE id = $1', [ancienne.id]);
  // Une version d'un commentaire qui n'existe plus : le ménage retire aussi cet historique orphelin.
  await pool.query('INSERT INTO historique_textes (cible_type, cible_id, auteur_id, texte) VALUES (\'commentaire\', 2000000000, $1, \'orphelin\')', [membres.awa.id]);

  const bilan = await purger();
  assert.ok(bilan.corbeille >= 1, JSON.stringify(bilan));
  const { rows } = await pool.query('SELECT id FROM publications WHERE id = ANY($1::int[]) ORDER BY id', [[recente.id, ancienne.id, gardee.id]]);
  assert.deepEqual(rows.map((r) => r.id), [recente.id, gardee.id].sort((a, b) => a - b));
  assert.equal((await fetch(`${base}${ancienne.image}`)).status, 404, 'sa photo est effacée aussi');
  assert.equal((await pool.query('SELECT 1 FROM historique_textes WHERE cible_id = 2000000000')).rows.length, 0);
  // Celle de 29 jours est toujours restaurable.
  assert.equal((await poster('awa', `/api/parametres/corbeille/${recente.id}/restaurer`)).statut, 200);
  assert.equal((await lire('bintou', gardee.id)).statut, 200);
});
