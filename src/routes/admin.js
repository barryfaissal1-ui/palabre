// Tableau de bord administrateur : statistiques, signalements à traiter, projets proposés pour Facebook.
// Toutes les routes exigent un compte connecté dont est_admin est vrai.
const express = require('express');
const db = require('../db/pool');
const v = require('../utils/validation');
const { oublierDomaines } = require('../utils/moderation');
const { sanctionner, annulerSanction, journalModeration, TYPES: TYPES_SANCTION, PHRASES: PHRASES_SANCTION } = require('../utils/sanctions');
const { exigerConnexion, exigerAdmin } = require('../middleware/auth');
const { apercuMembre, COLONNES_MEMBRE } = require('../utils/membres');
const { notifier, court } = require('../utils/notifications');
const { SPECIALITES, EXPERIENCES } = require('../utils/profil-dev');
const config = require('../config');
const { cloreDefisFinis, PHASE: PHASE_DEFI } = require('./defis');

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
  // Message privé : l'administrateur ne voit que le message signalé, jamais le reste de la conversation.
  message: { table: 'messages', auteur: 'auteur_id', texte: 'left(t.texte, 300)', masquable: true, lien: () => null },
  profil: { table: 'utilisateurs', auteur: 'id', texte: 'COALESCE(left(t.bio, 300), \'\')', masquable: false, lien: (c) => `/${c.identifiant}` },
};

// ---------- Statistiques ----------

