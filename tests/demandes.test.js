// Tests des demandes, des propositions (solo et équipe éclair), du choix du client et des notifications.
const test = require('node:test');
const assert = require('node:assert/strict');
const { creerApp } = require('../src/app');
const { migrer } = require('../src/db/migrate');
const { pool } = require('../src/db/pool');

let serveur;
let base;
const suffixe = Date.now();
const membres = {}; // kadi, moussa (clients) ; awa, bintou, cheick, dao (devs)

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

const DEMANDE = {
  titre: 'Site pour mon restaurant',
  description: 'Je veux un site avec le menu, les horaires et la commande par WhatsApp.',
  budgetFcfa: 250000,
  delai: '3 semaines',
  categorie: 'site-web',
};
const MESSAGE = 'Bonjour, je peux réaliser ce projet dans les délais.';

async function publierDemande(qui = 'kadi', extra = {}) {
  const r = await poster(qui, '/api/demandes', { ...DEMANDE, ...extra });
  assert.equal(r.statut, 201);
  return r.corps.demande;
}

async function devenirAmis(a, b) {
  await poster(a, '/api/amis/demandes', { identifiant: membres[b].identifiant });
  const r = await poster(b, `/api/amis/demandes/${membres[a].identifiant}/accepter`);
  assert.equal(r.corps.amitie, 'amis');
}

// Types des notifications d'un membre, de la plus récente à la plus ancienne.
async function notificationsDe(qui) {
  return (await appel('/api/notifications', { qui })).corps;
}

// Équipe d'Awa avec Bintou et Cheick sur une demande ; renvoie l'identifiant de l'équipe.
async function creerEquipe(demandeId) {
  const r = await poster('awa', `/api/demandes/${demandeId}/equipes`, {
    message: 'Notre équipe couvre le site, le design et le paiement.',
    montantFcfa: 400000,
    roleChef: 'Chef de projet',
    membres: [
      { identifiant: membres.bintou.identifiant, role: 'Design' },
      { identifiant: membres.cheick.identifiant, role: 'Paiement mobile' },
    ],
  });
  assert.equal(r.statut, 201);
  return r.corps.propositions.find((p) => p.maPlace === 'chef').equipe.id;
}

test.before(async () => {
  await migrer();
  serveur = creerApp().listen(0);
  base = `http://localhost:${serveur.address().port}`;
  const comptes = { kadi: 'client', moussa: 'client', awa: 'dev', bintou: 'dev', cheick: 'dev', dao: 'dev' };
  for (const [prenom, type] of Object.entries(comptes)) {
    const email = `demandes-${prenom}-${suffixe}@palabre.test`;
    const r = await appel('/api/auth/inscription', {
      methode: 'POST',
      donnees: { type, nom: `${prenom} demandes${suffixe}`, email, motDePasse: 'motdepasse1', pays: 'Burkina Faso', ville: 'Ouagadougou' },
    });
    assert.equal(r.statut, 201);
    membres[prenom] = { cookie: r.entetes.get('set-cookie').split(';')[0], identifiant: r.corps.utilisateur.identifiant, email };
  }
  await devenirAmis('awa', 'bintou');
  await devenirAmis('awa', 'cheick');
});

test.after(async () => {
  // Demandes, équipes, propositions et notifications partent avec les comptes (ON DELETE CASCADE).
  await pool.query('DELETE FROM utilisateurs WHERE email = ANY($1)', [Object.values(membres).map((m) => m.email)]);
  serveur.close();
  await pool.end();
});

// ---------- Demandes ----------

test('publier une demande : réservé aux clients connectés, données vérifiées', async () => {
  assert.equal((await appel('/api/demandes')).statut, 401);
  assert.equal((await poster('awa', '/api/demandes', DEMANDE)).statut, 403, 'un dev ne publie pas de demande');

  const titreCourt = await poster('kadi', '/api/demandes', { ...DEMANDE, titre: 'Site' });
  assert.equal(titreCourt.statut, 400);
  assert.equal(titreCourt.corps.champ, 'titre');
  assert.equal((await poster('kadi', '/api/demandes', { ...DEMANDE, description: 'Trop court' })).corps.champ, 'description');
  assert.equal((await poster('kadi', '/api/demandes', { ...DEMANDE, budgetFcfa: -5 })).corps.champ, 'budgetFcfa');
  assert.equal((await poster('kadi', '/api/demandes', { ...DEMANDE, budgetFcfa: '12,5' })).corps.champ, 'budgetFcfa');
  assert.equal((await poster('kadi', '/api/demandes', { ...DEMANDE, categorie: 'voiture' })).corps.champ, 'categorie');
});

