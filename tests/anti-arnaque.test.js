// Tests de la protection anti-arnaque : le bandeau montré au destinataire d'un message ou d'une proposition qui
// parle d'un paiement d'avance, et la mention « Nouveau sur Palabre » sur un profil de moins de 7 jours.
const test = require('node:test');
const assert = require('node:assert/strict');
const { creerApp } = require('../src/app');
const { migrer } = require('../src/db/migrate');
const { pool } = require('../src/db/pool');
const { parleDePaiement } = require('../src/utils/moderation');
const { avecComptesPrets } = require('./aide');

let serveur;
let base;
const suffixe = Date.now();
const lettres = String(suffixe).replace(/\d/g, (chiffre) => 'abcdefghij'[chiffre]);
const adresse = (cle) => `arnaque-${cle}-${suffixe}@palabre.test`;
const membres = {};

async function appelBrut(chemin, { methode = 'GET', donnees, qui } = {}) {
  const headers = {};
  if (donnees) headers['Content-Type'] = 'application/json';
  if (qui) headers.Cookie = membres[qui].cookie;
  const r = await fetch(`${base}${chemin}`, { method: methode, headers, body: donnees ? JSON.stringify(donnees) : undefined });
  const texte = await r.text();
  let corps = {};
  try { corps = JSON.parse(texte); } catch { /* une page HTML */ }
  return { statut: r.status, corps, texte, entetes: r.headers };
}
const appel = avecComptesPrets(appelBrut);
const poster = (qui, chemin, donnees = {}) => appel(chemin, { methode: 'POST', qui, donnees });

test.before(async () => {
  await migrer();
  serveur = creerApp().listen(0);
  base = `http://localhost:${serveur.address().port}`;
  for (const [cle, type] of [['awa', 'dev'], ['bintou', 'dev'], ['cheick', 'dev'], ['kadi', 'client']]) {
    const r = await appel('/api/auth/inscription', { methode: 'POST', donnees: { type, prenom: cle, nomFamille: `Arnaque${lettres}`, email: adresse(cle), motDePasse: 'kolatier-vert-48', pays: 'Burkina Faso', ville: 'Koudougou', ...(type === 'client' ? { whatsapp: '+22670000009' } : {}) } });
    assert.equal(r.statut, 201, JSON.stringify(r.corps));
    membres[cle] = { cookie: r.entetes.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('palabre_session=')), identifiant: r.corps.utilisateur.identifiant, id: r.corps.utilisateur.id };
  }
  await poster('awa', '/api/amis/demandes', { identifiant: membres.bintou.identifiant });
  await poster('bintou', `/api/amis/demandes/${membres.awa.identifiant}/accepter`);
});

test.after(async () => {
  await pool.query('DELETE FROM utilisateurs WHERE email LIKE $1 OR email = $2', [`arnaque-%-${suffixe}@palabre.test`, `arnaque-${suffixe}@demo.palabre.dev`]);
  await new Promise((fini) => serveur.close(fini));
  await pool.end();
});

test('paiement d\'avance : reconnu en français et en anglais, sans se tromper sur un message ordinaire', () => {
  for (const texte of ['Envoie-moi 10 000 F par Orange Money', 'Tu peux payer par Mobile Money ?', 'Mon numéro Moov Money : 70 00 00 00', 'Fais le transfert sur Wave', 'Envoie d\'abord, je commence après',
    'Il y a des frais de dossier', 'Je demande un acompte avant de commencer', 'Paiement d\'avance obligatoire', 'Verse-moi l\'argent et je livre demain', 'MTN MoMo accepté',
    'Pay upfront please', 'Send the money first', 'There is a small registration fee', 'Advance payment required']) {
    assert.equal(parleDePaiement(texte), true, texte);
  }
  for (const texte of ['Bonjour, je peux commencer lundi.', 'Le site sera livré en trois semaines.', 'Voici ma proposition pour ton application.', 'Tu préfères React ou Vue ?', 'On se voit avant la réunion ?',
    'Hello, I can start on Monday.', 'The payment page of your shop is broken.', '', null]) {
    assert.equal(parleDePaiement(texte), false, String(texte));
  }
});

