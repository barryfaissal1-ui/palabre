// Inscription, connexion, déconnexion, mot de passe oublié.
const express = require('express');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db/pool');
const config = require('../config');
const v = require('../utils/validation');
const mailer = require('../utils/mailer'); // appelé par « mailer.envoyerEmail » : les tests peuvent le remplacer
const { emailMotDePasse, emailEssaisConnexion } = require('../utils/gabarit-email');
const { ouvrirSession, fermerSession, exigerConnexion, profilDevIncomplet } = require('../middleware/auth');
const { jetonOuverture, verifierOuverture, envoyerCode, confirmerCode } = require('../utils/inscription');
const { liensPublics } = require('../utils/profil-dev');
const { compterNonLus } = require('./messages');
const { langueDe } = require('../utils/langue');
const sessions = require('../utils/sessions');
const { lireAppareil, assurerAppareil, etatAppareil, noterAppareil, oublierAppareils } = require('../utils/appareils');
const deuxEtapes = require('../utils/deux-etapes');
const { journaliser } = require('../utils/journal');
const { VERSION_REGLES, reglesAAccepter } = require('../utils/regles');

const { typeAppareil } = sessions;

const router = express.Router();
const COUT_BCRYPT = 12;
const DUREE_JETON_MIN = 60;
// Verrou par compte : 10 mots de passe faux en 15 minutes ferment la connexion à ce compte pendant 15 minutes.
const MAX_ECHECS = 10;
const DUREE_VERROU_MIN = 15;
// Hash factice : on compare quand même quand l'email n'existe pas, pour ne pas révéler les comptes par le temps de réponse.
const HASH_FACTICE = bcrypt.hashSync('mot-de-passe-factice', COUT_BCRYPT);

// Limite les tentatives pour freiner les attaques par force brute.
const limiteSensible = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { erreur: 'Trop de tentatives. Réessaie dans quelques minutes.' },
});

// La saisie du code a sa propre limite par adresse IP, en plus des 5 essais permis par code.
const limiteCodes = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { erreur: 'Trop de tentatives. Réessaie dans quelques minutes.' },
});

// Profil complet du membre connecté (avec son email) : n'est envoyé qu'à lui-même.
function profilPrive(u) {
  return {
    presenceMasquee: Boolean(u.masquer_presence),
    // Le petit son à l'arrivée d'un message : activé tant que le membre ne l'a pas coupé dans son profil.
    sonMessages: (u.preferences_notifications || {}).sonMessages !== false,
    langue: u.langue || null, // 'fr', 'en', ou rien tant que le membre n'a pas choisi
    // Compte désactivé : la page l'envoie sur /bon-retour. La date n'est remplie que si la suppression est demandée.
    desactive: Boolean(u.desactive_le),
    // Les règles ont changé depuis son acceptation : la page ouvre la fenêtre « Les règles ont changé ».
    reglesAAccepter: reglesAAccepter(u),
    // Suspension en cours (sanction) : la page affiche le bandeau « lecture seule » avec la date de fin.
    suspenduJusquA: u.suspendu_jusqu_a && new Date(u.suspendu_jusqu_a).getTime() > Date.now() ? u.suspendu_jusqu_a : null,
    suppressionPrevueLe: u.suppression_prevue_le || null,

    id: u.id,
    type: u.type,
    estAdmin: u.est_admin,
    nom: u.nom, // le nom affiché : « Prénom Nom »
    prenom: u.prenom,
    nomFamille: u.nom_famille,
    identifiant: u.identifiant,
    email: u.email,
    pays: u.pays,
    ville: u.ville,
    whatsapp: u.whatsapp,
    bio: u.bio,
    avatar: u.avatar ? `/fichiers/${u.avatar}` : null,
    disponible: u.disponible,
    // Les deux étapes de l'inscription : le site s'en sert pour envoyer vers /confirmer-email ou afficher le bandeau.
    emailConfirme: Boolean(u.email_confirme_le),
    profilComplet: !profilDevIncomplet(u), // toujours vrai pour un client : il n'a pas de page 2
    specialite: u.specialite || null,
    experience: u.experience || null,
    liens: liensPublics(u),
  };
}

