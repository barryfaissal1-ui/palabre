// Tests de l'inscription en deux étapes : protections contre les robots, code de confirmation de l'email,
// page 2 des développeurs (« Ton profil de dev ») et ce qu'un dev au profil incomplet ne peut pas faire.
const test = require('node:test');
const assert = require('node:assert/strict');
const { creerApp } = require('../src/app');
const { migrer } = require('../src/db/migrate');
const { pool } = require('../src/db/pool');
const { changerRole } = require('../src/db/admin');
const liens = require('../src/utils/liens');
const { jetonOuverture } = require('../src/utils/inscription');
const { IDENTIFIANTS_RESERVES } = require('../src/utils/validation');
const { validerCompte, jetonAncien, dernierCode } = require('./aide');

let serveur;
let base;
const suffixe = Date.now();
const lettres = String(suffixe).replace(/\d/g, (chiffre) => 'abcdefghij'[chiffre]);
const membres = {}; // cle → { cookie, identifiant, email }
const adresse = (cle) => `inscr-${cle}-${suffixe}@palabre.test`;

// Faux contrôle des liens : les tests ne doivent pas dépendre d'internet. Ici, seul GitHub « répond ».
const vraiVerifierLien = liens.verifierLien;
liens.verifierLien = async (lien) => lien.includes('github.com');

async function appel(chemin, { methode = 'GET', donnees, qui } = {}) {
  const headers = {};
  if (donnees) headers['Content-Type'] = 'application/json';
  if (qui) headers.Cookie = membres[qui].cookie;
  const r = await fetch(`${base}${chemin}`, { method: methode, headers, body: donnees ? JSON.stringify(donnees) : undefined });
  const texte = await r.text();
  let corps;
  try { corps = JSON.parse(texte); } catch { corps = texte; }
  return { statut: r.status, corps, entetes: r.headers };
}
const poster = (qui, chemin, donnees = {}) => appel(chemin, { methode: 'POST', qui, donnees });

const fiche = (cle, type, extra = {}) => ({
  type, prenom: cle, nomFamille: `Inscr${lettres}`, email: adresse(cle), motDePasse: 'kolatier-vert-48', pays: 'Burkina Faso', ville: 'Koudougou', jeton: jetonAncien(), accepteRegles: true, ...extra,
});

// Inscription par la vraie route ; le compte reste « à confirmer » (aucun raccourci ici).
async function inscrire(cle, type, extra) {
  const r = await appel('/api/auth/inscription', { methode: 'POST', donnees: fiche(cle, type, extra) });
  assert.equal(r.statut, 201, JSON.stringify(r.corps));
  membres[cle] = { cookie: r.entetes.get('set-cookie').split(';')[0], identifiant: r.corps.utilisateur.identifiant, email: adresse(cle) };
  return r;
}

// Date de naissance de quelqu'un qui a exactement cet âge aujourd'hui (plus un décalage en jours).
function neIlYA(annees, joursEnPlus = 0) {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - annees);
  date.setUTCDate(date.getUTCDate() - joursEnPlus);
  return date.toISOString().slice(0, 10);
}

const PROFIL_DEV = {
  dateNaissance: '1998-04-12', specialite: 'web', experience: '3-5',
  liens: { github: 'github.com/awa-dev', gitlab: '', portfolio: 'https://awa.example.com', linkedin: '' },
  whatsapp: '+226 70 00 00 00', bio: 'Développeuse web à Koudougou, Node.js et PostgreSQL.',
};
const completer = (qui, extra = {}) => appel('/api/profils/moi/profil-dev', { methode: 'PUT', qui, donnees: { ...PROFIL_DEV, ...extra } });

test.before(async () => {
  await migrer();
  serveur = creerApp().listen(0);
  base = `http://localhost:${serveur.address().port}`;
});

test.after(async () => {
  liens.verifierLien = vraiVerifierLien;
  await pool.query('DELETE FROM utilisateurs WHERE email LIKE $1', [`inscr-%-${suffixe}@palabre.test`]);
  serveur.close();
  await pool.end();
});

// ---------- 1. Contre les robots ----------

