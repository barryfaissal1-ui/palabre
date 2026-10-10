// Demandes des clients, propositions des devs (seuls ou en équipe éclair), choix du client.
// Tout est réservé aux membres connectés.
const express = require('express');
const db = require('../db/pool');
const v = require('../utils/validation');
const { exigerConnexion, exigerClient, exigerDev, exigerProfilComplet } = require('../middleware/auth');
const { apercuMembre, COLONNES_MEMBRE, limiteParMembre } = require('../utils/membres');
const { notifier, court } = require('../utils/notifications');

const router = express.Router();
const PAR_PAGE = 10;
const MAX_INVITES = 5;
const CATEGORIES = Object.keys(v.CATEGORIES_DEMANDE);

const limiteDemandes = limiteParMembre(20, 60, 'Tu publies beaucoup de demandes. Réessaie plus tard.');
const limitePropositions = limiteParMembre(30, 60, 'Tu envoies beaucoup de propositions. Réessaie plus tard.');

router.use(exigerConnexion);

// Une demande avec son client. Les demandes masquées et celles des comptes bloqués n'apparaissent jamais.
// Les propositions d'équipe encore en préparation (« brouillon ») ne sont pas comptées.
const SELECTION = `
  SELECT d.id, d.titre, d.description, d.budget_fcfa, d.delai, d.categorie, d.statut, d.cree_le, d.client_id,
         ${COLONNES_MEMBRE},
         (SELECT count(*)::int FROM propositions p
           WHERE p.demande_id = d.id AND p.statut <> 'brouillon') AS nb_propositions
    FROM demandes d
    JOIN utilisateurs u ON u.id = d.client_id
   WHERE d.masque = FALSE AND u.bloque = FALSE`;

function versDemande(ligne, moi, { extrait = false } = {}) {
  const longue = extrait && ligne.description.length > 220;
  return {
    id: ligne.id,
    titre: ligne.titre,
    description: longue ? `${ligne.description.slice(0, 220)}…` : ligne.description,
    budgetFcfa: ligne.budget_fcfa,
    delai: ligne.delai,
    categorie: ligne.categorie,
    nomCategorie: v.CATEGORIES_DEMANDE[ligne.categorie] || 'Autre',
    statut: ligne.statut,
    creeLe: ligne.cree_le,
    client: apercuMembre(ligne),
    nbPropositions: ligne.nb_propositions,
    estMoi: ligne.client_id === moi.id,
  };
}

// La demande de l'adresse, ou une erreur 404.
async function lireDemande(valeurId, moi) {
  const id = v.idPositif(valeurId);
  const { rows } = id ? await db.query(`${SELECTION} AND d.id = $1`, [id]) : { rows: [] };
  if (!rows[0]) throw new v.ErreurHttp(404, 'Cette demande n\'existe plus.');
  return { ligne: rows[0], demande: versDemande(rows[0], moi) };
}

