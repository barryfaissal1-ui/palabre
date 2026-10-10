// Palabre Messages : la messagerie privée entre deux membres.
//
// Qui peut écrire à qui ?
//  - deux amis s'écrivent librement ;
//  - un client et un dev qui lui a envoyé une proposition (seul, ou comme chef d'une équipe éclair) aussi ;
//  - sinon, on peut envoyer UN premier message : c'est une « demande de message », que l'autre accepte ou refuse.
//    Tant qu'elle n'est pas acceptée, on ne peut rien envoyer de plus. Un refus n'est jamais annoncé à l'expéditeur.
//
// Une conversation relie toujours exactement deux membres (membre_a < membre_b : une seule ligne par paire).
// Pas de WebSocket : la page redemande les nouveaux messages toutes les quelques secondes (route « nouveaux »).
const express = require('express');
const db = require('../db/pool');
const v = require('../utils/validation');
const { exigerConnexion, profilDevIncomplet } = require('../middleware/auth');
const { apercuMembre, COLONNES_MEMBRE, limiteParMembre } = require('../utils/membres');
const { notifier, court } = require('../utils/notifications');
const groupes = require('./groupes');
const appels = require('./appels');
const { lireMessages, lireMessage, messagesModifies, origineValide, lireContenu, enregistrerPiece } = require('../utils/messages');
const { presenceVue, signalerEcriture, finEcriture, quiEcrit } = require('../utils/presence');

const router = express.Router();
const MAX_CONVERSATIONS = 100;

const { limiteMessages } = groupes; // la même limite pour les conversations privées et les groupes
// Celle-ci n'est appliquée qu'au moment d'ouvrir une conversation avec quelqu'un qu'on ne connaît pas (voir ecrire()).
const limiteInconnus = limiteParMembre(10, 24 * 60, 'Tu as déjà écrit aujourd\'hui à 10 personnes que tu ne connais pas. Réessaie demain.');

router.use(exigerConnexion);
// Les groupes (équipes éclair) ont leurs propres routes et leur propre règle d'accès : src/routes/groupes.js.
router.use('/groupes', groupes);

// ---------- Morceaux de SQL partagés ($1 est toujours le membre connecté, « u » l'autre membre) ----------

// L'autre membre de la conversation.
const AUTRE = 'JOIN utilisateurs u ON u.id = CASE WHEN c.membre_a = $1 THEN c.membre_b ELSE c.membre_a END';
// Les conversations que je vois : j'en fais partie, je ne l'ai pas masquée (refusée ou supprimée de mon côté),
// l'autre ne m'a pas bloqué, et son compte n'est pas bloqué par un administrateur.
const VISIBLE = `$1 IN (c.membre_a, c.membre_b) AND u.bloque = FALSE
   AND NOT EXISTS (SELECT 1 FROM conversation_masquees cm WHERE cm.conversation_id = c.id AND cm.membre_id = $1)
   AND NOT EXISTS (SELECT 1 FROM blocages b WHERE b.bloqueur_id = u.id AND b.bloque_id = $1)`;
// Messages de l'autre que je n'ai pas encore lus : ceux dont le numéro dépasse mon « dernier lu ».
const NON_LUS = `(SELECT count(*)::int FROM messages m
    WHERE m.conversation_id = c.id AND m.auteur_id <> $1 AND m.masque = FALSE
      AND m.id > COALESCE((SELECT l.dernier_lu_id FROM conversation_lectures l
                            WHERE l.conversation_id = c.id AND l.membre_id = $1), 0))`;
const JE_BLOQUE = 'EXISTS (SELECT 1 FROM blocages b WHERE b.bloqueur_id = $1 AND b.bloque_id = u.id)';

// ---------- Règles ----------

