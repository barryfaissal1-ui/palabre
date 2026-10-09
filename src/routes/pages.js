// Pages dont l'en-tête est préparé par le serveur : accueil, profil (lien court) et projet.
//
// Pourquoi : quand on colle un lien dans Facebook ou WhatsApp, leur robot lit la page SANS exécuter
// le JavaScript. Pour afficher une belle carte (titre, texte, image), il lui faut des balises
// « Open Graph » déjà écrites dans le HTML. Le serveur les ajoute donc avant d'envoyer la page.
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../db/pool');
const config = require('../config');
const v = require('../utils/validation');

const router = express.Router();
const DOSSIER_PUBLIC = path.join(__dirname, '..', '..', 'public');
// Image de partage quand la page n'a pas la sienne (accueil, calculateur, profil sans photo, projet sans capture).
// 1200 × 630 : le format que Facebook et WhatsApp affichent en grande carte.
const IMAGE_PAR_DEFAUT = '/img/palabre-partage-1200x630.png';
const modeles = new Map();

// Les textes viennent des membres : chaque caractère spécial est neutralisé avant d'entrer dans le HTML,
// sinon un nom comme "><script>… deviendrait du code dans la page.
function echapper(texte) {
  return String(texte).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function raccourcir(texte, max = 180) {
  const propre = String(texte || '').replace(/\s+/g, ' ').trim();
  return propre.length > max ? `${propre.slice(0, max - 1)}…` : propre;
}

function lireModele(fichier) {
  // En production le fichier est lu une seule fois ; en local il est relu pour voir ses modifications.
  if (config.production && modeles.has(fichier)) return modeles.get(fichier);
  const html = fs.readFileSync(path.join(DOSSIER_PUBLIC, fichier), 'utf8');
  modeles.set(fichier, html);
  return html;
}

// Remplace le <title> de la page par un titre et des balises de partage propres à ce contenu.
function rendrePage(res, fichier, { titre, description, chemin, image, type = 'website', statut = 200 }) {
  const url = `${config.urlPublique}${chemin}`;
  const balises = [
    `<title>${echapper(titre)}</title>`,
    `<meta name="description" content="${echapper(description)}">`,
    `<link rel="canonical" href="${echapper(url)}">`,
    `<meta property="og:site_name" content="Palabre">`,
    `<meta property="og:locale" content="fr_FR">`,
    `<meta property="og:type" content="${type}">`,
    `<meta property="og:title" content="${echapper(titre)}">`,
    `<meta property="og:description" content="${echapper(description)}">`,
    `<meta property="og:url" content="${echapper(url)}">`,
    `<meta property="og:image" content="${echapper(`${config.urlPublique}${image || IMAGE_PAR_DEFAUT}`)}">`,
    // Les dimensions ne sont annoncées que pour l'image par défaut, la seule dont on connaît la taille exacte :
    // elles permettent à Facebook d'afficher la grande carte dès le premier partage, sans attendre de l'avoir analysée.
    ...(image ? [] : ['<meta property="og:image:width" content="1200">', '<meta property="og:image:height" content="630">']),
    '<meta name="twitter:card" content="summary_large_image">',
  ].join('\n  ');
  // La fonction en second argument évite que « $ » dans un titre soit pris pour un code de remplacement.
  const html = lireModele(fichier).replace(/<title>[^<]*<\/title>/, () => balises);
  res.status(statut).type('html').send(html);
}

// Accueil
router.get('/', (req, res) => {
  rendrePage(res, 'index.html', {
    titre: 'Palabre – le réseau des développeurs africains',
    description: 'Palabre réunit les développeurs africains : partage tes projets, forme des équipes éclair, et trouve des clients qui ont besoin de toi.',
    chemin: '/',
  });
});

// Calculateur « Combien coûte mon projet ? »
router.get('/calculateur', (req, res) => {
  rendrePage(res, 'calculateur.html', {
    titre: 'Combien coûte mon projet ? – Palabre',
    description: 'Site, boutique en ligne, application mobile ou logiciel de gestion : estime le prix de ton projet en FCFA en quatre questions, gratuitement et sans compte.',
    chemin: '/calculateur',
  });
});

// Photo du panneau vert des pages d'accès : la première image trouvée dans public/img/fond/, s'il y en a une.
// Sans ce dossier (ou s'il est vide), la page n'a pas de photo : le dégradé vert suffit.
function photoPanneau() {
  try {
    const image = fs.readdirSync(path.join(DOSSIER_PUBLIC, 'img', 'fond'))
      .filter((nom) => /^[a-z0-9._-]+\.(jpe?g|png|webp)$/i.test(nom)) // un nom simple : il est écrit tel quel dans la page
      .sort()[0];
    // loading="lazy" : la photo est décorative, elle ne retarde jamais l'affichage du formulaire.
    return image ? `<img class="lame-photo" src="/img/fond/${image}" alt="" loading="lazy" decoding="async">` : '';
  } catch {
    return '';
  }
}

// Connexion et inscription : une seule page (connexion.html) qui contient les deux formulaires.
// Le serveur y écrit lequel montrer d'abord ; ensuite la page passe de l'un à l'autre sans recharger (public/js/acces.js).
router.get(['/connexion', '/inscription'], (req, res) => {
  const inscription = req.path === '/inscription';
  let html = lireModele('connexion.html').replace('<!-- photo-panneau -->', photoPanneau);
  if (inscription) {
    html = html
      .replace('data-vue="connexion"', 'data-vue="inscription"')
      .replace('<title>Se connecter – Palabre</title>', '<title>Créer un compte – Palabre</title>');
  }
  res.type('html').send(html);
});

// Page d'un projet : /projets/12
router.get('/projets/:id', async (req, res, next) => {
  const id = v.idPositif(req.params.id);
  if (!id) return next();
  const { rows: [projet] } = await db.query(
    `SELECT p.titre, p.description, p.image, u.nom FROM projets p
       JOIN utilisateurs u ON u.id = p.dev_id
      WHERE p.id = $1 AND u.bloque = FALSE AND p.masque = FALSE`,
    [id],
  );
  if (!projet) {
    return rendrePage(res, 'projet.html', { titre: 'Projet introuvable – Palabre', description: 'Ce projet n\'existe plus.', chemin: '/', statut: 404 });
  }
  rendrePage(res, 'projet.html', {
    titre: `${projet.titre} – réalisé par ${projet.nom} | Palabre`,
    description: raccourcir(projet.description) || `Un projet réalisé par ${projet.nom}, à découvrir sur Palabre, le réseau des développeurs africains.`,
    chemin: `/projets/${id}`,
    image: projet.image ? `/fichiers/${projet.image}` : null,
    type: 'article',
  });
});

// Liens courts de profil : palabre.dev/barry-faissal affiche la page profil.
// La page lit ensuite l'identifiant dans l'adresse et demande le profil complet à l'API.
router.get('/:identifiant', async (req, res, next) => {
  const identifiant = req.params.identifiant.toLowerCase();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(identifiant) || v.IDENTIFIANTS_RESERVES.has(identifiant)) return next();
  const { rows: [membre] } = await db.query(
    'SELECT nom, type, ville, pays, bio, avatar FROM utilisateurs WHERE identifiant = $1 AND bloque = FALSE',
    [identifiant],
  );
  if (!membre) {
    return rendrePage(res, 'profil.html', { titre: 'Profil introuvable – Palabre', description: 'Ce profil n\'existe pas ou a été supprimé.', chemin: '/', statut: 404 });
  }
  const role = membre.type === 'dev' ? 'Développeur' : 'Client';
  rendrePage(res, 'profil.html', {
    titre: `${membre.nom} – ${role} à ${membre.ville}, ${membre.pays} | Palabre`,
    description: raccourcir(membre.bio) || `Découvre le profil de ${membre.nom} sur Palabre, le réseau des développeurs africains.`,
    chemin: `/${identifiant}`,
    image: membre.avatar ? `/fichiers/${membre.avatar}` : null,
    type: 'profile',
  });
});

module.exports = router;
module.exports.echapper = echapper;
