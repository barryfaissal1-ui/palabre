// Tests du réseau social : fil, j'aime, commentaires, amis, signalements.
const test = require('node:test');
const assert = require('node:assert/strict');
const { creerApp } = require('../src/app');
const { migrer } = require('../src/db/migrate');
const { pool } = require('../src/db/pool');

let serveur;
let base;
const suffixe = Date.now();
// Le même suffixe écrit en lettres : un nom de famille n'accepte pas les chiffres.
const lettres = String(suffixe).replace(/\d/g, (chiffre) => 'abcdefghij'[chiffre]);
const membres = {}; // awa, bintou, cheick : { cookie, identifiant, email }

async function appel(chemin, { methode = 'GET', donnees, qui } = {}) {
  const headers = {};
  if (donnees) headers['Content-Type'] = 'application/json';
  if (qui) headers.Cookie = membres[qui].cookie;
  const r = await fetch(`${base}${chemin}`, { method: methode, headers, body: donnees ? JSON.stringify(donnees) : undefined });
  const texte = await r.text();
  let corps;
  try { corps = JSON.parse(texte); } catch { corps = texte; }
  return { statut: r.status, corps, entetes: r.headers };
}

// Une vraie petite image JPEG (1 × 1 pixel), encodée en base64.
const JPEG_1PX = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

async function publier(qui, texte, extra = {}) {
  return appel('/api/publications', { methode: 'POST', qui, donnees: { type: 'idee', texte, ...extra } });
}

test.before(async () => {
  await migrer();
  serveur = creerApp().listen(0);
  base = `http://localhost:${serveur.address().port}`;
  for (const prenom of ['awa', 'bintou', 'cheick']) {
    const email = `social-${prenom}-${suffixe}@palabre.test`;
    const r = await appel('/api/auth/inscription', {
      methode: 'POST',
      donnees: { type: 'dev', prenom, nomFamille: `Social${lettres}`, email, motDePasse: 'motdepasse1', pays: 'Burkina Faso', ville: 'Koudougou' },
    });
    assert.equal(r.statut, 201);
    membres[prenom] = { cookie: r.entetes.get('set-cookie').split(';')[0], identifiant: r.corps.utilisateur.identifiant, email };
  }
});

test.after(async () => {
  // Publications, commentaires, j'aime, amitiés, signalements et images partent avec les comptes (ON DELETE CASCADE).
  await pool.query('DELETE FROM utilisateurs WHERE email = ANY($1)', [Object.values(membres).map((m) => m.email)]);
  serveur.close();
  await pool.end();
});

// ---------- Fil ----------

test('le fil et la publication sont réservés aux membres connectés', async () => {
  assert.equal((await appel('/api/publications')).statut, 401);
  assert.equal((await appel('/api/publications', { methode: 'POST', donnees: { type: 'idee', texte: 'Bonjour' } })).statut, 401);
});

test('publier : type inconnu et texte vide refusés', async () => {
  const mauvaisType = await publier('awa', 'Bonjour', { type: 'publicite' });
  assert.equal(mauvaisType.statut, 400);
  assert.equal(mauvaisType.corps.champ, 'type');
  const vide = await publier('awa', '   ');
  assert.equal(vide.statut, 400);
  assert.equal(vide.corps.champ, 'texte');
  assert.equal((await publier('awa', 'x'.repeat(3001))).statut, 400);
});

