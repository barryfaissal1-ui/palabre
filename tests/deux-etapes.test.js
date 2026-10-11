// Tests de l'alerte de nouvelle connexion, de « Ce n'était pas moi », de la validation en deux étapes et des codes
// de secours. Chaque « navigateur » ci-dessous garde ses cookies, comme un vrai : c'est le cookie d'appareil qui
// distingue un appareil connu d'un appareil inconnu.
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const { creerApp } = require('../src/app');
const { migrer } = require('../src/db/migrate');
const { pool } = require('../src/db/pool');
const { validerCompte, jetonAncien, dernierEmail, emailsEnvoyes } = require('./aide');

let serveur;
let base;
const suffixe = Date.now();
const lettres = String(suffixe).replace(/\d/g, (chiffre) => 'abcdefghij'[chiffre]);
const adresse = (cle) => `etapes-${cle}-${suffixe}@palabre.test`;
const MOT_DE_PASSE = 'motdepasse1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36';

// Un navigateur : il garde les cookies que le serveur lui donne et les renvoie à chaque appel.
// Chacun a sa propre adresse IP (en-tête du proxy) : la limite de 20 connexions par quart d'heure et par adresse
// ne mélange donc pas les navigateurs de ce fichier.
let numero = 0;
function navigateur(agent = ANDROID) {
  const cookies = new Map();
  numero += 1;
  const ip = `10.20.${Math.floor(numero / 250)}.${(numero % 250) + 1}`;
  const appel = async (chemin, { methode = 'GET', donnees, entetes = {} } = {}) => {
    const headers = { 'User-Agent': agent, 'X-Forwarded-For': ip, ...entetes };
    if (donnees) headers['Content-Type'] = 'application/json';
    if (cookies.size) headers.Cookie = [...cookies].map(([nom, valeur]) => `${nom}=${valeur}`).join('; ');
    const r = await fetch(`${base}${chemin}`, { method: methode, headers, body: donnees ? JSON.stringify(donnees) : undefined, redirect: 'manual' });
    for (const ligne of r.headers.getSetCookie()) {
      const [nom, ...reste] = ligne.split(';')[0].split('=');
      if (reste.join('=') === '') cookies.delete(nom); else cookies.set(nom, reste.join('='));
    }
    const texte = await r.text();
    let corps = {};
    try { corps = JSON.parse(texte); } catch { /* une page HTML */ }
    return { statut: r.status, corps, texte, poses: r.headers.getSetCookie() };
  };
  return {
    cookies,
    appel,
    poster: (chemin, donnees = {}) => appel(chemin, { methode: 'POST', donnees }),
    connexion: (cle, motDePasse = MOT_DE_PASSE) => appel('/api/auth/connexion', { methode: 'POST', donnees: { email: adresse(cle), motDePasse } }),
    moi: async () => (await appel('/api/auth/moi')).corps.utilisateur,
  };
}

const membres = {};
async function inscrire(cle) {
  const n = navigateur();
  const r = await n.poster('/api/auth/inscription', { type: 'client', prenom: cle, nomFamille: `Etapes${lettres}`, email: adresse(cle), motDePasse: MOT_DE_PASSE, pays: 'Burkina Faso', ville: 'Koudougou', whatsapp: '+22670000009', jeton: jetonAncien() });
  assert.equal(r.statut, 201, JSON.stringify(r.corps));
  await validerCompte(adresse(cle));
  membres[cle] = { id: r.corps.utilisateur.id, navigateur: n };
  return n;
}
const alertes = (cle) => emailsEnvoyes.filter((m) => m.a === adresse(cle) && /Nouvelle connexion|New login/.test(m.sujet));
const codeConnexion = (cle) => /(?:code de connexion Palabre|Palabre login code)\s?: (\d{6})/.exec(dernierEmail(adresse(cle), /code de connexion|login code/).texte)[1];
// Les codes sont limités à un par minute : on vieillit ceux déjà partis pour ne pas attendre.
const vieillirCodes = (cle) => pool.query('UPDATE confirmations_email SET cree_le = cree_le - interval \'2 minutes\' WHERE utilisateur_id = $1', [membres[cle].id]);
const activer = (n, active = true, motDePasse = MOT_DE_PASSE) => n.appel('/api/parametres/deux-etapes', { methode: 'PUT', donnees: { active, motDePasse } });

test.before(async () => {
  await migrer();
  serveur = creerApp().listen(0);
  base = `http://localhost:${serveur.address().port}`;
  for (const cle of ['awa', 'bintou', 'cheick']) await inscrire(cle);
});