test('champ piège rempli : inscription refusée, sans dire pourquoi, et aucun compte créé', async () => {
  const r = await appel('/api/auth/inscription', { methode: 'POST', donnees: fiche('robot', 'dev', { siteWeb: 'http://spam.example' }) });
  assert.equal(r.statut, 400);
  assert.equal(r.corps.champ, undefined, 'aucun champ désigné');
  assert.doesNotMatch(r.corps.erreur, /pi[èe]ge|robot|site/i);
  const { rowCount } = await pool.query('SELECT 1 FROM utilisateurs WHERE email = $1', [adresse('robot')]);
  assert.equal(rowCount, 0);
  // Le champ est bien dans la page, invisible au clavier et aux lecteurs d'écran.
  const page = await (await fetch(`${base}/inscription`)).text();
  assert.match(page, /<div class="champ-piege" aria-hidden="true">[\s\S]*?name="siteWeb" type="text" tabindex="-1" autocomplete="off"/);
});

test('envoi trop rapide, ou heure d\'ouverture absente, falsifiée ou trop ancienne : refusé', async () => {
  const essai = async (jeton) => appel('/api/auth/inscription', { methode: 'POST', donnees: fiche('presse', 'client', { jeton }) });
  // Le jeton que donne le serveur est tout frais : s'en servir aussitôt, c'est aller plus vite qu'une personne.
  const { corps: { jeton } } = await appel('/api/auth/jeton-inscription');
  assert.match(jeton, /^\d+\.[0-9a-f]{64}$/);
  const rapide = await essai(jeton);
  assert.equal(rapide.statut, 400);
  assert.match(rapide.corps.erreur, /trop rapide/i);
  // Le navigateur ne peut pas vieillir l'heure lui-même : la signature ne correspond plus.
  const [, signature] = jeton.split('.');
  assert.equal((await essai(`${Date.now() - 60000}.${signature}`)).statut, 400);
  assert.equal((await essai(undefined)).statut, 400);
  assert.equal((await essai('n\'importe quoi')).statut, 400);
  assert.match((await essai(jetonOuverture(Date.now() - 7 * 60 * 60 * 1000))).corps.erreur, /trop longtemps/);
  const { rowCount } = await pool.query('SELECT 1 FROM utilisateurs WHERE email = $1', [adresse('presse')]);
  assert.equal(rowCount, 0);
  // Juste après les 3 secondes : accepté (même adresse, donc le compte n'existait toujours pas).
  assert.equal((await essai(jetonOuverture(Date.now() - 3100))).statut, 201);
});

// ---------- 2. Confirmation de l'email ----------

test('email non confirmé : le membre ne peut rien faire d\'autre que saisir son code', async () => {
  const r = await inscrire('awa', 'dev', { whatsapp: '+22670000001' });
  assert.equal(r.corps.utilisateur.emailConfirme, false);
  assert.equal(r.corps.utilisateur.profilComplet, false);
  assert.equal(r.corps.utilisateur.whatsapp, null, 'le numéro d\'un dev se donne à l\'étape 2');
  for (const [chemin, options] of [
    ['/api/publications', {}], ['/api/demandes', {}], ['/api/profils/moi', { methode: 'PUT', donnees: {} }],
    ['/api/publications', { methode: 'POST', donnees: { type: 'idee', texte: 'Bonjour à tous' } }], ['/api/messages/non-lus', {}],
  ]) {
    const refus = await appel(chemin, { ...options, qui: 'awa' });
    assert.equal(refus.statut, 403, chemin);
    assert.equal(refus.corps.suite, '/confirmer-email');
  }
  // Ce qui reste ouvert : savoir qui je suis, me déconnecter, et les pages elles-mêmes.
  assert.equal((await appel('/api/auth/moi', { qui: 'awa' })).corps.utilisateur.emailConfirme, false);
  assert.equal((await fetch(`${base}/confirmer-email`)).status, 200);
  // Se reconnecter ne confirme rien.
  const connexion = await appel('/api/auth/connexion', { methode: 'POST', donnees: { email: adresse('awa'), motDePasse: 'kolatier-vert-48' } });
  assert.equal(connexion.corps.utilisateur.emailConfirme, false);
});

