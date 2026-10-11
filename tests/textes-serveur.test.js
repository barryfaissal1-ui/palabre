// Tests de la langue côté serveur : code stable des erreurs, réponses traduites, notifications, push, emails,
// balises de partage et pages servies dans la langue de la personne. En français, rien ne change.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { creerApp } = require('../src/app');
const { migrer } = require('../src/db/migrate');
const { pool } = require('../src/db/pool');
const textes = require('../src/utils/textes');
const push = require('../src/utils/push');
const { emailCode, emailMotDePasse } = require('../src/utils/gabarit-email');
const { chainesDuScript, ressembleAUnTexte } = require('./aide-langues');
const { avecComptesPrets, emailsEnvoyes, jetonAncien } = require('./aide');

let serveur;
let base;
const suffixe = Date.now();
const lettres = String(suffixe).replace(/\d/g, (chiffre) => 'abcdefghij'[chiffre]);
const membres = {};
const adresse = (cle) => `langue-${cle}-${suffixe}@palabre.test`;

// « langue » : le cookie posé par le site ; « navigateur » : l'en-tête Accept-Language.
async function appelBrut(chemin, { methode = 'GET', donnees, qui, langue, navigateur } = {}) {
  const headers = {};
  if (donnees) headers['Content-Type'] = 'application/json';
  const cookies = [qui ? membres[qui].cookie : null, langue ? `langue=${langue}` : null].filter(Boolean);
  if (cookies.length) headers.Cookie = cookies.join('; ');
  if (navigateur) headers['Accept-Language'] = navigateur;
  const r = await fetch(`${base}${chemin}`, { method: methode, headers, body: donnees ? JSON.stringify(donnees) : undefined });
  const texte = await r.text();
  let corps = {};
  try { corps = JSON.parse(texte); } catch { /* une page HTML */ }
  return { statut: r.status, corps, texte, entetes: r.headers };
}
const appel = avecComptesPrets(appelBrut);
const poster = (qui, chemin, donnees = {}, options = {}) => appel(chemin, { methode: 'POST', qui, donnees, ...options });

test.before(async () => {
  await migrer();
  serveur = creerApp().listen(0);
  base = `http://localhost:${serveur.address().port}`;
  for (const cle of ['awa', 'kofi']) {
    const r = await appel('/api/auth/inscription', { methode: 'POST', donnees: { type: 'dev', prenom: cle, nomFamille: `Langue${lettres}`, email: adresse(cle), motDePasse: 'motdepasse1', pays: cle === 'kofi' ? 'Ghana' : 'Burkina Faso', ville: cle === 'kofi' ? 'Accra' : 'Koudougou' } });
    assert.equal(r.statut, 201, JSON.stringify(r.corps));
    membres[cle] = { cookie: r.entetes.get('set-cookie').split(';')[0], identifiant: r.corps.utilisateur.identifiant, id: r.corps.utilisateur.id };
  }
});

test.after(async () => {
  await pool.query('DELETE FROM utilisateurs WHERE email LIKE $1', [`langue-%-${suffixe}@palabre.test`]);
  await new Promise((fini) => serveur.close(fini));
  await pool.end();
});

