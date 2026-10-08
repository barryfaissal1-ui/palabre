// Tableau de bord administrateur : statistiques, signalements à traiter, projets proposés pour Facebook.
// Toutes les routes exigent un compte connecté dont est_admin est vrai.
const express = require('express');
const db = require('../db/pool');
const v = require('../utils/validation');
const { exigerConnexion, exigerAdmin } = require('../middleware/auth');
const { apercuMembre, COLONNES_MEMBRE } = require('../utils/membres');
const { notifier, court } = require('../utils/notifications');

const router = express.Router();
const MAX_AFFICHES = 50;

router.use(exigerConnexion, exigerAdmin);

// Pour chaque type de contenu signalé : sa table, la colonne de son auteur, le texte à montrer
// à l'administrateur, et s'il peut être masqué. Ces noms sont écrits ici, jamais reçus d'un membre.
const CIBLES = {
  publication: { table: 'publications', auteur: 'auteur_id', texte: 'left(t.texte, 300)', masquable: true, lien: () => null },
  commentaire: { table: 'commentaires', auteur: 'auteur_id', texte: 'left(t.texte, 300)', masquable: true, lien: () => null },
  demande: { table: 'demandes', auteur: 'client_id', texte: 't.titre || \' — \' || left(t.description, 200)', masquable: true, lien: (c) => `/demande?id=${c.id}` },
  projet: { table: 'projets', auteur: 'dev_id', texte: 't.titre || COALESCE(\' — \' || left(t.description, 200), \'\')', masquable: true, lien: (c) => `/projets/${c.id}` },
  profil: { table: 'utilisateurs', auteur: 'id', texte: 'COALESCE(left(t.bio, 300), \'\')', masquable: false, lien: (c) => `/${c.identifiant}` },
};

// ---------- Statistiques ----------

// GET /api/admin/statistiques — les comptes bloqués et les contenus masqués ne sont pas comptés.
router.get('/statistiques', async (req, res) => {
  const { rows: [s] } = await db.query(
    `SELECT (SELECT count(*)::int FROM utilisateurs WHERE type = 'dev' AND bloque = FALSE) AS devs,
            (SELECT count(*)::int FROM utilisateurs WHERE type = 'client' AND bloque = FALSE) AS clients,
            (SELECT count(*)::int FROM utilisateurs WHERE bloque) AS bloques,
            (SELECT count(*)::int FROM publications WHERE masque = FALSE) AS publications,
            (SELECT count(*)::int FROM demandes WHERE masque = FALSE) AS demandes,
            (SELECT count(*)::int FROM projets WHERE masque = FALSE) AS projets,
            (SELECT count(*)::int FROM propositions WHERE statut = 'acceptee') AS propositions_acceptees,
            (SELECT count(*)::int FROM signalements WHERE statut = 'ouvert') AS signalements_ouverts,
            (SELECT count(*)::int FROM projets WHERE statut_facebook = 'en_attente' AND masque = FALSE) AS projets_facebook`,
  );
  res.json({
    statistiques: {
      devs: s.devs,
      clients: s.clients,
      membresBloques: s.bloques,
      publications: s.publications,
      demandes: s.demandes,
      projets: s.projets,
      propositionsAcceptees: s.propositions_acceptees,
      signalementsOuverts: s.signalements_ouverts,
      projetsFacebook: s.projets_facebook,
    },
  });
});

// ---------- Signalements ----------