test('le code est envoyé par email, gardé haché, et le bon code confirme l\'adresse', async () => {
  const code = dernierCode(adresse('awa'));
  assert.match(code, /^\d{6}$/);
  const { rows } = await pool.query(
    'SELECT c.code_hash, c.expire_le - c.cree_le AS duree FROM confirmations_email c JOIN utilisateurs u ON u.id = c.utilisateur_id WHERE u.email = $1',
    [adresse('awa')],
  );
  assert.equal(rows.length, 1);
  assert.match(rows[0].code_hash, /^[0-9a-f]{64}$/);
  assert.ok(!rows[0].code_hash.includes(code), 'jamais le code en clair');
  assert.equal(rows[0].duree.minutes, 15);

  // Code mal écrit, puis code faux : refusés, et le nombre d'essais restants est annoncé.
  assert.equal((await poster('awa', '/api/auth/confirmer-email', { code: '12' })).statut, 400);
  const faux = await poster('awa', '/api/auth/confirmer-email', { code: code === '000000' ? '000001' : '000000' });
  assert.equal(faux.statut, 400);
  assert.equal(faux.corps.champ, 'code');
  assert.match(faux.corps.erreur, /4 essais/);
  assert.equal((await appel('/api/auth/moi', { qui: 'awa' })).corps.utilisateur.emailConfirme, false);
  // Un visiteur ne peut pas confirmer le compte de quelqu'un d'autre.
  assert.equal((await appel('/api/auth/confirmer-email', { methode: 'POST', donnees: { code } })).statut, 401);

  const juste = await poster('awa', '/api/auth/confirmer-email', { code: `${code.slice(0, 3)} ${code.slice(3)}` }); // l'espace est toléré
  assert.equal(juste.statut, 200);
  assert.equal(juste.corps.profilComplet, false, 'un dev a encore l\'étape 2 à faire');
  assert.equal((await appel('/api/auth/moi', { qui: 'awa' })).corps.utilisateur.emailConfirme, true);
  assert.equal((await appel('/api/publications', { qui: 'awa' })).statut, 200, 'le site s\'ouvre');
  // Les codes ne traînent pas en base une fois l'adresse confirmée.
  const reste = await pool.query('SELECT 1 FROM confirmations_email c JOIN utilisateurs u ON u.id = c.utilisateur_id WHERE u.email = $1', [adresse('awa')]);
  assert.equal(reste.rowCount, 0);
  assert.equal((await poster('awa', '/api/auth/renvoyer-code')).statut, 400, 'plus rien à renvoyer');
});

