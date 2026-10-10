// Tests du profil prouvé : projets et vérification des liens, avis protégés, recherche de devs, balises de partage.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { creerApp } = require('../src/app');
const { migrer } = require('../src/db/migrate');
const { pool } = require('../src/db/pool');
const { avecComptesPrets } = require('./aide');
const { normaliserLien, verifierLien, adresseInterne } = require('../src/utils/liens');

let serveur;
let base;
let siteTest; // petit site local qui joue le rôle du « projet » visité par le serveur
let adresseSite;
const suffixe = Date.now();
// Le même suffixe écrit en lettres : un nom de famille n'accepte pas les chiffres.
const lettres = String(suffixe).replace(/\d/g, (chiffre) => 'abcdefghij'[chiffre]);
const membres = {}; // kadi, moussa (clients) ; awa, bintou, cheick, dao (devs)

async function appelBrut(chemin, { methode = 'GET', donnees, qui } = {}) {
  const headers = {};
  if (donnees) headers['Content-Type'] = 'application/json';
  if (qui) headers.Cookie = membres[qui].cookie;
  const r = await fetch(`${base}${chemin}`, { method: methode, headers, body: donnees ? JSON.stringify(donnees) : undefined, redirect: 'manual' });
  const texte = await r.text();
  let corps;
  try { corps = JSON.parse(texte); } catch { corps = texte; }
  return { statut: r.status, corps, entetes: r.headers };
}
// Les comptes créés par ces tests sont aussitôt « prêts » : email confirmé, profil de dev complet (voir tests/aide.js).
const appel = avecComptesPrets(appelBrut);
const poster = (qui, chemin, donnees = {}) => appel(chemin, { methode: 'POST', qui, donnees });

const JPEG_1PX = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
const PROJET = { titre: 'Gestion de pharmacie', description: 'Stock, ventes et alertes de péremption.', secteur: 'sante' };

test.before(async () => {
  await migrer();
  serveur = creerApp().listen(0);
  base = `http://localhost:${serveur.address().port}`;

  siteTest = http.createServer((req, res) => {
    if (req.url === '/ok') return res.writeHead(200).end('bonjour');
    if (req.url === '/redirige') return res.writeHead(302, { Location: '/ok' }).end();
    if (req.url === '/boucle') return res.writeHead(302, { Location: '/boucle' }).end();
    if (req.url === '/vers-interne') return res.writeHead(302, { Location: `http://127.0.0.1:${siteTest.address().port}/ok` }).end();
    res.writeHead(500).end();
  }).listen(0, '127.0.0.1');
  await new Promise((ok) => siteTest.once('listening', ok));
  adresseSite = `http://127.0.0.1:${siteTest.address().port}`;

  const comptes = { kadi: 'client', moussa: 'client', awa: 'dev', bintou: 'dev', cheick: 'dev', dao: 'dev' };
  for (const [prenom, type] of Object.entries(comptes)) {
    const email = `preuves-${prenom}-${suffixe}@palabre.test`;
    const r = await appel('/api/auth/inscription', {
      methode: 'POST',
      donnees: { type, prenom, nomFamille: `Preuves${lettres}`, email, motDePasse: 'motdepasse1', pays: 'Burkina Faso', ville: 'Ouagadougou', whatsapp: '+22670000000' },
    });
    assert.equal(r.statut, 201);
    membres[prenom] = { cookie: r.entetes.get('set-cookie').split(';')[0], identifiant: r.corps.utilisateur.identifiant, email };
  }
  for (const ami of ['bintou', 'cheick']) {
    await poster('awa', '/api/amis/demandes', { identifiant: membres[ami].identifiant });
    await poster(ami, `/api/amis/demandes/${membres.awa.identifiant}/accepter`);
  }
});

test.after(async () => {
  await pool.query('DELETE FROM utilisateurs WHERE email = ANY($1)', [Object.values(membres).map((m) => m.email)]);
  serveur.close();
  siteTest.close();
  await pool.end();
});

// ---------- Vérification des liens (protection contre les adresses internes) ----------

test('adresses internes reconnues, adresses publiques acceptées', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.10', '169.254.169.254',
    '100.64.0.1', '0.0.0.0', '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1', '::ffff:192.168.1.1', 'pas-une-ip']) {
    assert.equal(adresseInterne(ip), true, `${ip} doit être refusée`);
  }
  for (const ip of ['8.8.8.8', '41.203.64.1', '172.32.0.1', '196.28.245.1', '2606:4700:4700::1111']) {
    assert.equal(adresseInterne(ip), false, `${ip} est publique`);
  }
});

