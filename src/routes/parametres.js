// Paramètres et confidentialité (page /parametres) : compte, confidentialité, sécurité, membres bloqués, mes données.
// Chaque réglage est une petite route : la page enregistre au changement, sans bouton « Enregistrer ».
const express = require('express');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db/pool');
const config = require('../config');
const v = require('../utils/validation');
const mailer = require('../utils/mailer'); // appelé par « mailer.envoyerEmail » : les tests peuvent le remplacer
const { emailCode } = require('../utils/gabarit-email');
const { exigerConnexion, fermerSession } = require('../middleware/auth');
const sessions = require('../utils/sessions');
const { assurerAppareil, noterAppareil } = require('../utils/appareils');
const { creerCodesSecours } = require('../utils/deux-etapes');
const { journaliser, journalDe } = require('../utils/journal');
const { apercuMembre, COLONNES_MEMBRE } = require('../utils/membres');
const { lireConfidentialite, reglageValide } = require('../utils/confidentialite');
const { langueValide, langueDe, poserCookieLangue } = require('../utils/langue');

const router = express.Router();
const COUT_BCRYPT = 12;
const DUREE_CODE_MIN = 15;
const MAX_ESSAIS = 5;
const MAX_EXPORTS_PAR_JOUR = 3;

router.use(exigerConnexion);

// Les actions qui demandent le mot de passe : 20 essais par quart d'heure, par membre (comme la connexion).
const limiteMotDePasse = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `membre-${req.utilisateur.id}`,
  message: { erreur: 'Trop de tentatives. Réessaie dans quelques minutes.' },
});

// Le mot de passe actuel est redemandé avant toute action grave (email, mot de passe, suppression) : un téléphone
// resté ouvert sur une table ne suffit pas à prendre le compte.
async function verifierMotDePasse(moi, valeur, champ = 'motDePasse') {
  const { rows: [ligne] } = await db.query('SELECT mot_de_passe_hash FROM utilisateurs WHERE id = $1', [moi.id]);
  const juste = typeof valeur === 'string' && valeur.length > 0 && await bcrypt.compare(valeur, ligne.mot_de_passe_hash);
  if (!juste) throw new v.ErreurValidation('Mot de passe incorrect.', champ);
}