// Ces deux membres peuvent-ils s'écrire librement ? Renvoie { amis, demandeId } :
// demandeId est la demande (la plus récente, ou celle qu'on précise) où l'un est le client et l'autre un dev
// qui a envoyé une proposition, seul ou comme chef d'équipe. Une proposition encore en brouillon ne compte pas.
async function lienEntre(executeur, moiId, autreId, demandePrecise = null) {
  const { rows: [lien] } = await executeur.query(
    `SELECT EXISTS (SELECT 1 FROM amities a
                     WHERE a.statut = 'acceptee'
                       AND LEAST(a.demandeur_id, a.receveur_id) = LEAST($1::int, $2::int)
                       AND GREATEST(a.demandeur_id, a.receveur_id) = GREATEST($1::int, $2::int)) AS amis,
            (SELECT d.id FROM demandes d
               JOIN propositions p ON p.demande_id = d.id AND p.statut <> 'brouillon'
               LEFT JOIN equipes e ON e.id = p.equipe_id
              WHERE d.masque = FALSE
                AND ((d.client_id = $1 AND COALESCE(p.dev_id, e.chef_id) = $2)
                  OR (d.client_id = $2 AND COALESCE(p.dev_id, e.chef_id) = $1))
              ORDER BY (d.id = $3::int) DESC NULLS LAST, d.id DESC
              LIMIT 1) AS demande_id`,
    [moiId, autreId, demandePrecise],
  );
  return { amis: lien.amis, demandeId: lien.demande_id };
}

// Qui a bloqué qui, entre ces deux membres : { parMoi, parLui }.
async function blocagesEntre(executeur, moiId, autreId) {
  const { rows } = await executeur.query(
    'SELECT bloqueur_id FROM blocages WHERE (bloqueur_id = $1 AND bloque_id = $2) OR (bloqueur_id = $2 AND bloque_id = $1)',
    [moiId, autreId],
  );
  return { parMoi: rows.some((l) => l.bloqueur_id === moiId), parLui: rows.some((l) => l.bloqueur_id === autreId) };
}

// Ai-je le droit d'envoyer un message maintenant ? Renvoie { peutEcrire, raison, libre, demandeId }.
// Un blocage par l'autre n'est jamais révélé : la raison reste vague.
async function droitDEcrire(executeur, moi, autreId, conversation, demandePrecise = null) {
  const [blocages, lien] = await Promise.all([blocagesEntre(executeur, moi.id, autreId), lienEntre(executeur, moi.id, autreId, demandePrecise)]);
  const libre = lien.amis || lien.demandeId !== null;
  let raison = null;
  if (blocages.parMoi) raison = 'Tu as bloqué ce membre. Débloque-le pour lui écrire.';
  else if (blocages.parLui) raison = 'Tu ne peux pas écrire à ce membre.';
  else if (conversation && conversation.statut === 'demande' && conversation.cree_par === moi.id && !libre) {
    raison = 'Ta demande de message est envoyée. Tu pourras écrire de nouveau quand elle sera acceptée.';
  }
  return { peutEcrire: raison === null, raison, libre, demandeId: lien.demandeId, jeBloque: blocages.parMoi };
}

// Retrouve le membre visé par son identifiant de profil ; erreur 404 s'il n'existe pas (ou si c'est moi).
async function membreVise(valeur, moi) {
  const identifiant = typeof valeur === 'string' ? valeur.trim().toLowerCase() : '';
  const { rows } = await db.query(`SELECT u.id, ${COLONNES_MEMBRE} FROM utilisateurs u WHERE u.identifiant = $1 AND u.bloque = FALSE`, [identifiant]);
  if (!rows[0] || rows[0].id === moi.id) throw new v.ErreurHttp(404, 'Ce membre n\'existe pas.');
  return rows[0];
}

// La conversation de l'adresse, seulement si j'en fais partie et que je la vois. Sinon 404 :
// un intrus ne doit même pas pouvoir savoir qu'elle existe.
async function maConversation(valeurId, moi) {
  const id = v.idPositif(valeurId);
  const { rows } = id ? await db.query(
    `SELECT c.id, c.statut, c.cree_par, c.demande_id, c.membre_a, c.membre_b, d.titre AS demande_titre,
            u.id AS autre_id, u.vu_le, u.masquer_presence, ${COLONNES_MEMBRE},
            COALESCE((SELECT l.dernier_lu_id FROM conversation_lectures l
                       WHERE l.conversation_id = c.id AND l.membre_id = u.id), 0) AS vu_jusqua
       FROM conversations c
       ${AUTRE}
       LEFT JOIN demandes d ON d.id = c.demande_id AND d.masque = FALSE
      WHERE c.id = $2 AND ${VISIBLE}`,
    [moi.id, id],
  ) : { rows: [] };
  if (!rows[0]) throw new v.ErreurHttp(404, 'Cette conversation n\'existe pas.');
  return rows[0];
}