test('lien saisi : les adresses internes et les formes déguisées sont refusées', () => {
  const refuses = [
    'http://localhost:3000', 'http://localhost', 'https://127.0.0.1/admin', 'http://192.168.1.1', 'http://10.0.0.8/base',
    'http://169.254.169.254/latest/meta-data', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/',
    'http://2130706433/', 'http://0x7f.0.0.1/', 'http://0177.0.0.1/', 'http://127.1/',
    'http://serveur-interne/', 'http://imprimante.local/', 'http://api.internal/',
    'ftp://exemple.com/fichier', 'file:///etc/passwd', 'javascript:alert(1)',
    'https://admin:secret@exemple.com/', 'https://exemple.com:8080/', `https://exemple.com/${'a'.repeat(300)}`,
  ];
  for (const lien of refuses) {
    assert.throws(() => normaliserLien(lien), (err) => err.statut === 400 && err.champ === 'lien', `${lien} doit être refusé`);
  }
  assert.equal(normaliserLien(''), null);
  assert.equal(normaliserLien('  monprojet.com '), 'https://monprojet.com/', 'https:// est ajouté quand il manque');
  assert.equal(normaliserLien('http://Mon-Projet.BF/page?x=1'), 'http://mon-projet.bf/page?x=1');
});

test('vérification : un site qui répond est validé, même après une redirection', async () => {
  const local = { autoriserInternes: () => true };
  assert.equal(await verifierLien(`${adresseSite}/ok`, local), true);
  assert.equal(await verifierLien(`${adresseSite}/redirige`, local), true);
  assert.equal(await verifierLien(`${adresseSite}/erreur`, local), false, 'erreur 500');
  assert.equal(await verifierLien(`${adresseSite}/boucle`, local), false, 'trop de redirections');
  assert.equal(await verifierLien('http://127.0.0.1:1/', local), false, 'personne ne répond');
  assert.equal(await verifierLien('pas un lien', local), false);
});

test('vérification : le serveur ne visite jamais une adresse interne', async () => {
  // Sans l'option de test, le même site local est refusé alors qu'il répond très bien.
  assert.equal(await verifierLien(`${adresseSite}/ok`), false);
  assert.equal(await verifierLien('http://localhost/'), false);

  // Un nom d'apparence normale dont le DNS mène à une adresse interne.
  let visites = 0;
  const fauxDns = (adresses) => async () => { visites += 1; return adresses; };
  assert.equal(await verifierLien('http://site-piege.example/', { resoudre: fauxDns([{ address: '10.0.0.5', family: 4 }]) }), false);
  assert.equal(await verifierLien('http://site-piege.example/', { resoudre: fauxDns([{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }]) }), false, 'une seule adresse interne suffit à refuser');
  assert.equal(await verifierLien('http://site-piege.example/', { resoudre: fauxDns([{ address: '::1', family: 6 }]) }), false);
  assert.equal(visites, 3);

  // Un site autorisé qui redirige vers une adresse interne : la redirection est recontrôlée et refusée.
  const port = siteTest.address().port;
  const options = {
    autoriserInternes: (hote) => hote === 'depart.example',
    resoudre: async () => [{ address: '127.0.0.1', family: 4 }],
  };
  assert.equal(await verifierLien(`http://depart.example:${port}/redirige`, options), true, 'redirection vers le même site : acceptée');
  assert.equal(await verifierLien(`http://depart.example:${port}/vers-interne`, options), false, 'redirection vers 127.0.0.1 : refusée');
});

// ---------- Projets ----------

test('ajouter un projet : réservé aux devs, données et lien vérifiés', async () => {
  assert.equal((await appel('/api/projets', { methode: 'POST', donnees: PROJET })).statut, 401);
  assert.equal((await poster('kadi', '/api/projets', PROJET)).statut, 403, 'un client n\'a pas de projets');
  assert.equal((await poster('awa', '/api/projets', { ...PROJET, titre: 'ab' })).corps.champ, 'titre');
  assert.equal((await poster('awa', '/api/projets', { ...PROJET, secteur: 'espace' })).corps.champ, 'secteur');
  for (const lien of ['http://localhost:3000', 'http://192.168.1.1/admin', 'http://169.254.169.254/', 'http://[::1]/']) {
    const r = await poster('awa', '/api/projets', { ...PROJET, lien });
    assert.equal(r.statut, 400, lien);
    assert.equal(r.corps.champ, 'lien');
  }
  const fausseImage = `data:image/png;base64,${Buffer.from('pas une image').toString('base64')}`;
  assert.equal((await poster('awa', '/api/projets', { ...PROJET, image: fausseImage })).statut, 400);
});

