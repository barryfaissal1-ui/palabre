// Petites fonctions de validation des données envoyées par les formulaires.
const { tropCourant, contientLeNom } = require('./mots-de-passe');

const PAYS = [
  'Bénin', 'Burkina Faso', 'Burundi', 'Cameroun', 'Centrafrique', 'Comores', 'Congo',
  'Côte d\'Ivoire', 'Djibouti', 'Gabon', 'Guinée', 'Guinée équatoriale', 'Madagascar',
  'Mali', 'Maroc', 'Mauritanie', 'Niger', 'RD Congo', 'Rwanda', 'Sénégal', 'Seychelles',
  'Tchad', 'Togo', 'Tunisie', 'Algérie',
  // Pays anglophones et lusophones. Le nom reste en français dans la base ; la page l'affiche dans la langue du
  // membre (clés « pays.… » de public/langues).
  'Afrique du Sud', 'Angola', 'Botswana', 'Cap-Vert', 'Égypte', 'Éthiopie', 'Gambie', 'Ghana', 'Guinée-Bissau', 'Kenya',
  'Liberia', 'Malawi', 'Maurice', 'Mozambique', 'Namibie', 'Nigeria', 'Ouganda', 'Sierra Leone', 'Tanzanie', 'Zambie', 'Zimbabwe',
  'Autre',
];

class ErreurValidation extends Error {
  constructor(message, champ) {
    super(message);
    this.statut = 400;
    this.champ = champ;
  }
}

function texte(valeur, champ, { min = 1, max = 200, optionnel = false } = {}) {
  const v = typeof valeur === 'string' ? valeur.trim() : '';
  if (!v) {
    if (optionnel) return null;
    throw new ErreurValidation('Ce champ est obligatoire.', champ);
  }
  if (v.length < min) throw new ErreurValidation(`Au moins ${min} caractères.`, champ);
  if (v.length > max) throw new ErreurValidation(`Au plus ${max} caractères.`, champ);
  return v;
}

