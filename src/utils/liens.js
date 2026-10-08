// Liens des projets : contrôle de l'adresse saisie, puis vérification que le site répond vraiment.
//
// Danger à éviter (attaque « SSRF ») : c'est le SERVEUR qui visite le lien. Sans précaution, un membre
// pourrait lui faire visiter une adresse interne (localhost, 192.168.x.x, la base de données, la console
// de l'hébergeur…) et s'en servir pour sonder le réseau privé. On refuse donc toute adresse interne,
// à chaque étape : à la saisie, après la résolution DNS, et à chaque redirection.
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const dns = require('node:dns').promises;
const { ErreurValidation } = require('./validation');

const DELAI_MS = 5000;
const MAX_REDIRECTIONS = 3;

// Plages d'adresses qui ne sont pas sur l'internet public.
const INTERDITES = new net.BlockList();
[
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
].forEach(([adresse, prefixe]) => INTERDITES.addSubnet(adresse, prefixe, 'ipv4'));
// Pas de règle pour les adresses IPv4 écrites en IPv6 (::ffff:127.0.0.1) : Node les compare déjà
// aux plages IPv4 ci-dessus. Une règle ::ffff:0:0/96 refuserait au contraire TOUTES les adresses IPv4.
[
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['fc00::', 7],
  ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32],
].forEach(([adresse, prefixe]) => INTERDITES.addSubnet(adresse, prefixe, 'ipv6'));

// Vrai si l'adresse IP est interne (ou illisible : dans le doute, on refuse).
function adresseInterne(ip) {
  const famille = net.isIP(ip);
  if (famille === 0) return true;
  return INTERDITES.check(ip, famille === 4 ? 'ipv4' : 'ipv6');
}

// Nom de machine sans les crochets des adresses IPv6 ([::1] → ::1).
function hoteDe(url) {
  return url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
}

// Vrai si le nom désigne à coup sûr une machine interne, sans même interroger le DNS.
function hoteInterne(hote) {
  if (net.isIP(hote)) return adresseInterne(hote);
  return hote === 'localhost' || /\.(localhost|local|internal|lan|home|intranet)$/.test(hote) || !hote.includes('.');
}

// Contrôle le lien saisi par le dev et le renvoie sous forme propre (ou null s'il est vide).
// L'analyseur d'adresses de Node ramène aussi les écritures déguisées (http://2130706433/, http://0x7f.1/)
// à leur vraie forme 127.0.0.1, qui est alors refusée.
function normaliserLien(valeur, champ = 'lien') {
  const brut = typeof valeur === 'string' ? valeur.trim() : '';
  if (!brut) return null;
  if (brut.length > 300) throw new ErreurValidation('Lien trop long (300 caractères au plus).', champ);
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(brut) ? brut : `https://${brut}`);
  } catch {
    throw new ErreurValidation('Lien invalide. Exemple : https://monprojet.com', champ);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ErreurValidation('Le lien doit commencer par http:// ou https://', champ);
  }
  if (url.username || url.password) throw new ErreurValidation('Le lien ne doit pas contenir d\'identifiants.', champ);
  if (hoteInterne(hoteDe(url))) {
    throw new ErreurValidation('Ce lien pointe vers une adresse interne. Indique l\'adresse publique du projet.', champ);
  }
  if (url.port) throw new ErreurValidation('Le lien ne doit pas préciser de port.', champ);
  return url.href;
}

// Une seule visite, sans suivre les redirections. Renvoie { statut, suite } ou lance une erreur.
async function visiter(url, { autoriserInternes, resoudre }) {
  const hote = hoteDe(url);
  const permis = autoriserInternes(hote);
  if (!permis && (url.port || hoteInterne(hote))) throw new Error('adresse interne');

  // 1. On demande au DNS où mène ce nom, et on refuse si UNE seule des adresses est interne.
  const adresses = net.isIP(hote)
    ? [{ address: hote, family: net.isIP(hote) }]
    : await resoudre(hote, { all: true });
  if (adresses.length === 0) throw new Error('nom introuvable');
  if (!permis && adresses.some((a) => adresseInterne(a.address))) throw new Error('adresse interne');
  const cible = adresses[0];

  // 2. On se connecte à l'adresse que l'on vient de contrôler, sans redemander au DNS :
  //    sinon il pourrait répondre autre chose la seconde fois (attaque par « DNS rebinding »).
  const adresseFigee = (nom, options, rappel) => (options.all
    ? rappel(null, [{ address: cible.address, family: cible.family }])
    : rappel(null, cible.address, cible.family));

  return new Promise((resolve, reject) => {
    const requete = (url.protocol === 'https:' ? https : http).request(url, {
      method: 'GET',
      lookup: adresseFigee,
      signal: AbortSignal.timeout(DELAI_MS),
      headers: { 'User-Agent': 'PalabreBot/1.0 (verification de lien)', Accept: 'text/html,*/*;q=0.8' },
    }, (reponse) => {
      // Seuls le code de réponse et l'éventuelle redirection nous intéressent : on ne télécharge pas la page.
      resolve({ statut: reponse.statusCode, suite: reponse.headers.location });
      reponse.destroy();
    });
    requete.on('error', reject);
    requete.end();
  });
}

// Vérifie qu'un lien répond (code 2xx), en suivant au plus 3 redirections, chacune recontrôlée.
// Ne lance jamais d'erreur : renvoie true ou false.
// Options réservées aux tests (les routes ne les passent jamais) :
//   autoriserInternes(hote) → true pour laisser passer le serveur de test qui tourne sur 127.0.0.1 ;
//   resoudre → un faux DNS.
async function verifierLien(lien, { autoriserInternes = () => false, resoudre = dns.lookup } = {}) {
  try {
    let url = new URL(lien);
    for (let saut = 0; saut <= MAX_REDIRECTIONS; saut += 1) {
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
      const { statut, suite } = await visiter(url, { autoriserInternes, resoudre });
      if (statut >= 200 && statut < 300) return true;
      if (statut < 300 || statut >= 400 || !suite) return false;
      url = new URL(suite, url);
    }
    return false; // trop de redirections
  } catch {
    return false;
  }
}

module.exports = { normaliserLien, verifierLien, adresseInterne, hoteInterne };