async function identifiantLibre(nom) {
  let base = v.versIdentifiant(nom).padEnd(3, '0');
  if (v.IDENTIFIANTS_RESERVES.has(base)) base = `${base}-dev`;
  for (let i = 0; i < 50; i += 1) {
    const candidat = i === 0 ? base : `${base}-${i + 1}`;
    const { rowCount } = await db.query('SELECT 1 FROM utilisateurs WHERE identifiant = $1', [candidat]);
    if (rowCount === 0) return candidat;
  }
  return `${base}-${crypto.randomInt(1000, 9999)}`;
}

// Heure d'ouverture du formulaire, signée : GET /api/auth/jeton-inscription (demandée par la page à son ouverture).
router.get('/jeton-inscription', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ jeton: jetonOuverture() });
});

router.post('/inscription', limiteSensible, async (req, res) => {
  const corps = req.body || {};
  // Champ piège : invisible pour une personne, mais un robot qui remplit tous les champs le remplit aussi.
  // La réponse reste vague, pour ne pas lui expliquer ce qui l'a trahi.
  if (corps.siteWeb !== undefined && corps.siteWeb !== '') {
    throw new v.ErreurValidation('Inscription impossible pour le moment. Réessaie plus tard.');
  }
  // Formulaire envoyé moins de 3 secondes après l'ouverture de la page : ce n'est pas une personne.
  verifierOuverture(corps.jeton);
  // La case « J'accepte les règles de la communauté et les conditions d'utilisation » : obligatoire, et vérifiée
  // ici (la case de la page pourrait être contournée). Seule la valeur « vrai » compte.
  if (corps.accepteRegles !== true) {
    throw new v.ErreurValidation('Pour créer un compte, accepte les règles de la communauté et les conditions d\'utilisation.', 'accepteRegles');
  }
  const donnees = {
    type: v.typeCompte(corps.type),
    prenom: v.nomPropre(corps.prenom, 'prenom'),
    nomFamille: v.nomPropre(corps.nomFamille, 'nomFamille'),
    email: v.email(corps.email),
    motDePasse: v.motDePasse(corps.motDePasse, 'motDePasse', [corps.prenom, corps.nomFamille]),
    pays: v.pays(corps.pays),
    ville: v.texte(corps.ville, 'ville', { min: 2, max: 60 }),
    // Le dev donne son numéro à l'étape 2 (« Ton profil de dev ») ; le client, ici.
    whatsapp: corps.type === 'client' ? v.whatsapp(corps.whatsapp) : null,
  };

  const existe = await db.query('SELECT 1 FROM utilisateurs WHERE email = $1', [donnees.email]);
  if (existe.rowCount > 0) {
    throw new v.ErreurValidation('Un compte existe déjà avec cet email.', 'email');
  }

  const hash = await bcrypt.hash(donnees.motDePasse, COUT_BCRYPT);
  // Le nom affiché partout sur le site : « Prénom Nom ». Il est gardé dans sa propre colonne, recalculée ici.
  const nom = `${donnees.prenom} ${donnees.nomFamille}`;
  const identifiant = await identifiantLibre(nom);
  const { rows } = await db.query(
    // La langue du site au moment de l'inscription est gardée : le code de confirmation part dans cette langue.
    // regles_acceptees_le, regles_version : la preuve de l'acceptation, avec la version des règles lue ce jour-là.
    `INSERT INTO utilisateurs (type, nom, prenom, nom_famille, identifiant, email, mot_de_passe_hash, pays, ville, whatsapp, langue, regles_acceptees_le, regles_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), $12)
     RETURNING *`,
    [donnees.type, nom, donnees.prenom, donnees.nomFamille, identifiant, donnees.email, hash, donnees.pays, donnees.ville, donnees.whatsapp, langueDe(req), VERSION_REGLES],
  );

  // Le compte existe, mais il ne sert à rien tant que le code envoyé par email n'a pas été saisi.
  try {
    await envoyerCode(rows[0]);
  } catch (err) {
    console.error('Envoi du code de confirmation impossible :', err.message); // « Renvoyer le code » reste possible
  }
  await ouvrirSession(req, res, rows[0]);
  // L'appareil de l'inscription est connu : s'y reconnecter ne déclenchera pas d'alerte.
  await noterAppareil(rows[0].id, assurerAppareil(req, res));
  res.status(201).json({ utilisateur: profilPrive(rows[0]) });
});

