// Mode clair ou mode sombre. Ce petit script est chargé en premier, dans le <head>, et s'exécute avant l'affichage :
// la page n'apparaît jamais dans le mauvais mode, même un court instant.
//
// Il écrit data-theme="clair" ou data-theme="sombre" sur la balise <html> ; la feuille de style redéfinit
// ses couleurs sous [data-theme="sombre"].
//  - Sans choix de la personne : on suit le réglage du téléphone ou de l'ordinateur (prefers-color-scheme).
//  - Si elle touche le bouton soleil / lune de l'en-tête : son choix est gardé dans ce navigateur (localStorage).
(function () {
  const CLE = 'palabre-theme';
  const racine = document.documentElement;
  const systemeSombre = window.matchMedia('(prefers-color-scheme: dark)');

  function choix() {
    try {
      const valeur = window.localStorage.getItem(CLE);
      return valeur === 'clair' || valeur === 'sombre' ? valeur : null;
    } catch {
      return null; // navigation privée stricte : pas de stockage, on suit le système
    }
  }

  function appliquer() {
    racine.dataset.theme = choix() || (systemeSombre.matches ? 'sombre' : 'clair');
  }

  appliquer();
  systemeSombre.addEventListener('change', appliquer); // le système passe en sombre le soir : la page suit

  window.PalabreTheme = {
    actuel: () => racine.dataset.theme,
    // Passe du clair au sombre (ou l'inverse) et retient ce choix.
    basculer() {
      const nouveau = racine.dataset.theme === 'sombre' ? 'clair' : 'sombre';
      try { window.localStorage.setItem(CLE, nouveau); } catch { /* le choix vaudra pour cette page seulement */ }
      racine.dataset.theme = nouveau;
      return nouveau;
    },
  };
})();
