// Tests de la base de savoir : le filtre du fil par type, la meilleure réponse d'une question (droits, changement,
// suppression, notification, compteur du profil) et la recherche dans les publications (corbeille, comptes bloqués
// ou désactivés, confidentialité).
const test = require('node:test');
const assert = require('node:assert/strict');
const { creerApp } = require('../src/app');
const { migrer } = require('../src/db/migrate');
const { pool } = require('../src/db/pool');
const { IDENTIFIANTS_RESERVES } = require('../src/utils/validation');
const { avecComptesPrets } = require('./aide');

let serveur;
let base;
const suffixe = Date.now();
const lettres = String(suffixe).replace(/\d/g, (chiffre) => 'abcdefghij'[chiffre]);
// Un mot que personne d'autre n'écrit : les recherches de ce fichier ne trouvent que ses propres publications.
const MOT = `baobab${lettres}`;
const adresse = (cle) => `savoir-${cle}-${suffixe}@palabre.test`;
const membres = {};

async function appelBrut(chemin, { methode = 'GET', donnees, qui } = {}) {
  const headers = {};
  if (donnees) headers['Content-Type'] = 'application/json';
  if (qui) headers.Cookie = membres[qui].cookie;
  const r = await fetch(`${base}${chemin}`, { method: methode, headers, body: donnees ? JSON.stringify(donnees) : undefined });
  const texte = await r.text();
  let corps = {};
  try { corps = JSON.parse(texte); } catch { /* une page HTML */ }
  return { statut: r.status, corps, texte, entetes: r.headers };
}
const appel = avecComptesPrets(appelBrut);
const poster = (qui, chemin, donnees = {}) => appel(chemin, { methode: 'POST', qui, donnees });
const publier = async (qui, type, texte) => (await poster(qui, '/api/publications', { type, texte })).corps.publication;
const commenter = async (qui, id, texte) => (await poster(qui, `/api/publications/${id}/commentaires`, { texte })).corps.commentaire;
const retenir = (qui, id, commentaireId) => appel(`/api/publications/${id}/meilleure-reponse`, { methode: 'PUT', qui, donnees: { commentaireId } });
const retirer = (qui, id) => appel(`/api/publications/${id}/meilleure-reponse`, { methode: 'DELETE', qui, donnees: {} });
const lire = async (qui, id) => (await appel(`/api/publications/${id}`, { qui })).corps.publication;
const profil = async (cle) => (await appel(`/api/profils/${membres[cle].identifiant}`, { qui: 'awa' })).corps.profil;
// Le fil d'un auteur, avec un filtre : on ne compte jamais sur le fil de tout le monde (d'autres tests y publient).
const filDe = async (qui, auteur, type) => (await appel(`/api/publications?auteur=${membres[auteur].identifiant}${type ? `&type=${type}` : ''}`, { qui })).corps.publications.map((p) => p.id);
const chercher = async (qui, q, plus = '') => (await appel(`/api/publications/recherche?q=${encodeURIComponent(q)}${plus}`, { qui })).corps.publications.map((p) => p.id);
const notifsDe = async (qui) => (await pool.query("SELECT type, texte, lien, lue FROM notifications WHERE utilisateur_id = $1 AND type = 'meilleure_reponse' ORDER BY id", [membres[qui].id])).rows;

test.before(async () => {
  await migrer();
  serveur = creerApp().listen(0);
  base = `http://localhost:${serveur.address().port}`;
  for (const cle of ['awa', 'bintou', 'cheick', 'dao', 'chef']) {
    const r = await appel('/api/auth/inscription', { methode: 'POST', donnees: { type: 'dev', prenom: cle, nomFamille: `Savoir${lettres}`, email: adresse(cle), motDePasse: 'kolatier-vert-48', pays: 'Burkina Faso', ville: 'Koudougou' } });
    assert.equal(r.statut, 201, JSON.stringify(r.corps));
    membres[cle] = { cookie: r.entetes.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('palabre_session=')), identifiant: r.corps.utilisateur.identifiant, id: r.corps.utilisateur.id };
  }
  await pool.query('UPDATE utilisateurs SET est_admin = TRUE WHERE id = $1', [membres.chef.id]);
});