test('une demande publiée apparaît dans la liste, avec filtre par catégorie', async () => {
  const demande = await publierDemande('kadi', { budgetFcfa: '250 000' });
  assert.equal(demande.budgetFcfa, 250000, 'les espaces du montant sont acceptés');
  assert.equal(demande.statut, 'ouverte');
  assert.equal(demande.nomCategorie, 'Site web');
  assert.equal(demande.client.identifiant, membres.kadi.identifiant);
  assert.equal(demande.client.email, undefined);
  const sansBudget = await publierDemande('kadi', { budgetFcfa: '', delai: '', categorie: 'design' });
  assert.equal(sansBudget.budgetFcfa, null);

  const liste = await appel('/api/demandes', { qui: 'awa' });
  assert.ok(liste.corps.demandes.some((d) => d.id === demande.id));
  const design = await appel('/api/demandes?categorie=design', { qui: 'awa' });
  assert.ok(design.corps.demandes.some((d) => d.id === sansBudget.id));
  assert.ok(design.corps.demandes.every((d) => d.categorie === 'design'));

  assert.equal((await appel('/api/demandes/999999999', { qui: 'awa' })).statut, 404);
  assert.equal((await appel('/api/demandes/abc', { qui: 'awa' })).statut, 404);
});

test('les demandes sont chargées par 10', async () => {
  for (let i = 1; i <= 11; i += 1) await publierDemande('moussa', { titre: `Demande de Moussa ${i}` });
  const page1 = await appel('/api/demandes', { qui: 'dao' });
  assert.equal(page1.corps.demandes.length, 10);
  assert.ok(page1.corps.suivant, 'il reste des demandes');
  const page2 = await appel(`/api/demandes?avant=${page1.corps.suivant}`, { qui: 'dao' });
  // Les autres fichiers de tests publient aussi des demandes en même temps dans la même base :
  // on ne regarde donc que celles de Moussa, qui doivent toutes y être, dans l'ordre, sans doublon.
  const deMoussa = [...page1.corps.demandes, ...page2.corps.demandes]
    .filter((d) => d.client.identifiant === membres.moussa.identifiant)
    .map((d) => d.titre);
  assert.deepEqual(deMoussa.slice(0, 10), Array.from({ length: 10 }, (_, i) => `Demande de Moussa ${11 - i}`));
  assert.ok(page2.corps.demandes.every((d) => d.id < page1.corps.suivant), 'la page 2 ne contient que des demandes plus anciennes');
  const miennes = await appel('/api/demandes?miennes=1', { qui: 'dao' });
  assert.equal(miennes.corps.demandes.length, 0, 'Dao n\'a encore rien proposé');
});

// ---------- Proposition en solo ----------