// Applique une limite « par membre » en dehors de la chaîne habituelle des routes.
// Renvoie false si la limite a déjà répondu 429 à notre place.
function passeLaLimite(limite, req, res) {
  return new Promise((resolve) => {
    res.once('finish', () => resolve(false));
    limite(req, res, () => resolve(true));
  });
}

// Nombre total de messages non lus (la pastille de l'en-tête). Sert aussi à /api/auth/moi.
async function compterNonLus(moiId) {
  const { rows: [total] } = await db.query(
    `SELECT COALESCE(sum(${NON_LUS}), 0)::int AS nb FROM conversations c ${AUTRE} WHERE ${VISIBLE}`,
    [moiId],
  );
  // Les groupes comptent aussi dans la pastille.
  return total.nb + await groupes.compterNonLusGroupes(moiId);
}

// ---------- Envoi d'un message (commun aux deux routes d'envoi) ----------
async function ecrire(req, res, autreId, conversation) {
  const moi = req.utilisateur;
  const corps = req.body || {};
  const { texte, image, vocal } = lireContenu(corps); // du texte (et une photo), ou un message vocal
  const demandePrecise = v.idPositif(corps.demandeId);

  // Un dev qui n'a pas terminé son profil peut écrire à d'autres devs, mais pas à un client.
  if (profilDevIncomplet(moi)) {
    const { rows: [autre] } = await db.query('SELECT type FROM utilisateurs WHERE id = $1', [autreId]);
    if (autre && autre.type === 'client') throw new v.ErreurHttp(403, 'Termine ton profil de dev pour écrire à un client.', '/bienvenue');
  }
  const droit = await droitDEcrire(db, moi, autreId, conversation, demandePrecise);
  if (!droit.peutEcrire) throw new v.ErreurHttp(403, droit.raison);
  // Première prise de contact avec quelqu'un que je ne connais pas : 10 par jour au plus.
  if (!conversation && !droit.libre && !(await passeLaLimite(limiteInconnus, req, res))) return null;

  return db.transaction(async (client) => {
    let conv = conversation;
    let nouvelleDemande = false;
    if (!conv) {
      // ON CONFLICT : si les deux membres s'écrivent pour la première fois au même instant, une seule ligne est créée.
      const { rows } = await client.query(
        `INSERT INTO conversations (membre_a, membre_b, demande_id, statut, cree_par)
         VALUES (LEAST($1::int, $2::int), GREATEST($1::int, $2::int), $3, $4, $1)
         ON CONFLICT (membre_a, membre_b) DO UPDATE SET dernier_message_le = now()
         RETURNING id, statut, cree_par, demande_id, (xmax = 0) AS creee`,
        [moi.id, autreId, droit.demandeId, droit.libre ? 'acceptee' : 'demande'],
      );
      [conv] = rows;
      nouvelleDemande = conv.creee && conv.statut === 'demande';
      // La table des membres est tenue à jour pour toutes les conversations, privées comprises.
      await client.query(
        'INSERT INTO conversation_membres (conversation_id, membre_id) VALUES ($1, $2), ($1, $3) ON CONFLICT DO NOTHING',
        [conv.id, moi.id, autreId],
      );
    }
    // Répondre à une demande de message, c'est l'accepter. Devenir amis entre-temps aussi.
    const accepte = conv.statut === 'demande' && (conv.cree_par !== moi.id || droit.libre);
    // Le bouton « Écrire » d'une proposition précise la demande concernée : on la rappellera en haut de la conversation.
    const demandeId = demandePrecise && droit.demandeId === demandePrecise ? demandePrecise : (conv.demande_id || droit.demandeId);

    const fichierId = await enregistrerPiece(client, moi.id, { image, vocal });
    // Réponse à un message : il doit être dans cette conversation (sinon la citation est simplement ignorée).
    const reponseA = await origineValide(client, conv.id, corps.reponseA);
    const { rows: [message] } = await client.query(
      `INSERT INTO messages (conversation_id, auteur_id, texte, fichier_id, reponse_a, vocal_duree) VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, texte, fichier_id, cree_le, auteur_id`,
      [conv.id, moi.id, texte, fichierId, reponseA, vocal ? vocal.duree : null],
    );
    await client.query(
      'UPDATE conversations SET dernier_message_le = now(), statut = $2, demande_id = $3 WHERE id = $1',
      [conv.id, accepte ? 'acceptee' : conv.statut, demandeId],
    );
    // J'ai forcément lu ce que je viens d'écrire.
    await client.query(
      `INSERT INTO conversation_lectures (conversation_id, membre_id, dernier_lu_id) VALUES ($1, $2, $3)
       ON CONFLICT (conversation_id, membre_id) DO UPDATE SET dernier_lu_id = EXCLUDED.dernier_lu_id`,
      [conv.id, moi.id, message.id],
    );
    await finEcriture(client, conv.id, moi.id); // le message est parti : « écrit… » s'arrête tout de suite
    // Une conversation supprimée d'un côté réapparaît quand un nouveau message arrive.
    await client.query('DELETE FROM conversation_masquees WHERE conversation_id = $1', [conv.id]);
    // La cloche : une demande de message d'un inconnu est annoncée une fois. Dans une conversation ouverte,
    // UNE notification par conversation, mise à jour tant qu'elle n'est pas lue (« Awa t'a envoyé 3 messages »),
    // jamais une par message. Une demande encore en attente ne prévient plus après le premier message.
    const ouverte = (accepte ? 'acceptee' : conv.statut) === 'acceptee';
    if (nouvelleDemande) {
      await notifier(client, autreId, 'demande_message', `${moi.nom} t'a envoyé une demande de message.`, '/messages?onglet=demandes', { acteur: moi });
    } else if (ouverte) {
      await notifier(client, autreId, 'message', (n) => (n === 1 ? `${moi.nom} t'a envoyé un message.` : `${moi.nom} t'a envoyé ${n} messages.`),
        `/messages/${conv.id}`, {
          acteur: moi,
          cible: { type: 'conversation', id: conv.id },
          groupe: 'compteur',
          // Sur le téléphone : le nom, et un aperçu de 60 caractères au plus (jamais le message entier, jamais la photo).
          push: { titre: moi.nom, texte: texte ? court(texte, 60) : 'Photo' },
        });
    }
    return { conversationId: conv.id, statut: accepte ? 'acceptee' : conv.statut, message: await lireMessage(conv.id, message.id, moi, client) };
  });
}