// Saisir le code reçu par email : POST /api/auth/confirmer-email  { code }
router.post('/confirmer-email', exigerConnexion, limiteCodes, async (req, res) => {
  const moi = req.utilisateur;
  if (!moi.email_confirme_le) {
    const { erreur } = await confirmerCode(moi, req.body?.code);
    if (erreur) return res.status(400).json({ erreur, champ: 'code' });
  }
  res.json({ ok: true, profilComplet: !profilDevIncomplet(moi) });
});

// Bouton « Renvoyer le code » : POST /api/auth/renvoyer-code (1 par minute, 5 par heure)
router.post('/renvoyer-code', exigerConnexion, async (req, res) => {
  if (req.utilisateur.email_confirme_le) throw new v.ErreurValidation('Ton email est déjà confirmé.');
  await envoyerCode(req.utilisateur, { renvoi: true });
  res.json({ message: 'Un nouveau code vient de partir. Regarde ta boîte de réception.' });
});

router.post('/connexion', limiteSensible, async (req, res) => {
  const corps = req.body || {};
  const email = v.email(corps.email);
  const motDePasse = typeof corps.motDePasse === 'string' ? corps.motDePasse : '';

  const { rows } = await db.query('SELECT * FROM utilisateurs WHERE email = $1', [email]);
  const utilisateur = rows[0];
  const valide = await bcrypt.compare(motDePasse, utilisateur?.mot_de_passe_hash || HASH_FACTICE);
  // Trop de mots de passe faux pour CE compte : la connexion est fermée pendant 15 minutes, même avec le bon mot de
  // passe. La réponse est exactement celle d'un mot de passe faux : on ne dit ni que le compte existe, ni qu'il est
  // verrouillé (c'est le propriétaire qui est prévenu, par email).
  const verrouille = Boolean(utilisateur && utilisateur.connexion_bloquee_jusqu_a && utilisateur.connexion_bloquee_jusqu_a > new Date());

  if (!utilisateur || !valide || verrouille) {
    if (utilisateur && !valide && !verrouille) await noterEchec(utilisateur, req);
    return res.status(401).json({ erreur: 'Email ou mot de passe incorrect.' });
  }
  if (utilisateur.echecs_connexion > 0 || utilisateur.connexion_bloquee_jusqu_a) {
    await db.query('UPDATE utilisateurs SET echecs_connexion = 0, echecs_depuis = NULL, connexion_bloquee_jusqu_a = NULL WHERE id = $1', [utilisateur.id]);
  }
  if (utilisateur.bloque) {
    return res.status(403).json({ erreur: 'Ce compte a été suspendu. Contacte l\'équipe Palabre.' });
  }

  // Verrou posé par « Ce n'était pas moi » : seul un nouveau mot de passe (lien reçu par email) rouvre le compte.
  if (utilisateur.verrouille_le) {
    return res.status(403).json({ erreur: 'Ce compte est verrouillé par sécurité. Choisis un nouveau mot de passe pour le rouvrir.', suite: '/mot-de-passe-oublie' });
  }

  // Validation en deux étapes : depuis un appareil qui n'est pas « de confiance », le bon mot de passe ne suffit pas.
  // Aucune session n'est ouverte : un code part par email, et le navigateur garde un cookie d'attente de 15 minutes.
  const etat = await etatAppareil(utilisateur.id, lireAppareil(req));
  if (utilisateur.deux_etapes && !etat.confiance) {
    await envoyerCode(utilisateur, { motif: 'connexion' });
    deuxEtapes.poserAttente(res, utilisateur.id);
    return res.json({ deuxEtapes: true });
  }
  await terminerConnexion(req, res, utilisateur, etat);
  res.json({ utilisateur: profilPrive(utilisateur) });
});

