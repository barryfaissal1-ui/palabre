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

test('connexion et inscription : une seule page, le serveur choisit le formulaire montré', async () => {
  const connexion = await fetch(`${base}/connexion`);
  const inscription = await fetch(`${base}/inscription?suite=/amis`);
  assert.equal(connexion.status, 200);
  assert.equal(inscription.status, 200);
  const [pageConnexion, pageInscription] = [await connexion.text(), await inscription.text()];
  // Les deux adresses servent la même page, avec les deux formulaires.
  for (const page of [pageConnexion, pageInscription]) {
    assert.match(page, /data-formulaire="connexion"/);
    assert.match(page, /data-formulaire="inscription"/);
    assert.doesNotMatch(page, /photo-panneau/); // le repère de la photo est toujours remplacé
    // Au plus UNE photo dans la page : les autres ne sont que listées, pour être chargées plus tard.
    assert.ok((page.match(/<picture/g) || []).length <= 1);
    // Si une photo est là : les deux tailles sont proposées, et la petite est imposée aux téléphones.
    if (page.includes('<picture')) {
      assert.match(page, /<source media="\(max-width: 767px\)" type="image\/webp" srcset="\/img\/fond\/[a-z0-9-]+-1080\.webp">/);
      assert.match(page, /sizes="100vw"/);
    }
  }
  assert.match(pageConnexion, /data-vue="connexion"/);
  assert.match(pageConnexion, /<title>Se connecter/);
  assert.match(pageInscription, /data-vue="inscription"/);
  assert.match(pageInscription, /<title>Créer un compte/);
  // Par défaut : « Développeur » est coché et le panneau parle aux devs.
  assert.match(pageInscription, /id="type-dev" value="dev" checked/);
  assert.match(pageInscription, /data-client="[^"]*">Rejoins le cercle\.</);

  // Avec ?type=client (bouton « J'ai un projet », calculateur) : « Client » est coché et le texte est déjà le bon.
  const pageClient = await (await fetch(`${base}/inscription?type=client&suite=/demandes`)).text();
  assert.match(pageClient, /id="type-client" value="client" checked/);
  assert.doesNotMatch(pageClient, /id="type-dev" value="dev" checked/);
  assert.match(pageClient, />Ton projet mérite les bons devs\.</);
  assert.match(pageClient, />Publie ta demande en FCFA, reçois des propositions de devs prouvés et choisis en confiance\.</);
  assert.doesNotMatch(pageClient, />Montre ton travail, forme ton équipe, trouve tes clients\.</);
  // Une valeur inconnue ne change rien.
  assert.match(await (await fetch(`${base}/inscription?type=pirate`)).text(), /id="type-dev" value="dev" checked/);
  // Et le bouton « J'ai un projet » de l'accueil mène bien là.
  assert.match(await (await fetch(`${base}/`)).text(), /href="\/inscription\?type=client">J'ai un projet</);
});