// ---------- Liste et compteur ----------

// Mes conversations : GET /api/messages/conversations?onglet=principal|demandes
// principal : les conversations ouvertes, et les demandes que J'AI envoyées (en attente) ;
// demandes : les demandes de message que j'ai reçues et pas encore traitées.
// Tout vient en une seule requête : l'autre membre, le dernier message (LATERAL) et le nombre de non lus.
router.get('/conversations', async (req, res) => {
  const moi = req.utilisateur;
  const demandes = req.query.onglet === 'demandes';
  const { rows } = await db.query(
    `SELECT c.id, c.statut, c.cree_par, c.demande_id, c.dernier_message_le, d.titre AS demande_titre, u.vu_le, u.masquer_presence, ${COLONNES_MEMBRE},
            dernier.texte AS dernier_texte, dernier.cree_le AS dernier_le, dernier.auteur_id AS dernier_auteur,
            dernier.fichier_id IS NOT NULL AS dernier_image,
            ${NON_LUS} AS non_lus, ${JE_BLOQUE} AS je_bloque
       FROM conversations c
       ${AUTRE}
       LEFT JOIN demandes d ON d.id = c.demande_id AND d.masque = FALSE
       LEFT JOIN LATERAL (
         SELECT m.texte, m.cree_le, m.auteur_id, m.fichier_id FROM messages m
          WHERE m.conversation_id = c.id AND m.masque = FALSE ORDER BY m.id DESC LIMIT 1
       ) dernier ON TRUE
      WHERE ${VISIBLE}
        AND CASE WHEN $2::boolean THEN c.statut = 'demande' AND c.cree_par <> $1
                 ELSE c.statut = 'acceptee' OR c.cree_par = $1 END
      ORDER BY c.dernier_message_le DESC
      LIMIT $3`,
    [moi.id, demandes, MAX_CONVERSATIONS],
  );
  // Le nombre de demandes reçues accompagne toujours la liste, pour le compteur de l'onglet « Demandes ».
  const { rows: [compte] } = await db.query(
    `SELECT count(*)::int AS nb FROM conversations c ${AUTRE} WHERE c.statut = 'demande' AND c.cree_par <> $1 AND ${VISIBLE}`,
    [moi.id],
  );
  res.json({
    nbDemandes: compte.nb,
    // Mes groupes d'équipe, dans l'onglet principal : la page les mêle aux conversations, par date.
    groupes: demandes ? [] : await groupes.listerGroupes(moi),
    conversations: rows.map((ligne) => ({
      id: ligne.id,
      type: 'privee',
      actifLe: ligne.dernier_message_le,
      statut: ligne.statut,
      enAttente: ligne.statut === 'demande' && ligne.cree_par === moi.id,
      autre: apercuMembre(ligne),
      // Présence : seulement dans une conversation acceptée (pas pour une demande de message d'un inconnu).
      presence: ligne.statut === 'acceptee' ? presenceVue(moi, ligne) : null,
      demande: ligne.demande_id && ligne.demande_titre ? { id: ligne.demande_id, titre: ligne.demande_titre } : null,
      dernierMessage: ligne.dernier_le
        ? { texte: ligne.dernier_texte, creeLe: ligne.dernier_le, estMoi: ligne.dernier_auteur === moi.id, aImage: ligne.dernier_image }
        : null,
      nonLus: ligne.non_lus,
      jeBloque: ligne.je_bloque,
    })),
  });
});

