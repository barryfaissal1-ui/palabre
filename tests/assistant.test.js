// Tests du Griot de Palabre : la recherche par mots-clés (public/js/assistant-recherche.js), qui tourne dans le
// navigateur et se teste ici toute seule, comme calcul-prix.js. Aucun serveur n'est démarré : le Griot n'envoie rien.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const moteur = require('../public/js/assistant-recherche.js');

const racine = path.join(__dirname, '..');
const dictionnaires = { fr: require('../public/langues/fr.js'), en: require('../public/langues/en.js') };
const index = moteur.indexer(dictionnaires);
const trouve = (question) => moteur.chercher(question, index);
const ids = moteur.SUJETS.map((sujet) => sujet.id);

test('chaque sujet a ses trois textes dans les deux langues, et chaque bouton son libellé', () => {
  for (const langue of ['fr', 'en']) {
    for (const id of ids) {
      for (const partie of ['question', 'mots', 'reponse']) assert.ok(dictionnaires[langue][`assistant.sujet.${id}.${partie}`], `${langue} : assistant.sujet.${id}.${partie}`);
      // Une réponse : 2 ou 3 phrases, pas un roman.
      const phrases = dictionnaires[langue][`assistant.sujet.${id}.reponse`].split(/[.!?](?:\s|$)/).filter((p) => p.trim()).length;
      assert.ok(phrases >= 2 && phrases <= 4, `${langue} ${id} : ${phrases} phrases`);
    }
    for (const bouton of Object.keys(moteur.BOUTONS)) assert.ok(dictionnaires[langue][`assistant.bouton.${bouton}`], `${langue} : assistant.bouton.${bouton}`);
  }
  // Aucun texte de sujet orphelin : chaque clé « assistant.sujet.… » correspond à un sujet de la liste.
  for (const cle of Object.keys(dictionnaires.fr)) {
    const sujet = /^assistant\.sujet\.([a-z-]+)\./.exec(cle);
    if (sujet) assert.ok(ids.includes(sujet[1]), cle);
  }
  // Les boutons d'un sujet existent, et les pages citées dans PAR_PAGE ne nomment que de vrais sujets.
  for (const sujet of moteur.SUJETS) for (const bouton of sujet.boutons) assert.ok(moteur.BOUTONS[bouton], `${sujet.id} : ${bouton}`);
  for (const [page, liste] of Object.entries(moteur.PAR_PAGE)) for (const id of liste) assert.ok(ids.includes(id), `${page} : ${id}`);
});

test('chaque suggestion trouve sa réponse, en français et en anglais', () => {
  for (const langue of ['fr', 'en']) {
    for (const id of ids) {
      const question = dictionnaires[langue][`assistant.sujet.${id}.question`];
      assert.equal(trouve(question), id, `${langue} : « ${question} »`);
    }
  }
});

test('fautes courantes, abréviations, majuscules et accents : la bonne réponse quand même', () => {
  const cas = {
    'combien sa coute un site': 'prix',
    'COMBIEN ÇA COÛTE ???': 'prix',
    'kombien coute une appli': 'prix',
    'mot de pass oublier': 'mot-de-passe',
    'jai perdu mon mdp': 'mot-de-passe',
    'forgot pasword': 'mot-de-passe',
    'c koi equipe eclair': 'equipe-eclair',
    'Équipe Éclair': 'equipe-eclair',
    'what is a flash team': 'equipe-eclair',
    'cé gratuit ?': 'gratuit',
    'is it free': 'gratuit',
    'coment sinscrire': 'inscription',
    'suprimer mon conte': 'supprimer-compte',
    'how to delete my acount': 'supprimer-compte',
    'ya til des arnaqueurs': 'arnaques',
    'scamer': 'arnaques',
    'comment installer lappli': 'installer',
    'instal the app': 'installer',
    'je veux un site pour ma boutique': 'publier-demande',
    'je veux recruter un programmeur': 'trouver-dev',
    'changer de langue english': 'langue',
    'contacter lequipe': 'contact',
    'badge lien verifier': 'lien-verifie',
    'trouver du travaille': 'trouver-travail',
    'signaler une insulte': 'signaler',
    'validation en 2 etapes': 'securite',
    'defi de la semène': 'defi',
  };
  for (const [question, attendu] of Object.entries(cas)) assert.equal(trouve(question), attendu, question);
});

