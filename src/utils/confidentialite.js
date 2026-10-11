// Réglages de confidentialité d'un membre (page /parametres, rubrique « Confidentialité »).
//
// Ils sont gardés dans utilisateurs.confidentialite (JSON). Une clé absente vaut sa valeur par défaut, qui est le
// comportement du site avant ces réglages : rien ne change pour un membre qui n'y touche pas.
// RÈGLE : chaque réglage est appliqué par le SERVEUR, dans la route qui donne l'information. Cacher un bouton dans
// la page ne protège rien : quelqu'un peut toujours appeler la route à la main.
const { ErreurValidation } = require('./validation');

// Pour chaque réglage : les valeurs permises, la première étant la valeur par défaut.
const REGLAGES = {
  publications: ['tous', 'membres', 'amis'], // qui peut voir mes publications
  listeAmis: ['membres', 'amis', 'moi'],     // qui peut voir ma liste d'amis
  whatsapp: ['membres', 'amis', 'personne'], // qui peut voir mon numéro WhatsApp
  messages: ['tous', 'proches'],             // qui peut m'écrire (proches : mes amis et mes clients)
  appels: ['proches', 'amis', 'personne'],   // qui peut m'appeler
  equipes: ['amis', 'personne'],             // qui peut m'inviter dans une équipe éclair
  recherche: [true, false],                  // apparaître dans la recherche de devs et « Devs à découvrir »
};

// Les réglages d'un membre, complétés par les valeurs par défaut. « ligne » : une ligne de la table utilisateurs.
function lireConfidentialite(ligne) {
  const choisis = (ligne && ligne.confidentialite) || {};
  return Object.fromEntries(Object.entries(REGLAGES).map(([cle, valeurs]) => [cle, valeurs.includes(choisis[cle]) ? choisis[cle] : valeurs[0]]));
}

// Vérifie un réglage envoyé par la page : la clé et la valeur doivent être dans la liste ci-dessus.
function reglageValide(cle, valeur) {
  if (!Object.hasOwn(REGLAGES, cle)) throw new ErreurValidation('Réglage inconnu.', 'cle');
  if (!REGLAGES[cle].includes(valeur)) throw new ErreurValidation('Choix non reconnu.', 'valeur');
  return valeur;
}

// ---------- Morceaux de SQL (« u » est le membre dont on protège les données) ----------

// Les deux membres sont-ils amis ? « a » et « b » sont deux expressions SQL (« $1 », « u.id »…).
const sontAmis = (a, b) => `EXISTS (SELECT 1 FROM amities am
    WHERE am.statut = 'acceptee'
      AND LEAST(am.demandeur_id, am.receveur_id) = LEAST(${a}, ${b})
      AND GREATEST(am.demandeur_id, am.receveur_id) = GREATEST(${a}, ${b}))`;

// Les publications de « u » sont-elles visibles par celui qui regarde ? « qui » : son numéro (0 pour un visiteur).
// tous : tout le monde ; membres : il faut un compte ; amis : il faut être son ami. L'auteur voit toujours les siennes.
const publicationsVisibles = (qui = '$1') => `(u.id = ${qui}
    OR COALESCE(u.confidentialite->>'publications', 'tous') = 'tous'
    OR (u.confidentialite->>'publications' = 'membres' AND ${qui} > 0)
    OR (u.confidentialite->>'publications' = 'amis' AND ${sontAmis(qui, 'u.id')}))`;

// « u » accepte-t-il d'apparaître dans la recherche ? Sinon il reste visible pour les clients à qui il a envoyé une
// proposition (seul ou avec une équipe) : ils doivent pouvoir retrouver le dev avec qui ils travaillent.
const dansLaRecherche = (qui = '$1') => `(COALESCE(u.confidentialite->>'recherche', 'true') <> 'false'
    OR EXISTS (SELECT 1 FROM demandes dc
                 JOIN propositions pc ON pc.demande_id = dc.id AND pc.statut <> 'brouillon'
                 LEFT JOIN equipes ec ON ec.id = pc.equipe_id
                WHERE dc.client_id = ${qui} AND COALESCE(pc.dev_id, ec.chef_id) = u.id))`;

module.exports = { REGLAGES, lireConfidentialite, reglageValide, sontAmis, publicationsVisibles, dansLaRecherche };
