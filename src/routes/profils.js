// Profils : consultation publique, modification de son propre profil, photo de profil.
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db/pool');
const v = require('../utils/validation');
const { controler } = require('../utils/moderation');
const { refuserLesLiens } = require('../utils/nouveaux-comptes');
const { exigerConnexion, exigerDev } = require('../middleware/auth');
const { lireImageDataUrl } = require('../utils/images');
const { etatAmitie, apercuMembre, COLONNES_MEMBRE, NB_PROJETS_VERIFIES } = require('../utils/membres');
const { projetsDe } = require('./projets');
const { avisDe } = require('./avis');
const profilDev = require('../utils/profil-dev');
const { lireConfidentialite } = require('../utils/confidentialite');

const router = express.Router();
const MAX_COMPETENCES = 15;

// Lecture des profils : 150 par 10 minutes, par membre (ou par adresse IP pour un visiteur). Un membre connecté voit
// les numéros WhatsApp : sans limite, un seul compte pourrait recopier ceux de tout le monde.
const limiteLectureProfils = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 150,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => (req.utilisateur ? `membre-${req.utilisateur.id}` : rateLimit.ipKeyGenerator(req.ip)),
  message: { erreur: 'Tu consultes beaucoup de profils. Réessaie dans quelques minutes.' },
});

const limiteEnvoiImages = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { erreur: 'Trop d\'envois d\'images. Réessaie dans quelques minutes.' },
});

function urlFichier(id) {
  return id ? `/fichiers/${id}` : null;
}

// Ce que tout le monde peut voir d'un profil. L'email n'en fait jamais partie.
// Le numéro WhatsApp n'est montré qu'aux membres connectés, pour limiter la collecte automatique de numéros.
const JOURS_NOUVEAU = 7;
function profilVisible(u, competences, visiteur, amitie = null) {
  const estMoi = Boolean(visiteur && visiteur.id === u.id);
  const reglages = lireConfidentialite(u);
  // Qui voit le numéro : les membres connectés (par défaut), mes amis seulement, ou personne. Moi, toujours.
  const voitNumero = estMoi || (Boolean(visiteur) && (reglages.whatsapp === 'membres' || (reglages.whatsapp === 'amis' && amitie === 'amis')));
  return {
    nom: u.nom,
    prenom: u.prenom || u.nom.split(' ')[0],
    nomFamille: u.nom_famille || '', // sert au formulaire « Modifier mon profil »
    identifiant: u.identifiant,
    type: u.type,
    pays: u.pays,
    ville: u.ville,
    bio: u.bio,
    avatar: urlFichier(u.avatar),
    couverture: urlFichier(u.couverture),
    disponible: u.disponible,
    // Profil de dev : spécialité, expérience et liens (GitHub, GitLab, portfolio, LinkedIn).
    // La date de naissance, elle, n'est JAMAIS mise ici : elle ne sort pas de la base par cette route.
    specialite: u.specialite || null,
    specialiteNom: profilDev.SPECIALITES[u.specialite] || null,
    experience: u.experience || null,
    experienceNom: profilDev.EXPERIENCES[u.experience] || null,
    liens: profilDev.liensPublics(u),
    // « Profil à confirmer » : un dev qui n'a donné aucun lien vers son travail.
    aConfirmer: u.type === 'dev' && profilDev.liensPublics(u).length === 0,
    competences,
    whatsapp: voitNumero ? u.whatsapp : null,
    // « Connecte-toi pour voir le numéro » : seulement si se connecter suffit vraiment à le voir.
    whatsappMasque: !visiteur && Boolean(u.whatsapp) && reglages.whatsapp === 'membres',
    // L'onglet « Amis » : visible selon le réglage du membre (la route /amis le vérifie de son côté).
    amisVisibles: estMoi || (Boolean(visiteur) && (reglages.listeAmis === 'membres' || (reglages.listeAmis === 'amis' && amitie === 'amis'))),
    membreDepuis: u.cree_le,
    // « Nouveau sur Palabre » : un compte de moins de 7 jours. La mention n'est donnée qu'aux clients, pour qui
    // elle compte avant de confier un travail ; les comptes de démonstration ne la portent pas.
    nouveau: Boolean(visiteur && visiteur.type === 'client' && !estMoi && !/@demo\.palabre\.dev$/.test(u.email || '') && Date.now() - new Date(u.cree_le).getTime() < JOURS_NOUVEAU * 86400000),
    estMoi,
    // Lien d'amitié avec le visiteur connecté ('aucune', 'envoyee', 'recue', 'amis') ; null sinon.
    amitie,
  };
}

