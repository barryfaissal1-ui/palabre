// Fil d'actualité : publications (idée, question, projet), j'aime et commentaires.
// Tout est réservé aux membres connectés, sauf la lecture d'UNE publication (GET /:id), ouverte aux visiteurs :
// c'est elle qui alimente la page publique /publication/12, celle qu'on partage sur WhatsApp ou Facebook.
const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const db = require('../db/pool');
const v = require('../utils/validation');
const { exigerConnexion } = require('../middleware/auth');
const { lireImageDataUrl } = require('../utils/images');
const { apercuMembre, COLONNES_MEMBRE, limiteParMembre } = require('../utils/membres');
const { effacerPublication } = require('../utils/purge');
const { controler, mettreEnAttente, PHRASE_ATTENTE } = require('../utils/moderation');
const { refuserLesLiens, limiterNouveauCompte } = require('../utils/nouveaux-comptes');
const { lireLienVideo } = require('../utils/videos');
const { notifier, retirerActeur, avecLesAutres } = require('../utils/notifications');
const { publicationsVisibles } = require('../utils/confidentialite');

const router = express.Router();
const PAR_PAGE = 10;
const TYPES = ['idee', 'question', 'projet'];
// Les filtres du fil et de la recherche : un type, ou « sans-reponse » (les questions sans meilleure réponse).
const FILTRES_TYPE = [...TYPES, 'sans-reponse'];
function lireFiltreType(valeur) {
  if (!FILTRES_TYPE.includes(valeur)) return { type: null, sansReponse: false };
  return valeur === 'sans-reponse' ? { type: 'question', sansReponse: true } : { type: valeur, sansReponse: false };
}
const MAX_COMMENTAIRES_AFFICHES = 200;
const COMMENTAIRES_APERCU = 2; // derniers commentaires montrés directement sous chaque publication
const COMMENTAIRES_PAGE = 3;   // sur la page publique d'une publication

const limitePublications = limiteParMembre(30, 15, 'Tu publies très vite. Réessaie dans quelques minutes.');
const limiteCommentaires = limiteParMembre(60, 15, 'Tu commentes très vite. Réessaie dans quelques minutes.');
// L'auteur peut corriger son texte pendant 48 heures : assez pour une faute, pas assez pour réécrire l'histoire.
const DUREE_MODIFICATION_H = 48;
const encoreModifiable = (creeLe) => Date.now() - new Date(creeLe).getTime() < DUREE_MODIFICATION_H * 3600 * 1000;
const limiteJaime = limiteParMembre(300, 15, 'Doucement sur les j\'aime. Réessaie dans quelques minutes.');
const limiteMeilleure = limiteParMembre(60, 15, 'Doucement. Réessaie dans quelques minutes.');
// La recherche part à chaque pause de frappe : 120 par 5 minutes laissent chercher à l'aise, pas aspirer le fil.
const limiteRecherche = limiteParMembre(120, 5, 'Tu cherches très vite. Réessaie dans quelques minutes.');