test('code expiré, trop d\'essais, et bouton « Renvoyer le code » limité', async () => {
  await inscrire('bintou', 'dev');
  const idBintou = (await pool.query('SELECT id FROM utilisateurs WHERE email = $1', [adresse('bintou')])).rows[0].id;
  const premier = dernierCode(adresse('bintou'));
  const autre = (code) => (code === '111111' ? '222222' : '111111');

  // Renvoyer tout de suite : refusé (un code par minute).
  const tropTot = await poster('bintou', '/api/auth/renvoyer-code');
  assert.equal(tropTot.statut, 429);
  assert.match(tropTot.corps.erreur, /minute/);

  // Code expiré (on avance l'horloge en reculant la date d'expiration) : même le bon code est refusé.
  await pool.query('UPDATE confirmations_email SET expire_le = now() - interval \'1 second\', cree_le = now() - interval \'16 minutes\' WHERE utilisateur_id = $1', [idBintou]);
  const expire = await poster('bintou', '/api/auth/confirmer-email', { code: premier });
  assert.equal(expire.statut, 400);
  assert.match(expire.corps.erreur, /expiré/);

  // Nouveau code : l'ancien ne vaut plus rien.
  const renvoi = await poster('bintou', '/api/auth/renvoyer-code');
  assert.equal(renvoi.statut, 200);
  const second = dernierCode(adresse('bintou'));
  assert.match(second, /^\d{6}$/);

  // Cinq essais faux : le code est grillé, même la bonne réponse ne passe plus.
  for (let essai = 1; essai <= 5; essai += 1) {
    const r = await poster('bintou', '/api/auth/confirmer-email', { code: autre(second) });
    assert.equal(r.statut, 400);
    assert.match(r.corps.erreur, essai < 5 ? /Code incorrect\. Il te reste/ : /Demande un nouveau code/);
  }
  const grille = await poster('bintou', '/api/auth/confirmer-email', { code: second });
  assert.equal(grille.statut, 400);
  assert.match(grille.corps.erreur, /Trop d'essais/);
  assert.equal((await appel('/api/auth/moi', { qui: 'bintou' })).corps.utilisateur.emailConfirme, false);

  // Cinq renvois par heure : on vieillit chaque envoi de 2 minutes pour ne tester que cette limite-là.
  const vieillir = () => pool.query('UPDATE confirmations_email SET cree_le = cree_le - interval \'2 minutes\' WHERE utilisateur_id = $1', [idBintou]);
  for (let renvoiNumero = 2; renvoiNumero <= 5; renvoiNumero += 1) {
    await vieillir();
    assert.equal((await poster('bintou', '/api/auth/renvoyer-code')).statut, 200, `renvoi ${renvoiNumero}`);
  }
  await vieillir();
  const tropDeCodes = await poster('bintou', '/api/auth/renvoyer-code');
  assert.equal(tropDeCodes.statut, 429);
  assert.match(tropDeCodes.corps.erreur, /heure/);

  // Le dernier code reçu, lui, fonctionne.
  assert.equal((await poster('bintou', '/api/auth/confirmer-email', { code: dernierCode(adresse('bintou')) })).statut, 200);
});

// ---------- 3. Les clients n'ont pas de page 2 ----------

test('client : la confirmation de l\'email suffit, pas de page 2', async () => {
  const r = await inscrire('kadi', 'client', { whatsapp: '+22670000002' });
  assert.equal(r.corps.utilisateur.whatsapp, '+22670000002', 'le client donne son numéro dès la page 1');
  assert.equal(r.corps.utilisateur.profilComplet, true);
  const confirme = await poster('kadi', '/api/auth/confirmer-email', { code: dernierCode(adresse('kadi')) });
  assert.equal(confirme.corps.profilComplet, true);
  const demande = await poster('kadi', '/api/demandes', { titre: 'Site pour mon restaurant', description: 'Je veux un site avec le menu, les horaires et la commande par WhatsApp.', budgetFcfa: 250000, delai: '3 semaines', categorie: 'site-web' });
  assert.equal(demande.statut, 201);
  membres.kadi.demande = demande.corps.demande.id;
  // La page 2 est réservée aux devs.
  assert.equal((await completer('kadi')).statut, 403);
});

// ---------- 4. Dev au profil incomplet ----------

test('dev sans profil complet : il regarde le site, mais ne propose pas, ne forme pas d\'équipe et n\'écrit pas à un client', async () => {
  // Il peut regarder…
  assert.equal((await appel('/api/demandes', { qui: 'awa' })).statut, 200);
  assert.equal((await appel(`/api/demandes/${membres.kadi.demande}`, { qui: 'awa' })).statut, 200);
  assert.equal((await poster('awa', '/api/publications', { type: 'idee', texte: 'Bonjour, je découvre Palabre.' })).statut, 201);
  // … écrire à un autre dev…
  assert.equal((await poster('awa', `/api/messages/avec/${membres.bintou.identifiant}`, { texte: 'Salut Bintou !' })).statut, 201);

  // … mais pas répondre aux demandes.
  const proposition = await poster('awa', `/api/demandes/${membres.kadi.demande}/propositions`, { message: 'Bonjour, je peux réaliser ce projet dans les délais.', montantFcfa: 200000 });
  assert.equal(proposition.statut, 403);
  assert.equal(proposition.corps.suite, '/bienvenue');
  assert.match(proposition.corps.erreur, /Termine ton profil de dev/);
  const equipe = await poster('awa', `/api/demandes/${membres.kadi.demande}/equipes`, { message: 'Notre équipe couvre tout le projet.', montantFcfa: 400000, roleChef: 'Chef', membres: [{ identifiant: membres.bintou.identifiant, role: 'Design' }] });
  assert.equal(equipe.statut, 403);
  assert.equal(equipe.corps.suite, '/bienvenue');
  assert.equal((await poster('awa', '/api/equipes/1/accepter')).statut, 403, 'rejoindre une équipe');
  const message = await poster('awa', `/api/messages/avec/${membres.kadi.identifiant}`, { texte: 'Bonjour, votre projet m\'intéresse.' });
  assert.equal(message.statut, 403);
  assert.equal(message.corps.suite, '/bienvenue');
});

// ---------- 5. La page 2 : « Ton profil de dev » ----------

test('dev de moins de 18 ans : refusé avec un message clair ; 18 ans aujourd\'hui : accepté', async () => {
  const mineur = await completer('awa', { dateNaissance: neIlYA(18, -1) }); // aura 18 ans demain
  assert.equal(mineur.statut, 400);
  assert.equal(mineur.corps.champ, 'dateNaissance');
  assert.match(mineur.corps.erreur, /au moins 18 ans/);
  for (const date of ['', '2001-02-31', '12/04/1998', neIlYA(140)]) {
    const r = await completer('awa', { dateNaissance: date });
    assert.equal(r.statut, 400, date);
    assert.equal(r.corps.champ, 'dateNaissance', date);
  }
  assert.equal((await appel('/api/auth/moi', { qui: 'awa' })).corps.utilisateur.profilComplet, false, 'rien n\'a été enregistré');
  assert.equal((await completer('bintou', { dateNaissance: neIlYA(18), liens: {}, sansLien: true })).statut, 200);
});

test('page 2 : champs obligatoires, liens contrôlés, au moins un lien ou la case « pas encore de lien »', async () => {
  const refus = async (extra, champ) => {
    const r = await completer('awa', extra);
    assert.equal(r.statut, 400, JSON.stringify(extra));
    assert.equal(r.corps.champ, champ, JSON.stringify(extra));
  };
  await refus({ specialite: 'astronaute' }, 'specialite');
  await refus({ specialite: undefined }, 'specialite');
  await refus({ experience: '10 ans' }, 'experience');
  await refus({ bio: 'Trop court' }, 'bio');
  await refus({ bio: 'x'.repeat(301) }, 'bio');
  await refus({ whatsapp: 'abc' }, 'whatsapp');
  await refus({ liens: {} }, 'liens');
  await refus({ liens: { github: '', gitlab: '', portfolio: '', linkedin: '' } }, 'liens');
  // Chaque lien doit être sur son site ; les adresses internes sont refusées comme pour les projets.
  await refus({ liens: { github: 'https://gitlab.com/awa' } }, 'github');
  await refus({ liens: { github: 'https://github.com.pirate.example/awa' } }, 'github');
  await refus({ liens: { linkedin: 'https://facebook.com/awa' } }, 'linkedin');
  await refus({ liens: { portfolio: 'http://127.0.0.1/admin' } }, 'portfolio');
  await refus({ liens: { portfolio: 'http://localhost:5432' } }, 'portfolio');
  await refus({ liens: { portfolio: 'javascript:alert(1)' } }, 'portfolio');
});

test('dev au profil complet : liens vérifiés affichés, et il peut proposer et écrire au client', async () => {
  const r = await completer('awa');
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  const moi = (await appel('/api/auth/moi', { qui: 'awa' })).corps.utilisateur;
  assert.equal(moi.profilComplet, true);
  assert.equal(moi.whatsapp, '+22670000000');

  const profil = (await appel(`/api/profils/${membres.awa.identifiant}`)).corps.profil; // vu par un visiteur
  assert.equal(profil.specialiteNom, 'Développement web');
  assert.equal(profil.experienceNom, '3 à 5 ans');
  assert.equal(profil.aConfirmer, false);
  assert.deepEqual(profil.liens, [
    { type: 'github', nom: 'GitHub', url: 'https://github.com/awa-dev', verifie: true }, // le faux contrôle « répond » pour GitHub
    { type: 'portfolio', nom: 'Portfolio', url: 'https://awa.example.com/', verifie: false },
  ]);

  const proposition = await poster('awa', `/api/demandes/${membres.kadi.demande}/propositions`, { message: 'Bonjour, je peux réaliser ce projet dans les délais.', montantFcfa: 200000 });
  assert.equal(proposition.statut, 201);
  assert.equal((await poster('awa', `/api/messages/avec/${membres.kadi.identifiant}`, { texte: 'Bonjour, voici ma proposition.' })).statut, 201);
});

test('dev sans aucun lien : il continue, avec la mention « Profil à confirmer » jusqu\'à ce qu\'il en ajoute un', async () => {
  const avant = (await appel(`/api/profils/${membres.bintou.identifiant}`)).corps.profil;
  assert.equal(avant.aConfirmer, true);
  assert.deepEqual(avant.liens, []);
  // Il n'est pas bloqué pour autant.
  assert.equal((await poster('bintou', `/api/demandes/${membres.kadi.demande}/propositions`, { message: 'Bonjour, je peux aussi réaliser ce projet.', montantFcfa: 180000 })).statut, 201);

  // Il ajoute un lien dans « Modifier mon profil » : la mention disparaît.
  const modif = await appel('/api/profils/moi', {
    methode: 'PUT', qui: 'bintou',
    donnees: { prenom: 'bintou', nomFamille: `Inscr${lettres}`, identifiant: membres.bintou.identifiant, pays: 'Burkina Faso', ville: 'Koudougou', whatsapp: '', bio: 'Développeuse mobile.', disponible: true, competences: [], specialite: 'mobile', experience: '1-2', liens: { gitlab: 'gitlab.com/bintou' } },
  });
  assert.equal(modif.statut, 200, JSON.stringify(modif.corps));
  assert.equal(modif.corps.profil.aConfirmer, false);
  assert.equal(modif.corps.profil.specialiteNom, 'Mobile');
  assert.deepEqual(modif.corps.profil.liens, [{ type: 'gitlab', nom: 'GitLab', url: 'https://gitlab.com/bintou', verifie: false }]);
  // Un mauvais lien est refusé là aussi.
  const mauvais = await appel('/api/profils/moi', {
    methode: 'PUT', qui: 'bintou',
    donnees: { prenom: 'bintou', nomFamille: `Inscr${lettres}`, identifiant: membres.bintou.identifiant, pays: 'Burkina Faso', ville: 'Koudougou', whatsapp: '', bio: '', disponible: true, competences: [], liens: { github: 'http://192.168.1.1/' } },
  });
  assert.equal(mauvais.statut, 400);
  assert.equal(mauvais.corps.champ, 'github');
});

// ---------- 6. La date de naissance ne sort jamais ----------

test('date de naissance : absente de toutes les réponses publiques ; seul l\'administrateur voit l\'âge', async () => {
  const { rows: [enBase] } = await pool.query('SELECT to_char(date_naissance, \'YYYY-MM-DD\') AS date FROM utilisateurs WHERE email = $1', [adresse('awa')]);
  assert.equal(enBase.date, '1998-04-12', 'elle est bien enregistrée');
  const reponses = [
    await appel(`/api/profils/${membres.awa.identifiant}`), // visiteur
    await appel(`/api/profils/${membres.awa.identifiant}`, { qui: 'kadi' }), // autre membre
    await appel(`/api/profils/${membres.awa.identifiant}`, { qui: 'awa' }), // elle-même
    await appel('/api/auth/moi', { qui: 'awa' }),
    await appel(`/api/devs?q=${encodeURIComponent(`Inscr${lettres}`)}`, { qui: 'kadi' }),
    await appel(`/api/profils/${membres.awa.identifiant}/amis`, { qui: 'kadi' }),
    await appel(`/api/demandes/${membres.kadi.demande}`, { qui: 'kadi' }), // la cliente voit la proposition d'Awa
    await appel('/api/publications', { qui: 'kadi' }),
    await appel('/api/admin/membres-recents', { qui: 'kadi' }), // pas administratrice
  ];
  for (const r of reponses) {
    const texte = JSON.stringify(r.corps);
    assert.doesNotMatch(texte, /naissance/i);
    assert.doesNotMatch(texte, /1998-04-12/);
    assert.doesNotMatch(texte, /"age"/);
  }
  assert.equal(reponses[8].statut, 403);

  // L'administrateur voit l'âge (pas la date) et où en est chaque inscription.
  await changerRole(adresse('kadi'), true);
  // La liste montre les 50 derniers inscrits, et les autres fichiers de tests créent des comptes en même temps :
  // on date ces deux comptes de maintenant pour qu'ils y soient à coup sûr.
  await pool.query('UPDATE utilisateurs SET cree_le = now() WHERE email = ANY($1)', [[adresse('awa'), adresse('kadi')]]);
  const admin = await appel('/api/admin/membres-recents', { qui: 'kadi' });
  assert.equal(admin.statut, 200);
  const ligne = admin.corps.membres.find((m) => m.identifiant === membres.awa.identifiant);
  const ageAttendu = new Date().getUTCFullYear() - 1998 - (new Date().toISOString().slice(5, 10) < '04-12' ? 1 : 0);
  assert.equal(ligne.age, ageAttendu);
  assert.equal(ligne.specialite, 'Développement web');
  assert.equal(ligne.profilComplet, true);
  assert.equal(admin.corps.membres.find((m) => m.identifiant === membres.kadi.identifiant).age, null, 'un client n\'a pas de date de naissance');
  assert.doesNotMatch(JSON.stringify(admin.corps), /1998-04-12|naissance/);
});

// ---------- 7. Divers ----------

test('pages et adresses réservées', async () => {
  for (const mot of ['bienvenue', 'confirmer-email']) {
    assert.ok(IDENTIFIANTS_RESERVES.has(mot), `${mot} est réservé`);
    const page = await fetch(`${base}/${mot}`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /<script src="\/js\/theme\.js\?v=[0-9a-f]+"><\/script>\s*<link rel="stylesheet"/, 'theme.js avant la feuille de style');
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)|\sstyle="/, 'ni script ni style en ligne');
  }
  assert.match(await (await fetch(`${base}/bienvenue`)).text(), /Étape 2 sur 2/);
  const sw = await (await fetch(`${base}/sw.js`)).text();
  for (const fichier of ['/bienvenue', '/confirmer-email', '/js/bienvenue.js', '/js/confirmer-email.js']) assert.ok(sw.includes(`'${fichier}'`), fichier);
});