test.after(async () => {
  await pool.query('DELETE FROM utilisateurs WHERE email LIKE $1', [`savoir-%-${suffixe}@palabre.test`]);
  await new Promise((fini) => serveur.close(fini));
  await pool.end();
});

test('filtre du fil par type : questions, idées, projets, sans réponse, avec « Mes amis » et la page suivante', async () => {
  const idee = await publier('dao', 'idee', 'Une idée de Dao.');
  const projet = await publier('dao', 'projet', 'Un projet de Dao.');
  const resolue = await publier('dao', 'question', 'Une question de Dao, bientôt résolue ?');
  const ouverte = await publier('dao', 'question', 'Une question de Dao, encore ouverte ?');
  const reponse = await commenter('chef', resolue.id, 'La réponse du chef.');
  assert.equal((await retenir('dao', resolue.id, reponse.id)).statut, 200);

  assert.deepEqual(await filDe('awa', 'dao'), [ouverte.id, resolue.id, projet.id, idee.id], 'sans filtre : tout');
  assert.deepEqual(await filDe('awa', 'dao', 'question'), [ouverte.id, resolue.id]);
  assert.deepEqual(await filDe('awa', 'dao', 'idee'), [idee.id]);
  assert.deepEqual(await filDe('awa', 'dao', 'projet'), [projet.id]);
  assert.deepEqual(await filDe('awa', 'dao', 'sans-reponse'), [ouverte.id], 'une question résolue n\'y est plus');
  assert.deepEqual(await filDe('awa', 'dao', 'nimporte'), [ouverte.id, resolue.id, projet.id, idee.id], 'un type inconnu ne filtre rien');
  assert.equal((await appelBrut('/api/publications?type=question')).statut, 401, 'le fil reste réservé aux membres');

  // Avec « Mes amis » : Awa n'est pas amie avec Dao, Cheick l'est.
  await poster('cheick', '/api/amis/demandes', { identifiant: membres.dao.identifiant });
  await poster('dao', `/api/amis/demandes/${membres.cheick.identifiant}/accepter`);
  const amis = async (qui) => (await appel(`/api/publications?amis=1&type=sans-reponse&auteur=${membres.dao.identifiant}`, { qui })).corps.publications.map((p) => p.id);
  assert.deepEqual(await amis('cheick'), [ouverte.id]);
  assert.deepEqual(await amis('awa'), []);

  // La page suivante garde le filtre : 12 questions, 10 puis 2, jamais une idée au milieu.
  const questions = [];
  for (let i = 0; i < 12; i += 1) {
    questions.push((await publier('chef', 'question', `Question ${i} du chef ?`)).id);
    await publier('chef', 'idee', `Idée ${i} du chef.`);
  }
  const page1 = (await appel(`/api/publications?auteur=${membres.chef.identifiant}&type=question`, { qui: 'awa' })).corps;
  assert.equal(page1.publications.length, 10);
  assert.ok(page1.publications.every((p) => p.type === 'question'));
  const page2 = (await appel(`/api/publications?auteur=${membres.chef.identifiant}&type=question&avant=${page1.suivant}`, { qui: 'awa' })).corps;
  assert.deepEqual([...page1.publications, ...page2.publications].map((p) => p.id), [...questions].reverse());
  assert.equal(page2.suivant, null);

  // Corbeille et confidentialité : les mêmes règles que le fil sans filtre.
  await appel(`/api/publications/${ouverte.id}`, { methode: 'DELETE', qui: 'dao', donnees: {} });
  assert.deepEqual(await filDe('awa', 'dao', 'sans-reponse'), [], 'dans la corbeille : plus dans le filtre');
  await appel('/api/parametres/confidentialite', { methode: 'PUT', qui: 'dao', donnees: { cle: 'publications', valeur: 'amis' } });
  assert.deepEqual(await filDe('awa', 'dao', 'question'), [], 'amis seulement : rien pour Awa');
  assert.deepEqual(await filDe('cheick', 'dao', 'question'), [resolue.id], 'mais son ami Cheick les voit');
  await appel('/api/parametres/confidentialite', { methode: 'PUT', qui: 'dao', donnees: { cle: 'publications', valeur: 'tous' } });
});

