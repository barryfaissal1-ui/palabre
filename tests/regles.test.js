// Tests des règles de la communauté : la page /regles, l'acceptation obligatoire à l'inscription (vérifiée par le
// serveur, datée, avec la version), et la nouvelle acceptation quand la version change.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../src/config');
const { creerApp } = require('../src/app');
const { migrer } = require('../src/db/migrate');
const { pool } = require('../src/db/pool');
const { VERSION_REGLES } = require('../src/utils/regles');
const v = require('../src/utils/validation');
const { validerCompte, jetonAncien } = require('./aide');

let serveur;
let base;
const suffixe = Date.now();
const lettres = String(suffixe).replace(/\d/g, (chiffre) => 'abcdefghij'[chiffre]);
const adresse = (cle) => `regles-${cle}-${suffixe}@palabre.test`;
const membres = {};

async function appel(chemin, { methode = 'GET', donnees, qui, langue } = {}) {
  const headers = {};
  if (donnees) headers['Content-Type'] = 'application/json';
  const cookies = [qui ? membres[qui].cookie : null, langue ? `langue=${langue}` : null].filter(Boolean);
  if (cookies.length) headers.Cookie = cookies.join('; ');
  const r = await fetch(`${base}${chemin}`, { method: methode, headers, body: donnees ? JSON.stringify(donnees) : undefined });
  const texte = await r.text();
  let corps = {};
  try { corps = JSON.parse(texte); } catch { /* une page HTML */ }
  return { statut: r.status, corps, texte, cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('palabre_session=')) };
}
const inscription = (cle, plus = {}) => appel('/api/auth/inscription', {
  methode: 'POST',
  donnees: { type: 'dev', prenom: cle, nomFamille: `Regles${lettres}`, email: adresse(cle), motDePasse: 'kolatier-vert-48', pays: 'Burkina Faso', ville: 'Koudougou', jeton: jetonAncien(), ...plus },
});

test.before(async () => {
  await migrer();
  serveur = creerApp().listen(0);
  base = `http://localhost:${serveur.address().port}`;
});

test.after(async () => {
  await pool.query('DELETE FROM utilisateurs WHERE email LIKE $1', [`regles-%-${suffixe}@palabre.test`]);
  await new Promise((fini) => serveur.close(fini));
  await pool.end();
});

test('inscription : refusée sans la case des règles, quelle que soit la façon de l\'omettre', async () => {
  for (const [nom, valeur] of [['absente', {}], ['faux', { accepteRegles: false }], ['le texte « true »', { accepteRegles: 'true' }], ['le texte « on »', { accepteRegles: 'on' }], ['1', { accepteRegles: 1 }]]) {
    const r = await inscription('refus', valeur);
    assert.deepEqual([r.statut, r.corps.champ, r.corps.code], [400, 'accepteRegles', 'regles-non-acceptees'], nom);
  }
  assert.equal((await pool.query('SELECT 1 FROM utilisateurs WHERE email = $1', [adresse('refus')])).rows.length, 0, 'aucun compte créé');
  // En anglais, le message est traduit.
  const enAnglais = await appel('/api/auth/inscription', { methode: 'POST', langue: 'en', donnees: { type: 'dev', prenom: 'refus', nomFamille: 'Regles', email: adresse('refus'), motDePasse: 'kolatier-vert-48', pays: 'Burkina Faso', ville: 'Koudougou', jeton: jetonAncien() } });
  assert.match(enAnglais.corps.erreur, /accept the community rules and the terms of use/);
});

test('inscription avec la case : la date et la version des règles acceptées sont enregistrées', async () => {
  const r = await inscription('awa', { accepteRegles: true });
  assert.equal(r.statut, 201, JSON.stringify(r.corps));
  await validerCompte(adresse('awa'));
  membres.awa = { cookie: r.cookie, id: r.corps.utilisateur.id };
  const { rows: [ligne] } = await pool.query('SELECT regles_acceptees_le, regles_version FROM utilisateurs WHERE id = $1', [membres.awa.id]);
  assert.equal(ligne.regles_version, VERSION_REGLES);
  assert.ok(Date.now() - new Date(ligne.regles_acceptees_le).getTime() < 60000);
  assert.equal(r.corps.utilisateur.reglesAAccepter, false);
});

