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
const { lireLienVideo } = require('../utils/videos');
const { notifier, retirerActeur, avecLesAutres } = require('../utils/notifications');
const { publicationsVisibles } = require('../utils/confidentialite');

const router = express.Router();
const PAR_PAGE = 10;
const TYPES = ['idee', 'question', 'projet'];
const MAX_COMMENTAIRES_AFFICHES = 200;
const COMMENTAIRES_APERCU = 2; // derniers commentaires montrés directement sous chaque publication
const COMMENTAIRES_PAGE = 3;   // sur la page publique d'une publication

const limitePublications = limiteParMembre(30, 15, 'Tu publies très vite. Réessaie dans quelques minutes.');
const limiteCommentaires = limiteParMembre(60, 15, 'Tu commentes très vite. Réessaie dans quelques minutes.');
const limiteJaime = limiteParMembre(300, 15, 'Doucement sur les j\'aime. Réessaie dans quelques minutes.');

// Une publication avec son auteur et ses compteurs. $1 est toujours le membre connecté.
// Les publications masquées par un administrateur et celles des comptes bloqués n'apparaissent jamais.
// Confidentialité : l'auteur choisit qui voit ses publications (tout le monde, les membres, ses amis). La condition
// est dans cette requête commune : le fil, le profil, la page publique et la lecture d'une publication la suivent tous.
// Tout ce qu'il faut pour afficher le fil arrive en UNE requête (sous-requêtes et LATERAL), jamais une par publication :
//  - « aime » : une personne qui a aimé, autre que moi, un de mes amis en priorité (« Aimé par Awa et 12 autres ») ;
//  - « apercu » : les 2 derniers commentaires, avec leur auteur.
const selection = (nbCommentaires = COMMENTAIRES_APERCU) => `
  SELECT p.id, p.type, p.texte, p.image, p.image_largeur, p.image_hauteur, p.video_plateforme, p.video_id, p.cree_le, p.auteur_id, ${COLONNES_MEMBRE},
         aime.nom AS aime_nom, aime.prenom AS aime_prenom, aime.identifiant AS aime_identifiant, apercu.liste AS apercu_commentaires,
         (SELECT count(*)::int FROM jaime j WHERE j.publication_id = p.id) AS nb_jaime,
         (SELECT count(*)::int FROM commentaires c
            JOIN utilisateurs cu ON cu.id = c.auteur_id
           WHERE c.publication_id = p.id AND c.masque = FALSE AND cu.bloque = FALSE) AS nb_commentaires,
         EXISTS (SELECT 1 FROM jaime j WHERE j.publication_id = p.id AND j.utilisateur_id = $1) AS jaime_par_moi
    FROM publications p
    JOIN utilisateurs u ON u.id = p.auteur_id
    LEFT JOIN LATERAL (
      SELECT ju.nom, ju.prenom, ju.identifiant
        FROM jaime j
        JOIN utilisateurs ju ON ju.id = j.utilisateur_id
       WHERE j.publication_id = p.id AND j.utilisateur_id <> $1 AND ju.bloque = FALSE
       ORDER BY EXISTS (SELECT 1 FROM amities a
                         WHERE a.statut = 'acceptee'
                           AND LEAST(a.demandeur_id, a.receveur_id) = LEAST($1, ju.id)
                           AND GREATEST(a.demandeur_id, a.receveur_id) = GREATEST($1, ju.id)) DESC,
                ju.id DESC
       LIMIT 1
    ) aime ON TRUE
    LEFT JOIN LATERAL (
      SELECT json_agg(to_jsonb(d) ORDER BY d.id) AS liste
        FROM (SELECT c.id, c.texte, c.cree_le, c.auteur_id, ${COLONNES_MEMBRE}
                FROM commentaires c
                JOIN utilisateurs u ON u.id = c.auteur_id -- ici « u » est l'auteur du commentaire
               WHERE c.publication_id = p.id AND c.masque = FALSE AND u.bloque = FALSE
               ORDER BY c.id DESC
               LIMIT ${nbCommentaires}) d
    ) apercu ON TRUE
   WHERE p.masque = FALSE AND u.bloque = FALSE AND ${publicationsVisibles('$1')}`;
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
    auteur: apercuMembre(ligne),
    nbJaime: ligne.nb_jaime,
    aimePar: ligne.aime_nom ? { nom: ligne.aime_nom, prenom: ligne.aime_prenom || ligne.aime_nom.split(' ')[0], identifiant: ligne.aime_identifiant } : null,
    derniersCommentaires: (ligne.apercu_commentaires || []).map((c) => versCommentaire(c, moi)),
    nbCommentaires: ligne.nb_commentaires,
    jaimeParMoi: ligne.jaime_par_moi,
    estMoi: ligne.auteur_id === moi.id,
    // L'adresse à partager : la page publique, lisible sans compte.
    lien: `${config.urlPublique}/publication/${ligne.id}`,
  };
}

