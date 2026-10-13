// Tests des corrections de la revue du code (docs/REVUE-CODE.md) : comptes de démonstration verrouillés, raté de la
// base sans déconnexion, push retiré avec les sessions, inscriptions simultanées, limites par adresse, déblocage
// d'un membre désactivé, liens des nouveaux comptes, index.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { creerApp } = require('../src/app');
const { migrer } = require('../src/db/migrate');
const db = require('../src/db/pool');
const { avecComptesPrets, jetonAncien } = require('./aide');
const { deNom } = require('../src/utils/notifications');

const { pool } = db;
let serveur;
let base;
const suffixe = Date.now();
const lettres = String(suffixe).replace(/\d/g, (chiffre) => 'abcdefghij'[chiffre]);
const membres = {};
const adresse = (cle) => `revue-${cle}-${suffixe}@palabre.test`;
const MOT_DE_PASSE = 'kolatier-vert-48';

// Chaque test peut se présenter avec sa propre adresse IP (en-tête du proxy), pour ne pas partager une limite.
async function appelBrut(chemin, { methode = 'GET', donnees, qui, cookie, ip } = {}) {
  const headers = {};
  if (donnees) headers['Content-Type'] = 'application/json';
  if (qui) headers.Cookie = membres[qui].cookie;
  if (cookie) headers.Cookie = cookie;
  if (ip) headers['X-Forwarded-For'] = ip;
  const r = await fetch(`${base}${chemin}`, { method: methode, headers, body: donnees ? JSON.stringify(donnees) : undefined });
  const texte = await r.text();
  let corps = {};
  try { corps = JSON.parse(texte); } catch { /* une page HTML */ }
  return { statut: r.status, corps, texte, entetes: r.headers };
}
const appel = avecComptesPrets(appelBrut);
const poster = (qui, chemin, donnees = {}) => appel(chemin, { methode: 'POST', qui, donnees });
const fiche = (cle, type = 'dev') => ({ type, prenom: cle, nomFamille: `Revue${lettres}`, email: adresse(cle), motDePasse: MOT_DE_PASSE, pays: 'Burkina Faso', ville: 'Koudougou', ...(type === 'client' ? { whatsapp: '+22670000009' } : {}) });

async function inscrire(cle, type = 'dev') {
  const r = await appel('/api/auth/inscription', { methode: 'POST', donnees: fiche(cle, type), ip: '10.60.0.1' });
  assert.equal(r.statut, 201, JSON.stringify(r.corps));
  membres[cle] = { cookie: r.entetes.get('set-cookie').split(';')[0], identifiant: r.corps.utilisateur.identifiant, id: r.corps.utilisateur.id };
}

test.before(async () => {
  await migrer();
  serveur = creerApp().listen(0);
  base = `http://localhost:${serveur.address().port}`;
  for (const cle of ['awa', 'bintou', 'demo']) await inscrire(cle);
  await inscrire('kadi', 'client');
  // Un compte de démonstration se reconnaît à son adresse.
  membres.demo.email = `revue-${suffixe}@demo.palabre.dev`;
  await pool.query('UPDATE utilisateurs SET email = $2 WHERE id = $1', [membres.demo.id, membres.demo.email]);
});

test.after(async () => {
  await pool.query('DELETE FROM utilisateurs WHERE email LIKE $1 OR email = $2', [`revue-%-${suffixe}@palabre.test`, `revue-${suffixe}@demo.palabre.dev`]);
  await new Promise((fini) => serveur.close(fini));
  await pool.end();
});

test('compte de démonstration : personne ne peut le prendre, le fermer ni déconnecter les autres', async () => {
  const essais = [
    ['PUT', '/api/parametres/mot-de-passe', { ancien: MOT_DE_PASSE, nouveau: 'baobab-bleu-93-nuit' }],
    ['POST', '/api/parametres/email', { email: adresse('voleur'), motDePasse: MOT_DE_PASSE }],
    ['PUT', '/api/parametres/deux-etapes', { active: true, motDePasse: MOT_DE_PASSE }],
    ['PUT', '/api/parametres/compte', { identifiant: `pris-${lettres}`.slice(0, 30) }],
    ['POST', '/api/parametres/desactiver', { motDePasse: MOT_DE_PASSE }],
    ['DELETE', '/api/parametres/compte', { motDePasse: MOT_DE_PASSE }],
    ['POST', '/api/parametres/deconnecter-autres', {}],
    ['DELETE', '/api/parametres/sessions/nimporte', {}],
  ];
  for (const [methode, chemin, donnees] of essais) {
    const r = await appel(chemin, { methode, qui: 'demo', donnees });
    assert.equal(r.statut, 403, `${methode} ${chemin}`);
    assert.match(r.corps.erreur, /compte de démonstration/);
  }
  // Rien n'a changé : le mot de passe connu ouvre toujours le compte, sans deuxième étape.
  const connexion = await appelBrut('/api/auth/connexion', { methode: 'POST', donnees: { email: membres.demo.email, motDePasse: MOT_DE_PASSE }, ip: '10.60.0.2' });
  assert.equal(connexion.statut, 200);
  assert.ok(connexion.corps.utilisateur, 'pas de deuxième étape');
  const { rows: [compte] } = await pool.query('SELECT deux_etapes, desactive_le, suppression_prevue_le FROM utilisateurs WHERE id = $1', [membres.demo.id]);
  assert.deepEqual(compte, { deux_etapes: false, desactive_le: null, suppression_prevue_le: null });
  // Le reste des paramètres lui reste ouvert (langue, confidentialité), et un compte ordinaire n'est pas concerné.
  assert.equal((await appel('/api/parametres/langue', { methode: 'PUT', qui: 'demo', donnees: { langue: 'fr' } })).statut, 200);
  assert.equal((await poster('awa', '/api/parametres/deconnecter-autres')).statut, 200);
});

