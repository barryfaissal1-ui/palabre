// Tests du filtre automatique (src/utils/moderation.js) : insultes refusées avec leurs variantes, mots innocents
// acceptés, arnaques mises en attente puis approuvées par un administrateur, liens dangereux refusés, et le filtre
// allégé des messages privés.
const test = require('node:test');
const assert = require('node:assert/strict');
const { creerApp } = require('../src/app');
const { migrer } = require('../src/db/migrate');
const { pool } = require('../src/db/pool');
const { analyser, liensDe, imiteUneMarque, MESSAGES } = require('../src/utils/moderation');
const listes = require('../src/utils/moderation-listes');
const { avecComptesPrets } = require('./aide');

let serveur;
let base;
const suffixe = Date.now();
const lettres = String(suffixe).replace(/\d/g, (chiffre) => 'abcdefghij'[chiffre]);
const adresse = (cle) => `filtre-${cle}-${suffixe}@palabre.test`;
const membres = {};
const verdict = (texte, langue = 'fr', options) => analyser(texte, langue, options).resultat;
const raison = (texte, langue = 'fr', options) => analyser(texte, langue, options).raison;

async function appelBrut(chemin, { methode = 'GET', donnees, qui, langue } = {}) {
  const headers = {};
  if (donnees) headers['Content-Type'] = 'application/json';
  const cookies = [qui ? membres[qui].cookie : null, langue ? `langue=${langue}` : null].filter(Boolean);
  if (cookies.length) headers.Cookie = cookies.join('; ');
  const r = await fetch(`${base}${chemin}`, { method: methode, headers, body: donnees ? JSON.stringify(donnees) : undefined });
  const texte = await r.text();
  let corps = {};
  try { corps = JSON.parse(texte); } catch { /* une page HTML */ }
  return { statut: r.status, corps, texte, entetes: r.headers };
}
const appel = avecComptesPrets(appelBrut);
const poster = (qui, chemin, donnees = {}) => appel(chemin, { methode: 'POST', qui, donnees });
const publier = (qui, texte) => poster(qui, '/api/publications', { type: 'idee', texte });
const ARNAQUE = 'Gains garantis : envoie 5 000 FCFA d\'abord pour débloquer ton compte, et double ton argent en 24 h.';
const DEMANDE = { titre: 'Site pour une coopérative de karité', description: 'Présenter les produits, prendre les commandes et suivre les livraisons.', budgetFcfa: 400000, delai: '1 mois', categorie: 'site-web' };

test.before(async () => {
  await migrer();
  serveur = creerApp().listen(0);
  base = `http://localhost:${serveur.address().port}`;
  for (const [cle, type] of [['awa', 'dev'], ['bintou', 'dev'], ['chef', 'dev'], ['kadi', 'client']]) {
    const r = await appel('/api/auth/inscription', { methode: 'POST', donnees: { type, prenom: cle, nomFamille: `Filtre${lettres}`, email: adresse(cle), motDePasse: 'kolatier-vert-48', pays: 'Burkina Faso', ville: 'Koudougou', ...(type === 'client' ? { whatsapp: '+22670000009' } : {}) } });
    assert.equal(r.statut, 201, JSON.stringify(r.corps));
    membres[cle] = { cookie: r.entetes.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('palabre_session=')), identifiant: r.corps.utilisateur.identifiant, id: r.corps.utilisateur.id };
  }
  // Des comptes de plus de trois jours : les limites des nouveaux comptes sont testées dans tests/nouveaux-comptes.test.js.
  await pool.query('UPDATE utilisateurs SET est_admin = (id = $2), cree_le = now() - interval \'10 days\' WHERE id = ANY($1::int[])', [Object.values(membres).map((m) => m.id), membres.chef.id]);
  await poster('awa', '/api/amis/demandes', { identifiant: membres.bintou.identifiant });
  await poster('bintou', `/api/amis/demandes/${membres.awa.identifiant}/accepter`);
});

