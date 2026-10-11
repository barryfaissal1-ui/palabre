// Outils partagés par les routes du réseau social : aperçu d'un membre, lien d'amitié, limites d'envoi.
const rateLimit = require('express-rate-limit');
const db = require('../db/pool');

// Ce qu'on montre d'un membre à côté d'une publication, d'un commentaire ou dans une liste d'amis.
// Jamais d'email ni de numéro WhatsApp ici.
// Un compte désactivé par son propriétaire ne montre plus rien de lui : ni nom, ni photo, ni lien vers son profil.
// Il n'apparaît plus que dans les conversations déjà ouvertes, sous le nom « Membre indisponible ».
function apercuMembre(ligne) {
  if (ligne.desactive_le) {
    return { nom: 'Membre indisponible', prenom: 'Membre', identifiant: 'membre-indisponible', type: ligne.type_compte, ville: null, pays: null, avatar: null, nbProjetsVerifies: 0, indisponible: true };
  }
  return {
    nom: ligne.nom,
    // Le vrai prénom (« Aimé par Awa », « Écris à Awa »…). Secours pour une ligne sans prénom : le premier mot du nom.
    prenom: ligne.prenom || String(ligne.nom).split(' ')[0],
    identifiant: ligne.identifiant,
    type: ligne.type_compte,
    ville: ligne.ville,
    pays: ligne.pays,
    avatar: ligne.avatar ? `/fichiers/${ligne.avatar}` : null,
    // Nombre de projets au lien vérifié : dessine l'anneau de preuve autour de la photo et le badge feuille.
    nbProjetsVerifies: ligne.nb_projets_verifies || 0,
  };
}

// Colonnes à sélectionner (table utilisateurs sous l'alias « u ») pour apercuMembre.
// Le nombre de projets vérifiés est une sous-requête de la même requête : jamais une requête par membre.
const NB_PROJETS_VERIFIES = `(SELECT count(*)::int FROM projets pv
    WHERE pv.dev_id = u.id AND pv.masque = FALSE AND pv.lien IS NOT NULL AND pv.lien_verifie_le IS NOT NULL)`;
const COLONNES_MEMBRE = `u.nom, u.prenom, u.identifiant, u.type AS type_compte, u.ville, u.pays, u.avatar, u.desactive_le,
    ${NB_PROJETS_VERIFIES} AS nb_projets_verifies`;

// Lien entre deux membres, vu par « moi » : 'amis', 'envoyee', 'recue' ou 'aucune'.
// Un refus n'est pas révélé : celui qui a demandé voit toujours « demande envoyée ».
async function etatAmitie(moiId, autreId) {
  const { rows } = await db.query(
    `SELECT demandeur_id, statut FROM amities
      WHERE (demandeur_id = $1 AND receveur_id = $2) OR (demandeur_id = $2 AND receveur_id = $1)`,
    [moiId, autreId],
  );
  const lien = rows[0];
  if (!lien) return 'aucune';
  if (lien.statut === 'acceptee') return 'amis';
  if (lien.demandeur_id === moiId) return 'envoyee';
  return lien.statut === 'en_attente' ? 'recue' : 'aucune';
}

// Limite par membre connecté (et non par adresse IP : sur mobile, beaucoup de gens partagent la même).
// À placer après exigerConnexion.
function limiteParMembre(nombre, minutes, message) {
  return rateLimit({
    windowMs: minutes * 60 * 1000,
    limit: nombre,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => `membre-${req.utilisateur.id}`,
    message: { erreur: message },
  });
}

module.exports = { apercuMembre, COLONNES_MEMBRE, NB_PROJETS_VERIFIES, etatAmitie, limiteParMembre };