// GET /api/admin/signalements — les signalements ouverts, regroupés par contenu signalé :
// si trois membres signalent la même publication, l'administrateur voit une seule carte avec trois motifs.
router.get('/signalements', async (req, res) => {
  const { rows } = await db.query(
    `SELECT s.id, s.cible_type, s.cible_id, s.motif, s.cree_le, ${COLONNES_MEMBRE}
       FROM signalements s
       JOIN utilisateurs u ON u.id = s.auteur_id
      WHERE s.statut = 'ouvert'
      ORDER BY s.id
      LIMIT $1`,
    [MAX_AFFICHES * 4],
  );

  const groupes = new Map(); // « type:id » → carte
  rows.forEach((ligne) => {
    const cle = `${ligne.cible_type}:${ligne.cible_id}`;
    if (!groupes.has(cle)) {
      groupes.set(cle, { id: ligne.id, cibleType: ligne.cible_type, cibleId: ligne.cible_id, cible: null, signalements: [] });
    }
    groupes.get(cle).signalements.push({ motif: ligne.motif, creeLe: ligne.cree_le, auteur: apercuMembre(ligne) });
  });
  const cartes = [...groupes.values()].slice(0, MAX_AFFICHES);

  // Une requête par type de contenu pour retrouver ce qui est signalé et son auteur.
  for (const [type, cible] of Object.entries(CIBLES)) {
    const ids = cartes.filter((c) => c.cibleType === type).map((c) => c.cibleId);
    if (ids.length === 0) continue;
    const { rows: contenus } = await db.query(
      `SELECT t.id, ${cible.texte} AS texte, ${cible.masquable ? 't.masque' : 'FALSE'} AS masque,
              u.est_admin, u.bloque, ${COLONNES_MEMBRE}
         FROM ${cible.table} t
         JOIN utilisateurs u ON u.id = t.${cible.auteur}
        WHERE t.id = ANY($1::int[])`,
      [ids],
    );
    contenus.forEach((contenu) => {
      const carte = cartes.find((c) => c.cibleType === type && c.cibleId === contenu.id);
      carte.cible = {
        texte: contenu.texte,
        lien: contenu.masque || contenu.bloque ? null : cible.lien(contenu),
        masquable: cible.masquable,
        dejaMasque: contenu.masque,
        membre: apercuMembre(contenu),
        membreBloque: contenu.bloque,
        membreEstAdmin: contenu.est_admin,
      };
    });
  }
  // cible reste null quand le contenu a été supprimé par son auteur entre-temps.
  res.json({ signalements: cartes.map(({ cibleId, ...carte }) => carte) });
});

// POST /api/admin/signalements/:id/traiter  { action: 'masquer' | 'bloquer' | 'classer' }
//   masquer : le contenu disparaît du site pour tout le monde ;
//   bloquer : le membre signalé ne peut plus se connecter et tout ce qu'il a publié disparaît ;
//   classer : sans suite, rien ne change.
// La décision vaut pour tous les signalements ouverts qui visent le même contenu.
router.post('/signalements/:id/traiter', async (req, res) => {
  const moi = req.utilisateur;
  const action = v.parmi(req.body?.action, ['masquer', 'bloquer', 'classer'], 'action');

  await db.transaction(async (client) => {
    const { rows: [signalement] } = await client.query(
      'SELECT cible_type, cible_id FROM signalements WHERE id = $1 AND statut = \'ouvert\' FOR UPDATE',
      [v.idPositif(req.params.id)],
    );
    if (!signalement) throw new v.ErreurHttp(404, 'Ce signalement a déjà été traité.');
    const cible = CIBLES[signalement.cible_type];

    if (action === 'masquer') {
      if (!cible.masquable) throw new v.ErreurValidation('Un profil ne se masque pas : bloque le membre ou classe le signalement.', 'action');
      await client.query(`UPDATE ${cible.table} SET masque = TRUE WHERE id = $1`, [signalement.cible_id]);
    }
    if (action === 'bloquer') {
      const { rows: [membre] } = await client.query(
        `SELECT u.id, u.est_admin FROM ${cible.table} t JOIN utilisateurs u ON u.id = t.${cible.auteur} WHERE t.id = $1`,
        [signalement.cible_id],
      );
      if (!membre) throw new v.ErreurValidation('Ce contenu a été supprimé par son auteur : classe le signalement.', 'action');
      if (membre.est_admin || membre.id === moi.id) throw new v.ErreurValidation('Un administrateur ne peut pas être bloqué.', 'action');
      await client.query('UPDATE utilisateurs SET bloque = TRUE WHERE id = $1', [membre.id]);
    }
    await client.query(
      'UPDATE signalements SET statut = $3 WHERE cible_type = $1 AND cible_id = $2 AND statut = \'ouvert\'',
      [signalement.cible_type, signalement.cible_id, action === 'classer' ? 'rejete' : 'traite'],
    );
  });
  res.json({ ok: true });
});