// Un mot de passe faux pour un compte qui existe. Le compteur repart de 1 si le premier échec date de plus de
// 15 minutes. Au dixième : verrou de 15 minutes et email au propriétaire. Une seule requête fait le compte, pour
// que dix essais envoyés au même instant soient bien comptés dix fois.
async function noterEchec(utilisateur, req) {
  const { rows: [compte] } = await db.query(
    `UPDATE utilisateurs
        SET echecs_connexion = CASE WHEN echecs_depuis IS NULL OR echecs_depuis < now() - make_interval(mins => $2) THEN 1 ELSE echecs_connexion + 1 END,
            echecs_depuis = CASE WHEN echecs_depuis IS NULL OR echecs_depuis < now() - make_interval(mins => $2) THEN now() ELSE echecs_depuis END
      WHERE id = $1 RETURNING echecs_connexion`,
    [utilisateur.id, DUREE_VERROU_MIN],
  );
  await journaliser(utilisateur.id, 'connexion_refusee', req);
  if (compte.echecs_connexion < MAX_ECHECS) return;
  await db.query('UPDATE utilisateurs SET connexion_bloquee_jusqu_a = now() + make_interval(mins => $2), echecs_connexion = 0, echecs_depuis = NULL WHERE id = $1', [utilisateur.id, DUREE_VERROU_MIN]);
  if (!utilisateur.email_confirme_le || utilisateur.bloque || utilisateur.supprime_le) return;
  try {
    await mailer.envoyerEmail({
      a: utilisateur.email,
      ...emailEssaisConnexion({ prenom: utilisateur.prenom || utilisateur.nom, essais: MAX_ECHECS, dureeMin: DUREE_VERROU_MIN, lien: `${config.urlPublique}/mot-de-passe-oublie`, langue: utilisateur.langue || langueDe(req) }),
    });
  } catch (err) {
    console.error('Email « essais de connexion » impossible :', err.message);
  }
}

// Le mot de passe est bon (et le code, s'il en fallait un) : la session s'ouvre sur cet appareil.
async function terminerConnexion(req, res, utilisateur, etat, { confiance = false } = {}) {
  // Dernière connexion (rubrique « Sécurité » des paramètres) : la date et le type d'appareil, jamais l'adresse IP.
  await db.query('UPDATE utilisateurs SET derniere_connexion_le = now(), derniere_connexion_appareil = $2 WHERE id = $1', [utilisateur.id, typeAppareil(req.get('user-agent'))]);
  const sessionId = await ouvrirSession(req, res, utilisateur);
  await noterAppareil(utilisateur.id, assurerAppareil(req, res), { confiance });
  await journaliser(utilisateur.id, etat.connu ? 'connexion' : 'nouvel_appareil', req);
  // Appareil inconnu : le propriétaire du compte est prévenu par email, avec un bouton « Ce n'était pas moi ».
  // Un email qui ne part pas ne doit pas empêcher la connexion.
  if (!etat.connu && utilisateur.email_confirme_le) {
    try {
      await deuxEtapes.alerterNouvelleConnexion(utilisateur, req, sessionId);
    } catch (err) {
      console.error('Alerte de nouvelle connexion impossible :', err.message);
    }
  }
}

// ---------- Validation en deux étapes : la suite de la connexion ----------

// Le membre qui a donné le bon mot de passe et attend son code (cookie d'attente), ou rien.
async function membreEnAttente(req) {
  const id = deuxEtapes.lireAttente(req);
  if (!id) return null;
  const { rows } = await db.query('SELECT * FROM utilisateurs WHERE id = $1 AND bloque = FALSE AND supprime_le IS NULL AND verrouille_le IS NULL AND deux_etapes = TRUE', [id]);
  return rows[0] || null;
}

// La page du code demande à qui le code a été envoyé : GET /api/auth/deux-etapes → { email: « a•••@gmail.com » }
router.get('/deux-etapes', async (req, res) => {
  const membre = await membreEnAttente(req);
  if (!membre) return res.status(401).json({ erreur: 'Connecte-toi pour continuer.' });
  res.set('Cache-Control', 'no-store').json({ email: deuxEtapes.masquerEmail(membre.email) });
});

