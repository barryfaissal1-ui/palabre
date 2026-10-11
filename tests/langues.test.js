// Tests du site bilingue : les deux dictionnaires (public/langues/fr.js et en.js) et leur usage dans le code.
//  - mêmes clés dans les deux langues, mêmes variables {nom}, mêmes pluriels ;
//  - aucune clé utilisée dans le code qui manquerait ;
//  - aucun texte français resté « en dur » dans les pages ou les scripts de l'interface ;
//  - en français, rien ne change : le texte d'une page est exactement celui de sa clé.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fr = require('../public/langues/fr.js');
const en = require('../public/langues/en.js');
const { textesEnDurDuScript, lirePage } = require('./aide-langues');
const { PAYS } = require('../src/utils/validation');
const profilDev = require('../src/utils/profil-dev');
const grille = require('../public/js/grille-prix.js');

const PUBLIC = path.join(__dirname, '..', 'public');
const scripts = fs.readdirSync(path.join(PUBLIC, 'js')).filter((f) => f.endsWith('.js')).map((f) => path.join(PUBLIC, 'js', f));
const pages = [
  ...fs.readdirSync(PUBLIC).filter((f) => f.endsWith('.html')).map((f) => path.join(PUBLIC, f)),
  path.join(__dirname, '..', 'src', 'vues', '404.html'), path.join(__dirname, '..', 'src', 'vues', '500.html'),
];
const variables = (texte) => [...texte.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const formes = (valeur) => (typeof valeur === 'string' ? [valeur] : [valeur.un, valeur.autres]);
const cleDe = (texte) => texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

test('fr.js et en.js : exactement les mêmes clés, dans le même ordre', () => {
  assert.ok(Object.keys(fr).length > 900, `seulement ${Object.keys(fr).length} clés`);
  assert.deepEqual(Object.keys(en).filter((cle) => !(cle in fr)), [], 'clés anglaises sans français');
  assert.deepEqual(Object.keys(fr).filter((cle) => !(cle in en)), [], 'clés françaises sans anglais');
  assert.deepEqual(Object.keys(en), Object.keys(fr), 'même ordre : on compare les deux fichiers ligne à ligne');
});

test('chaque texte : même forme (texte simple ou pluriel), mêmes variables, jamais vide', () => {
  const fautes = [];
  for (const cle of Object.keys(fr)) {
    if (typeof fr[cle] !== typeof en[cle]) { fautes.push(`${cle} : un pluriel d'un côté, un texte simple de l'autre`); continue; }
    if (typeof fr[cle] === 'object' && (Object.keys(fr[cle]).join() !== 'un,autres' || Object.keys(en[cle]).join() !== 'un,autres')) fautes.push(`${cle} : un pluriel s'écrit { un, autres }`);
    for (const texte of [...formes(fr[cle]), ...formes(en[cle])]) {
      if (typeof texte !== 'string' || texte.trim() === '') fautes.push(`${cle} : texte vide`);
    }
    // Une variable oubliée dans une langue s'afficherait telle quelle (« {nom} ») ou ferait disparaître une information.
    // (Le français a parfois {deNom}, « d'Awa », là où l'anglais se contente de {nom}, « Awa's ».)
    // {deNom} et {nom} désignent la même personne : on les compte pour une seule variable.
    const sansElision = (liste) => [...new Set(liste.split(',').filter(Boolean).map((v) => v.replace(/^de([A-Z])/, (tout, lettre) => lettre.toLowerCase())))].sort().join(',');
    const [vf, ve] = [variables(formes(fr[cle]).join(' ')), variables(formes(en[cle]).join(' '))];
    if (sansElision(vf) !== sansElision(ve)) fautes.push(`${cle} : variables différentes (fr : ${vf || 'aucune'} ; en : ${ve || 'aucune'})`);
    // Dans un pluriel, « un » et « autres » portent les mêmes variables.
    if (typeof fr[cle] === 'object') {
      for (const [langue, valeur] of [['fr', fr[cle]], ['en', en[cle]]]) {
        if (variables(valeur.un) !== variables(valeur.autres)) fautes.push(`${cle} (${langue}) : « un » et « autres » n'ont pas les mêmes variables`);
      }
    }
  }
  assert.deepEqual(fautes, []);
});

test('aucune clé utilisée dans le code n\'est absente des dictionnaires', () => {
  const absentes = [];
  const utilisees = new Set();
  for (const fichier of scripts) {
    const source = fs.readFileSync(fichier, 'utf8').replace(/^\s*\/\/.*$/gm, ''); // sans les lignes de commentaire
    // t('cle') : la clé doit exister.
    for (const [, cle] of source.matchAll(/(?<![\w.])t\(\s*'([^']+)'/g)) { utilisees.add(cle); if (!(cle in fr)) absentes.push(`${path.basename(fichier)} : ${cle}`); }
    // t(cond ? 'cle.a' : 'cle.b') : les deux doivent exister.
    for (const [, a, b] of source.matchAll(/(?<![\w.])t\([^()'`]*\? '([a-z0-9.-]+)' : '([a-z0-9.-]+)'/g)) {
      for (const cle of [a, b]) { utilisees.add(cle); if (!(cle in fr)) absentes.push(`${path.basename(fichier)} : ${cle}`); }
    }
    // t(`famille.${valeur}`) : au moins une clé commence par « famille. ».
    for (const [, debut] of source.matchAll(/(?<![\w.])t\(\s*`([a-z0-9.-]+\.)\$\{/g)) {
      if (!Object.keys(fr).some((cle) => cle.startsWith(debut))) absentes.push(`${path.basename(fichier)} : ${debut}…`);
    }
  }
  for (const page of pages) {
    for (const { cle } of lirePage(page).marques) { utilisees.add(cle); if (!(cle in fr)) absentes.push(`${path.basename(page)} : ${cle}`); }
  }
  assert.deepEqual(absentes, []);
  assert.ok(utilisees.size > 700, `seulement ${utilisees.size} clés utilisées`);
});

test('aucun texte français en dur dans les scripts de l\'interface', () => {
  // Deux fichiers de DONNÉES gardent leur français, lu par les tests et par l'équipe :
  //  - grille-prix.js : la grille de prix (le seul fichier à modifier pour un prix) ; ses libellés sont les textes
  //    par défaut, et leurs traductions sont sous « calcul.<famille>.<id>.… » (vérifié plus bas) ;
  //  - calcul-prix.js : ses messages sont des erreurs de programmation (« Choix inconnu »), jamais affichées.
  const DONNEES = ['grille-prix.js', 'calcul-prix.js'];
  const restes = scripts.filter((f) => !DONNEES.includes(path.basename(f))).flatMap(textesEnDurDuScript);
  assert.deepEqual(restes, [], 'ces textes doivent passer par t(\'cle\'), avec la clé dans fr.js ET en.js');
});

test('pages HTML : chaque texte porte data-t, et en français la page dit exactement ce que dit sa clé', () => {
  const fautes = [];
  for (const page of pages) {
    const { marques, enDur, fautes: malFormees } = lirePage(page);
    fautes.push(...enDur.map((reste) => `en dur → ${reste}`), ...malFormees);
    for (const { cle, texte, attribut } of marques) {
      if (!(cle in fr)) continue; // déjà signalé par le test des clés
      // Le français ne doit changer en rien : le texte écrit dans la page est celui du dictionnaire.
      if (fr[cle] !== texte) fautes.push(`${path.basename(page)} : ${attribut ? `${attribut} ` : ''}« ${texte} » ≠ fr.js[${cle}] « ${fr[cle]} »`);
    }
  }
  assert.deepEqual(fautes, []);
});

test('titre des pages : la clé « titre.<page> » existe et reprend le <title> français', () => {
  // Ces trois pages reçoivent leur titre du serveur (le nom du membre, du projet, l'auteur de la publication).
  const TITRE_DU_SERVEUR = ['profil.html', 'projet.html', 'publication.html'];
  for (const page of pages.filter((p) => p.startsWith(PUBLIC) && !TITRE_DU_SERVEUR.includes(path.basename(p)))) {
    const nom = path.basename(page, '.html');
    const cle = `titre.${nom === 'index' ? 'accueil' : nom}`;
    assert.equal(fr[cle], lirePage(page).titre, cle);
    assert.ok(en[cle] && en[cle].includes('Palabre'), `${cle} en anglais`);
  }
  assert.equal(fr['titre.inscription'], 'Créer un compte – Palabre');
});

test('listes : pays, spécialités, expériences et grille du calculateur ont leur libellé dans les deux langues', () => {
  for (const pays of PAYS) {
    const cle = `pays.${cleDe(pays)}`;
    assert.equal(fr[cle], pays, cle); // la valeur gardée en base est le nom français
    assert.ok(en[cle], `${cle} en anglais`);
  }
  for (const [id, nom] of Object.entries(profilDev.SPECIALITES)) assert.equal(fr[`specialite.${id}`], nom);
  for (const [id, nom] of Object.entries(profilDev.EXPERIENCES)) assert.equal(fr[`experience.${id}`], nom);
  // La grille de prix : le français du dictionnaire est celui de grille-prix.js, mot pour mot.
  for (const famille of ['types', 'tailles', 'options', 'delais']) {
    for (const element of grille[famille]) {
      for (const champ of ['nom', 'aide', 'unite']) {
        if (!element[champ]) continue;
        const cle = `calcul.${famille}.${element.id}.${champ}`;
        assert.equal(fr[cle], element[champ], cle);
        assert.ok(en[cle], `${cle} en anglais`);
      }
    }
  }
});

test('anglais : les mots de Palabre sont traduits comme convenu', () => {
  const tout = Object.values(en).flatMap(formes).join('\n');
  assert.match(tout, /flash team/i);
  assert.match(tout, /Proven profile/);
  assert.match(tout, /Weekly challenge/);
  assert.match(tout, /palaver tree/);
  // Aucun mot français de Palabre oublié dans l'anglais.
  assert.doesNotMatch(tout, /équipe éclair|Profil prouvé|Défi de la semaine|arbre à palabres/i);
  assert.equal(en['commun.profil-prouve'], 'Proven profile');
  assert.equal(en['nav.defi'], 'Weekly challenge');
});
