// Tests de la refonte « réseau social » : anneau de preuve (nbProjetsVerifies), recherche par nom,
// « Disponibles maintenant », fil d'un auteur, aperçu des j'aime et des commentaires, photo de couverture.
const test = require('node:test');
const assert = require('node:assert/strict');
const { creerApp } = require('../src/app');
const { migrer } = require('../src/db/migrate');
const { pool } = require('../src/db/pool');

let serveur;
let base;
const suffixe = Date.now();
const membres = {}; // awa, bintou, cheick (devs) et dao (client) : { cookie, identifiant, email, id }

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

// Une vraie petite image JPEG (1 × 1 pixel), encodée en base64.
const JPEG_1PX = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

async function devenirAmis(a, b) {
  await appel('/api/amis/demandes', { methode: 'POST', qui: a, donnees: { identifiant: membres[b].identifiant } });
  const r = await appel(`/api/amis/demandes/${membres[a].identifiant}/accepter`, { methode: 'POST', qui: b, donnees: {} });
  assert.equal(r.statut, 200);
}

test.before(async () => {
  await migrer();
  serveur = creerApp().listen(0);
  base = `http://localhost:${serveur.address().port}`;
  for (const [prenom, type] of [['awa', 'dev'], ['bintou', 'dev'], ['cheick', 'dev'], ['dao', 'client']]) {
    const email = `preuve-${prenom}-${suffixe}@palabre.test`;
    const r = await appel('/api/auth/inscription', {
      methode: 'POST',
      // un nom unique à ce test (Zz + date) : la recherche par nom ne trouve que ces comptes
      donnees: { type, nom: `${prenom} Zz${suffixe}`, email, motDePasse: 'motdepasse1', pays: 'Burkina Faso', ville: `Ville${suffixe}` },
    });
    assert.equal(r.statut, 201);
    const { rows } = await pool.query('SELECT id FROM utilisateurs WHERE email = $1', [email]);
    membres[prenom] = { cookie: r.entetes.get('set-cookie').split(';')[0], identifiant: r.corps.utilisateur.identifiant, email, id: rows[0].id };
  }
  // Bintou a 2 projets au lien vérifié et 1 sans lien ; un 4e, vérifié mais masqué, ne compte pas.
  await pool.query(
    `INSERT INTO projets (dev_id, titre, description, secteur, lien, lien_verifie_le, masque) VALUES
       ($1, 'Projet un', 'Description du projet un', 'commerce', 'https://exemple.org/1', now(), FALSE),
       ($1, 'Projet deux', 'Description du projet deux', 'commerce', 'https://exemple.org/2', now(), FALSE),
       ($1, 'Projet trois', 'Description du projet trois', 'commerce', NULL, NULL, FALSE),
       ($1, 'Projet masqué', 'Description du projet masqué', 'commerce', 'https://exemple.org/4', now(), TRUE)`,
    [membres.bintou.id],
  );
  await devenirAmis('awa', 'bintou');
  await devenirAmis('awa', 'cheick');
});

test.after(async () => {
  await pool.query('DELETE FROM utilisateurs WHERE email = ANY($1)', [Object.values(membres).map((m) => m.email)]);
  serveur.close();
  await pool.end();
});

// ---------- Anneau de preuve ----------

test('nbProjetsVerifies : dans l\'aperçu d\'un membre, le profil et /auth/moi', async () => {
  const amis = await appel('/api/amis', { qui: 'awa' });
  const parIdentifiant = Object.fromEntries(amis.corps.amis.map((a) => [a.identifiant, a]));
  assert.equal(parIdentifiant[membres.bintou.identifiant].nbProjetsVerifies, 2); // ni le projet sans lien, ni le masqué
  assert.equal(parIdentifiant[membres.cheick.identifiant].nbProjetsVerifies, 0);

  const profil = await appel(`/api/profils/${membres.bintou.identifiant}`);
  assert.equal(profil.corps.profil.nbProjetsVerifies, 2);
  const moi = await appel('/api/auth/moi', { qui: 'bintou' });
  assert.equal(moi.corps.utilisateur.nbProjetsVerifies, 2);
});

// ---------- Recherche par nom ----------

