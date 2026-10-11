// La langue d'une requête ou d'un membre : français (par défaut) ou anglais.
//
// Pour une requête, dans l'ordre : le cookie « langue » (posé par le site quand la personne choisit), la langue
// enregistrée dans son compte, puis l'en-tête Accept-Language du navigateur. Sans rien de tout cela : le français.
const LANGUES = ['fr', 'en'];
const UN_AN_MS = 365 * 24 * 60 * 60 * 1000;

const valide = (valeur) => (LANGUES.includes(valeur) ? valeur : null);

function langueDe(req) {
  if (!req) return 'fr';
  const cookie = valide(req.cookies && req.cookies.langue);
  if (cookie) return cookie;
  const compte = valide(req.utilisateur && req.utilisateur.langue);
  if (compte) return compte;
  // « en-GB,en;q=0.9,fr;q=0.8 » : on regarde seulement la première langue annoncée.
  const navigateur = String((req.get && req.get('accept-language')) || '').trim().toLowerCase();
  return navigateur.startsWith('en') ? 'en' : 'fr';
}

// Le même cookie que celui que pose public/js/app.js (lisible par le script : ce n'est pas un secret).
function poserCookieLangue(res, langue) {
  res.cookie('langue', langue, { maxAge: UN_AN_MS, sameSite: 'lax', path: '/' });
}

module.exports = { LANGUES, langueDe, langueValide: valide, poserCookieLangue };
