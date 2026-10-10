// Tests du tableau de bord administrateur : accès, statistiques, signalements, projets pour Facebook.
const test = require('node:test');
const assert = require('node:assert/strict');
const { creerApp } = require('../src/app');
const { migrer } = require('../src/db/migrate');
const { pool } = require('../src/db/pool');
const { avecComptesPrets } = require('./aide');
const { changerRole } = require('../src/db/admin');

let serveur;
let base;
const suffixe = Date.now();
// Le même suffixe écrit en lettres : un nom de famille n'accepte pas les chiffres.
const lettres = String(suffixe).replace(/\d/g, (chiffre) => 'abcdefghij'[chiffre]);
const membres = {}; // chef (admin), awa, bintou, cheick, dao (devs), kadi (cliente)

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
const signaler = (qui, cibleType, cible, motif = 'Spam ou arnaque') => poster(qui, '/api/signalements', { cibleType, cible, motif });
const traiter = (carte, action, qui = 'chef') => poster(qui, `/api/admin/signalements/${carte.id}/traiter`, { action });

// La carte du tableau de bord qui concerne ce contenu (les autres fichiers de tests en créent aussi).
async function carteDe(cibleType, texte) {
  const { corps } = await appel('/api/admin/signalements', { qui: 'chef' });
  return corps.signalements.find((c) => c.cibleType === cibleType && c.cible && c.cible.texte.includes(texte));
}

async function publier(qui, texte) {
  return (await poster(qui, '/api/publications', { type: 'idee', texte })).corps.publication;
}

test.before(async () => {
  await migrer();
  serveur = creerApp().listen(0);
  base = `http://localhost:${serveur.address().port}`;
  const comptes = { chef: 'dev', awa: 'dev', bintou: 'dev', cheick: 'dev', dao: 'dev', kadi: 'client' };
  for (const [prenom, type] of Object.entries(comptes)) {
    const email = `admin-${prenom}-${suffixe}@palabre.test`;
    const r = await appel('/api/auth/inscription', {
      methode: 'POST',
      donnees: { type, prenom, nomFamille: `Admin${lettres}`, email, motDePasse: 'motdepasse1', pays: 'Burkina Faso', ville: 'Bobo-Dioulasso' },
    });
    assert.equal(r.statut, 201);
    membres[prenom] = { cookie: r.entetes.get('set-cookie').split(';')[0], identifiant: r.corps.utilisateur.identifiant, email };
  }
});

test.after(async () => {
  await pool.query('DELETE FROM utilisateurs WHERE email = ANY($1)', [Object.values(membres).map((m) => m.email)]);
  serveur.close();
  await pool.end();
});

test('le rôle administrateur se donne par la commande du serveur, pas par le site', async () => {
  assert.equal((await appel('/api/auth/moi', { qui: 'chef' })).corps.utilisateur.estAdmin, false);
  // Un membre ne peut pas se nommer administrateur en l'ajoutant à ses données de profil.
  await appel('/api/profils/moi', {
    methode: 'PUT', qui: 'awa',
    donnees: { prenom: 'awa', nomFamille: `Admin${lettres}`, identifiant: membres.awa.identifiant, pays: 'Burkina Faso', ville: 'Bobo-Dioulasso', est_admin: true, estAdmin: true },
  });
  assert.equal((await appel('/api/auth/moi', { qui: 'awa' })).corps.utilisateur.estAdmin, false);

  assert.equal(await changerRole('personne@palabre.test', true), null, 'compte inconnu');
  const promu = await changerRole(membres.chef.email.toUpperCase(), true);
  assert.equal(promu.identifiant, membres.chef.identifiant);
  assert.equal((await appel('/api/auth/moi', { qui: 'chef' })).corps.utilisateur.estAdmin, true);
});

test('le tableau de bord est fermé aux visiteurs et aux membres ordinaires', async () => {
  const routes = [
    ['GET', '/api/admin/statistiques'], ['GET', '/api/admin/signalements'], ['GET', '/api/admin/projets-facebook'],
    ['GET', '/api/admin/membres-bloques'], ['POST', '/api/admin/signalements/1/traiter'],
    ['POST', '/api/admin/projets/1/facebook'], ['POST', `/api/admin/membres/${membres.awa.identifiant}/debloquer`],
  ];
  for (const [methode, chemin] of routes) {
    const donnees = methode === 'POST' ? { action: 'classer', decision: 'valide' } : undefined;
    assert.equal((await appel(chemin, { methode, donnees })).statut, 401, `visiteur : ${chemin}`);
    assert.equal((await appel(chemin, { methode, donnees, qui: 'awa' })).statut, 403, `dev : ${chemin}`);
    assert.equal((await appel(chemin, { methode, donnees, qui: 'kadi' })).statut, 403, `cliente : ${chemin}`);
  }
});

