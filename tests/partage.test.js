// Tests du partage des publications : la page publique /publication/:id et la lecture d'une publication sans compte.
const test = require('node:test');
const assert = require('node:assert/strict');
const { creerApp } = require('../src/app');
const { migrer } = require('../src/db/migrate');
const { pool } = require('../src/db/pool');
const v = require('../src/utils/validation');
const { avecComptesPrets } = require('./aide');

let serveur;
let base;
const suffixe = Date.now();
const lettres = String(suffixe).replace(/\d/g, (chiffre) => 'abcdefghij'[chiffre]);
const membres = {}; // awa (autrice), bintou, cheick
const WHATSAPP = '+22670112233';
// Un texte piégé : s'il entrait tel quel dans le HTML, il fermerait la balise et lancerait un script.
const TEXTE = 'Mon avis sur <script>alert(1)</script> & les "guillemets" > tout le reste. Voici la suite du texte, assez longue pour dépasser les cent soixante caractères que garde la description de la carte de partage.';
let publicationId;

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

test.before(async () => {
  await migrer();
  serveur = creerApp().listen(0);
  base = `http://localhost:${serveur.address().port}`;
  for (const cle of ['awa', 'bintou', 'cheick']) {
    const email = `partage-${cle}-${suffixe}@palabre.test`;
    const r = await appel('/api/auth/inscription', { methode: 'POST', donnees: { type: 'dev', prenom: cle, nomFamille: `Partage${lettres}`, email, motDePasse: 'motdepasse1', pays: 'Burkina Faso', ville: 'Koudougou' } });
    assert.equal(r.statut, 201);
    membres[cle] = { cookie: r.entetes.get('set-cookie').split(';')[0], identifiant: r.corps.utilisateur.identifiant, email };
  }
  // L'autrice a un numéro WhatsApp : il ne doit apparaître nulle part pour un visiteur.
  await pool.query('UPDATE utilisateurs SET whatsapp = $2 WHERE email = $1', [membres.awa.email, WHATSAPP]);
  const publie = await poster('awa', '/api/publications', { type: 'idee', texte: TEXTE });
  assert.equal(publie.statut, 201);
  publicationId = publie.corps.publication.id;
  await poster('bintou', `/api/publications/${publicationId}/jaime`);
  await poster('cheick', `/api/publications/${publicationId}/jaime`);
  for (const [qui, texte] of [['bintou', 'Premier commentaire'], ['cheick', 'Deuxième commentaire'], ['bintou', 'Troisième commentaire'], ['cheick', 'Quatrième commentaire']]) {
    await poster(qui, `/api/publications/${publicationId}/commentaires`, { texte });
  }
});

test.after(async () => {
  await pool.query('DELETE FROM utilisateurs WHERE email LIKE $1', [`partage-%-${suffixe}@palabre.test`]);
  await new Promise((fini) => serveur.close(fini));
  await pool.end();
});

test('page publique : visible sans compte, avec des balises de partage correctes et échappées', async () => {
  const page = await appelBrut(`/publication/${publicationId}`);
  assert.equal(page.statut, 200);
  const nom = `awa Partage${lettres}`;
  assert.ok(page.corps.includes(`<meta property="og:title" content="${nom} sur Palabre">`));
  assert.ok(page.corps.includes(`<meta name="twitter:title" content="${nom} sur Palabre">`));
  assert.ok(page.corps.includes(`<meta property="og:url" content="http://localhost:3000/publication/${publicationId}">`));
  assert.ok(page.corps.includes('<meta property="og:type" content="article">'));
  assert.ok(page.corps.includes('<meta name="twitter:card" content="summary_large_image">'));
  // Sans image jointe : l'image de partage par défaut.
  assert.ok(page.corps.includes('<meta property="og:image" content="http://localhost:3000/img/palabre-partage-1200x630.png">'));
  assert.ok(page.corps.includes('<meta name="twitter:image" content="http://localhost:3000/img/palabre-partage-1200x630.png">'));

  // Le texte piégé est neutralisé : aucune balise <script> venue du membre, les caractères spéciaux sont remplacés.
  assert.ok(!page.corps.includes('<script>alert(1)</script>'));
  const description = /<meta property="og:description" content="([^"]*)">/.exec(page.corps)[1];
  assert.ok(description.startsWith('Mon avis sur &lt;script&gt;alert(1)&lt;/script&gt; &amp; les &quot;guillemets&quot; &gt; tout le reste.'));
  // 160 caractères au plus (comptés avant le remplacement des caractères spéciaux), terminés par « … ».
  const lisible = description.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&amp;/g, '&');
  assert.equal(lisible.length, 160);
  assert.ok(lisible.endsWith('…'));
});

test('page publique : ni l\'email ni le numéro WhatsApp de l\'auteur, dans la page comme dans l\'API', async () => {
  const page = await appelBrut(`/publication/${publicationId}`);
  const api = await appelBrut(`/api/publications/${publicationId}`);
  assert.equal(api.statut, 200);
  for (const contenu of [page.corps, JSON.stringify(api.corps)]) {
    assert.ok(!contenu.includes(membres.awa.email));
    assert.ok(!contenu.includes(WHATSAPP));
    assert.ok(!contenu.includes('22670112233'));
    assert.ok(!contenu.toLowerCase().includes('date_naissance') && !contenu.includes('dateNaissance'));
  }
});