test('raté de la base de données : erreur 500, mais la session n\'est pas effacée', async () => {
  const vraie = db.query;
  // La requête qui charge le membre et sa session échoue, comme pendant un redémarrage de la base.
  db.query = (texte, ...reste) => (/JOIN sessions s ON s\.utilisateur_id = u\.id/.test(String(texte)) ? Promise.reject(new Error('base injoignable')) : vraie(texte, ...reste));
  let pendant;
  try {
    pendant = await appelBrut('/api/auth/moi', { qui: 'awa' });
  } finally {
    db.query = vraie;
  }
  assert.equal(pendant.statut, 500);
  assert.equal(pendant.entetes.get('set-cookie'), null, 'le cookie de session n\'est pas effacé');
  assert.equal((await appelBrut('/api/auth/moi', { qui: 'awa' })).corps.utilisateur.id, membres.awa.id, 'toujours connectée ensuite');
  // Un jeton faux, lui, efface bien le cookie.
  const faux = await appelBrut('/api/auth/moi', { cookie: 'palabre_session=nimporte-quoi' });
  assert.equal(faux.corps.utilisateur, null);
  assert.match(faux.entetes.get('set-cookie') || '', /palabre_session=;/);
});

test('push : les abonnements partent quand les sessions sont fermées de force', async () => {
  const abonner = () => pool.query(
    'INSERT INTO abonnements_push (utilisateur_id, endpoint, p256dh, auth, appareil) VALUES ($1, $2, \'cle\', \'auth\', \'Téléphone d\'\'un intrus\')',
    [membres.bintou.id, `https://fcm.googleapis.com/fcm/send/revue-${suffixe}-${Math.random()}`],
  );
  const combien = async () => (await pool.query('SELECT count(*)::int AS nb FROM abonnements_push WHERE utilisateur_id = $1', [membres.bintou.id])).rows[0].nb;
  await abonner();
  assert.equal((await poster('bintou', '/api/parametres/deconnecter-autres')).statut, 200);
  assert.equal(await combien(), 0, '« Déconnecter les autres appareils »');
  await abonner();
  const change = await appel('/api/parametres/mot-de-passe', { methode: 'PUT', qui: 'bintou', donnees: { ancien: MOT_DE_PASSE, nouveau: 'fromager-ocre-71-soir' } });
  assert.equal(change.statut, 200, JSON.stringify(change.corps));
  assert.equal(await combien(), 0, 'changement de mot de passe');
  // Le changement, la fermeture des sessions et le journal sont dans la même transaction : la ligne du journal existe.
  const { rowCount } = await pool.query('SELECT 1 FROM journal_securite WHERE utilisateur_id = $1 AND type = \'mot_de_passe_change\'', [membres.bintou.id]);
  assert.equal(rowCount, 1);
});

test('inscription envoyée deux fois au même instant : un compte, et une réponse claire pour l\'autre', async () => {
  const donnees = { ...fiche('double'), jeton: jetonAncien(), accepteRegles: true };
  const reponses = await Promise.all([1, 2].map((n) => appelBrut('/api/auth/inscription', { methode: 'POST', donnees, ip: `10.60.1.${n}` })));
  const statuts = reponses.map((r) => r.statut).sort();
  assert.deepEqual(statuts, [201, 400], JSON.stringify(reponses.map((r) => r.corps)));
  const refus = reponses.find((r) => r.statut === 400);
  assert.equal(refus.corps.champ, 'email');
  assert.match(refus.corps.erreur, /Un compte existe déjà/);
});

