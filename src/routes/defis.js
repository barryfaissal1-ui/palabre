// Défi de la semaine : un problème posé par l'équipe, les réponses des devs, le vote des membres, un gagnant.
//
// Un défi a deux dates : la fin des réponses, puis la fin du vote. Sa « phase » se déduit de l'heure :
//   avant fin_reponses_le → 'reponses' (les devs répondent, et peuvent modifier leur réponse) ;
//   avant fin_vote_le     → 'vote'     (chaque membre vote pour une réponse, et peut changer d'avis) ;
//   après                 → 'termine'  (le gagnant est désigné, les compteurs de votes sont montrés).
// Aucune tâche programmée : le gagnant est désigné à la première lecture qui suit la fin du vote (cloreDefisFinis).
const express = require('express');
const db = require('../db/pool');
const v = require('../utils/validation');
const liens = require('../utils/liens'); // « liens.verifierLien » : les tests peuvent le remplacer
const { exigerConnexion, exigerDev, exigerProfilComplet } = require('../middleware/auth');
const { apercuMembre, COLONNES_MEMBRE, limiteParMembre } = require('../utils/membres');
const { notifier, court } = require('../utils/notifications');

const router = express.Router();
const limiteReponses = limiteParMembre(20, 60, 'Tu modifies ta réponse très souvent. Réessaie plus tard.');
const limiteVotes = limiteParMembre(60, 60, 'Tu changes de vote très souvent. Réessaie plus tard.');

// La phase d'un défi, calculée par la base (son horloge fait foi, pas celle du navigateur).
const PHASE = `CASE WHEN d.statut = 'termine' OR now() >= d.fin_vote_le THEN 'termine'
                    WHEN now() >= d.fin_reponses_le THEN 'vote' ELSE 'reponses' END`;

// Désigne le gagnant des défis dont le vote est fini : le plus de votes, et la réponse la plus ancienne en cas
// d'égalité. Sans aucun vote (ou sans réponse), il n'y a pas de gagnant. Les comptes bloqués ne comptent pas.
// FOR UPDATE SKIP LOCKED : si deux lectures arrivent au même instant, une seule s'occupe du défi ;
// l'autre le saute. Le gagnant ne peut donc pas être désigné (ni prévenu) deux fois.
async function cloreDefisFinis() {
  await db.transaction(async (client) => {
    const { rows: finis } = await client.query(
      'SELECT id, titre FROM defis WHERE statut = \'ouvert\' AND fin_vote_le <= now() ORDER BY id FOR UPDATE SKIP LOCKED',
    );
    for (const defi of finis) {
      const { rows: [premier] } = await client.query(
        `SELECT r.id, r.dev_id, count(vo.utilisateur_id)::int AS nb_votes
           FROM defi_reponses r
           JOIN utilisateurs u ON u.id = r.dev_id AND u.bloque = FALSE AND u.desactive_le IS NULL
           LEFT JOIN defi_votes vo ON vo.reponse_id = r.id
                AND EXISTS (SELECT 1 FROM utilisateurs votant WHERE votant.id = vo.utilisateur_id AND votant.bloque = FALSE AND votant.desactive_le IS NULL)
          WHERE r.defi_id = $1
          GROUP BY r.id
          ORDER BY nb_votes DESC, r.id ASC
          LIMIT 1`,
        [defi.id],
      );
      const gagnant = premier && premier.nb_votes > 0 ? premier : null;
      await client.query(
        'UPDATE defis SET statut = \'termine\', gagnant_id = $2, gagnant_reponse_id = $3 WHERE id = $1',
        [defi.id, gagnant ? gagnant.dev_id : null, gagnant ? gagnant.id : null],
      );
      if (gagnant) {
        await notifier(client, gagnant.dev_id, 'defi_gagne',
          `Bravo : ta réponse a gagné le défi « ${court(defi.titre)} ». Le badge « Gagnant du défi » est sur ton profil. Ajoute ton projet et propose-le pour la page Facebook.`,
          '/defis');
      }
    }
  });
}

// Le défi à montrer : celui en cours, sinon le dernier terminé (pour voir le gagnant). $1 = date limite d'affichage.
const SELECTION_DEFI = `
  SELECT d.id, d.titre, d.probleme, d.fin_reponses_le, d.fin_vote_le, d.gagnant_reponse_id, ${PHASE} AS phase,
         (SELECT count(*)::int FROM defi_reponses r JOIN utilisateurs ru ON ru.id = r.dev_id AND ru.bloque = FALSE AND ru.desactive_le IS NULL
           WHERE r.defi_id = d.id) AS nb_reponses
    FROM defis d
   WHERE d.statut IN ('ouvert', 'termine')
   ORDER BY (d.statut = 'ouvert') DESC, d.id DESC
   LIMIT 1`;

