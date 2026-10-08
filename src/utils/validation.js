// Petites fonctions de validation des données envoyées par les formulaires.

const PAYS = [
  'Bénin', 'Burkina Faso', 'Burundi', 'Cameroun', 'Centrafrique', 'Comores', 'Congo',
  'Côte d\'Ivoire', 'Djibouti', 'Gabon', 'Guinée', 'Guinée équatoriale', 'Madagascar',
  'Mali', 'Maroc', 'Mauritanie', 'Niger', 'RD Congo', 'Rwanda', 'Sénégal', 'Seychelles',
  'Tchad', 'Togo', 'Tunisie', 'Algérie', 'Autre',
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

function email(valeur) {
  const v = texte(valeur, 'email', { max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) {
    throw new ErreurValidation('Adresse email invalide.', 'email');
  }
  return v;
}

function motDePasse(valeur, champ = 'motDePasse') {
  if (typeof valeur !== 'string' || valeur.length < 8) {
    throw new ErreurValidation('Le mot de passe doit faire au moins 8 caractères.', champ);
  }
  if (valeur.length > 128) {
    throw new ErreurValidation('Mot de passe trop long.', champ);
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
  'a-propos', 'admin', 'aide', 'amis', 'api', 'chercher', 'conditions', 'confidentialite', 'connexion',
  'css', 'defis', 'demandes', 'equipes', 'fichiers', 'fil', 'fonts', 'icons', 'index', 'inscription',
  'js', 'manifest', 'modifier-profil', 'moi', 'mot-de-passe-oublie', 'notifications', 'palabre', 'parametres',
  'profil', 'projets', 'reinitialiser', 'sw', 'vitrine',
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
  texte,
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
