// Le filtre automatique : tout texte qu'un membre écrit et que d'autres verront passe ici AVANT d'être enregistré.
//
// analyser(texte, langue) rend l'un de ces trois résultats :
//   « accepte »    : rien à signaler ;
//   « refuse »     : insulte, mot haineux, contenu sexuel explicite ou lien dangereux. Le texte n'est pas enregistré,
//                    et le membre lit un message clair et poli, qui ne répète jamais le mot ;
//   « en_attente » : le texte ressemble à une arnaque. Il est enregistré mais caché, et ne sera visible qu'après la
//                    vérification d'un administrateur. Son auteur est prévenu.
// Les listes sont dans moderation-listes.js. Aucune bibliothèque : le texte est « nettoyé », puis comparé mot à mot.
//
// Messages privés et propositions : personne ne les lit, et le filtre ne retient que les insultes et les liens
// dangereux (option « prive »). Le reste relève du bandeau anti-arnaque affiché au destinataire.
const db = require('../db/pool');
const { ErreurValidation } = require('./validation');
const L = require('./moderation-listes');

const MESSAGES = {
  insulte: 'Ton texte contient un mot insultant ou une menace. Reformule-le pour pouvoir l\'envoyer.',
  haine: 'Ton texte contient un mot haineux, interdit sur Palabre. Reformule-le pour pouvoir l\'envoyer.',
  sexuel: 'Ton texte contient des mots à caractère sexuel, interdits sur Palabre. Reformule-le pour pouvoir l\'envoyer.',
  'lien-raccourci': 'Les liens raccourcis ne sont pas acceptés : on ne voit pas où ils mènent. Colle l\'adresse complète.',
  'lien-ip': 'Les liens vers une adresse faite de chiffres ne sont pas acceptés. Utilise le nom du site.',
  'lien-imitation': 'Ce lien ressemble à l\'imitation d\'un site connu (banque, opérateur). Il n\'est pas accepté.',
  'lien-interdit': 'Ce lien n\'est pas accepté sur Palabre.',
  arnaque: 'Ce texte ressemble à une arnaque (paiement d\'avance, gain garanti, code à envoyer). Il n\'est pas accepté ici.',
};

// ---------- Nettoyer le texte ----------
const sansAccents = (texte) => String(texte || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// Chiffres et signes mis à la place de lettres : « c0nnard », « sh1t », « s@lope », « a$$ ».
const LETTRES = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '€': 'e' };
const reduire = (mot) => mot.replace(/(.)\1+/g, '$1'); // « saloooope » → « salope »
const REDUITS = new Map(); // liste → la même, chaque mot réduit (calculé une fois)
function reduits(liste) {
  if (!REDUITS.has(liste)) REDUITS.set(liste, new Set([...liste].map(reduire)));
  return REDUITS.get(liste);
}

// Les mots d'un texte, prêts à être comparés. Chaque mot : { mot, deguise }. « deguise » : il portait des chiffres
// à la place de lettres, ou une lettre répétée trois fois et plus. Seul un mot déguisé est comparé « réduit » :
// ainsi « niger » (le pays) n'est jamais confondu avec le mot à deux « g ».
function motsDe(texte) {
  const resultat = [];
  for (const brut of sansAccents(texte).match(/[a-z0-9@$!€]+/g) || []) {
    const morceau = brut.replace(/^[!]+|[!]+$/g, '');
    if (!/[a-z]/.test(morceau)) continue; // un nombre seul n'est pas un mot
    const lettres = morceau.replace(/[0-9@$!€]/g, (signe) => LETTRES[signe] || '');
    const etire = /(.)\1\1/.test(lettres);
    resultat.push({ mot: lettres.replace(/(.)\1{2,}/g, '$1$1'), deguise: etire || lettres !== morceau });
  }
  // « c o n n a r d » : quatre lettres isolées ou plus, à la suite, sont recollées en un seul mot.
  const recolles = [];
  let lettresSeules = [];
  const vider = () => {
    if (lettresSeules.length >= 4) recolles.push({ mot: lettresSeules.join(''), deguise: true });
    else lettresSeules.forEach((lettre) => recolles.push({ mot: lettre, deguise: false }));
    lettresSeules = [];
  };
  for (const element of resultat) {
    if (element.mot.length === 1) { lettresSeules.push(element.mot); continue; }
    vider();
    recolles.push(element);
  }
  vider();
  return recolles;
}

const dansLaListe = (element, liste) => liste.has(element.mot) || (element.deguise && reduits(liste).has(reduire(element.mot)));

