// Date de naissance en trois listes : Jour, Mois (en lettres), Année. Plus simple sur un téléphone que le calendrier
// du navigateur, où il faut reculer mois par mois jusqu'à son année de naissance.
// Le serveur reçoit toujours « AAAA-MM-JJ », comme avant, et c'est lui qui vérifie les 18 ans.
// Le calcul (dateComposee) est aussi chargé par les tests : tests/date-naissance.test.js.
(function (racine) {
  // Les textes : t() de app.js dans le navigateur ; dans les tests (Node), le dictionnaire français lu directement.
  const t = racine.Palabre ? racine.Palabre.t : ((cle, variables = {}) => require('../langues/fr.js')[cle].replace(/\{(\w+)\}/g, (tout, nom) => variables[nom]));
  // Les douze mois, écrits par le navigateur dans la langue du site : « janvier », « January ».
  const REGION = racine.Palabre ? racine.Palabre.REGION : 'fr-FR';
  const MOIS = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2000, i, 15)).toLocaleDateString(REGION, { month: 'long', timeZone: 'UTC' }));
  const AGE_MINIMUM = 18;
  const PREMIERE_ANNEE = 1940;

  // Jour, mois (1 à 12) et année → « AAAA-MM-JJ », ou null si la date n'existe pas (31 février, 31 avril, 29 février 2001).
  function dateComposee(jour, mois, annee) {
    const [j, m, a] = [jour, mois, annee].map(Number);
    if (![j, m, a].every(Number.isInteger) || m < 1 || m > 12 || j < 1 || a < 1000 || a > 9999) return null;
    // Date.UTC « corrige » une date impossible (le 31 février devient le 3 mars) : si le jour a changé, elle n'existe pas.
    const date = new Date(Date.UTC(a, m - 1, j));
    if (date.getUTCFullYear() !== a || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== j) return null;
    return `${a}-${String(m).padStart(2, '0')}-${String(j).padStart(2, '0')}`;
  }

  // Les années proposées : de « il y a 18 ans » (la plus récente, en premier) jusqu'à 1940.
  function anneesProposees(aujourdhui = new Date()) {
    const derniere = aujourdhui.getFullYear() - AGE_MINIMUM;
    return Array.from({ length: derniere - PREMIERE_ANNEE + 1 }, (_, i) => derniere - i);
  }

  // Ce que la page doit faire de ce qui est choisi : { date } si tout va bien, sinon { erreur } à montrer.
  function lireDate(jour, mois, annee) {
    if (!jour || !mois || !annee) return { erreur: t('naissance.incomplete') };
    const date = dateComposee(jour, mois, annee);
    if (!date) return { erreur: t(Number(jour) === 29 ? 'naissance.inexistante-annee' : 'naissance.inexistante', { jour: Number(jour), mois: MOIS[Number(mois) - 1], annee }) };
    return { date };
  }

  // Remplit les trois listes d'un formulaire (jourNaissance, moisNaissance, anneeNaissance).
  function preparerDateNaissance(champs) {
    const option = (valeur, texte) => {
      const o = document.createElement('option');
      o.value = valeur;
      o.textContent = texte;
      return o;
    };
    champs.jourNaissance.append(...Array.from({ length: 31 }, (_, i) => option(i + 1, String(i + 1))));
    champs.moisNaissance.append(...MOIS.map((nom, i) => option(i + 1, nom)));
    champs.anneeNaissance.append(...anneesProposees().map((annee) => option(annee, String(annee))));
    return () => lireDate(champs.jourNaissance.value, champs.moisNaissance.value, champs.anneeNaissance.value);
  }

  const publics = { dateComposee, anneesProposees, lireDate, preparerDateNaissance, MOIS };
  if (typeof module === 'object' && module.exports) module.exports = publics;
  else Object.assign(racine, publics);
})(typeof window !== 'undefined' ? window : globalThis);