// Requête (texte + valeurs) qui enregistre les quatre liens d'un dev et leur date de vérification.
// Les noms de colonnes viennent de LIENS_DEV, écrit dans le code : jamais de ce qu'envoie un membre.
function requeteLiens(utilisateurId, liens, dates) {
  const valeurs = [utilisateurId];
  const morceaux = Object.entries(profilDev.LIENS_DEV).map(([cle, { colonne }]) => {
    valeurs.push(liens[cle], dates[cle]);
    return `${colonne} = $${valeurs.length - 1}, ${colonne}_verifie_le = $${valeurs.length}`;
  });
  return [`UPDATE utilisateurs SET ${morceaux.join(', ')} WHERE id = $1`, valeurs];
}

async function competencesDe(utilisateurId) {
  const { rows } = await db.query(
    `SELECT c.id, c.nom FROM utilisateur_competences uc
       JOIN competences c ON c.id = uc.competence_id
      WHERE uc.utilisateur_id = $1
      ORDER BY c.nom`,
    [utilisateurId],
  );
  return rows;
}

// Les amis d'un membre ($1), sans les comptes bloqués.
const AMIS_DE = `SELECT u.id AS ami_id FROM amities a
    JOIN utilisateurs u ON u.id = CASE WHEN a.demandeur_id = $1 THEN a.receveur_id ELSE a.demandeur_id END
   WHERE a.statut = 'acceptee' AND $1 IN (a.demandeur_id, a.receveur_id) AND u.bloque = FALSE AND u.desactive_le IS NULL`;

// Amis d'un membre (onglet « Amis » de son profil) : GET /api/profils/:identifiant/amis — membres connectés.
router.get('/:identifiant/amis', exigerConnexion, async (req, res) => {
  const moi = req.utilisateur;
  // Le réglage « Qui peut voir ma liste d'amis » : les membres, mes amis seulement, ou moi seulement.
  const { rows: [membre] } = await db.query('SELECT id, confidentialite FROM utilisateurs WHERE identifiant = $1 AND bloque = FALSE AND desactive_le IS NULL AND supprime_le IS NULL', [String(req.params.identifiant || '').toLowerCase()]);
  if (!membre) return res.status(404).json({ erreur: 'Ce profil n\'existe pas.' });
  const regle = lireConfidentialite(membre).listeAmis;
  const permis = membre.id === moi.id || regle === 'membres' || (regle === 'amis' && await etatAmitie(moi.id, membre.id) === 'amis');
  if (!permis) return res.json({ amis: [], cachee: true });
  const { rows } = await db.query(
    `SELECT ${COLONNES_MEMBRE}
       FROM utilisateurs m
       JOIN amities a ON a.statut = 'acceptee' AND m.id IN (a.demandeur_id, a.receveur_id)
       JOIN utilisateurs u ON u.id = CASE WHEN a.demandeur_id = m.id THEN a.receveur_id ELSE a.demandeur_id END
      WHERE m.identifiant = $1 AND m.bloque = FALSE AND m.desactive_le IS NULL AND u.bloque = FALSE AND u.desactive_le IS NULL
      ORDER BY u.nom
      LIMIT 200`,
    [String(req.params.identifiant || '').toLowerCase()],
  );
  res.json({ amis: rows.map(apercuMembre) });
});

