// Le « profil de dev » (page 2 de l'inscription) : listes de choix, contrôle des champs, liens vérifiés.
const v = require('./validation');
const liens = require('./liens'); // appelé par « liens.verifierLien » pour que les tests puissent le remplacer

const SPECIALITES = {
  web: 'Développement web',
  mobile: 'Mobile',
  'back-end': 'Back-end',
  'front-end': 'Front-end',
  design: 'Design UI/UX',
  'data-ia': 'Data et IA',
  devops: 'DevOps et cloud',
  jeux: 'Jeux vidéo',
  autre: 'Autre',
};

const EXPERIENCES = {
  'moins-1': 'Moins d\'1 an',
  '1-2': '1 à 2 ans',
  '3-5': '3 à 5 ans',
  'plus-5': 'Plus de 5 ans',
};

const AGE_MINIMUM = 18;

// Les quatre liens d'un dev : nom du champ envoyé par le formulaire → colonne, nom affiché, site imposé.
const LIENS_DEV = {
  github: { colonne: 'lien_github', nom: 'GitHub', site: 'github.com' },
  gitlab: { colonne: 'lien_gitlab', nom: 'GitLab', site: 'gitlab.com' },
  portfolio: { colonne: 'lien_portfolio', nom: 'Portfolio', site: null },
  linkedin: { colonne: 'lien_linkedin', nom: 'LinkedIn', site: 'linkedin.com' },
};

// Âge en années révolues à une date donnée (l'anniversaire du jour compte).
function ageLe(naissance, jour = new Date()) {
  let age = jour.getUTCFullYear() - naissance.getUTCFullYear();
  const pasEncoreFete = jour.getUTCMonth() < naissance.getUTCMonth()
    || (jour.getUTCMonth() === naissance.getUTCMonth() && jour.getUTCDate() < naissance.getUTCDate());
  if (pasEncoreFete) age -= 1;
  return age;
}

// Date de naissance « AAAA-MM-JJ » : une vraie date, 18 ans au moins. Renvoie le texte, prêt pour la colonne DATE.
function dateNaissance(valeur) {
  const texte = typeof valeur === 'string' ? valeur.trim() : '';
  if (!texte) throw new v.ErreurValidation('Ce champ est obligatoire.', 'dateNaissance');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(texte) ? new Date(`${texte}T00:00:00Z`) : null;
  // Le second contrôle refuse les dates impossibles (le 31 février devient le 3 mars : le texte ne correspond plus).
  if (!date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== texte) {
    throw new v.ErreurValidation('Date invalide.', 'dateNaissance');
  }
  const age = ageLe(date);
  if (age < AGE_MINIMUM) {
    throw new v.ErreurValidation(`Il faut avoir au moins ${AGE_MINIMUM} ans pour créer un profil de développeur sur Palabre.`, 'dateNaissance');
  }
  if (age > 100) throw new v.ErreurValidation('Vérifie l\'année de naissance.', 'dateNaissance');
  return texte;
}

// Contrôle les quatre liens saisis ({ github, gitlab, portfolio, linkedin }) et les renvoie propres (ou null).
// Chaque lien passe par normaliserLien (adresses internes refusées) ; GitHub, GitLab et LinkedIn doivent être sur leur site.
function liensSaisis(valeurs) {
  const saisie = valeurs && typeof valeurs === 'object' ? valeurs : {};
  const propres = {};
  for (const [cle, { nom, site }] of Object.entries(LIENS_DEV)) {
    const lien = liens.normaliserLien(saisie[cle], cle);
    if (lien && site) {
      const hote = new URL(lien).hostname.replace(/^www\./, '');
      if (hote !== site && !hote.endsWith(`.${site}`)) {
        throw new v.ErreurValidation(`Ce lien n'est pas une adresse ${nom} (${site}).`, cle);
      }
    }
    propres[cle] = lien;
  }
  return propres;
}

// Visite les liens (en même temps, 5 secondes au plus chacun) et renvoie, pour chacun, sa date de vérification.
// Un lien qui n'a pas changé garde sa date : inutile de le revisiter. `ancien` = la ligne actuelle du membre.
async function verifierLiens(propres, ancien = {}) {
  const dates = {};
  await Promise.all(Object.entries(LIENS_DEV).map(async ([cle, { colonne }]) => {
    const lien = propres[cle];
    if (!lien) dates[cle] = null;
    else if (lien === ancien[colonne] && ancien[`${colonne}_verifie_le`]) dates[cle] = ancien[`${colonne}_verifie_le`];
    else dates[cle] = (await liens.verifierLien(lien)) ? new Date() : null;
  }));
  return dates;
}

// Les liens d'un dev tels qu'on les montre sur son profil : [{ type, nom, url, verifie }].
function liensPublics(u) {
  return Object.entries(LIENS_DEV)
    .filter(([, { colonne }]) => u[colonne])
    .map(([type, { colonne, nom }]) => ({ type, nom, url: u[colonne], verifie: Boolean(u[`${colonne}_verifie_le`]) }));
}

module.exports = { SPECIALITES, EXPERIENCES, LIENS_DEV, AGE_MINIMUM, ageLe, dateNaissance, liensSaisis, verifierLiens, liensPublics };
