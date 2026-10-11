// Tests de ce qui prépare la mise en ligne : réglages obligatoires en production, compression, cache, pages d'erreur, robots.txt.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { creerApp } = require('../src/app');
const { pool } = require('../src/db/pool');
const { pageErreur, versionner } = require('../src/utils/statique');

let serveur;
let base;

test.before(() => {
  serveur = creerApp().listen(0);
  base = `http://localhost:${serveur.address().port}`;
});

test.after(async () => {
  serveur.close();
  await pool.end();
});

// Lance « node server.js » comme le ferait l'hébergeur, avec ces variables d'environnement seulement.
// Le dossier de travail est ailleurs : le fichier .env du poste de développement n'est donc pas lu.
function demarrer(variables) {
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: os.tmpdir(), encoding: 'utf8', timeout: 20000,
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: 'production', PORT: '0', ...variables },
  });
  return { code: r.status, sortie: `${r.stdout}${r.stderr}` };
}
const BONS = { JWT_SECRET: 'x7'.repeat(24), URL_PUBLIQUE: 'https://palabre.dev', DATABASE_URL: 'postgres://personne:rien@127.0.0.1:1/aucune' };

test('production : le serveur refuse de démarrer sans clé secrète solide', () => {
  for (const [nom, cle] of [['absente', undefined], ['vide', ''], ['valeur d\'exemple', 'a-remplacer'], ['trop courte', 'abcdefghijklmnopqrstuvwxyz12345'], ['exemple rallongé', 'a-remplacer-a-remplacer-a-remplacer-a-remplacer']]) {
    const variables = { ...BONS };
    if (cle === undefined) delete variables.JWT_SECRET; else variables.JWT_SECRET = cle;
    const r = demarrer(variables);
    assert.equal(r.code, 1, nom);
    assert.match(r.sortie, /Configuration invalide : .*JWT_SECRET/s, nom);
    assert.doesNotMatch(r.sortie, /\n\s+at /, `${nom} : un message clair, pas une pile d'erreurs`);
  }
});

test('production : adresse publique en https et base de données obligatoires', () => {
  for (const adresse of [undefined, 'http://palabre.dev', 'palabre.dev', 'https://palabre.dev/fil']) {
    const variables = { ...BONS };
    if (adresse === undefined) delete variables.URL_PUBLIQUE; else variables.URL_PUBLIQUE = adresse;
    const r = demarrer(variables);
    assert.equal(r.code, 1, String(adresse));
    assert.match(r.sortie, /Configuration invalide : URL_PUBLIQUE/, String(adresse));
  }
  const sansBase = demarrer({ ...BONS, DATABASE_URL: '' });
  assert.equal(sansBase.code, 1);
  assert.match(sansBase.sortie, /DATABASE_URL/);
  // Avec de bons réglages, la configuration passe : le serveur ne s'arrête plus que parce que cette fausse base ne répond pas.
  const bons = demarrer({ ...BONS, URL_PUBLIQUE: 'https://palabre.dev/' }); // le « / » final est toléré
  assert.equal(bons.code, 1);
  assert.match(bons.sortie, /Impossible de démarrer/);
  assert.doesNotMatch(bons.sortie, /Configuration invalide/);
});