test('meilleure réponse : seul l\'auteur d\'une question, jamais pour son propre commentaire', async () => {
  const question = await publier('awa', 'question', 'Comment sauvegarder une base PostgreSQL chaque nuit ?');
  assert.deepEqual([question.resolue, question.meilleureReponse], [false, null]);
  const deBintou = await commenter('bintou', question.id, 'Avec pg_dump et une tâche planifiée.');
  const deCheick = await commenter('cheick', question.id, 'Pense à tester la restauration.');
  const deAwa = await commenter('awa', question.id, 'Merci à vous deux.');

  // Les refus : un visiteur, un autre membre, l'auteur de la réponse, un administrateur, son propre commentaire.
  assert.equal((await appelBrut(`/api/publications/${question.id}/meilleure-reponse`, { methode: 'PUT', donnees: { commentaireId: deBintou.id } })).statut, 401);
  for (const qui of ['bintou', 'cheick', 'chef']) assert.equal((await retenir(qui, question.id, deBintou.id)).statut, 403, qui);
  const sienne = await retenir('awa', question.id, deAwa.id);
  assert.equal(sienne.statut, 403);
  assert.match(sienne.corps.erreur, /ta propre réponse/);
  // Un commentaire d'une autre publication, ou qui n'existe pas.
  const ailleurs = await publier('awa', 'question', 'Une autre question ?');
  const autre = await commenter('bintou', ailleurs.id, 'Une autre réponse.');
  assert.equal((await retenir('awa', question.id, autre.id)).statut, 404);
  assert.equal((await retenir('awa', question.id, 999999999)).statut, 404);
  assert.equal((await retenir('awa', question.id, 'abc')).statut, 404);
  // Seulement sur une question.
  const idee = await publier('awa', 'idee', 'Une idée, pas une question.');
  const surIdee = await commenter('bintou', idee.id, 'Bonne idée.');
  const refus = await retenir('awa', idee.id, surIdee.id);
  assert.equal(refus.statut, 403);
  assert.match(refus.corps.erreur, /Seule une question/);
  assert.equal((await lire('awa', question.id)).resolue, false, 'aucun refus n\'a rien changé');
  assert.deepEqual(await notifsDe('bintou'), []);

  // L'auteur choisit la réponse de Bintou.
  const choix = await retenir('awa', question.id, deBintou.id);
  assert.deepEqual([choix.statut, choix.corps.meilleureReponse], [200, deBintou.id]);
  const lue = await lire('cheick', question.id);
  assert.equal(lue.resolue, true);
  assert.deepEqual([lue.meilleureReponse.id, lue.meilleureReponse.meilleure, lue.meilleureReponse.auteur.identifiant], [deBintou.id, true, membres.bintou.identifiant]);
  assert.ok(!lue.derniersCommentaires.some((c) => c.id === deBintou.id), 'la meilleure réponse n\'est pas montrée deux fois');
  // Dans la liste complète, elle vient en premier ; les autres restent dans l'ordre.
  const { commentaires } = (await appel(`/api/publications/${question.id}/commentaires`, { qui: 'cheick' })).corps;
  assert.deepEqual(commentaires.map((c) => [c.id, c.meilleure]), [[deBintou.id, true], [deCheick.id, false], [deAwa.id, false]]);
  // Un visiteur la voit aussi sur la page publique.
  assert.equal((await appelBrut(`/api/publications/${question.id}`)).corps.publication.meilleureReponse.id, deBintou.id);

  // Bintou est prévenue, une seule fois même si l'auteur clique deux fois.
  await retenir('awa', question.id, deBintou.id);
  const recues = await notifsDe('bintou');
  assert.equal(recues.length, 1);
  assert.deepEqual([recues[0].lien, recues[0].lue], [`/publication/${question.id}`, false]);
  assert.match(recues[0].texte, /a retenu ta réponse comme meilleure réponse/);
  const cloche = (await appel('/api/notifications', { qui: 'bintou' })).corps.notifications.find((n) => n.type === 'meilleure_reponse');
  assert.equal(cloche.acteur.identifiant, membres.awa.identifiant);
  assert.equal((await profil('bintou')).nbReponsesRetenues, 1);
  assert.equal((await profil('cheick')).nbReponsesRetenues, 0);

  // Changer d'avis : la réponse de Cheick remplace celle de Bintou (une seule meilleure réponse).
  assert.equal((await retenir('awa', question.id, deCheick.id)).statut, 200);
  assert.equal((await lire('awa', question.id)).meilleureReponse.id, deCheick.id);
  assert.deepEqual(await notifsDe('bintou'), [], 'la notification non lue de Bintou n\'a plus de sens');
  assert.equal((await notifsDe('cheick')).length, 1);
  assert.deepEqual([(await profil('bintou')).nbReponsesRetenues, (await profil('cheick')).nbReponsesRetenues], [0, 1]);

  // L'enlever : seul l'auteur, et la question redevient « sans réponse ».
  assert.equal((await retirer('cheick', question.id)).statut, 403);
  assert.equal((await retirer('awa', question.id)).statut, 200);
  const apres = await lire('awa', question.id);
  assert.deepEqual([apres.resolue, apres.meilleureReponse], [false, null]);
  assert.ok((await filDe('bintou', 'awa', 'sans-reponse')).includes(question.id));
  assert.equal((await profil('cheick')).nbReponsesRetenues, 0);
});