test('mot de passe réinitialisé par le lien reçu : l\'email est confirmé du même coup', async () => {
  await inscrire('cheick', 'client');
  const { emailsEnvoyes } = require('./aide');
  assert.equal((await appel('/api/auth/mot-de-passe-oublie', { methode: 'POST', donnees: { email: adresse('cheick') } })).statut, 200);
  const jeton = /jeton=([0-9a-f]+)/.exec(emailsEnvoyes.filter((m) => m.a === adresse('cheick')).pop().texte)[1];
  assert.equal((await appel('/api/auth/reinitialiser', { methode: 'POST', donnees: { jeton, motDePasse: 'nouveau-mot-de-passe' } })).statut, 200);
  // (La réinitialisation ferme les anciennes sessions : on se reconnecte avec le nouveau mot de passe.)
  const connexion = await appel('/api/auth/connexion', { methode: 'POST', donnees: { email: adresse('cheick'), motDePasse: 'nouveau-mot-de-passe' } });
  assert.equal(connexion.statut, 200);
  assert.equal(connexion.corps.utilisateur.emailConfirme, true);
});

test('comptes créés avant cette étape : email confirmé, profil de dev à compléter', async () => {
  // Un compte « d'avant » : la migration a rempli email_confirme_le une fois pour toutes, mais pas le profil de dev.
  await inscrire('dao', 'dev');
  await pool.query('UPDATE utilisateurs SET email_confirme_le = cree_le WHERE email = $1', [adresse('dao')]);
  const connexion = await appel('/api/auth/connexion', { methode: 'POST', donnees: { email: adresse('dao'), motDePasse: 'kolatier-vert-48' } });
  assert.equal(connexion.corps.utilisateur.emailConfirme, true);
  assert.equal(connexion.corps.utilisateur.profilComplet, false, 'la connexion l\'enverra sur /bienvenue');
  // Rejouer la migration ne confirme pas les comptes en attente (la colonne existe déjà : le bloc DO ne fait rien).
  await inscrire('fanta', 'dev');
  await migrer();
  assert.equal((await appel('/api/auth/moi', { qui: 'fanta' })).corps.utilisateur.emailConfirme, false);
  // validerCompte (l'aide des autres tests) rend bien un compte prêt.
  await validerCompte(adresse('fanta'));
  assert.equal((await appel('/api/auth/moi', { qui: 'fanta' })).corps.utilisateur.profilComplet, true);
});