const empreinteCode = (utilisateurId, email, code) => crypto.createHmac('sha256', config.jwtSecret).update(`changement-email:${utilisateurId}:${email}:${code}`).digest('hex');
function egales(a, b) {
  const [x, y] = [Buffer.from(String(a)), Buffer.from(String(b))];
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Tout ce que la page affiche à l'ouverture : GET /api/parametres
router.get('/', async (req, res) => {
  const moi = req.utilisateur;
  const { rows: [enCours] } = await db.query('SELECT email FROM changements_email WHERE utilisateur_id = $1 AND expire_le > now()', [moi.id]);
  res.set('Cache-Control', 'no-store').json({
    compte: { prenom: moi.prenom, nomFamille: moi.nom_famille, identifiant: moi.identifiant, email: moi.email, emailEnAttente: enCours ? enCours.email : null, type: moi.type },
    confidentialite: { ...lireConfidentialite(moi), presence: !moi.masquer_presence },
    langue: langueDe(req),
    // Jamais d'adresse IP : seulement la date, le type d'appareil (« Chrome sur Android ») et, s'il est connu, le lieu.
    securite: {
      derniereConnexion: moi.derniere_connexion_le ? { le: moi.derniere_connexion_le, appareil: moi.derniere_connexion_appareil } : null,
      sessions: await sessions.sessionsDe(moi.id, req.session.id),
      deuxEtapes: { active: moi.deux_etapes, codesRestants: moi.deux_etapes ? (await db.query('SELECT count(*)::int AS nb FROM codes_secours WHERE utilisateur_id = $1 AND utilise_le IS NULL', [moi.id])).rows[0].nb : 0 },
    },
  });
});

// Prénom, nom, identifiant : PUT /api/parametres/compte  (on n'envoie que ce qui change)
router.put('/compte', async (req, res) => {
  const moi = req.utilisateur;
  const corps = req.body || {};
  const prenom = corps.prenom !== undefined ? v.nomPropre(corps.prenom, 'prenom') : moi.prenom;
  const nomFamille = corps.nomFamille !== undefined ? v.nomPropre(corps.nomFamille, 'nomFamille') : moi.nom_famille;
  const identifiant = corps.identifiant !== undefined ? v.identifiant(corps.identifiant) : moi.identifiant;
  try {
    // Le nom affiché (« Prénom Nom ») est toujours recalculé avec les deux champs.
    await db.query('UPDATE utilisateurs SET prenom = $2, nom_famille = $3, nom = $4, identifiant = $5 WHERE id = $1', [moi.id, prenom, nomFamille, `${prenom} ${nomFamille}`, identifiant]);
  } catch (err) {
    if (err.code === '23505') throw new v.ErreurValidation('Cet identifiant est déjà pris. Choisis-en un autre.', 'identifiant');
    throw err;
  }
  res.json({ compte: { prenom, nomFamille, identifiant, nom: `${prenom} ${nomFamille}` } });
});

// La langue du site : PUT /api/parametres/langue  { langue }  ('fr' ou 'en')
// Gardée dans le compte (pour les notifications, les push et les emails) et dans le cookie « langue ».
router.put('/langue', async (req, res) => {
  const langue = langueValide(req.body?.langue);
  if (!langue) throw new v.ErreurValidation('Langue non reconnue.', 'langue');
  await db.query('UPDATE utilisateurs SET langue = $2 WHERE id = $1', [req.utilisateur.id, langue]);
  poserCookieLangue(res, langue);
  res.json({ langue });
});

// Un réglage de confidentialité : PUT /api/parametres/confidentialite  { cle, valeur }
router.put('/confidentialite', async (req, res) => {
  const moi = req.utilisateur;
  const { cle, valeur } = req.body || {};
  // « Afficher quand je suis en ligne » garde sa colonne (masquer_presence) : la messagerie la lit déjà.
  if (cle === 'presence') {
    if (typeof valeur !== 'boolean') throw new v.ErreurValidation('Choix non reconnu.', 'valeur');
    await db.query('UPDATE utilisateurs SET masquer_presence = $2 WHERE id = $1', [moi.id, !valeur]);
    return res.json({ cle, valeur });
  }
  reglageValide(cle, valeur);
  // jsonb_set ne touche que cette clé : les autres réglages ne bougent pas. Le nom de la clé vient de notre liste.
  await db.query('UPDATE utilisateurs SET confidentialite = jsonb_set(confidentialite, ARRAY[$2::text], $3::jsonb) WHERE id = $1', [moi.id, cle, JSON.stringify(valeur)]);
  res.json({ cle, valeur });
});

// ---------- Changer d'email : le code part à la NOUVELLE adresse, l'ancienne reste en place tant qu'il n'est pas saisi ----------

// POST /api/parametres/email  { email, motDePasse }
router.post('/email', limiteMotDePasse, async (req, res) => {
  const moi = req.utilisateur;
  const email = v.email(req.body?.email);
  await verifierMotDePasse(moi, req.body?.motDePasse);
  if (email === moi.email) throw new v.ErreurValidation('C\'est déjà ton adresse.', 'email');
  const { rowCount } = await db.query('SELECT 1 FROM utilisateurs WHERE email = $1', [email]);
  if (rowCount > 0) throw new v.ErreurValidation('Un compte existe déjà avec cet email.', 'email');
  // Un code par minute au plus.
  const { rows: [recent] } = await db.query('SELECT 1 AS oui FROM changements_email WHERE utilisateur_id = $1 AND cree_le > now() - interval \'1 minute\'', [moi.id]);
  if (recent) throw new v.ErreurHttp(429, 'Un code vient de partir. Attends une minute avant d\'en demander un autre.');

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  await db.query(
    `INSERT INTO changements_email (utilisateur_id, email, code_hash, expire_le) VALUES ($1, $2, $3, now() + make_interval(mins => $4))
     ON CONFLICT (utilisateur_id) DO UPDATE SET email = EXCLUDED.email, code_hash = EXCLUDED.code_hash, expire_le = EXCLUDED.expire_le, essais = 0, cree_le = now()`,
    [moi.id, email, empreinteCode(moi.id, email, code), DUREE_CODE_MIN],
  );
  await mailer.envoyerEmail({ a: email, ...emailCode({ prenom: moi.prenom || moi.nom, code, dureeMin: DUREE_CODE_MIN, langue: langueDe(req) }) });
  res.json({ emailEnAttente: email, message: 'Un code vient de partir à ta nouvelle adresse.' });
});

// POST /api/parametres/email/confirmer  { code }
router.post('/email/confirmer', limiteMotDePasse, async (req, res) => {
  const moi = req.utilisateur;
  const code = typeof req.body?.code === 'string' ? req.body.code.replace(/\s/g, '') : '';
  if (!/^\d{6}$/.test(code)) throw new v.ErreurValidation('Le code fait 6 chiffres.', 'code');
  const resultat = await db.transaction(async (client) => {
    const { rows: [demande] } = await client.query('SELECT email, code_hash, essais, expire_le > now() AS valable FROM changements_email WHERE utilisateur_id = $1 FOR UPDATE', [moi.id]);
    if (!demande || !demande.valable) return { erreur: 'Ce code a expiré. Demande un nouveau code.' };
    if (demande.essais >= MAX_ESSAIS) return { erreur: 'Trop d\'essais. Demande un nouveau code.' };
    if (!egales(demande.code_hash, empreinteCode(moi.id, demande.email, code))) {
      await client.query('UPDATE changements_email SET essais = essais + 1 WHERE utilisateur_id = $1', [moi.id]);
      return { erreur: 'Code incorrect.' };
    }
    // Quelqu'un d'autre a pu s'inscrire avec cette adresse entre-temps.
    const { rowCount } = await client.query('SELECT 1 FROM utilisateurs WHERE email = $1', [demande.email]);
    if (rowCount > 0) return { erreur: 'Un compte existe déjà avec cet email.' };
    await client.query('UPDATE utilisateurs SET email = $2, email_confirme_le = now() WHERE id = $1', [moi.id, demande.email]);
    await client.query('DELETE FROM changements_email WHERE utilisateur_id = $1', [moi.id]);
    // Les liens « mot de passe oublié » envoyés à l'ancienne adresse ne valent plus rien.
    await client.query('UPDATE reinitialisations_mdp SET utilise_le = now() WHERE utilisateur_id = $1 AND utilise_le IS NULL', [moi.id]);
    await journaliser(moi.id, 'email_change', req, {}, client);
    return { email: demande.email };
  });
  if (resultat.erreur) return res.status(400).json({ erreur: resultat.erreur, champ: 'code' });
  res.json(resultat);
});

// ---------- Mot de passe et sessions ----------

// Révoque toutes les sessions du membre, sauf celle de cet appareil (table « sessions »).
const fermerLesAutresSessions = (req, client = db) => sessions.revoquerToutes(req.utilisateur.id, { sauf: req.session.id }, client);

// PUT /api/parametres/mot-de-passe  { ancien, nouveau }
router.put('/mot-de-passe', limiteMotDePasse, async (req, res) => {
  const moi = req.utilisateur;
  const nouveau = v.motDePasse(req.body?.nouveau, 'nouveau', [moi.prenom, moi.nom_famille, moi.identifiant]);
  await verifierMotDePasse(moi, req.body?.ancien, 'ancien');
  if (nouveau === req.body.ancien) throw new v.ErreurValidation('Choisis un mot de passe différent de l\'ancien.', 'nouveau');
  await db.query('UPDATE utilisateurs SET mot_de_passe_hash = $2 WHERE id = $1', [moi.id, await bcrypt.hash(nouveau, COUT_BCRYPT)]);
  // Les autres appareils sont déconnectés : si quelqu'un connaissait l'ancien mot de passe, il est dehors.
  await fermerLesAutresSessions(req);
  await journaliser(moi.id, 'mot_de_passe_change', req);
  res.json({ message: 'Mot de passe modifié. Tes autres appareils ont été déconnectés.' });
});

// Les appareils connectés : GET /api/parametres/sessions
router.get('/sessions', async (req, res) => {
  res.set('Cache-Control', 'no-store').json({ sessions: await sessions.sessionsDe(req.utilisateur.id, req.session.id) });
});

// « Déconnecter » un appareil : DELETE /api/parametres/sessions/:cle  (cle : l'empreinte donnée par la liste)
// Seules MES sessions peuvent être désignées : la requête filtre sur mon numéro de membre.
router.delete('/sessions/:cle', async (req, res) => {
  const fermee = await sessions.revoquerParCle(req.utilisateur.id, req.params.cle);
  if (!fermee) throw new v.ErreurHttp(404, 'Cet appareil est déjà déconnecté.');
  // Dans le journal : le nom de l'appareil qui vient d'être déconnecté.
  await journaliser(req.utilisateur.id, 'session_revoquee', req, { appareil: fermee.appareil });
  const ici = fermee.id === req.session.id;
  if (ici) fermerSession(res);
  res.json({ ok: true, ici });
});

// POST /api/parametres/deconnecter-autres
router.post('/deconnecter-autres', async (req, res) => {
  const fermees = await fermerLesAutresSessions(req);
  if (fermees > 0) await journaliser(req.utilisateur.id, 'session_revoquee', req, { appareil: null });
  res.json({ message: 'Tes autres appareils ont été déconnectés.' });
});

// Activité de sécurité : GET /api/parametres/journal → les 30 derniers événements de MON compte (gardés 90 jours).
router.get('/journal', async (req, res) => {
  res.set('Cache-Control', 'no-store').json({ journal: await journalDe(req.utilisateur.id) });
});

// Validation en deux étapes : PUT /api/parametres/deux-etapes  { active, motDePasse }
// Le mot de passe est redemandé pour l'activer comme pour la couper. À l'activation, 8 codes de secours sont
// fabriqués et renvoyés une seule fois, et cet appareil devient « de confiance ».
router.put('/deux-etapes', limiteMotDePasse, async (req, res) => {
  const moi = req.utilisateur;
  const active = req.body?.active;
  if (typeof active !== 'boolean') throw new v.ErreurValidation('Choix non reconnu.', 'active');
  await verifierMotDePasse(moi, req.body?.motDePasse);
  const numero = active ? assurerAppareil(req, res) : null;
  const codesSecours = await db.transaction(async (client) => {
    await client.query('UPDATE utilisateurs SET deux_etapes = $2 WHERE id = $1', [moi.id, active]);
    if (!active) {
      await client.query('DELETE FROM codes_secours WHERE utilisateur_id = $1', [moi.id]);
      await client.query('DELETE FROM confirmations_email WHERE utilisateur_id = $1 AND motif = \'connexion\'', [moi.id]);
      await client.query('UPDATE appareils_connus SET confiance = FALSE WHERE utilisateur_id = $1', [moi.id]);
      await journaliser(moi.id, 'deux_etapes_coupee', req, {}, client);
      return null;
    }
    await noterAppareil(moi.id, numero, { confiance: true }, client);
    await journaliser(moi.id, 'deux_etapes_active', req, {}, client);
    return creerCodesSecours(moi.id, client);
  });
  res.set('Cache-Control', 'no-store').json({ active, codesSecours });
});

// ---------- Membres bloqués ----------

// GET /api/parametres/bloques (pour débloquer : DELETE /api/messages/blocages/:identifiant, qui existait déjà)
router.get('/bloques', async (req, res) => {
  const { rows } = await db.query(
    `SELECT ${COLONNES_MEMBRE}, b.cree_le AS bloque_le FROM blocages b JOIN utilisateurs u ON u.id = b.bloque_id
      WHERE b.bloqueur_id = $1 AND u.supprime_le IS NULL ORDER BY b.cree_le DESC LIMIT 200`,
    [req.utilisateur.id],
  );
  res.json({ bloques: rows.map((ligne) => ({ ...apercuMembre(ligne), bloqueLe: ligne.bloque_le })) });
});

// ---------- Mes données ----------

// POST /api/parametres/export : tout ce que j'ai écrit ou donné, en un fichier JSON. 3 par jour.
// Des autres membres, on ne sort que le nom : jamais leur email, leur numéro, ni leurs messages.
// La date de naissance n'y est pas : elle ne sort de la base par aucune route.
router.post('/export', async (req, res) => {
  const moi = req.utilisateur;
  const { rows: [compte] } = await db.query('SELECT count(*)::int AS nb FROM exports_donnees WHERE utilisateur_id = $1 AND cree_le > now() - interval \'24 hours\'', [moi.id]);
  if (compte.nb >= MAX_EXPORTS_PAR_JOUR) throw new v.ErreurHttp(429, `Tu as déjà téléchargé tes données ${MAX_EXPORTS_PAR_JOUR} fois aujourd'hui. Réessaie demain.`);
  await db.query('INSERT INTO exports_donnees (utilisateur_id) VALUES ($1)', [moi.id]);

  const lire = async (texte) => (await db.query(texte, [moi.id])).rows;
  const [publications, commentaires, messages, demandes, propositions, projets, amis, competences] = await Promise.all([
    lire('SELECT id, type, texte, cree_le AS "creeLe" FROM publications WHERE auteur_id = $1 ORDER BY id'),
    lire('SELECT publication_id AS "publicationId", texte, cree_le AS "creeLe" FROM commentaires WHERE auteur_id = $1 ORDER BY id'),
    // Mes messages seulement, avec le nom de la conversation : l'autre membre, ou le titre du groupe.
    lire(`SELECT m.texte, m.cree_le AS "creeLe", (m.vocal_duree IS NOT NULL) AS vocal,
                 COALESCE(c.titre, (SELECT a.nom FROM utilisateurs a WHERE a.id = CASE WHEN c.membre_a = $1 THEN c.membre_b ELSE c.membre_a END)) AS conversation
            FROM messages m JOIN conversations c ON c.id = m.conversation_id
           WHERE m.auteur_id = $1 AND m.systeme = FALSE AND m.supprime_le IS NULL ORDER BY m.id`),
    lire('SELECT id, titre, description, budget_fcfa AS "budgetFcfa", delai, categorie, statut, cree_le AS "creeLe" FROM demandes WHERE client_id = $1 ORDER BY id'),
    lire(`SELECT d.titre AS demande, p.message, p.montant_fcfa AS "montantFcfa", p.statut, p.cree_le AS "creeLe", (p.equipe_id IS NOT NULL) AS "enEquipe"
            FROM propositions p JOIN demandes d ON d.id = p.demande_id LEFT JOIN equipes e ON e.id = p.equipe_id
           WHERE COALESCE(p.dev_id, e.chef_id) = $1 ORDER BY p.id`),
    lire('SELECT titre, description, lien, cree_le AS "creeLe" FROM projets WHERE dev_id = $1 ORDER BY id'),
    lire(`SELECT u.nom FROM amities a JOIN utilisateurs u ON u.id = CASE WHEN a.demandeur_id = $1 THEN a.receveur_id ELSE a.demandeur_id END
           WHERE a.statut = 'acceptee' AND $1 IN (a.demandeur_id, a.receveur_id) ORDER BY u.nom`),
    lire('SELECT c.nom FROM utilisateur_competences uc JOIN competences c ON c.id = uc.competence_id WHERE uc.utilisateur_id = $1 ORDER BY c.nom'),
  ]);
  res.set('Cache-Control', 'no-store').json({
    palabre: 'Mes données',
    exporteLe: new Date().toISOString(),
    profil: {
      type: moi.type, prenom: moi.prenom, nomFamille: moi.nom_famille, identifiant: moi.identifiant, email: moi.email, pays: moi.pays, ville: moi.ville,
      whatsapp: moi.whatsapp, bio: moi.bio, specialite: moi.specialite, experience: moi.experience,
      liens: { github: moi.lien_github, gitlab: moi.lien_gitlab, portfolio: moi.lien_portfolio, linkedin: moi.lien_linkedin },
      competences: competences.map((c) => c.nom), confidentialite: lireConfidentialite(moi),
    },
    publications, commentaires, messagesEnvoyes: messages, demandes, propositions, projets, amis: amis.map((a) => a.nom),
  });
});

// ---------- Supprimer mon compte ----------

// DELETE /api/parametres/compte  { motDePasse }
// Tout ce qui est à moi est réellement supprimé (publications, commentaires, projets, demandes, propositions, amis,
// photos, vocaux…) : les tables sont reliées au compte par ON DELETE CASCADE. Deux choses restent. Les avis que j'ai
// laissés à des devs, signés « Ancien client », sans rien de moi : ils prouvent leur travail. Et le texte des
// messages que j'ai DÉJÀ envoyés à d'autres. Ils font partie de leurs conversations ; on les rattache à un compte
// vide, « Membre parti », qui ne porte plus rien de moi (ni nom, ni email, ni photo) et avec lequel personne ne
// peut se connecter.
router.delete('/compte', limiteMotDePasse, async (req, res) => {
  const moi = req.utilisateur;
  await verifierMotDePasse(moi, req.body?.motDePasse);
  await db.transaction(async (client) => {
    // Une demande de message que j'ai envoyée et qui attend encore : elle part avec moi.
    await client.query('DELETE FROM conversations WHERE type = \'privee\' AND statut = \'demande\' AND cree_par = $1', [moi.id]);
    const { rowCount: aEcrit } = await client.query('SELECT 1 FROM messages WHERE auteur_id = $1 AND systeme = FALSE LIMIT 1', [moi.id]);
    if (aEcrit) {
      const hasard = crypto.randomBytes(6).toString('hex');
      const { rows: [parti] } = await client.query(
        `INSERT INTO utilisateurs (type, nom, prenom, nom_famille, identifiant, email, mot_de_passe_hash, pays, ville, disponible, email_confirme_le, supprime_le)
         VALUES ($1, 'Membre parti', 'Membre', 'parti', $2, $3, '!', 'Autre', '—', FALSE, now(), now()) RETURNING id`,
        [moi.type, `membre-parti-${hasard}`, `parti-${hasard}@supprime.invalid`],
      );
      // Photos et vocaux : supprimés pour de bon (le fichier part avec le compte), il reste « Message supprimé ».
      await client.query(
        `UPDATE messages SET texte = 'Message supprimé', fichier_id = NULL, vocal_duree = NULL, supprime_le = now(), modifie_le = now()
          WHERE auteur_id = $1 AND (fichier_id IS NOT NULL OR vocal_duree IS NOT NULL)`,
        [moi.id],
      );
      await client.query('UPDATE messages SET auteur_id = $2, modifie_le = now() WHERE auteur_id = $1', [moi.id, parti.id]);
      // Le nouveau compte a le plus grand numéro : il prend la place « membre_b » (membre_a < membre_b).
      await client.query(
        `UPDATE conversations SET membre_a = CASE WHEN membre_a = $1 THEN membre_b ELSE membre_a END, membre_b = $2
          WHERE type = 'privee' AND $1 IN (membre_a, membre_b)`,
        [moi.id, parti.id],
      );
      await client.query('UPDATE conversations SET cree_par = $2 WHERE cree_par = $1', [moi.id, parti.id]);
      // Dans les groupes, « Membre parti » n'est plus membre : il a quitté.
      await client.query('UPDATE conversation_membres SET membre_id = $2, quitte_le = COALESCE(quitte_le, now()) WHERE membre_id = $1', [moi.id, parti.id]);
    }
    // Les groupes des équipes dont j'étais le chef sont fermés (l'équipe disparaît avec moi).
    await client.query('UPDATE conversations SET ferme_le = COALESCE(ferme_le, now()) WHERE type = \'groupe\' AND equipe_id IN (SELECT id FROM equipes WHERE chef_id = $1)', [moi.id]);
    // Les avis que j'ai laissés à des devs restent sur leur profil : ils font partie de la preuve de leur travail.
    // Ils ne portent plus rien de moi : ni mon compte, ni ma demande (« Ancien client » dans la page).
    await client.query('UPDATE avis SET client_id = NULL, demande_id = NULL WHERE client_id = $1', [moi.id]);
    await client.query('DELETE FROM utilisateurs WHERE id = $1', [moi.id]);
  });
  fermerSession(res);
  res.json({ ok: true });
});

module.exports = router;