test('la version des règles change : le membre lit encore, mais n\'écrit plus tant qu\'il ne les a pas acceptées', async () => {
  // Comme si VERSION_REGLES venait d'augmenter : Awa a accepté une version plus ancienne.
  await pool.query('UPDATE utilisateurs SET regles_version = $2, regles_acceptees_le = now() - interval \'40 days\' WHERE id = $1', [membres.awa.id, VERSION_REGLES - 1]);
  const moi = (await appel('/api/auth/moi', { qui: 'awa' })).corps.utilisateur;
  assert.equal(moi.reglesAAccepter, true);
  // Lire : oui.
  assert.equal((await appel('/api/publications', { qui: 'awa' })).statut, 200);
  assert.equal((await appel('/api/parametres', { qui: 'awa' })).statut, 200);
  // Écrire : non, où que ce soit.
  for (const [methode, chemin, donnees] of [['POST', '/api/publications', { type: 'idee', texte: 'Je publie sans accepter ?' }], ['PUT', '/api/parametres/langue', { langue: 'en' }], ['POST', '/api/amis/demandes', { identifiant: 'quelqu-un' }], ['DELETE', '/api/publications/1', {}]]) {
    const refus = await appel(chemin, { methode, qui: 'awa', donnees });
    assert.deepEqual([refus.statut, refus.corps.code, refus.corps.suite], [403, 'regles-a-accepter', '/regles'], `${methode} ${chemin}`);
  }
  // Accepter : seule la valeur « vrai » compte ; un visiteur n'a rien à accepter.
  assert.equal((await appel('/api/auth/regles', { methode: 'POST', qui: 'awa', donnees: { accepte: false } })).statut, 400);
  assert.equal((await appel('/api/auth/regles', { methode: 'POST', qui: 'awa', donnees: {} })).statut, 400);
  assert.equal((await appel('/api/auth/regles', { methode: 'POST', donnees: { accepte: true } })).statut, 401);
  assert.equal((await appel('/api/auth/moi', { qui: 'awa' })).corps.utilisateur.reglesAAccepter, true);

  const accepte = await appel('/api/auth/regles', { methode: 'POST', qui: 'awa', donnees: { accepte: true } });
  assert.deepEqual([accepte.statut, accepte.corps.version], [200, VERSION_REGLES]);
  const { rows: [ligne] } = await pool.query('SELECT regles_acceptees_le, regles_version FROM utilisateurs WHERE id = $1', [membres.awa.id]);
  assert.equal(ligne.regles_version, VERSION_REGLES);
  assert.ok(Date.now() - new Date(ligne.regles_acceptees_le).getTime() < 60000, 'la date est celle de la nouvelle acceptation');
  assert.equal((await appel('/api/auth/moi', { qui: 'awa' })).corps.utilisateur.reglesAAccepter, false);
  assert.equal((await appel('/api/publications', { methode: 'POST', qui: 'awa', donnees: { type: 'idee', texte: 'Je publie après avoir accepté.' } })).statut, 201);
});

test('un compte qui n\'a jamais accepté (créé avant les règles) doit les accepter aussi', async () => {
  await pool.query('UPDATE utilisateurs SET regles_version = NULL, regles_acceptees_le = NULL WHERE id = $1', [membres.awa.id]);
  assert.equal((await appel('/api/auth/moi', { qui: 'awa' })).corps.utilisateur.reglesAAccepter, true);
  assert.equal((await appel('/api/publications', { methode: 'POST', qui: 'awa', donnees: { type: 'idee', texte: 'Sans jamais avoir accepté ?' } })).statut, 403);
  // Se déconnecter reste possible sans accepter.
  await appel('/api/auth/regles', { methode: 'POST', qui: 'awa', donnees: { accepte: true } });
});

test('page /regles : servie en français et en anglais, avec les dix interdits, les sanctions, signaler et contester', async () => {
  const fr = await appel('/regles');
  assert.equal(fr.statut, 200);
  for (const mot of ['Règles de la communauté', 'arnaques', 'harcèlement', 'discours de haine', 'contenu sexuel', 'violence et les menaces', 'faux profils', 'spam', 'illégaux', 'données personnelles', 'piratage', 'avertissement', 'suspension de 7 jours', 'exclusion', 'Comment signaler', 'Comment contester']) {
    assert.ok(fr.texte.includes(mot), mot);
  }
  assert.equal((fr.texte.match(/<li data-t="regles\.interdit\./g) || []).length, 10, 'dix interdits');
  const en = await appel('/regles', { langue: 'en' });
  assert.match(en.texte, /<title>Community rules – Palabre<\/title>/);
  for (const mot of ['Scams and fraud', 'Hate speech', 'How to report', 'How to appeal', '7-day suspension']) assert.ok(en.texte.includes(mot), mot);
  assert.ok(!en.texte.includes('Comment signaler'));
  // Le mot est réservé : aucun membre ne peut prendre /regles comme adresse de profil.
  for (const mot of ['regles', 'sanctions', 'moderation']) assert.ok(v.IDENTIFIANTS_RESERVES.has(mot), mot);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8'), /'\/regles'/);
});

test('liens vers les règles : accueil, à propos, paramètres, inscription ; adresse de contact donnée par CONTACT_MODERATION', async () => {
  for (const page of ['/', '/a-propos', '/parametres', '/inscription', '/conditions']) assert.match((await appel(page)).texte, /href="\/regles"/, page);
  const inscriptionPage = (await appel('/inscription')).texte;
  assert.match(inscriptionPage, /name="accepteRegles" type="checkbox" required/);
  assert.match(inscriptionPage, /href="\/conditions"/);
  // L'adresse n'est écrite dans aucune page : le serveur la pose à partir de la configuration.
  for (const page of ['/regles', '/conditions']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'public', `${page.slice(1)}.html`), 'utf8');
    assert.match(source, /<a data-contact-moderation><\/a>/, page);
    assert.match((await appel(page)).texte, new RegExp(`<a data-contact-moderation href="mailto:${config.contactModeration}">${config.contactModeration}</a>`), page);
  }
  const avant = config.contactModeration;
  config.contactModeration = 'alerte@exemple.bf';
  try {
    assert.match((await appel('/conditions')).texte, /href="mailto:alerte@exemple\.bf">alerte@exemple\.bf<\/a>/);
  } finally {
    config.contactModeration = avant;
  }
  // Les conditions disent ce que Palabre est, et ce que l'équipe peut faire.
  const conditions = (await appel('/conditions')).texte;
  for (const mot of ['intermédiaire technique', 'seul responsable de ce qu\'il publie', 'seuls responsables des accords', 'retirer tout contenu et suspendre ou exclure tout compte']) assert.ok(conditions.includes(mot), mot);
});
