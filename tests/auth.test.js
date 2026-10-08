// Tests de l'authentification. Nécessitent une base PostgreSQL de test (DATABASE_URL).
// Lancer : DATABASE_URL=postgres://... npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { creerApp } = require('../src/app');
const { migrer } = require('../src/db/migrate');
const { pool } = require('../src/db/pool');

let serveur;
let base;
const email = `test-${Date.now()}@palabre.test`;

async function appel(chemin, { methode = 'GET', donnees, cookie } = {}) {
  const headers = {};
  if (donnees) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const r = await fetch(`${base}/api${chemin}`, { method: methode, headers, body: donnees ? JSON.stringify(donnees) : undefined });
  return { statut: r.status, corps: await r.json(), cookie: r.headers.get('set-cookie') };
}

test.before(async () => {
  await migrer();
  serveur = creerApp().listen(0);
  base = `http://localhost:${serveur.address().port}`;
});

test.after(async () => {
  await pool.query('DELETE FROM utilisateurs WHERE email = $1', [email]);
  serveur.close();
  await pool.end();
});

test('inscription puis session active', async () => {
  const r = await appel('/auth/inscription', {
    methode: 'POST',
    donnees: { type: 'dev', nom: 'Test Palabre', email, motDePasse: 'motdepasse1', pays: 'Burkina Faso', ville: 'Koudougou' },
  });
  assert.equal(r.statut, 201);
  assert.ok(r.cookie.includes('HttpOnly'));
  const moi = await appel('/auth/moi', { cookie: r.cookie.split(';')[0] });
  assert.equal(moi.corps.utilisateur.email, email);
  assert.equal(moi.corps.utilisateur.mot_de_passe_hash, undefined);
});

test('email déjà utilisé refusé', async () => {
  const r = await appel('/auth/inscription', {
    methode: 'POST',
    donnees: { type: 'client', nom: 'Autre', email, motDePasse: 'motdepasse1', pays: 'Burkina Faso', ville: 'Ouaga' },
  });
  assert.equal(r.statut, 400);
  assert.equal(r.corps.champ, 'email');
});

test('mauvais mot de passe refusé', async () => {
  const r = await appel('/auth/connexion', { methode: 'POST', donnees: { email, motDePasse: 'faux-faux' } });
  assert.equal(r.statut, 401);
});

test('visiteur : /moi renvoie null', async () => {
  const r = await appel('/auth/moi');
  assert.equal(r.statut, 200);
  assert.equal(r.corps.utilisateur, null);
});

test('requête non JSON refusée (protection CSRF)', async () => {
  const r = await fetch(`${base}/api/auth/connexion`, { method: 'POST', body: 'email=a' });
  assert.equal(r.status, 415);
});