test('question hors sujet : « pas compris », plutôt qu\'une réponse au hasard', () => {
  for (const question of ['quel temps fait-il à Bobo', 'qui a gagné le match hier', 'recette du riz gras', 'bonjour', 'merci beaucoup', 'comment vas-tu ?', '???', '', '   ', 'azertyuiop', 'what is the capital of Ghana', '12345']) {
    assert.equal(trouve(question), null, `« ${question} »`);
  }
  // Un texte qui n'en est pas un ne fait rien planter.
  for (const valeur of [null, undefined, 42, {}]) assert.equal(moteur.chercher(valeur, index), null);
});

test('un visiteur ne reçoit jamais un lien réservé aux membres ; deux boutons au plus par réponse', () => {
  const RESERVES = /^\/(parametres|projets|demandes|modifier-profil|amis|defis|fil|messages|notifications|admin)/;
  for (const id of ids) {
    const boutons = moteur.boutonsPour(id, 'visiteur');
    assert.ok(boutons.length <= 2, id);
    for (const bouton of boutons) assert.ok(bouton.contact || !RESERVES.test(bouton.href), `${id} : ${bouton.href}`);
    for (const profil of ['dev', 'client']) {
      const pourMembre = moteur.boutonsPour(id, profil);
      assert.ok(pourMembre.length <= 2, `${id} ${profil}`);
      // Un membre connecté ne reçoit pas de bouton « Créer un compte » ou « Me connecter ».
      for (const bouton of pourMembre) assert.ok(!/^\/(inscription|connexion|mot-de-passe-oublie)/.test(bouton.href || ''), `${id} ${profil} : ${bouton.href}`);
    }
  }
  // Quelques cas précis.
  const liens = (id, profil) => moteur.boutonsPour(id, profil).map((b) => b.href || 'contact');
  assert.deepEqual(liens('supprimer-compte', 'visiteur'), ['/connexion']);
  assert.deepEqual(liens('supprimer-compte', 'dev'), ['/parametres#compte']);
  assert.deepEqual(liens('langue', 'visiteur'), ['/']);
  assert.deepEqual(liens('langue', 'client'), ['/parametres#langue']);
  assert.deepEqual(liens('publier-demande', 'client'), ['/demandes?publier=1', '/demandes']);
  assert.deepEqual(liens('publier-demande', 'visiteur'), ['/inscription?type=client']);
  assert.deepEqual(liens('mot-de-passe', 'visiteur'), ['/mot-de-passe-oublie']);
  assert.deepEqual(liens('prix', 'dev'), ['/calculateur'], 'un dev ne publie pas de demande');
  assert.deepEqual(liens('contact', 'visiteur'), ['contact', '/regles']);
  assert.deepEqual(moteur.boutonsPour('sujet-inconnu', 'dev'), []);
});

test('suggestions : adaptées à la personne et à la page, six au plus, sans doublon', () => {
  for (const profil of ['visiteur', 'dev', 'client']) {
    for (const page of [...Object.keys(moteur.PAR_PAGE), 'page-inconnue']) {
      const suggestions = moteur.suggestionsPour(profil, page);
      assert.ok(suggestions.length >= 4 && suggestions.length <= 6, `${profil} ${page} : ${suggestions.length}`);
      assert.equal(new Set(suggestions).size, suggestions.length, `${profil} ${page}`);
      for (const id of suggestions) assert.ok(moteur.SUJETS.find((s) => s.id === id).pour.includes(profil), `${profil} ${page} : ${id}`);
    }
  }
  // La page décide de ce qui vient d'abord.
  assert.equal(moteur.suggestionsPour('visiteur', 'connexion')[0], 'mot-de-passe');
  assert.equal(moteur.suggestionsPour('client', 'calculateur')[0], 'prix');
  assert.equal(moteur.suggestionsPour('dev', 'parametres')[0], 'langue');
  // Un visiteur ne se voit pas proposer « Supprimer mon compte » ; un client pas « Lien vérifié ».
  assert.ok(!moteur.suggestionsPour('visiteur', 'regles').includes('supprimer-compte'));
  assert.ok(!moteur.suggestionsPour('client', 'profil').includes('lien-verifie'));
});