test('message privé : le destinataire voit le bandeau, pas l\'auteur ; le message n\'est ni refusé ni mis en attente', async () => {
  const chemin = `/api/messages/avec/${membres.bintou.identifiant}`;
  const envoi = await poster('awa', chemin, { texte: 'Envoie-moi 10 000 F par Orange Money d\'abord, je t\'explique ensuite.' });
  assert.equal(envoi.statut, 201, JSON.stringify(envoi.corps));
  const conversation = envoi.corps.conversationId;
  await poster('awa', `/api/messages/conversations/${conversation}`, { texte: 'Sinon, tu vas bien ?' });
  const lus = async (qui) => (await appel(`/api/messages/conversations/${conversation}`, { qui })).corps.messages.map((m) => [m.texte.slice(0, 12), m.alerteArnaque]);
  // Bintou reçoit : le bandeau est sur le message qui parle d'argent, pas sur l'autre.
  assert.deepEqual(await lus('bintou'), [['Envoie-moi 1', true], ['Sinon, tu va', false]]);
  // Awa, qui a écrit, ne voit aucun bandeau sur ses propres messages.
  assert.deepEqual(await lus('awa'), [['Envoie-moi 1', false], ['Sinon, tu va', false]]);
  // Rien n'a été retenu ni noté : personne ne lit les messages privés.
  const { rows: [{ nb }] } = await pool.query('SELECT count(*)::int AS nb FROM moderation_attente WHERE auteur_id = $1', [membres.awa.id]);
  assert.equal(nb, 0);
  // Les messages qui arrivent ensuite (route « nouveaux ») portent aussi le bandeau.
  const dernier = (await appel(`/api/messages/conversations/${conversation}`, { qui: 'bintou' })).corps.messages.pop().id;
  await poster('awa', `/api/messages/conversations/${conversation}`, { texte: 'Il y a juste des frais de dossier à régler.' });
  const nouveaux = (await appel(`/api/messages/conversations/${conversation}/nouveaux?apres=${dernier}`, { qui: 'bintou' })).corps.messages;
  assert.deepEqual(nouveaux.map((m) => m.alerteArnaque), [true]);
});

test('proposition : le client voit le bandeau quand elle parle d\'un paiement d\'avance, le dev qui l\'a écrite non', async () => {
  const demande = (await poster('kadi', '/api/demandes', { titre: 'Boutique en ligne de pagnes', description: 'Vendre des pagnes tissés, avec un catalogue et des commandes par WhatsApp.', budgetFcfa: 300000, delai: '1 mois', categorie: 'site-web' })).corps.demande;
  assert.equal((await poster('awa', `/api/demandes/${demande.id}/propositions`, { message: 'Je le fais en trois semaines. Acompte de 50 % par Mobile Money avant de commencer.', montantFcfa: 280000 })).statut, 201);
  assert.equal((await poster('bintou', `/api/demandes/${demande.id}/propositions`, { message: 'Je le fais en un mois, paiement à la livraison après ta validation.', montantFcfa: 300000 })).statut, 201);
  const pourKadi = (await appel(`/api/demandes/${demande.id}`, { qui: 'kadi' })).corps.propositions;
  const alertes = Object.fromEntries(pourKadi.map((p) => [p.auteur.identifiant, p.alerteArnaque]));
  assert.deepEqual(alertes, { [membres.awa.identifiant]: true, [membres.bintou.identifiant]: false });
  // Awa relit sa propre proposition : pas de bandeau pour elle.
  const pourAwa = (await appel(`/api/demandes/${demande.id}`, { qui: 'awa' })).corps.propositions;
  assert.deepEqual(pourAwa.map((p) => p.alerteArnaque), [false]);
});

test('« Nouveau sur Palabre » : sur un profil de moins de 7 jours, pour les clients seulement', async () => {
  const profil = async (qui) => (await (qui ? appel : appelBrut)(`/api/profils/${membres.cheick.identifiant}`, { qui })).corps.profil;
  // L'aide des tests vieillit les comptes de 4 jours : Cheick a donc 4 jours.
  assert.equal((await profil('kadi')).nouveau, true, 'un client le voit');
  assert.equal((await profil('awa')).nouveau, false, 'un autre dev, non');
  assert.equal((await profil(null)).nouveau, false, 'un visiteur, non');
  assert.equal((await profil('cheick')).nouveau, false, 'lui-même, non');
  // À 6 jours : encore ; à 8 jours : plus.
  await pool.query('UPDATE utilisateurs SET cree_le = now() - interval \'6 days 20 hours\' WHERE id = $1', [membres.cheick.id]);
  assert.equal((await profil('kadi')).nouveau, true);
  await pool.query('UPDATE utilisateurs SET cree_le = now() - interval \'8 days\' WHERE id = $1', [membres.cheick.id]);
  assert.equal((await profil('kadi')).nouveau, false);
  // Un compte de démonstration tout neuf ne porte pas la mention.
  await pool.query('UPDATE utilisateurs SET cree_le = now() - interval \'1 day\', email = $2 WHERE id = $1', [membres.cheick.id, `arnaque-${suffixe}@demo.palabre.dev`]);
  const demo = await profil('kadi');
  assert.equal(demo.nouveau, false);
  assert.ok(!JSON.stringify(demo).includes('@'), 'et l\'email ne sort toujours pas');
});