test('les réponses en texte sont compressées (gzip)', async () => {
  for (const chemin of ['/css/style.css', '/js/app.js', '/icons/icones.svg', '/', '/fil']) {
    const r = await fetch(`${base}${chemin}`, { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(r.status, 200, chemin);
    assert.equal(r.headers.get('content-encoding'), 'gzip', chemin);
    assert.match(r.headers.get('vary') || '', /Accept-Encoding/i, chemin);
  }
  // Une image est déjà compressée : la recompresser coûterait du temps pour rien.
  assert.equal((await fetch(`${base}/icons/logo-96.webp`, { headers: { 'Accept-Encoding': 'gzip' } })).headers.get('content-encoding'), null);
  // Un navigateur qui ne sait pas décompresser reçoit le fichier tel quel.
  assert.equal((await fetch(`${base}/css/style.css`, { headers: { 'Accept-Encoding': 'identity' } })).headers.get('content-encoding'), null);
});

test('cache : style et scripts versionnés gardés un an, pages toujours revérifiées', async () => {
  for (const page of ['/', '/fil', '/connexion', '/inscription', '/messages/12', '/demande.html', '/une-page-qui-n-existe-pas']) {
    const r = await fetch(`${base}${page}`);
    const html = await r.text();
    assert.match(r.headers.get('cache-control'), /no-cache|no-store/, page);
    // Toutes les feuilles de style et tous les scripts de la page portent une empreinte.
    const adresses = [...html.matchAll(/(?:href|src)="(\/(?:css|js)\/[^"]+)"/g)].map((m) => m[1]);
    assert.ok(adresses.length >= 2, page);
    for (const adresse of adresses) assert.match(adresse, /\?v=[0-9a-f]{10}$/, `${page} : ${adresse}`);
  }
  const html = await (await fetch(`${base}/fil`)).text();
  const style = /href="(\/css\/style\.css\?v=[0-9a-f]{10})"/.exec(html)[1];
  const versionne = await fetch(`${base}${style}`);
  assert.equal(versionne.status, 200);
  assert.equal(versionne.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  // Sans empreinte dans l'adresse (le service worker, un vieux lien) : jamais de cache long, mais un ETag pour revérifier vite.
  const simple = await fetch(`${base}/css/style.css`);
  assert.equal(simple.headers.get('cache-control'), 'no-cache');
  assert.ok(simple.headers.get('etag'));
  assert.equal((await fetch(`${base}/css/style.css`, { headers: { 'If-None-Match': simple.headers.get('etag'), 'Cache-Control': 'max-age=0' } })).status, 304);
  assert.equal((await fetch(`${base}/sw.js`)).headers.get('cache-control'), 'no-cache');
  assert.equal((await fetch(`${base}/icons/icones.svg`)).headers.get('cache-control'), 'no-cache');
  assert.match((await fetch(`${base}/fonts/bricolage-grotesque-latin-800-normal.woff2`)).headers.get('cache-control'), /immutable/);
  assert.equal((await fetch(`${base}/icons/logo-96.webp`)).headers.get('cache-control'), 'public, max-age=2592000');
  // L'empreinte suit le contenu : la même page donne la même adresse, et une adresse inconnue est laissée telle quelle.
  assert.equal(versionner('<link href="/css/style.css">'), `<link href="${style}">`);
  assert.equal(versionner('<script src="/js/inconnu.js"></script>'), '<script src="/js/inconnu.js"></script>');
  assert.equal(versionner('<a href="https://ailleurs.example/css/style.css">'), '<a href="https://ailleurs.example/css/style.css">');
});


test('page 404 dans le style du site ; l\'API, elle, répond en JSON', async () => {
  // Une adresse d'un seul mot est d'abord cherchée parmi les profils (palabre.dev/awa) : « Profil introuvable ».
  // Toutes les autres reçoivent la page 404 du site.
  for (const chemin of ['/une-page-qui-n-existe-pas', '/dossier/inconnu/page', '/css/absent.css', '/404', '/500.html', '/..%2f..%2fpackage.json', '/vues/404.html']) {
    const r = await fetch(`${base}${chemin}`);
    assert.equal(r.status, 404, chemin);
    const html = await r.text();
    assert.match(html, /<h1[^>]*>Cette page n'existe pas|<title>Profil introuvable/, chemin);
    assert.match(html, /\/css\/style\.css\?v=/, chemin);
    assert.doesNotMatch(html, /Cannot GET|"dependencies"/, chemin);
  }
  const api = await fetch(`${base}/api/route-inconnue`);
  assert.equal(api.status, 404);
  assert.match(api.headers.get('content-type'), /json/);
  // Les fichiers du projet ne sont pas servis.
  for (const chemin of ['/package.json', '/.env', '/src/config.js', '/server.js', '/.git/config']) assert.equal((await fetch(`${base}${chemin}`)).status, 404, chemin);
});

test('page 500 : dans le style du site, sans aucun détail technique', () => {
  const reponse = { entetes: {}, status(s) { this.statut = s; return this; }, set(n, val) { this.entetes[n] = val; return this; }, type() { return this; }, send(corps) { this.corps = corps; return this; } };
  pageErreur(reponse, 500);
  assert.equal(reponse.statut, 500);
  assert.equal(reponse.entetes['Cache-Control'], 'no-store');
  assert.match(reponse.corps, /Un problème est survenu/);
  assert.match(reponse.corps, /<script src="\/js\/theme\.js\?v=[0-9a-f]{10}"><\/script>\s*<link rel="stylesheet"/);
  assert.doesNotMatch(reponse.corps, /Error|stack|src\//);
});

test('robots.txt : pages publiques ouvertes, API et pages privées fermées', async () => {
  const r = await fetch(`${base}/robots.txt`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/plain/);
  const texte = await r.text();
  assert.match(texte, /^User-agent: \*$/m);
  assert.match(texte, /^Allow: \/$/m);
  for (const ferme of ['/api/', '/admin', '/messages', '/bienvenue', '/confirmer-email']) assert.match(texte, new RegExp(`^Disallow: ${ferme}$`, 'm'), ferme);
  // Les profils (/awa-ouedraogo) et les projets (/projets/12) ne sont interdits par aucune ligne.
  const interdits = [...texte.matchAll(/^Disallow: (.+)$/gm)].map((m) => m[1]);
  for (const ouvert of ['/awa-ouedraogo', '/projets/12', '/calculateur', '/fichiers/abc']) assert.ok(!interdits.some((i) => ouvert.startsWith(i)), ouvert);
});

test('réglages de production : cookie de session sécurisé, proxy de l\'hébergeur reconnu', () => {
  const code = `
    const { creerApp } = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'app'))});
    const { poserCookieSession } = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'middleware', 'auth'))});
    let cookie; poserCookieSession({ cookie: (nom, valeur, options) => { cookie = options; } }, 'jeton');
    console.log(JSON.stringify({ proxy: creerApp().get('trust proxy'), cookie }));
    process.exit(0);`;
  const r = spawnSync(process.execPath, ['-e', code], { cwd: os.tmpdir(), encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: 'production', ...BONS } });
  const { proxy, cookie } = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.equal(proxy, 1);
  assert.deepEqual({ httpOnly: cookie.httpOnly, secure: cookie.secure, sameSite: cookie.sameSite }, { httpOnly: true, secure: true, sameSite: 'lax' });
});