test('meilleure réponse supprimée, masquée, ou auteur désactivé : la question redevient « sans réponse »', async () => {
  const sansReponse = async (id) => (await filDe('chef', 'awa', 'sans-reponse')).includes(id);
  const question = await publier('awa', 'question', 'Quel hébergeur pour une petite API ?');

  // Le commentaire est supprimé par son auteur.
  let reponse = await commenter('bintou', question.id, 'Un petit serveur suffit.');
  await retenir('awa', question.id, reponse.id);
  assert.equal(await sansReponse(question.id), false);
  await appel(`/api/publications/${question.id}/commentaires/${reponse.id}`, { methode: 'DELETE', qui: 'bintou', donnees: {} });
  assert.deepEqual([(await lire('awa', question.id)).resolue, await sansReponse(question.id)], [false, true]);

  // Le commentaire est masqué par un administrateur.
  reponse = await commenter('bintou', question.id, 'Une autre réponse.');
  await retenir('awa', question.id, reponse.id);
  await pool.query('UPDATE commentaires SET masque = TRUE WHERE id = $1', [reponse.id]);
  assert.deepEqual([(await lire('awa', question.id)).resolue, await sansReponse(question.id), (await profil('bintou')).nbReponsesRetenues], [false, true, 0]);
  assert.equal((await retenir('awa', question.id, reponse.id)).statut, 404, 'on ne retient pas un commentaire masqué');

  // L'auteur de la réponse désactive son compte.
  reponse = await commenter('cheick', question.id, 'La réponse de Cheick.');
  await retenir('awa', question.id, reponse.id);
  assert.equal((await lire('awa', question.id)).resolue, true);
  await pool.query('UPDATE utilisateurs SET desactive_le = now() WHERE id = $1', [membres.cheick.id]);
  const lue = await lire('awa', question.id);
  assert.deepEqual([lue.resolue, lue.meilleureReponse, await sansReponse(question.id)], [false, null, true]);
  // Il revient : sa réponse aussi.
  await pool.query('UPDATE utilisateurs SET desactive_le = NULL WHERE id = $1', [membres.cheick.id]);
  assert.equal((await lire('awa', question.id)).resolue, true);

  // La question part à la corbeille : la réponse retenue ne compte plus sur le profil de Cheick.
  assert.equal((await profil('cheick')).nbReponsesRetenues, 1);
  await appel(`/api/publications/${question.id}`, { methode: 'DELETE', qui: 'awa', donnees: {} });
  assert.equal((await profil('cheick')).nbReponsesRetenues, 0);
  assert.equal((await retenir('awa', question.id, reponse.id)).statut, 404, 'une publication dans la corbeille n\'existe plus');
});