test.after(async () => {
  await pool.query('DELETE FROM domaines_interdits WHERE domaine LIKE $1', [`%${suffixe}%`]);
  await pool.query('DELETE FROM utilisateurs WHERE email LIKE $1', [`filtre-%-${suffixe}@palabre.test`]);
  await new Promise((fini) => serveur.close(fini));
  await pool.end();
});

test('insultes : refusées, avec leurs variantes (accents, majuscules, lettres répétées, chiffres, lettres espacées)', () => {
  for (const texte of ['Espèce de connard', 'CONNARD', 'c0nnard', 'C0NN4RD', 'connnnnnard', 'c o n n a r d', 'c.o.n.n.a.r.d', 'Connârd !', 's@lope', 'saloooope', 'ENCULÉ', 'sh1t happens', 'f u c k this', 'fuuuuck',
    'T\'es con ou quoi', 'fils de pute', 'Ferme ta gueule', 'je vais te tuer', 'I will kill you', 'va te faire foutre']) {
    assert.equal(raison(texte), 'insulte', texte);
  }
  for (const texte of ['sale noir', 'Sale Arabe', 'n1gger', 'retourne dans ton pays', 'sale pd']) assert.equal(raison(texte), 'haine', texte);
  for (const texte of ['video porno ici', 'envoie des nudes', 'p0rn', 'send nudes', 'plan cul ce soir']) assert.equal(raison(texte), 'sexuel', texte);
  // Le message est clair et poli, et ne répète jamais le mot.
  const refus = analyser('Quel connard celui-là');
  assert.equal(refus.message, MESSAGES.insulte);
  for (const message of Object.values(MESSAGES)) for (const mot of [...listes.INSULTES, ...listes.HAINE]) assert.ok(!message.toLowerCase().split(/[^a-zéèàù]+/).includes(mot), `${mot} dans « ${message} »`);
});

test('mots innocents : acceptés, même quand ils contiennent les lettres d\'un mot refusé', () => {
  const innocents = [
    'La connexion au concours a du retard.', 'Notre nouvelle trainee commence lundi.', 'Je scrute les disputes sur ce compte.', 'Le Niger et le fleuve Niger.',
    'Une file d\'attente : queue, pipe et kill process.', 'dumb terminal et stupid bug', 'Le Togo (TG) et la Mongolie.', 'La pédale de frein et la tapette à mouches.',
    'Un assistant pour la classe d\'analyse.', 'Les économies du consulat de Constantine.', 'Elle a mis un baiser sur le sexe du formulaire : M ou F.', 'Les couleurs noire et blanche de la salle noire.',
    'Bite the bullet, it is a 8-bit cock-pit simulator.', 'Je vais te retrouver à la gare demain ?', 'Tu vas le payer combien, ce site ?', 'Une espèce de tableau de bord.', 'Ferme la porte.',
    'kolatier-vert-48', '127.0.0.1 et 192.168.1.10', 'version 1.2.3.4 du module', 'xxx à remplacer par ton nom',
  ];
  for (const texte of innocents) assert.equal(verdict(texte), 'accepte', texte);
  // « cons » : une insulte en français, un mot ordinaire en anglais.
  assert.equal(verdict('pros and cons of React'), 'accepte');
  assert.equal(verdict('Here are the cons', 'en'), 'accepte');
  assert.equal(verdict('Ils sont cons', 'fr'), 'refuse');
  assert.equal(verdict(''), 'accepte');
  assert.equal(verdict(null), 'accepte');
});