test('erreurs de l\'API : un code stable, le texte dans la langue (cookie, puis compte, puis navigateur)', async () => {
  const mauvais = { email: 'pas-un-email', motDePasse: 'x' };
  const enFrancais = await appelBrut('/api/auth/connexion', { methode: 'POST', donnees: mauvais });
  assert.deepEqual(enFrancais.corps, { erreur: 'Adresse email invalide.', champ: 'email', code: 'adresse-email-invalide' });
  const enAnglais = await appelBrut('/api/auth/connexion', { methode: 'POST', donnees: mauvais, langue: 'en' });
  assert.deepEqual(enAnglais.corps, { erreur: 'Invalid email address.', champ: 'email', code: 'adresse-email-invalide' });
  // Sans cookie : la première langue annoncée par le navigateur.
  assert.equal((await appelBrut('/api/auth/connexion', { methode: 'POST', donnees: mauvais, navigateur: 'en-GB,en;q=0.9,fr;q=0.8' })).corps.erreur, 'Invalid email address.');
  assert.equal((await appelBrut('/api/auth/connexion', { methode: 'POST', donnees: mauvais, navigateur: 'fr-FR,fr;q=0.9,en;q=0.8' })).corps.erreur, 'Adresse email invalide.');
  // Le cookie l'emporte sur le navigateur ; une langue inconnue retombe sur le français.
  assert.equal((await appelBrut('/api/auth/connexion', { methode: 'POST', donnees: mauvais, langue: 'fr', navigateur: 'en-US' })).corps.erreur, 'Adresse email invalide.');
  assert.equal((await appelBrut('/api/auth/connexion', { methode: 'POST', donnees: mauvais, langue: 'xx' })).corps.erreur, 'Adresse email invalide.');
  // Un message à trou garde sa valeur, et son code ne dépend pas d'elle.
  const court = await appelBrut('/api/auth/inscription', { methode: 'POST', langue: 'en', donnees: { type: 'dev', prenom: 'A', nomFamille: 'B', email: adresse('x'), motDePasse: 'motdepasse1', pays: 'Ghana', ville: 'A', jeton: jetonAncien() } });
  assert.deepEqual([court.corps.erreur, court.corps.code, court.corps.champ], ['At least 2 characters.', 'au-moins-caracteres', 'ville']);
  // Visiteur sans session, limites, routes inconnues : traduits aussi.
  assert.deepEqual((await appelBrut('/api/parametres', { langue: 'en' })).corps, { erreur: 'Log in to continue.', code: 'connecte-toi-pour-continuer' });
  assert.equal((await appelBrut('/api/cette-route-n-existe-pas', { langue: 'en' })).corps.erreur, 'Route not found.');
  // Le message d'une limite de fréquence est un objet partagé : la réponse anglaise ne doit pas le modifier.
  assert.equal((await appelBrut('/api/parametres')).corps.erreur, 'Connecte-toi pour continuer.');
});

test('langue du compte : enregistrée, reprise sans cookie, et listes du serveur traduites', async () => {
  assert.equal((await appel('/api/auth/moi', { qui: 'kofi' })).corps.utilisateur.langue, 'fr', 'inscrit sans cookie ni navigateur anglais');
  const r = await appel('/api/parametres/langue', { methode: 'PUT', qui: 'kofi', donnees: { langue: 'en' } });
  assert.deepEqual(r.corps, { langue: 'en' });
  assert.match(r.entetes.get('set-cookie'), /^langue=en;/);
  assert.equal((await appel('/api/parametres/langue', { methode: 'PUT', qui: 'kofi', donnees: { langue: 'de' } })).statut, 400);
  assert.equal((await appelBrut('/api/parametres/langue', { methode: 'PUT', donnees: { langue: 'en' } })).statut, 401);
  assert.equal((await appel('/api/auth/moi', { qui: 'kofi' })).corps.utilisateur.langue, 'en');
  assert.equal((await appel('/api/auth/moi', { qui: 'awa' })).corps.utilisateur.langue, 'fr');
  // Kofi, sans cookie « langue » (autre appareil) : ses réponses suivent son compte.
  const erreur = await appel('/api/profils/moi/son-messages', { methode: 'PUT', qui: 'kofi', donnees: { actif: 'oui' } });
  assert.deepEqual([erreur.corps.erreur, erreur.corps.code], ['Unreadable choice.', 'choix-illisible']);
  // Catégories et secteurs : l'identifiant ne change pas, le nom est traduit.
  const categories = (await appelBrut('/api/categories', { langue: 'en' })).corps.categories;
  assert.deepEqual(categories.find((c) => c.id === 'site-web'), { id: 'site-web', nom: 'Website' });
  assert.equal((await appelBrut('/api/categories')).corps.categories.find((c) => c.id === 'site-web').nom, 'Site web');
  assert.equal((await appelBrut('/api/secteurs', { langue: 'en' })).corps.secteurs.find((s) => s.id === 'sante').nom, 'Health');
  // Les pays restent en français dans l'API (c'est la valeur gardée en base) : la page les affiche traduits.
  assert.ok((await appelBrut('/api/pays', { langue: 'en' })).corps.pays.includes('Côte d\'Ivoire'));
  assert.ok((await appelBrut('/api/pays')).corps.pays.includes('Ghana'));
});

