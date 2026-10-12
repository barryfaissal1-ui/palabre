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
  for (const question of ['quel temps fait-il à Bobo', 'qui a gagné le match hier', 'recette du riz gras', 'quel temps fait il a bobo', 'comment vas-tu ?', '???', '', '   ', 'azertyuiop', 'what is the capital of Ghana', '12345']) {
    assert.equal(trouve(question), null, `« ${question} »`);
  }
  // Un texte qui n'en est pas un ne fait rien planter.
  for (const valeur of [null, undefined, 42, {}]) assert.equal(moteur.chercher(valeur, index), null);
});

test('questions réalistes : le bon sujet, jamais un sujet voisin', () => {
  const cas = {
    // Les réponses fausses relevées par l'équipe.
    'comment je publie mon projet': 'projet-profil',
    'je cherche du travail': 'trouver-travail',
    'comment avoir des clients': 'trouver-travail',
    'comment devenir dev sur palabre': 'inscription',
    'je veux parler a quelqu un de lequipe': 'contact',
    'combien pour faire une application mobile': 'prix',
    'je veux un site pour ma boutique': 'prix',
    'le site marche sans internet ?': 'connexion-lente',
    // Les sujets ajoutés.
    'on paye comment': 'paiement',
    'comment etre payé': 'paiement',
    'bonjour': 'salutations',
    'bonsoir': 'salutations',
    'salut': 'salutations',
    'merci': 'salutations',
    'merci beaucoup': 'salutations',
    'quel âge': 'age',
    'je suis mineur': 'age',
    'comment ajouter un ami': 'amis-messages',
    'ecrire a quelqu\'un': 'amis-messages',
    'jai recu une demande de message dun inconnu': 'amis-messages',
    'comment faire un appel video': 'appels',
    'appel audio dans un groupe': 'appels',
    'c\'est pour quel pays': 'pays',
    'ajouter un projet a mon profil': 'projet-profil',
    'ca marche en 3g ?': 'connexion-lente',
    // La base de savoir et les publications en attente.
    'comment poser une question': 'poser-question',
    'comment marquer la meilleure reponse': 'poser-question',
    'ma publication n\'est pas visible': 'publication-invisible',
    'pourquoi ma publication est cachee': 'publication-invisible',
    'mon commentaire est en attente': 'publication-invisible',
    'how do i ask a question': 'poser-question',
    'my post is not visible': 'publication-invisible',
    // Un bonjour devant une vraie question ne change pas la réponse.
    'bonjour, c\'est gratuit ?': 'gratuit',
    'slt cmt creer un compte svp': 'inscription',
    // Des voisins qui ne doivent pas se mélanger.
    'je suis client': 'publier-demande',
    'faut il payer avant': 'arnaques',
    'faut il payer pour s\'inscrire': 'gratuit',
    'signaler un message': 'signaler',
    'inviter des amis dans une equipe eclair': 'equipe-eclair',
    'jai besoin daide': 'contact',
    'combien coute mon projet': 'prix',
    'comment ca marche': 'palabre',
    // En anglais.
    'how do i publish my project': 'projet-profil',
    'i am looking for work': 'trouver-travail',
    'how do i get clients': 'trouver-travail',
    'how do i become a developer on palabre': 'inscription',
    'i want to talk to someone from the team': 'contact',
    'how much for a mobile app': 'prix',
    'does it work without internet': 'connexion-lente',
    'how do i get paid': 'paiement',
    'hello': 'salutations',
    'thanks': 'salutations',
    'how old do i have to be': 'age',
    'how do i add a friend': 'amis-messages',
    'can i make a video call': 'appels',
    'which country is it for': 'pays',
  };
  for (const [question, attendu] of Object.entries(cas)) assert.equal(trouve(question), attendu, question);
});

test('« publier mon projet » : un projet du profil pour un dev, une demande pour un client', () => {
  const pour = (profil) => moteur.chercher('comment je publie mon projet', index, profil);
  assert.equal(pour('dev'), 'projet-profil');
  assert.equal(pour('client'), 'publier-demande');
  assert.equal(pour('visiteur'), 'projet-profil');
  assert.deepEqual(moteur.boutonsPour('projet-profil', 'dev').map((b) => b.href), ['/projets']);
  // Les autres sujets ne changent pas selon la personne.
  for (const profil of ['visiteur', 'dev', 'client']) assert.equal(moteur.chercher('mot de passe oublié', index, profil), 'mot-de-passe');
});

test('des mots-outils seuls ne donnent jamais un sujet', () => {
  for (const question of ['comment je fais', 'c\'est quoi ça', 'comment', 'mon', 'je veux faire', 'pourquoi pas', 'est-ce que je peux', 'c koi', 'comment on fait pour avoir', 'le la les un une', 'how do i', 'what is it', 'can you', 'where is my']) {
    assert.equal(trouve(question), null, `« ${question} »`);
  }
  // Chaque mot-outil des deux listes, seul, ne trouve rien.
  for (const mot of index.vides) assert.equal(trouve(mot), null, mot);
  // Et aucun mot-clé n'est fait seulement de mots-outils : il serait vide, donc jamais retrouvé.
  for (const langue of ['fr', 'en']) {
    for (const id of ids) {
      for (const expression of dictionnaires[langue][`assistant.sujet.${id}.mots`].split(',')) assert.ok(moteur.motsDe(expression, index).length > 0, `${langue} ${id} : « ${expression.trim()} »`);
    }
  }
});

test('sans écart net entre deux sujets, « pas compris » plutôt que deviner', () => {
  // Deux sujets à égalité.
  assert.equal(trouve('langue et securite'), null);
  assert.equal(trouve('badge ou defi'), null);
  // Le mot « équipe » seul ne mène nulle part, surtout pas aux équipes éclair.
  assert.equal(trouve('equipe'), null);
  assert.equal(trouve('c\'est quoi une equipe'), null);
  // Une faute sur la première lettre n'est pas une faute de frappe : « publie » n'est pas « oublie ».
  assert.equal(moteur.proximite('publie', 'oublie'), 0);
  assert.equal(moteur.proximite('cherche', 'cher'), 0);
  assert.equal(moteur.proximite('suprimer', 'supprimer'), 1);
  assert.equal(moteur.proximite('prix', 'prix'), 2);
  // Un mot-clé d'un seul mot n'appartient qu'à un sujet : sinon les deux seraient toujours à égalité.
  const vus = new Map();
  for (const sujet of index.sujets.filter((s) => !s.faible)) {
    for (const cle of sujet.cles.filter((c) => c.length === 1)) {
      assert.ok(!vus.has(cle[0]) || vus.get(cle[0]) === sujet.id, `« ${cle[0]} » : ${vus.get(cle[0])} et ${sujet.id}`);
      vus.set(cle[0], sujet.id);
    }
  }
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
  assert.equal(require('../src/utils/profil-dev').AGE_MINIMUM, 18);
  assert.match(fr('age'), /18 ans/);
  assert.match(en('age'), /18 or older/);
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