test('recherche par nom : au moins 2 lettres, devs et clients, sans email ni WhatsApp', async () => {
  assert.equal((await appel('/api/devs?q=a')).statut, 400);
  assert.equal((await appel('/api/devs?q=')).statut, 400);

  const r = await appel(`/api/devs?q=${encodeURIComponent(`zz${suffixe}`)}`); // insensible à la casse (ILIKE)
  assert.equal(r.statut, 200);
  assert.equal(r.corps.devs.length, 4); // les 3 devs et le client
  assert.ok(r.corps.devs.every((d) => !('email' in d) && !('whatsapp' in d)));

  const debut = await appel(`/api/devs?q=${encodeURIComponent(`BINTOU zz${suffixe}`)}`);
  assert.deepEqual(debut.corps.devs.map((d) => d.identifiant), [membres.bintou.identifiant]);
  assert.equal(debut.corps.devs[0].nbProjetsVerifies, 2);
});

test('recherche par nom : % et _ sont cherchés tels quels, pas comme des jokers', async () => {
  const r = await appel(`/api/devs?q=${encodeURIComponent(`%_${suffixe}`)}`);
  assert.equal(r.statut, 200);
  assert.equal(r.corps.devs.length, 0);
});

test('sans « q », la recherche ne montre toujours que des devs', async () => {
  const r = await appel(`/api/devs?ville=${encodeURIComponent(`ville${suffixe}`)}`);
  assert.equal(r.corps.devs.length, 3);
  assert.ok(r.corps.devs.every((d) => d.type === 'dev'));
});

// ---------- Disponibles maintenant ----------

test('disponibles : réservé aux membres, amis d\'abord, sans moi ni les occupés', async () => {
  assert.equal((await appel('/api/devs/disponibles')).statut, 401);

  // Cheick (ami d'Awa) se déclare occupé : il sort de la rangée.
  await pool.query('UPDATE utilisateurs SET disponible = FALSE WHERE id = $1', [membres.cheick.id]);
  const r = await appel('/api/devs/disponibles', { qui: 'awa' });
  assert.equal(r.statut, 200);
  assert.ok(r.corps.devs.length <= 15);
  const identifiants = r.corps.devs.map((d) => d.identifiant);
  assert.equal(identifiants[0], membres.bintou.identifiant); // son amie passe avant tous les autres
  assert.equal(r.corps.devs[0].estAmi, true);
  assert.equal(r.corps.devs[0].nbProjetsVerifies, 2);
  assert.ok(!identifiants.includes(membres.awa.identifiant));
  assert.ok(!identifiants.includes(membres.cheick.identifiant));
  assert.ok(!identifiants.includes(membres.dao.identifiant)); // un client n'est pas un dev disponible
  await pool.query('UPDATE utilisateurs SET disponible = TRUE WHERE id = $1', [membres.cheick.id]);
});

// ---------- Fil ----------

test('fil par auteur, aperçu des j\'aime et des 2 derniers commentaires', async () => {
  const publier = (qui, texte, extra = {}) => appel('/api/publications', { methode: 'POST', qui, donnees: { type: 'idee', texte, ...extra } });
  const p1 = (await publier('bintou', 'Première de Bintou', { image: JPEG_1PX })).corps.publication;
  await publier('bintou', 'Deuxième de Bintou');
  await publier('cheick', 'Publication de Cheick');

  // La taille de l'image est lue par le serveur dans le fichier.
  assert.equal(p1.imageLargeur, 1);
  assert.equal(p1.imageHauteur, 1);
  assert.equal(p1.aimePar, null);
  assert.deepEqual(p1.derniersCommentaires, []);

  // Dao (inconnue d'Awa) puis Cheick (ami d'Awa) aiment ; trois commentaires.
  for (const qui of ['dao', 'cheick', 'awa']) {
    await appel(`/api/publications/${p1.id}/jaime`, { methode: 'POST', qui, donnees: {} });
  }
  for (const [qui, texte] of [['awa', 'Un'], ['cheick', 'Deux'], ['dao', 'Trois']]) {
    const r = await appel(`/api/publications/${p1.id}/commentaires`, { methode: 'POST', qui, donnees: { texte } });
    assert.equal(r.statut, 201);
  }

  assert.equal((await appel(`/api/publications?auteur=${membres.bintou.identifiant}`)).statut, 401);
  const fil = await appel(`/api/publications?auteur=${membres.bintou.identifiant}`, { qui: 'awa' });
  assert.equal(fil.statut, 200);
  assert.deepEqual(fil.corps.publications.map((p) => p.texte), ['Deuxième de Bintou', 'Première de Bintou']);

  const vue = fil.corps.publications[1];
  assert.equal(vue.nbJaime, 3);
  assert.equal(vue.jaimeParMoi, true);
  // « Aimé par » : jamais moi-même, et un ami passe avant un inconnu.
  assert.equal(vue.aimePar.identifiant, membres.cheick.identifiant);
  assert.equal(vue.nbCommentaires, 3);
  assert.deepEqual(vue.derniersCommentaires.map((c) => c.texte), ['Deux', 'Trois']); // les 2 derniers, dans l'ordre
  assert.equal(vue.derniersCommentaires[1].auteur.identifiant, membres.dao.identifiant);
  assert.equal(vue.derniersCommentaires[0].estMoi, false);
  assert.equal(vue.auteur.nbProjetsVerifies, 2);

  // Vu par Dao, qui n'a pas d'ami : quelqu'un d'autre qu'elle.
  const vueDao = (await appel(`/api/publications?auteur=${membres.bintou.identifiant}`, { qui: 'dao' })).corps.publications[1];
  assert.notEqual(vueDao.aimePar.identifiant, membres.dao.identifiant);
  assert.equal(vueDao.derniersCommentaires[1].estMoi, true);

  const inconnu = await appel('/api/publications?auteur=personne-ici', { qui: 'awa' });
  assert.deepEqual(inconnu.corps.publications, []);
});

