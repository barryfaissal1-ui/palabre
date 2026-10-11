// Tests des messages vocaux : contrôle du fichier audio, stockage, lecture réservée aux membres de la conversation.
const test = require('node:test');
const assert = require('node:assert/strict');
const { creerApp } = require('../src/app');
const { migrer } = require('../src/db/migrate');
const { pool } = require('../src/db/pool');
const { lireVocal } = require('../src/utils/audio');
const { avecComptesPrets } = require('./aide');

let serveur;
let base;
const suffixe = Date.now();
const lettres = String(suffixe).replace(/\d/g, (chiffre) => 'abcdefghij'[chiffre]);
const membres = {}; // awa et bintou (amies), cheick (extérieur), kadi (cliente)

// De faux enregistrements : seuls les premiers octets comptent pour le contrôle du format.
const octets = (debut, taille = 2000) => Buffer.concat([Buffer.from(debut), Buffer.alloc(taille, 7)]);
const WEBM = octets([0x1a, 0x45, 0xdf, 0xa3]);
const MP4 = octets([0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70]); // « ftyp » à partir du 5e octet
const OGG = octets([0x4f, 0x67, 0x67, 0x53]);
const enDataUrl = (type, donnees) => `data:${type};base64,${donnees.toString('base64')}`;
const vocal = (duree = 7, donnees = enDataUrl('audio/webm;codecs=opus', WEBM)) => ({ vocal: { donnees, duree } });

async function appelBrut(chemin, { methode = 'GET', donnees, qui, entetes = {} } = {}) {
  const headers = { ...entetes };
  if (donnees) headers['Content-Type'] = 'application/json';
  if (qui) headers.Cookie = membres[qui].cookie;
  const r = await fetch(`${base}${chemin}`, { method: methode, headers, body: donnees ? JSON.stringify(donnees) : undefined });
  const brut = Buffer.from(await r.arrayBuffer());
  let corps;
  try { corps = JSON.parse(brut.toString()); } catch { corps = brut; }
  return { statut: r.status, corps, entetes: r.headers };
}
const appel = avecComptesPrets(appelBrut);
const poster = (qui, chemin, donnees = {}) => appel(chemin, { methode: 'POST', qui, donnees });
const envoyer = (qui, a, donnees) => poster(qui, `/api/messages/avec/${membres[a].identifiant}`, donnees);

test.before(async () => {
  await migrer();
  serveur = creerApp().listen(0);
  base = `http://localhost:${serveur.address().port}`;
  for (const [cle, type] of Object.entries({ awa: 'dev', bintou: 'dev', cheick: 'dev', kadi: 'client' })) {
    const email = `vocal-${cle}-${suffixe}@palabre.test`;
    const r = await appel('/api/auth/inscription', { methode: 'POST', donnees: { type, prenom: cle, nomFamille: `Vocal${lettres}`, email, motDePasse: 'kolatier-vert-48', pays: 'Burkina Faso', ville: 'Koudougou' } });
    assert.equal(r.statut, 201);
    const { rows } = await pool.query('SELECT id FROM utilisateurs WHERE email = $1', [email]);
    membres[cle] = { cookie: r.entetes.get('set-cookie').split(';')[0], identifiant: r.corps.utilisateur.identifiant, id: rows[0].id };
  }
  await poster('awa', '/api/amis/demandes', { identifiant: membres.bintou.identifiant });
  await poster('bintou', `/api/amis/demandes/${membres.awa.identifiant}/accepter`);
});

test.after(async () => {
  await pool.query('DELETE FROM utilisateurs WHERE email LIKE $1', [`vocal-%-${suffixe}@palabre.test`]);
  await new Promise((fini) => serveur.close(fini));
  await pool.end();
});