// ---------- Membres bloqués (pour pouvoir revenir sur une erreur) ----------

router.get('/membres-bloques', async (req, res) => {
  const { rows } = await db.query(
    `SELECT ${COLONNES_MEMBRE} FROM utilisateurs u WHERE u.bloque ORDER BY u.nom LIMIT $1`,
    [MAX_AFFICHES],
  );
  res.json({ membres: rows.map(apercuMembre) });
});

// POST /api/admin/membres/:identifiant/debloquer
router.post('/membres/:identifiant/debloquer', async (req, res) => {
  const { rowCount } = await db.query(
    'UPDATE utilisateurs SET bloque = FALSE WHERE identifiant = $1 AND bloque',
    [String(req.params.identifiant).toLowerCase()],
  );
  if (rowCount === 0) throw new v.ErreurHttp(404, 'Ce membre n\'est pas bloqué.');
  res.json({ ok: true });
});

// ---------- Projets proposés pour la page Facebook ----------

// GET /api/admin/projets-facebook — projets dont le dev a donné son accord, en attente de décision.
router.get('/projets-facebook', async (req, res) => {
  const { rows } = await db.query(
    `SELECT p.id, p.titre, p.description, p.secteur, p.lien, p.image, p.lien_verifie_le, p.cree_le, ${COLONNES_MEMBRE}
       FROM projets p
       JOIN utilisateurs u ON u.id = p.dev_id
      WHERE p.statut_facebook = 'en_attente' AND p.publier_facebook AND p.masque = FALSE AND u.bloque = FALSE
      ORDER BY p.id
      LIMIT $1`,
    [MAX_AFFICHES],
  );
  res.json({
    projets: rows.map((ligne) => ({
      id: ligne.id,
      titre: ligne.titre,
      description: ligne.description,
      nomSecteur: v.SECTEURS_PROJET[ligne.secteur] || 'Autre',
      lien: ligne.lien,
      lienVerifie: Boolean(ligne.lien && ligne.lien_verifie_le),
      image: ligne.image ? `/fichiers/${ligne.image}` : null,
      creeLe: ligne.cree_le,
      dev: apercuMembre(ligne),
    })),
  });
});

// POST /api/admin/projets/:id/facebook  { decision: 'valide' | 'refuse' }
// « valide » = le projet pourra être publié sur la page Facebook (la publication elle-même viendra ensuite).
router.post('/projets/:id/facebook', async (req, res) => {
  const decision = v.parmi(req.body?.decision, ['valide', 'refuse'], 'decision');
  await db.transaction(async (client) => {
    const { rows: [projet] } = await client.query(
      `UPDATE projets SET statut_facebook = $2
        WHERE id = $1 AND statut_facebook = 'en_attente'
        RETURNING id, dev_id, titre`,
      [v.idPositif(req.params.id), decision],
    );
    if (!projet) throw new v.ErreurHttp(404, 'Ce projet n\'attend plus de décision.');
    await notifier(client, projet.dev_id, 'projet_facebook',
      decision === 'valide'
        ? `Ton projet « ${court(projet.titre)} » a été retenu pour la page Facebook de Palabre.`
        : `Ton projet « ${court(projet.titre)} » n'a pas été retenu pour la page Facebook. Il reste visible sur Palabre.`,
      `/projets/${projet.id}`);
  });
  res.json({ ok: true });
});

module.exports = router;
