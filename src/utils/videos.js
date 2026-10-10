// Liens vidéo des publications : YouTube, TikTok ou Facebook.
// On ne garde JAMAIS l'adresse collée par le membre : seulement le nom de la plateforme et l'identifiant de la vidéo,
// extraits avec des expressions strictes. C'est le site qui reconstruit ensuite l'adresse du lecteur officiel :
// un membre ne peut donc pas faire afficher une page de son choix dans le fil.
const { ErreurValidation } = require('./validation');

const PLATEFORMES = ['youtube', 'tiktok', 'facebook'];
const ID_YOUTUBE = /^[A-Za-z0-9_-]{11}$/; // toujours 11 caractères
const ID_CHIFFRES = /^\d{5,25}$/; // TikTok et Facebook : un grand nombre
const CODE_FB_WATCH = /^[A-Za-z0-9_-]{4,20}$/;

// Pour chaque plateforme : les noms de site acceptés (exacts, pas « contient ») et comment lire l'identifiant.
const LECTEURS = {
  youtube(url, hote) {
    let id = null;
    if (hote === 'youtu.be') id = url.pathname.slice(1).split('/')[0];
    else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(hote)) {
      const shorts = /^\/shorts\/([^/]+)\/?$/.exec(url.pathname);
      if (shorts) [, id] = shorts;
      else if (url.pathname === '/watch') id = url.searchParams.get('v');
    }
    return id && ID_YOUTUBE.test(id) ? id : null;
  },
  tiktok(url, hote) {
    if (!['tiktok.com', 'www.tiktok.com', 'm.tiktok.com'].includes(hote)) return null;
    const trouve = /^\/@[A-Za-z0-9._]{1,40}\/video\/(\d+)\/?$/.exec(url.pathname);
    return trouve && ID_CHIFFRES.test(trouve[1]) ? trouve[1] : null;
  },
  facebook(url, hote) {
    // fb.watch/AbCd123/ : lien court, on garde son code.
    if (hote === 'fb.watch') {
      const code = url.pathname.replace(/^\/|\/$/g, '');
      return CODE_FB_WATCH.test(code) ? code : null;
    }
    if (!['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com'].includes(hote)) return null;
    // facebook.com/NomDeLaPage/videos/123456 (parfois avec un titre entre les deux) ou facebook.com/watch/?v=123456
    const page = /^\/[A-Za-z0-9.]{1,80}\/videos\/(?:[^/]+\/)?(\d+)\/?$/.exec(url.pathname);
    const id = page ? page[1] : (/^\/watch\/?$/.test(url.pathname) ? url.searchParams.get('v') : null);
    return id && ID_CHIFFRES.test(id) ? id : null;
  },
};

// Lit le lien collé. Renvoie null s'il est vide, { plateforme, id } s'il est reconnu, sinon lance une erreur sur le champ.
function lireLienVideo(valeur, champ = 'video') {
  const brut = typeof valeur === 'string' ? valeur.trim() : '';
  if (!brut) return null;
  const refus = new ErreurValidation('Lien vidéo non reconnu. Colle le lien d\'une vidéo YouTube, TikTok ou Facebook.', champ);
  if (brut.length > 300) throw refus;
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(brut) ? brut : `https://${brut}`);
  } catch {
    throw refus;
  }
  // Seulement http(s), sans identifiants ni port : « https://youtube.com@pirate.example/… » ou « javascript:… » s'arrêtent ici.
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) throw refus;
  const hote = url.hostname.toLowerCase();
  if (hote === 'vm.tiktok.com' || hote === 'vt.tiktok.com') {
    throw new ErreurValidation('Lien TikTok raccourci : ouvre la vidéo et colle son lien complet (tiktok.com/@nom/video/…).', champ);
  }
  for (const plateforme of PLATEFORMES) {
    const id = LECTEURS[plateforme](url, hote);
    if (id) return { plateforme, id };
  }
  throw refus;
}

module.exports = { lireLienVideo, PLATEFORMES };
