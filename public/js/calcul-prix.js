// Calcul de l'estimation du calculateur, à partir de la grille (grille-prix.js) et des réponses du visiteur.
// Aucune requête au serveur : tout se fait dans le navigateur. La fonction ne touche pas à la page,
// ce qui permet de la tester seule (tests/calculateur.test.js).
(function (racine) {
  function trouver(liste, id, quoi) {
    const element = liste.find((e) => e.id === id);
    if (!element) throw new Error(`Choix inconnu pour ${quoi}.`);
    return element;
  }

  // choix : { type, taille, options: [ids], delai } — les « id » de la grille.
  // Renvoie { min, max, milieu, type, taille, options, delai } ; lance une erreur si un choix n'existe pas.
  function estimerPrix(grille, choix) {
    const type = trouver(grille.types, choix.type, 'le type de projet');
    const taille = trouver(grille.tailles, choix.taille, 'la taille');
    const delai = trouver(grille.delais, choix.delai, 'le délai');
    // Une option cochée deux fois ne compte qu'une fois.
    const options = [...new Set(choix.options || [])].map((id) => trouver(grille.options, id, 'les options'));
    const totalOptions = options.reduce((somme, option) => somme + option.prix, 0);

    // (prix de base × taille) + options, puis le supplément du délai, arrondi.
    // Les pourcentages sont appliqués sous la forme × (100 + p) / 100 pour rester sur des nombres entiers.
    const arrondir = (montant) => Math.round(montant / grille.arrondi) * grille.arrondi;
    const calculer = (base) => arrondir(((base * (100 + taille.pourcentage)) / 100 + totalOptions) * (100 + delai.pourcentage) / 100);

    const min = calculer(type.min);
    const max = calculer(type.max);
    return { min, max, milieu: arrondir((min + max) / 2), type, taille, options, delai };
  }

  if (typeof module === 'object' && module.exports) module.exports = { estimerPrix };
  else racine.estimerPrix = estimerPrix;
})(typeof window !== 'undefined' ? window : globalThis);