// Prénom ou nom de famille : 1 à 50 caractères, des lettres (accents compris), des espaces, des tirets et des
// apostrophes seulement (« Jean-Baptiste », « N'Diaye », « De La Cruz »). Les espaces en trop sont retirés.
// \p{L} = n'importe quelle lettre, dans n'importe quel alphabet ; \p{M} = les accents écrits à part.
function nomPropre(valeur, champ) {
  const v = texte(valeur, champ, { max: 50 }).replace(/\s+/g, ' ');
  if (!/^\p{L}[\p{L}\p{M} '’-]*$/u.test(v)) {
    throw new ErreurValidation('Lettres, espaces, tirets et apostrophes seulement.', champ);
  }
  return v;
}

function email(valeur) {
  const v = texte(valeur, 'email', { max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) {
    throw new ErreurValidation('Adresse email invalide.', 'email');
  }
  return v;
}

// proches : le prénom, le nom et l'identifiant de la personne. Un mot de passe qui les contient, ou qui figure
// parmi les plus courants (src/utils/mots-de-passe.js), est refusé : ce sont les premiers qu'un intrus essaie.
function motDePasse(valeur, champ = 'motDePasse', proches = []) {
  if (typeof valeur !== 'string' || valeur.length < 8) {
    throw new ErreurValidation('Le mot de passe doit faire au moins 8 caractères.', champ);
  }
  if (valeur.length > 128) {
    throw new ErreurValidation('Mot de passe trop long.', champ);
  }
  if (tropCourant(valeur)) {
    throw new ErreurValidation('Ce mot de passe est trop courant. Choisis-en un que personne ne peut deviner.', champ);
  }
  if (contientLeNom(valeur, proches)) {
    throw new ErreurValidation('Ton mot de passe ne doit contenir ni ton prénom, ni ton nom, ni ton identifiant.', champ);
  }
  return valeur;
}

function pays(valeur) {
  const v = texte(valeur, 'pays', { max: 60 });
  if (!PAYS.includes(v)) throw new ErreurValidation('Pays non reconnu.', 'pays');
  return v;
}

// Numéro WhatsApp : chiffres et + uniquement, indicatif conseillé (ex. +226 65 80 34 15).
function whatsapp(valeur) {
  const v = texte(valeur, 'whatsapp', { optionnel: true, max: 25 });
  if (v === null) return null;
  const nettoye = v.replace(/[\s.-]/g, '');
  if (!/^\+?\d{8,15}$/.test(nettoye)) {
    throw new ErreurValidation('Numéro WhatsApp invalide.', 'whatsapp');
  }
  return nettoye;
}

function typeCompte(valeur) {
  if (valeur !== 'dev' && valeur !== 'client') {
    throw new ErreurValidation('Choisis « Développeur » ou « Client ».', 'type');
  }
  return valeur;
}

// Erreur « normale » à renvoyer telle quelle au navigateur (403 interdit, 404 introuvable…).
class ErreurHttp extends Error {
  // `suite` (facultatif) : la page où envoyer la personne pour régler le problème (/bienvenue, /confirmer-email).
  constructor(statut, message, suite) {
    super(message);
    this.statut = statut;
    this.suite = suite;
  }
}

// Catégories des demandes des clients : identifiant gardé en base → nom affiché.
const CATEGORIES_DEMANDE = {
  'site-web': 'Site web',
  'appli-mobile': 'Application mobile',
  'boutique-en-ligne': 'Boutique en ligne',
  'logiciel-gestion': 'Logiciel de gestion',
  'paiement-mobile': 'Paiement et Mobile Money',
  design: 'Design et identité visuelle',
  autre: 'Autre',
};

// Secteurs des projets réalisés : ils classent la vitrine de la page d'accueil.
const SECTEURS_PROJET = {
  commerce: 'Commerce et boutiques',
  restauration: 'Restauration et hôtellerie',
  sante: 'Santé',
  education: 'Éducation',
  agriculture: 'Agriculture',
  finance: 'Finance et Mobile Money',
  transport: 'Transport et livraison',
  services: 'Associations et services publics',
  culture: 'Culture et médias',
  autre: 'Autre',
};

// Nombre entier (montant en FCFA…). Les espaces de « 150 000 » sont acceptés.
function entier(valeur, champ, { min = 0, max = 2000000000, optionnel = false } = {}) {
  if (valeur === null || valeur === undefined || valeur === '') {
    if (optionnel) return null;
    throw new ErreurValidation('Ce champ est obligatoire.', champ);
  }
  const n = typeof valeur === 'string' ? Number(valeur.replace(/\s/g, '')) : valeur;
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ErreurValidation('Nombre entier attendu, sans virgule.', champ);
  }
  return n;
}

// Valeur à choisir dans une liste fixe (type de publication, type de cible signalée…).
function parmi(valeur, liste, champ) {
  if (!liste.includes(valeur)) throw new ErreurValidation('Choix non reconnu.', champ);
  return valeur;
}

// Numéro de ligne venant d'une adresse ou d'un formulaire : entier positif, sinon null.
function idPositif(valeur) {
  const n = Number(valeur);
  return Number.isInteger(n) && n > 0 && n <= 2147483647 ? n : null;
}

// Mots réservés : ils servent d'adresses de pages (palabre.dev/connexion…) et ne peuvent pas être des identifiants.
const IDENTIFIANTS_RESERVES = new Set([
  'parametres', 'langues', 'regles', 'sanctions', 'moderation', 'pas-moi', 'bon-retour', 'annuler-suppression', 'membre-indisponible', 'membre-parti', 'corbeille',
  'a-propos', 'admin', 'aide', 'amis', 'api', 'bienvenue', 'calculateur', 'chercher', 'conditions', 'confidentialite',
  'confirmer-email', 'connexion',
  'css', 'defis', 'demande', 'demandes', 'equipes', 'fichiers', 'fil', 'fonts', 'icons', 'img', 'index', 'inscription',
  'js', 'manifest', 'messages', 'modifier-profil', 'moi', 'mot-de-passe-oublie', 'notifications', 'palabre', 'parametres',
  'profil', 'projet', 'projets', 'publication', 'publications', 'recherche', 'reinitialiser', 'sw', 'vitrine',
]);

function identifiant(valeur) {
  const v = texte(valeur, 'identifiant', { min: 3, max: 30 }).toLowerCase();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(v)) {
    throw new ErreurValidation('Lettres minuscules, chiffres et tirets uniquement (ex. awa-dev).', 'identifiant');
  }
  if (IDENTIFIANTS_RESERVES.has(v)) {
    throw new ErreurValidation('Cet identifiant est réservé. Choisis-en un autre.', 'identifiant');
  }
  return v;
}

// Transforme « Barry Faïssal » en « barry-faissal » pour les liens de profil.
function versIdentifiant(nom) {
  return nom
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'dev';
}

module.exports = {
  PAYS,
  ErreurValidation,
  ErreurHttp,
  CATEGORIES_DEMANDE,
  SECTEURS_PROJET,
  entier,
  texte,
  nomPropre,
  email,
  motDePasse,
  pays,
  whatsapp,
  typeCompte,
  parmi,
  idPositif,
  versIdentifiant,
  identifiant,
  IDENTIFIANTS_RESERVES,
};
