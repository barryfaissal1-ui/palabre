// Tests du journal de sécurité : chaque événement important d'un compte y est noté, son propriétaire seul le lit,
// 30 événements au plus, gardés 90 jours.
const test = require('node:test');
const assert = require('node:assert/strict');
const { creerApp } = require('../src/app');
const { migrer } = require('../src/db/migrate');
const { pool } = require('../src/db/pool');
const { TYPES, purgerJournal } = require('../src/utils/journal');
const { validerCompte, jetonAncien, dernierCode, emailsEnvoyes } = require('./aide');

let serveur;
let base;
const suffixe = Date.now();
const lettres = String(suffixe).replace(/\d/g, (chiffre) => 'abcdefghij'[chiffre]);
const adresse = (cle) => `journal-${cle}-${suffixe}@palabre.test`;
const BON = 'kolatier-vert-48';
const ANDROID = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0';
const membres = {};

// Un navigateur : il garde ses cookies (donc son cookie d'appareil) et a sa propre adresse IP.
let numero = 0;
function navigateur(agent = ANDROID) {
  const cookies = new Map();
  numero += 1;
  const ip = `10.50.0.${numero}`;
  const appel = async (chemin, { methode = 'GET', donnees, langue } = {}) => {
    const headers = { 'User-Agent': agent, 'X-Forwarded-For': ip };
    if (donnees) headers['Content-Type'] = 'application/json';
    const tous = [...cookies].map(([nom, valeur]) => `${nom}=${valeur}`);
    if (langue) tous.push(`langue=${langue}`);
    if (tous.length) headers.Cookie = tous.join('; ');
    const r = await fetch(`${base}${chemin}`, { method: methode, headers, body: donnees ? JSON.stringify(donnees) : undefined });
    for (const ligne of r.headers.getSetCookie()) {
      const [nom, ...reste] = ligne.split(';')[0].split('=');
      if (reste.join('=') === '') cookies.delete(nom); else cookies.set(nom, reste.join('='));
    }
    const texte = await r.text();
    let corps = {};
    try { corps = JSON.parse(texte); } catch { /* une page HTML */ }
    return { statut: r.status, corps };
  };
  return {
    appel,
    poster: (chemin, donnees = {}) => appel(chemin, { methode: 'POST', donnees }),
    connexion: (cle, motDePasse = BON) => appel('/api/auth/connexion', { methode: 'POST', donnees: { email: adresse(cle), motDePasse } }),
    journal: async (options) => (await appel('/api/parametres/journal', options)).corps.journal,
  };
}

async function inscrire(cle) {
  const n = navigateur();
  const r = await n.poster('/api/auth/inscription', { type: 'client', prenom: cle, nomFamille: `Journal${lettres}`, email: adresse(cle), motDePasse: BON, pays: 'Burkina Faso', ville: 'Koudougou', whatsapp: '+22670000009', jeton: jetonAncien() });
  assert.equal(r.statut, 201, JSON.stringify(r.corps));
  await validerCompte(adresse(cle));
  membres[cle] = { id: r.corps.utilisateur.id, navigateur: n };
}

test.before(async () => {
  await migrer();
  serveur = creerApp().listen(0);
  base = `http://localhost:${serveur.address().port}`;
  for (const cle of ['awa', 'bintou']) await inscrire(cle);
});

test.after(async () => {
  await pool.query('DELETE FROM utilisateurs WHERE email LIKE $1', [`journal-%-${suffixe}@palabre.test`]);
  await new Promise((fini) => serveur.close(fini));
  await pool.end();
});

test('chaque événement de sécurité est noté, avec l\'appareil, du plus récent au plus ancien', async () => {
  const n = membres.awa.navigateur;
  assert.deepEqual(await n.journal(), [], 'un compte neuf n\'a rien à signaler');

  await n.poster('/api/auth/deconnexion');
  await n.connexion('awa', 'pas-le-bon-mot');                                         // connexion_refusee
  await n.connexion('awa');                                                          // connexion (appareil connu)
  const ordinateur = navigateur(WINDOWS);
  await ordinateur.connexion('awa');                                                 // nouvel_appareil
  const cle = (await n.appel('/api/parametres/sessions')).corps.sessions.find((s) => !s.actuelle).cle;
  await n.appel(`/api/parametres/sessions/${cle}`, { methode: 'DELETE', donnees: {} }); // session_revoquee (Firefox sur Windows)
  await n.appel('/api/parametres/deux-etapes', { methode: 'PUT', donnees: { active: true, motDePasse: BON } });  // deux_etapes_active
  await n.appel('/api/parametres/deux-etapes', { methode: 'PUT', donnees: { active: false, motDePasse: BON } }); // deux_etapes_coupee
  const nouvelle = adresse('awa-neuve');
  await n.poster('/api/parametres/email', { email: nouvelle, motDePasse: BON });
  assert.equal((await n.poster('/api/parametres/email/confirmer', { code: dernierCode(nouvelle) })).statut, 200); // email_change
  assert.equal((await n.appel('/api/parametres/mot-de-passe', { methode: 'PUT', donnees: { ancien: BON, nouveau: 'fromager-geant-27' } })).statut, 200); // mot_de_passe_change

  const journal = await n.journal();
  assert.deepEqual(journal.map((e) => [e.type, e.appareil]), [
    ['mot_de_passe_change', 'Chrome sur Android'],
    ['email_change', 'Chrome sur Android'],
    ['deux_etapes_coupee', 'Chrome sur Android'],
    ['deux_etapes_active', 'Chrome sur Android'],
    ['session_revoquee', 'Firefox sur Windows'],
    ['nouvel_appareil', 'Firefox sur Windows'],
    ['connexion', 'Chrome sur Android'],
    ['connexion_refusee', 'Chrome sur Android'],
  ]);
  // Rien d'autre ne sort : un type connu, un appareil, une date. Jamais d'adresse IP.
  for (const evenement of journal) {
    assert.deepEqual(Object.keys(evenement).sort(), ['appareil', 'le', 'type']);
    assert.ok(TYPES.includes(evenement.type) && Date.now() - new Date(evenement.le).getTime() < 120000);
  }
  assert.ok(!/10\.50\.|\d+\.\d+\.\d+\.\d+/.test(JSON.stringify(journal)));
  // En anglais, le nom de l'appareil est traduit (le type, lui, est un code : la page écrit la phrase).
  assert.equal((await n.journal({ langue: 'en' }))[0].appareil, 'Chrome on Android');
});

