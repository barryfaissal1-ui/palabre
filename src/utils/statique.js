// Fichiers de l'interface (public/) : pages HTML, cache du navigateur, pages d'erreur.
//
// Le problème à résoudre, en 3G : un téléphone qui revient sur le site ne doit pas retélécharger le style et les
// scripts, ni même demander au serveur « ont-ils changé ? » (20 questions × 400 ms d'attente chacune).
// La solution classique : mettre une EMPREINTE du contenu dans l'adresse, /css/style.css?v=3f2a91c0b4.
//  - le navigateur peut alors garder le fichier un an sans rien redemander (Cache-Control « immutable ») ;
//  - dès que le fichier change, son empreinte change, donc son adresse aussi : la nouvelle version est prise aussitôt.
// Les pages HTML, elles, sont toujours revérifiées (elles sont petites, et ce sont elles qui portent les adresses).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('../config');
const { langueDe } = require('./langue');
const textes = require('./textes');

const DOSSIER_PUBLIC = path.join(__dirname, '..', '..', 'public');
const DOSSIER_VUES = path.join(__dirname, '..', 'vues'); // pages d'erreur : jamais servies directement
const UN_AN = 365 * 24 * 60 * 60;

// Empreinte d'un fichier de public/ : les 10 premiers caractères du SHA-1 de son contenu.
// Recalculée seulement si le fichier a été modifié (on compare sa date).
const empreintes = new Map();
function empreinte(chemin) {
  const fichier = path.join(DOSSIER_PUBLIC, chemin);
  const { mtimeMs } = fs.statSync(fichier);
  const connue = empreintes.get(chemin);
  if (connue && connue.mtimeMs === mtimeMs) return connue.valeur;
  const valeur = crypto.createHash('sha1').update(fs.readFileSync(fichier)).digest('hex').slice(0, 10);
  empreintes.set(chemin, { mtimeMs, valeur });
  return valeur;
}

// Ajoute « ?v=empreinte » à chaque feuille de style et à chaque script cités dans une page.
function versionner(html) {
  return html.replace(/\b(href|src)="(\/(?:css|js|langues)\/[A-Za-z0-9._/-]+\.(?:css|js))"/g, (tout, attribut, chemin) => {
    try {
      return `${attribut}="${chemin}?v=${empreinte(chemin)}"`;
    } catch {
      return tout; // fichier introuvable : on laisse l'adresse telle quelle
    }
  });
}

// Lit une page HTML et y met les adresses versionnées. En production le résultat est gardé en mémoire ;
// en local la page est relue à chaque fois, pour voir tout de suite une modification.
const pages = new Map();
function lirePage(fichier, dossier = DOSSIER_PUBLIC) {
  const cle = path.join(dossier, fichier);
  if (config.production && pages.has(cle)) return pages.get(cle);
  const html = versionner(fs.readFileSync(cle, 'utf8'));
  pages.set(cle, html);
  return html;
}

// Sert /fil, /amis, /demandes… (public/fil.html, etc.) avec leurs adresses versionnées.
function pagesHtml(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const trouve = /^\/([a-z0-9-]+)(?:\.html)?$/.exec(req.path); // un nom simple : impossible de sortir du dossier
  if (!trouve) return next();
  let html;
  try {
    html = lirePage(`${trouve[1]}.html`);
  } catch {
    return next(); // pas de page de ce nom
  }
  res.set('Cache-Control', 'no-cache').type('html').send(dansLaLangue(req, html, `titre.${trouve[1]}`));
}

// La page dans la langue de la personne : en français, telle quelle ; sinon les textes marqués data-t sont remplacés
// (src/utils/textes.js) et le titre de l'onglet prend la clé « titre.<page> ». Le navigateur refait la même chose
// avec public/js/app.js : la page est simplement déjà juste à l'arrivée, sans clignotement.
function dansLaLangue(req, html, cleTitre = null) {
  const langue = langueDe(req);
  if (langue === 'fr') return html;
  let page = textes.traduirePage(langue, html);
  if (cleTitre && textes.DICTIONNAIRES.fr[cleTitre]) page = page.replace(/<title>[^<]*<\/title>/, () => `<title>${textes.t(langue, cleTitre)}</title>`);
  return page;
}

// En-têtes de cache des autres fichiers (appelé par express.static pour chaque fichier servi).
function entetesDeCache(res, fichier) {
  const relatif = path.relative(DOSSIER_PUBLIC, fichier).replace(/\\/g, '/');
  let cache = 'no-cache'; // par défaut : gardé, mais revérifié à chaque fois (réponse « 304 » de quelques octets)
  if (/^(css|js|langues)\//.test(relatif) && res.req.query.v) cache = `public, max-age=${UN_AN}, immutable`; // adresse versionnée
  else if (/^fonts\//.test(relatif)) cache = `public, max-age=${UN_AN}, immutable`; // le nom d'une police contient sa version
  else if (/\.(png|jpg|webp)$/.test(relatif)) cache = 'public, max-age=2592000'; // logos et photos : 30 jours
  res.setHeader('Cache-Control', cache);
}

// Pages d'erreur dans le style du site (src/vues/404.html et 500.html).
function pageErreur(res, statut) {
  let html;
  try {
    html = lirePage(`${statut}.html`, DOSSIER_VUES);
  } catch {
    html = `<!doctype html><meta charset="utf-8"><title>Erreur ${statut}</title><p>Erreur ${statut}. <a href="/">Retour à l'accueil</a></p>`;
  }
  res.status(statut).set('Cache-Control', 'no-store').type('html').send(dansLaLangue(res.req, html, `titre.erreur-${statut}`));
}

module.exports = { DOSSIER_PUBLIC, versionner, lirePage, pagesHtml, entetesDeCache, pageErreur, empreinte, dansLaLangue };