// Une publication avec son auteur et ses compteurs. $1 est toujours le membre connecté.
// Les publications masquées par un administrateur, celles des comptes bloqués et celles qui sont dans la corbeille
// de leur auteur (supprimee_le) n'apparaissent jamais.
// Confidentialité : l'auteur choisit qui voit ses publications (tout le monde, les membres, ses amis). La condition
// est dans cette requête commune : le fil, le profil, la page publique et la lecture d'une publication la suivent tous.
// Tout ce qu'il faut pour afficher le fil arrive en UNE requête (sous-requêtes et LATERAL), jamais une par publication :
//  - « aime » : une personne qui a aimé, autre que moi, un de mes amis en priorité (« Aimé par Awa et 12 autres ») ;
//  - « apercu » : les 2 derniers commentaires, avec leur auteur ;
//  - « mr » : la meilleure réponse d'une question, si elle est toujours visible (commentaire non masqué, auteur ni
//    bloqué ni désactivé). Une question est « résolue » quand mr.commentaire existe : voir RESOLUE.
const RESOLUE = '(CASE WHEN p.type = \'question\' AND mr.commentaire IS NOT NULL THEN 1 ELSE 0 END)';
const estResolue = (ligne) => ligne.type === 'question' && Boolean(ligne.meilleure_reponse);
const selection = (nbCommentaires = COMMENTAIRES_APERCU) => `
  SELECT p.id, p.type, p.texte, p.image, p.image_largeur, p.image_hauteur, p.video_plateforme, p.video_id, p.cree_le, p.modifiee_le, p.auteur_id, ${COLONNES_MEMBRE},
         aime.nom AS aime_nom, aime.prenom AS aime_prenom, aime.identifiant AS aime_identifiant, apercu.liste AS apercu_commentaires, mr.commentaire AS meilleure_reponse,
         (SELECT count(*)::int FROM jaime j WHERE j.publication_id = p.id) AS nb_jaime,
         (SELECT count(*)::int FROM commentaires c
            JOIN utilisateurs cu ON cu.id = c.auteur_id
           WHERE c.publication_id = p.id AND c.masque = FALSE AND cu.bloque = FALSE AND cu.desactive_le IS NULL) AS nb_commentaires,
         EXISTS (SELECT 1 FROM jaime j WHERE j.publication_id = p.id AND j.utilisateur_id = $1) AS jaime_par_moi
    FROM publications p
    JOIN utilisateurs u ON u.id = p.auteur_id
    LEFT JOIN LATERAL (
      SELECT ju.nom, ju.prenom, ju.identifiant
        FROM jaime j
        JOIN utilisateurs ju ON ju.id = j.utilisateur_id
       WHERE j.publication_id = p.id AND j.utilisateur_id <> $1 AND ju.bloque = FALSE AND ju.desactive_le IS NULL
       ORDER BY EXISTS (SELECT 1 FROM amities a
                         WHERE a.statut = 'acceptee'
                           AND LEAST(a.demandeur_id, a.receveur_id) = LEAST($1, ju.id)
                           AND GREATEST(a.demandeur_id, a.receveur_id) = GREATEST($1, ju.id)) DESC,
                ju.id DESC
       LIMIT 1
    ) aime ON TRUE
    LEFT JOIN LATERAL (
      SELECT json_agg(to_jsonb(d) ORDER BY d.id) AS liste
        FROM (SELECT c.id, c.texte, c.cree_le, c.modifie_le, c.auteur_id, ${COLONNES_MEMBRE}
                FROM commentaires c
                JOIN utilisateurs u ON u.id = c.auteur_id -- ici « u » est l'auteur du commentaire
               WHERE c.publication_id = p.id AND c.masque = FALSE AND u.bloque = FALSE AND u.desactive_le IS NULL
                 AND c.id IS DISTINCT FROM p.meilleure_reponse_id -- la meilleure réponse est déjà montrée, en premier
               ORDER BY c.id DESC
               LIMIT ${nbCommentaires}) d
    ) apercu ON TRUE
    LEFT JOIN LATERAL (
      SELECT to_jsonb(d) AS commentaire
        FROM (SELECT c.id, c.texte, c.cree_le, c.modifie_le, c.auteur_id, ${COLONNES_MEMBRE}
                FROM commentaires c
                JOIN utilisateurs u ON u.id = c.auteur_id
               WHERE c.id = p.meilleure_reponse_id AND c.masque = FALSE AND u.bloque = FALSE AND u.desactive_le IS NULL) d
    ) mr ON TRUE
   WHERE p.masque = FALSE AND p.supprimee_le IS NULL AND u.bloque = FALSE AND u.desactive_le IS NULL AND ${publicationsVisibles('$1')}`;
const SELECTION = selection();

function versPublication(ligne, moi) {
  return {
    id: ligne.id,
    type: ligne.type,
    texte: ligne.texte,
    image: ligne.image ? `/fichiers/${ligne.image}` : null,
    imageLargeur: ligne.image_largeur,
    imageHauteur: ligne.image_hauteur,
    // Vidéo jointe : la plateforme et l'identifiant, rien d'autre. Le navigateur reconstruit l'adresse du lecteur officiel.
    video: ligne.video_plateforme ? { plateforme: ligne.video_plateforme, id: ligne.video_id } : null,
    creeLe: ligne.cree_le,
    // « modifiée » : la mention discrète ; « modifiable » : c'est la mienne et elle a moins de 48 heures.
    modifiee: Boolean(ligne.modifiee_le),
    modifiable: ligne.auteur_id === moi.id && encoreModifiable(ligne.cree_le),
    auteur: apercuMembre(ligne),
    nbJaime: ligne.nb_jaime,
    aimePar: ligne.aime_nom ? { nom: ligne.aime_nom, prenom: ligne.aime_prenom || ligne.aime_nom.split(' ')[0], identifiant: ligne.aime_identifiant } : null,
    derniersCommentaires: (ligne.apercu_commentaires || []).map((c) => versCommentaire(c, moi)),
    // Base de savoir : une question est « résolue » quand son auteur a retenu une réponse, toujours visible.
    resolue: estResolue(ligne),
    meilleureReponse: estResolue(ligne) ? versCommentaire(ligne.meilleure_reponse, moi, true) : null,
    nbCommentaires: ligne.nb_commentaires,
    jaimeParMoi: ligne.jaime_par_moi,
    estMoi: ligne.auteur_id === moi.id,
    // L'adresse à partager : la page publique, lisible sans compte.
    lien: `${config.urlPublique}/publication/${ligne.id}`,
  };
}

