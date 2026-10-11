// Les règles de la communauté (page /regles) et leur acceptation.
//
// VERSION_REGLES : à augmenter quand le texte des règles change sur le fond (pas pour une faute d'orthographe).
// Chaque membre garde la version qu'il a acceptée (utilisateurs.regles_version) : si elle est plus ancienne, il doit
// les accepter de nouveau à sa prochaine visite, et le serveur refuse d'ici là tout ce qui modifie des données.
const VERSION_REGLES = 1;

// Vrai si ce membre doit (re)lire et accepter les règles.
const reglesAAccepter = (utilisateur) => (utilisateur.regles_version || 0) < VERSION_REGLES;

// Placé sur tout /api après la session. Lire reste possible (GET) ; écrire, non, sauf /api/auth (accepter, se
// déconnecter). Cacher la fenêtre dans le navigateur ne sert donc à rien : c'est ici que la règle s'applique.
function exigerReglesAcceptees(req, res, next) {
  if (!req.utilisateur || !reglesAAccepter(req.utilisateur) || req.method === 'GET' || req.method === 'HEAD' || req.path.startsWith('/auth/')) return next();
  res.status(403).json({ erreur: 'Les règles de la communauté ont changé. Accepte-les pour continuer.', suite: '/regles' });
}

module.exports = { VERSION_REGLES, reglesAAccepter, exigerReglesAcceptees };