test('recherche : les mots, les accents, les questions résolues d\'abord, le filtre par type', async () => {
  const idee = await publier('awa', 'idee', `Astuce ${MOT} : le Déploiement automatique fait gagner du temps.`);
  const ouverte = await publier('awa', 'question', `${MOT} : comment faire un déploiement sans coupure ?`);
  const resolue = await publier('awa', 'question', `${MOT} : quel outil pour surveiller un serveur ?`);
  const reponse = await commenter('bintou', resolue.id, 'Un tableau de bord Grafana, simple à installer.');
  await retenir('awa', resolue.id, reponse.id);
  const projet = await publier('bintou', 'projet', `Mon projet ${MOT} est en ligne.`);

  // Les questions résolues d'abord, puis les plus récentes.
  assert.deepEqual(await chercher('cheick', MOT), [resolue.id, projet.id, ouverte.id, idee.id]);
  // Tous les mots doivent y être ; ni les majuscules ni les accents ne comptent.
  assert.deepEqual(await chercher('cheick', `${MOT} deploiement`), [ouverte.id, idee.id]);
  assert.deepEqual(await chercher('cheick', `DÉPLOIEMENT ${MOT.toUpperCase()}`), [ouverte.id, idee.id]);
  assert.deepEqual(await chercher('cheick', `${MOT} introuvablexyz`), []);
  // Le texte de la meilleure réponse compte aussi : c'est elle, le savoir.
  assert.deepEqual(await chercher('cheick', `${MOT} grafana`), [resolue.id]);
  // Par type.
  assert.deepEqual(await chercher('cheick', MOT, '&type=question'), [resolue.id, ouverte.id]);
  assert.deepEqual(await chercher('cheick', MOT, '&type=sans-reponse'), [ouverte.id]);
  assert.deepEqual(await chercher('cheick', MOT, '&type=projet'), [projet.id]);
  // La liste courte de l'en-tête : légère, quatre résultats au plus.
  const court = (await appel(`/api/publications/recherche?q=${MOT}&court=1`, { qui: 'cheick' })).corps;
  assert.deepEqual(court.publications.map((p) => [p.id, p.resolue]), [[resolue.id, true], [projet.id, false], [ouverte.id, false], [idee.id, false]]);
  assert.deepEqual(Object.keys(court.publications[0]).sort(), ['auteur', 'id', 'resolue', 'texte', 'type']);

  // Les jokers de LIKE sont cherchés tels quels, et rien ne plante avec des guillemets.
  assert.deepEqual(await chercher('cheick', `${MOT.slice(0, 4)}%${MOT.slice(6)}`), []);
  assert.deepEqual(await chercher('cheick', `${MOT} ' OR 1=1 --`), []);
  // Trop court, absent, ou sans compte.
  for (const q of ['', 'a', '  ', '% _']) assert.equal((await appel(`/api/publications/recherche?q=${encodeURIComponent(q)}`, { qui: 'cheick' })).statut, 400, `« ${q} »`);
  assert.equal((await appel('/api/publications/recherche', { qui: 'cheick' })).statut, 400);
  assert.equal((await appelBrut(`/api/publications/recherche?q=${MOT}`)).statut, 401, 'la recherche est réservée aux membres, comme le fil');
});

test('recherche : la page suivante, sans doublon ni oubli', async () => {
  const mot = `${MOT}pages`;
  const toutes = [];
  for (let i = 0; i < 13; i += 1) {
    const question = await publier('cheick', 'question', `${mot} question ${i} ?`);
    toutes.push(question.id);
    if (i % 4 === 0) await retenir('cheick', question.id, (await commenter('bintou', question.id, `Réponse ${i}.`)).id);
  }
  const resolues = toutes.filter((_, i) => i % 4 === 0).reverse();
  const autres = toutes.filter((_, i) => i % 4 !== 0).reverse();
  const page1 = (await appel(`/api/publications/recherche?q=${mot}`, { qui: 'awa' })).corps;
  assert.equal(page1.publications.length, 10);
  assert.match(page1.suivant, /^0-\d+$/);
  const page2 = (await appel(`/api/publications/recherche?q=${mot}&apres=${page1.suivant}`, { qui: 'awa' })).corps;
  assert.deepEqual([...page1.publications, ...page2.publications].map((p) => p.id), [...resolues, ...autres]);
  assert.equal(page2.suivant, null);
  // Un curseur farfelu est ignoré : on repart du début.
  assert.equal((await appel(`/api/publications/recherche?q=${mot}&apres=abc`, { qui: 'awa' })).corps.publications.length, 10);
});