// Propositions d'une demande, avec les membres de l'équipe quand c'en est une.
// « condition » est un morceau de SQL écrit dans ce fichier (jamais du texte venu d'un membre) ;
// les valeurs passent toujours par des paramètres.
// pourClient : le client ne voit que les membres qui ont accepté de faire partie de l'équipe.
async function lirePropositions(condition, valeurs, moi, pourClient) {
  const { rows } = await db.query(
    `SELECT p.id, p.message, p.montant_fcfa, p.statut, p.cree_le, p.dev_id, p.equipe_id, e.chef_id,
            ${COLONNES_MEMBRE}
       FROM propositions p
       LEFT JOIN equipes e ON e.id = p.equipe_id
       JOIN utilisateurs u ON u.id = COALESCE(p.dev_id, e.chef_id)
      WHERE ${condition}
      ORDER BY p.id`,
    valeurs,
  );
  const idsEquipes = rows.filter((l) => l.equipe_id).map((l) => l.equipe_id);
  const membres = idsEquipes.length === 0 ? [] : (await db.query(
    `SELECT em.equipe_id, em.dev_id, em.role, em.statut, ${COLONNES_MEMBRE}
       FROM equipe_membres em
       JOIN utilisateurs u ON u.id = em.dev_id
      WHERE em.equipe_id = ANY($1::int[])
      ORDER BY u.nom`,
    [idsEquipes],
  )).rows;

  return rows.map((ligne) => {
    const proposition = {
      id: ligne.id,
      message: ligne.message,
      montantFcfa: ligne.montant_fcfa,
      statut: ligne.statut,
      creeLe: ligne.cree_le,
      auteur: apercuMembre(ligne), // le dev seul, ou le chef de l'équipe
      equipe: null,
      // Ma place dans cette proposition : 'solo', 'chef', 'invite' (je dois répondre), 'membre', ou null.
      maPlace: ligne.dev_id === moi.id ? 'solo' : null,
    };
    if (ligne.equipe_id) {
      const liste = membres.filter((m) => m.equipe_id === ligne.equipe_id);
      const moiDansEquipe = liste.find((m) => m.dev_id === moi.id);
      if (ligne.chef_id === moi.id) proposition.maPlace = 'chef';
      else if (moiDansEquipe?.statut === 'invite') proposition.maPlace = 'invite';
      else if (moiDansEquipe?.statut === 'accepte') proposition.maPlace = 'membre';
      proposition.equipe = {
        id: ligne.equipe_id,
        membres: liste
          .filter((m) => !pourClient || m.statut === 'accepte')
          .map((m) => ({ ...apercuMembre(m), role: m.role, statut: m.statut, estChef: m.dev_id === ligne.chef_id }))
          .sort((a, b) => Number(b.estChef) - Number(a.estChef)),
      };
    }
    return proposition;
  });
}

// Ce que le membre connecté a le droit de voir des propositions d'une demande :
// le client propriétaire voit toutes celles qui lui ont été envoyées ; un dev ne voit que les siennes
// (seul, comme chef, ou comme invité) — jamais celles des concurrents.
function propositionsVisibles(ligneDemande, moi) {
  if (ligneDemande.client_id === moi.id) {
    return lirePropositions('p.demande_id = $1 AND p.statut <> \'brouillon\'', [ligneDemande.id], moi, true);
  }
  return lirePropositions(
    `p.demande_id = $1 AND (p.dev_id = $2 OR p.equipe_id IN (
       SELECT em.equipe_id FROM equipe_membres em WHERE em.dev_id = $2 AND em.statut <> 'refuse'))`,
    [ligneDemande.id, moi.id],
    moi,
    false,
  );
}

function lireProposition(corps) {
  return {
    message: v.texte(corps.message, 'message', { min: 10, max: 2000 }),
    montantFcfa: v.entier(corps.montantFcfa, 'montantFcfa', { optionnel: true }),
  };
}

// ---------- Demandes ----------

// Liste, par 10 : GET /api/demandes?avant=<id>&categorie=<id>&miennes=1
// Par défaut : les demandes ouvertes. Avec miennes=1 : celles que j'ai publiées (client)
// ou celles où j'ai une proposition ou une invitation (dev), quel que soit leur statut.
router.get('/', async (req, res) => {
  const moi = req.utilisateur;
  const avant = v.idPositif(req.query.avant);
  const categorie = CATEGORIES.includes(req.query.categorie) ? req.query.categorie : null;
  const miennes = req.query.miennes === '1';

  const { rows } = await db.query(
    `${SELECTION}
       AND ($2::int IS NULL OR d.id < $2)
       AND ($3::text IS NULL OR d.categorie = $3)
       AND CASE WHEN $4::boolean THEN (
             d.client_id = $1 OR EXISTS (
               SELECT 1 FROM propositions p
                WHERE p.demande_id = d.id AND (p.dev_id = $1 OR p.equipe_id IN (
                  SELECT em.equipe_id FROM equipe_membres em WHERE em.dev_id = $1 AND em.statut <> 'refuse'))))
           ELSE d.statut = 'ouverte' END
     ORDER BY d.id DESC
     LIMIT $5`,
    [moi.id, avant, categorie, miennes, PAR_PAGE + 1],
  );
  const page = rows.slice(0, PAR_PAGE);
  res.json({
    demandes: page.map((ligne) => versDemande(ligne, moi, { extrait: true })),
    suivant: rows.length > PAR_PAGE ? page[page.length - 1].id : null,
  });
});

