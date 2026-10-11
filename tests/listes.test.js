// Tests des listes chargées par 10 en défilant : ici les notifications (GET /api/notifications?avant=).
// Le fil, les demandes et la recherche ont leurs propres tests de pagination dans leurs fichiers.
const test = require('node:test');
const assert = require('node:assert/strict');
const { creerApp } = require('../src/app');
const { migrer } = require('../src/db/migrate');
const { pool } = require('../src/db/pool');
const { avecComptesPrets } = require('./aide');

let serveur;
let base;
const suffixe = Date.now();
const lettres = String(suffixe).replace(/\d/g, (chiffre) => 'abcdefghij'[chiffre]);
const membres = {};

async function appelBrut(chemin, { methode = 'GET', donnees, qui } = {}) {
  const headers = {};
  if (donnees) headers['Content-Type'] = 'application/json';
  if (qui) headers.Cookie = membres[qui].cookie;
  const r = await fetch(`${base}${chemin}`, { method: methode, headers, body: donnees ? JSON.stringify(donnees) : undefined });
  return { statut: r.status, corps: await r.json().catch(() => ({})), entetes: r.headers };
}
const appel = avecComptesPrets(appelBrut);

test.before(async () => {
  await migrer();
  serveur = creerApp().listen(0);
  base = `http://localhost:${serveur.address().port}`;
  for (const cle of ['awa', 'bintou']) {
    const email = `listes-${cle}-${suffixe}@palabre.test`;
    const r = await appel('/api/auth/inscription', { methode: 'POST', donnees: { type: 'dev', prenom: cle, nomFamille: `Listes${lettres}`, email, motDePasse: 'kolatier-vert-48', pays: 'Burkina Faso', ville: 'Koudougou' } });
    assert.equal(r.statut, 201);
    const { rows } = await pool.query('SELECT id FROM utilisateurs WHERE email = $1', [email]);
    membres[cle] = { cookie: r.entetes.get('set-cookie').split(';')[0], id: rows[0].id };
  }
  // 23 notifications pour Awa, 1 pour Bintou.
  for (let i = 1; i <= 23; i += 1) {
    await pool.query('INSERT INTO notifications (utilisateur_id, type, texte, lien) VALUES ($1, \'demande_ami\', $2, \'/amis\')', [membres.awa.id, `Notification ${i}`]);
  }
  await pool.query('INSERT INTO notifications (utilisateur_id, type, texte, lien) VALUES ($1, \'demande_ami\', \'Pour Bintou\', \'/amis\')', [membres.bintou.id]);
});

test.after(async () => {
  await pool.query('DELETE FROM utilisateurs WHERE email LIKE $1', [`listes-%-${suffixe}@palabre.test`]);
  await new Promise((fini) => serveur.close(fini));
  await pool.end();
});

test('notifications : 10 à la fois, de la plus récente à la plus ancienne, sans doublon ni oubli', async () => {
  const vues = [];
  let avant = '';
  let pages = 0;
  for (;;) {
    const { statut, corps } = await appel(`/api/notifications${avant}`, { qui: 'awa' });
    assert.equal(statut, 200);
    pages += 1;
    assert.ok(corps.notifications.length <= 10);
    assert.equal(corps.nonLues, 23); // le compteur de la cloche compte tout, pas seulement la page
    vues.push(...corps.notifications.map((n) => n.texte));
    if (!corps.suivant) break;
    assert.equal(corps.suivant, corps.notifications[corps.notifications.length - 1].id);
    avant = `?avant=${corps.suivant}`;
  }
  assert.equal(pages, 3); // 10 + 10 + 3
  assert.deepEqual(vues, Array.from({ length: 23 }, (_, i) => `Notification ${23 - i}`));
});

test('notifications : chacun ne voit que les siennes, même avec « avant »', async () => {
  const { corps } = await appel('/api/notifications?avant=2147483000', { qui: 'bintou' });
  assert.deepEqual(corps.notifications.map((n) => n.texte), ['Pour Bintou']);
  assert.equal(corps.suivant, null);
  // Une valeur farfelue pour « avant » est ignorée, sans erreur.
  assert.equal((await appel('/api/notifications?avant=abc', { qui: 'bintou' })).corps.notifications.length, 1);
  assert.equal((await appelBrut('/api/notifications')).statut, 401);
});