test('proposition en solo : envoyée au client, invisible pour les autres devs', async () => {
  const demande = await publierDemande();
  const chemin = `/api/demandes/${demande.id}/propositions`;

  assert.equal((await poster('moussa', chemin, { message: MESSAGE })).statut, 403, 'un client ne propose pas');
  assert.equal((await poster('dao', chemin, { message: 'Court' })).corps.champ, 'message');

  const envoi = await poster('dao', chemin, { message: MESSAGE, montantFcfa: 200000 });
  assert.equal(envoi.statut, 201);
  assert.equal(envoi.corps.propositions[0].maPlace, 'solo');
  assert.equal(envoi.corps.propositions[0].statut, 'envoyee');
  assert.equal((await poster('dao', chemin, { message: MESSAGE })).statut, 400, 'une seule proposition par dev');

  const vueClient = await appel(`/api/demandes/${demande.id}`, { qui: 'kadi' });
  assert.equal(vueClient.corps.demande.nbPropositions, 1);
  assert.equal(vueClient.corps.propositions[0].auteur.identifiant, membres.dao.identifiant);
  assert.equal(vueClient.corps.propositions[0].montantFcfa, 200000);

  const vueConcurrent = await appel(`/api/demandes/${demande.id}`, { qui: 'awa' });
  assert.equal(vueConcurrent.corps.propositions.length, 0, 'un dev ne voit pas les propositions des autres');
  const vueAutreClient = await appel(`/api/demandes/${demande.id}`, { qui: 'moussa' });
  assert.equal(vueAutreClient.corps.propositions.length, 0);

  const notifs = await notificationsDe('kadi');
  assert.equal(notifs.notifications[0].type, 'nouvelle_proposition');
  assert.equal(notifs.notifications[0].lien, `/demande?id=${demande.id}`);
  assert.ok((await appel('/api/demandes?miennes=1', { qui: 'dao' })).corps.demandes.some((d) => d.id === demande.id));

  // Retirer sa proposition.
  assert.equal((await appel(`${chemin}/mienne`, { methode: 'DELETE', qui: 'dao', donnees: {} })).statut, 200);
  assert.equal((await appel(`${chemin}/mienne`, { methode: 'DELETE', qui: 'dao', donnees: {} })).statut, 404);
  assert.equal((await appel(`/api/demandes/${demande.id}`, { qui: 'kadi' })).corps.propositions.length, 0);
});

// ---------- Équipe éclair ----------

test('équipe éclair : on n\'invite que ses amis développeurs, avec un rôle', async () => {
  const demande = await publierDemande();
  const chemin = `/api/demandes/${demande.id}/equipes`;
  const corps = { message: MESSAGE, roleChef: 'Chef de projet' };

  assert.equal((await poster('awa', chemin, { ...corps, membres: [] })).corps.champ, 'membres');
  const pasAmi = await poster('awa', chemin, { ...corps, membres: [{ identifiant: membres.dao.identifiant, role: 'Design' }] });
  assert.equal(pasAmi.statut, 400, 'Dao n\'est pas ami avec Awa');
  const client = await poster('awa', chemin, { ...corps, membres: [{ identifiant: membres.kadi.identifiant, role: 'Design' }] });
  assert.equal(client.statut, 400, 'un client ne peut pas être invité');
  const sansRole = await poster('awa', chemin, { ...corps, membres: [{ identifiant: membres.bintou.identifiant, role: '' }] });
  assert.equal(sansRole.corps.champ, 'membres');
  const double = await poster('awa', chemin, { ...corps, membres: [
    { identifiant: membres.bintou.identifiant, role: 'Design' }, { identifiant: membres.bintou.identifiant, role: 'Tests' },
  ] });
  assert.equal(double.statut, 400);
  assert.equal((await poster('awa', chemin, { ...corps, roleChef: '', membres: [{ identifiant: membres.bintou.identifiant, role: 'Design' }] })).corps.champ, 'roleChef');
  assert.equal((await appel(`/api/demandes/${demande.id}`, { qui: 'awa' })).corps.propositions.length, 0, 'rien n\'a été créé');
});