// Publier une demande : POST /api/demandes  { titre, description, budgetFcfa?, delai?, categorie }
router.post('/', exigerClient, limiteDemandes, async (req, res) => {
  const corps = req.body || {};
  const moi = req.utilisateur;
  const donnees = {
    titre: v.texte(corps.titre, 'titre', { min: 5, max: 120 }),
    description: v.texte(corps.description, 'description', { min: 20, max: 3000 }),
    budgetFcfa: v.entier(corps.budgetFcfa, 'budgetFcfa', { optionnel: true }),
    delai: v.texte(corps.delai, 'delai', { max: 60, optionnel: true }),
    categorie: v.parmi(corps.categorie, CATEGORIES, 'categorie'),
  };
  const { rows } = await db.query(
    `INSERT INTO demandes (client_id, titre, description, budget_fcfa, delai, categorie)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [moi.id, donnees.titre, donnees.description, donnees.budgetFcfa, donnees.delai, donnees.categorie],
  );
  const { demande } = await lireDemande(rows[0].id, moi);
  res.status(201).json({ demande });
});

// Détail : GET /api/demandes/:id
router.get('/:id', async (req, res) => {
  const moi = req.utilisateur;
  const { ligne, demande } = await lireDemande(req.params.id, moi);
  const reponse = { demande, propositions: await propositionsVisibles(ligne, moi) };
  if (demande.estMoi) {
    // Devs que le client a déjà notés pour cette demande : la page ne leur repropose pas le formulaire d'avis.
    const { rows } = await db.query(
      'SELECT u.identifiant FROM avis a JOIN utilisateurs u ON u.id = a.dev_id WHERE a.demande_id = $1',
      [ligne.id],
    );
    reponse.avisDonnes = rows.map((l) => l.identifiant);
  }
  res.json(reponse);
});

// Le client change le statut de sa demande :
// POST /api/demandes/:id/annuler (ouverte → annulée) ou /terminer (attribuée → terminée).
async function changerStatut(req, res, depuis, vers, messageRefus) {
  const moi = req.utilisateur;
  const { rowCount } = await db.query(
    'UPDATE demandes SET statut = $4 WHERE id = $1 AND client_id = $2 AND statut = $3',
    [v.idPositif(req.params.id), moi.id, depuis, vers],
  );
  if (rowCount === 0) throw new v.ErreurHttp(404, messageRefus);
  const { demande } = await lireDemande(req.params.id, moi);
  res.json({ demande });
}

router.post('/:id/annuler', exigerClient, (req, res) => changerStatut(req, res, 'ouverte', 'annulee', 'Seule une demande ouverte qui t\'appartient peut être annulée.'));
router.post('/:id/terminer', exigerClient, (req, res) => changerStatut(req, res, 'attribuee', 'terminee', 'Seule une demande attribuée qui t\'appartient peut être terminée.'));

// ---------- Propositions ----------

// Vérifie, dans une transaction, que la demande accepte encore des propositions.
async function demandeOuverte(client, valeurId) {
  const { rows } = await client.query(
    `SELECT d.id, d.titre, d.client_id, d.statut FROM demandes d
       JOIN utilisateurs u ON u.id = d.client_id
      WHERE d.id = $1 AND d.masque = FALSE AND u.bloque = FALSE
      FOR SHARE OF d`,
    [v.idPositif(valeurId)],
  );
  if (!rows[0]) throw new v.ErreurHttp(404, 'Cette demande n\'existe plus.');
  if (rows[0].statut !== 'ouverte') throw new v.ErreurValidation('Cette demande n\'accepte plus de propositions.');
  return rows[0];
}

// Proposer seul : POST /api/demandes/:id/propositions  { message, montantFcfa? }
router.post('/:id/propositions', exigerDev, exigerProfilComplet, limitePropositions, async (req, res) => {
  const moi = req.utilisateur;
  const donnees = lireProposition(req.body || {});

  await db.transaction(async (client) => {
    const demande = await demandeOuverte(client, req.params.id);
    try {
      await client.query(
        'INSERT INTO propositions (demande_id, dev_id, message, montant_fcfa) VALUES ($1, $2, $3, $4)',
        [demande.id, moi.id, donnees.message, donnees.montantFcfa],
      );
    } catch (err) {
      // Index unique : une seule proposition en solo par dev et par demande.
      if (err.code === '23505') throw new v.ErreurValidation('Tu as déjà envoyé une proposition pour cette demande.');
      throw err;
    }
    await notifier(client, demande.client_id, 'nouvelle_proposition',
      `${moi.nom} a envoyé une proposition pour « ${court(demande.titre)} ».`, `/demande?id=${demande.id}`);
  });

  const { ligne, demande } = await lireDemande(req.params.id, moi);
  res.status(201).json({ demande, propositions: await propositionsVisibles(ligne, moi) });
});

// Retirer sa proposition en solo, tant que le client n'a pas choisi : DELETE /api/demandes/:id/propositions/mienne
router.delete('/:id/propositions/mienne', exigerDev, async (req, res) => {
  const { rowCount } = await db.query(
    'DELETE FROM propositions WHERE demande_id = $1 AND dev_id = $2 AND statut = \'envoyee\'',
    [v.idPositif(req.params.id), req.utilisateur.id],
  );
  if (rowCount === 0) throw new v.ErreurHttp(404, 'Aucune proposition à retirer.');
  res.json({ ok: true });
});

// Créer une équipe éclair : POST /api/demandes/:id/equipes
//   { message, montantFcfa?, roleChef, membres: [{ identifiant, role }] }
// La proposition reste en « brouillon » tant que tous les invités n'ont pas répondu (voir routes/equipes.js).
router.post('/:id/equipes', exigerDev, exigerProfilComplet, limitePropositions, async (req, res) => {
  const corps = req.body || {};
  const moi = req.utilisateur;
  const donnees = lireProposition(corps);
  const roleChef = v.texte(corps.roleChef, 'roleChef', { min: 2, max: 40 });

  const invites = Array.isArray(corps.membres) ? corps.membres : [];
  if (invites.length === 0) throw new v.ErreurValidation('Invite au moins un ami dans ton équipe.', 'membres');
  if (invites.length > MAX_INVITES) throw new v.ErreurValidation(`${MAX_INVITES} invités au maximum.`, 'membres');
  const roles = new Map(); // identifiant → rôle
  invites.forEach((invite) => {
    const identifiant = typeof invite?.identifiant === 'string' ? invite.identifiant.trim().toLowerCase() : '';
    roles.set(identifiant, v.texte(invite?.role, 'membres', { min: 2, max: 40 }));
  });
  if (roles.size !== invites.length) throw new v.ErreurValidation('Un ami ne peut être invité qu\'une fois.', 'membres');

  await db.transaction(async (client) => {
    const demande = await demandeOuverte(client, req.params.id);

    // On ne peut inviter que ses amis (amitié acceptée) qui sont développeurs.
    const { rows: amis } = await client.query(
      `SELECT u.id, u.identifiant FROM utilisateurs u
        WHERE u.identifiant = ANY($2::text[]) AND u.type = 'dev' AND u.bloque = FALSE
          AND EXISTS (SELECT 1 FROM amities a
                       WHERE a.statut = 'acceptee'
                         AND ((a.demandeur_id = $1 AND a.receveur_id = u.id) OR (a.demandeur_id = u.id AND a.receveur_id = $1)))`,
      [moi.id, [...roles.keys()]],
    );
    if (amis.length !== roles.size) {
      throw new v.ErreurValidation('Tu ne peux inviter que tes amis développeurs.', 'membres');
    }

    let equipeId;
    try {
      const equipe = await client.query(
        'INSERT INTO equipes (demande_id, chef_id) VALUES ($1, $2) RETURNING id',
        [demande.id, moi.id],
      );
      equipeId = equipe.rows[0].id;
    } catch (err) {
      if (err.code === '23505') throw new v.ErreurValidation('Tu as déjà une équipe pour cette demande.');
      throw err;
    }
    // Le chef fait partie de l'équipe d'office.
    await client.query(
      'INSERT INTO equipe_membres (equipe_id, dev_id, role, statut) VALUES ($1, $2, $3, \'accepte\')',
      [equipeId, moi.id, roleChef],
    );
    for (const ami of amis) {
      const role = roles.get(ami.identifiant);
      await client.query(
        'INSERT INTO equipe_membres (equipe_id, dev_id, role) VALUES ($1, $2, $3)',
        [equipeId, ami.id, role],
      );
      await notifier(client, ami.id, 'invitation_equipe',
        `${moi.nom} t'invite dans son équipe éclair (rôle : ${role}) pour « ${court(demande.titre)} ».`, `/demande?id=${demande.id}`);
    }
    await client.query(
      'INSERT INTO propositions (demande_id, equipe_id, message, montant_fcfa, statut) VALUES ($1, $2, $3, $4, \'brouillon\')',
      [demande.id, equipeId, donnees.message, donnees.montantFcfa],
    );
  });

  const { ligne, demande } = await lireDemande(req.params.id, moi);
  res.status(201).json({ demande, propositions: await propositionsVisibles(ligne, moi) });
});