test('lecture sans compte : auteur, texte, compteurs, 3 derniers commentaires et lien public', async () => {
  const { statut, corps: { publication } } = await appelBrut(`/api/publications/${publicationId}`);
  assert.equal(statut, 200);
  assert.equal(publication.texte, TEXTE);
  assert.equal(publication.auteur.identifiant, membres.awa.identifiant);
  assert.equal(publication.nbJaime, 2);
  assert.equal(publication.nbCommentaires, 4);
  assert.deepEqual(publication.derniersCommentaires.map((c) => c.texte), ['Deuxième commentaire', 'Troisième commentaire', 'Quatrième commentaire']);
  assert.equal(publication.jaimeParMoi, false);
  assert.equal(publication.estMoi, false);
  assert.equal(publication.lien, `http://localhost:3000/publication/${publicationId}`);

  // Un membre connecté reçoit la même publication, avec ce qui le concerne.
  const pourBintou = await appel(`/api/publications/${publicationId}`, { qui: 'bintou' });
  assert.equal(pourBintou.corps.publication.jaimeParMoi, true);
  const pourAwa = await appel(`/api/publications/${publicationId}`, { qui: 'awa' });
  assert.equal(pourAwa.corps.publication.estMoi, true);
});

test('sans compte, on lit une publication mais on ne fait rien d\'autre', async () => {
  assert.equal((await appelBrut('/api/publications')).statut, 401); // le fil reste réservé aux membres
  assert.equal((await appelBrut(`/api/publications/${publicationId}/commentaires`)).statut, 401);
  assert.equal((await appelBrut(`/api/publications/${publicationId}/jaime`, { methode: 'POST', donnees: {} })).statut, 401);
  assert.equal((await appelBrut(`/api/publications/${publicationId}/commentaires`, { methode: 'POST', donnees: { texte: 'Coucou' } })).statut, 401);
  assert.equal((await appelBrut(`/api/publications/${publicationId}`, { methode: 'DELETE', donnees: {} })).statut, 401);
  assert.equal((await appelBrut('/api/publications/video?lien=https://youtu.be/Y80juYcu3ZI')).statut, 401);
  // Pour un membre, l'aperçu d'un lien vidéo répond toujours (l'adresse « video » n'est pas prise pour un numéro).
  assert.equal((await appel('/api/publications/video?lien=https://youtu.be/Y80juYcu3ZI', { qui: 'awa' })).statut, 200);
});

test('publication inconnue, masquée ou d\'un membre bloqué : page 404 du site', async () => {
  for (const chemin of ['/publication/999999999', '/publication/abc', '/publication/0']) {
    assert.equal((await appelBrut(chemin)).statut, 404, chemin);
  }
  assert.equal((await appelBrut('/api/publications/999999999')).statut, 404);

  await pool.query('UPDATE publications SET masque = TRUE WHERE id = $1', [publicationId]);
  const masquee = await appelBrut(`/publication/${publicationId}`);
  assert.equal(masquee.statut, 404);
  assert.ok(!masquee.corps.includes('Mon avis sur')); // rien du texte ne sort
  assert.ok(masquee.corps.includes('<html'));         // et c'est bien la page d'erreur du site, pas du JSON
  assert.equal((await appelBrut(`/api/publications/${publicationId}`)).statut, 404);
  await pool.query('UPDATE publications SET masque = FALSE WHERE id = $1', [publicationId]);
  assert.equal((await appelBrut(`/publication/${publicationId}`)).statut, 200);

  await pool.query('UPDATE utilisateurs SET bloque = TRUE WHERE email = $1', [membres.awa.email]);
  assert.equal((await appelBrut(`/publication/${publicationId}`)).statut, 404);
  assert.equal((await appelBrut(`/api/publications/${publicationId}`)).statut, 404);
  await pool.query('UPDATE utilisateurs SET bloque = FALSE WHERE email = $1', [membres.awa.email]);
});

test('le commentaire d\'un membre bloqué ne sort pas sur la page publique', async () => {
  await pool.query('UPDATE utilisateurs SET bloque = TRUE WHERE email = $1', [membres.cheick.email]);
  const { corps: { publication } } = await appelBrut(`/api/publications/${publicationId}`);
  assert.equal(publication.nbCommentaires, 2);
  assert.deepEqual(publication.derniersCommentaires.map((c) => c.texte), ['Premier commentaire', 'Troisième commentaire']);
  await pool.query('UPDATE utilisateurs SET bloque = FALSE WHERE email = $1', [membres.cheick.email]);
});

test('une image jointe devient l\'image de la carte de partage', async () => {
  const JPEG_1PX = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
  const { statut, corps } = await poster('awa', '/api/publications', { type: 'projet', texte: 'Avec une image.', image: JPEG_1PX });
  assert.equal(statut, 201);
  const page = await appelBrut(`/publication/${corps.publication.id}`);
  assert.ok(page.corps.includes(`<meta property="og:image" content="http://localhost:3000${corps.publication.image}">`));
  assert.ok(!page.corps.includes('og:image:width')); // dimensions annoncées seulement pour l'image par défaut
  // L'image elle-même se charge sans compte (sinon Facebook et WhatsApp n'afficheraient rien).
  assert.equal((await fetch(`${base}${corps.publication.image}`)).status, 200);
});

test('« publication » ne peut pas être pris comme identifiant, et les robots peuvent lire /publication/', async () => {
  assert.ok(v.IDENTIFIANTS_RESERVES.has('publication'));
  const robots = await appelBrut('/robots.txt');
  assert.match(robots.corps, /^Allow: \/publication\/$/m);
});