test('équipe éclair : la proposition part quand tous les invités ont répondu', async () => {
  const demande = await publierDemande();
  const equipeId = await creerEquipe(demande.id);
  assert.equal((await poster('awa', `/api/demandes/${demande.id}/equipes`, {
    message: MESSAGE, roleChef: 'Chef', membres: [{ identifiant: membres.bintou.identifiant, role: 'Design' }],
  })).statut, 400, 'une seule équipe par chef et par demande');

  // Les invités sont prévenus ; le client ne voit rien tant que l'équipe n'est pas complète.
  const notifBintou = (await notificationsDe('bintou')).notifications[0];
  assert.equal(notifBintou.type, 'invitation_equipe');
  assert.match(notifBintou.texte, /Design/);
  assert.equal((await appel(`/api/demandes/${demande.id}`, { qui: 'kadi' })).corps.propositions.length, 0);
  assert.equal((await appel(`/api/demandes/${demande.id}`, { qui: 'kadi' })).corps.demande.nbPropositions, 0);

  const vueBintou = (await appel(`/api/demandes/${demande.id}`, { qui: 'bintou' })).corps.propositions[0];
  assert.equal(vueBintou.maPlace, 'invite');
  assert.equal(vueBintou.statut, 'brouillon');
  assert.equal(vueBintou.equipe.membres.length, 3);
  assert.equal(vueBintou.equipe.membres[0].estChef, true, 'le chef est listé en premier');

  // Seul un invité peut répondre, et une seule fois.
  assert.equal((await poster('dao', `/api/equipes/${equipeId}/accepter`)).statut, 404);
  assert.equal((await poster('kadi', `/api/equipes/${equipeId}/accepter`)).statut, 403);
  const oui = await poster('bintou', `/api/equipes/${equipeId}/accepter`);
  assert.deepEqual(oui.corps, { reponse: 'accepte', propositionEnvoyee: false }, 'Cheick n\'a pas encore répondu');
  assert.equal((await poster('bintou', `/api/equipes/${equipeId}/refuser`)).statut, 404);

  const non = await poster('cheick', `/api/equipes/${equipeId}/refuser`);
  assert.deepEqual(non.corps, { reponse: 'refuse', propositionEnvoyee: true });

  // Le client reçoit la proposition, avec seulement ceux qui ont accepté.
  const vueClient = (await appel(`/api/demandes/${demande.id}`, { qui: 'kadi' })).corps;
  assert.equal(vueClient.propositions.length, 1);
  assert.equal(vueClient.propositions[0].statut, 'envoyee');
  assert.deepEqual(
    vueClient.propositions[0].equipe.membres.map((m) => [m.identifiant, m.role]),
    [[membres.awa.identifiant, 'Chef de projet'], [membres.bintou.identifiant, 'Design']],
  );
  assert.equal((await notificationsDe('kadi')).notifications[0].type, 'nouvelle_proposition');
  assert.equal((await notificationsDe('awa')).notifications[0].type, 'equipe_reponses');
  // Cheick a refusé : il ne voit plus la proposition.
  assert.equal((await appel(`/api/demandes/${demande.id}`, { qui: 'cheick' })).corps.propositions.length, 0);
});

test('équipe éclair : si tous refusent, rien ne part ; le chef peut dissoudre', async () => {
  const demande = await publierDemande();
  const equipeId = await creerEquipe(demande.id);
  await poster('bintou', `/api/equipes/${equipeId}/refuser`);
  const dernier = await poster('cheick', `/api/equipes/${equipeId}/refuser`);
  assert.equal(dernier.corps.propositionEnvoyee, false);
  assert.equal((await appel(`/api/demandes/${demande.id}`, { qui: 'kadi' })).corps.propositions.length, 0);
  assert.match((await notificationsDe('awa')).notifications[0].texte, /refusé/);

  assert.equal((await appel(`/api/equipes/${equipeId}`, { methode: 'DELETE', qui: 'bintou', donnees: {} })).statut, 404, 'seul le chef dissout');
  assert.equal((await appel(`/api/equipes/${equipeId}`, { methode: 'DELETE', qui: 'awa', donnees: {} })).statut, 200);
  assert.equal((await appel(`/api/demandes/${demande.id}`, { qui: 'awa' })).corps.propositions.length, 0);
});

// ---------- Choix du client ----------