// ---------- Choix du client ----------

// Choisir une proposition : POST /api/demandes/:id/choisir  { propositionId }
// La proposition choisie passe à « acceptée », les autres à « refusée », la demande à « attribuée ».
router.post('/:id/choisir', exigerClient, async (req, res) => {
  const moi = req.utilisateur;
  const demandeId = v.idPositif(req.params.id);
  const propositionId = v.idPositif(req.body?.propositionId);

  await db.transaction(async (client) => {
    // FOR UPDATE : si le client clique deux fois, le second clic attend puis trouve la demande déjà attribuée.
    const { rows: [demande] } = await client.query(
      'SELECT id, titre, statut FROM demandes WHERE id = $1 AND client_id = $2 AND masque = FALSE FOR UPDATE',
      [demandeId, moi.id],
    );
    if (!demande) throw new v.ErreurHttp(404, 'Cette demande n\'existe pas ou ne t\'appartient pas.');
    if (demande.statut !== 'ouverte') throw new v.ErreurValidation('Tu as déjà fait ton choix pour cette demande.');

    const { rows: [choisie] } = await client.query(
      `UPDATE propositions SET statut = 'acceptee'
        WHERE id = $1 AND demande_id = $2 AND statut = 'envoyee'
        RETURNING dev_id, equipe_id`,
      [propositionId, demande.id],
    );
    if (!choisie) throw new v.ErreurHttp(404, 'Cette proposition n\'existe plus.');

    await client.query(
      'UPDATE propositions SET statut = \'refusee\' WHERE demande_id = $1 AND id <> $2',
      [demande.id, propositionId],
    );
    await client.query('UPDATE demandes SET statut = \'attribuee\' WHERE id = $1', [demande.id]);

    // Prévenir le dev choisi, ou tous les membres de l'équipe choisie.
    const { rows: gagnants } = choisie.dev_id
      ? { rows: [{ dev_id: choisie.dev_id }] }
      : await client.query('SELECT dev_id FROM equipe_membres WHERE equipe_id = $1 AND statut = \'accepte\'', [choisie.equipe_id]);
    for (const gagnant of gagnants) {
      await notifier(client, gagnant.dev_id, 'proposition_acceptee',
        `Bonne nouvelle : ${moi.nom} a choisi ${choisie.dev_id ? 'ta proposition' : 'la proposition de ton équipe'} pour « ${court(demande.titre)} ».`,
        `/demande?id=${demande.id}`);
    }
  });

  const { ligne, demande } = await lireDemande(demandeId, moi);
  res.json({ demande, propositions: await propositionsVisibles(ligne, moi) });
});

module.exports = router;