test('statistiques : les compteurs suivent l\'activité', async () => {
  const avant = (await appel('/api/admin/statistiques', { qui: 'chef' })).corps.statistiques;
  for (const cle of ['devs', 'clients', 'membresBloques', 'publications', 'demandes', 'projets', 'propositionsAcceptees', 'signalementsOuverts', 'projetsFacebook']) {
    assert.ok(Number.isInteger(avant[cle]) && avant[cle] >= 0, cle);
  }
  assert.ok(avant.devs >= 5 && avant.clients >= 1);

  await publier('awa', 'Publication pour les statistiques');
  const { corps: { demande } } = await poster('kadi', '/api/demandes', { titre: 'Demande pour les statistiques', description: 'Une demande créée pour vérifier les compteurs.', categorie: 'autre' });
  await poster('awa', `/api/demandes/${demande.id}/propositions`, { message: 'Je peux le faire rapidement.' });
  const { propositions } = (await appel(`/api/demandes/${demande.id}`, { qui: 'kadi' })).corps;
  await poster('kadi', `/api/demandes/${demande.id}/choisir`, { propositionId: propositions[0].id });
  await poster('awa', '/api/projets', { titre: 'Projet pour les statistiques', secteur: 'autre' });

  // Les autres fichiers de tests écrivent dans la même base en même temps : on compte directement en base
  // juste avant et juste après l'appel. Quand les deux comptages sont identiques, rien n'a bougé entre-temps
  // et les statistiques doivent donner exactement les mêmes nombres.
  const compter = async () => (await pool.query(
    `SELECT (SELECT count(*)::int FROM utilisateurs WHERE type = 'dev' AND NOT bloque) AS devs,
            (SELECT count(*)::int FROM utilisateurs WHERE type = 'client' AND NOT bloque) AS clients,
            (SELECT count(*)::int FROM publications WHERE NOT masque) AS publications,
            (SELECT count(*)::int FROM demandes WHERE NOT masque) AS demandes,
            (SELECT count(*)::int FROM projets WHERE NOT masque) AS projets,
            (SELECT count(*)::int FROM propositions WHERE statut = 'acceptee') AS "propositionsAcceptees"`,
  )).rows[0];
  let compare = false;
  for (let essai = 0; essai < 20 && !compare; essai += 1) {
    const baseAvant = await compter();
    const { statistiques } = (await appel('/api/admin/statistiques', { qui: 'chef' })).corps;
    const baseApres = await compter();
    if (JSON.stringify(baseAvant) !== JSON.stringify(baseApres)) continue;
    for (const [cle, valeur] of Object.entries(baseAvant)) assert.equal(statistiques[cle], valeur, cle);
    assert.ok(statistiques.publications >= 1 && statistiques.demandes >= 1 && statistiques.projets >= 1 && statistiques.propositionsAcceptees >= 1);
    compare = true;
  }
  assert.ok(compare, 'la base n\'a jamais été stable assez longtemps pour comparer');
});

test('signalement : masquer le contenu le fait disparaître, pour tous les signalements qui le visent', async () => {
  const publication = await publier('awa', `Arnaque ${suffixe} : gagnez un million`);
  await signaler('bintou', 'publication', publication.id, 'Spam ou arnaque');
  await signaler('cheick', 'publication', publication.id, 'Contenu choquant ou illégal : faux gains');

  const carte = await carteDe('publication', `Arnaque ${suffixe}`);
  assert.equal(carte.signalements.length, 2, 'une seule carte pour les deux signalements');
  assert.deepEqual(carte.signalements.map((s) => s.auteur.identifiant).sort(), [membres.bintou.identifiant, membres.cheick.identifiant].sort());
  assert.equal(carte.cible.membre.identifiant, membres.awa.identifiant);
  assert.equal(carte.cible.masquable, true);
  assert.equal(carte.signalements[0].auteur.email, undefined);

  assert.equal((await traiter(carte, 'supprimer-tout')).corps.champ, 'action');
  assert.equal((await traiter(carte, 'masquer')).statut, 200);

  assert.ok(!(await appel('/api/publications', { qui: 'dao' })).corps.publications.some((p) => p.id === publication.id), 'absente du fil');
  assert.equal((await poster('dao', `/api/publications/${publication.id}/jaime`)).statut, 404);
  assert.equal(await carteDe('publication', `Arnaque ${suffixe}`), undefined, 'plus rien à traiter');
  const { rows } = await pool.query('SELECT statut FROM signalements WHERE cible_type = \'publication\' AND cible_id = $1', [publication.id]);
  assert.deepEqual(rows.map((r) => r.statut), ['traite', 'traite']);
  assert.equal((await traiter(carte, 'masquer')).statut, 404, 'déjà traité');
  assert.equal((await poster('chef', '/api/admin/signalements/999999999/traiter', { action: 'classer' })).statut, 404);
});