test('contrôle du fichier : format annoncé, premiers octets, taille et durée', () => {
  assert.deepEqual(lireVocal(vocal(7).vocal).typeMime, 'audio/webm');
  assert.equal(lireVocal({ donnees: enDataUrl('audio/mp4', MP4), duree: 60 }).typeMime, 'audio/mp4');
  assert.equal(lireVocal({ donnees: enDataUrl('audio/ogg;codecs=opus', OGG), duree: 1.4 }).duree, 1);
  const refuses = [
    [{ donnees: enDataUrl('audio/mpeg', WEBM), duree: 5 }, /format audio/],            // type non accepté
    [{ donnees: enDataUrl('audio/webm', MP4), duree: 5 }, /pas un enregistrement/],    // annoncé WebM, mais c'est autre chose
    [{ donnees: enDataUrl('audio/webm', octets([0x3c, 0x73, 0x63, 0x72])), duree: 5 }, /pas un enregistrement/], // « <scr… »
    [{ donnees: enDataUrl('image/png', WEBM), duree: 5 }, /format audio/],
    [{ donnees: enDataUrl('audio/webm', octets([0x1a, 0x45, 0xdf, 0xa3], 401 * 1024)), duree: 5 }, /400 Ko/],
    [{ donnees: enDataUrl('audio/webm', WEBM), duree: 61 }, /une minute/],
    [{ donnees: enDataUrl('audio/webm', WEBM), duree: 0 }, /une seconde/],
    [{ donnees: enDataUrl('audio/webm', WEBM), duree: 'long' }, /une seconde/],
    [{ donnees: 'data:audio/webm;base64,', duree: 5 }, /format audio/],
    [{ duree: 5 }, /Aucun enregistrement/],
    [{ donnees: 'https://exemple.test/son.webm', duree: 5 }, /format audio/],
  ];
  for (const [entree, message] of refuses) assert.throws(() => lireVocal(entree), message);
});

test('envoyer un message vocal : gardé avec sa durée, sans texte à saisir', async () => {
  const r = await envoyer('awa', 'bintou', vocal(12));
  assert.equal(r.statut, 201, JSON.stringify(r.corps));
  const { message } = r.corps;
  assert.match(message.vocal.url, /^\/fichiers\/[0-9a-f-]{36}$/);
  assert.equal(message.vocal.duree, 12);
  assert.equal(message.image, null, 'un vocal n\'est pas une photo');
  assert.equal(message.texte, 'Message vocal');
  const { rows: [fichier] } = await pool.query('SELECT type_mime, taille FROM fichiers WHERE id = $1', [message.vocal.url.split('/').pop()]);
  assert.deepEqual(fichier, { type_mime: 'audio/webm', taille: WEBM.length });

  // Vu par Bintou : la liste dit « Message vocal », la notification aussi, et jamais plus.
  const conversation = (await appel('/api/messages/conversations', { qui: 'bintou' })).corps.conversations[0];
  assert.equal(conversation.dernierMessage.texte, 'Message vocal');
  assert.equal((await appel(`/api/messages/conversations/${conversation.id}`, { qui: 'bintou' })).corps.messages.pop().vocal.duree, 12);

  // Refus : fichier invalide, vocal avec photo, visiteur.
  assert.equal((await envoyer('awa', 'bintou', vocal(5, enDataUrl('audio/mpeg', WEBM)))).statut, 400);
  assert.equal((await envoyer('awa', 'bintou', vocal(90))).statut, 400);
  assert.equal((await envoyer('awa', 'bintou', { ...vocal(5), image: 'data:image/png;base64,AAAA' })).statut, 400);
  assert.equal((await appelBrut(`/api/messages/avec/${membres.bintou.identifiant}`, { methode: 'POST', donnees: vocal(5) })).statut, 401);
  // Un message sans texte ET sans vocal reste refusé, comme avant.
  assert.equal((await envoyer('awa', 'bintou', { texte: '' })).statut, 400);
});