// ---------- Liens ----------
// Les adresses d'un texte : avec « http », avec « www. », ou un nom de site à la terminaison connue (.com, .bf…).
// Une adresse email, un nom de fichier (« index.html ») ou de technologie (« socket.io ») n'est pas un lien.
const MOTIF_LIEN = /(https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,24}|\d{1,3}(?:\.\d{1,3}){3})(:\d{2,5})?(\/[^\s<>"')]*)?/g;
const IP_PRIVEE = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0$|169\.254\.)/;
function liensDe(texte) {
  const source = sansAccents(texte);
  const liens = [];
  for (const trouve of source.matchAll(MOTIF_LIEN)) {
    const [, schema, hote, port, chemin] = trouve;
    if (trouve.index > 0 && source[trouve.index - 1] === '@') continue; // la fin d'une adresse email
    if (/^\d/.test(hote) && /^\d{1,3}(\.\d{1,3}){3}$/.test(hote)) {
      // Une adresse IP n'est un lien que si elle est écrite comme tel. Les adresses locales (127.0.0.1, 192.168…)
      // font partie du vocabulaire d'un développeur : elles ne mènent nulle part pour les autres.
      if ((schema || port || chemin) && !IP_PRIVEE.test(hote)) liens.push({ hote, ip: true });
      continue;
    }
    const nu = hote.replace(/^www\./, '');
    if (L.NOMS_TECHNIQUES.has(nu)) continue;
    if (!schema && !hote.startsWith('www.') && !L.TERMINAISONS.has(nu.split('.').pop())) continue;
    liens.push({ hote: nu, ip: false });
  }
  return liens;
}
const contientUnLien = (texte) => liensDe(texte).length > 0;

// Distance entre deux mots : le nombre de lettres à changer, ajouter ou retirer pour passer de l'un à l'autre.
function distance(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  let avant = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const ligne = [i];
    for (let j = 1; j <= b.length; j += 1) ligne[j] = Math.min(avant[j] + 1, ligne[j - 1] + 1, avant[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    avant = ligne;
  }
  return avant[b.length];
}

// Un faux domaine qui imite une banque ou un opérateur : « 0range-money.com », « ecobannk.net », « wave-bonus.xyz ».
function imiteUneMarque(hote) {
  const morceaux = hote.split(/[.-]/).slice(0, -1); // sans la terminaison
  for (const [marque, officiels] of Object.entries(L.MARQUES)) {
    if (officiels.some((domaine) => hote === domaine || hote.endsWith(`.${domaine}`))) return false; // le vrai site
    const exact = morceaux.includes(marque);
    for (const morceau of morceaux) {
      if (morceau === marque) continue;
      // Écrit de travers : avec un chiffre à la place d'une lettre, ou à une lettre près (noms de 5 lettres et plus).
      const variantes = [morceau.replace(/[0-9]/g, (c) => LETTRES[c] || c), morceau.replace(/1/g, 'l').replace(/[0-9]/g, (c) => LETTRES[c] || c)];
      if (variantes.includes(marque)) return true;
      if (marque.length >= 5 && morceau[0] === marque[0] && variantes.some((v) => distance(v, marque) === 1)) return true;
      // Collé à un mot d'appât : « orangebonus », « ecobanklogin ».
      if (morceau.startsWith(marque) && L.APPATS.has(morceau.slice(marque.length))) return true;
    }
    // Le nom exact, accompagné d'un mot d'appât, hors de ses domaines officiels.
    if (exact && morceaux.some((morceau) => L.APPATS.has(morceau))) return true;
  }
  return false;
}

// ---------- L'analyse ----------
// langue : celle du site de l'auteur ('fr' par défaut). Elle ne sert qu'aux mots qui sont une insulte dans une
// langue et un mot ordinaire dans l'autre ; toutes les autres listes valent pour tout le monde.
// options.prive : message privé ou proposition (insultes et liens seulement).
// options.domaines : les domaines interdits par les administrateurs (voir domainesInterdits()).
function analyser(texte, langue = 'fr', { prive = false, domaines = new Set() } = {}) {
  const refuse = (raison) => ({ resultat: 'refuse', raison, message: MESSAGES[raison] });
  if (typeof texte !== 'string' || !texte.trim()) return { resultat: 'accepte', raison: null, message: null };

  let mots = motsDe(texte);
  let phrase = ` ${mots.map((m) => m.mot).join(' ')} `;
  for (const innocente of L.EXPRESSIONS_INNOCENTES) phrase = phrase.split(` ${innocente} `).join(' ');
  const restants = new Set(phrase.trim().split(' '));
  mots = mots.filter((m) => restants.has(m.mot));
  const contient = (expressions) => expressions.some((expression) => phrase.includes(` ${expression} `));

  if (mots.some((m) => dansLaListe(m, L.HAINE)) || contient(L.HAINE_EXPRESSIONS)) return refuse('haine');
  if (mots.some((m) => dansLaListe(m, L.INSULTES)) || contient(L.INSULTES_EXPRESSIONS)) return refuse('insulte');
  if (langue !== 'en' && mots.some((m) => dansLaListe(m, L.INSULTES_FRANCAIS))) return refuse('insulte');

  for (const { hote, ip } of liensDe(texte)) {
    if (ip) return refuse('lien-ip');
    if (L.RACCOURCISSEURS.has(hote)) return refuse('lien-raccourci');
    if ([...domaines].some((domaine) => hote === domaine || hote.endsWith(`.${domaine}`))) return refuse('lien-interdit');
    if (imiteUneMarque(hote)) return refuse('lien-imitation');
  }
  if (prive) return { resultat: 'accepte', raison: null, message: null };

  if (mots.some((m) => dansLaListe(m, L.SEXUEL)) || contient(L.SEXUEL_EXPRESSIONS)) return refuse('sexuel');
  // Les phrases d'arnaque : sur le texte en minuscules sans accents, chiffres gardés tels quels.
  const propre = sansAccents(texte).replace(/[^a-z0-9%$]+/g, ' ').trim();
  if (L.ARNAQUES.some((motif) => motif.test(propre))) return { resultat: 'en_attente', raison: 'arnaque', message: 'Ton texte sera visible après vérification par l\'équipe.' };
  return { resultat: 'accepte', raison: null, message: null };
}

// Ce texte parle-t-il d'un paiement d'avance (Mobile Money, « envoie d'abord », frais de dossier…) ? Sert au
// bandeau anti-arnaque montré au destinataire d'un message ou d'une proposition. Rien n'est refusé ni enregistré :
// la réponse est calculée à la lecture, à partir du texte.
function parleDePaiement(texte) {
  if (typeof texte !== 'string' || !texte) return false;
  const propre = sansAccents(texte).replace(/[^a-z0-9]+/g, ' ').trim();
  return L.PAIEMENT_AVANCE.some((motif) => motif.test(propre)) || L.ARNAQUES.some((motif) => motif.test(propre));
}

// ---------- Les domaines interdits par les administrateurs (table domaines_interdits) ----------
// Gardés 30 secondes en mémoire : le filtre tourne à chaque texte, il ne doit pas interroger la base à chaque fois.
let domainesConnus = { le: 0, liste: new Set() };
async function domainesInterdits() {
  if (Date.now() - domainesConnus.le > 30000) {
    const { rows } = await db.query('SELECT domaine FROM domaines_interdits');
    domainesConnus = { le: Date.now(), liste: new Set(rows.map((ligne) => ligne.domaine)) };
  }
  return domainesConnus.liste;
}
const oublierDomaines = () => { domainesConnus = { le: 0, liste: new Set() }; };

// ---------- Pour les routes ----------
// controler(req, [[texte, 'champ'], …], { mode }) : à appeler juste après la validation des champs.
//   mode 'public' : publication, commentaire, demande, projet. Renvoie { enAttente, raison }.
//   mode 'strict' : un texte qu'on ne sait pas « mettre en attente » (bio, titre de groupe, réponse au défi, avis) :
//                   une phrase d'arnaque y est refusée.
//   mode 'prive'  : message privé, proposition : insultes et liens dangereux seulement.
// Un texte refusé lève une ErreurValidation avec le nom du champ : la page l'affiche sous le champ.
async function controler(req, textes, { mode = 'public' } = {}) {
  const langue = (req.utilisateur && req.utilisateur.langue) || 'fr';
  const domaines = await domainesInterdits();
  let enAttente = null;
  for (const [texte, champ] of textes) {
    const verdict = analyser(texte, langue, { prive: mode === 'prive', domaines });
    if (verdict.resultat === 'refuse') throw new ErreurValidation(verdict.message, champ);
    if (verdict.resultat === 'en_attente') {
      if (mode === 'strict') throw new ErreurValidation(MESSAGES.arnaque, champ);
      enAttente = verdict.raison;
    }
  }
  return { enAttente: Boolean(enAttente), raison: enAttente };
}

// Les contenus qu'on sait cacher en attendant une vérification : leur table porte une colonne « masque ».
const TABLES = { publication: 'publications', commentaire: 'commentaires', demande: 'demandes', projet: 'projets' };
const PHRASE_ATTENTE = {
  publication: 'Ta publication sera visible après vérification par l\'équipe.',
  commentaire: 'Ton commentaire sera visible après vérification par l\'équipe.',
  demande: 'Ta demande sera visible après vérification par l\'équipe.',
  projet: 'Ton projet sera visible après vérification par l\'équipe.',
};

// Cache le contenu et l'inscrit dans la file « À modérer » de /admin. À appeler dans la transaction qui le crée.
async function mettreEnAttente(client, type, id, auteurId, raison) {
  await client.query(`UPDATE ${TABLES[type]} SET masque = TRUE WHERE id = $1`, [id]);
  await client.query(
    `INSERT INTO moderation_attente (cible_type, cible_id, auteur_id, raison) VALUES ($1, $2, $3, $4)
     ON CONFLICT (cible_type, cible_id) WHERE decide_le IS NULL DO NOTHING`,
    [type, id, auteurId, raison],
  );
}

module.exports = { analyser, controler, mettreEnAttente, parleDePaiement, liensDe, contientUnLien, imiteUneMarque, motsDe, domainesInterdits, oublierDomaines, MESSAGES, TABLES, PHRASE_ATTENTE };
