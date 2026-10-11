// Les textes du serveur dans la langue de la personne : messages d'erreur, notifications, push, emails.
//
// Le serveur lit les MÊMES dictionnaires que le navigateur (public/langues/fr.js et en.js) : une seule liste de
// textes pour tout le site, et un test vérifie que les deux langues ont les mêmes clés.
//
// Deux façons de s'en servir :
//  1. t(langue, 'cle', { variables }) : pour un texte que le serveur compose lui-même (email, balise de partage).
//  2. traduire(langue, 'Phrase française') : le code du serveur écrit ses messages en français, là où on les lit
//     (« throw new ErreurValidation('Adresse email invalide.') »). Pour répondre en anglais, on retrouve la phrase
//     dans le dictionnaire français, parmi les clés « serveur.… », puis on rend sa version anglaise. Les phrases à
//     trous (« Au moins {n} caractères. ») sont reconnues par une expression régulière fabriquée à partir du texte.
//     La clé trouvée donne aussi le CODE stable de l'erreur (« au-moins-caracteres »), envoyé au navigateur.
const DICTIONNAIRES = { fr: require('../../public/langues/fr.js'), en: require('../../public/langues/en.js') };
const PREFIXE = 'serveur.';
const pluriels = { fr: new Intl.PluralRules('fr'), en: new Intl.PluralRules('en') };

function t(langue, cle, variables = {}) {
  const dictionnaire = DICTIONNAIRES[langue] || DICTIONNAIRES.fr;
  let texte = dictionnaire[cle];
  if (texte === undefined) texte = DICTIONNAIRES.fr[cle];
  if (texte === undefined) return cle;
  if (typeof texte === 'object') texte = (pluriels[langue] || pluriels.fr).select(Number(variables.n)) === 'one' ? texte.un : texte.autres;
  return texte.replace(/\{(\w+)\}/g, (tout, nom) => (variables[nom] === undefined ? tout : String(variables[nom])));
}

// ---------- Retrouver une phrase française dans le dictionnaire ----------
const echapper = (texte) => texte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exactes = new Map(); // phrase sans variable → clé
const motifs = [];         // phrases à trous : { cle, motif }
for (const [cle, valeur] of Object.entries(DICTIONNAIRES.fr)) {
  if (!cle.startsWith(PREFIXE)) continue;
  for (const phrase of typeof valeur === 'string' ? [valeur] : [valeur.un, valeur.autres]) {
    if (!phrase.includes('{')) { exactes.set(phrase, cle); continue; }
    // « Au moins {n} caractères. » → /^Au moins (?<n>.+?) caractères\.$/
    const source = phrase.split(/(\{\w+\})/).map((morceau) => (/^\{\w+\}$/.test(morceau) ? `(?<${morceau.slice(1, -1)}>.+?)` : echapper(morceau))).join('');
    motifs.push({ cle, motif: new RegExp(`^${source}$`, 's'), fixe: phrase.replace(/\{\w+\}/g, '').length });
  }
}
// La phrase la plus précise d'abord : celle qui a le plus de texte fixe.
motifs.sort((a, b) => b.fixe - a.fixe);

// Renvoie { cle, variables } pour une phrase française connue, sinon null.
function reconnaitre(phrase) {
  if (typeof phrase !== 'string') return null;
  if (exactes.has(phrase)) return { cle: exactes.get(phrase), variables: {} };
  for (const { cle, motif } of motifs) {
    const trouve = motif.exec(phrase);
    if (!trouve) continue;
    const variables = { ...trouve.groups };
    // Le français écrit « de Kofi » ou « d'Awa » ({deNom}, {deQui}) ; l'anglais veut le nom seul ({nom}, {qui}).
    for (const [nom, valeur] of Object.entries(trouve.groups)) {
      const court = /^de([A-Z]\w*)$/.exec(nom);
      if (court) variables[court[1].toLowerCase()] = valeur.replace(/^(de |d['’])/, '');
    }
    return { cle, variables };
  }
  return null;
}

// La phrase dans la langue demandée. Une phrase inconnue revient telle quelle (en français) : mieux vaut un message
// en français qu'aucun message ; le test tests/textes-serveur.test.js vérifie qu'il n'en reste pas.
function traduire(langue, phrase) {
  if (langue === 'fr' || !langue) return phrase;
  const connu = reconnaitre(phrase);
  return connu ? t(langue, connu.cle, connu.variables) : phrase;
}

// Le code stable d'un message : « Adresse email invalide. » → « adresse-email-invalide ». Il ne change pas avec la
// langue : un programme (ou un test) peut s'y fier, là où le texte, lui, est fait pour être lu.
function codeDe(phrase) {
  const connu = reconnaitre(phrase);
  return connu ? connu.cle.slice(PREFIXE.length) : 'message';
}

// ---------- Traduire une réponse de l'API ----------
// Ces champs portent un texte écrit par le serveur (jamais par un membre) : ils sont traduits à la sortie.
const CHAMPS_TRADUITS = new Set(['erreur', 'message', 'raison', 'nomCategorie', 'nomSecteur', 'apercu', 'appareil']);
const NOMS_DU_SERVEUR = new Set(['Membre indisponible', 'Membre parti']);
const LISTES_NOMMEES = new Set(['categories', 'secteurs']); // [{ id, nom }] : « nom » est traduit

function traduireReponse(langue, corps, profondeur = 0) {
  if (langue === 'fr' || !corps || typeof corps !== 'object' || profondeur > 6) return corps;
  if (Array.isArray(corps)) { corps.forEach((element) => traduireReponse(langue, element, profondeur + 1)); return corps; }
  for (const [cle, valeur] of Object.entries(corps)) {
    if (typeof valeur === 'string') {
      if (CHAMPS_TRADUITS.has(cle)) corps[cle] = traduire(langue, valeur);
      // Les deux noms que le serveur donne lui-même à un membre (compte désactivé, compte supprimé).
      else if (cle === 'nom' && NOMS_DU_SERVEUR.has(valeur)) corps[cle] = traduire(langue, valeur);
    } else if (LISTES_NOMMEES.has(cle) && Array.isArray(valeur)) {
      valeur.forEach((element) => { if (element && typeof element.nom === 'string') element.nom = traduire(langue, element.nom); });
    } else if (valeur && typeof valeur === 'object' && !(valeur instanceof Date)) {
      traduireReponse(langue, valeur, profondeur + 1);
    }
  }
  return corps;
}

// Remplit une page HTML déjà écrite en français : chaque balise data-t="cle" reçoit son texte, chaque attribut
// data-t-placeholder (aria-label, title, alt, content) aussi. Sert aux pages d'erreur et aux pages publiques : la
// page arrive déjà dans la bonne langue, avant même que le script du navigateur ne passe.
const echapperHtml = (texte) => String(texte).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function traduirePage(langue, html) {
  if (langue === 'fr') return html;
  return html
    .replace(/<html lang="fr"/, `<html lang="${langue}"`)
    .replace(/(<[a-zA-Z][a-zA-Z0-9]* data-t="([^"]+)"[^<>]*>)([^<]*)(<\/)/g, (tout, balise, cle, ancien, fin) => `${balise}${echapperHtml(t(langue, cle))}${fin}`)
    .replace(/\b(placeholder|aria-label|title|alt|content)="[^"]*"( data-t-\1="([^"]+)")/g, (tout, attribut, marque, cle) => `${attribut}="${echapperHtml(t(langue, cle))}"${marque}`);
}

module.exports = { t, traduire, codeDe, reconnaitre, traduireReponse, traduirePage, DICTIONNAIRES };