// La pastille de l'en-tête : GET /api/messages/non-lus
// Elle dit aussi si un appel sonne pour moi : toutes les pages du site l'interrogent, l'écran d'appel peut donc
// s'ouvrir où que je sois.
router.get('/non-lus', async (req, res) => {
  await appels.entretenir();
  res.json({ nonLus: await compterNonLus(req.utilisateur.id), appel: await appels.appelEntrant(req.utilisateur.id) });
});

// La veille : GET /api/messages/veille
// Une route volontairement légère, interrogée toutes les 5 secondes par toutes les pages tant que l'onglet est
// visible : elle dit si un appel sonne pour moi. La pastille des messages, elle, garde son rythme d'une minute.
router.get('/veille', async (req, res) => {
  await appels.entretenir();
  res.set('Cache-Control', 'no-store').json({ appel: await appels.appelEntrant(req.utilisateur.id) });
});

// ---------- Écrire à un membre depuis son profil ou depuis une proposition ----------

// Où en suis-je avec ce membre ? GET /api/messages/avec/:identifiant?demande=<id>
// La page s'en sert avant le premier message : conversation déjà ouverte, écriture libre, ou demande de message.
router.get('/avec/:identifiant', async (req, res) => {
  const moi = req.utilisateur;
  const autre = await membreVise(req.params.identifiant, moi);
  const { rows: [conversation] } = await db.query(
    `SELECT c.id, c.statut, c.cree_par FROM conversations c
      WHERE c.membre_a = LEAST($1::int, $2::int) AND c.membre_b = GREATEST($1::int, $2::int)
        AND NOT EXISTS (SELECT 1 FROM conversation_masquees cm WHERE cm.conversation_id = c.id AND cm.membre_id = $1)`,
    [moi.id, autre.id],
  );
  const droit = await droitDEcrire(db, moi, autre.id, conversation, v.idPositif(req.query.demande));
  res.json({
    conversationId: conversation ? conversation.id : null,
    autre: apercuMembre(autre),
    peutEcrire: droit.peutEcrire,
    raison: droit.raison,
    // Sans lien (ni amis, ni proposition), le premier message sera une « demande de message ».
    seraUneDemande: !conversation && !droit.libre,
  });
});

// Premier message (ou suivant) : POST /api/messages/avec/:identifiant  { texte, image?, demandeId? }
router.post('/avec/:identifiant', limiteMessages, async (req, res) => {
  const moi = req.utilisateur;
  const autre = await membreVise(req.params.identifiant, moi);
  const { rows: [conversation] } = await db.query(
    'SELECT id, statut, cree_par, demande_id FROM conversations WHERE membre_a = LEAST($1::int, $2::int) AND membre_b = GREATEST($1::int, $2::int)',
    [moi.id, autre.id],
  );
  const resultat = await ecrire(req, res, autre.id, conversation || null);
  if (resultat) res.status(201).json(resultat);
});