// GET /api/admin/statistiques — les comptes bloqués et les contenus masqués ne sont pas comptés.
router.get('/statistiques', async (req, res) => {
  const { rows: [s] } = await db.query(
    `SELECT (SELECT count(*)::int FROM utilisateurs WHERE type = 'dev' AND bloque = FALSE AND desactive_le IS NULL AND supprime_le IS NULL) AS devs,
            (SELECT count(*)::int FROM utilisateurs WHERE type = 'client' AND bloque = FALSE AND desactive_le IS NULL AND supprime_le IS NULL) AS clients,
            (SELECT count(*)::int FROM utilisateurs WHERE bloque) AS bloques,
            (SELECT count(*)::int FROM publications WHERE masque = FALSE AND supprimee_le IS NULL) AS publications,
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
  // Une publication ou un commentaire modifié après coup : l'administrateur voit aussi les textes d'avant
  // (historique_textes). Personne d'autre n'y a accès.
  const modifiables = cartes.filter((c) => c.cible && ['publication', 'commentaire'].includes(c.cibleType));
  if (modifiables.length) {
    const { rows: versions } = await db.query(
      `SELECT cible_type, cible_id, left(texte, 300) AS texte, cree_le FROM historique_textes
        WHERE (cible_type = 'publication' AND cible_id = ANY($1::int[])) OR (cible_type = 'commentaire' AND cible_id = ANY($2::int[]))
        ORDER BY id DESC`,
      [modifiables.filter((c) => c.cibleType === 'publication').map((c) => c.cibleId), modifiables.filter((c) => c.cibleType === 'commentaire').map((c) => c.cibleId)],
    );
    modifiables.forEach((carte) => {
      carte.cible.historique = versions.filter((x) => x.cible_type === carte.cibleType && x.cible_id === carte.cibleId).map((x) => ({ texte: x.texte, remplaceLe: x.cree_le }));
    });
  }
  // cible reste null quand le contenu a été supprimé par son auteur entre-temps.
  res.json({ signalements: cartes.map(({ cibleId, ...carte }) => carte) });
});

// ---------- Le filtre automatique : file d'attente et domaines interdits ----------
const CONTENUS = {
  publication: { table: 'publications', auteur: 'auteur_id', texte: 'left(t.texte, 400)', approuve: 'Ta publication a été vérifiée : elle est maintenant visible.', retire: "Ta publication n'a pas été publiée : elle ne respecte pas les règles de la communauté." },
  commentaire: { table: 'commentaires', auteur: 'auteur_id', texte: 'left(t.texte, 400)', approuve: 'Ton commentaire a été vérifié : il est maintenant visible.', retire: "Ton commentaire n'a pas été publié : il ne respecte pas les règles de la communauté." },
  demande: { table: 'demandes', auteur: 'client_id', texte: 'left(t.titre || \' : \' || t.description, 400)', approuve: 'Ta demande a été vérifiée : elle est maintenant visible.', retire: "Ta demande n'a pas été publiée : elle ne respecte pas les règles de la communauté." },
  projet: { table: 'projets', auteur: 'dev_id', texte: 'left(t.titre || \' : \' || COALESCE(t.description, \'\'), 400)', approuve: 'Ton projet a été vérifié : il est maintenant visible.', retire: "Ton projet n'a pas été publié : il ne respecte pas les règles de la communauté." },
};

// GET /api/admin/moderation/attente : la file « À modérer ». Deux origines (champ « raison ») :
//   'arnaque'      : retenu par le filtre automatique avant publication ;
//   'signalements' : caché parce que trois membres différents l'ont signalé.
router.get('/moderation/attente', async (req, res) => {
  const { rows: attentes } = await db.query(
    `SELECT a.id, a.cible_type, a.cible_id, a.raison, a.cree_le, ${COLONNES_MEMBRE}
       FROM moderation_attente a JOIN utilisateurs u ON u.id = a.auteur_id
      WHERE a.decide_le IS NULL ORDER BY a.id LIMIT $1`,
    [MAX_AFFICHES],
  );
  const textes = new Map();
  const motifs = new Map();
  for (const [type, contenu] of Object.entries(CONTENUS)) {
    const ids = attentes.filter((a) => a.cible_type === type).map((a) => a.cible_id);
    if (ids.length === 0) continue;
    const { rows } = await db.query(`SELECT t.id, ${contenu.texte} AS texte FROM ${contenu.table} t WHERE t.id = ANY($1::int[])`, [ids]);
    rows.forEach((ligne) => textes.set(`${type}:${ligne.id}`, ligne.texte));
    // Pour un contenu caché par des signalements : ce que les membres ont dit.
    const { rows: signales } = await db.query('SELECT cible_id, motif FROM signalements WHERE cible_type = $1 AND cible_id = ANY($2::int[]) AND statut = \'ouvert\' ORDER BY id', [type, ids]);
    signales.forEach((s) => motifs.set(`${type}:${s.cible_id}`, [...(motifs.get(`${type}:${s.cible_id}`) || []), s.motif]));
  }
  res.json({
    attente: attentes.map((a) => {
      const cle = `${a.cible_type}:${a.cible_id}`;
      return { id: a.id, cibleType: a.cible_type, raison: a.raison, creeLe: a.cree_le, auteur: apercuMembre(a), texte: textes.get(cle) || null, motifs: motifs.get(cle) || [] };
    }),
  });
});

// Les signalements ouverts sur un contenu sont fermés avec la décision. Un signalement rejeté (le contenu était
// correct) est compté contre son auteur : au bout de trois, ses signalements ne pèsent plus dans le masquage automatique.
async function fermerSignalements(client, cibleType, cibleId, fondes) {
  const { rows } = await client.query(
    'UPDATE signalements SET statut = $3 WHERE cible_type = $1 AND cible_id = $2 AND statut = \'ouvert\' RETURNING auteur_id',
    [cibleType, cibleId, fondes ? 'traite' : 'rejete'],
  );
  if (!fondes && rows.length) {
    await client.query('UPDATE utilisateurs SET signalements_rejetes = signalements_rejetes + 1 WHERE id = ANY($1::int[])', [rows.map((ligne) => ligne.auteur_id)]);
  }
}
const MOTIF_PAR_DEFAUT = 'Contenu contraire aux règles de la communauté.';
const lireSanction = (corps) => ({
  type: corps?.sanction === undefined || corps.sanction === null || corps.sanction === '' ? null : v.parmi(corps.sanction, TYPES_SANCTION, 'sanction'),
  motif: v.texte(corps?.motif, 'motif', { max: 300, optionnel: true }) || MOTIF_PAR_DEFAUT,
});

// POST /api/admin/moderation/attente/:id  { decision: 'approuver' | 'retirer' | 'sanctionner', sanction?, motif? }
//   approuver   : le contenu devient visible ;
//   retirer     : il reste caché ;
//   sanctionner : il reste caché ET son auteur est sanctionné. Sans « sanction », la progression s'applique
//                 (avertissement, puis suspension, puis exclusion) ; avec, l'administrateur choisit directement.
// Dans tous les cas l'auteur est prévenu, et la décision est notée dans le journal de modération.
router.post('/moderation/attente/:id', async (req, res) => {
  const decision = v.parmi(req.body?.decision, ['approuver', 'retirer', 'sanctionner'], 'decision');
  const choix = decision === 'sanctionner' ? lireSanction(req.body) : null;
  const resultat = await db.transaction(async (client) => {
    const { rows: [ligne] } = await client.query('SELECT id, cible_type, cible_id, auteur_id, raison FROM moderation_attente WHERE id = $1 AND decide_le IS NULL FOR UPDATE', [v.idPositif(req.params.id)]);
    if (!ligne) return null;
    const contenu = CONTENUS[ligne.cible_type];
    const approuve = decision === 'approuver';
    if (approuve) await client.query(`UPDATE ${contenu.table} SET masque = FALSE WHERE id = $1`, [ligne.cible_id]);
    await client.query('UPDATE moderation_attente SET decide_le = now(), decision = $2, decide_par = $3 WHERE id = $1', [ligne.id, approuve ? 'approuve' : 'retire', req.utilisateur.id]);
    await fermerSignalements(client, ligne.cible_type, ligne.cible_id, !approuve);
    await journalModeration(client, req.utilisateur.id, approuve ? 'contenu_approuve' : 'contenu_retire', { cibleType: ligne.cible_type, cibleId: ligne.cible_id, membreId: ligne.auteur_id, detail: ligne.raison });
    await notifier(client, ligne.auteur_id, approuve ? 'contenu_approuve' : 'contenu_retire', approuve ? contenu.approuve : contenu.retire,
      approuve && ligne.cible_type === 'publication' ? `/publication/${ligne.cible_id}` : '/regles');
    const sanction = choix ? await sanctionner(client, { membreId: ligne.auteur_id, adminId: req.utilisateur.id, type: choix.type, motif: choix.motif, cibleType: ligne.cible_type, cibleId: ligne.cible_id }) : null;
    return { sanction };
  });
  if (!resultat) throw new v.ErreurHttp(404, 'Ce contenu a déjà été traité.');
  if (resultat.sanction) await resultat.sanction.apres();
  res.json({ ok: true, sanction: resultat.sanction ? resultat.sanction.sanction.type : null });
});

// ---------- Sanctions et contestations ----------

// GET /api/admin/moderation/contestations : les sanctions contestées qui attendent une réponse.
router.get('/moderation/contestations', async (req, res) => {
  const { rows } = await db.query(
    `SELECT s.id, s.type, s.motif, s.debut, s.fin, s.contestation, s.contestee_le, ${COLONNES_MEMBRE}
       FROM sanctions s JOIN utilisateurs u ON u.id = s.utilisateur_id
      WHERE s.contestee_le IS NOT NULL AND s.contestation_decision IS NULL AND s.annulee_le IS NULL
      ORDER BY s.contestee_le LIMIT $1`,
    [MAX_AFFICHES],
  );
  res.json({ contestations: rows.map((s) => ({ id: s.id, type: s.type, motif: s.motif, debut: s.debut, fin: s.fin, texte: s.contestation, contesteeLe: s.contestee_le, membre: apercuMembre(s) })) });
});

// POST /api/admin/sanctions/:id/annuler : la sanction est annulée (contestée ou non), le compte retrouve ses droits.
router.post('/sanctions/:id/annuler', async (req, res) => {
  const annulee = await db.transaction((client) => annulerSanction(client, v.idPositif(req.params.id), req.utilisateur.id));
  if (!annulee) throw new v.ErreurHttp(404, 'Cette sanction est déjà annulée.');
  res.json({ ok: true });
});

// POST /api/admin/sanctions/:id/maintenir : la contestation est rejetée, la sanction reste.
router.post('/sanctions/:id/maintenir', async (req, res) => {
  const maintenue = await db.transaction(async (client) => {
    const { rows: [sanction] } = await client.query(
      `UPDATE sanctions SET contestation_decision = 'rejetee', contestation_decidee_le = now()
        WHERE id = $1 AND contestee_le IS NOT NULL AND contestation_decision IS NULL AND annulee_le IS NULL RETURNING utilisateur_id, type`,
      [v.idPositif(req.params.id)],
    );
    if (!sanction) return null;
    await journalModeration(client, req.utilisateur.id, 'contestation_rejetee', { membreId: sanction.utilisateur_id, detail: sanction.type });
    await notifier(client, sanction.utilisateur_id, 'contestation_rejetee', PHRASES_SANCTION.contestationRejetee, '/sanctions');
    return sanction;
  });
  if (!maintenue) throw new v.ErreurHttp(404, 'Cette contestation a déjà reçu une réponse.');
  res.json({ ok: true });
});

// POST /api/admin/membres/:identifiant/sanctionner  { sanction?, motif }  — sanctionner un membre directement
// (faute grave vue hors d'un signalement).
router.post('/membres/:identifiant/sanctionner', async (req, res) => {
  const choix = lireSanction(req.body);
  const { rows: [membre] } = await db.query('SELECT id FROM utilisateurs WHERE identifiant = $1 AND supprime_le IS NULL', [String(req.params.identifiant).toLowerCase()]);
  if (!membre) throw new v.ErreurHttp(404, 'Ce membre n\'existe pas.');
  const { sanction, apres } = await db.transaction((client) => sanctionner(client, { membreId: membre.id, adminId: req.utilisateur.id, type: choix.type, motif: choix.motif }));
  await apres();
  res.status(201).json({ ok: true, sanction: sanction.type });
});

// GET /api/admin/moderation/journal : qui a décidé quoi, quand (gardé un an).
router.get('/moderation/journal', async (req, res) => {
  const { rows } = await db.query(
    `SELECT j.id, j.action, j.cible_type, j.detail, j.cree_le, a.nom AS admin_nom, m.nom AS membre_nom, m.identifiant AS membre_identifiant
       FROM journal_moderation j LEFT JOIN utilisateurs a ON a.id = j.admin_id LEFT JOIN utilisateurs m ON m.id = j.membre_id
      ORDER BY j.id DESC LIMIT 100`,
  );
  res.json({ journal: rows.map((j) => ({ id: j.id, action: j.action, cibleType: j.cible_type, detail: j.detail, le: j.cree_le, admin: j.admin_nom, membre: j.membre_nom ? { nom: j.membre_nom, identifiant: j.membre_identifiant } : null })) });
});

// Les domaines interdits dans les liens, en plus des listes du filtre : GET, POST { domaine }, DELETE /:domaine
const nomDeDomaine = (valeur) => {
  const domaine = String(valeur || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#:]/)[0];
  if (!/^([a-z0-9-]+\.)+[a-z]{2,24}$/.test(domaine) || domaine.length > 100) throw new v.ErreurValidation('Écris un nom de domaine, comme exemple.com.', 'domaine');
  return domaine;
};
router.get('/domaines-interdits', async (req, res) => {
  const { rows } = await db.query('SELECT domaine, cree_le FROM domaines_interdits ORDER BY domaine LIMIT 500');
  res.json({ domaines: rows.map((ligne) => ({ domaine: ligne.domaine, creeLe: ligne.cree_le })) });
});
router.post('/domaines-interdits', async (req, res) => {
  const domaine = nomDeDomaine(req.body?.domaine);
  await db.query('INSERT INTO domaines_interdits (domaine, ajoute_par) VALUES ($1, $2) ON CONFLICT (domaine) DO NOTHING', [domaine, req.utilisateur.id]);
  oublierDomaines(); // le filtre relit la liste tout de suite
  res.status(201).json({ domaine });
});
router.delete('/domaines-interdits/:domaine', async (req, res) => {
  await db.query('DELETE FROM domaines_interdits WHERE domaine = $1', [String(req.params.domaine).toLowerCase()]);
  oublierDomaines();
  res.json({ ok: true });
});

// POST /api/admin/signalements/:id/traiter  { action: 'masquer' | 'bloquer' | 'classer' }
//   masquer : le contenu disparaît du site pour tout le monde ;
//   bloquer : le membre signalé ne peut plus se connecter et tout ce qu'il a publié disparaît ;
//   classer : sans suite, rien ne change.
// La décision vaut pour tous les signalements ouverts qui visent le même contenu.
router.post('/signalements/:id/traiter', async (req, res) => {
  const moi = req.utilisateur;
  const action = v.parmi(req.body?.action, ['masquer', 'bloquer', 'classer', 'sanctionner'], 'action');
  const choix = action === 'sanctionner' ? lireSanction(req.body) : null;

  const suite = await db.transaction(async (client) => {
    let sanction = null;
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
    // « Sanctionner » : le contenu est caché (s'il peut l'être) et son auteur reçoit la sanction qui vient
    // (avertissement, suspension, exclusion), ou celle que l'administrateur a choisie.
    if (action === 'sanctionner') {
      const { rows: [membre] } = await client.query(
        `SELECT u.id FROM ${cible.table} t JOIN utilisateurs u ON u.id = t.${cible.auteur} WHERE t.id = $1`,
        [signalement.cible_id],
      );
      if (!membre) throw new v.ErreurValidation('Ce contenu a été supprimé par son auteur : classe le signalement.', 'action');
      if (cible.masquable) await client.query(`UPDATE ${cible.table} SET masque = TRUE WHERE id = $1`, [signalement.cible_id]);
      sanction = await sanctionner(client, { membreId: membre.id, adminId: moi.id, type: choix.type, motif: choix.motif, cibleType: signalement.cible_type, cibleId: signalement.cible_id });
    }
    await fermerSignalements(client, signalement.cible_type, signalement.cible_id, action !== 'classer');
    // Si ce contenu était aussi dans la file « À modérer », la décision vaut pour elle.
    const { rows: enFile } = await client.query(
      'UPDATE moderation_attente SET decide_le = now(), decision = $3, decide_par = $4 WHERE cible_type = $1 AND cible_id = $2 AND decide_le IS NULL RETURNING raison',
      [signalement.cible_type, signalement.cible_id, action === 'classer' ? 'approuve' : 'retire', moi.id],
    );
    // Classé sans suite : un contenu que trois signalements avaient caché redevient visible.
    if (action === 'classer' && cible.masquable && enFile.some((ligne) => ligne.raison === 'signalements')) {
      await client.query(`UPDATE ${cible.table} SET masque = FALSE WHERE id = $1`, [signalement.cible_id]);
    }
    if (action !== 'sanctionner') await journalModeration(client, moi.id, `signalement_${action}`, { cibleType: signalement.cible_type, cibleId: signalement.cible_id });
    return sanction;
  });
  if (suite) await suite.apres();
  res.json({ ok: true, sanction: suite ? suite.sanction.type : null });
});

// ---------- Membres bloqués (pour pouvoir revenir sur une erreur) ----------

router.get('/membres-bloques', async (req, res) => {
  const { rows } = await db.query(
    `SELECT ${COLONNES_MEMBRE} FROM utilisateurs u WHERE u.bloque AND u.supprime_le IS NULL ORDER BY u.nom LIMIT $1`,
    [MAX_AFFICHES],
  );
  // Un compte bloqué qui s'est aussi désactivé garde ici son nom et son identifiant : sans eux, l'administrateur
  // ne pourrait plus le débloquer (« Membre indisponible » n'a pas d'adresse).
  res.json({ membres: rows.map((ligne) => apercuMembre({ ...ligne, desactive_le: null })) });
});

// ---------- Derniers inscrits ----------

// GET /api/admin/membres-recents — les 50 derniers comptes, avec ce que seul l'administrateur peut voir :
// l'âge des devs (calculé par la base à partir de la date de naissance, qui elle-même ne sort pas) et où en est leur inscription.
router.get('/membres-recents', async (req, res) => {
  const { rows } = await db.query(
    `SELECT ${COLONNES_MEMBRE}, u.cree_le, u.specialite, u.experience,
            date_part('year', age(current_date, u.date_naissance))::int AS age,
            u.email_confirme_le IS NOT NULL AS email_confirme,
            u.profil_complete_le IS NOT NULL AS profil_complet,
            num_nonnulls(u.lien_github, u.lien_gitlab, u.lien_portfolio, u.lien_linkedin) AS nb_liens
       FROM utilisateurs u WHERE u.bloque = FALSE AND u.supprime_le IS NULL ORDER BY u.cree_le DESC, u.id DESC LIMIT $1`,
    [MAX_AFFICHES],
  );
  res.json({
    membres: rows.map((ligne) => ({
      ...apercuMembre(ligne),
      inscritLe: ligne.cree_le,
      age: ligne.age,
      specialite: SPECIALITES[ligne.specialite] || null,
      experience: EXPERIENCES[ligne.experience] || null,
      emailConfirme: ligne.email_confirme,
      profilComplet: ligne.type_compte === 'client' || ligne.profil_complet,
      sansLien: ligne.type_compte === 'dev' && ligne.profil_complet && ligne.nb_liens === 0,
    })),
  });
});

// POST /api/admin/membres/:identifiant/debloquer
router.post('/membres/:identifiant/debloquer', async (req, res) => {
  await db.transaction(async (client) => {
    const { rows: [membre] } = await client.query(
      'UPDATE utilisateurs SET bloque = FALSE WHERE identifiant = $1 AND bloque RETURNING id',
      [String(req.params.identifiant).toLowerCase()],
    );
    if (!membre) throw new v.ErreurHttp(404, 'Ce membre n\'est pas bloqué.');
    await journalModeration(client, req.utilisateur.id, 'membre_debloque', { membreId: membre.id });
  });
  res.json({ ok: true });
});

// ---------- Projets proposés pour la page Facebook ----------

// GET /api/admin/projets-facebook — projets dont le dev a donné son accord, en attente de décision.
router.get('/projets-facebook', async (req, res) => {
  const { rows } = await db.query(
    `SELECT p.id, p.titre, p.description, p.secteur, p.lien, p.image, p.lien_verifie_le, p.cree_le, ${COLONNES_MEMBRE}
       FROM projets p
       JOIN utilisateurs u ON u.id = p.dev_id
      WHERE p.statut_facebook = 'en_attente' AND p.publier_facebook AND p.masque = FALSE AND u.bloque = FALSE AND u.desactive_le IS NULL
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

// ---------- À publier sur Facebook (plan B : l'administrateur publie lui-même sur la page « Palabre Dev ») ----------
// Le site prépare le texte et ouvre la fenêtre de partage de Facebook ; l'administrateur publie, puis marque le projet
// « publié ». Aucun mot de passe ni jeton Facebook n'est donc gardé par Palabre.

const MAX_FACEBOOK_PAR_JOUR = 5; // règle du plan : 3 à 5 publications par jour au plus, pour ne pas lasser les abonnés
const VERROU_FACEBOOK = 20261026; // numéro arbitraire du verrou qui fait passer les « marquer comme publié » un par un
// Les publications d'aujourd'hui, le jour étant compté en heure GMT (celle de Ouagadougou), quel que soit le réglage du serveur.
const PUBLIES_AUJOURDHUI = `SELECT count(*)::int AS nb FROM projets
  WHERE statut_facebook = 'publie' AND (publie_facebook_le AT TIME ZONE 'UTC')::date = (now() AT TIME ZONE 'UTC')::date`;

// Le texte proposé pour la publication. Construit ici, avec les données du projet ; la page l'affiche avec textContent
// dans une zone de texte, où l'administrateur peut le retoucher avant de le copier.
function texteFacebook(projet, adresse) {
  const description = String(projet.description || '').replace(/\s+/g, ' ').trim();
  return [
    `« ${projet.titre} », un projet réalisé par ${projet.nom} (${projet.ville}, ${projet.pays}).`,
    description ? (description.length > 220 ? `${description.slice(0, 219)}…` : description) : null,
    `Secteur : ${v.SECTEURS_PROJET[projet.secteur] || 'Autre'}`,
    `À découvrir sur Palabre : ${adresse}`,
    '#Palabre #DevAfrique #TechAfricaine',
  ].filter(Boolean).join('\n\n');
}

// GET /api/admin/facebook-a-publier — les projets validés, avec leur texte prêt et le compteur du jour.
router.get('/facebook-a-publier', async (req, res) => {
  const [{ rows }, { rows: [jour] }] = await Promise.all([
    db.query(
      `SELECT p.id, p.titre, p.description, p.secteur, p.lien, p.image, p.lien_verifie_le, p.cree_le, ${COLONNES_MEMBRE}
         FROM projets p
         JOIN utilisateurs u ON u.id = p.dev_id
        WHERE p.statut_facebook = 'valide' AND p.publier_facebook AND p.masque = FALSE AND u.bloque = FALSE AND u.desactive_le IS NULL
        ORDER BY p.id
        LIMIT $1`,
      [MAX_AFFICHES],
    ),
    db.query(PUBLIES_AUJOURDHUI),
  ]);
  res.json({
    publiesAujourdhui: jour.nb,
    maxParJour: MAX_FACEBOOK_PAR_JOUR,
    projets: rows.map((ligne) => {
      // L'adresse publique du projet : c'est elle que Facebook visite pour dessiner la carte (titre, image, description).
      const adresse = `${config.urlPublique}/projets/${ligne.id}`;
      return {
        id: ligne.id,
        titre: ligne.titre,
        description: ligne.description,
        nomSecteur: v.SECTEURS_PROJET[ligne.secteur] || 'Autre',
        lien: ligne.lien,
        lienVerifie: Boolean(ligne.lien && ligne.lien_verifie_le),
        image: ligne.image ? `/fichiers/${ligne.image}` : null,
        creeLe: ligne.cree_le,
        dev: apercuMembre(ligne),
        adresse,
        texte: texteFacebook(ligne, adresse),
        lienPartage: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(adresse)}`,
      };
    }),
  });
});

// POST /api/admin/projets/:id/facebook-publie — « Marquer comme publié » : valide → publie, avec la date.
router.post('/projets/:id/facebook-publie', async (req, res) => {
  const publies = await db.transaction(async (client) => {
    // Verrou : deux clics au même instant passent l'un après l'autre, la limite du jour ne peut pas être dépassée.
    await client.query('SELECT pg_advisory_xact_lock($1)', [VERROU_FACEBOOK]);
    const { rows: [jour] } = await client.query(PUBLIES_AUJOURDHUI);
    if (jour.nb >= MAX_FACEBOOK_PAR_JOUR) {
      throw new v.ErreurValidation(`Déjà ${MAX_FACEBOOK_PAR_JOUR} publications aujourd'hui : c'est le maximum. Garde ce projet pour demain.`);
    }
    const { rows: [projet] } = await client.query(
      `UPDATE projets SET statut_facebook = 'publie', publie_facebook_le = now()
        WHERE id = $1 AND statut_facebook = 'valide' AND masque = FALSE
        RETURNING id, dev_id, titre`,
      [v.idPositif(req.params.id)],
    );
    if (!projet) throw new v.ErreurHttp(404, 'Ce projet n\'est pas (ou plus) en attente de publication.');
    await notifier(client, projet.dev_id, 'projet_facebook',
      `Ton projet « ${court(projet.titre)} » a été partagé sur la page Facebook Palabre Dev.`, `/projets/${projet.id}`);
    return jour.nb + 1;
  });
  res.json({ ok: true, publiesAujourdhui: publies, maxParJour: MAX_FACEBOOK_PAR_JOUR });
});

// ---------- Défi de la semaine ----------

const DUREE_MAX_DEFI_JOURS = 60;

// Une date envoyée par le formulaire (format ISO) ; erreur sur le champ si elle est illisible.
function dateDuFormulaire(valeur, champ) {
  const date = typeof valeur === 'string' && valeur.length <= 40 ? new Date(valeur) : null;
  if (!date || Number.isNaN(date.getTime())) throw new v.ErreurValidation('Date invalide.', champ);
  return date;
}

// GET /api/admin/defis — les derniers défis, avec leur phase.
router.get('/defis', async (req, res) => {
  await cloreDefisFinis();
  const { rows } = await db.query(
    `SELECT d.id, d.titre, d.fin_reponses_le, d.fin_vote_le, ${PHASE_DEFI} AS phase, g.nom AS gagnant,
            (SELECT count(*)::int FROM defi_reponses r WHERE r.defi_id = d.id) AS nb_reponses,
            (SELECT count(*)::int FROM defi_votes vo WHERE vo.defi_id = d.id) AS nb_votes
       FROM defis d LEFT JOIN utilisateurs g ON g.id = d.gagnant_id
      WHERE d.statut IN ('ouvert', 'termine')
      ORDER BY d.id DESC LIMIT 10`,
  );
  res.json({
    defis: rows.map((d) => ({ id: d.id, titre: d.titre, phase: d.phase, finReponsesLe: d.fin_reponses_le, finVoteLe: d.fin_vote_le, nbReponses: d.nb_reponses, nbVotes: d.nb_votes, gagnant: d.gagnant })),
  });
});

// POST /api/admin/defis  { titre, probleme, finReponsesLe, finVoteLe } — un seul défi en cours à la fois.
router.post('/defis', async (req, res) => {
  const corps = req.body || {};
  const titre = v.texte(corps.titre, 'titre', { min: 5, max: 120 });
  const probleme = v.texte(corps.probleme, 'probleme', { min: 20, max: 3000 });
  const finReponses = dateDuFormulaire(corps.finReponsesLe, 'finReponsesLe');
  const finVote = dateDuFormulaire(corps.finVoteLe, 'finVoteLe');
  if (finReponses.getTime() <= Date.now()) throw new v.ErreurValidation('La fin des réponses doit être dans le futur.', 'finReponsesLe');
  if (finVote.getTime() <= finReponses.getTime()) throw new v.ErreurValidation('Le vote doit finir après les réponses.', 'finVoteLe');
  if (finVote.getTime() > Date.now() + DUREE_MAX_DEFI_JOURS * 24 * 3600 * 1000) throw new v.ErreurValidation(`Un défi dure ${DUREE_MAX_DEFI_JOURS} jours au plus.`, 'finVoteLe');

  await cloreDefisFinis();
  const id = await db.transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [VERROU_FACEBOOK + 1]); // deux créations au même instant passent l'une après l'autre
    const { rowCount } = await client.query('SELECT 1 FROM defis WHERE statut = \'ouvert\'');
    if (rowCount > 0) throw new v.ErreurValidation('Un défi est déjà en cours. Attends sa fin, ou supprime-le.');
    const { rows: [defi] } = await client.query(
      `INSERT INTO defis (auteur_id, titre, probleme, fin_reponses_le, fin_vote_le, statut) VALUES ($1, $2, $3, $4, $5, 'ouvert') RETURNING id`,
      [req.utilisateur.id, titre, probleme, finReponses, finVote],
    );
    return defi.id;
  });
  res.status(201).json({ id });
});

// DELETE /api/admin/defis/:id — supprime un défi (ses réponses et ses votes partent avec, ON DELETE CASCADE).
router.delete('/defis/:id', async (req, res) => {
  const { rowCount } = await db.query('DELETE FROM defis WHERE id = $1', [v.idPositif(req.params.id)]);
  if (rowCount === 0) throw new v.ErreurHttp(404, 'Ce défi n\'existe pas.');
  res.json({ ok: true });
});

module.exports = router;