// Profil public : GET /api/profils/:identifiant
router.get('/:identifiant', limiteLectureProfils, async (req, res) => {
  const identifiant = String(req.params.identifiant || '').toLowerCase();
  const { rows } = await db.query(
    `SELECT u.*, ${NB_PROJETS_VERIFIES} AS nb_projets_verifies,
            (SELECT count(*)::int FROM defis df WHERE df.gagnant_id = u.id AND df.statut = 'termine') AS nb_defis_gagnes
       FROM utilisateurs u WHERE u.identifiant = $1 AND u.bloque = FALSE AND u.desactive_le IS NULL AND u.supprime_le IS NULL`,
    [identifiant],
  );
  if (!rows[0]) return res.status(404).json({ erreur: 'Ce profil n\'existe pas.' });

  const competences = await competencesDe(rows[0].id);
  const visiteur = req.utilisateur;
  const amitie = visiteur && visiteur.id !== rows[0].id ? await etatAmitie(visiteur.id, rows[0].id) : null;
  const profil = profilVisible(rows[0], competences, visiteur, amitie);
  // Nombre d'amis (amitiés acceptées avec des comptes non bloqués) : affiché parmi les chiffres du profil.
  const { rows: [amis] } = await db.query(
    `SELECT count(*)::int AS nb FROM amities a
       JOIN utilisateurs u ON u.id = CASE WHEN a.demandeur_id = $1 THEN a.receveur_id ELSE a.demandeur_id END
      WHERE a.statut = 'acceptee' AND $1 IN (a.demandeur_id, a.receveur_id) AND u.bloque = FALSE AND u.desactive_le IS NULL`,
    [rows[0].id],
  );
  profil.nbAmis = amis.nb;
  profil.nbProjetsVerifies = rows[0].nb_projets_verifies;
  profil.nbDefisGagnes = rows[0].nb_defis_gagnes; // badge « Gagnant du défi »
  // « N amis en commun » : les membres qui sont à la fois mes amis et les siens.
  if (amitie) {
    const { rows: [commun] } = await db.query(
      `SELECT count(*)::int AS nb FROM (${AMIS_DE}) a JOIN (${AMIS_DE.replaceAll('$1', '$2')}) b USING (ami_id)`,
      [visiteur.id, rows[0].id],
    );
    profil.amisEnCommun = commun.nb;
  }
  // Le « profil prouvé » d'un dev : ses projets réalisés et les avis de ses vrais clients.
  if (rows[0].type === 'dev') {
    profil.projets = await projetsDe(rows[0].id, visiteur);
    Object.assign(profil, await avisDe(rows[0].id));
  }
  res.json({ profil });
});

