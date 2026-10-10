// Tests du réseau social : fil, j'aime, commentaires, amis, signalements.
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
const membres = {}; // awa, bintou, cheick : { cookie, identifiant, email }

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

test('vidéo : chaque format de lien accepté, seuls la plateforme et l\'identifiant sont gardés', async () => {
  const liens = [
    ['https://www.youtube.com/watch?v=PkZNo7MFNFg', 'youtube', 'PkZNo7MFNFg'],
    ['https://youtube.com/watch?v=PkZNo7MFNFg&t=42s&list=PLx', 'youtube', 'PkZNo7MFNFg'],
    ['m.youtube.com/watch?v=PkZNo7MFNFg', 'youtube', 'PkZNo7MFNFg'], // https:// ajouté s'il manque
    ['https://youtu.be/PkZNo7MFNFg?si=abc', 'youtube', 'PkZNo7MFNFg'],
    ['https://www.youtube.com/shorts/a1B2c3D4e_-', 'youtube', 'a1B2c3D4e_-'],
    ['https://www.tiktok.com/@dev.afrique_226/video/7301234567890123456', 'tiktok', '7301234567890123456'],
    ['https://tiktok.com/@awa/video/7301234567890123456?lang=fr', 'tiktok', '7301234567890123456'],
    ['https://www.facebook.com/PalabreDev/videos/1234567890123456/', 'facebook', '1234567890123456'],
    ['https://web.facebook.com/palabre.dev/videos/mon-titre/1234567890123456', 'facebook', '1234567890123456'],
    ['https://www.facebook.com/watch/?v=1234567890123456', 'facebook', '1234567890123456'],
    ['https://fb.watch/aBc-D_123/', 'facebook', 'aBc-D_123'],
  ];
  for (const [lien, plateforme, id] of liens) {
    const apercu = await appel(`/api/publications/video?lien=${encodeURIComponent(lien)}`, { qui: 'awa' });
    assert.equal(apercu.statut, 200, lien);
    assert.deepEqual(apercu.corps, { video: { plateforme, id } }, lien);
  }
  // À la publication : la réponse ne contient que la plateforme et l'identifiant, jamais l'adresse collée.
  const r = await poster('awa', '/api/publications', { type: 'idee', texte: 'Un bon cours pour débuter.', video: 'https://youtu.be/PkZNo7MFNFg?si=TRACEUR&feature=shared' });
  assert.equal(r.statut, 201);
  assert.deepEqual(r.corps.publication.video, { plateforme: 'youtube', id: 'PkZNo7MFNFg' });
  assert.doesNotMatch(JSON.stringify(r.corps), /TRACEUR|youtu\.be|https?:\/\/[^"]*youtube/);
  const { rows: [enBase] } = await pool.query('SELECT video_plateforme, video_id FROM publications WHERE id = $1', [r.corps.publication.id]);
  assert.deepEqual(enBase, { video_plateforme: 'youtube', video_id: 'PkZNo7MFNFg' });
  // Dans le fil aussi, et une publication sans vidéo dit « null ».
  const fil = (await appel('/api/publications', { qui: 'bintou' })).corps.publications;
  assert.deepEqual(fil.find((p) => p.id === r.corps.publication.id).video, { plateforme: 'youtube', id: 'PkZNo7MFNFg' });
  assert.ok(fil.some((p) => p.video === null));
  // Vidéo et image ensemble : permis.
  const deux = await poster('awa', '/api/publications', { type: 'projet', texte: 'Image et vidéo.', image: JPEG_1PX, video: 'https://www.tiktok.com/@awa/video/7301234567890123456' });
  assert.equal(deux.statut, 201);
  assert.ok(deux.corps.publication.image);
  assert.equal(deux.corps.publication.video.plateforme, 'tiktok');
});

test('vidéo : autre site, javascript:, adresse piégée ou identifiant malformé, refusés sur le champ « video »', async () => {
  const refuses = [
    'https://vimeo.com/123456789', 'https://exemple.com/watch?v=PkZNo7MFNFg', 'javascript:alert(1)', 'data:text/html,<script>alert(1)</script>',
    'https://youtube.com.pirate.example/watch?v=PkZNo7MFNFg', 'https://pirate.example/youtube.com/watch?v=PkZNo7MFNFg',
    'https://youtube.com@pirate.example/watch?v=PkZNo7MFNFg', 'https://www.youtube.com:8080/watch?v=PkZNo7MFNFg', 'ftp://youtu.be/PkZNo7MFNFg',
    'https://www.youtube.com/watch?v=court', 'https://www.youtube.com/watch?v=PkZNo7MFNFg"><script>', 'https://youtu.be/PkZNo7MF/../x',
    'https://www.youtube.com/embed/PkZNo7MFNFg', 'https://www.youtube.com/@freecodecamp', 'https://www.youtube.com/playlist?list=PLabc',
    'https://www.tiktok.com/@awa', 'https://www.tiktok.com/@awa/video/abc', 'https://www.tiktok.com/@awa/video/123/../../evil', 'https://vm.tiktok.com/ZMabc123/',
    'https://www.facebook.com/PalabreDev', 'https://www.facebook.com/PalabreDev/videos/abc', 'https://www.facebook.com/watch/?v=1%20onload=x', 'https://fb.watch/', 'https://fb.watch/a/b/c',
    'pas un lien', `https://youtu.be/PkZNo7MFNFg?${'x'.repeat(300)}`,
  ];
  // Les mêmes règles servent à l'aperçu et à la publication (lireLienVideo) : on les essaie toutes sur l'aperçu…
  for (const lien of refuses) {
    const r = await appel(`/api/publications/video?lien=${encodeURIComponent(lien)}`, { qui: 'awa' });
    assert.equal(r.statut, 400, lien);
    assert.equal(r.corps.champ, 'video', lien);
  }
  // … et quelques-unes à la publication elle-même (qui est limitée à 30 envois par quart d'heure).
  for (const lien of [refuses[0], refuses[2], refuses[4]]) {
    const r = await poster('awa', '/api/publications', { type: 'idee', texte: 'Regardez ça.', video: lien });
    assert.equal(r.statut, 400, lien);
    assert.equal(r.corps.champ, 'video', lien);
  }
  assert.match((await poster('awa', '/api/publications', { type: 'idee', texte: 'x', video: 'https://vm.tiktok.com/ZMabc123/' })).corps.erreur, /lien complet/);
  // Un visiteur n'a pas accès à l'aperçu ; un champ vide ou absent ne bloque pas la publication.
  assert.equal((await appel('/api/publications/video?lien=https://youtu.be/PkZNo7MFNFg')).statut, 401);
  assert.equal((await poster('awa', '/api/publications', { type: 'idee', texte: 'Sans vidéo.', video: '  ' })).corps.publication.video, null);
  // La base refuse elle aussi autre chose qu'une plateforme connue et un identifiant simple.
  await assert.rejects(pool.query('UPDATE publications SET video_plateforme = \'autre\', video_id = \'abcd\' WHERE video_id IS NOT NULL'), /publications_video_check/);
  await assert.rejects(pool.query('UPDATE publications SET video_id = \'https://pirate.example\' WHERE video_id IS NOT NULL'), /publications_video_check/);
});

test('seuls les lecteurs vidéo officiels et les miniatures YouTube sont autorisés par la CSP', async () => {
  const csp = (await fetch(`${base}/fil`)).headers.get('content-security-policy');
  assert.match(csp, /frame-src https:\/\/www\.youtube-nocookie\.com https:\/\/www\.tiktok\.com https:\/\/www\.facebook\.com(;|$)/);
  assert.match(csp, /img-src 'self' data: blob: https:\/\/i\.ytimg\.com(;|$)/);
  assert.match(csp, /script-src 'self'(;|$)/); // rien d'ouvert côté scripts
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
  // Le fil de Bintou seulement (?auteur=) : les autres fichiers de tests publient en même temps dans la même base,
  // et une de leurs publications pouvait se glisser en tête du fil général et faire échouer ce test au hasard.
  const filDeBintou = `/api/publications?auteur=${membres.bintou.identifiant}`;
  const page1 = await appel(filDeBintou, { qui: 'awa' });
  assert.equal(page1.statut, 200);
  assert.equal(page1.corps.publications.length, 10);
  assert.equal(page1.corps.publications[0].texte, 'Publication numéro 12');
  assert.equal(page1.corps.publications[9].texte, 'Publication numéro 3');
  assert.equal(page1.corps.publications[0].estMoi, false);
  assert.ok(page1.corps.suivant, 'il reste des publications');

  const page2 = await appel(`${filDeBintou}&avant=${page1.corps.suivant}`, { qui: 'awa' });
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