test.after(async () => {
  await pool.query('DELETE FROM utilisateurs WHERE email LIKE $1', [`etapes-%-${suffixe}@palabre.test`]);
  await new Promise((fini) => serveur.close(fini));
  await pool.end();
});

test('appareil connu : pas d\'alerte ; appareil inconnu : email « Nouvelle connexion » avec l\'appareil et la date GMT', async () => {
  const connu = membres.awa.navigateur;
  // Le cookie d'appareil : posé à l'inscription, signé, illisible par les scripts, gardé un an.
  const { rows: appareils } = await pool.query('SELECT appareil_hash, confiance FROM appareils_connus WHERE utilisateur_id = $1', [membres.awa.id]);
  assert.equal(appareils.length, 1);
  assert.ok(!connu.cookies.get('palabre_appareil').includes(appareils[0].appareil_hash), 'la base ne garde que l\'empreinte');
  await connu.poster('/api/auth/deconnexion');
  const retour = await connu.connexion('awa');
  assert.equal(retour.statut, 200);
  assert.equal(alertes('awa').length, 0, 'même appareil : aucune alerte');

  // Un autre navigateur, sans cookie d'appareil.
  const inconnu = navigateur('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0');
  const entree = await inconnu.connexion('awa');
  assert.equal(entree.statut, 200);
  assert.match(entree.poses.find((c) => c.startsWith('palabre_appareil=')), /HttpOnly/i);
  assert.match(entree.poses.find((c) => c.startsWith('palabre_appareil=')), /Max-Age=31536000/);
  assert.equal(alertes('awa').length, 1);
  const email = alertes('awa')[0];
  assert.equal(email.sujet, 'Nouvelle connexion à ton compte Palabre');
  assert.match(email.texte, /Appareil : Firefox sur Windows/);
  assert.match(email.texte, /Date : \d{1,2} \S+ \d{4} à \d{2}:\d{2} GMT/);
  assert.ok(!/Pays :/.test(email.texte), 'pas de pays quand il n\'est pas connu');
  assert.match(email.texte, /\/pas-moi\?jeton=[0-9a-f]{64}/);
  assert.match(email.html, /Ce n&#39;était pas moi/);
  assert.ok(!/\d+\.\d+\.\d+\.\d+|::1|::ffff/.test(email.texte + email.html), 'jamais d\'adresse IP dans l\'email');
  // La deuxième connexion depuis ce navigateur : il est maintenant connu.
  await inconnu.poster('/api/auth/deconnexion');
  await inconnu.connexion('awa');
  assert.equal(alertes('awa').length, 1);

  // Un cookie d'appareil fabriqué (signature fausse) ne rend pas un appareil « connu ».
  const tricheur = navigateur();
  tricheur.cookies.set('palabre_appareil', `${'a'.repeat(32)}.${'b'.repeat(64)}`);
  await tricheur.connexion('awa');
  assert.equal(alertes('awa').length, 2);
  membres.awa.intrus = tricheur;
});

test('« Ce n\'était pas moi » : lien à usage unique qui déconnecte tout, verrouille le compte et mène au nouveau mot de passe', async () => {
  const jeton = /pas-moi\?jeton=([0-9a-f]{64})/.exec(alertes('awa').pop().texte)[1];
  const { rows: [garde] } = await pool.query('SELECT jeton_hash, expire_le FROM alertes_connexion WHERE utilisateur_id = $1 ORDER BY id DESC LIMIT 1', [membres.awa.id]);
  assert.notEqual(garde.jeton_hash, jeton, 'le jeton est gardé haché');
  assert.ok(Math.abs(new Date(garde.expire_le).getTime() - Date.now() - 24 * 3600 * 1000) < 60000, 'valable 24 heures');

  // Ouvrir la page (ce que fait une messagerie qui contrôle les liens) ne déclenche rien.
  const visiteur = navigateur();
  const page = await visiteur.appel(`/pas-moi?jeton=${jeton}`);
  assert.equal(page.statut, 200);
  assert.ok(await membres.awa.intrus.moi(), 'la session de l\'intrus tient encore');
  assert.equal((await visiteur.poster('/api/auth/pas-moi', { jeton: 'f'.repeat(64) })).statut, 400);

  const protege = await visiteur.poster('/api/auth/pas-moi', { jeton });
  assert.equal(protege.statut, 200);
  assert.match(protege.corps.suite, /^\/reinitialiser\?jeton=[0-9a-f]{64}$/);
  // Tout le monde est dehors, et le bon mot de passe ne suffit plus.
  assert.equal(await membres.awa.intrus.moi(), null);
  assert.equal(await membres.awa.navigateur.moi(), null);
  const refuse = await membres.awa.intrus.connexion('awa');
  assert.deepEqual([refuse.statut, refuse.corps.suite], [403, '/mot-de-passe-oublie']);
  assert.match(refuse.corps.erreur, /verrouillé/);
  assert.equal(await membres.awa.intrus.moi(), null);
  // Le lien ne sert qu'une fois, et les autres alertes en attente ne valent plus rien non plus.
  assert.equal((await visiteur.poster('/api/auth/pas-moi', { jeton })).statut, 400);
  const autre = /pas-moi\?jeton=([0-9a-f]{64})/.exec(alertes('awa')[0].texte)[1];
  assert.equal((await visiteur.poster('/api/auth/pas-moi', { jeton: autre })).statut, 400);

  // Le nouveau mot de passe rouvre le compte.
  const nouveau = 'baobab-de-koudougou-7';
  assert.equal((await visiteur.poster('/api/auth/reinitialiser', { jeton: protege.corps.suite.split('jeton=')[1], motDePasse: nouveau })).statut, 200);
  assert.equal((await membres.awa.intrus.connexion('awa')).statut, 401, 'l\'ancien mot de passe ne marche plus');
  assert.equal((await visiteur.connexion('awa', nouveau)).statut, 200);
  // L'appareil de l'intrus a été oublié : il n'est plus « connu ».
  const { rows: [{ nb }] } = await pool.query('SELECT count(*)::int AS nb FROM appareils_connus WHERE utilisateur_id = $1', [membres.awa.id]);
  assert.equal(nb, 1, 'seul l\'appareil qui vient de se connecter est connu');
});

test('deux étapes : coupée par défaut, mot de passe exigé pour l\'activer, 8 codes de secours montrés une seule fois', async () => {
  const n = membres.bintou.navigateur;
  const avant = (await n.appel('/api/parametres')).corps.securite.deuxEtapes;
  assert.deepEqual(avant, { active: false, codesRestants: 0 });
  assert.equal((await activer(n, true, 'pas-le-bon')).statut, 400);
  assert.equal((await activer(n, 'oui')).statut, 400);
  assert.equal((await navigateur().appel('/api/parametres/deux-etapes', { methode: 'PUT', donnees: { active: true, motDePasse: MOT_DE_PASSE } })).statut, 401);
  assert.equal((await n.appel('/api/parametres')).corps.securite.deuxEtapes.active, false);

  const active = await activer(n);
  assert.equal(active.statut, 200);
  assert.equal(active.corps.codesSecours.length, 8);
  assert.ok(active.corps.codesSecours.every((code) => /^[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}$/.test(code)), active.corps.codesSecours.join(' '));
  assert.equal(new Set(active.corps.codesSecours).size, 8);
  membres.bintou.codes = active.corps.codesSecours;
  // En base : seulement des empreintes. Et la page ne les redonne plus jamais.
  const { rows } = await pool.query('SELECT code_hash FROM codes_secours WHERE utilisateur_id = $1', [membres.bintou.id]);
  assert.equal(rows.length, 8);
  assert.ok(rows.every((ligne) => /^[0-9a-f]{64}$/.test(ligne.code_hash) && !active.corps.codesSecours.some((code) => ligne.code_hash.includes(code.replace('-', '')))));
  const apres = (await n.appel('/api/parametres')).corps;
  assert.deepEqual(apres.securite.deuxEtapes, { active: true, codesRestants: 8 });
  assert.ok(!active.corps.codesSecours.some((code) => JSON.stringify(apres).includes(code)));

  // L'appareil où l'on vient d'activer est « de confiance » : s'y reconnecter ne demande pas de code.
  await n.poster('/api/auth/deconnexion');
  const retour = await n.connexion('bintou');
  assert.equal(retour.statut, 200);
  assert.ok(retour.corps.utilisateur && !retour.corps.deuxEtapes);
});

test('deux étapes : depuis un appareil inconnu, le bon mot de passe n\'ouvre rien sans le code reçu par email', async () => {
  const n = navigateur();
  const entree = await n.connexion('bintou');
  assert.equal(entree.statut, 200);
  assert.deepEqual(entree.corps, { deuxEtapes: true });
  assert.ok(!entree.poses.some((c) => c.startsWith('palabre_session=')), 'aucune session');
  assert.match(entree.poses.find((c) => c.startsWith('palabre_etape2=')), /HttpOnly/i);
  assert.equal(await n.moi(), null);
  // Le cookie d'attente ne donne accès à rien, même présenté comme un cookie de session.
  assert.equal((await n.appel('/api/parametres')).statut, 401);
  const faux = navigateur();
  faux.cookies.set('palabre_session', n.cookies.get('palabre_etape2'));
  assert.equal(await faux.moi(), null);
  // Et un jeton de session ne peut pas servir de cookie d'attente.
  const inverse = navigateur();
  inverse.cookies.set('palabre_etape2', jwt.sign({ id: membres.bintou.id, sid: 'a'.repeat(32) }, config.jwtSecret, { expiresIn: '5m' }));
  assert.equal((await inverse.appel('/api/auth/deux-etapes')).statut, 401);
  assert.equal((await navigateur().appel('/api/auth/deux-etapes')).statut, 401);

  // L'email : un code à 6 chiffres, jamais de lien de connexion ; la page ne reçoit que l'adresse masquée.
  const email = dernierEmail(adresse('bintou'), /code de connexion/);
  assert.match(email.sujet, /^Palabre – Ton code de connexion : \d{6}$/);
  assert.ok(!/https?:\/\/[^\s"]*(jeton|connexion)/.test(email.texte));
  const masque = (await n.appel('/api/auth/deux-etapes')).corps.email;
  assert.match(masque, /^e•+@palabre\.test$/);
  const { rows: [garde] } = await pool.query('SELECT code_hash, motif FROM confirmations_email WHERE utilisateur_id = $1 ORDER BY id DESC LIMIT 1', [membres.bintou.id]);
  assert.equal(garde.motif, 'connexion');
  assert.ok(!garde.code_hash.includes(codeConnexion('bintou')), 'le code est gardé haché');

  // Mauvais code, puis le bon.
  const code = codeConnexion('bintou');
  const mauvais = await n.poster('/api/auth/deux-etapes', { code: code === '000000' ? '111111' : '000000' });
  assert.deepEqual([mauvais.statut, mauvais.corps.champ], [400, 'code']);
  assert.match(mauvais.corps.erreur, /Il te reste 4 essais/);
  assert.equal(await n.moi(), null);
  const bon = await n.poster('/api/auth/deux-etapes', { code });
  assert.equal(bon.statut, 200);
  assert.equal((await n.moi()).email, adresse('bintou'));
  assert.ok(!n.cookies.has('palabre_etape2'), 'le cookie d\'attente est effacé');
  assert.equal((await n.poster('/api/auth/deux-etapes', { code })).statut, 401, 'le code ne sert qu\'une fois');
  // Un nouvel appareil a ouvert une session : le propriétaire reçoit aussi l'alerte.
  assert.equal(alertes('bintou').length, 1);

  // Sans « Faire confiance à cet appareil », le code est redemandé à la connexion suivante…
  await n.poster('/api/auth/deconnexion');
  await vieillirCodes('bintou');
  assert.deepEqual((await n.connexion('bintou')).corps, { deuxEtapes: true });
  // … avec la case cochée, il ne l'est plus.
  assert.equal((await n.poster('/api/auth/deux-etapes', { code: codeConnexion('bintou'), confiance: true })).statut, 200);
  await n.poster('/api/auth/deconnexion');
  const direct = await n.connexion('bintou');
  assert.ok(direct.corps.utilisateur && !direct.corps.deuxEtapes);
  assert.equal(alertes('bintou').length, 1, 'appareil désormais connu : pas de nouvelle alerte');
});

test('deux étapes : 5 essais par code, un renvoi par minute, et un mot de passe faux n\'envoie aucun code', async () => {
  const n = navigateur();
  const avant = emailsEnvoyes.length;
  assert.equal((await n.connexion('bintou', 'pas-le-bon')).statut, 401);
  assert.equal(emailsEnvoyes.length, avant, 'pas de code sans le bon mot de passe');

  await vieillirCodes('bintou');
  assert.deepEqual((await n.connexion('bintou')).corps, { deuxEtapes: true });
  const code = codeConnexion('bintou');
  const faux = code === '999999' ? '888888' : '999999';
  for (let essai = 0; essai < 5; essai += 1) assert.equal((await n.poster('/api/auth/deux-etapes', { code: faux })).statut, 400);
  const bloque = await n.poster('/api/auth/deux-etapes', { code });
  assert.equal(bloque.statut, 400);
  assert.match(bloque.corps.erreur, /Trop d'essais/);
  assert.equal(await n.moi(), null);
  // Renvoyer : refusé dans la minute, accepté ensuite ; le nouveau code remet les essais à zéro.
  assert.equal((await n.poster('/api/auth/deux-etapes/renvoyer')).statut, 429);
  await vieillirCodes('bintou');
  assert.equal((await n.poster('/api/auth/deux-etapes/renvoyer')).statut, 200);
  assert.notEqual(codeConnexion('bintou'), null);
  assert.equal((await n.poster('/api/auth/deux-etapes', { code: codeConnexion('bintou') })).statut, 200);
  // Annuler : le cookie d'attente est effacé.
  const autre = navigateur();
  await vieillirCodes('bintou');
  await autre.connexion('bintou');
  assert.equal((await autre.poster('/api/auth/deux-etapes/annuler')).statut, 200);
  assert.equal((await autre.appel('/api/auth/deux-etapes')).statut, 401);
});

test('codes de secours : chacun ne sert qu\'une fois, et un faux code compte dans les 5 essais', async () => {
  const [premier, deuxieme] = membres.bintou.codes;
  const n = navigateur();
  await vieillirCodes('bintou');
  await n.connexion('bintou');
  const faux = await n.poster('/api/auth/deux-etapes', { secours: 'aaaa-aaaa' });
  assert.deepEqual([faux.statut, faux.corps.champ], [400, 'secours']);
  assert.equal((await n.poster('/api/auth/deux-etapes', { secours: { $ne: '' } })).statut, 400);
  // Le bon code, écrit en majuscules et sans tiret : accepté.
  const entre = await n.poster('/api/auth/deux-etapes', { secours: premier.replace('-', '').toUpperCase() });
  assert.equal(entre.statut, 200);
  assert.equal((await n.moi()).email, adresse('bintou'));
  assert.equal((await n.appel('/api/parametres')).corps.securite.deuxEtapes.codesRestants, 7);

  // Le même code, une deuxième fois : refusé. Un autre : accepté.
  const m = navigateur();
  await vieillirCodes('bintou');
  await m.connexion('bintou');
  assert.equal((await m.poster('/api/auth/deux-etapes', { secours: premier })).statut, 400);
  assert.equal(await m.moi(), null);
  assert.equal((await m.poster('/api/auth/deux-etapes', { secours: deuxieme })).statut, 200);
  // Un code de secours d'un autre membre ne marche pas.
  const autre = (await activer(membres.cheick.navigateur)).corps.codesSecours[0];
  const p = navigateur();
  await vieillirCodes('bintou');
  await p.connexion('bintou');
  assert.equal((await p.poster('/api/auth/deux-etapes', { secours: autre })).statut, 400);
});

test('deux étapes coupée : mot de passe exigé, codes de secours effacés, la connexion redevient directe', async () => {
  const n = membres.cheick.navigateur;
  assert.equal((await activer(n, false, 'pas-le-bon')).statut, 400);
  assert.equal((await n.appel('/api/parametres')).corps.securite.deuxEtapes.active, true);
  const coupe = await activer(n, false);
  assert.deepEqual([coupe.statut, coupe.corps.active, coupe.corps.codesSecours], [200, false, null]);
  const { rows: [{ nb }] } = await pool.query('SELECT count(*)::int AS nb FROM codes_secours WHERE utilisateur_id = $1', [membres.cheick.id]);
  assert.equal(nb, 0);
  const ailleurs = navigateur();
  const entree = await ailleurs.connexion('cheick');
  assert.ok(entree.corps.utilisateur && !entree.corps.deuxEtapes);
});

test('en anglais : l\'alerte et le code de connexion partent dans la langue du membre', async () => {
  await pool.query('UPDATE utilisateurs SET langue = \'en\', deux_etapes = TRUE WHERE id = $1', [membres.cheick.id]);
  const n = navigateur();
  assert.deepEqual((await n.connexion('cheick')).corps, { deuxEtapes: true });
  const email = dernierEmail(adresse('cheick'), /login code/);
  assert.match(email.sujet, /^Palabre – Your login code: \d{6}$/);
  assert.match(email.html, /Confirm it&#39;s you|Confirm it's you/);
  assert.equal((await n.poster('/api/auth/deux-etapes', { code: /login code: (\d{6})/.exec(email.texte)[1] })).statut, 200);
  const alerte = dernierEmail(adresse('cheick'), /New login/);
  assert.equal(alerte.sujet, 'New login to your Palabre account');
  assert.match(alerte.texte, /Device: Chrome on Android/);
  assert.match(alerte.texte, /Date: \d{1,2} \S+ \d{4} at \d{2}:\d{2} GMT/);
});