test('signalement : classer sans suite ne change rien au contenu', async () => {
  const publication = await publier('awa', 'Publication normale');
  const { corps: { commentaire } } = await poster('bintou', `/api/publications/${publication.id}/commentaires`, { texte: `Commentaire sans problème ${suffixe}` });
  await signaler('cheick', 'commentaire', commentaire.id, 'Insultes ou harcèlement');

  const carte = await carteDe('commentaire', `Commentaire sans problème ${suffixe}`);
  assert.equal(carte.cible.membre.identifiant, membres.bintou.identifiant);
  assert.equal((await traiter(carte, 'classer')).statut, 200);

  assert.equal((await appel(`/api/publications/${publication.id}/commentaires`, { qui: 'dao' })).corps.commentaires.length, 1, 'le commentaire est toujours là');
  const { rows } = await pool.query('SELECT statut FROM signalements WHERE cible_type = \'commentaire\' AND cible_id = $1', [commentaire.id]);
  assert.equal(rows[0].statut, 'rejete');
  assert.equal(await carteDe('commentaire', `Commentaire sans problème ${suffixe}`), undefined);
});

test('signalement : masquer un projet et une demande', async () => {
  const { corps: { projet } } = await poster('awa', '/api/projets', { titre: `Projet volé ${suffixe}`, secteur: 'autre' });
  await signaler('bintou', 'projet', projet.id, 'Faux profil ou usurpation');
  const carteProjet = await carteDe('projet', `Projet volé ${suffixe}`);
  assert.equal(carteProjet.cible.lien, `/projets/${projet.id}`);
  assert.equal((await traiter(carteProjet, 'masquer')).statut, 200);
  assert.equal((await appel(`/api/projets/${projet.id}`)).statut, 404);
  assert.equal((await appel(`/projets/${projet.id}`)).statut, 404, 'la page publique aussi');
  assert.ok(!(await appel(`/api/profils/${membres.awa.identifiant}`)).corps.profil.projets.some((p) => p.id === projet.id));

  const { corps: { demande } } = await poster('kadi', '/api/demandes', { titre: `Demande douteuse ${suffixe}`, description: 'Cette demande sert à tester le masquage par un administrateur.', categorie: 'autre' });
  assert.equal((await signaler('kadi', 'demande', demande.id)).statut, 400, 'pas sa propre demande');
  await signaler('awa', 'demande', demande.id);
  const carteDemande = await carteDe('demande', `Demande douteuse ${suffixe}`);
  assert.equal((await traiter(carteDemande, 'masquer')).statut, 200);
  assert.equal((await appel(`/api/demandes/${demande.id}`, { qui: 'awa' })).statut, 404);
});

test('signalement : bloquer le membre, puis le débloquer', async () => {
  const publication = await publier('dao', `Publication de Dao ${suffixe}`);
  await signaler('awa', 'profil', membres.dao.identifiant, 'Faux profil ou usurpation');
  const { corps } = await appel('/api/admin/signalements', { qui: 'chef' });
  const carte = corps.signalements.find((c) => c.cibleType === 'profil' && c.cible?.membre.identifiant === membres.dao.identifiant);
  assert.equal(carte.cible.masquable, false);
  assert.equal(carte.cible.lien, `/${membres.dao.identifiant}`);

  assert.equal((await traiter(carte, 'masquer')).statut, 400, 'un profil ne se masque pas');
  assert.equal((await traiter(carte, 'bloquer')).statut, 200);

  // Le membre bloqué est déconnecté, son profil et ses publications disparaissent.
  assert.equal((await appel('/api/publications', { qui: 'dao' })).statut, 401);
  assert.equal((await appel('/api/auth/moi', { qui: 'dao' })).corps.utilisateur, null);
  assert.equal((await appel(`/api/profils/${membres.dao.identifiant}`)).statut, 404);
  assert.equal((await appel(`/${membres.dao.identifiant}`)).statut, 404);
  assert.ok(!(await appel('/api/publications', { qui: 'awa' })).corps.publications.some((p) => p.id === publication.id));
  const connexion = await appel('/api/auth/connexion', { methode: 'POST', donnees: { email: membres.dao.email, motDePasse: 'motdepasse1' } });
  assert.notEqual(connexion.statut, 200, 'il ne peut plus se connecter');

  const bloques = (await appel('/api/admin/membres-bloques', { qui: 'chef' })).corps.membres;
  assert.ok(bloques.some((m) => m.identifiant === membres.dao.identifiant));
  assert.equal((await poster('chef', `/api/admin/membres/${membres.dao.identifiant}/debloquer`)).statut, 200);
  assert.equal((await poster('chef', `/api/admin/membres/${membres.dao.identifiant}/debloquer`)).statut, 404);
  assert.equal((await appel(`/api/profils/${membres.dao.identifiant}`)).statut, 200);
  assert.equal((await appel('/api/publications', { qui: 'dao' })).statut, 200, 'sa session fonctionne de nouveau');
});