// Saisir le code : POST /api/auth/deux-etapes  { code, confiance? }  ou  { secours, confiance? }
router.post('/deux-etapes', limiteCodes, async (req, res) => {
  const membre = await membreEnAttente(req);
  if (!membre) return res.status(401).json({ erreur: 'Connecte-toi pour continuer.' });
  const corps = req.body || {};
  const parSecours = corps.secours !== undefined;
  const { erreur } = parSecours ? await deuxEtapes.utiliserCodeSecours(membre, corps.secours) : await confirmerCode(membre, corps.code, { motif: 'connexion' });
  if (erreur) return res.status(400).json({ erreur, champ: parSecours ? 'secours' : 'code' });
  const etat = await etatAppareil(membre.id, lireAppareil(req));
  // « Faire confiance à cet appareil » : la prochaine connexion d'ici ne demandera pas de code.
  await terminerConnexion(req, res, membre, etat, { confiance: corps.confiance === true });
  deuxEtapes.effacerAttente(res);
  res.json({ ok: true, profilComplet: !profilDevIncomplet(membre), utilisateur: profilPrive(membre) });
});

// « Renvoyer le code » : POST /api/auth/deux-etapes/renvoyer (1 par minute, 5 par heure)
router.post('/deux-etapes/renvoyer', limiteCodes, async (req, res) => {
  const membre = await membreEnAttente(req);
  if (!membre) return res.status(401).json({ erreur: 'Connecte-toi pour continuer.' });
  await envoyerCode(membre, { renvoi: true, motif: 'connexion' });
  res.json({ message: 'Un nouveau code vient de partir. Regarde ta boîte de réception.' });
});

// Renoncer : POST /api/auth/deux-etapes/annuler
router.post('/deux-etapes/annuler', (req, res) => {
  deuxEtapes.effacerAttente(res);
  res.json({ ok: true });
});

// ---------- « Ce n'était pas moi » : le bouton de l'email d'alerte ----------
// POST /api/auth/pas-moi  { jeton }
// Le lien de l'email ouvre une page ; c'est le bouton de cette page qui appelle cette route (jamais l'ouverture du
// lien : certaines messageries ouvrent les liens toutes seules pour les contrôler).
// Tous les appareils sont déconnectés, le compte est verrouillé, et la réponse donne un lien pour choisir un nouveau
// mot de passe : avoir reçu l'email prouve que la boîte est bien celle du membre.
router.post('/pas-moi', limiteSensible, async (req, res) => {
  const jeton = typeof req.body?.jeton === 'string' ? req.body.jeton : '';
  const nouveau = await db.transaction(async (client) => {
    const { rows: [alerte] } = await client.query(
      'UPDATE alertes_connexion SET utilise_le = now() WHERE jeton_hash = $1 AND utilise_le IS NULL AND expire_le > now() RETURNING utilisateur_id',
      [deuxEtapes.hacher(jeton)],
    );
    if (!alerte) return null;
    const id = alerte.utilisateur_id;
    await sessions.revoquerToutes(id, {}, client);
    await journaliser(id, 'session_revoquee', req, { appareil: null }, client);
    await client.query('UPDATE utilisateurs SET verrouille_le = now(), sessions_depuis = now() WHERE id = $1', [id]);
    // L'appareil de l'intrus est devenu « connu » en se connectant : tous les appareils redeviennent inconnus.
    await oublierAppareils(id, client);
    await client.query('DELETE FROM confirmations_email WHERE utilisateur_id = $1 AND motif = \'connexion\'', [id]);
    await client.query('UPDATE alertes_connexion SET utilise_le = now() WHERE utilisateur_id = $1 AND utilise_le IS NULL', [id]);
    const jetonMdp = crypto.randomBytes(32).toString('hex');
    await client.query(
      'INSERT INTO reinitialisations_mdp (utilisateur_id, jeton_hash, expire_le) VALUES ($1, $2, now() + make_interval(mins => $3))',
      [id, crypto.createHash('sha256').update(jetonMdp).digest('hex'), DUREE_JETON_MIN],
    );
    return jetonMdp;
  });
  if (!nouveau) return res.status(400).json({ erreur: 'Ce lien n\'est plus valable. Si tu as un doute, change ton mot de passe.' });
  res.set('Cache-Control', 'no-store').json({ message: 'Ton compte est protégé : tous les appareils sont déconnectés. Choisis maintenant un nouveau mot de passe.', suite: `/reinitialiser?jeton=${nouveau}` });
});