test('recherche : corbeille, publication masquée, compte bloqué ou désactivé, « amis seulement »', async () => {
  const mot = `${MOT}secret`;
  const deAwa = await publier('awa', 'idee', `${mot} : une idée d'Awa.`);
  const deDao = await publier('dao', 'question', `${mot} : une question de Dao ?`);
  assert.deepEqual(await chercher('bintou', mot), [deDao.id, deAwa.id]);

  // Corbeille : introuvable pour tous, même pour son auteur ; restaurée, elle revient.
  await appel(`/api/publications/${deAwa.id}`, { methode: 'DELETE', qui: 'awa', donnees: {} });
  assert.deepEqual([await chercher('bintou', mot), await chercher('awa', mot)], [[deDao.id], [deDao.id]]);
  await poster('awa', `/api/parametres/corbeille/${deAwa.id}/restaurer`);
  assert.deepEqual(await chercher('bintou', mot), [deDao.id, deAwa.id]);

  // Masquée par un administrateur.
  await pool.query('UPDATE publications SET masque = TRUE WHERE id = $1', [deAwa.id]);
  assert.deepEqual(await chercher('bintou', mot), [deDao.id]);
  await pool.query('UPDATE publications SET masque = FALSE WHERE id = $1', [deAwa.id]);

  // Auteur bloqué, puis désactivé.
  for (const colonne of ['bloque = TRUE', 'desactive_le = now()']) {
    await pool.query(`UPDATE utilisateurs SET ${colonne} WHERE id = $1`, [membres.dao.id]);
    assert.deepEqual(await chercher('bintou', mot), [deAwa.id], colonne);
    await pool.query('UPDATE utilisateurs SET bloque = FALSE, desactive_le = NULL WHERE id = $1', [membres.dao.id]);
  }

  // Confidentialité « amis seulement » : Cheick est ami de Dao (premier test), Bintou non. Aucune fuite, ni dans la
  // page de résultats, ni dans la liste courte de l'en-tête, ni par le texte d'une meilleure réponse.
  const reponse = await commenter('cheick', deDao.id, `${mot}reponse : la réponse de Cheick.`);
  await retenir('dao', deDao.id, reponse.id);
  await appel('/api/parametres/confidentialite', { methode: 'PUT', qui: 'dao', donnees: { cle: 'publications', valeur: 'amis' } });
  assert.deepEqual(await chercher('bintou', mot), [deAwa.id]);
  assert.deepEqual(await chercher('bintou', `${mot}reponse`), []);
  assert.deepEqual((await appel(`/api/publications/recherche?q=${mot}&court=1`, { qui: 'bintou' })).corps.publications.map((p) => p.id), [deAwa.id]);
  assert.deepEqual(await chercher('cheick', mot), [deDao.id, deAwa.id], 'son ami la trouve');
  assert.deepEqual(await chercher('dao', `${mot}reponse`), [deDao.id], 'et lui-même aussi');
  await appel('/api/parametres/confidentialite', { methode: 'PUT', qui: 'dao', donnees: { cle: 'publications', valeur: 'tous' } });

  // La meilleure réponse d'un compte désactivé ne fait plus trouver la question.
  assert.deepEqual(await chercher('bintou', `${mot}reponse`), [deDao.id]);
  await pool.query('UPDATE utilisateurs SET desactive_le = now() WHERE id = $1', [membres.cheick.id]);
  assert.deepEqual(await chercher('bintou', `${mot}reponse`), []);
  await pool.query('UPDATE utilisateurs SET desactive_le = NULL WHERE id = $1', [membres.cheick.id]);
});

test('la page /recherche existe, son adresse est réservée, et le service worker la garde', async () => {
  const page = await appelBrut('/recherche?q=test');
  assert.equal(page.statut, 200);
  assert.match(page.texte, /js\/recherche\.js/);
  assert.ok(IDENTIFIANTS_RESERVES.has('recherche'));
  const sw = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', 'sw.js'), 'utf8');
  for (const fichier of ['/recherche', '/js/recherche.js']) assert.ok(sw.includes(`'${fichier}'`), fichier);
});