function versDefi(ligne) {
  return {
    id: ligne.id,
    titre: ligne.titre,
    probleme: ligne.probleme,
    phase: ligne.phase,
    finReponsesLe: ligne.fin_reponses_le,
    finVoteLe: ligne.fin_vote_le,
    nbReponses: ligne.nb_reponses,
  };
}

async function defiCourant() {
  await cloreDefisFinis();
  const { rows: [ligne] } = await db.query(SELECTION_DEFI);
  return ligne || null;
}

// Le défi de l'adresse, verrouillé le temps de la transaction, avec sa phase. Erreur 404 s'il n'existe pas.
async function defiDeLaRoute(client, valeurId) {
  const { rows: [defi] } = await client.query(
    `SELECT d.id, d.titre, ${PHASE} AS phase FROM defis d WHERE d.id = $1 AND d.statut IN ('ouvert', 'termine') FOR SHARE`,
    [v.idPositif(valeurId)],
  );
  if (!defi) throw new v.ErreurHttp(404, 'Ce défi n\'existe pas.');
  return defi;
}

// En bref, pour l'encadré de la colonne de droite et la carte du fil : GET /api/defis/resume (ouvert à tous).
router.get('/resume', async (req, res) => {
  const ligne = await defiCourant();
  if (!ligne) return res.json({ defi: null });
  const { probleme, ...resume } = versDefi(ligne); // l'énoncé complet n'est pas utile ici
  res.json({ defi: resume });
});

// Le défi et ses réponses : GET /api/defis/courant (ouvert à tous ; « mon vote » seulement pour un membre connecté).
router.get('/courant', async (req, res) => {
  const moi = req.utilisateur || null;
  const ligne = await defiCourant();
  if (!ligne) return res.json({ defi: null, reponses: [] });
  const termine = ligne.phase === 'termine';

  const { rows } = await db.query(
    `SELECT r.id, r.texte, r.lien, r.lien_verifie_le, r.cree_le, r.dev_id, ${COLONNES_MEMBRE},
            (SELECT count(*)::int FROM defi_votes vo
               JOIN utilisateurs votant ON votant.id = vo.utilisateur_id AND votant.bloque = FALSE AND votant.desactive_le IS NULL
              WHERE vo.reponse_id = r.id) AS nb_votes
       FROM defi_reponses r
       JOIN utilisateurs u ON u.id = r.dev_id
      WHERE r.defi_id = $1 AND u.bloque = FALSE AND u.desactive_le IS NULL
      ORDER BY r.id`,
    [ligne.id],
  );
  const { rows: [vote] } = moi
    ? await db.query('SELECT reponse_id FROM defi_votes WHERE defi_id = $1 AND utilisateur_id = $2', [ligne.id, moi.id])
    : { rows: [] };

  const reponses = rows.map((r) => ({
    id: r.id,
    texte: r.texte,
    lien: r.lien,
    lienVerifie: Boolean(r.lien && r.lien_verifie_le),
    creeLe: r.cree_le,
    auteur: apercuMembre(r),
    estMoi: Boolean(moi && moi.id === r.dev_id),
    monVote: Boolean(vote && vote.reponse_id === r.id),
    // Les compteurs ne sont montrés qu'à la fin : pendant le vote, ils influenceraient les votants.
    nbVotes: termine ? r.nb_votes : null,
    gagnante: termine && r.id === ligne.gagnant_reponse_id,
  }));
  // À la fin : la gagnante en premier, puis par nombre de votes.
  if (termine) reponses.sort((a, b) => Number(b.gagnante) - Number(a.gagnante) || b.nbVotes - a.nbVotes || a.id - b.id);

  res.json({
    defi: versDefi(ligne),
    reponses,
    // Ce que le membre connecté peut faire, décidé ici : la page n'a qu'à suivre.
    peutRepondre: Boolean(moi && moi.type === 'dev' && moi.profil_complete_le && ligne.phase === 'reponses'),
    peutVoter: Boolean(moi && ligne.phase === 'vote'),
    profilIncomplet: Boolean(moi && moi.type === 'dev' && !moi.profil_complete_le),
  });
});

