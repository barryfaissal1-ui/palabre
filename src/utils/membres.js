// Outils partagés par les routes du réseau social : aperçu d'un membre, lien d'amitié, limites d'envoi.
const rateLimit = require('express-rate-limit');
const db = require('../db/pool');

// Ce qu'on montre d'un membre à côté d'une publication, d'un commentaire ou dans une liste d'amis.
// Jamais d'email ni de numéro WhatsApp ici.
function apercuMembre(ligne) {
  return {
    nom: ligne.nom,
    identifiant: ligne.identifiant,
    type: ligne.type_compte,
    ville: ligne.ville,
    pays: ligne.pays,
    avatar: ligne.avatar ? `/fichiers/${ligne.avatar}` : null,
  };
}

// Colonnes à sélectionner (table utilisateurs sous l'alias « u ») pour apercuMembre.
const COLONNES_MEMBRE = 'u.nom, u.identifiant, u.type AS type_compte, u.ville, u.pays, u.avatar';

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

module.exports = { apercuMembre, COLONNES_MEMBRE, etatAmitie, limiteParMembre };