// Modifier son profil : PUT /api/profils/moi
router.put('/moi', exigerConnexion, async (req, res) => {
  const corps = req.body || {};
  const moi = req.utilisateur;
  const donnees = {
    prenom: v.nomPropre(corps.prenom, 'prenom'),
    nomFamille: v.nomPropre(corps.nomFamille, 'nomFamille'),
    identifiant: v.identifiant(corps.identifiant),
    pays: v.pays(corps.pays),
    ville: v.texte(corps.ville, 'ville', { min: 2, max: 60 }),
    whatsapp: v.whatsapp(corps.whatsapp),
    bio: v.texte(corps.bio, 'bio', { max: 500, optionnel: true }),
    disponible: corps.disponible !== false,
  };
  // La présentation et la ville passent par le filtre automatique (src/utils/moderation.js).
  await controler(req, [[donnees.bio, 'bio'], [donnees.ville, 'ville']], { mode: 'strict' });
  refuserLesLiens(req.utilisateur, [[donnees.bio, 'bio']]); // pas de lien dans la présentation pendant 3 jours

  // Spécialité, expérience et liens : seulement pour un dev, et seulement si le formulaire les envoie
  // (sinon on garde ce qui est en base). Les liens modifiés sont revisités ; les autres gardent leur badge.
  const dev = { specialite: moi.specialite, experience: moi.experience, liens: null, dates: null };
  if (moi.type === 'dev') {
    if (corps.specialite !== undefined) dev.specialite = v.parmi(corps.specialite, Object.keys(profilDev.SPECIALITES), 'specialite');
    if (corps.experience !== undefined) dev.experience = v.parmi(corps.experience, Object.keys(profilDev.EXPERIENCES), 'experience');
    if (corps.liens !== undefined) {
      dev.liens = profilDev.liensSaisis(corps.liens);
      dev.dates = await profilDev.verifierLiens(dev.liens, moi);
    }
  }

  // Les compétences ne concernent que les développeurs.
  let competences = [];
  if (moi.type === 'dev') {
    const ids = Array.isArray(corps.competences) ? corps.competences : [];
    competences = [...new Set(ids.map(Number).filter(Number.isInteger))];
    if (competences.length > MAX_COMPETENCES) {
      throw new v.ErreurValidation(`${MAX_COMPETENCES} compétences au maximum.`, 'competences');
    }
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE utilisateurs
          SET nom = $1, identifiant = $2, pays = $3, ville = $4, whatsapp = $5, bio = $6, disponible = $7,
              prenom = $9, nom_famille = $10, specialite = $11, experience = $12
        WHERE id = $8`,
      // Le nom affiché (« Prénom Nom ») est recalculé en même temps que les deux champs.
      [`${donnees.prenom} ${donnees.nomFamille}`, donnees.identifiant, donnees.pays, donnees.ville, donnees.whatsapp, donnees.bio, donnees.disponible, moi.id, donnees.prenom, donnees.nomFamille, dev.specialite, dev.experience],
    );
    if (dev.liens) await client.query(...requeteLiens(moi.id, dev.liens, dev.dates));
    await client.query('DELETE FROM utilisateur_competences WHERE utilisateur_id = $1', [moi.id]);
    if (competences.length) {
      // Seuls les identifiants qui existent vraiment dans la table competences sont gardés.
      await client.query(
        `INSERT INTO utilisateur_competences (utilisateur_id, competence_id)
         SELECT $1, id FROM competences WHERE id = ANY($2::int[])`,
        [moi.id, competences],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505' && String(err.constraint).includes('identifiant')) {
      throw new v.ErreurValidation('Cet identifiant est déjà pris. Choisis-en un autre.', 'identifiant');
    }
    throw err;
  } finally {
    client.release();
  }

  const { rows } = await db.query('SELECT * FROM utilisateurs WHERE id = $1', [moi.id]);
  res.json({ profil: profilVisible(rows[0], await competencesDe(moi.id), moi) });
});

// Page 2 de l'inscription des devs, « Ton profil de dev » : PUT /api/profils/moi/profil-dev
// { dateNaissance, specialite, experience, liens: { github, gitlab, portfolio, linkedin }, sansLien, whatsapp, bio }
// Le son à l'arrivée d'un message : PUT /api/profils/moi/son-messages  { actif }
// Gardé côté serveur (dans les réglages de notifications du membre) : il le retrouve sur tous ses appareils.
router.put('/moi/son-messages', exigerConnexion, async (req, res) => {
  if (typeof req.body?.actif !== 'boolean') throw new v.ErreurValidation('Choix illisible.', 'actif');
  await db.query(
    `UPDATE utilisateurs SET preferences_notifications = jsonb_set(preferences_notifications, '{sonMessages}', $2::jsonb) WHERE id = $1`,
    [req.utilisateur.id, JSON.stringify(req.body.actif)],
  );
  res.json({ sonMessages: req.body.actif });
});

// Montrer ou cacher son statut « en ligne » : PUT /api/profils/moi/presence  { masquer }
// Qui le cache ne voit pas non plus celui des autres (src/utils/presence.js).
router.put('/moi/presence', exigerConnexion, async (req, res) => {
  if (typeof req.body?.masquer !== 'boolean') throw new v.ErreurValidation('Choix illisible.', 'masquer');
  await db.query('UPDATE utilisateurs SET masquer_presence = $2 WHERE id = $1', [req.utilisateur.id, req.body.masquer]);
  res.json({ presenceMasquee: req.body.masquer });
});

router.put('/moi/profil-dev', exigerConnexion, exigerDev, async (req, res) => {
  const corps = req.body || {};
  const moi = req.utilisateur;
  const donnees = {
    dateNaissance: profilDev.dateNaissance(corps.dateNaissance),
    specialite: v.parmi(corps.specialite, Object.keys(profilDev.SPECIALITES), 'specialite'),
    experience: v.parmi(corps.experience, Object.keys(profilDev.EXPERIENCES), 'experience'),
    liens: profilDev.liensSaisis(corps.liens),
    whatsapp: v.whatsapp(corps.whatsapp),
    bio: v.texte(corps.bio, 'bio', { min: 20, max: 300 }),
  };
  await controler(req, [[donnees.bio, 'bio']], { mode: 'strict' });
  refuserLesLiens(req.utilisateur, [[donnees.bio, 'bio']]);
  // Au moins un lien, sauf si le dev coche « Je n'ai pas encore de lien » (son profil sera « à confirmer »).
  const aUnLien = Object.values(donnees.liens).some(Boolean);
  if (!aUnLien && corps.sansLien !== true) {
    throw new v.ErreurValidation('Ajoute au moins un lien, ou coche « Je n\'ai pas encore de lien ».', 'liens');
  }
  // Le serveur visite chaque lien (adresses internes refusées, voir utils/liens.js) : un lien qui répond est « vérifié ».
  const dates = await profilDev.verifierLiens(donnees.liens, moi);

  await db.transaction(async (client) => {
    await client.query(
      `UPDATE utilisateurs
          SET date_naissance = $2, specialite = $3, experience = $4, whatsapp = $5, bio = $6,
              profil_complete_le = COALESCE(profil_complete_le, now())
        WHERE id = $1`,
      [moi.id, donnees.dateNaissance, donnees.specialite, donnees.experience, donnees.whatsapp, donnees.bio],
    );
    await client.query(...requeteLiens(moi.id, donnees.liens, dates));
  });

  const { rows } = await db.query('SELECT * FROM utilisateurs WHERE id = $1', [moi.id]);
  res.json({ profil: profilVisible(rows[0], await competencesDe(moi.id), rows[0]) });
});

// Changer sa photo : POST /api/profils/moi/avatar  { image: "data:image/jpeg;base64,..." }
router.post('/moi/avatar', exigerConnexion, limiteEnvoiImages, async (req, res) => {
  const image = lireImageDataUrl(req.body?.image);
  const moi = req.utilisateur;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO fichiers (proprietaire_id, type_mime, taille, donnees)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [moi.id, image.typeMime, image.donnees.length, image.donnees],
    );
    await client.query('UPDATE utilisateurs SET avatar = $1 WHERE id = $2', [rows[0].id, moi.id]);
    if (moi.avatar) {
      await client.query('DELETE FROM fichiers WHERE id = $1 AND proprietaire_id = $2', [moi.avatar, moi.id]);
    }
    await client.query('COMMIT');
    res.status(201).json({ avatar: urlFichier(rows[0].id) });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// Changer sa photo de couverture : POST /api/profils/moi/couverture  { image: "data:image/jpeg;base64,..." }
// Même principe que la photo de profil : le navigateur réduit l'image (1200 px de large), le serveur la revérifie.
router.post('/moi/couverture', exigerConnexion, limiteEnvoiImages, async (req, res) => {
  const image = lireImageDataUrl(req.body?.image);
  const moi = req.utilisateur;
  const id = await db.transaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO fichiers (proprietaire_id, type_mime, taille, donnees)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [moi.id, image.typeMime, image.donnees.length, image.donnees],
    );
    await client.query('UPDATE utilisateurs SET couverture = $1 WHERE id = $2', [rows[0].id, moi.id]);
    if (moi.couverture) {
      await client.query('DELETE FROM fichiers WHERE id = $1 AND proprietaire_id = $2', [moi.couverture, moi.id]);
    }
    return rows[0].id;
  });
  res.status(201).json({ couverture: urlFichier(id) });
});

// Retirer sa couverture : DELETE /api/profils/moi/couverture (le motif tissé revient).
router.delete('/moi/couverture', exigerConnexion, async (req, res) => {
  const moi = req.utilisateur;
  await db.transaction(async (client) => {
    await client.query('UPDATE utilisateurs SET couverture = NULL WHERE id = $1', [moi.id]);
    if (moi.couverture) {
      await client.query('DELETE FROM fichiers WHERE id = $1 AND proprietaire_id = $2', [moi.couverture, moi.id]);
    }
  });
  res.json({ couverture: null });
});

// Retirer sa photo : DELETE /api/profils/moi/avatar
router.delete('/moi/avatar', exigerConnexion, async (req, res) => {
  const moi = req.utilisateur;
  await db.query('UPDATE utilisateurs SET avatar = NULL WHERE id = $1', [moi.id]);
  if (moi.avatar) {
    await db.query('DELETE FROM fichiers WHERE id = $1 AND proprietaire_id = $2', [moi.avatar, moi.id]);
  }
  res.json({ avatar: null });
});

module.exports = router;