// Répondre, ou modifier sa réponse tant que les réponses sont ouvertes : POST /api/defis/:id/reponse  { texte, lien? }
// Une seule réponse par dev et par défi : la contrainte UNIQUE (defi_id, dev_id) de la table le garantit.
router.post('/:id/reponse', exigerConnexion, exigerDev, exigerProfilComplet, limiteReponses, async (req, res) => {
  const moi = req.utilisateur;
  const texte = v.texte(req.body?.texte, 'texte', { min: 20, max: 2000 });
  const lien = liens.normaliserLien(req.body?.lien); // adresses internes refusées (voir utils/liens.js)

  const { rows: [existante] } = await db.query(
    'SELECT lien, lien_verifie_le FROM defi_reponses WHERE defi_id = $1 AND dev_id = $2',
    [v.idPositif(req.params.id), moi.id],
  );
  // Le lien n'est revisité que s'il a changé.
  let verifieLe = null;
  if (lien && existante && existante.lien === lien && existante.lien_verifie_le) verifieLe = existante.lien_verifie_le;
  else if (lien && await liens.verifierLien(lien)) verifieLe = new Date();

  const creee = await db.transaction(async (client) => {
    const defi = await defiDeLaRoute(client, req.params.id);
    if (defi.phase !== 'reponses') throw new v.ErreurValidation('Les réponses à ce défi sont closes.');
    const { rows: [ligne] } = await client.query(
      `INSERT INTO defi_reponses (defi_id, dev_id, texte, lien, lien_verifie_le) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (defi_id, dev_id) DO UPDATE SET texte = EXCLUDED.texte, lien = EXCLUDED.lien, lien_verifie_le = EXCLUDED.lien_verifie_le
       RETURNING id, (xmax = 0) AS creee`,
      [defi.id, moi.id, texte, lien, verifieLe],
    );
    return ligne;
  });
  res.status(creee.creee ? 201 : 200).json({ reponseId: creee.id, modifiee: !creee.creee, lienVerifie: Boolean(verifieLe) });
});

// Retirer sa réponse, tant que les réponses sont ouvertes : DELETE /api/defis/:id/reponse
router.delete('/:id/reponse', exigerConnexion, async (req, res) => {
  await db.transaction(async (client) => {
    const defi = await defiDeLaRoute(client, req.params.id);
    if (defi.phase !== 'reponses') throw new v.ErreurValidation('Les réponses à ce défi sont closes.');
    const { rowCount } = await client.query('DELETE FROM defi_reponses WHERE defi_id = $1 AND dev_id = $2', [defi.id, req.utilisateur.id]);
    if (rowCount === 0) throw new v.ErreurHttp(404, 'Tu n\'as pas de réponse à retirer.');
  });
  res.json({ ok: true });
});

// Voter, ou changer d'avis jusqu'à la fin du vote : POST /api/defis/:id/vote  { reponseId }
// Un seul vote par membre et par défi : c'est la clé primaire (defi_id, utilisateur_id) de la table.
router.post('/:id/vote', exigerConnexion, limiteVotes, async (req, res) => {
  const moi = req.utilisateur;
  const reponseId = v.idPositif(req.body?.reponseId);
  await db.transaction(async (client) => {
    const defi = await defiDeLaRoute(client, req.params.id);
    if (defi.phase === 'reponses') throw new v.ErreurValidation('Le vote n\'est pas encore ouvert.');
    if (defi.phase !== 'vote') throw new v.ErreurValidation('Le vote est terminé.');
    const { rows: [reponse] } = await client.query(
      `SELECT r.id, r.dev_id FROM defi_reponses r JOIN utilisateurs u ON u.id = r.dev_id AND u.bloque = FALSE AND u.desactive_le IS NULL
        WHERE r.id = $1 AND r.defi_id = $2`,
      [reponseId, defi.id],
    );
    if (!reponse) throw new v.ErreurHttp(404, 'Cette réponse n\'existe pas.');
    if (reponse.dev_id === moi.id) throw new v.ErreurValidation('Tu ne peux pas voter pour ta propre réponse.');
    await client.query(
      `INSERT INTO defi_votes (defi_id, utilisateur_id, reponse_id) VALUES ($1, $2, $3)
       ON CONFLICT (defi_id, utilisateur_id) DO UPDATE SET reponse_id = EXCLUDED.reponse_id`,
      [defi.id, moi.id, reponse.id],
    );
  });
  res.json({ ok: true, reponseId });
});

module.exports = router;
module.exports.cloreDefisFinis = cloreDefisFinis;
module.exports.PHASE = PHASE;