test('connexion : les réussites ne comptent pas dans la limite par adresse IP', async () => {
  // Sur un réseau mobile, beaucoup d'abonnés sortent par la même adresse : 21 personnes s'y connectent à la suite.
  for (let i = 0; i < 21; i += 1) {
    const r = await appelBrut('/api/auth/connexion', { methode: 'POST', donnees: { email: adresse('awa'), motDePasse: MOT_DE_PASSE }, ip: '10.60.2.1' });
    assert.equal(r.statut, 200, `connexion n° ${i + 1}`);
  }
  // Les échecs, eux, sont toujours comptés (des adresses qui n'existent pas : aucun compte n'est verrouillé).
  let dernier;
  for (let i = 0; i < 21; i += 1) {
    dernier = await appelBrut('/api/auth/connexion', { methode: 'POST', donnees: { email: `personne-${i}-${suffixe}@palabre.test`, motDePasse: 'faux-mot-de-passe' }, ip: '10.60.2.2' });
  }
  assert.equal(dernier.statut, 429);
});

test('membre bloqué puis désactivé : on peut encore le débloquer depuis les paramètres', async () => {
  assert.ok((await poster('awa', `/api/messages/blocages/${membres.kadi.identifiant}`)).statut < 300);
  assert.equal((await poster('kadi', '/api/parametres/desactiver', { motDePasse: MOT_DE_PASSE })).statut, 200);
  const { bloques } = (await appel('/api/parametres/bloques', { qui: 'awa' })).corps;
  const ligne = bloques.find((b) => b.cle === membres.kadi.id);
  assert.ok(ligne, 'elle est dans la liste');
  assert.equal(ligne.identifiant, 'membre-indisponible', 'sans rien d\'elle');
  // Les blocages des autres ne se retirent pas : la requête filtre sur mon numéro de membre.
  assert.equal((await appel(`/api/parametres/bloques/${ligne.cle}`, { methode: 'DELETE', qui: 'bintou', donnees: {} })).statut, 404);
  assert.equal((await appel(`/api/parametres/bloques/${ligne.cle}`, { methode: 'DELETE', qui: 'awa', donnees: {} })).statut, 200);
  assert.equal((await appel('/api/parametres/bloques', { qui: 'awa' })).corps.bloques.some((b) => b.cle === membres.kadi.id), false);
});

test('nouveau compte : pas de lien dans une demande ni dans un projet', async () => {
  await inscrire('neuf', 'client');
  await inscrire('jeune');
  await pool.query('UPDATE utilisateurs SET cree_le = now() WHERE id = ANY($1::int[])', [[membres.neuf.id, membres.jeune.id]]);
  const demande = await poster('neuf', '/api/demandes', { titre: 'Site pour ma boutique de pagnes', description: 'Voir ma boutique sur https://exemple-boutique.bf avant de proposer un prix.', categorie: 'site-web' });
  assert.equal(demande.statut, 400);
  assert.equal(demande.corps.champ, 'description');
  assert.match(demande.corps.erreur, /liens à partir du/);
  const projet = await poster('jeune', '/api/projets', { titre: 'Caisse pour une boutique', description: 'Tout est sur https://exemple-caisse.bf pour les curieux.', secteur: 'commerce' });
  assert.equal(projet.statut, 400);
  assert.equal(projet.corps.champ, 'description');
  // Sans lien dans le texte, la demande passe (le lien d'un projet reste permis dans son propre champ).
  assert.equal((await poster('neuf', '/api/demandes', { titre: 'Site pour ma boutique de pagnes', description: 'Présenter mes pagnes et prendre les commandes par téléphone.', categorie: 'site-web' })).statut, 201);
});

test('« de Yao », « d\'Yves » : le serveur suit la même règle que la page', () => {
  assert.equal(deNom('Yao Kouassi'), 'de Yao Kouassi');
  assert.equal(deNom('Youssouf Traoré'), 'de Youssouf Traoré');
  assert.equal(deNom('Yves Ouédraogo'), 'd\'Yves Ouédraogo');
  assert.equal(deNom('Awa Sawadogo'), 'd\'Awa Sawadogo');
  assert.equal(deNom('Bintou Diallo'), 'de Bintou Diallo');
});

test('base : les index de la revue existent, un défi ne part plus avec son auteur', async () => {
  const { rows } = await pool.query('SELECT indexname FROM pg_indexes WHERE indexname = ANY($1::text[])', [['idx_messages_fichier', 'idx_notifications_liste', 'idx_notifications_cible']]);
  assert.equal(rows.length, 3);
  const { rows: [cle] } = await pool.query('SELECT confdeltype FROM pg_constraint WHERE conname = \'defis_auteur_id_fkey\'');
  assert.equal(cle.confdeltype, 'n', 'ON DELETE SET NULL');
});

test('service worker : ni les données, ni les images des membres ne sont gardées', () => {
  const sw = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
  assert.match(sw, /url\.pathname\.startsWith\('\/fichiers\/'\)/, 'les pièces des messages ne passent pas par le cache');
  assert.match(sw, /reponse\.ok && aGarder\(url\.pathname\)/, 'seuls les fichiers de l\'interface sont gardés');
});