test('le client choisit une proposition : les autres sont refusées, l\'équipe est prévenue', async () => {
  const demande = await publierDemande();
  await poster('dao', `/api/demandes/${demande.id}/propositions`, { message: MESSAGE, montantFcfa: 300000 });
  const equipeId = await creerEquipe(demande.id);
  await poster('bintou', `/api/equipes/${equipeId}/accepter`);
  await poster('cheick', `/api/equipes/${equipeId}/refuser`);

  const propositions = (await appel(`/api/demandes/${demande.id}`, { qui: 'kadi' })).corps.propositions;
  assert.equal(propositions.length, 2);
  const solo = propositions.find((p) => !p.equipe);
  const equipe = propositions.find((p) => p.equipe);

  const chemin = `/api/demandes/${demande.id}/choisir`;
  assert.equal((await poster('moussa', chemin, { propositionId: equipe.id })).statut, 404, 'pas sa demande');
  assert.equal((await poster('awa', chemin, { propositionId: equipe.id })).statut, 403);
  assert.equal((await poster('kadi', chemin, { propositionId: 999999999 })).statut, 404);

  const choix = await poster('kadi', chemin, { propositionId: equipe.id });
  assert.equal(choix.statut, 200);
  assert.equal(choix.corps.demande.statut, 'attribuee');
  assert.equal(choix.corps.propositions.find((p) => p.id === equipe.id).statut, 'acceptee');
  assert.equal(choix.corps.propositions.find((p) => p.id === solo.id).statut, 'refusee');
  assert.equal((await poster('kadi', chemin, { propositionId: solo.id })).statut, 400, 'un seul choix');

  assert.equal((await notificationsDe('awa')).notifications[0].type, 'proposition_acceptee');
  assert.equal((await notificationsDe('bintou')).notifications[0].type, 'proposition_acceptee');
  assert.notEqual((await notificationsDe('cheick')).notifications[0].type, 'proposition_acceptee', 'Cheick avait refusé');
  assert.notEqual((await notificationsDe('dao')).notifications[0]?.type, 'proposition_acceptee');

  // La demande n'est plus ouverte : plus de proposition, plus dans la liste, équipe choisie indissoluble.
  assert.equal((await poster('cheick', `/api/demandes/${demande.id}/propositions`, { message: MESSAGE })).statut, 400);
  assert.ok(!(await appel('/api/demandes', { qui: 'dao' })).corps.demandes.some((d) => d.id === demande.id));
  assert.equal((await appel(`/api/equipes/${equipeId}`, { methode: 'DELETE', qui: 'awa', donnees: {} })).statut, 404);

  assert.equal((await poster('moussa', `/api/demandes/${demande.id}/terminer`)).statut, 404);
  assert.equal((await poster('kadi', `/api/demandes/${demande.id}/terminer`)).corps.demande.statut, 'terminee');
});

test('annuler une demande ouverte', async () => {
  const demande = await publierDemande();
  assert.equal((await poster('moussa', `/api/demandes/${demande.id}/annuler`)).statut, 404);
  assert.equal((await poster('kadi', `/api/demandes/${demande.id}/annuler`)).corps.demande.statut, 'annulee');
  assert.equal((await poster('kadi', `/api/demandes/${demande.id}/annuler`)).statut, 404);
  assert.equal((await poster('dao', `/api/demandes/${demande.id}/propositions`, { message: MESSAGE })).statut, 400);
});

// ---------- Notifications ----------

test('notifications : compteur, demande d\'ami, marquer comme lue', async () => {
  assert.equal((await appel('/api/notifications')).statut, 401);

  const avant = (await notificationsDe('dao')).nonLues;
  await poster('cheick', '/api/amis/demandes', { identifiant: membres.dao.identifiant });
  const apres = await notificationsDe('dao');
  assert.equal(apres.nonLues, avant + 1);
  assert.equal(apres.notifications[0].type, 'demande_ami');
  assert.equal(apres.notifications[0].lien, '/amis');
  assert.equal(apres.notifications[0].lue, false);
  assert.equal((await appel('/api/auth/moi', { qui: 'dao' })).corps.utilisateur.notifications, apres.nonLues);

  // Bintou ne peut pas marquer comme lue une notification de Dao.
  await poster('bintou', '/api/notifications/lues', { id: apres.notifications[0].id });
  assert.equal((await notificationsDe('dao')).nonLues, apres.nonLues);

  const une = await poster('dao', '/api/notifications/lues', { id: apres.notifications[0].id });
  assert.equal(une.corps.nonLues, apres.nonLues - 1);
  assert.equal((await poster('awa', '/api/notifications/lues')).corps.nonLues, 0, 'tout marquer comme lu');
  assert.ok((await notificationsDe('awa')).notifications.every((n) => n.lue));

  // Accepter une demande d'ami prévient celui qui l'avait envoyée.
  await poster('dao', `/api/amis/demandes/${membres.cheick.identifiant}/accepter`);
  assert.equal((await notificationsDe('cheick')).notifications[0].type, 'ami_accepte');
});
