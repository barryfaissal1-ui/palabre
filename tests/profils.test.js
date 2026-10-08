// Tests des profils et des photos de profil.
const test = require('node:test');
const assert = require('node:assert/strict');
const { creerApp } = require('../src/app');
const { migrer } = require('../src/db/migrate');
const { pool } = require('../src/db/pool');

let serveur;
let base;
let cookie;
const suffixe = Date.now();
const email = `profil-${suffixe}@palabre.test`;
const identifiant = `test-${suffixe}`;

async function appel(chemin, { methode = 'GET', donnees, avecCookie = true } = {}) {
  const headers = {};
  if (donnees) headers['Content-Type'] = 'application/json';
  if (avecCookie && cookie) headers.Cookie = cookie;
  const r = await fetch(`${base}${chemin}`, { method: methode, headers, body: donnees ? JSON.stringify(donnees) : undefined });
  const texte = await r.text();
  let corps;
  try { corps = JSON.parse(texte); } catch { corps = texte; }
  return { statut: r.status, corps, entetes: r.headers };
}

// Une vraie petite image JPEG (1 × 1 pixel), encodée en base64.
const JPEG_1PX = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

test.before(async () => {
  await migrer();
  serveur = creerApp().listen(0);
  base = `http://localhost:${serveur.address().port}`;
  const r = await appel('/api/auth/inscription', {
    methode: 'POST',
    donnees: { type: 'dev', nom: 'Profil Test', email, motDePasse: 'motdepasse1', pays: 'Burkina Faso', ville: 'Koudougou', whatsapp: '+22670000000' },
  });
  cookie = r.entetes.get('set-cookie').split(';')[0];
});

test.after(async () => {
  await pool.query('DELETE FROM utilisateurs WHERE email = $1', [email]);
  serveur.close();
  await pool.end();
});

test('modifier son profil et ses compétences', async () => {
  const { corps: { competences } } = await appel('/api/competences');
  const ids = competences.slice(0, 3).map((c) => c.id);
  const r = await appel('/api/profils/moi', {
    methode: 'PUT',
    donnees: { nom: 'Profil Test', identifiant, pays: 'Burkina Faso', ville: 'Koudougou', whatsapp: '+22670000000', bio: 'Bonjour', disponible: false, competences: [...ids, 999999] },
  });
  assert.equal(r.statut, 200);
  assert.equal(r.corps.profil.identifiant, identifiant);
  assert.equal(r.corps.profil.disponible, false);
  assert.equal(r.corps.profil.competences.length, 3, 'la compétence inexistante est ignorée');
});

test('identifiant réservé refusé', async () => {
  const r = await appel('/api/profils/moi', {
    methode: 'PUT',
    donnees: { nom: 'Profil Test', identifiant: 'connexion', pays: 'Burkina Faso', ville: 'Koudougou' },
  });
  assert.equal(r.statut, 400);
  assert.equal(r.corps.champ, 'identifiant');
});

test('un visiteur ne voit ni l\'email ni le numéro WhatsApp', async () => {
  const r = await appel(`/api/profils/${identifiant}`, { avecCookie: false });
  assert.equal(r.statut, 200);
  assert.equal(r.corps.profil.email, undefined);
  assert.equal(r.corps.profil.whatsapp, null);
  assert.equal(r.corps.profil.whatsappMasque, true);
});

test('un membre connecté voit le numéro WhatsApp', async () => {
  const r = await appel(`/api/profils/${identifiant}`);
  assert.equal(r.corps.profil.whatsapp, '+22670000000');
});

test('profil inconnu : 404', async () => {
  const r = await appel('/api/profils/personne-qui-n-existe-pas');
  assert.equal(r.statut, 404);
});

test('photo de profil : envoi, remplacement, diffusion', async () => {
  const premiere = await appel('/api/profils/moi/avatar', { methode: 'POST', donnees: { image: JPEG_1PX } });
  assert.equal(premiere.statut, 201);
  const seconde = await appel('/api/profils/moi/avatar', { methode: 'POST', donnees: { image: JPEG_1PX } });
  assert.equal(seconde.statut, 201);

  // L'ancienne photo est supprimée quand on en envoie une nouvelle.
  const ancienne = await appel(premiere.corps.avatar);
  assert.equal(ancienne.statut, 404);

  const image = await fetch(`${base}${seconde.corps.avatar}`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/jpeg');
  assert.match(image.headers.get('cache-control'), /immutable/);
});

test('un faux fichier image est refusé', async () => {
  const r = await appel('/api/profils/moi/avatar', { methode: 'POST', donnees: { image: 'data:image/png;base64,SGVsbG8=' } });
  assert.equal(r.statut, 400);
});

test('modifier un profil sans être connecté est refusé', async () => {
  const r = await appel('/api/profils/moi', { methode: 'PUT', donnees: { nom: 'X' }, avecCookie: false });
  assert.equal(r.statut, 401);
});

test('le lien court palabre.dev/identifiant renvoie la page profil', async () => {
  const r = await appel(`/${identifiant}`, { avecCookie: false });
  assert.equal(r.statut, 200);
  assert.match(String(r.corps), /data-profil/);
});