test('signalement : un administrateur ne peut pas être bloqué ; contenu supprimé entre-temps', async () => {
  const duChef = await publier('chef', `Publication du chef ${suffixe}`);
  await signaler('awa', 'publication', duChef.id);
  const carteChef = await carteDe('publication', `Publication du chef ${suffixe}`);
  assert.equal(carteChef.cible.membreEstAdmin, true);
  assert.equal((await traiter(carteChef, 'bloquer')).statut, 400);
  assert.equal((await appel('/api/auth/moi', { qui: 'chef' })).corps.utilisateur.estAdmin, true, 'toujours connecté');
  assert.equal((await traiter(carteChef, 'classer')).statut, 200);

  // L'auteur supprime sa publication avant que l'administrateur ne regarde.
  const ephemere = await publier('bintou', 'Publication vite supprimée');
  await signaler('awa', 'publication', ephemere.id);
  await appel(`/api/publications/${ephemere.id}`, { methode: 'DELETE', qui: 'bintou', donnees: {} });
  const { rows: [ligne] } = await pool.query('SELECT id FROM signalements WHERE cible_type = \'publication\' AND cible_id = $1', [ephemere.id]);
  const orpheline = (await appel('/api/admin/signalements', { qui: 'chef' })).corps.signalements.find((c) => c.id === ligne.id);
  assert.equal(orpheline.cible, null, 'la carte signale que le contenu n\'existe plus');
  assert.equal((await traiter(orpheline, 'bloquer')).statut, 400);
  assert.equal((await traiter(orpheline, 'classer')).statut, 200);
});

test('projets pour Facebook : seuls ceux dont le dev a donné son accord, à valider ou refuser', async () => {
  const avecAccord = (await poster('bintou', '/api/projets', { titre: `Projet à montrer ${suffixe}`, secteur: 'commerce', publierFacebook: true })).corps.projet;
  const autre = (await poster('bintou', '/api/projets', { titre: `Projet à refuser ${suffixe}`, secteur: 'commerce', publierFacebook: true })).corps.projet;
  const sansAccord = (await poster('bintou', '/api/projets', { titre: `Projet discret ${suffixe}`, secteur: 'commerce' })).corps.projet;

  const enAttente = async () => (await appel('/api/admin/projets-facebook', { qui: 'chef' })).corps.projets.map((p) => p.id);
  const liste = await enAttente();
  assert.ok(liste.includes(avecAccord.id) && liste.includes(autre.id));
  assert.ok(!liste.includes(sansAccord.id), 'sans accord du dev, le projet n\'est jamais proposé');

  const decider = (id, decision) => poster('chef', `/api/admin/projets/${id}/facebook`, { decision });
  assert.equal((await decider(avecAccord.id, 'publier-maintenant')).corps.champ, 'decision');
  assert.equal((await decider(sansAccord.id, 'valide')).statut, 404);
  assert.equal((await decider(avecAccord.id, 'valide')).statut, 200);
  assert.equal((await decider(avecAccord.id, 'refuse')).statut, 404, 'une seule décision');
  assert.equal((await decider(autre.id, 'refuse')).statut, 200);

  const { rows } = await pool.query('SELECT id, statut_facebook FROM projets WHERE id = ANY($1) ORDER BY id', [[avecAccord.id, autre.id, sansAccord.id]]);
  assert.deepEqual(rows.map((r) => r.statut_facebook), ['valide', 'refuse', 'non']);
  const restants = await enAttente();
  assert.ok(!restants.includes(avecAccord.id) && !restants.includes(autre.id));

  const notifications = (await appel('/api/notifications', { qui: 'bintou' })).corps.notifications.filter((n) => n.type === 'projet_facebook');
  assert.equal(notifications.length, 2);
  assert.match(notifications[1].texte, /a été retenu/);
  assert.equal((await appel(`/api/projets/${autre.id}`)).statut, 200, 'un projet refusé pour Facebook reste visible sur Palabre');
});
