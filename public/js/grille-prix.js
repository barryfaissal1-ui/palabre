// Grille de prix du calculateur « Combien coûte mon projet ? » (page /calculateur).
//
// C'EST LE SEUL FICHIER À MODIFIER POUR CHANGER UN PRIX. Tous les montants sont en francs CFA.
//
// Le calcul (fait par calcul-prix.js, dans le navigateur) :
//   (prix de base × taille) + options, puis + le supplément du délai, arrondi à « arrondi » FCFA.
//   Il est fait deux fois : avec le prix « min » et avec le prix « max », ce qui donne une fourchette.
//
// Pour modifier :
//   - un prix : change « min », « max » ou « prix » ;
//   - une majoration : « pourcentage » vaut 30 pour +30 % ;
//   - ajouter une option : copie une ligne de « options » et donne-lui un nouvel « id » ;
//   - « categorie » d'un type doit être une catégorie de demande qui existe
//     (liste CATEGORIES_DEMANDE dans src/utils/validation.js).
// Après une modification : lance « npm test » puis augmente VERSION dans public/sw.js.
(function (racine) {
  const GRILLE_PRIX = {
    arrondi: 5000,

    // Étape 1 — Type de projet. « unite » : le mot utilisé à l'étape 2 (pages ou écrans).
    types: [
      { id: 'site-vitrine', nom: 'Site vitrine', aide: 'Présenter une activité : accueil, services, contact.', min: 75000, max: 150000, categorie: 'site-web', unite: 'pages' },
      { id: 'boutique-en-ligne', nom: 'Boutique en ligne', aide: 'Vendre des produits avec un catalogue et des commandes.', min: 200000, max: 450000, categorie: 'boutique-en-ligne', unite: 'pages' },
      { id: 'appli-mobile', nom: 'Application mobile', aide: 'Une application à installer sur téléphone Android ou iPhone.', min: 350000, max: 900000, categorie: 'appli-mobile', unite: 'écrans' },
      { id: 'logiciel-gestion', nom: 'Logiciel de gestion', aide: 'Stock, ventes, clients, comptabilité, école, pharmacie…', min: 250000, max: 700000, categorie: 'logiciel-gestion', unite: 'écrans' },
    ],

    // Étape 2 — Taille. Le prix de base est majoré de « pourcentage » %.
    tailles: [
      { id: 'petite', nom: '1 à 5', pourcentage: 0 },
      { id: 'moyenne', nom: '6 à 15', pourcentage: 30 },
      { id: 'grande', nom: 'Plus de 15', pourcentage: 60 },
    ],

    // Étape 3 — Options. Chaque option cochée ajoute « prix » FCFA.
    options: [
      { id: 'mobile-money', nom: 'Paiement Mobile Money', aide: 'Orange Money, Moov Money, Wave…', prix: 75000 },
      { id: 'administration', nom: 'Espace d\'administration', aide: 'Pour modifier toi-même le contenu.', prix: 60000 },
      { id: 'langues', nom: 'Plusieurs langues', aide: 'Français, anglais, langues locales…', prix: 40000 },
      { id: 'logo', nom: 'Création du logo', aide: '', prix: 25000 },
      { id: 'hebergement', nom: 'Hébergement et nom de domaine', aide: 'La première année.', prix: 40000 },
    ],

    // Étape 4 — Délai. Le total est majoré de « pourcentage » %.
    delais: [
      { id: 'normal', nom: 'Normal', aide: 'Le développeur travaille à son rythme habituel.', pourcentage: 0 },
      { id: 'urgent', nom: 'Urgent', aide: 'Le projet passe avant les autres.', pourcentage: 25 },
    ],
  };

  // Le même fichier sert au navigateur (variable globale) et aux tests (module Node.js).
  if (typeof module === 'object' && module.exports) module.exports = GRILLE_PRIX;
  else racine.GRILLE_PRIX = GRILLE_PRIX;
})(typeof window !== 'undefined' ? window : globalThis);
