// Tests de l'authentification. Nécessitent une base PostgreSQL de test (DATABASE_URL).
// Lancer : DATABASE_URL=postgres://... npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { creerApp } = require('../src/app');
const { migrer } = require('../src/db/migrate');
const { pool } = require('../src/db/pool');
const { avecComptesPrets } = require('./aide');

let serveur;
let base;
const email = `test-${Date.now()}@palabre.test`;
const autresEmails = []; // comptes créés par les tests du prénom et du nom

async function appelBrut(chemin, { methode = 'GET', donnees, cookie } = {}) {
  const headers = {};
  if (donnees) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const r = await fetch(`${base}/api${chemin}`, { method: methode, headers, body: donnees ? JSON.stringify(donnees) : undefined });
  return { statut: r.status, corps: await r.json(), cookie: r.headers.get('set-cookie') };
}
// Les comptes créés par ces tests sont aussitôt « prêts » : email confirmé, profil de dev complet (voir tests/aide.js).
const appel = avecComptesPrets(appelBrut);

test.before(async () => {
  await migrer();
  serveur = creerApp().listen(0);
  base = `http://localhost:${serveur.address().port}`;
});

test.after(async () => {
  await pool.query('DELETE FROM utilisateurs WHERE email = ANY($1)', [[email, ...autresEmails]]);
  serveur.close();
  await pool.end();
});

test('inscription puis session active', async () => {
  const r = await appel('/auth/inscription', {
    methode: 'POST',
    donnees: { type: 'dev', prenom: 'Test', nomFamille: 'Palabre', email, motDePasse: 'motdepasse1', pays: 'Burkina Faso', ville: 'Koudougou' },
  });
  assert.equal(r.statut, 201);
  assert.ok(r.cookie.includes('HttpOnly'));
  const moi = await appel('/auth/moi', { cookie: r.cookie.split(';')[0] });
  assert.equal(moi.corps.utilisateur.email, email);
  assert.equal(moi.corps.utilisateur.mot_de_passe_hash, undefined);
});

test('inscription : prénom et nom séparés, nom affiché « Prénom Nom »', async () => {
  const courriel = `test-prenom-${Date.now()}@palabre.test`;
  autresEmails.push(courriel);
  const r = await appel('/auth/inscription', {
    methode: 'POST',
    // espaces en trop, tiret, apostrophe, accents : tout cela est accepté et nettoyé
    donnees: { type: 'dev', prenom: '  Jean-Baptiste ', nomFamille: 'N\'Diaye   Kéïta', email: courriel, motDePasse: 'motdepasse1', pays: 'Mali', ville: 'Bamako' },
  });
  assert.equal(r.statut, 201);
  assert.equal(r.corps.utilisateur.prenom, 'Jean-Baptiste');
  assert.equal(r.corps.utilisateur.nomFamille, 'N\'Diaye Kéïta');
  assert.equal(r.corps.utilisateur.nom, 'Jean-Baptiste N\'Diaye Kéïta');
  // Le lien de profil est fabriqué à partir du nom affiché, comme avant.
  assert.match(r.corps.utilisateur.identifiant, /^jean-baptiste-n-diaye-ke/);
  const { rows: [ligne] } = await pool.query('SELECT nom, prenom, nom_famille FROM utilisateurs WHERE email = $1', [courriel]);
  assert.deepEqual(ligne, { nom: 'Jean-Baptiste N\'Diaye Kéïta', prenom: 'Jean-Baptiste', nom_famille: 'N\'Diaye Kéïta' });
});