test('le son n\'est servi qu\'aux membres de la conversation, par morceaux si le téléphone le demande', async () => {
  const { message } = (await envoyer('bintou', 'awa', vocal(3, enDataUrl('audio/mp4', MP4)))).corps;
  const lire = (qui, entetes) => appelBrut(message.vocal.url, { qui, entetes });
  const entier = await lire('awa');
  assert.equal(entier.statut, 200);
  assert.equal(entier.entetes.get('content-type'), 'audio/mp4');
  assert.equal(entier.entetes.get('accept-ranges'), 'bytes');
  assert.match(entier.entetes.get('cache-control'), /^private/);
  assert.ok(entier.corps.equals(MP4));
  assert.equal((await lire('bintou')).statut, 200);
  assert.equal((await lire('cheick')).statut, 404, 'un extérieur ne l\'entend pas');
  assert.equal((await lire(null)).statut, 404);

  // L'iPhone demande d'abord les deux premiers octets, puis des morceaux.
  const debut = await lire('awa', { Range: 'bytes=0-1' });
  assert.equal(debut.statut, 206);
  assert.equal(debut.entetes.get('content-range'), `bytes 0-1/${MP4.length}`);
  assert.ok(debut.corps.equals(MP4.subarray(0, 2)));
  const suite = await lire('awa', { Range: 'bytes=100-' });
  assert.equal(suite.entetes.get('content-range'), `bytes 100-${MP4.length - 1}/${MP4.length}`);
  assert.equal(suite.corps.length, MP4.length - 100);
  assert.equal((await lire('awa', { Range: 'bytes=-10' })).corps.length, 10);
  assert.equal((await lire('awa', { Range: `bytes=${MP4.length + 5}-` })).statut, 416);
  assert.equal((await lire('cheick', { Range: 'bytes=0-1' })).statut, 404, 'même par morceaux');
});

test('supprimer un vocal pour tout le monde efface le son de la base ; un vocal dans un groupe', async () => {
  const { message } = (await envoyer('awa', 'bintou', vocal(4))).corps;
  const r = await appel(`/api/messages/message/${message.id}`, { methode: 'DELETE', qui: 'awa', donnees: { pourTous: true } });
  assert.equal(r.statut, 200);
  assert.deepEqual([r.corps.message.vocal, r.corps.message.supprime], [null, true]);
  assert.equal((await pool.query('SELECT 1 FROM fichiers WHERE id = $1', [message.vocal.url.split('/').pop()])).rowCount, 0);
  assert.equal((await appelBrut(message.vocal.url, { qui: 'awa' })).statut, 404);

  const demande = (await poster('kadi', '/api/demandes', { titre: 'Site pour une école de couture', description: 'Présenter les cours, les horaires et les inscriptions en ligne.', budgetFcfa: 200000, delai: '1 mois', categorie: 'site-web' })).corps.demande.id;
  const equipe = (await poster('awa', `/api/demandes/${demande}/equipes`, { message: 'À deux, en un mois.', montantFcfa: 190000, roleChef: 'Serveur', membres: [{ identifiant: membres.bintou.identifiant, role: 'Interface' }] })).corps.propositions.find((p) => p.equipe).equipe;
  await poster('bintou', `/api/equipes/${equipe.id}/accepter`);
  const dansLeGroupe = await poster('bintou', `/api/messages/groupes/${equipe.groupeId}`, vocal(9));
  assert.equal(dansLeGroupe.statut, 201);
  assert.equal(dansLeGroupe.corps.message.vocal.duree, 9);
  assert.equal((await appelBrut(dansLeGroupe.corps.message.vocal.url, { qui: 'awa' })).statut, 200);
  assert.equal((await appelBrut(dansLeGroupe.corps.message.vocal.url, { qui: 'cheick' })).statut, 404);
  const notification = (await pool.query('SELECT texte FROM notifications WHERE utilisateur_id = $1 AND type = \'message\' AND cible_id = $2', [membres.awa.id, equipe.groupeId])).rows[0];
  assert.ok(notification && !notification.texte.includes('fichiers'));
});
