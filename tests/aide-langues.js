// Outils du test des langues (tests/langues.test.js) : retrouver, dans un script ou une page, les textes français
// qui ne passeraient pas par t() ou par data-t.
//
// Un programme ne « comprend » pas le français : on reconnaît un texte d'interface à sa forme (des accents, une
// majuscule au début d'un mot, des petits mots comme « le », « de », « pour », un morceau de phrase collé à une
// valeur). Les faux positifs connus (noms de touches, marques, adresses) sont listés dans PERMIS.
const fs = require('node:fs');
const path = require('node:path');

const PERMIS = new Set([
  // touches du clavier et noms techniques du navigateur
  'Content-Type', 'Escape', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter', 'Tab', 'Home', 'End', 'PageDown', 'PageUp', 'Backspace', 'Delete',
  'AbortError', 'NotAllowedError', 'NotFoundError', 'IntersectionObserver', 'Notification', 'PushManager', 'Authorization', 'Range', 'Accept',
  'Shift', 'Control', 'Alt', 'Meta', 'Space',
  // marques et systèmes : ils ne se traduisent pas
  'Android', 'Windows', 'Mac', 'Edge', 'Firefox', 'Chrome', 'Safari', 'iPhone', 'iPad', 'Opera', 'Linux',
  'WhatsApp', 'Facebook', 'X', 'YouTube', 'TikTok', 'GitHub', 'GitLab', 'LinkedIn', 'Palabre', 'FCFA',
  // le nom d'une langue s'écrit dans cette langue, partout
  'Français', 'English', 'Français, English',
  // motifs de signalement : la VALEUR envoyée au serveur reste en français (l'équipe la lit dans /admin) ;
  // le libellé affiché, lui, passe par t() (public/js/app.js, MOTIFS_SIGNALEMENT)
  'Spam ou arnaque', 'Insultes ou harcèlement', 'Contenu choquant ou illégal', 'Faux profil ou usurpation', 'Autre raison',
]);
const ACCENTS = /[àâäçéèêëîïôöùûüœÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŒ«»…’]/;
const PETITS_MOTS = /(^|[ '’])(le|la|les|un|une|des|du|de|et|est|pas|pour|ton|ta|tes|tu|sur|dans|avec|ce|cette|qui|que|au|aux|ne|se|il|je|mon|ma|mes|te|vous|nous|ou|par)([ ,.!?]|$)/i;

// « texte » : la chaîne, où chaque ${…} est devenu une espace ; « brut » : la même, où il est devenu « {} ».
function ressembleAUnTexte(texte, brut = texte) {
  const propre = texte.trim();
  if (!propre || PERMIS.has(propre) || !/[A-Za-zÀ-ÿ]{2}/.test(propre)) return false;
  if (/^https?:/.test(propre) || brut === 'icone {}') return false;                // une adresse ; la classe d'une icône
  // Un morceau de phrase collé à une valeur : « {} commentaires », « Aimé par {} », « 1 autre ».
  if (!/[/=;<>[\]#]|^\(|--/.test(brut) && /\{\}\s+[a-zà-ÿ'’]{3,}|[a-zà-ÿ]{3,}\s+\{\}|^\d+ [a-zà-ÿ]{3,}/.test(brut.trim())) return true;
  if (/^[\w./:#?=&%-]+$/.test(propre) && !/^[A-ZÀ-Ý][a-zà-ÿ]{2,}$/.test(propre)) return false; // adresse, classe, clé
  if (ACCENTS.test(propre)) return true;
  if (/^[A-ZÀ-Ý]([a-zà-ÿ]+([ ,.!?:'’]|$)|['’][a-zà-ÿ])/.test(propre)) return true; // commence par un mot à majuscule
  return propre.split(/\s+/).length >= 3 && PETITS_MOTS.test(propre) && !/[[\]{}<>=;]|--|\.\w/.test(propre);
}

// Toutes les chaînes d'un script (entre apostrophes, guillemets ou accents graves), hors commentaires et expressions
// régulières. Pour chacune : sa ligne, son texte, si elle est l'argument de t(), si c'est une liste de classes CSS.
function chainesDuScript(source) {
  const chaines = [];
  let i = 0;
  let ligne = 1;
  let dernier = ''; // dernier caractère « utile » : sert à distinguer une division d'une expression régulière
  const avancer = (n = 1) => { for (let k = 0; k < n; k += 1) { if (source[i] === '\n') ligne += 1; i += 1; } };

  function lireChaine() {
    const debut = i;
    const fin = source[i];
    const chaine = { ligne, texte: '' };
    avancer();
    while (i < source.length && source[i] !== fin) {
      if (source[i] === '\\') { chaine.texte += source[i + 1] === 'n' ? ' ' : source[i + 1]; avancer(2); continue; }
      if (fin === '`' && source[i] === '$' && source[i + 1] === '{') {
        // ${ … } : du code, qui peut lui-même contenir des chaînes (lues à leur tour).
        chaine.texte += '{}';
        avancer(2);
        let profondeur = 1;
        while (i < source.length && profondeur > 0) {
          if (source[i] === '`' || source[i] === '\'' || source[i] === '"') { lireChaine(); continue; }
          if (source[i] === '{') profondeur += 1;
          if (source[i] === '}') profondeur -= 1;
          avancer();
        }
        continue;
      }
      chaine.texte += source[i];
      avancer();
    }
    avancer();
    // Dans t('…') seulement : « toast( » se termine aussi par « t( », il ne doit pas être confondu.
    chaine.dansT = /(^|[^\w.])t\(\s*$/.test(source.slice(Math.max(0, debut - 6), debut));
    chaine.css = /(classe:|className =|class',|classList\.\w+\(|querySelector(All)?\(|closest\(|matches\()\s*$/.test(source.slice(Math.max(0, debut - 24), debut));
    chaines.push(chaine);
  }

  while (i < source.length) {
    const c = source[i];
    if (c === '/' && source[i + 1] === '/') { while (i < source.length && source[i] !== '\n') avancer(); continue; }
    if (c === '/' && source[i + 1] === '*') { while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) avancer(); avancer(2); continue; }
    const apresReturn = /return$/.test(source.slice(Math.max(0, i - 7), i).trim());
    if (c === '/' && (/[(,=:[!&|?{};\n]|^$/.test(dernier) || apresReturn)) {
      // Une expression régulière : on la saute jusqu'à sa barre de fin (une barre entre crochets ne compte pas).
      avancer();
      let entreCrochets = false;
      while (i < source.length && (source[i] !== '/' || entreCrochets) && source[i] !== '\n') {
        if (source[i] === '\\') { avancer(2); continue; }
        if (source[i] === '[') entreCrochets = true;
        if (source[i] === ']') entreCrochets = false;
        avancer();
      }
      avancer();
      dernier = '/';
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') { lireChaine(); dernier = c; continue; }
    if (!/\s/.test(c)) dernier = c;
    avancer();
  }
  return chaines;
}

// Les textes en dur d'un script : « fichier:ligne  texte ».
function textesEnDurDuScript(fichier) {
  return chainesDuScript(fs.readFileSync(fichier, 'utf8'))
    .filter((c) => !c.dansT && !c.css && ressembleAUnTexte(c.texte.replace(/\{\}/g, ' '), c.texte))
    .map((c) => `${path.basename(fichier)}:${c.ligne}  ${c.texte.slice(0, 100)}`);
}

const decoder = (texte) => texte.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
const ATTRIBUTS = ['placeholder', 'aria-label', 'title', 'alt', 'content'];

// Lit une page : ses textes marqués (data-t et data-t-…), et ceux qui ne le sont pas.
function lirePage(fichier) {
  // Commentaires et scripts sont blanchis (les sauts de ligne restent, pour garder les numéros de ligne).
  const source = fs.readFileSync(fichier, 'utf8')
    .replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ' '))
    .replace(/<script[\s\S]*?<\/script>/g, (c) => c.replace(/[^\n]/g, ' '));
  const nom = path.basename(fichier);
  const ligneDe = (position) => source.slice(0, position).split('\n').length;
  const aDesLettres = (texte) => /[A-Za-zÀ-ÿ]{2}/.test(texte.replace(/&[a-z]+;|&#\d+;/g, ' '));
  const marques = [];   // { cle, texte, attribut }
  const enDur = [];
  const fautes = [];

  // 1. Un texte juste après une balise ouvrante : cette balise doit porter data-t.
  for (const m of source.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)([^<>]*)>([^<]+)(<\/?)/g)) {
    const [, balise, attributs, contenu, suite] = m;
    // Seules les espaces ordinaires sont réduites : l'espace insécable de « mon projet ? » fait partie du texte.
    const texte = decoder(contenu).replace(/[ \t\r\n]+/g, ' ').replace(/^ | $/g, '');
    const cle = /\bdata-t="([^"]+)"/.exec(attributs);
    if (cle) {
      marques.push({ cle: cle[1], texte, attribut: null });
      // data-t remplace TOUT le contenu de la balise : elle ne doit donc contenir que du texte.
      if (suite !== '</') fautes.push(`${nom}:${ligneDe(m.index)}  la balise data-t="${cle[1]}" contient une autre balise`);
      continue;
    }
    if (!aDesLettres(contenu) || PERMIS.has(texte)) continue;
    if (balise === 'title') continue;                                             // traduit par la clé « titre.<page> »
    if (balise === 'option' && /value="Burkina Faso"/.test(attributs)) continue;  // remplacé par la liste du serveur
    if (/^[\w.-]+\/$/.test(texte)) continue;                                      // « palabre.dev/ », remplacé par le script
    enDur.push(`${nom}:${ligneDe(m.index)}  ${texte.slice(0, 100)}`);
  }
  // 2. Un texte après une balise fermante (« <svg…></svg>Texte », « <a>lien</a> suite ») : il lui faut son <span data-t>.
  for (const m of source.matchAll(/<\/[a-zA-Z0-9]+>([^<]+)(?=<)/g)) {
    if (aDesLettres(m[1])) enDur.push(`${nom}:${ligneDe(m.index)}  (texte sans balise à lui) ${m[1].trim().slice(0, 90)}`);
  }
  // 3. Les attributs lus par les personnes : placeholder, aria-label, title, alt, et la description de la page.
  for (const m of source.matchAll(/<[a-zA-Z][^<>]*>/g)) {
    for (const attribut of ATTRIBUTS) {
      const valeur = new RegExp(`\\s${attribut}="([^"]*)"`).exec(m[0]);
      if (!valeur) continue;
      const cle = new RegExp(`data-t-${attribut}="([^"]+)"`).exec(m[0]);
      if (cle) { marques.push({ cle: cle[1], texte: decoder(valeur[1]), attribut }); continue; }
      if (!aDesLettres(valeur[1]) || PERMIS.has(valeur[1]) || /^https?:/.test(valeur[1])) continue;
      if (attribut === 'content' && !/name="description"/.test(m[0])) continue;   // les autres <meta> ne sont pas du texte
      enDur.push(`${nom}:${ligneDe(m.index)}  [${attribut}] ${valeur[1].slice(0, 90)}`);
    }
  }
  const titre = /<title>([^<]*)<\/title>/.exec(source);
  return { marques, enDur, fautes, titre: titre ? decoder(titre[1]) : null };
}

module.exports = { textesEnDurDuScript, chainesDuScript, ressembleAUnTexte, lirePage, PERMIS };