// ---------- Profil : couverture, amis, amis en commun ----------

test('couverture : envoyer, voir sur le profil, retirer', async () => {
  assert.equal((await appel('/api/profils/moi/couverture', { methode: 'POST', donnees: { image: JPEG_1PX } })).statut, 401);
  const refus = await appel('/api/profils/moi/couverture', { methode: 'POST', qui: 'awa', donnees: { image: 'data:text/html;base64,PGI+' } });
  assert.equal(refus.statut, 400);

  const envoi = await appel('/api/profils/moi/couverture', { methode: 'POST', qui: 'awa', donnees: { image: JPEG_1PX } });
  assert.equal(envoi.statut, 201);
  assert.match(envoi.corps.couverture, /^\/fichiers\//);
  const profil = await appel(`/api/profils/${membres.awa.identifiant}`);
  assert.equal(profil.corps.profil.couverture, envoi.corps.couverture);
  assert.equal((await fetch(`${base}${envoi.corps.couverture}`)).status, 200);

  // Une nouvelle couverture remplace l'ancienne, dont le fichier est supprimé.
  const seconde = await appel('/api/profils/moi/couverture', { methode: 'POST', qui: 'awa', donnees: { image: JPEG_1PX } });
  assert.equal((await fetch(`${base}${envoi.corps.couverture}`)).status, 404);

  const retrait = await appel('/api/profils/moi/couverture', { methode: 'DELETE', qui: 'awa', donnees: {} });
  assert.equal(retrait.statut, 200);
  assert.equal((await appel(`/api/profils/${membres.awa.identifiant}`)).corps.profil.couverture, null);
  assert.equal((await fetch(`${base}${seconde.corps.couverture}`)).status, 404);
});

test('profil : amis en commun et liste des amis', async () => {
  // Bintou et Cheick ne sont pas amis, mais ont Awa en commun.
  const profil = await appel(`/api/profils/${membres.bintou.identifiant}`, { qui: 'cheick' });
  assert.equal(profil.corps.profil.amisEnCommun, 1);
  // Sans connexion, ou sur son propre profil : pas d'amis en commun.
  assert.equal((await appel(`/api/profils/${membres.bintou.identifiant}`)).corps.profil.amisEnCommun, undefined);
  assert.equal((await appel(`/api/profils/${membres.bintou.identifiant}`, { qui: 'bintou' })).corps.profil.amisEnCommun, undefined);

  assert.equal((await appel(`/api/profils/${membres.awa.identifiant}/amis`)).statut, 401);
  const amis = await appel(`/api/profils/${membres.awa.identifiant}/amis`, { qui: 'dao' });
  assert.deepEqual(amis.corps.amis.map((a) => a.identifiant).sort(), [membres.bintou.identifiant, membres.cheick.identifiant].sort());
  assert.ok(amis.corps.amis.every((a) => !('email' in a)));
});