test('projet : vitrine publique, badge « Lien vérifié », suppression', async () => {
  // Le domaine .invalid n'existe jamais : le projet est gardé, mais sans badge.
  const r = await poster('awa', '/api/projets', { ...PROJET, lien: 'projet-palabre-test.invalid', image: JPEG_1PX, publierFacebook: true });
  assert.equal(r.statut, 201);
  const projet = r.corps.projet;
  assert.equal(projet.lien, 'https://projet-palabre-test.invalid/');
  assert.equal(projet.lienVerifie, false, 'le lien ne répond pas : pas de badge');
  assert.equal(projet.nomSecteur, 'Santé');
  assert.match(projet.image, /^\/fichiers\//);
  assert.equal(projet.dev.identifiant, membres.awa.identifiant);

  // La vitrine et la page du projet sont visibles sans compte.
  const vitrine = await appel('/api/projets?secteur=sante');
  assert.equal(vitrine.statut, 200);
  assert.equal(vitrine.corps.projets[0].id, projet.id);
  assert.equal(vitrine.corps.projets[0].dev.email, undefined);
  assert.ok(!(await appel('/api/projets?secteur=agriculture')).corps.projets.some((p) => p.id === projet.id));
  assert.equal((await appel(`/api/projets/${projet.id}`)).corps.projet.titre, PROJET.titre);
  assert.equal((await appel('/api/projets/999999999')).statut, 404);

  // Quand la vérification réussit, le serveur note la date : le badge apparaît partout.
  await pool.query('UPDATE projets SET lien_verifie_le = now() WHERE id = $1', [projet.id]);
  const profil = (await appel(`/api/profils/${membres.awa.identifiant}`)).corps.profil;
  assert.equal(profil.projets.length, 1);
  assert.equal(profil.projets[0].lienVerifie, true);

  // Revérifier : réservé au propriétaire ; le lien ne répond toujours pas, le badge est retiré.
  assert.equal((await poster('bintou', `/api/projets/${projet.id}/verifier`)).statut, 403);
  assert.equal((await poster('awa', `/api/projets/${projet.id}/verifier`)).corps.projet.lienVerifie, false);

  assert.equal((await appel(`/api/projets/${projet.id}`, { methode: 'DELETE', qui: 'bintou', donnees: {} })).statut, 403);
  assert.equal((await appel(`/api/projets/${projet.id}`, { methode: 'DELETE', qui: 'awa', donnees: {} })).statut, 200);
  assert.equal((await fetch(`${base}${projet.image}`)).status, 404, 'l\'image part avec le projet');
});

// ---------- Avis protégés ----------

test('avis : seulement le client, pour un dev retenu, sur une demande terminée, une seule fois', async () => {
  const { corps: { demande } } = await poster('kadi', '/api/demandes', {
    titre: 'Application de livraison', description: 'Une application pour suivre les livraisons de mon commerce.', categorie: 'appli-mobile',
  });
  await poster('dao', `/api/demandes/${demande.id}/propositions`, { message: 'Je peux le faire seul en un mois.' });
  const equipe = await poster('awa', `/api/demandes/${demande.id}/equipes`, {
    message: 'Notre équipe livre en trois semaines.', roleChef: 'Chef de projet',
    membres: [{ identifiant: membres.bintou.identifiant, role: 'Design' }, { identifiant: membres.cheick.identifiant, role: 'Tests' }],
  });
  const equipeId = equipe.corps.propositions[0].equipe.id;
  await poster('bintou', `/api/equipes/${equipeId}/accepter`);
  await poster('cheick', `/api/equipes/${equipeId}/refuser`);
  const propositions = (await appel(`/api/demandes/${demande.id}`, { qui: 'kadi' })).corps.propositions;
  await poster('kadi', `/api/demandes/${demande.id}/choisir`, { propositionId: propositions.find((p) => p.equipe).id });

  const avis = (qui, identifiant, extra = {}) => poster(qui, '/api/avis', { demandeId: demande.id, identifiant, note: 5, commentaire: 'Travail sérieux.', ...extra });

  assert.equal((await avis('kadi', membres.awa.identifiant)).statut, 403, 'la demande n\'est pas encore terminée');
  await poster('kadi', `/api/demandes/${demande.id}/terminer`);

  assert.equal((await avis('kadi', membres.awa.identifiant, { note: 6 })).corps.champ, 'note');
  assert.equal((await avis('kadi', membres.awa.identifiant, { note: 0 })).statut, 400);
  assert.equal((await avis('moussa', membres.awa.identifiant)).statut, 403, 'un autre client');
  assert.equal((await avis('bintou', membres.awa.identifiant)).statut, 403, 'un dev ne note pas');
  assert.equal((await avis(undefined, membres.awa.identifiant)).statut, 401);
  assert.equal((await avis('kadi', membres.dao.identifiant)).statut, 403, 'Dao n\'a pas été retenu');
  assert.equal((await avis('kadi', membres.cheick.identifiant)).statut, 403, 'Cheick avait refusé l\'invitation');
  assert.equal((await avis('kadi', 'personne-inconnue')).statut, 403);

  assert.equal((await avis('kadi', membres.awa.identifiant, { note: 4 })).statut, 201);
  assert.equal((await avis('kadi', membres.awa.identifiant)).statut, 400, 'une seule fois');
  assert.equal((await avis('kadi', membres.bintou.identifiant, { commentaire: '' })).statut, 201, 'chaque membre de l\'équipe peut être noté');

  const profil = (await appel(`/api/profils/${membres.awa.identifiant}`)).corps.profil;
  assert.equal(profil.nbAvis, 1);
  assert.equal(profil.noteMoyenne, 4);
  assert.equal(profil.avis[0].commentaire, 'Travail sérieux.');
  assert.equal(profil.avis[0].client.identifiant, membres.kadi.identifiant);
  assert.equal(profil.avis[0].titreDemande, 'Application de livraison');
  assert.equal((await appel(`/api/profils/${membres.dao.identifiant}`)).corps.profil.nbAvis, 0);

  const detail = (await appel(`/api/demandes/${demande.id}`, { qui: 'kadi' })).corps;
  assert.deepEqual(detail.avisDonnes.sort(), [membres.awa.identifiant, membres.bintou.identifiant].sort());
  assert.equal((await appel('/api/notifications', { qui: 'awa' })).corps.notifications[0].type, 'avis_recu');
});

// ---------- Recherche de devs ----------

test('recherche de devs : compétence, pays, ville, disponibilité', async () => {
  const { corps: { competences } } = await appel('/api/competences');
  const flutter = competences.find((c) => c.nom === 'Flutter');
  const ville = `Banfora${suffixe}`;
  const modifier = (qui, extra) => appel('/api/profils/moi', {
    methode: 'PUT', qui,
    donnees: { prenom: qui, nomFamille: `Preuves${lettres}`, identifiant: membres[qui].identifiant, pays: 'Mali', ville, whatsapp: '+22670000000', bio: '', disponible: true, competences: [], ...extra },
  });
  assert.equal((await modifier('bintou', { competences: [flutter.id] })).statut, 200);
  assert.equal((await modifier('cheick', { disponible: false })).statut, 200);

  const chercher = async (parametres) => (await appel(`/api/devs?${new URLSearchParams(parametres)}`)).corps.devs.map((d) => d.identifiant);

  const parVille = await chercher({ ville: ville.toUpperCase().slice(0, 12) });
  assert.deepEqual(parVille.sort(), [membres.bintou.identifiant, membres.cheick.identifiant].sort(), 'ville : début du nom, sans tenir compte des majuscules');
  assert.deepEqual(await chercher({ ville, disponible: '1' }), [membres.bintou.identifiant]);
  assert.deepEqual(await chercher({ ville, competence: flutter.id }), [membres.bintou.identifiant]);
  assert.deepEqual(await chercher({ ville, pays: 'Sénégal' }), []);
  assert.equal((await chercher({ ville, pays: 'Mali' })).length, 2);
  assert.deepEqual((await chercher({ ville })), [membres.bintou.identifiant, membres.cheick.identifiant], 'les devs disponibles d\'abord');
  assert.deepEqual(await chercher({ ville: `%${suffixe}` }), [], 'le signe % est cherché tel quel, pas comme un joker');
  assert.ok(!(await chercher({ pays: 'Burkina Faso' })).includes(membres.kadi.identifiant), 'les clients ne sont pas dans les résultats');

  const fiche = (await appel(`/api/devs?ville=${ville}&disponible=1`)).corps.devs[0];
  assert.deepEqual(fiche.competences, ['Flutter']);
  assert.equal(fiche.whatsapp, undefined, 'pas de numéro dans la recherche');
  assert.equal(fiche.email, undefined);
});

// ---------- Balises de partage (Open Graph) ----------

test('partage : la page d\'un profil contient ses balises, sans exécuter le texte du membre', async () => {
  const nomPiege = 'Awa "><script>alert(1)</script>';
  // Première barrière : un prénom ou un nom n'accepte que des lettres, la validation refuse donc ce piège.
  const refus = await appel('/api/profils/moi', {
    methode: 'PUT', qui: 'awa',
    donnees: { prenom: nomPiege, nomFamille: 'Test', identifiant: membres.awa.identifiant, pays: 'Burkina Faso', ville: 'Koudougou' },
  });
  assert.equal(refus.statut, 400);
  assert.equal(refus.corps.champ, 'prenom');
  // Seconde barrière : même si un tel nom se trouvait déjà en base, la page ne l'exécuterait pas.
  // On l'y écrit directement pour le vérifier.
  await appel('/api/profils/moi', {
    methode: 'PUT', qui: 'awa',
    donnees: { prenom: 'Awa', nomFamille: 'Test', identifiant: membres.awa.identifiant, pays: 'Burkina Faso', ville: 'Koudougou', whatsapp: '', bio: 'Développeuse web & mobile.\nJ\'aime les projets utiles.', disponible: true, competences: [] },
  });
  await pool.query('UPDATE utilisateurs SET nom = $1 WHERE identifiant = $2', [nomPiege, membres.awa.identifiant]);
  const page = await appel(`/${membres.awa.identifiant}`);
  assert.equal(page.statut, 200);
  assert.match(page.corps, /data-profil/, 'c\'est toujours la page profil');
  assert.ok(!page.corps.includes('<script>alert(1)</script>'), 'le nom ne devient pas du code');
  assert.ok(page.corps.includes('<meta property="og:title" content="Awa &quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt; – Développeur à Koudougou, Burkina Faso | Palabre">'));
  assert.ok(page.corps.includes('<meta property="og:description" content="Développeuse web &amp; mobile. J&#39;aime les projets utiles.">'));
  assert.ok(page.corps.includes(`<meta property="og:url" content="http://localhost:3000/${membres.awa.identifiant}">`));
  assert.ok(page.corps.includes('<meta property="og:type" content="profile">'));
  // Sans photo de profil : l'image de partage par défaut, avec ses dimensions, en grande carte.
  assert.ok(page.corps.includes('<meta property="og:image" content="http://localhost:3000/img/palabre-partage-1200x630.png">'));
  assert.ok(page.corps.includes('<meta property="og:image:width" content="1200">'));
  assert.ok(page.corps.includes('<meta property="og:image:height" content="630">'));
  assert.ok(page.corps.includes('<meta name="twitter:card" content="summary_large_image">'));
  assert.equal((page.corps.match(/<title>/g) || []).length, 1);

  const inconnu = await appel('/personne-qui-n-existe-pas');
  assert.equal(inconnu.statut, 404);
  assert.match(inconnu.corps, /Profil introuvable/);
});

test('partage : accueil et page d\'un projet', async () => {
  const accueil = await appel('/');
  assert.equal(accueil.statut, 200);
  assert.ok(accueil.corps.includes('<meta property="og:url" content="http://localhost:3000/">'));
  assert.ok(accueil.corps.includes('og:image" content="http://localhost:3000/img/palabre-partage-1200x630.png"'));
  const image = await fetch(`${base}/img/palabre-partage-1200x630.png`);
  assert.equal(image.status, 200, 'l\'image de partage est bien servie');
  assert.equal(image.headers.get('content-type'), 'image/png');

  const { corps: { projet } } = await poster('bintou', '/api/projets', { ...PROJET, titre: 'Boutique $1 & Fils', secteur: 'commerce', image: JPEG_1PX });
  const page = await appel(`/projets/${projet.id}`);
  assert.equal(page.statut, 200);
  assert.ok(page.corps.includes('<meta property="og:title" content="Boutique $1 &amp; Fils – réalisé par'));
  assert.ok(page.corps.includes(`<meta property="og:image" content="http://localhost:3000${projet.image}">`));
  assert.ok(page.corps.includes('<meta name="twitter:card" content="summary_large_image">'));
  assert.ok(!page.corps.includes('og:image:width'), 'pas de dimensions annoncées pour la capture d\'un projet, dont la taille varie');
  assert.equal((await appel('/projets/999999999')).statut, 404);

  // Signaler un projet.
  const signalement = await poster('awa', '/api/signalements', { cibleType: 'projet', cible: projet.id, motif: 'Ce projet n\'est pas le sien' });
  assert.equal(signalement.statut, 201);
});