test('notifications et push : écrits dans la langue du destinataire, pas dans celle de celui qui agit', async () => {
  const envois = [];
  const [transport, actif] = [push.transport, push.pushActif];
  // Awa (français) publie ; Kofi (anglais) publie aussi. Chacun aime la publication de l'autre.
  const publier = async (qui) => (await poster(qui, '/api/publications', { type: 'idee', texte: `Publication de ${qui} ${suffixe}` })).corps.publication.id;
  const [deAwa, deKofi] = [await publier('awa'), await publier('kofi')];
  await poster('kofi', `/api/publications/${deAwa}/jaime`);
  await poster('awa', `/api/publications/${deKofi}/jaime`);
  await poster('awa', `/api/publications/${deKofi}/commentaires`, { texte: 'Bien vu.' });
  const cloche = async (qui) => (await appel('/api/notifications', { qui })).corps.notifications.map((n) => n.texte);
  assert.deepEqual(await cloche('awa'), [`kofi Langue${lettres} a aimé ta publication.`]);
  assert.deepEqual((await cloche('kofi')).sort(), [`awa Langue${lettres} commented on your post.`, `awa Langue${lettres} liked your post.`]);
  // Demande d'ami : la phrase de l'un, la phrase de l'autre.
  await poster('awa', '/api/amis/demandes', { identifiant: membres.kofi.identifiant });
  assert.ok((await cloche('kofi')).includes(`awa Langue${lettres} wants to add you as a friend.`));
  await poster('kofi', `/api/amis/demandes/${membres.awa.identifiant}/accepter`);
  assert.ok((await cloche('awa')).includes(`kofi Langue${lettres} a accepté ta demande d'ami.`));

  // Le texte d'un push : traduit pour Kofi, tel quel pour Awa. (Le chiffrement est testé dans tests/push.test.js.)
  assert.equal(textes.traduire('en', 'Nouveau message de Kofi'), 'New message from Kofi');
  assert.equal(textes.traduire('en', 'Nouveau message d\'Awa'), 'New message from Awa');
  assert.equal(textes.traduire('en', 'Bintou et 2 autres ont aimé ta publication'), 'Bintou and 2 others liked your post');
  assert.equal(textes.traduire('en', 'Bintou et 1 autre ont commenté ta publication.'), 'Bintou and 1 other commented on your post.');
  assert.equal(textes.traduire('en', 'Fatoumata t\'invite dans son équipe'), 'Fatoumata invites you to their team');
  assert.equal(textes.traduire('en', 'L\'équipe de Fatoumata Sawadogo a envoyé une proposition pour « Site de la mairie ».'), 'Fatoumata Sawadogo\'s team sent a proposal for “Site de la mairie”.');
  assert.equal(textes.traduire('en', 'Awa t\'a envoyé 3 messages.'), 'Awa sent you 3 messages.');
  assert.equal(textes.traduire('en', 'Code incorrect. Il te reste 1 essai.'), 'Incorrect code. You have 1 attempt left.');
  assert.equal(textes.traduire('en', 'Code incorrect. Il te reste 3 essais.'), 'Incorrect code. You have 3 attempts left.');
  // Ce qu'un membre a écrit n'est jamais traduit, même si cela ressemble à une phrase du site.
  assert.equal(textes.traduire('en', 'Bonjour, voici mon devis.'), 'Bonjour, voici mon devis.');
  assert.equal(textes.traduire('fr', 'Adresse email invalide.'), 'Adresse email invalide.');
  assert.equal(textes.codeDe('Une phrase que le dictionnaire ne connaît pas.'), 'message');
  [push.transport, push.pushActif] = [transport, actif];
  assert.equal(envois.length, 0);
});