test('les réponses ne donnent que des valeurs que le site applique vraiment', () => {
  const lire = (fichier) => fs.readFileSync(path.join(racine, fichier), 'utf8');
  const fr = (id) => dictionnaires.fr[`assistant.sujet.${id}.reponse`];
  const en = (id) => dictionnaires.en[`assistant.sujet.${id}.reponse`];
  // 30 jours avant la suppression définitive d'un compte.
  assert.equal(require('../src/utils/purge').DELAI_SUPPRESSION_JOURS, 30);
  assert.match(fr('supprimer-compte'), /30 jours/);
  assert.match(en('supprimer-compte'), /30 days/);
  // Le lien « mot de passe oublié » vaut une heure.
  assert.match(lire('src/routes/auth.js'), /const DUREE_JETON_MIN = 60;/);
  assert.match(fr('mot-de-passe'), /une heure/);
  assert.match(en('mot-de-passe'), /one hour/);
  // 18 ans pour les développeurs ; un code à 6 chiffres.
  assert.match(lire('src/utils/profil-dev.js'), /18/);
  assert.match(fr('inscription'), /18 ans/);
  assert.match(fr('inscription'), /6 chiffres/);
  assert.match(en('inscription'), /6-digit/);
  // Trois signalements cachent un contenu.
  assert.equal(require('../src/utils/sanctions').SEUIL_SIGNALEMENTS, 3);
  assert.match(fr('signaler'), /trois membres/);
  // Aucun prix n'est écrit dans une réponse : ils viennent de la grille du calculateur, qui peut changer.
  for (const langue of ['fr', 'en']) {
    for (const id of ids) assert.ok(!/\d[\d\s.,]*\s?(FCFA|F CFA|francs|€|\$)/i.test(dictionnaires[langue][`assistant.sujet.${id}.reponse`]), `${langue} ${id}`);
  }
});

test('rien n\'est envoyé au serveur : aucune route, et le script n\'appelle pas l\'API', () => {
  const lire = (fichier) => fs.readFileSync(path.join(racine, fichier), 'utf8');
  const fenetre = lire('public/js/assistant.js');
  const recherche = lire('public/js/assistant-recherche.js');
  assert.ok(!/\bapi\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|document\.cookie/.test(fenetre + recherche));
  // Le seul fetch lit la page publique /regles, pour y trouver l'adresse de contact : la question n'y figure pas.
  assert.deepEqual(fenetre.match(/fetch\([^)]*\)/g), ["fetch('/regles', { credentials: 'same-origin' })"]);
  assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(fenetre + recherche), 'jamais innerHTML');
  assert.ok(!fs.existsSync(path.join(racine, 'src', 'routes', 'assistant.js')));
  assert.ok(!/assistant|griot/i.test(lire('src/app.js') + lire('src/db/schema.sql')), 'ni route ni table');
  // Chargé seulement au premier toucher : aucune page ne cite ces fichiers.
  for (const page of fs.readdirSync(path.join(racine, 'public')).filter((f) => f.endsWith('.html'))) assert.ok(!/assistant/.test(lire(`public/${page}`)), page);
  // Mais le service worker les garde, pour que l'aide s'ouvre aussi hors connexion.
  const sw = lire('public/sw.js');
  for (const fichier of ['/css/assistant.css', '/js/assistant-recherche.js', '/js/assistant.js']) assert.ok(sw.includes(`'${fichier}'`), fichier);
});