// Se déconnecter : la session est révoquée en base (une copie du cookie ne vaut plus rien), puis le cookie effacé.
router.post('/deconnexion', async (req, res) => {
  if (req.session) await sessions.revoquer(req.session.id);
  fermerSession(res);
  res.json({ ok: true });
});

// Accepter les règles de la communauté (fenêtre « Les règles ont changé ») : POST /api/auth/regles  { accepte: true }
router.post('/regles', exigerConnexion, async (req, res) => {
  if (req.body?.accepte !== true) throw new v.ErreurValidation('Pour continuer, accepte les règles de la communauté.', 'accepte');
  await db.query('UPDATE utilisateurs SET regles_acceptees_le = now(), regles_version = $2 WHERE id = $1', [req.utilisateur.id, VERSION_REGLES]);
  res.json({ ok: true, version: VERSION_REGLES });
});

// ---------- Revenir : réactiver un compte désactivé, annuler une suppression ----------

// La page /bon-retour : POST /api/auth/reactiver  (il faut être connecté : s'être reconnecté prouve que c'est bien lui)
// Le compte redevient visible tout de suite ; une suppression demandée est annulée du même coup.
router.post('/reactiver', exigerConnexion, async (req, res) => {
  const moi = req.utilisateur;
  if (moi.desactive_le || moi.suppression_prevue_le) {
    await db.transaction(async (client) => {
      await client.query('UPDATE utilisateurs SET desactive_le = NULL, suppression_prevue_le = NULL WHERE id = $1', [moi.id]);
      await client.query('DELETE FROM annulations_suppression WHERE utilisateur_id = $1', [moi.id]);
      await journaliser(moi.id, 'compte_reactive', req, {}, client);
    });
  }
  res.json({ ok: true, profilComplet: !profilDevIncomplet(moi) });
});

// Le bouton « Annuler la suppression » de l'email : POST /api/auth/annuler-suppression  { jeton }
// Comme pour « Ce n'était pas moi », c'est le bouton de la page qui agit, jamais l'ouverture du lien.
// La suppression est annulée et le compte réactivé ; il reste à se connecter.
router.post('/annuler-suppression', limiteSensible, async (req, res) => {
  const jeton = typeof req.body?.jeton === 'string' ? req.body.jeton : '';
  const annule = await db.transaction(async (client) => {
    const { rows: [ligne] } = await client.query('DELETE FROM annulations_suppression WHERE jeton_hash = $1 RETURNING utilisateur_id', [deuxEtapes.hacher(jeton)]);
    if (!ligne) return false;
    const { rowCount } = await client.query('UPDATE utilisateurs SET desactive_le = NULL, suppression_prevue_le = NULL WHERE id = $1 AND supprime_le IS NULL', [ligne.utilisateur_id]);
    if (rowCount) await journaliser(ligne.utilisateur_id, 'compte_reactive', req, {}, client);
    return rowCount > 0;
  });
  if (!annule) return res.status(400).json({ erreur: 'Ce lien n\'est plus valable. Connecte-toi pour retrouver ton compte.' });
  res.json({ message: 'Suppression annulée. Ton compte est de nouveau actif : tu peux te connecter.', suite: '/connexion' });
});

// Renvoie le membre connecté, ou null pour un visiteur (pas d'erreur : c'est un cas normal).
router.get('/moi', async (req, res) => {
  if (!req.utilisateur) return res.json({ utilisateur: null });
  // Compteurs du menu : demandes d'amis à traiter et notifications non lues (la cloche).
  const { rows } = await db.query(
    `SELECT (SELECT count(*)::int FROM amities a
               JOIN utilisateurs u ON u.id = a.demandeur_id
              WHERE a.receveur_id = $1 AND a.statut = 'en_attente' AND u.bloque = FALSE AND u.desactive_le IS NULL) AS demandes_amis,
            (SELECT count(*)::int FROM notifications n
              WHERE n.utilisateur_id = $1 AND n.lue = FALSE) AS notifications,
            (SELECT count(*)::int FROM projets pv
              WHERE pv.dev_id = $1 AND pv.masque = FALSE AND pv.lien IS NOT NULL AND pv.lien_verifie_le IS NOT NULL) AS nb_projets_verifies`,
    [req.utilisateur.id],
  );
  res.json({
    utilisateur: { ...profilPrive(req.utilisateur), demandesAmis: rows[0].demandes_amis, notifications: rows[0].notifications, nbProjetsVerifies: rows[0].nb_projets_verifies, messagesNonLus: await compterNonLus(req.utilisateur.id) },
  });
});