test('arnaques : mises en attente (pas refusées), sans toucher au vocabulaire du métier', () => {
  for (const texte of [ARNAQUE, 'Paie 5000 FCFA d\'abord pour débloquer ton gain', 'Gains garantis, sans risque', 'Double ton argent en 24h', 'Envoie-moi le code reçu par SMS', 'Donne-moi ton mot de passe',
    'Recrutement : frais de dossier de 10 000 F', 'Frais d\'inscription à payer avant l\'entretien', 'Bitcoin : rendement garanti x2', 'Investis 10 000 et reçois 50 000', 'Gagne 50 000 FCFA par jour depuis ton téléphone',
    'Earn $500 per day from your phone', 'Double your money in 24h', 'Pay the registration fee upfront', 'Send me your verification code', 'Guaranteed returns, risk free']) {
    assert.deepEqual([verdict(texte), raison(texte)], ['en_attente', 'arnaque'], texte);
  }
  for (const texte of ['Envoie ton code sur GitHub, je regarde.', 'Partage ton code source.', 'Je demande un acompte de 30 % au début du projet.', 'Envoie-moi le cahier des charges avant de commencer.',
    'Gagner du temps rapidement avec un bon outil.', 'Le paiement se fait à la livraison.', 'Je cherche un stage en développement mobile.', 'Share your code and I will review it.', 'We pay on delivery.']) {
    assert.equal(verdict(texte), 'accepte', texte);
  }
});

test('liens : raccourcisseurs, adresses IP et imitations refusés ; vrais sites, emails et noms techniques acceptés', () => {
  for (const [texte, attendue] of [['voir https://bit.ly/3xYz', 'lien-raccourci'], ['tinyurl.com/abc', 'lien-raccourci'], ['www.t.co/x', 'lien-raccourci'], ['http://41.203.12.9/login', 'lien-ip'], ['41.203.12.9:8080', 'lien-ip'],
    ['0range-money.com', 'lien-imitation'], ['https://ecobannk.net/login', 'lien-imitation'], ['wave-bonus.xyz', 'lien-imitation'], ['orangemoney-gratuit.com', 'lien-imitation'], ['paypa1.com', 'lien-imitation'], ['ecobank-verification.co', 'lien-imitation'], ['m00v.net', 'lien-imitation']]) {
    assert.deepEqual([verdict(texte), raison(texte)], ['refuse', attendue], texte);
  }
  for (const texte of ['github.com/awa/projet', 'https://www.orange.bf/offres', 'www.ecobank.com', 'wave.com', 'the-orange-tree.com', 'mon-site.bf', 'awa@gmail.com', 'socket.io et node.js', 'index.html, style.css, app.js', 'http://127.0.0.1:3000', 'http://localhost:3000', 'range.com']) {
    assert.equal(verdict(texte), 'accepte', texte);
  }
  assert.deepEqual(liensDe('va sur github.com/awa et https://Mon-Site.bf, pas node.js ni awa@gmail.com').map((l) => l.hote), ['github.com', 'mon-site.bf']);
  assert.equal(imiteUneMarque('orange.bf'), false);
  assert.equal(imiteUneMarque('orannge.bf'), true);
  // Un domaine interdit par les administrateurs, et ses sous-domaines.
  const domaines = new Set(['arnaque-exemple.com']);
  assert.equal(raison('va voir arnaque-exemple.com', 'fr', { domaines }), 'lien-interdit');
  assert.equal(raison('https://promo.arnaque-exemple.com/x', 'fr', { domaines }), 'lien-interdit');
  assert.equal(verdict('pas-arnaque-exemple.com', 'fr', { domaines }), 'accepte');
});

test('publication : insulte refusée sans rien enregistrer, le message est traduit et ne répète pas le mot', async () => {
  const { rows: [{ nb: avant }] } = await pool.query('SELECT count(*)::int AS nb FROM publications WHERE auteur_id = $1', [membres.awa.id]);
  const refus = await publier('awa', 'Ce client est un vrai c0nnard.');
  assert.deepEqual([refus.statut, refus.corps.champ, refus.corps.code], [400, 'texte', 'texte-insultant']);
  assert.ok(!/connard|c0nnard/i.test(refus.corps.erreur));
  assert.equal((await publier('awa', 'Va sur bit.ly/3xYz pour gagner')).corps.code, 'lien-raccourci');
  assert.equal((await publier('awa', 'Mon site : 0range-money.com')).corps.code, 'lien-imitation');
  const { rows: [{ nb: apres }] } = await pool.query('SELECT count(*)::int AS nb FROM publications WHERE auteur_id = $1', [membres.awa.id]);
  assert.equal(apres, avant, 'rien n\'est enregistré');
  const enAnglais = await appel('/api/publications', { methode: 'POST', qui: 'awa', langue: 'en', donnees: { type: 'idee', texte: 'What an asshole.' } });
  assert.match(enAnglais.corps.erreur, /insulting word/);
  assert.equal((await publier('awa', 'La connexion au concours a du retard.')).statut, 201);
});