function versCommentaire(ligne, moi) {
  return {
    id: ligne.id,
    texte: ligne.texte,
    creeLe: ligne.cree_le,
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
      `SELECT p.id, p.auteur_id, p.image FROM publications p
         JOIN utilisateurs u ON u.id = p.auteur_id
        WHERE p.id = $1 AND p.masque = FALSE AND u.bloque = FALSE AND ($3::boolean OR ${publicationsVisibles('$2')})`,
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

// Le fil : GET /api/publications?avant=<id>&amis=1&auteur=<identifiant>
// « auteur » ne garde que les publications d'un membre (onglet « Publications » de son profil).
// Les publications sont chargées par 10, de la plus récente à la plus ancienne.
// « avant » est le numéro de la dernière publication déjà affichée : on demande celles d'avant.
router.get('/', async (req, res) => {
  const moi = req.utilisateur;
  const avant = v.idPositif(req.query.avant);
  const seulementAmis = req.query.amis === '1';
  const auteur = typeof req.query.auteur === 'string' && req.query.auteur ? req.query.auteur.toLowerCase().slice(0, 30) : null;

  const { rows } = await db.query(
    `${SELECTION}
       AND ($2::int IS NULL OR p.id < $2)
       AND ($3::boolean = FALSE OR p.auteur_id = $1 OR p.auteur_id IN (
             SELECT CASE WHEN a.demandeur_id = $1 THEN a.receveur_id ELSE a.demandeur_id END
               FROM amities a
              WHERE a.statut = 'acceptee' AND $1 IN (a.demandeur_id, a.receveur_id)))
       AND ($5::text IS NULL OR u.identifiant = $5)
     ORDER BY p.id DESC
     LIMIT $4`,
    [moi.id, avant, seulementAmis, PAR_PAGE + 1, auteur], // une de plus pour savoir s'il en reste
  );

  const page = rows.slice(0, PAR_PAGE);
  res.json({
    publications: page.map((ligne) => versPublication(ligne, moi)),
    suivant: rows.length > PAR_PAGE ? page[page.length - 1].id : null,
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
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const { rows } = await db.query(`${SELECTION} AND p.id = $2`, [moi.id, id]);
  res.status(201).json({ publication: versPublication(rows[0], moi) });
});

// Supprimer sa publication : DELETE /api/publications/:id
router.delete('/:id', async (req, res) => {
  const moi = req.utilisateur;
  const publication = await publicationDeLaRoute(req, res);
  if (!publication) return;
  if (publication.auteur_id !== moi.id && !moi.est_admin) {
    return res.status(403).json({ erreur: 'Tu ne peux supprimer que tes propres publications.' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    // Les j'aime et les commentaires partent avec la publication (ON DELETE CASCADE).
    await client.query('DELETE FROM publications WHERE id = $1', [publication.id]);
    if (publication.image) {
      await client.query('DELETE FROM fichiers WHERE id = $1', [publication.image]);
    }
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

// Commentaires d'une publication, du plus ancien au plus récent : GET /api/publications/:id/commentaires
router.get('/:id/commentaires', async (req, res) => {
  const moi = req.utilisateur;
  const publication = await publicationDeLaRoute(req, res);
  if (!publication) return;
  const { rows } = await db.query(
    `SELECT c.id, c.texte, c.cree_le, c.auteur_id, ${COLONNES_MEMBRE}
       FROM commentaires c
       JOIN utilisateurs u ON u.id = c.auteur_id
      WHERE c.publication_id = $1 AND c.masque = FALSE AND u.bloque = FALSE
      ORDER BY c.id
      LIMIT $2`,
    [publication.id, MAX_COMMENTAIRES_AFFICHES],
  );
  res.json({ commentaires: rows.map((ligne) => versCommentaire(ligne, moi)) });
});

// Commenter : POST /api/publications/:id/commentaires  { texte }
router.post('/:id/commentaires', limiteCommentaires, async (req, res) => {
  const moi = req.utilisateur;
  const texte = v.texte(req.body?.texte, 'texte', { max: 1000 });
  const publication = await publicationDeLaRoute(req, res);
  if (!publication) return;
  const { rows } = await db.query(
    `WITH nouveau AS (
       INSERT INTO commentaires (publication_id, auteur_id, texte) VALUES ($1, $2, $3)
       RETURNING id, texte, cree_le, auteur_id)
     SELECT nouveau.*, ${COLONNES_MEMBRE} FROM nouveau JOIN utilisateurs u ON u.id = nouveau.auteur_id`,
    [publication.id, moi.id, texte],
  );
  // L'auteur de la publication est prévenu (une seule notification pour plusieurs commentateurs non lus)…
  const cible = { type: 'publication', id: publication.id };
  const lien = `/publication/${publication.id}`;
  await notifier(db, publication.auteur_id, 'commentaire', (n) => avecLesAutres(moi.nom, n, 'a commenté ta publication.', 'ont commenté ta publication.'),
    lien, { acteur: moi, cible, groupe: 'acteurs' });
  // … ainsi que ceux qui ont commenté avant moi : la discussion continue (les 10 derniers, sans l'auteur ni moi).
  const { rows: autres } = await db.query(
    `SELECT c.auteur_id FROM commentaires c
       JOIN utilisateurs u ON u.id = c.auteur_id
      WHERE c.publication_id = $1 AND c.masque = FALSE AND u.bloque = FALSE AND c.auteur_id NOT IN ($2, $3)
      GROUP BY c.auteur_id ORDER BY max(c.id) DESC LIMIT 10`,
    [publication.id, moi.id, publication.auteur_id],
  );
  for (const autre of autres) {
    await notifier(db, autre.auteur_id, 'reponse_commentaire', (n) => avecLesAutres(moi.nom, n, 'a répondu sous une publication que tu as commentée.', 'ont répondu sous une publication que tu as commentée.'),
      lien, { acteur: moi, cible, groupe: 'acteurs' });
  }
  res.status(201).json({ commentaire: versCommentaire(rows[0], moi) });
});

// Supprimer son commentaire : DELETE /api/publications/:id/commentaires/:commentaireId
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

module.exports = router;
