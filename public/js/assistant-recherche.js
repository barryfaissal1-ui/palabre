// Le Griot de Palabre : la liste des sujets et le moteur de recherche.
// Aucune intelligence artificielle, aucune requête au serveur : la question est comparée, dans le navigateur, aux
// mots-clés de chaque sujet. Ce fichier ne touche pas à la page : il se teste seul (tests/assistant.test.js),
// comme calcul-prix.js.
//
// POUR AJOUTER UNE QUESTION : une ligne dans SUJETS ci-dessous, puis ses trois textes dans public/langues/fr.js ET
// en.js : « assistant.sujet.<id>.question » (la suggestion à toucher), « .mots » (les mots-clés, séparés par des
// virgules) et « .reponse » (2 ou 3 phrases). Rien d'autre : la fenêtre, la recherche et les tests suivent.
(function (racine) {
  // Les boutons qu'une réponse peut proposer. « pour » : qui le voit (un visiteur ne reçoit jamais un lien réservé
  // aux membres). Le texte est la clé « assistant.bouton.<id> ».
  const TOUS = ['visiteur', 'dev', 'client'];
  const MEMBRES = ['dev', 'client'];
  const BOUTONS = {
    inscription: { href: '/inscription', pour: ['visiteur'] },
    'inscription-dev': { href: '/inscription?type=dev', pour: ['visiteur'] },
    'inscription-client': { href: '/inscription?type=client', pour: ['visiteur'] },
    connexion: { href: '/connexion', pour: ['visiteur'] },
    'mot-de-passe-oublie': { href: '/mot-de-passe-oublie', pour: ['visiteur'] },
    'a-propos': { href: '/a-propos', pour: TOUS },
    calculateur: { href: '/calculateur', pour: TOUS },
    regles: { href: '/regles', pour: TOUS },
    accueil: { href: '/', pour: ['visiteur'] },
    'publier-demande': { href: '/demandes?publier=1', pour: ['client'] },
    demandes: { href: '/demandes', pour: MEMBRES },
    projets: { href: '/projets', pour: ['dev'] },
    'modifier-profil': { href: '/modifier-profil', pour: MEMBRES },
    chercher: { href: '/chercher', pour: TOUS },
    defis: { href: '/defis', pour: MEMBRES },
    amis: { href: '/amis', pour: MEMBRES },
    fil: { href: '/fil', pour: MEMBRES },
    notifications: { href: '/notifications', pour: MEMBRES },
    messages: { href: '/messages', pour: MEMBRES },
    'parametres-compte': { href: '/parametres#compte', pour: MEMBRES },
    'parametres-langue': { href: '/parametres#langue', pour: MEMBRES },
    'parametres-securite': { href: '/parametres#securite', pour: MEMBRES },
    contact: { contact: true, pour: TOUS }, // l'adresse de l'équipe (CONTACT_MODERATION), posée par le serveur
  };

  // Les sujets. « pour » : à qui la suggestion est proposée (la recherche, elle, trouve tous les sujets).
  // « boutons » : dans l'ordre de préférence ; seuls ceux que la personne a le droit de voir sont gardés, deux au plus.
  // « faible » : ce sujet ne répond que si aucun autre n'a de point (le mot « palabre » est dans beaucoup de questions,
  // et « bonjour » commence souvent une vraie question).
  // « autre » : selon la personne, la question mène à un autre sujet.
  const SUJETS = [
    { id: 'palabre', pour: TOUS, boutons: ['inscription', 'a-propos'], faible: true },
    { id: 'salutations', pour: [], boutons: [], faible: true },
    { id: 'gratuit', pour: ['visiteur'], boutons: ['inscription', 'a-propos'] },
    { id: 'inscription', pour: ['visiteur'], boutons: ['inscription', 'connexion'] },
    { id: 'publier-demande', pour: ['visiteur', 'client'], boutons: ['publier-demande', 'inscription-client', 'demandes'] },
    { id: 'prix', pour: TOUS, boutons: ['calculateur', 'publier-demande'] },
    { id: 'paiement', pour: TOUS, boutons: ['regles'] },
    { id: 'equipe-eclair', pour: TOUS, boutons: ['demandes', 'amis', 'inscription-dev'] },
    { id: 'lien-verifie', pour: ['visiteur', 'dev'], boutons: ['projets', 'inscription-dev'] },
    // Un client n'a pas de projets sur son profil : « publier mon projet » veut dire, pour lui, publier une demande.
    { id: 'projet-profil', pour: ['dev'], boutons: ['projets', 'inscription-dev', 'inscription-client'], autre: { client: 'publier-demande' } },
    { id: 'trouver-travail', pour: ['visiteur', 'dev'], boutons: ['demandes', 'projets', 'inscription-dev'] },
    { id: 'trouver-dev', pour: ['visiteur', 'client'], boutons: ['chercher', 'publier-demande'] },
    { id: 'arnaques', pour: TOUS, boutons: ['regles'] },
    { id: 'signaler', pour: MEMBRES, boutons: ['regles'] },
    { id: 'poser-question', pour: MEMBRES, boutons: ['fil', 'inscription'] },
    { id: 'publication-invisible', pour: MEMBRES, boutons: ['notifications', 'regles'] },
    { id: 'amis-messages', pour: MEMBRES, boutons: ['amis', 'messages', 'inscription'] },
    { id: 'appels', pour: MEMBRES, boutons: ['messages', 'inscription'] },
    { id: 'mot-de-passe', pour: TOUS, boutons: ['mot-de-passe-oublie', 'parametres-compte'] },
    { id: 'langue', pour: TOUS, boutons: ['parametres-langue', 'accueil'] },
    { id: 'securite', pour: MEMBRES, boutons: ['parametres-securite'] },
    { id: 'supprimer-compte', pour: MEMBRES, boutons: ['parametres-compte', 'connexion'] },
    { id: 'defi', pour: MEMBRES, boutons: ['defis', 'inscription-dev'] },
    { id: 'age', pour: ['visiteur'], boutons: ['inscription-dev'] },
    { id: 'pays', pour: ['visiteur'], boutons: ['inscription', 'a-propos'] },
    { id: 'installer', pour: TOUS, boutons: [] },
    { id: 'connexion-lente', pour: TOUS, boutons: [] },
    { id: 'contact', pour: TOUS, boutons: ['contact', 'regles'] },
  ];

  // Les suggestions montrées d'abord, selon la page. Complétées ensuite par les autres sujets de la personne.
  const PAR_PAGE = {
    accueil: ['palabre', 'gratuit', 'publier-demande', 'trouver-travail', 'prix', 'arnaques'],
    connexion: ['mot-de-passe', 'inscription', 'gratuit', 'langue', 'contact'],
    inscription: ['inscription', 'gratuit', 'palabre', 'age', 'pays', 'arnaques'],
    calculateur: ['prix', 'publier-demande', 'trouver-dev', 'paiement', 'arnaques'],
    regles: ['arnaques', 'paiement', 'signaler', 'contact', 'supprimer-compte'],
    'a-propos': ['palabre', 'gratuit', 'equipe-eclair', 'lien-verifie', 'pays', 'contact'],
    fil: ['poser-question', 'equipe-eclair', 'lien-verifie', 'trouver-travail', 'publication-invisible', 'amis-messages'],
    demandes: ['publier-demande', 'equipe-eclair', 'trouver-travail', 'prix', 'paiement', 'arnaques'],
    demande: ['equipe-eclair', 'arnaques', 'paiement', 'prix', 'trouver-travail', 'signaler'],
    profil: ['lien-verifie', 'projet-profil', 'trouver-travail', 'trouver-dev', 'amis-messages', 'signaler'],
    parametres: ['langue', 'mot-de-passe', 'securite', 'supprimer-compte', 'contact'],
  };
  const NB_SUGGESTIONS = 6;

  // ---------- Nettoyer une question ----------
  // Minuscules, accents retirés, ponctuation remplacée par des espaces : « Équipe-éclair ? » → « equipe eclair ».
  function normaliser(texte) {
    return String(texte || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }
  // Les mots d'une question, prêts à être comparés. Deux listes viennent des fichiers de langue :
  // - index.abreviations remet d'aplomb ce que les gens écrivent (« c koi » devient « cest quoi », « mdp » « motdepasse ») ;
  // - index.vides sont les MOTS-OUTILS (« comment », « mon », « je », « le », « faire », « avoir », « the »…) : ils ne
  //   disent rien du sujet, ils sont retirés. Une question faite seulement de mots-outils ne trouve donc jamais rien.
  // Un article collé au mot (« lequipe », « sinscrire », « dargent ») est détaché quand le mot entier n'est pas connu
  // et que le reste est un mot-clé.
  function motsDe(texte, index) {
    const remis = (mot) => (index.abreviations.has(mot) ? index.abreviations.get(mot) : mot);
    return normaliser(texte).split(' ').map(remis).map((mot) => {
      if (!index.vocabulaire || mot.length < 5 || !/^[ldjnmtsc]/.test(mot) || index.vides.has(mot)) return mot;
      const reste = remis(mot.slice(1));
      if (!index.vocabulaire.has(reste)) return mot;
      for (const connu of index.vocabulaire) if (proximite(mot, connu)) return mot;
      return reste;
    }).filter((mot) => mot && !index.vides.has(mot));
  }

  // Distance entre deux mots : le nombre de lettres à changer, ajouter ou retirer pour passer de l'un à l'autre.
  function distance(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 3;
    let avant = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i += 1) {
      const ligne = [i];
      for (let j = 1; j <= b.length; j += 1) ligne[j] = Math.min(avant[j] + 1, ligne[j - 1] + 1, avant[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      avant = ligne;
    }
    return avant[b.length];
  }

  // Le mot écrit vaut-il le mot-clé ? 2 points : le même mot. 1 point : un mot proche, c'est-à-dire
  // - le même début, à quelques lettres près (« oublier » pour « oublie », « pass » pour « passe », « instal » pour
  //   « installer ») ; mais pas « cherche » pour « cher » : trop de lettres en plus pour un mot si court ;
  // - ou la même première lettre et une faute de frappe (« suprimer », « pasword »). La première lettre doit être la
  //   bonne : sans cela « publie » passait pour « oublie », et « publier mon projet » parlait de mot de passe.
  // 0 : rien à voir.
  function proximite(ecrit, cle) {
    if (ecrit === cle) return 2;
    const court = Math.min(ecrit.length, cle.length);
    const ecart = Math.abs(ecrit.length - cle.length);
    if (court >= 4 && (ecrit.startsWith(cle) || cle.startsWith(ecrit)) && (ecart <= 2 || (court >= 6 && ecart <= 4))) return 1;
    if (ecrit[0] !== cle[0]) return 0;
    return court >= 5 && distance(ecrit, cle) <= 1 ? 1 : 0;
  }
  const ressemble = (ecrit, cle) => proximite(ecrit, cle) > 0;

  // ---------- Préparer les sujets ----------
  // dictionnaires : { fr: {…}, en: {…} } (public/langues). Les mots-clés des DEUX langues valent toujours : un
  // membre dont le site est en français peut très bien écrire sa question en anglais.
  // Un mot-clé peut être une expression (« mot de passe ») : tous ses mots doivent alors être dans la question.
  // Renvoie l'index : { sujets: [{ id, faible, autre, cles }], vides, abreviations, vocabulaire }.
  function indexer(dictionnaires) {
    const index = { sujets: [], vides: new Set(), abreviations: new Map(), vocabulaire: null };
    const langues = Object.keys(dictionnaires);
    const texte = (langue, cle) => (dictionnaires[langue] || {})[cle] || '';
    for (const langue of langues) {
      normaliser(texte(langue, 'assistant.mots-vides')).split(' ').filter(Boolean).forEach((mot) => index.vides.add(mot));
      // « koi=quoi, stp=, mdp=motdepasse » : à gauche ce que les gens écrivent, à droite ce qu'on compare (ou rien).
      texte(langue, 'assistant.abreviations').split(',').map((paire) => paire.split('=')).forEach(([ecrit, voulu = '']) => {
        if (normaliser(ecrit)) index.abreviations.set(normaliser(ecrit), normaliser(voulu));
      });
    }
    index.sujets = SUJETS.map((sujet) => {
      const cles = [];
      for (const langue of langues) {
        texte(langue, `assistant.sujet.${sujet.id}.mots`).split(',').map((expression) => motsDe(expression, index)).filter((mots) => mots.length).forEach((mots) => cles.push(mots));
      }
      return { id: sujet.id, faible: Boolean(sujet.faible), autre: sujet.autre || null, cles };
    });
    // Tous les mots des mots-clés : sert à détacher un article collé (« lequipe »).
    index.vocabulaire = new Set(index.sujets.flatMap((sujet) => sujet.cles.flat()));
    return index;
  }

  // ---------- Chercher ----------
  // Les points d'un sujet pour une question (ses mots, déjà nettoyés).
  // Chaque mot de la question retrouvé dans un mot-clé compte une fois : 2 points s'il est écrit pareil, 1 s'il est
  // seulement proche. Une expression retrouvée d'un seul tenant (« mot de passe », « sans internet ») ajoute 2 points :
  // elle est plus précise qu'un mot seul.
  function pointsDe(sujet, ecrits) {
    const valeurs = new Map(); // place du mot dans la question → ses points
    const expressions = new Set(); // place où commence une expression retrouvée
    for (const cle of sujet.cles) {
      const places = cle.map((mot) => {
        let place = -1;
        let record = 0;
        ecrits.forEach((ecrit, i) => { const p = proximite(ecrit, mot); if (p > record) { record = p; place = i; } });
        return { place, points: record };
      });
      if (places.some((p) => p.place < 0)) continue;
      for (const p of places) valeurs.set(p.place, Math.max(valeurs.get(p.place) || 0, p.points));
      if (cle.length > 1 && places.every((p, i) => i === 0 || p.place === places[i - 1].place + 1)) expressions.add(places[0].place);
    }
    let points = 2 * expressions.size;
    for (const valeur of valeurs.values()) points += valeur;
    return points;
  }

  // Combien de fois le premier sujet doit dépasser le deuxième pour qu'on ose répondre.
  const ECART = 1.5;

  // Renvoie l'identifiant du sujet qui répond à la question, ou null. Une mauvaise réponse est pire que « je n'ai pas
  // compris » : le Griot ne répond que si un sujet se détache nettement.
  // - Aucun mot retrouvé : null.
  // - Le premier sujet n'a pas au moins une fois et demie les points du deuxième (ECART) : null, on ne devine pas.
  // - Un sujet « faible » (présentation de Palabre, salutations) ne répond que si aucun autre sujet n'a de point.
  // profil (facultatif) : 'visiteur', 'dev' ou 'client'. Certains sujets renvoient à un autre selon la personne
  // (« publier mon projet » : un projet sur le profil pour un dev, une demande pour un client).
  function chercher(question, index, profil = null) {
    const ecrits = motsDe(question, index);
    if (ecrits.length === 0) return null;
    const classes = index.sujets.map((sujet) => ({ sujet, points: pointsDe(sujet, ecrits) })).filter((c) => c.points > 0);
    const tri = (liste) => liste.sort((a, b) => b.points - a.points);
    const nets = tri(classes.filter((c) => !c.sujet.faible));
    let gagnant = null;
    if (nets.length) {
      if (nets.length > 1 && nets[0].points < ECART * nets[1].points) return null;
      gagnant = nets[0].sujet;
    } else {
      const faibles = tri(classes);
      if (faibles.length) gagnant = faibles[0].sujet;
    }
    if (!gagnant) return null;
    return (gagnant.autre && gagnant.autre[profil]) || gagnant.id;
  }

  // ---------- Ce que la fenêtre montre ----------
  // profil : 'visiteur', 'dev' ou 'client'. page : 'accueil', 'fil', 'parametres'…
  // Les suggestions : celles de la page d'abord, puis les autres sujets de cette personne, six au plus.
  function suggestionsPour(profil, page) {
    const permis = SUJETS.filter((sujet) => sujet.pour.includes(profil)).map((sujet) => sujet.id);
    const ordre = [...(PAR_PAGE[page] || []), ...permis];
    return [...new Set(ordre)].filter((id) => permis.includes(id)).slice(0, NB_SUGGESTIONS);
  }
  // Les boutons d'une réponse pour cette personne : deux au plus, jamais un lien qu'elle ne peut pas ouvrir.
  function boutonsPour(id, profil) {
    const sujet = SUJETS.find((s) => s.id === id);
    if (!sujet) return [];
    return sujet.boutons.filter((bouton) => BOUTONS[bouton].pour.includes(profil)).slice(0, 2).map((bouton) => ({ id: bouton, ...BOUTONS[bouton] }));
  }

  const api = { SUJETS, BOUTONS, PAR_PAGE, ECART, normaliser, motsDe, ressemble, proximite, indexer, chercher, suggestionsPour, boutonsPour };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else racine.PalabreAssistant = api;
})(typeof window !== 'undefined' ? window : globalThis);