test('le filtre s\'applique partout : commentaire, modification, demande, proposition, projet, bio, défi, groupe, avis', async () => {
  const publication = (await publier('awa', 'Une publication tout à fait correcte.')).corps.publication;
  const refuse = async (reponse, champ, nom) => assert.deepEqual([reponse.statut, reponse.corps.champ, reponse.corps.code], [400, champ, 'texte-insultant'], nom);
  await refuse(await poster('bintou', `/api/publications/${publication.id}/commentaires`, { texte: 'Quel connard.' }), 'texte', 'commentaire');
  await refuse(await appel(`/api/publications/${publication.id}`, { methode: 'PUT', qui: 'awa', donnees: { texte: 'Corrigée en connard.' } }), 'texte', 'publication modifiée');
  const commentaire = (await poster('bintou', `/api/publications/${publication.id}/commentaires`, { texte: 'Bonne idée.' })).corps.commentaire;
  await refuse(await appel(`/api/publications/${publication.id}/commentaires/${commentaire.id}`, { methode: 'PUT', qui: 'bintou', donnees: { texte: 'Sale con.' } }), 'texte', 'commentaire modifié');
  await refuse(await poster('kadi', '/api/demandes', { ...DEMANDE, titre: 'Cherche un connard de dev' }), 'titre', 'titre de demande');
  await refuse(await poster('kadi', '/api/demandes', { ...DEMANDE, description: 'Les devs sont tous des enfoirés, prouvez-moi le contraire.' }), 'description', 'description de demande');
  const demande = (await poster('kadi', '/api/demandes', DEMANDE)).corps.demande;
  await refuse(await poster('awa', `/api/demandes/${demande.id}/propositions`, { message: 'Je le fais, espèce de salope.', montantFcfa: 100000 }), 'message', 'proposition');
  await refuse(await poster('awa', '/api/projets', { titre: 'Un projet de merdeux', secteur: 'commerce' }), 'titre', 'projet');
  const profil = (await appel('/api/auth/moi', { qui: 'awa' })).corps.utilisateur;
  await refuse(await appel('/api/profils/moi', { methode: 'PUT', qui: 'awa', donnees: { prenom: profil.prenom, nomFamille: profil.nomFamille, identifiant: profil.identifiant, pays: 'Burkina Faso', ville: 'Koudougou', bio: 'Je déteste ces connards de clients.' } }), 'bio', 'bio');
  // Un texte qu'on ne sait pas mettre en attente : une phrase d'arnaque y est refusée.
  const bio = await appel('/api/profils/moi', { methode: 'PUT', qui: 'awa', donnees: { prenom: profil.prenom, nomFamille: profil.nomFamille, identifiant: profil.identifiant, pays: 'Burkina Faso', ville: 'Koudougou', bio: 'Gains garantis : double ton argent avec moi.' } });
  assert.deepEqual([bio.statut, bio.corps.champ, bio.corps.code], [400, 'bio', 'texte-arnaque']);
});

