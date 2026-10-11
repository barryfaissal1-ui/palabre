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
    'parametres-compte': { href: '/parametres#compte', pour: MEMBRES },
    'parametres-langue': { href: '/parametres#langue', pour: MEMBRES },
    'parametres-securite': { href: '/parametres#securite', pour: MEMBRES },
    contact: { contact: true, pour: TOUS }, // l'adresse de l'équipe (CONTACT_MODERATION), posée par le serveur
  };

  // Les sujets. « pour » : à qui la suggestion est proposée (la recherche, elle, trouve tous les sujets).
  // « boutons » : dans l'ordre de préférence ; seuls ceux que la personne a le droit de voir sont gardés, deux au plus.
  const SUJETS = [
    // « faible » : le mot « palabre » est dans beaucoup de questions (« installer Palabre »). À égalité de points,
    // ce sujet laisse donc passer les autres.
    { id: 'palabre', pour: TOUS, boutons: ['inscription', 'a-propos'], faible: true },
    { id: 'gratuit', pour: ['visiteur'], boutons: ['inscription', 'a-propos'] },
    { id: 'inscription', pour: ['visiteur'], boutons: ['inscription', 'connexion'] },
    { id: 'publier-demande', pour: ['visiteur', 'client'], boutons: ['publier-demande', 'inscription-client', 'demandes'] },
    { id: 'prix', pour: TOUS, boutons: ['calculateur', 'publier-demande'] },
    { id: 'equipe-eclair', pour: TOUS, boutons: ['demandes', 'amis', 'inscription-dev'] },
    { id: 'lien-verifie', pour: ['visiteur', 'dev'], boutons: ['projets', 'inscription-dev'] },
    { id: 'trouver-travail', pour: ['visiteur', 'dev'], boutons: ['demandes', 'projets', 'inscription-dev'] },
    { id: 'trouver-dev', pour: ['visiteur', 'client'], boutons: ['chercher', 'publier-demande'] },
    { id: 'arnaques', pour: TOUS, boutons: ['regles'] },
    { id: 'signaler', pour: MEMBRES, boutons: ['regles'] },
    { id: 'mot-de-passe', pour: TOUS, boutons: ['mot-de-passe-oublie', 'parametres-compte'] },
    { id: 'langue', pour: TOUS, boutons: ['parametres-langue', 'accueil'] },
    { id: 'securite', pour: MEMBRES, boutons: ['parametres-securite'] },
    { id: 'supprimer-compte', pour: MEMBRES, boutons: ['parametres-compte', 'connexion'] },
    { id: 'defi', pour: MEMBRES, boutons: ['defis', 'inscription-dev'] },
    { id: 'installer', pour: TOUS, boutons: [] },
    { id: 'contact', pour: TOUS, boutons: ['contact', 'regles'] },
  ];

  // Les suggestions montrées d'abord, selon la page. Complétées ensuite par les autres sujets de la personne.
  const PAR_PAGE = {
    accueil: ['palabre', 'gratuit', 'publier-demande', 'trouver-travail', 'prix', 'arnaques'],
    connexion: ['mot-de-passe', 'inscription', 'gratuit', 'langue', 'contact'],
    inscription: ['inscription', 'gratuit', 'palabre', 'arnaques', 'langue'],
    calculateur: ['prix', 'publier-demande', 'trouver-dev', 'arnaques'],
    regles: ['arnaques', 'signaler', 'contact', 'supprimer-compte'],
    'a-propos': ['palabre', 'gratuit', 'equipe-eclair', 'lien-verifie', 'contact'],
    fil: ['equipe-eclair', 'lien-verifie', 'trouver-travail', 'publier-demande', 'defi', 'signaler'],
    demandes: ['publier-demande', 'equipe-eclair', 'trouver-travail', 'prix', 'arnaques'],
    demande: ['equipe-eclair', 'arnaques', 'prix', 'trouver-travail', 'signaler'],
    profil: ['lien-verifie', 'trouver-travail', 'trouver-dev', 'signaler', 'arnaques'],
    parametres: ['langue', 'mot-de-passe', 'securite', 'supprimer-compte', 'contact'],
  };
  const NB_SUGGESTIONS = 6;

  // ---------- Nettoyer une question ----------
  // Minuscules, accents retirés, ponctuation remplacée par des espaces : « Équipe-éclair ? » → « equipe eclair ».
  function normaliser(texte) {
    return String(texte || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }
  // Les mots d'une question, prêts à être comparés. Deux listes viennent des fichiers de langue (index.vides,
  // index.abreviations) : les petits mots qui ne disent rien du sujet (« le », « de », « the ») sont retirés, et les
  // abréviations courantes sont remises d'aplomb (« c koi » devient « cest quoi », « mdp » devient « motdepasse »).
  function motsDe(texte, index) {
    return normaliser(texte).split(' ')
      .map((mot) => (index.abreviations.has(mot) ? index.abreviations.get(mot) : mot))
      .filter((mot) => mot && !index.vides.has(mot));
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

  // Le mot écrit ressemble-t-il au mot-clé ? Pareil, ou même début (« oublier » pour « oublie », « pass » pour
  // « passe »), ou à une lettre près pour un mot de 5 lettres et plus (« coute » pour « cout », « equipe » mal tapé).
  function ressemble(ecrit, cle) {
    if (ecrit === cle) return true;
    const court = Math.min(ecrit.length, cle.length);
    if (court >= 4 && (ecrit.startsWith(cle) || cle.startsWith(ecrit))) return true;
    if (court >= 5 && distance(ecrit, cle) <= 1) return true;
    return court >= 8 && distance(ecrit, cle) <= 2;
  }

  // ---------- Préparer les sujets ----------
  // dictionnaires : { fr: {…}, en: {…} } (public/langues). Les mots-clés des DEUX langues valent toujours : un
  // membre dont le site est en français peut très bien écrire sa question en anglais.
  // Un mot-clé peut être une expression (« mot de passe ») : tous ses mots doivent alors être dans la question.
  // Renvoie l'index : { sujets: [{ id, cles }], vides, abreviations }.
  function indexer(dictionnaires) {
    const index = { sujets: [], vides: new Set(), abreviations: new Map() };
    const langues = Object.keys(dictionnaires);
    const texte = (langue, cle) => (dictionnaires[langue] || {})[cle] || '';
    for (const langue of langues) {
      normaliser(texte(langue, 'assistant.mots-vides')).split(' ').filter(Boolean).forEach((mot) => index.vides.add(mot));
      // « koi=quoi, stp=, mdp=motdepasse » : à gauche ce que les gens écrivent, à droite ce qu'on compare (ou rien).
      texte(langue, 'assistant.abreviations').split(',').map((paire) => paire.split('=')).forEach(([ecrit, voulu = '']) => {
        if (normaliser(ecrit)) index.abreviations.set(normaliser(ecrit), normaliser(voulu));
      });
    }
    index.sujets = [...SUJETS.filter((sujet) => !sujet.faible), ...SUJETS.filter((sujet) => sujet.faible)].map((sujet) => {
      const cles = [];
      for (const langue of langues) {
        texte(langue, `assistant.sujet.${sujet.id}.mots`).split(',').map((expression) => motsDe(expression, index)).filter((mots) => mots.length).forEach((mots) => cles.push(mots));
      }
      return { id: sujet.id, cles };
    });
    return index;
  }

  // ---------- Chercher ----------
  // Renvoie l'identifiant du sujet qui répond le mieux à la question, ou null si rien ne correspond.
  // Chaque mot-clé retrouvé compte un point par mot (une expression de trois mots vaut donc trois points, et un point
  // de plus parce qu'elle est précise). Le sujet qui a le plus de points gagne ; à égalité, le premier de la liste.
  function chercher(question, index) {
    const ecrits = motsDe(question, index);
    if (ecrits.length === 0) return null;
    let meilleur = null;
    let record = 0;
    for (const sujet of index.sujets) {
      let points = 0;
      const comptes = new Set(); // un même mot de la question ne compte qu'une fois par sujet
      for (const cle of sujet.cles) {
        const trouves = cle.map((mot) => ecrits.find((ecrit) => ressemble(ecrit, mot)));
        if (trouves.some((ecrit) => !ecrit)) continue;
        const nouveaux = trouves.filter((ecrit) => !comptes.has(ecrit));
        if (nouveaux.length === 0) continue;
        nouveaux.forEach((ecrit) => comptes.add(ecrit));
        points += nouveaux.length + (cle.length > 1 ? 1 : 0);
      }
      if (points > record) { record = points; meilleur = sujet.id; }
    }
    return meilleur;
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

  const api = { SUJETS, BOUTONS, PAR_PAGE, normaliser, motsDe, ressemble, indexer, chercher, suggestionsPour, boutonsPour };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else racine.PalabreAssistant = api;
})(typeof window !== 'undefined' ? window : globalThis);