// Toujours la même réponse, que l'email existe ou non (on ne révèle pas qui est inscrit).
router.post('/mot-de-passe-oublie', limiteSensible, async (req, res) => {
  const email = v.email(req.body?.email);
  const { rows } = await db.query('SELECT id, nom, prenom, langue FROM utilisateurs WHERE email = $1 AND bloque = FALSE AND supprime_le IS NULL', [email]);

  if (rows[0]) {
    const jeton = crypto.randomBytes(32).toString('hex');
    const jetonHash = crypto.createHash('sha256').update(jeton).digest('hex');
    await db.query(
      `INSERT INTO reinitialisations_mdp (utilisateur_id, jeton_hash, expire_le)
       VALUES ($1, $2, now() + make_interval(mins => $3))`,
      [rows[0].id, jetonHash, DUREE_JETON_MIN],
    );
    const lien = `${config.urlPublique}/reinitialiser?jeton=${jeton}`;
    await mailer.envoyerEmail({ a: email, ...emailMotDePasse({ prenom: rows[0].prenom || rows[0].nom, lien, dureeMin: DUREE_JETON_MIN, langue: rows[0].langue || langueDe(req) }) });
  }

  res.json({ message: 'Si un compte existe avec cet email, un lien de réinitialisation vient d\'être envoyé.' });
});

router.post('/reinitialiser', limiteSensible, async (req, res) => {
  const jeton = typeof req.body?.jeton === 'string' ? req.body.jeton : '';
  v.motDePasse(req.body?.motDePasse); // longueur et mots courants d'abord, sans rien lire en base
  const jetonHash = crypto.createHash('sha256').update(jeton).digest('hex');

  const { rows } = await db.query(
    `SELECT r.id, r.utilisateur_id, u.prenom, u.nom_famille, u.identifiant FROM reinitialisations_mdp r
       JOIN utilisateurs u ON u.id = r.utilisateur_id
      WHERE r.jeton_hash = $1 AND r.utilise_le IS NULL AND r.expire_le > now()`,
    [jetonHash],
  );
  if (!rows[0]) {
    return res.status(400).json({ erreur: 'Ce lien n\'est plus valable. Fais une nouvelle demande.' });
  }
  const motDePasse = v.motDePasse(req.body?.motDePasse, 'motDePasse', [rows[0].prenom, rows[0].nom_famille, rows[0].identifiant]);

  const hash = await bcrypt.hash(motDePasse, COUT_BCRYPT);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    // Avoir reçu ce lien prouve que la boîte email est bien la sienne : l'email est confirmé du même coup.
    await client.query(
      'UPDATE utilisateurs SET mot_de_passe_hash = $1, email_confirme_le = COALESCE(email_confirme_le, now()), sessions_depuis = now(), verrouille_le = NULL, echecs_connexion = 0, echecs_depuis = NULL, connexion_bloquee_jusqu_a = NULL WHERE id = $2',
      [hash, rows[0].utilisateur_id],
    );
    await client.query('UPDATE reinitialisations_mdp SET utilise_le = now() WHERE utilisateur_id = $1 AND utilise_le IS NULL', [rows[0].utilisateur_id]);
    // Tous les appareils sont déconnectés : celui qui connaissait l'ancien mot de passe aussi.
    await sessions.revoquerToutes(rows[0].utilisateur_id, {}, client);
    await journaliser(rows[0].utilisateur_id, 'mot_de_passe_change', req, {}, client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  res.json({ message: 'Mot de passe modifié. Tu peux te connecter.' });
});

module.exports = router;
module.exports.profilPrive = profilPrive;
module.exports.typeAppareil = typeAppareil;