test('arnaque : enregistrée mais cachée, l\'auteur est prévenu, un administrateur approuve et elle devient visible', async () => {
  const mise = await publier('awa', ARNAQUE);
  assert.deepEqual([mise.statut, mise.corps], [202, { enAttente: true, message: 'Ta publication sera visible après vérification par l\'équipe.' }]);
  const { rows: [ligne] } = await pool.query('SELECT id, masque FROM publications WHERE auteur_id = $1 AND texte = $2', [membres.awa.id, ARNAQUE]);
  assert.equal(ligne.masque, true);
  // Personne ne la voit : ni dans le fil, ni par son adresse, ni sur la page publique.
  assert.equal((await appel(`/api/publications/${ligne.id}`, { qui: 'bintou' })).statut, 404);
  assert.equal((await appelBrut(`/publication/${ligne.id}`)).statut, 404);
  assert.ok(!(await appel(`/api/publications?auteur=${membres.awa.identifiant}`, { qui: 'bintou' })).texte.includes('Gains garantis'));

  // La file de l'administrateur ; un membre ordinaire n'y a pas accès.
  assert.equal((await appel('/api/admin/moderation/attente', { qui: 'bintou' })).statut, 403);
  const file = (await appel('/api/admin/moderation/attente', { qui: 'chef' })).corps.attente;
  const { rows: [attente] } = await pool.query('SELECT id FROM moderation_attente WHERE cible_type = \'publication\' AND cible_id = $1', [ligne.id]);
  const carte = file.find((a) => a.id === attente.id);
  assert.deepEqual([carte.cibleType, carte.raison, carte.texte, carte.auteur.identifiant], ['publication', 'arnaque', ARNAQUE, membres.awa.identifiant]);
  assert.equal((await poster('bintou', `/api/admin/moderation/attente/${attente.id}`, { decision: 'approuver' })).statut, 403);
  assert.equal((await poster('chef', `/api/admin/moderation/attente/${attente.id}`, { decision: 'peut-etre' })).statut, 400);

  assert.equal((await poster('chef', `/api/admin/moderation/attente/${attente.id}`, { decision: 'approuver' })).statut, 200);
  assert.equal((await appel(`/api/publications/${ligne.id}`, { qui: 'bintou' })).statut, 200);
  assert.equal((await poster('chef', `/api/admin/moderation/attente/${attente.id}`, { decision: 'approuver' })).statut, 404, 'déjà traité');
  const { rows: [notification] } = await pool.query('SELECT type, texte, lien FROM notifications WHERE utilisateur_id = $1 AND type = \'contenu_approuve\' ORDER BY id DESC LIMIT 1', [membres.awa.id]);
  assert.deepEqual({ ...notification }, { type: 'contenu_approuve', texte: 'Ta publication a été vérifiée : elle est maintenant visible.', lien: `/publication/${ligne.id}` });
});