test('inscription : prénom ou nom vide, trop long ou avec autre chose que des lettres, refusé', async () => {
  const essai = (prenom, nomFamille) => appel('/auth/inscription', {
    methode: 'POST',
    donnees: { type: 'dev', prenom, nomFamille, email: `test-refus-${Date.now()}@palabre.test`, motDePasse: 'motdepasse1', pays: 'Mali', ville: 'Bamako' },
  });
  for (const [prenom, nomFamille, champ] of [
    ['', 'Traoré', 'prenom'], ['   ', 'Traoré', 'prenom'], [undefined, 'Traoré', 'prenom'],
    ['A'.repeat(51), 'Traoré', 'prenom'], ['Awa2', 'Traoré', 'prenom'], ['Awa<script>', 'Traoré', 'prenom'], ['-Awa', 'Traoré', 'prenom'],
    ['Awa', '', 'nomFamille'], ['Awa', 'T'.repeat(51), 'nomFamille'], ['Awa', 'Traoré@', 'nomFamille'],
  ]) {
    const r = await essai(prenom, nomFamille);
    assert.equal(r.statut, 400, `${prenom} / ${nomFamille}`);
    assert.equal(r.corps.champ, champ, `${prenom} / ${nomFamille}`);
  }
  // 50 caractères exactement : accepté.
  const courriel = `test-long-${Date.now()}@palabre.test`;
  autresEmails.push(courriel);
  const long = await appel('/auth/inscription', {
    methode: 'POST',
    donnees: { type: 'dev', prenom: 'A'.repeat(50), nomFamille: 'B'.repeat(50), email: courriel, motDePasse: 'motdepasse1', pays: 'Mali', ville: 'Bamako' },
  });
  assert.equal(long.statut, 201);
  assert.equal(long.corps.utilisateur.nom.length, 101);
});

test('comptes d\'avant la séparation : prénom et nom remplis une seule fois par la migration', async () => {
  const courriel = `test-ancien-${Date.now()}@palabre.test`;
  autresEmails.push(courriel);
  const seul = `test-ancien-seul-${Date.now()}@palabre.test`;
  autresEmails.push(seul);
  // Deux comptes « à l'ancienne » : seulement la colonne nom.
  await pool.query(
    `INSERT INTO utilisateurs (type, nom, identifiant, email, mot_de_passe_hash, pays, ville) VALUES
       ('dev', 'Aminata Diop Sarr', $1, $2, 'pas-un-vrai-hash', 'Sénégal', 'Thiès'),
       ('dev', 'Madonna', $3, $4, 'pas-un-vrai-hash', 'Sénégal', 'Thiès')`,
    [`ancien-${Date.now()}`, courriel, `ancien-seul-${Date.now()}`, seul],
  );
  // On rejoue seulement l'instruction de remplissage du schéma (pas toute la migration : ses ALTER TABLE
  // verrouilleraient les tables pendant que les autres fichiers de tests s'en servent).
  const schema = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'db', 'schema.sql'), 'utf8');
  const remplissage = /UPDATE utilisateurs\s+SET prenom[\s\S]*?WHERE prenom IS NULL;/.exec(schema)[0];
  await pool.query(remplissage);
  const lire = async (e) => (await pool.query('SELECT nom, prenom, nom_famille FROM utilisateurs WHERE email = $1', [e])).rows[0];
  assert.deepEqual(await lire(courriel), { nom: 'Aminata Diop Sarr', prenom: 'Aminata', nom_famille: 'Diop Sarr' });
  assert.deepEqual(await lire(seul), { nom: 'Madonna', prenom: 'Madonna', nom_famille: '' });
  // Rejouer le remplissage ne touche plus à un compte déjà rempli, même s'il a été modifié entre-temps.
  await pool.query('UPDATE utilisateurs SET prenom = \'Ami\' WHERE email = $1', [courriel]);
  await pool.query(remplissage);
  assert.equal((await lire(courriel)).prenom, 'Ami');
});

test('email déjà utilisé refusé', async () => {
  const r = await appel('/auth/inscription', {
    methode: 'POST',
    donnees: { type: 'client', prenom: 'Autre', nomFamille: 'Compte', email, motDePasse: 'motdepasse1', pays: 'Burkina Faso', ville: 'Ouaga' },
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