test('publier une question avec une image', async () => {
  const r = await publier('awa', 'Qui connaît une API Mobile Money ?', { type: 'question', image: JPEG_1PX });
  assert.equal(r.statut, 201);
  const p = r.corps.publication;
  assert.equal(p.type, 'question');
  assert.equal(p.auteur.identifiant, membres.awa.identifiant);
  assert.equal(p.estMoi, true);
  assert.equal(p.nbJaime, 0);
  assert.match(p.image, /^\/fichiers\/[0-9a-f-]{36}$/);
  assert.equal(p.auteur.email, undefined, 'jamais d\'email dans le fil');
  assert.equal(p.auteur.whatsapp, undefined);

  const image = await fetch(`${base}${p.image}`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/jpeg');
});

test('un faux fichier image est refusé dans une publication', async () => {
  const faux = `data:image/jpeg;base64,${Buffer.from('<script>alert(1)</script>').toString('base64')}`;
  const r = await publier('awa', 'Regardez', { image: faux });
  assert.equal(r.statut, 400);
});

test('le fil est chargé par 10, du plus récent au plus ancien', async () => {
  for (let i = 1; i <= 12; i += 1) {
    assert.equal((await publier('bintou', `Publication numéro ${i}`)).statut, 201);
  }
  const page1 = await appel('/api/publications', { qui: 'awa' });
  assert.equal(page1.statut, 200);
  assert.equal(page1.corps.publications.length, 10);
  assert.equal(page1.corps.publications[0].texte, 'Publication numéro 12');
  assert.equal(page1.corps.publications[9].texte, 'Publication numéro 3');
  assert.equal(page1.corps.publications[0].estMoi, false);
  assert.ok(page1.corps.suivant, 'il reste des publications');

  const page2 = await appel(`/api/publications?avant=${page1.corps.suivant}`, { qui: 'awa' });
  assert.equal(page2.corps.publications[0].texte, 'Publication numéro 2');
  const ids = new Set([...page1.corps.publications, ...page2.corps.publications].map((p) => p.id));
  assert.equal(ids.size, page1.corps.publications.length + page2.corps.publications.length, 'aucun doublon entre les pages');
});

// ---------- J'aime ----------

test('aimer une publication une seule fois, puis ne plus aimer', async () => {
  const { corps: { publication } } = await publier('awa', 'Publication à aimer');
  const chemin = `/api/publications/${publication.id}/jaime`;

  const un = await appel(chemin, { methode: 'POST', qui: 'bintou', donnees: {} });
  assert.deepEqual(un.corps, { nbJaime: 1, jaimeParMoi: true });
  const deux = await appel(chemin, { methode: 'POST', qui: 'bintou', donnees: {} });
  assert.equal(deux.corps.nbJaime, 1, 'un deuxième clic ne compte pas double');
  await appel(chemin, { methode: 'POST', qui: 'cheick', donnees: {} });

  const fil = await appel('/api/publications', { qui: 'awa' });
  const vue = fil.corps.publications.find((p) => p.id === publication.id);
  assert.equal(vue.nbJaime, 2);
  assert.equal(vue.jaimeParMoi, false);

  const retire = await appel(chemin, { methode: 'DELETE', qui: 'bintou', donnees: {} });
  assert.deepEqual(retire.corps, { nbJaime: 1, jaimeParMoi: false });
  assert.equal((await appel('/api/publications/999999999/jaime', { methode: 'POST', qui: 'bintou', donnees: {} })).statut, 404);
  assert.equal((await appel('/api/publications/abc/jaime', { methode: 'POST', qui: 'bintou', donnees: {} })).statut, 404);
});

// ---------- Commentaires ----------

test('commenter, lire et supprimer son commentaire', async () => {
  const { corps: { publication } } = await publier('awa', 'Publication à commenter');
  const chemin = `/api/publications/${publication.id}/commentaires`;

  assert.equal((await appel(chemin, { methode: 'POST', qui: 'bintou', donnees: { texte: '' } })).statut, 400);
  const c1 = await appel(chemin, { methode: 'POST', qui: 'bintou', donnees: { texte: 'Bravo <b>Awa</b>' } });
  assert.equal(c1.statut, 201);
  assert.equal(c1.corps.commentaire.texte, 'Bravo <b>Awa</b>', 'le texte est gardé tel quel, la page l\'affiche avec textContent');
  assert.equal(c1.corps.commentaire.auteur.identifiant, membres.bintou.identifiant);
  await appel(chemin, { methode: 'POST', qui: 'cheick', donnees: { texte: 'Deuxième' } });

  const liste = await appel(chemin, { qui: 'awa' });
  assert.deepEqual(liste.corps.commentaires.map((c) => c.texte), ['Bravo <b>Awa</b>', 'Deuxième']);
  const fil = await appel('/api/publications', { qui: 'awa' });
  assert.equal(fil.corps.publications.find((p) => p.id === publication.id).nbCommentaires, 2);

  const idCommentaire = c1.corps.commentaire.id;
  assert.equal((await appel(`${chemin}/${idCommentaire}`, { methode: 'DELETE', qui: 'cheick', donnees: {} })).statut, 403);
  assert.equal((await appel(`${chemin}/${idCommentaire}`, { methode: 'DELETE', qui: 'bintou', donnees: {} })).statut, 200);
  assert.equal((await appel(chemin, { qui: 'awa' })).corps.commentaires.length, 1);
});

test('seul l\'auteur peut supprimer sa publication, et son image part avec', async () => {
  const { corps: { publication } } = await publier('awa', 'Publication à supprimer', { image: JPEG_1PX });
  const chemin = `/api/publications/${publication.id}`;
  assert.equal((await appel(chemin, { methode: 'DELETE', qui: 'bintou', donnees: {} })).statut, 403);
  assert.equal((await appel(chemin, { methode: 'DELETE', qui: 'awa', donnees: {} })).statut, 200);
  assert.equal((await appel(chemin, { methode: 'DELETE', qui: 'awa', donnees: {} })).statut, 404);
  assert.equal((await fetch(`${base}${publication.image}`)).status, 404);
});

// ---------- Amis ----------

async function amitieVuePar(qui, autre) {
  return (await appel(`/api/profils/${membres[autre].identifiant}`, { qui })).corps.profil.amitie;
}

test('demande d\'ami : envoyer, voir, accepter', async () => {
  assert.equal(await amitieVuePar('awa', 'bintou'), 'aucune');
  assert.equal((await appel(`/api/profils/${membres.bintou.identifiant}`)).corps.profil.amitie, null, 'visiteur : pas d\'état');

  const envoi = await appel('/api/amis/demandes', { methode: 'POST', qui: 'awa', donnees: { identifiant: membres.bintou.identifiant } });
  assert.equal(envoi.statut, 201);
  assert.equal(envoi.corps.amitie, 'envoyee');
  assert.equal(await amitieVuePar('awa', 'bintou'), 'envoyee');
  assert.equal(await amitieVuePar('bintou', 'awa'), 'recue');

  const doublon = await appel('/api/amis/demandes', { methode: 'POST', qui: 'awa', donnees: { identifiant: membres.bintou.identifiant } });
  assert.equal(doublon.statut, 400);

  const moi = await appel('/api/auth/moi', { qui: 'bintou' });
  assert.equal(moi.corps.utilisateur.demandesAmis, 1);
  const listeBintou = await appel('/api/amis', { qui: 'bintou' });
  assert.deepEqual(listeBintou.corps.recues.map((m) => m.identifiant), [membres.awa.identifiant]);
  assert.equal(listeBintou.corps.recues[0].email, undefined);

  // Celui qui a envoyé la demande ne peut pas l'accepter lui-même.
  const triche = await appel(`/api/amis/demandes/${membres.bintou.identifiant}/accepter`, { methode: 'POST', qui: 'awa', donnees: {} });
  assert.equal(triche.statut, 404);

  const accord = await appel(`/api/amis/demandes/${membres.awa.identifiant}/accepter`, { methode: 'POST', qui: 'bintou', donnees: {} });
  assert.equal(accord.corps.amitie, 'amis');
  assert.equal(await amitieVuePar('awa', 'bintou'), 'amis');
  assert.deepEqual((await appel('/api/amis', { qui: 'awa' })).corps.amis.map((m) => m.identifiant), [membres.bintou.identifiant]);
  // Le nombre d'amis, affiché parmi les chiffres du profil, est visible même sans compte.
  assert.equal((await appel(`/api/profils/${membres.awa.identifiant}`)).corps.profil.nbAmis, 1);
  assert.equal((await appel(`/api/profils/${membres.cheick.identifiant}`)).corps.profil.nbAmis, 0);
});

test('le filtre « mes amis » ne montre que mes publications et celles de mes amis', async () => {
  await publier('cheick', 'Publication de Cheick, pas encore ami');
  const fil = await appel('/api/publications?amis=1', { qui: 'awa' });
  const auteurs = new Set(fil.corps.publications.map((p) => p.auteur.identifiant));
  assert.ok(auteurs.has(membres.bintou.identifiant));
  assert.ok(!auteurs.has(membres.cheick.identifiant));
});

test('demande d\'ami : refuser, sans que l\'autre puisse insister', async () => {
  await appel('/api/amis/demandes', { methode: 'POST', qui: 'cheick', donnees: { identifiant: membres.awa.identifiant } });
  const refus = await appel(`/api/amis/demandes/${membres.cheick.identifiant}/refuser`, { methode: 'POST', qui: 'awa', donnees: {} });
  assert.equal(refus.corps.amitie, 'aucune');

  assert.equal(await amitieVuePar('cheick', 'awa'), 'envoyee', 'le refus n\'est pas révélé');
  const insiste = await appel('/api/amis/demandes', { methode: 'POST', qui: 'cheick', donnees: { identifiant: membres.awa.identifiant } });
  assert.equal(insiste.statut, 400);
  assert.equal((await appel('/api/amis', { qui: 'awa' })).corps.recues.length, 0);

  // Awa peut changer d'avis et demander à son tour ; Cheick accepte.
  const retour = await appel('/api/amis/demandes', { methode: 'POST', qui: 'awa', donnees: { identifiant: membres.cheick.identifiant } });
  assert.equal(retour.corps.amitie, 'envoyee');
  assert.equal(await amitieVuePar('cheick', 'awa'), 'recue');
});

test('deux demandes croisées font des amis ; on peut retirer un ami', async () => {
  await appel('/api/amis/demandes', { methode: 'POST', qui: 'bintou', donnees: { identifiant: membres.cheick.identifiant } });
  const croisee = await appel('/api/amis/demandes', { methode: 'POST', qui: 'cheick', donnees: { identifiant: membres.bintou.identifiant } });
  assert.equal(croisee.corps.amitie, 'amis');

  const retrait = await appel(`/api/amis/${membres.bintou.identifiant}`, { methode: 'DELETE', qui: 'cheick', donnees: {} });
  assert.equal(retrait.statut, 200);
  assert.equal(await amitieVuePar('bintou', 'cheick'), 'aucune');
});

test('demande d\'ami : à soi-même, à un inconnu ou sans connexion', async () => {
  const soi = await appel('/api/amis/demandes', { methode: 'POST', qui: 'awa', donnees: { identifiant: membres.awa.identifiant } });
  assert.equal(soi.statut, 400);
  const inconnu = await appel('/api/amis/demandes', { methode: 'POST', qui: 'awa', donnees: { identifiant: 'personne-inconnue-xyz' } });
  assert.equal(inconnu.statut, 404);
  assert.equal((await appel('/api/amis')).statut, 401);
});

// ---------- Signalements ----------

test('signaler une publication, un commentaire et un profil', async () => {
  const { corps: { publication } } = await publier('bintou', 'Publication douteuse');
  const { corps: { commentaire } } = await appel(`/api/publications/${publication.id}/commentaires`, {
    methode: 'POST', qui: 'bintou', donnees: { texte: 'Commentaire douteux' },
  });
  const signaler = (qui, donnees) => appel('/api/signalements', { methode: 'POST', qui, donnees });

  const un = await signaler('awa', { cibleType: 'publication', cible: publication.id, motif: 'Spam ou arnaque' });
  assert.equal(un.statut, 201);
  const encore = await signaler('awa', { cibleType: 'publication', cible: publication.id, motif: 'Spam ou arnaque' });
  assert.equal(encore.statut, 200);
  assert.equal(encore.corps.dejaSignale, true);

  assert.equal((await signaler('awa', { cibleType: 'commentaire', cible: commentaire.id, motif: 'Insultes' })).statut, 201);
  assert.equal((await signaler('awa', { cibleType: 'profil', cible: membres.bintou.identifiant, motif: 'Faux profil' })).statut, 201);

  const { rows } = await pool.query(
    `SELECT cible_type FROM signalements s JOIN utilisateurs u ON u.id = s.auteur_id
      WHERE u.email = $1 ORDER BY cible_type`,
    [membres.awa.email],
  );
  assert.deepEqual(rows.map((r) => r.cible_type), ['commentaire', 'profil', 'publication']);
});

test('signalement refusé : son propre contenu, cible inconnue, motif manquant, visiteur', async () => {
  const { corps: { publication } } = await publier('awa', 'Ma propre publication');
  const signaler = (qui, donnees) => appel('/api/signalements', { methode: 'POST', qui, donnees });

  assert.equal((await signaler('awa', { cibleType: 'publication', cible: publication.id, motif: 'Spam' })).statut, 400);
  assert.equal((await signaler('awa', { cibleType: 'profil', cible: membres.awa.identifiant, motif: 'Spam' })).statut, 400);
  assert.equal((await signaler('bintou', { cibleType: 'publication', cible: 999999999, motif: 'Spam' })).statut, 404);
  assert.equal((await signaler('bintou', { cibleType: 'publication', cible: publication.id, motif: '' })).statut, 400);
  assert.equal((await signaler('bintou', { cibleType: 'voiture', cible: 1, motif: 'Spam' })).statut, 400);
  assert.equal((await signaler(undefined, { cibleType: 'publication', cible: publication.id, motif: 'Spam' })).statut, 401);
});