function versCommentaire(ligne, moi, meilleure = false) {
  return {
    meilleure, // la réponse retenue par l'auteur de la question
    id: ligne.id,
    texte: ligne.texte,
    creeLe: ligne.cree_le,
    modifie: Boolean(ligne.modifie_le),
    modifiable: ligne.auteur_id === moi.id && encoreModifiable(ligne.cree_le),
    auteur: apercuMembre(ligne),
    estMoi: ligne.auteur_id === moi.id,
  };
}

// Vérifie que la publication de l'adresse existe et est visible ; sinon répond 404.
async function publicationDeLaRoute(req, res) {
  const id = v.idPositif(req.params.id);
  if (id) {
    const { rows } = await db.query(
      // Une publication que je n'ai pas le droit de voir n'existe pas pour moi : ni j'aime, ni commentaire possibles.
      // (Un administrateur doit pouvoir la supprimer après un signalement.)
      `SELECT p.id, p.auteur_id, p.image, p.type, p.meilleure_reponse_id FROM publications p
         JOIN utilisateurs u ON u.id = p.auteur_id
        WHERE p.id = $1 AND p.masque = FALSE AND p.supprimee_le IS NULL AND u.bloque = FALSE AND u.desactive_le IS NULL AND ($3::boolean OR ${publicationsVisibles('$2')})`,
      [id, req.utilisateur.id, Boolean(req.utilisateur.est_admin)],
    );
    if (rows[0]) return rows[0];
  }
  res.status(404).json({ erreur: 'Cette publication n\'existe plus.' });
  return null;
}