test('« Déconnecter tous les autres », mot de passe réinitialisé et « Ce n\'était pas moi » sont notés aussi', async () => {
  const n = membres.bintou.navigateur;
  // Rien à déconnecter : rien n'est noté.
  await n.poster('/api/parametres/deconnecter-autres');
  assert.deepEqual(await n.journal(), []);
  const intrus = navigateur(WINDOWS);
  await intrus.connexion('bintou');
  await n.poster('/api/parametres/deconnecter-autres');
  assert.deepEqual((await n.journal()).map((e) => e.type), ['session_revoquee', 'nouvel_appareil']);

  // L'intrus revient ; Bintou clique « Ce n'était pas moi » dans l'email, puis choisit un nouveau mot de passe.
  await intrus.connexion('bintou');
  const jeton = /pas-moi\?jeton=([0-9a-f]{64})/.exec(emailsEnvoyes.filter((m) => m.a === adresse('bintou') && /pas-moi/.test(m.texte)).pop().texte)[1];
  const protege = await navigateur().poster('/api/auth/pas-moi', { jeton });
  assert.equal((await navigateur().poster('/api/auth/reinitialiser', { jeton: protege.corps.suite.split('jeton=')[1], motDePasse: 'calebasse-pleine-63' })).statut, 200);
  const retour = navigateur();
  assert.equal((await retour.connexion('bintou', 'calebasse-pleine-63')).statut, 200);
  assert.deepEqual((await retour.journal()).map((e) => e.type), ['nouvel_appareil', 'mot_de_passe_change', 'session_revoquee', 'connexion', 'session_revoquee', 'nouvel_appareil']);
});

test('le journal est privé : chacun ne lit que le sien ; visiteur refusé ; un essai sur un compte inconnu ne note rien', async () => {
  const journalAwa = JSON.stringify(await membres.awa.navigateur.journal());
  const retour = navigateur();
  await retour.connexion('bintou', 'calebasse-pleine-63');
  const journalBintou = await retour.journal();
  assert.ok(journalBintou.length > 0 && journalBintou.length < 12);
  assert.notEqual(JSON.stringify(journalBintou), journalAwa);
  assert.equal((await navigateur().appel('/api/parametres/journal')).statut, 401);
  const { rows: [{ nb: avant }] } = await pool.query('SELECT count(*)::int AS nb FROM journal_securite');
  await navigateur().appel('/api/auth/connexion', { methode: 'POST', donnees: { email: `personne-${suffixe}@palabre.test`, motDePasse: 'peu-importe-12' } });
  const { rows: [{ nb: propres }] } = await pool.query('SELECT count(*)::int AS nb FROM journal_securite j JOIN utilisateurs u ON u.id = j.utilisateur_id WHERE u.email = $1', [`personne-${suffixe}@palabre.test`]);
  assert.equal(propres, 0);
  assert.ok(avant >= 0);
});

test('30 événements au plus à l\'écran ; au-delà de 90 jours, ils ne sont plus montrés puis sont effacés', async () => {
  const { id } = membres.awa;
  await pool.query('INSERT INTO journal_securite (utilisateur_id, type, appareil, cree_le) SELECT $1, \'connexion\', \'Chrome sur Android\', now() - (n || \' hours\')::interval FROM generate_series(40, 1, -1) AS n', [id]);
  await pool.query('INSERT INTO journal_securite (utilisateur_id, type, appareil, cree_le) VALUES ($1, \'connexion_refusee\', \'Vieil appareil\', now() - interval \'100 days\')', [id]);
  const journal = await membres.awa.navigateur.journal();
  assert.equal(journal.length, 30);
  assert.ok(!journal.some((e) => e.appareil === 'Vieil appareil'));
  // Le plus récent d'abord.
  const dates = journal.map((e) => new Date(e.le).getTime());
  assert.deepEqual(dates, [...dates].sort((a, b) => b - a));

  assert.ok(await purgerJournal() >= 1);
  const { rows: [reste] } = await pool.query('SELECT count(*) FILTER (WHERE cree_le < now() - interval \'90 days\')::int AS vieux, count(*)::int AS tous FROM journal_securite WHERE utilisateur_id = $1', [id]);
  assert.equal(reste.vieux, 0);
  assert.ok(reste.tous >= 40, 'les événements récents sont gardés');
  // La base refuse un type d'événement inventé.
  await assert.rejects(pool.query('INSERT INTO journal_securite (utilisateur_id, type) VALUES ($1, \'autre_chose\')', [id]));
});