// ---------- Une conversation ----------

function parametresConversation(ligne, moi, droit) {
  return {
    id: ligne.id,
    statut: ligne.statut,
    autre: apercuMembre(ligne),
    presence: ligne.statut === 'acceptee' ? presenceVue(moi, ligne) : null,
    demande: ligne.demande_id && ligne.demande_titre ? { id: ligne.demande_id, titre: ligne.demande_titre } : null,
    // Demande de message que j'ai reçue : la page propose Accepter / Refuser / Bloquer à la place de la zone d'écriture.
    estDemandeRecue: ligne.statut === 'demande' && ligne.cree_par !== moi.id,
    peutEcrire: droit.peutEcrire,
    raison: droit.raison,
    jeBloque: droit.jeBloque,
    // Numéro du dernier message que l'autre a lu : sert à afficher « Vu » sous mon dernier message.
    vuJusqua: ligne.vu_jusqua,
  };
}

// Messages par paquets de 30, du plus récent au plus ancien : GET /api/messages/conversations/:id?avant=<id>
router.get('/conversations/:id', async (req, res) => {
  const moi = req.utilisateur;
  const ligne = await maConversation(req.params.id, moi);
  const [{ rows: [{ maintenant }] }, page, droit] = await Promise.all([
    db.query('SELECT now() AS maintenant'),
    lireMessages(ligne.id, moi, { avant: v.idPositif(req.query.avant) }),
    droitDEcrire(db, moi, ligne.autre_id, ligne),
  ]);
  res.json({
    conversation: parametresConversation(ligne, moi, droit),
    messages: page.messages, // rendus dans l'ordre de lecture, du plus ancien au plus récent
    precedent: page.precedent,
    maintenant, // l'heure du serveur : la page la renverra pour demander « qu'est-ce qui a changé depuis ? »
  });
});

// Seulement ce qui est arrivé depuis le message « apres » : GET /api/messages/conversations/:id/nouveaux?apres=<id>
// C'est la route interrogée toutes les 5 secondes : elle renvoie très peu de données.
router.get('/conversations/:id/nouveaux', async (req, res) => {
  const moi = req.utilisateur;
  const ligne = await maConversation(req.params.id, moi);
  const apres = v.idPositif(req.query.apres) || 0;
  // L'heure est lue AVANT les messages : une réaction posée pendant la lecture sera vue au tour suivant, pas perdue.
  const { rows: [{ maintenant }] } = await db.query('SELECT now() AS maintenant');
  const ouverte = ligne.statut === 'acceptee';
  const [nouveaux, modifies, ecrivent] = await Promise.all([
    lireMessages(ligne.id, moi, { apres }),
    messagesModifies(ligne.id, moi, req.query.depuis, apres),
    // « Awa écrit… » et sa présence voyagent avec cette requête, déjà faite toutes les 5 secondes : aucun appel de plus.
    ouverte ? quiEcrit(ligne.id, moi.id) : [],
  ]);
  res.json({
    messages: nouveaux.messages, modifies, maintenant, vuJusqua: ligne.vu_jusqua, statut: ligne.statut,
    ecrivent, presence: ouverte ? presenceVue(moi, ligne) : null,
    appel: await appels.appelEntrant(moi.id),
  });
});

// Envoyer un message : POST /api/messages/conversations/:id  { texte, image? }
router.post('/conversations/:id', limiteMessages, async (req, res) => {
  const ligne = await maConversation(req.params.id, req.utilisateur);
  const resultat = await ecrire(req, res, ligne.autre_id, ligne);
  if (resultat) res.status(201).json(resultat);
});

// « J'écris » : POST /api/messages/conversations/:id/ecrit — signalé par la page au plus toutes les 3 secondes.
// Dans une demande de message pas encore acceptée, rien n'est signalé : l'expéditeur ne doit pas savoir qu'on le lit.
router.post('/conversations/:id/ecrit', async (req, res) => {
  const moi = req.utilisateur;
  const ligne = await maConversation(req.params.id, moi);
  if (ligne.statut === 'acceptee') await signalerEcriture(ligne.id, moi.id);
  res.json({ ok: true });
});