async function compteurJaime(publicationId, moiId) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS nb, COALESCE(bool_or(utilisateur_id = $2), FALSE) AS moi
       FROM jaime WHERE publication_id = $1`,
    [publicationId, moiId],
  );
  return { nbJaime: rows[0].nb, jaimeParMoi: rows[0].moi };
}

// Lecture d'une publication : 150 par 10 minutes, par membre ou par adresse IP pour un visiteur (la même règle que
// pour les profils). Sans elle, un robot pourrait recopier tout le fil en demandant les numéros un par un.
const limiteLecture = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 150,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => (req.utilisateur ? `membre-${req.utilisateur.id}` : rateLimit.ipKeyGenerator(req.ip)),
  message: { erreur: 'Tu consultes beaucoup de publications. Réessaie dans quelques minutes.' },
});

// Une seule publication : GET /api/publications/:id (la page publique /publication/12 et le lien partagé y mènent).
// SEULE route de ce fichier ouverte aux visiteurs : elle est placée avant exigerConnexion.
// Un visiteur reçoit la même chose qu'un membre (auteur, texte, image ou vidéo, compteurs, 3 derniers commentaires) :
// rien de privé n'y figure, apercuMembre() ne contient ni email ni numéro WhatsApp.
router.get('/:id', (req, res, next) => (/^\d+$/.test(req.params.id) ? next() : next('route')), limiteLecture, async (req, res) => {
  const moi = req.utilisateur || { id: 0 }; // 0 : aucun membre n'a ce numéro, donc « pas moi », « pas aimé par moi »
  const id = v.idPositif(req.params.id);
  const { rows } = id ? await db.query(`${selection(COMMENTAIRES_PAGE)} AND p.id = $2`, [moi.id, id]) : { rows: [] };
  if (!rows[0]) return res.status(404).json({ erreur: 'Cette publication n\'existe plus.' });
  res.json({ publication: versPublication(rows[0], moi) });
});

// Tout le reste demande un compte.
router.use(exigerConnexion);

// Le fil : GET /api/publications?avant=<id>&amis=1&auteur=<identifiant>&type=<idee|question|projet|sans-reponse>
// « type » ne garde qu'une sorte de publication ; « sans-reponse » : les questions sans meilleure réponse.
// Le filtre est fait ICI, dans la requête : la page suivante (« avant ») reste juste, quel que soit le filtre.
// « auteur » ne garde que les publications d'un membre (onglet « Publications » de son profil).
// Les publications sont chargées par 10, de la plus récente à la plus ancienne.
// « avant » est le numéro de la dernière publication déjà affichée : on demande celles d'avant.
router.get('/', async (req, res) => {
  const moi = req.utilisateur;
  const avant = v.idPositif(req.query.avant);
  const seulementAmis = req.query.amis === '1';
  const auteur = typeof req.query.auteur === 'string' && req.query.auteur ? req.query.auteur.toLowerCase().slice(0, 30) : null;
  const { type, sansReponse } = lireFiltreType(req.query.type);

  const { rows } = await db.query(
    `${SELECTION}
       AND ($2::int IS NULL OR p.id < $2)
       AND ($3::boolean = FALSE OR p.auteur_id = $1 OR p.auteur_id IN (
             SELECT CASE WHEN a.demandeur_id = $1 THEN a.receveur_id ELSE a.demandeur_id END
               FROM amities a
              WHERE a.statut = 'acceptee' AND $1 IN (a.demandeur_id, a.receveur_id)))
       AND ($5::text IS NULL OR u.identifiant = $5)
       AND ($6::text IS NULL OR p.type = $6)
       AND ($7::boolean = FALSE OR mr.commentaire IS NULL)
     ORDER BY p.id DESC
     LIMIT $4`,
    [moi.id, avant, seulementAmis, PAR_PAGE + 1, auteur, type, sansReponse], // une de plus pour savoir s'il en reste
  );

  const page = rows.slice(0, PAR_PAGE);
  res.json({
    publications: page.map((ligne) => versPublication(ligne, moi)),
    suivant: rows.length > PAR_PAGE ? page[page.length - 1].id : null,
  });
});

// ---------- Chercher dans les publications ----------
// GET /api/publications/recherche?q=<mots>&type=<type>&apres=<curseur>&court=1
// Tous les mots doivent se trouver dans le texte de la publication ou dans sa meilleure réponse. Les majuscules et
// les accents ne comptent pas (« deploiement » trouve « Déploiement »).
// Pourquoi LIKE et pas la recherche plein texte de PostgreSQL (to_tsvector) : elle coupe les mots selon une langue
// (« french »), alors que le fil mêle français, anglais et noms de techniques (« Node.js », « C# »), et elle ne sait
// pas ignorer les accents sans l'extension « unaccent ». LIKE fait ce qu'on attend, sans extension à installer.
// La requête part de SELECTION : mêmes règles que le fil (corbeille, publications masquées, comptes bloqués ou
// désactivés, confidentialité). Une publication « amis seulement » ne sort donc que pour les amis de son auteur.
// Les questions résolues viennent d'abord, puis les plus récentes. Le curseur « apres » porte les deux : « 1-482 ».
// « court » : les 4 premières, en version légère, pour la liste sous la barre de recherche de l'en-tête.
// Les lettres accentuées (à á â ã ä å ç è é ê ë ì í î ï ñ ò ó ô õ ö ù ú û ü ý ÿ), écrites par leur numéro.
const AVEC_ACCENTS = String.fromCharCode(0xe0, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe7, 0xe8, 0xe9, 0xea, 0xeb, 0xec, 0xed, 0xee, 0xef, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf9, 0xfa, 0xfb, 0xfc, 0xfd, 0xff);
const SANS_ACCENTS = 'aaaaaaceeeeiiiinooooouuuuyy';
const sansAccentSql = (expression) => `translate(lower(${expression}), '${AVEC_ACCENTS}', '${SANS_ACCENTS}')`;
const NB_MOTS_MAX = 6;
const NB_COURT = 4;
// Les mots cherchés : minuscules, sans accent, 2 lettres au moins, 6 mots au plus.
function motsCherches(valeur) {
  const texte = v.texte(valeur, 'q', { max: 100 });
  const mots = texte.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/\s+/).filter((mot) => mot.length >= 2).slice(0, NB_MOTS_MAX);
  if (mots.length === 0) throw new v.ErreurValidation('Écris au moins 2 lettres.', 'q');
  // Dans un LIKE, % et _ sont des jokers : on les neutralise pour chercher le texte tel quel.
  return mots.map((mot) => `%${mot.replace(/[\\%_]/g, '\\$&')}%`);
}
router.get('/recherche', limiteRecherche, async (req, res) => {
  const moi = req.utilisateur;
  const motifs = motsCherches(req.query.q);
  const { type, sansReponse } = lireFiltreType(req.query.type);
  const court = req.query.court === '1';
  const curseur = /^([01])-(\d{1,9})$/.exec(typeof req.query.apres === 'string' ? req.query.apres : '');
  const limite = court ? NB_COURT : PAR_PAGE;
  const { rows } = await db.query(
    `${SELECTION}
       AND NOT EXISTS (SELECT 1 FROM unnest($2::text[]) AS motif
                        WHERE ${sansAccentSql("p.texte || ' ' || COALESCE(mr.commentaire->>'texte', '')")} NOT LIKE motif ESCAPE '\\')
       AND ($3::text IS NULL OR p.type = $3)
       AND ($4::boolean = FALSE OR mr.commentaire IS NULL)
       AND ($5::int IS NULL OR (${RESOLUE}, p.id) < ($5::int, $6::int))
     ORDER BY ${RESOLUE} DESC, p.id DESC
     LIMIT $7`,
    [moi.id, motifs, type, sansReponse, curseur ? Number(curseur[1]) : null, curseur ? Number(curseur[2]) : null, limite + 1],
  );
  const page = rows.slice(0, limite);
  if (court) {
    // Version légère : de quoi écrire une ligne de résultat, rien de plus.
    return res.json({ publications: page.map((ligne) => ({
      id: ligne.id, type: ligne.type, resolue: estResolue(ligne), auteur: apercuMembre(ligne),
      texte: ligne.texte.replace(/\s+/g, ' ').trim().slice(0, 140),
    })), encore: rows.length > limite });
  }
  const derniere = page[page.length - 1];
  res.json({
    publications: page.map((ligne) => versPublication(ligne, moi)),
    suivant: rows.length > limite ? `${estResolue(derniere) ? 1 : 0}-${derniere.id}` : null,
  });
});

// Aperçu d'un lien vidéo avant de publier : GET /api/publications/video?lien=…
// Le navigateur ne devine rien : c'est le serveur qui dit si le lien est reconnu, avec les mêmes règles qu'à la publication.
router.get('/video', (req, res) => {
  const video = lireLienVideo(req.query.lien);
  if (!video) throw new v.ErreurValidation('Colle le lien de la vidéo.', 'video');
  res.json({ video });
});

// Publier : POST /api/publications  { type, texte, image?, video? }  (video = le lien collé par le membre)
router.post('/', limitePublications, async (req, res) => {
  const corps = req.body || {};
  const moi = req.utilisateur;
  const type = v.parmi(corps.type, TYPES, 'type');
  const texte = v.texte(corps.texte, 'texte', { max: 3000 });
  // Le filtre automatique : une insulte ou un lien dangereux est refusé ici ; une phrase d'arnaque met la
  // publication « en attente » (enregistrée mais cachée jusqu'à la vérification d'un administrateur).
  const filtre = await controler(req, [[texte, 'texte']]);
  // Les 3 premiers jours d'un compte : pas de lien (ni dans le texte, ni en vidéo), 5 publications par jour.
  refuserLesLiens(moi, [[texte, 'texte'], [typeof corps.video === 'string' ? corps.video : '', 'video']]);
  await limiterNouveauCompte(moi, 'publication');
  const image = corps.image ? lireImageDataUrl(corps.image) : null;
  const video = lireLienVideo(corps.video);

  const client = await db.pool.connect();
  let id;
  try {
    await client.query('BEGIN');
    let imageId = null;
    if (image) {
      const fichier = await client.query(
        `INSERT INTO fichiers (proprietaire_id, type_mime, taille, donnees)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [moi.id, image.typeMime, image.donnees.length, image.donnees],
      );
      imageId = fichier.rows[0].id;
    }
    const { rows } = await client.query(
      `INSERT INTO publications (auteur_id, type, texte, image, image_largeur, image_hauteur, video_plateforme, video_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [moi.id, type, texte, imageId, image ? image.largeur : null, image ? image.hauteur : null, video ? video.plateforme : null, video ? video.id : null],
    );
    id = rows[0].id;
    if (filtre.enAttente) await mettreEnAttente(client, 'publication', id, moi.id, filtre.raison);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // En attente : rien à afficher dans le fil, seulement la phrase qui prévient l'auteur.
  if (filtre.enAttente) return res.status(202).json({ enAttente: true, message: PHRASE_ATTENTE.publication });
  const { rows } = await db.query(`${SELECTION} AND p.id = $2`, [moi.id, id]);
  res.status(201).json({ publication: versPublication(rows[0], moi) });
});

// Modifier sa publication : PUT /api/publications/:id  { texte }
// Le texte seulement : le type, l'image et la vidéo restent. Pendant 48 heures, par son auteur (pas même un
// administrateur : il masque ou supprime, il ne réécrit pas). L'ancien texte part dans historique_textes.
router.put('/:id', limitePublications, async (req, res) => {
  const moi = req.utilisateur;
  const texte = v.texte(req.body?.texte, 'texte', { max: 3000 });
  const publication = await publicationDeLaRoute(req, res);
  if (!publication) return;
  if (publication.auteur_id !== moi.id) return res.status(403).json({ erreur: 'Tu ne peux modifier que tes propres publications.' });
  const filtre = await controler(req, [[texte, 'texte']]); // le texte corrigé repasse par le filtre
  refuserLesLiens(moi, [[texte, 'texte']]);
  const faite = await db.transaction(async (client) => {
    // La limite des 48 heures est vérifiée ici, avec l'horloge de la base, jamais avec celle du navigateur.
    const { rows: [avant] } = await client.query('SELECT texte FROM publications WHERE id = $1 AND cree_le > now() - make_interval(hours => $2) FOR UPDATE', [publication.id, DUREE_MODIFICATION_H]);
    if (!avant) return false;
    if (avant.texte === texte) return true; // rien n'a changé : pas de mention « modifiée » pour rien
    await client.query('INSERT INTO historique_textes (cible_type, cible_id, auteur_id, texte) VALUES (\'publication\', $1, $2, $3)', [publication.id, moi.id, avant.texte]);
    await client.query('UPDATE publications SET texte = $2, modifiee_le = now() WHERE id = $1', [publication.id, texte]);
    if (filtre.enAttente) await mettreEnAttente(client, 'publication', publication.id, moi.id, filtre.raison);
    return true;
  });
  if (!faite) return res.status(403).json({ erreur: 'Une publication ne peut être modifiée que pendant 48 heures.' });
  if (filtre.enAttente) return res.status(202).json({ enAttente: true, message: PHRASE_ATTENTE.publication });
  const { rows } = await db.query(`${SELECTION} AND p.id = $2`, [moi.id, publication.id]);
  res.json({ publication: versPublication(rows[0], moi) });
});

// Supprimer sa publication : DELETE /api/publications/:id
// Par son auteur : elle part dans SA corbeille (invisible pour tous, restaurable 30 jours dans /parametres).
// Par un administrateur, après un signalement : elle est supprimée pour de bon.
router.delete('/:id', async (req, res) => {
  const moi = req.utilisateur;
  const publication = await publicationDeLaRoute(req, res);
  if (!publication) return;
  if (publication.auteur_id !== moi.id && !moi.est_admin) {
    return res.status(403).json({ erreur: 'Tu ne peux supprimer que tes propres publications.' });
  }
  if (publication.auteur_id === moi.id) {
    await db.query('UPDATE publications SET supprimee_le = now() WHERE id = $1', [publication.id]);
    return res.json({ ok: true, corbeille: true });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    // Les j'aime et les commentaires partent avec la publication (ON DELETE CASCADE).
    await effacerPublication(client, publication.id);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  res.json({ ok: true });
});

// J'aime : POST /api/publications/:id/jaime — on ne peut aimer qu'une fois (clé primaire de la table).
router.post('/:id/jaime', limiteJaime, async (req, res) => {
  const publication = await publicationDeLaRoute(req, res);
  if (!publication) return;
  const moi = req.utilisateur;
  const { rowCount } = await db.query(
    'INSERT INTO jaime (publication_id, utilisateur_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [publication.id, moi.id],
  );
  // Un vrai nouveau j'aime (pas un second clic) : l'auteur est prévenu. Plusieurs j'aime non lus sur la même
  // publication ne font qu'une notification : « Awa et 3 autres ont aimé ta publication ».
  if (rowCount) {
    await notifier(db, publication.auteur_id, 'jaime', (n) => avecLesAutres(moi.nom, n, 'a aimé ta publication.', 'ont aimé ta publication.'),
      `/publication/${publication.id}`, { acteur: moi, cible: { type: 'publication', id: publication.id }, groupe: 'acteurs' });
  }
  res.json(await compteurJaime(publication.id, moi.id));
});

// Je n'aime plus : DELETE /api/publications/:id/jaime
router.delete('/:id/jaime', limiteJaime, async (req, res) => {
  const publication = await publicationDeLaRoute(req, res);
  if (!publication) return;
  const moi = req.utilisateur;
  const { rowCount } = await db.query(
    'DELETE FROM jaime WHERE publication_id = $1 AND utilisateur_id = $2',
    [publication.id, moi.id],
  );
  // Tant que l'auteur n'a pas lu la notification, celui qui n'aime plus en sort (sinon aimer / ne plus aimer
  // en boucle servirait à harceler quelqu'un de notifications).
  if (rowCount) {
    await retirerActeur(publication.auteur_id, 'jaime', { type: 'publication', id: publication.id }, moi.id,
      (nom, n) => avecLesAutres(nom, n, 'a aimé ta publication.', 'ont aimé ta publication.'));
  }
  res.json(await compteurJaime(publication.id, moi.id));
});

// Commentaires d'une publication : GET /api/publications/:id/commentaires
// La meilleure réponse d'abord (pour une question), puis du plus ancien au plus récent.
router.get('/:id/commentaires', async (req, res) => {
  const moi = req.utilisateur;
  const publication = await publicationDeLaRoute(req, res);
  if (!publication) return;
  const { rows } = await db.query(
    `SELECT c.id, c.texte, c.cree_le, c.modifie_le, c.auteur_id, ${COLONNES_MEMBRE}
       FROM commentaires c
       JOIN utilisateurs u ON u.id = c.auteur_id
      WHERE c.publication_id = $1 AND c.masque = FALSE AND u.bloque = FALSE AND u.desactive_le IS NULL
      ORDER BY (c.id = $3::int) IS TRUE DESC, c.id
      LIMIT $2`,
    [publication.id, MAX_COMMENTAIRES_AFFICHES, publication.type === 'question' ? publication.meilleure_reponse_id : null],
  );
  res.json({ commentaires: rows.map((ligne) => versCommentaire(ligne, moi, publication.type === 'question' && ligne.id === publication.meilleure_reponse_id)) });
});

// Commenter : POST /api/publications/:id/commentaires  { texte }
router.post('/:id/commentaires', limiteCommentaires, async (req, res) => {
  const moi = req.utilisateur;
  const texte = v.texte(req.body?.texte, 'texte', { max: 1000 });
  const publication = await publicationDeLaRoute(req, res);
  if (!publication) return;
  const filtre = await controler(req, [[texte, 'texte']]);
  refuserLesLiens(moi, [[texte, 'texte']]);
  await limiterNouveauCompte(moi, 'commentaire');
  const { rows } = await db.query(
    `WITH nouveau AS (
       INSERT INTO commentaires (publication_id, auteur_id, texte) VALUES ($1, $2, $3)
       RETURNING id, texte, cree_le, auteur_id)
     SELECT nouveau.*, ${COLONNES_MEMBRE} FROM nouveau JOIN utilisateurs u ON u.id = nouveau.auteur_id`,
    [publication.id, moi.id, texte],
  );
  // Retenu par le filtre : caché, et personne n'est prévenu tant qu'un administrateur ne l'a pas approuvé.
  if (filtre.enAttente) {
    await db.transaction((client) => mettreEnAttente(client, 'commentaire', rows[0].id, moi.id, filtre.raison));
    return res.status(202).json({ enAttente: true, message: PHRASE_ATTENTE.commentaire });
  }
  // L'auteur de la publication est prévenu (une seule notification pour plusieurs commentateurs non lus)…
  const cible = { type: 'publication', id: publication.id };
  const lien = `/publication/${publication.id}`;
  await notifier(db, publication.auteur_id, 'commentaire', (n) => avecLesAutres(moi.nom, n, 'a commenté ta publication.', 'ont commenté ta publication.'),
    lien, { acteur: moi, cible, groupe: 'acteurs' });
  // … ainsi que ceux qui ont commenté avant moi : la discussion continue (les 10 derniers, sans l'auteur ni moi).
  const { rows: autres } = await db.query(
    `SELECT c.auteur_id FROM commentaires c
       JOIN utilisateurs u ON u.id = c.auteur_id
      WHERE c.publication_id = $1 AND c.masque = FALSE AND u.bloque = FALSE AND u.desactive_le IS NULL AND c.auteur_id NOT IN ($2, $3)
      GROUP BY c.auteur_id ORDER BY max(c.id) DESC LIMIT 10`,
    [publication.id, moi.id, publication.auteur_id],
  );
  for (const autre of autres) {
    await notifier(db, autre.auteur_id, 'reponse_commentaire', (n) => avecLesAutres(moi.nom, n, 'a répondu sous une publication que tu as commentée.', 'ont répondu sous une publication que tu as commentée.'),
      lien, { acteur: moi, cible, groupe: 'acteurs' });
  }
  res.status(201).json({ commentaire: versCommentaire(rows[0], moi) });
});

// Modifier son commentaire : PUT /api/publications/:id/commentaires/:commentaireId  { texte }
// Mêmes règles que pour une publication : par son auteur, pendant 48 heures, l'ancien texte est gardé.
router.put('/:id/commentaires/:commentaireId', limiteCommentaires, async (req, res) => {
  const moi = req.utilisateur;
  const texte = v.texte(req.body?.texte, 'texte', { max: 1000 });
  const publication = await publicationDeLaRoute(req, res);
  if (!publication) return;
  const filtre = await controler(req, [[texte, 'texte']]);
  refuserLesLiens(moi, [[texte, 'texte']]);
  const commentaireId = v.idPositif(req.params.commentaireId);
  const resultat = await db.transaction(async (client) => {
    const { rows: [avant] } = await client.query(
      'SELECT texte, auteur_id, cree_le > now() - make_interval(hours => $3) AS recent FROM commentaires WHERE id = $1 AND publication_id = $2 AND masque = FALSE FOR UPDATE',
      [commentaireId, publication.id, DUREE_MODIFICATION_H],
    );
    if (!avant) return { statut: 404, erreur: 'Ce commentaire n\'existe plus.' };
    if (avant.auteur_id !== moi.id) return { statut: 403, erreur: 'Tu ne peux modifier que tes propres commentaires.' };
    if (!avant.recent) return { statut: 403, erreur: 'Un commentaire ne peut être modifié que pendant 48 heures.' };
    if (avant.texte !== texte) {
      await client.query('INSERT INTO historique_textes (cible_type, cible_id, auteur_id, texte) VALUES (\'commentaire\', $1, $2, $3)', [commentaireId, moi.id, avant.texte]);
      await client.query('UPDATE commentaires SET texte = $2, modifie_le = now() WHERE id = $1', [commentaireId, texte]);
      if (filtre.enAttente) await mettreEnAttente(client, 'commentaire', commentaireId, moi.id, filtre.raison);
    }
    return {};
  });
  if (resultat.erreur) return res.status(resultat.statut).json({ erreur: resultat.erreur });
  if (filtre.enAttente) return res.status(202).json({ enAttente: true, message: PHRASE_ATTENTE.commentaire });
  const { rows } = await db.query(
    `SELECT c.id, c.texte, c.cree_le, c.modifie_le, c.auteur_id, ${COLONNES_MEMBRE} FROM commentaires c JOIN utilisateurs u ON u.id = c.auteur_id WHERE c.id = $1`,
    [commentaireId],
  );
  res.json({ commentaire: versCommentaire(rows[0], moi) });
});

// Supprimer son commentaire : DELETE /api/publications/:id/commentaires/:commentaireId
// Un commentaire supprimé part tout de suite : la corbeille ne concerne que les publications.
router.delete('/:id/commentaires/:commentaireId', async (req, res) => {
  const moi = req.utilisateur;
  const publicationId = v.idPositif(req.params.id);
  const commentaireId = v.idPositif(req.params.commentaireId);
  const { rows } = await db.query(
    'SELECT id, auteur_id FROM commentaires WHERE id = $1 AND publication_id = $2',
    [commentaireId, publicationId],
  );
  if (!rows[0]) return res.status(404).json({ erreur: 'Ce commentaire n\'existe plus.' });
  if (rows[0].auteur_id !== moi.id && !moi.est_admin) {
    return res.status(403).json({ erreur: 'Tu ne peux supprimer que tes propres commentaires.' });
  }
  await db.query('DELETE FROM commentaires WHERE id = $1', [rows[0].id]);
  res.json({ ok: true });
});

// La notification « ta réponse a été retenue », tant qu'elle n'a pas été lue, suit le choix de l'auteur.
function oublierMeilleureReponse(client, publicationId) {
  return client.query("DELETE FROM notifications WHERE type = 'meilleure_reponse' AND cible_type = 'publication' AND cible_id = $1 AND lue = FALSE", [publicationId]);
}

// ---------- Base de savoir : meilleure réponse et recherche ----------

// Choisir la meilleure réponse : PUT /api/publications/:id/meilleure-reponse  { commentaireId }
// Seul l'auteur d'une QUESTION le peut, pour UN commentaire qui n'est pas le sien. Choisir un autre commentaire
// remplace le premier. Tout est revérifié ici : la page ne fait que cacher le bouton à ceux qui n'y ont pas droit.
router.put('/:id/meilleure-reponse', limiteMeilleure, async (req, res) => {
  const moi = req.utilisateur;
  const commentaireId = v.idPositif(req.body?.commentaireId);
  const publication = await publicationDeLaRoute(req, res);
  if (!publication) return;
  if (publication.auteur_id !== moi.id) return res.status(403).json({ erreur: 'Seul l\'auteur de la question peut choisir la meilleure réponse.' });
  if (publication.type !== 'question') return res.status(403).json({ erreur: 'Seule une question peut avoir une meilleure réponse.' });
  const resultat = await db.transaction(async (client) => {
    // La question est verrouillée le temps du choix : deux clics en même temps ne font pas deux notifications.
    const { rows: [question] } = await client.query('SELECT meilleure_reponse_id FROM publications WHERE id = $1 FOR UPDATE', [publication.id]);
    const { rows: [commentaire] } = await client.query(
      `SELECT c.id, c.auteur_id FROM commentaires c
         JOIN utilisateurs u ON u.id = c.auteur_id
        WHERE c.id = $1 AND c.publication_id = $2 AND c.masque = FALSE AND u.bloque = FALSE AND u.desactive_le IS NULL`,
      [commentaireId, publication.id],
    );
    if (!commentaire) return { statut: 404, erreur: 'Ce commentaire n\'existe plus.' };
    if (commentaire.auteur_id === moi.id) return { statut: 403, erreur: 'Tu ne peux pas choisir ta propre réponse.' };
    if (question.meilleure_reponse_id === commentaire.id) return {}; // déjà choisie : rien à refaire
    await client.query('UPDATE publications SET meilleure_reponse_id = $2 WHERE id = $1', [publication.id, commentaire.id]);
    // L'ancienne réponse retenue n'est plus la bonne : sa notification, si elle n'a pas été lue, n'a plus de sens.
    await oublierMeilleureReponse(client, publication.id);
    await notifier(client, commentaire.auteur_id, 'meilleure_reponse', `${moi.nom} a retenu ta réponse comme meilleure réponse.`,
      `/publication/${publication.id}`, { acteur: moi, cible: { type: 'publication', id: publication.id } });
    return {};
  });
  if (resultat.erreur) return res.status(resultat.statut).json({ erreur: resultat.erreur });
  res.json({ ok: true, meilleureReponse: commentaireId });
});

// Retirer la meilleure réponse : DELETE /api/publications/:id/meilleure-reponse (la question redevient « sans réponse »).
router.delete('/:id/meilleure-reponse', limiteMeilleure, async (req, res) => {
  const publication = await publicationDeLaRoute(req, res);
  if (!publication) return;
  if (publication.auteur_id !== req.utilisateur.id) return res.status(403).json({ erreur: 'Seul l\'auteur de la question peut choisir la meilleure réponse.' });
  await db.transaction(async (client) => {
    await client.query('UPDATE publications SET meilleure_reponse_id = NULL WHERE id = $1', [publication.id]);
    await oublierMeilleureReponse(client, publication.id);
  });
  res.json({ ok: true, meilleureReponse: null });
});

module.exports = router;