test('arnaque retirée : elle reste cachée et l\'auteur est prévenu ; commentaire et demande passent aussi par la file', async () => {
  const publication = (await publier('awa', 'Une publication pour recevoir des commentaires.')).corps.publication;
  const commentaire = await poster('bintou', `/api/publications/${publication.id}/commentaires`, { texte: 'Double ton argent en 24h, écris-moi.' });
  assert.deepEqual([commentaire.statut, commentaire.corps.enAttente], [202, true]);
  assert.deepEqual((await appel(`/api/publications/${publication.id}/commentaires`, { qui: 'awa' })).corps.commentaires, []);
  // Awa n'est pas prévenue d'un commentaire que personne ne voit encore.
  const { rows: prevenue } = await pool.query('SELECT 1 FROM notifications WHERE utilisateur_id = $1 AND type = \'commentaire\' AND cible_id = $2', [membres.awa.id, publication.id]);
  assert.equal(prevenue.length, 0);
  const demande = await poster('kadi', '/api/demandes', { ...DEMANDE, description: 'Recrutement de développeurs : frais de dossier de 10 000 F à payer avant l\'entretien.' });
  assert.deepEqual([demande.statut, demande.corps.message], [202, 'Ta demande sera visible après vérification par l\'équipe.']);
  // Une publication correcte, corrigée en arnaque : elle repart en attente.
  const corrigee = await appel(`/api/publications/${publication.id}`, { methode: 'PUT', qui: 'awa', donnees: { texte: 'Gains garantis pour tous.' } });
  assert.equal(corrigee.statut, 202);
  assert.equal((await appel(`/api/publications/${publication.id}`, { qui: 'bintou' })).statut, 404);

  const { rows: attentes } = await pool.query('SELECT id, cible_type FROM moderation_attente WHERE auteur_id = ANY($1::int[]) AND decide_le IS NULL ORDER BY id', [[membres.awa.id, membres.bintou.id, membres.kadi.id]]);
  assert.deepEqual(attentes.map((a) => a.cible_type).sort(), ['commentaire', 'demande', 'publication']);
  const duCommentaire = attentes.find((a) => a.cible_type === 'commentaire');
  assert.equal((await poster('chef', `/api/admin/moderation/attente/${duCommentaire.id}`, { decision: 'retirer' })).statut, 200);
  const { rows: [reste] } = await pool.query('SELECT c.masque, a.decision, a.decide_par FROM commentaires c JOIN moderation_attente a ON a.cible_id = c.id AND a.cible_type = \'commentaire\' WHERE a.id = $1', [duCommentaire.id]);
  assert.deepEqual({ ...reste }, { masque: true, decision: 'retire', decide_par: membres.chef.id });
  const { rows: [notification] } = await pool.query('SELECT texte FROM notifications WHERE utilisateur_id = $1 AND type = \'contenu_retire\'', [membres.bintou.id]);
  assert.match(notification.texte, /Ton commentaire n'a pas été publié/);
});

test('messages privés : seuls les insultes et les liens dangereux sont retenus ; une phrase d\'arnaque passe', async () => {
  assert.equal(verdict(ARNAQUE, 'fr', { prive: true }), 'accepte');
  assert.equal(verdict('video porno', 'fr', { prive: true }), 'accepte');
  assert.equal(raison('connard', 'fr', { prive: true }), 'insulte');
  assert.equal(raison('bit.ly/x', 'fr', { prive: true }), 'lien-raccourci');
  const chemin = `/api/messages/avec/${membres.bintou.identifiant}`;
  const insulte = await poster('awa', chemin, { texte: 'Espèce de connard.' });
  assert.deepEqual([insulte.statut, insulte.corps.champ, insulte.corps.code], [400, 'texte', 'texte-insultant']);
  assert.equal((await poster('awa', chemin, { texte: 'Clique ici : bit.ly/3xYz' })).corps.code, 'lien-raccourci');
  // Une phrase d'arnaque n'est ni refusée ni mise en attente dans un message : personne ne lit les messages.
  const envoye = await poster('awa', chemin, { texte: ARNAQUE });
  assert.equal(envoye.statut, 201);
  const { rows: [{ nb }] } = await pool.query('SELECT count(*)::int AS nb FROM moderation_attente WHERE auteur_id = $1 AND cible_type NOT IN (\'publication\', \'commentaire\', \'demande\', \'projet\')', [membres.awa.id]);
  assert.equal(nb, 0);
});

test('domaines interdits : l\'administrateur en ajoute un, le filtre le refuse tout de suite, puis il le retire', async () => {
  const domaine = `piege-${suffixe}.com`;
  assert.equal((await publier('awa', `Regarde ${domaine}`)).statut, 201);
  assert.equal((await poster('bintou', '/api/admin/domaines-interdits', { domaine })).statut, 403);
  assert.equal((await poster('chef', '/api/admin/domaines-interdits', { domaine: 'pas un domaine' })).statut, 400);
  // Une adresse entière est ramenée à son nom de domaine.
  const ajoute = await poster('chef', '/api/admin/domaines-interdits', { domaine: `https://www.${domaine.toUpperCase()}/page?x=1` });
  assert.deepEqual([ajoute.statut, ajoute.corps.domaine], [201, domaine]);
  assert.ok((await appel('/api/admin/domaines-interdits', { qui: 'chef' })).corps.domaines.some((d) => d.domaine === domaine));
  const refus = await publier('awa', `Regarde https://promo.${domaine}/gagne`);
  assert.deepEqual([refus.statut, refus.corps.code], [400, 'lien-interdit']);
  assert.equal((await poster('awa', `/api/messages/avec/${membres.bintou.identifiant}`, { texte: `va sur ${domaine}` })).statut, 400);
  assert.equal((await appel(`/api/admin/domaines-interdits/${domaine}`, { methode: 'DELETE', qui: 'chef', donnees: {} })).statut, 200);
  assert.equal((await publier('awa', `Regarde encore ${domaine}`)).statut, 201);
});