// J'ai lu jusqu'ici : POST /api/messages/conversations/:id/lu
// Lire une demande de message qu'on n'a pas acceptée ne compte pas : l'expéditeur ne voit pas « Vu ».
router.post('/conversations/:id/lu', async (req, res) => {
  const moi = req.utilisateur;
  const ligne = await maConversation(req.params.id, moi);
  if (!(ligne.statut === 'demande' && ligne.cree_par !== moi.id)) {
    await db.query(
      `INSERT INTO conversation_lectures (conversation_id, membre_id, dernier_lu_id)
       SELECT $1, $2, COALESCE(max(id), 0) FROM messages WHERE conversation_id = $1
       ON CONFLICT (conversation_id, membre_id) DO UPDATE SET dernier_lu_id = GREATEST(conversation_lectures.dernier_lu_id, EXCLUDED.dernier_lu_id)`,
      [ligne.id, moi.id],
    );
    // La conversation est lue : sa notification dans la cloche l'est aussi.
    await db.query(
      `UPDATE notifications SET lue = TRUE
        WHERE utilisateur_id = $1 AND type = 'message' AND cible_type = 'conversation' AND cible_id = $2 AND lue = FALSE`,
      [moi.id, ligne.id],
    );
  }
  res.json({ nonLus: await compterNonLus(moi.id) });
});

// Accepter une demande de message reçue : POST /api/messages/conversations/:id/accepter
router.post('/conversations/:id/accepter', async (req, res) => {
  const moi = req.utilisateur;
  const ligne = await maConversation(req.params.id, moi);
  const { rowCount } = await db.query(
    'UPDATE conversations SET statut = \'acceptee\' WHERE id = $1 AND statut = \'demande\' AND cree_par <> $2',
    [ligne.id, moi.id],
  );
  if (rowCount === 0) throw new v.ErreurHttp(404, 'Il n\'y a pas de demande de message à accepter ici.');
  res.json({ ok: true });
});

// Refuser une demande reçue : la conversation disparaît chez moi et reste « en attente » chez l'expéditeur,
// qui ne peut donc plus écrire, sans savoir qu'il a été refusé.
router.post('/conversations/:id/refuser', async (req, res) => {
  const moi = req.utilisateur;
  const ligne = await maConversation(req.params.id, moi);
  if (!(ligne.statut === 'demande' && ligne.cree_par !== moi.id)) {
    throw new v.ErreurHttp(404, 'Il n\'y a pas de demande de message à refuser ici.');
  }
  await db.query('INSERT INTO conversation_masquees (conversation_id, membre_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [ligne.id, moi.id]);
  res.json({ ok: true });
});

// Supprimer la conversation de MON côté seulement : POST /api/messages/conversations/:id/masquer
router.post('/conversations/:id/masquer', async (req, res) => {
  const moi = req.utilisateur;
  const ligne = await maConversation(req.params.id, moi);
  await db.query('INSERT INTO conversation_masquees (conversation_id, membre_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [ligne.id, moi.id]);
  res.json({ ok: true });
});

// ---------- Bloquer ----------

// Bloquer un membre : POST /api/messages/blocages/:identifiant — il ne peut plus m'écrire ni voir nos conversations.
router.post('/blocages/:identifiant', async (req, res) => {
  const moi = req.utilisateur;
  const autre = await membreVise(req.params.identifiant, moi);
  await db.query('INSERT INTO blocages (bloqueur_id, bloque_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [moi.id, autre.id]);
  res.json({ bloque: true });
});

// Débloquer : DELETE /api/messages/blocages/:identifiant
router.delete('/blocages/:identifiant', async (req, res) => {
  const moi = req.utilisateur;
  const autre = await membreVise(req.params.identifiant, moi);
  await db.query('DELETE FROM blocages WHERE bloqueur_id = $1 AND bloque_id = $2', [moi.id, autre.id]);
  res.json({ bloque: false });
});

// Appels audio et vidéo : mêmes règles que pour écrire (droitDEcrire() en privé, membres pour un groupe).
router.use('/appels', appels({ maConversation, droitDEcrire, monGroupe: groupes.monGroupe }));

// Réagir à un message, le supprimer : les mêmes routes pour les conversations privées et les groupes.
router.use('/message', require('./messages-actions')({ maConversation, monGroupe: groupes.monGroupe }));

module.exports = router;
module.exports.compterNonLus = compterNonLus;