test('emails : dans la langue du destinataire ; en français, mot pour mot comme avant', () => {
  const fr = emailCode({ prenom: 'Awa', code: '123456', dureeMin: 15 });
  assert.equal(fr.sujet, 'Palabre – Ton code de confirmation : 123456');
  assert.equal(fr.texte, 'Bonjour Awa,\n\nTon code de confirmation Palabre : 123456\n\nIl est valable 15 minutes. Si tu n\'as pas créé de compte, ignore simplement cet email.\n\nL\'équipe Palabre, fait au Burkina Faso');
  assert.match(fr.html, /<html lang="fr">/);
  const en = emailCode({ prenom: 'Kofi', code: '123456', dureeMin: 15, langue: 'en' });
  assert.equal(en.sujet, 'Palabre – Your confirmation code: 123456');
  assert.equal(en.texte, 'Hello Kofi,\n\nYour Palabre confirmation code: 123456\n\nIt is valid for 15 minutes. If you didn\'t create an account, simply ignore this email.\n\nThe Palabre team, made in Burkina Faso');
  assert.match(en.html, /<html lang="en">/);
  assert.match(en.html, /Hello Kofi,/);
  assert.match(en.html, /Confirm your email/);
  assert.doesNotMatch(en.html, /Bonjour|Ton code|L'équipe|valable/);
  // Un prénom piégé reste du texte, dans les deux langues.
  assert.ok(!emailCode({ prenom: '<img src=x onerror=alert(1)>', code: '123456', dureeMin: 15, langue: 'en' }).html.includes('<img src=x'));
  const oubli = emailMotDePasse({ prenom: 'Kofi', lien: 'https://palabre.dev/reinitialiser?jeton=abc', dureeMin: 60, langue: 'en' });
  assert.equal(oubli.sujet, 'Palabre – Reset your password');
  assert.match(oubli.texte, /^Hello Kofi,\n\nTo choose a new password, open this link \(valid for 60 minutes\):\nhttps:\/\/palabre\.dev\/reinitialiser\?jeton=abc\n/);
  assert.match(oubli.html, /Choose a new password/);
  assert.equal(emailMotDePasse({ prenom: 'Awa', lien: 'https://x', dureeMin: 60 }).sujet, 'Palabre – Réinitialise ton mot de passe');
});

test('inscription en anglais : le compte garde la langue et le code part en anglais', async () => {
  const email = adresse('esi');
  const r = await appelBrut('/api/auth/inscription', { methode: 'POST', langue: 'en', donnees: { type: 'client', prenom: 'Esi', nomFamille: `Langue${lettres}`, email, motDePasse: 'motdepasse1', pays: 'Ghana', ville: 'Kumasi', jeton: jetonAncien() } });
  assert.equal(r.statut, 201, JSON.stringify(r.corps));
  assert.equal(r.corps.utilisateur.langue, 'en');
  const message = emailsEnvoyes.filter((m) => m.a === email).pop();
  assert.match(message.sujet, /^Palabre – Your confirmation code: \d{6}$/);
  assert.match(message.texte, /^Hello Esi,/);
  // Awa, inscrite en français, a reçu le sien en français.
  assert.match(emailsEnvoyes.filter((m) => m.a === adresse('awa')).pop().sujet, /^Palabre – Ton code de confirmation : \d{6}$/);
});

test('pages : servies dans la langue du visiteur, balises de partage comprises ; en français, inchangées', async () => {
  const [fr, en] = [await appelBrut('/'), await appelBrut('/', { langue: 'en' })];
  assert.match(fr.texte, /<html lang="fr">/);
  assert.match(fr.texte, /<title>Palabre – le réseau des développeurs africains<\/title>/);
  assert.match(fr.texte, /og:locale" content="fr_FR"/);
  assert.match(fr.texte, />L'arbre à palabres des développeurs africains\.</);
  assert.match(en.texte, /<html lang="en">/);
  assert.match(en.texte, /<title>Palabre – the network for African developers<\/title>/);
  assert.match(en.texte, /og:locale" content="en_GB"/);
  assert.match(en.texte, /og:description" content="Palabre brings African developers together/);
  assert.match(en.texte, />The palaver tree for African developers\.</);
  assert.doesNotMatch(en.texte, />Je suis développeur<|>Comment ça marche</);
  // Les scripts de langues sont dans chaque page, avec leur empreinte (cache d'un an).
  assert.match(fr.texte, /<script src="\/langues\/fr\.js\?v=[0-9a-f]{10}" defer><\/script>\s*<script src="\/langues\/en\.js\?v=[0-9a-f]{10}" defer><\/script>\s*<script src="\/js\/app\.js/);
  const fichier = await fetch(`${base}${/\/langues\/en\.js\?v=[0-9a-f]{10}/.exec(fr.texte)[0]}`);
  assert.match(fichier.headers.get('cache-control'), /max-age=31536000, immutable/);

  // Une page simple (/chercher), la connexion et l'inscription, une page d'erreur.
  const chercher = await appelBrut('/chercher', { langue: 'en' });
  assert.match(chercher.texte, /<title>Find a developer – Palabre<\/title>/);
  assert.match(chercher.texte, /placeholder="E\.g\. Accra"/);
  assert.match(chercher.texte, />All countries</);
  assert.match((await appelBrut('/chercher')).texte, /placeholder="Ex\. Ouagadougou"/);
  assert.match((await appelBrut('/connexion', { langue: 'en' })).texte, /<title>Log in – Palabre<\/title>/);
  const inscription = await appelBrut('/inscription?type=client', { langue: 'en' });
  assert.match(inscription.texte, /<title>Create an account – Palabre<\/title>/);
  assert.match(inscription.texte, />Your project deserves the right devs\.</, 'le panneau « client », en anglais dès l\'arrivée');
  const introuvable = await appelBrut('/une/page/qui/n-existe-pas', { langue: 'en' });
  assert.equal(introuvable.statut, 404);
  assert.match(introuvable.texte, /<title>Page not found – Palabre<\/title>/);
  assert.match(introuvable.texte, />This page doesn't exist</);
  assert.match((await appelBrut('/une/page/qui/n-existe-pas')).texte, />Cette page n'existe pas</);

  // Profil : le métier et le pays dans la langue du visiteur ; le nom et la ville tels qu'ils sont.
  const profil = await appelBrut(`/${membres.kofi.identifiant}`, { navigateur: 'en-GB' });
  assert.match(profil.texte, new RegExp(`<title>kofi Langue${lettres} – Developer in Accra, Ghana \\| Palabre</title>`));
  assert.match((await appelBrut(`/${membres.awa.identifiant}`)).texte, new RegExp(`<title>awa Langue${lettres} – Développeur à Koudougou, Burkina Faso \\| Palabre</title>`));
  // Un texte de membre placé dans une page reste échappé, quelle que soit la langue.
  assert.doesNotMatch(en.texte, /<script(?![^>]*src=)/);
});

test('aucune phrase du serveur n\'est oubliée : chacune a sa traduction (clé « serveur.… »)', () => {
  // Ce qui n'a pas à être traduit, et pourquoi.
  const HORS_SUJET = [
    /^(SELECT|INSERT|UPDATE|DELETE|WITH|LEFT JOIN|JOIN|ORDER BY|WHERE)\b/, // du SQL
    /^\s*</,                                                               // du HTML (gabarit des emails)
  ];
  const FICHIERS_EXEMPTES = {
    // Textes gardés en base tels qu'ils ont été écrits (messages « système » d'un groupe, titre d'un groupe) :
    // comme tout contenu d'une conversation, ils restent dans la langue où ils ont été écrits.
    'utils/groupes.js': /./,
    'routes/equipes.js': /a rejoint l'équipe\.$/,
    'routes/groupes.js': /a renommé le groupe|a quitté|^l'équipe$|^le groupe$|^\{\} : \{\}$/,
    'routes/demandes.js': /qui a publié la demande|^ta proposition$|^la proposition de ton équipe$|a choisi \{\} pour/,
    // Le texte proposé pour la page Facebook « Palabre Dev », écrite en français.
    'routes/admin.js': /un projet réalisé par|^Secteur : |^À découvrir sur Palabre/,
    // Noms des listes : la base garde l'identifiant ; les libellés sont sous « pays.… », « specialite.… »,
    // « experience.… » (vérifié dans tests/langues.test.js), ou traduits à la sortie (catégories, secteurs).
    'utils/validation.js': /./,
    'utils/profil-dev.js': /^(Développement web|Mobile|Back-end|Front-end|Design UI\/UX|Data et IA|DevOps et cloud|Jeux vidéo|Autre|Moins d'1 an|1 à 2 ans|3 à 5 ans|Plus de 5 ans|GitHub|GitLab|Portfolio|LinkedIn)$/,
    // Les emails et les balises de partage sont écrits avec t(langue, 'cle') : pas de phrase à retrouver.
    'utils/gabarit-email.js': /./,
    'routes/pages.js': /./,
    'utils/statique.js': /./,
    // Compte « Membre parti » et nom du fichier d'export : des données, pas des messages.
    'routes/parametres.js': /^(Membre parti|Membre|parti|Autre|Mes données|—)$/,
    'routes/auth.js': /^(Navigateur|sur \{\})$/,
    'config.js': /./,
    // Morceaux de phrases assemblés par avecLesAutres() : la phrase entière, elle, est reconnue (testé plus haut).
    'utils/notifications.js': /^(a|ont) (aimé|commenté|répondu)|^\{\} et \{\} autre|^Un membre$|^un membre$/,
    'routes/publications.js': /^(a|ont) (aimé|commenté|répondu)/,
    'routes/devs.js': /^\{\} compétence\{\} en commun$/,
    'utils/inscription.js': /^Code incorrect\. Il te reste \{\} essai\{\}\.$/,
  };
  const racine = path.join(__dirname, '..', 'src');
  const fichiers = [];
  (function lister(dossier) {
    for (const nom of fs.readdirSync(dossier)) {
      const chemin = path.join(dossier, nom);
      if (fs.statSync(chemin).isDirectory()) lister(chemin);
      else if (chemin.endsWith('.js')) fichiers.push(chemin);
    }
  })(racine);
  const oubliees = [];
  let reconnues = 0;
  for (const fichier of fichiers) {
    const relatif = path.relative(racine, fichier).replace(/\\/g, '/');
    const source = fs.readFileSync(fichier, 'utf8');
    const lignes = source.split(/\r?\n/);
    for (const chaine of chainesDuScript(source)) {
      const texte = chaine.texte;
      if (!ressembleAUnTexte(texte.replace(/\{\}/g, ' '), texte) || HORS_SUJET.some((motif) => motif.test(texte))) continue;
      const ligne = lignes[chaine.ligne - 1] || '';
      if (/console\.(error|log|warn)\(|throw new Error\(|new Error\(/.test(ligne) && !/Erreur(Validation|Http)/.test(ligne)) continue; // journal du serveur
      if (/\b(SELECT|INSERT INTO|UPDATE|DELETE FROM|FROM|WHERE)\b/.test(texte)) continue;                                          // SQL sur plusieurs lignes
      if (FICHIERS_EXEMPTES[relatif] && FICHIERS_EXEMPTES[relatif].test(texte)) continue;
      // Une phrase à trous (${…}) : on la rejoue avec une valeur d'essai à la place de chaque trou.
      if (textes.reconnaitre(texte.replace(/\{\}/g, '7'))) reconnues += 1;
      else oubliees.push(`${relatif}:${chaine.ligne}  ${texte.slice(0, 110)}`);
    }
  }
  assert.deepEqual(oubliees, [], 'ajoute ces phrases à public/langues/fr.js et en.js, sous une clé « serveur.… »');
  assert.ok(reconnues > 200, `seulement ${reconnues} phrases reconnues`);
});
