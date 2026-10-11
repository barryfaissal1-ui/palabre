// Outils communs à toutes les pages : appels à l'API, session, navigation, installation PWA.
(function () {
  // ---------- Langue : français ou anglais ----------
  // Les textes sont dans public/langues/fr.js et en.js (chargés avant ce fichier). Tout texte de l'interface passe
  // par t('cle') dans un script, ou par un attribut data-t="cle" dans une page HTML.
  // Le choix est gardé dans un cookie « langue » (le serveur le lit pour ses messages, ses emails, ses notifications)
  // et, pour un membre, dans son compte. Première visite : voir languePremiereVisite(), juste en dessous.
  const LANGUES = window.PalabreLangues || {};
  function langueDuCookie() {
    const trouve = /(?:^|; )langue=(fr|en)(?:;|$)/.exec(document.cookie);
    return trouve ? trouve[1] : null;
  }
  function garderLangue(valeur) {
    document.cookie = `langue=${valeur}; path=/; max-age=${365 * 24 * 60 * 60}; samesite=lax`;
  }
  // Première visite, sans cookie. Beaucoup de téléphones vendus en Afrique francophone sont réglés en anglais : la
  // langue du navigateur ne suffit donc pas. Anglais seulement si le navigateur est en anglais ET que le fuseau
  // horaire de l'appareil est celui d'un pays africain anglophone, ou d'un pays hors d'Afrique. Sinon : français.
  // (Un choix fait dans /parametres ou par le lien du bas de page pose le cookie : il passe toujours avant.)
  const FUSEAUX_ANGLOPHONES = [
    'Africa/Lagos', 'Africa/Accra', 'Africa/Nairobi', 'Africa/Johannesburg', 'Africa/Kampala', 'Africa/Dar_es_Salaam', 'Africa/Kigali',
    'Africa/Lusaka', 'Africa/Harare', 'Africa/Gaborone', 'Africa/Windhoek', 'Africa/Monrovia', 'Africa/Freetown',
    'Africa/Banjul', 'Africa/Blantyre', 'Africa/Maseru', 'Africa/Mbabane', 'Africa/Juba', 'Africa/Khartoum',
  ];
  // Îles africaines francophones dont le fuseau ne commence pas par « Africa/ » (Madagascar, Comores, Mayotte, La Réunion).
  const FUSEAUX_FRANCOPHONES_DES_ILES = ['Indian/Antananarivo', 'Indian/Comoro', 'Indian/Mayotte', 'Indian/Reunion'];
  function languePremiereVisite(langueNavigateur, fuseau) {
    if (!/^en/i.test(langueNavigateur || '')) return 'fr';
    if (!fuseau) return 'fr'; // fuseau inconnu (très vieux navigateur) : la langue par défaut
    if (FUSEAUX_FRANCOPHONES_DES_ILES.includes(fuseau)) return 'fr';
    if (!fuseau.startsWith('Africa/')) return 'en';
    return FUSEAUX_ANGLOPHONES.includes(fuseau) ? 'en' : 'fr';
  }
  function fuseauDeLAppareil() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; }
  }
  const langue = langueDuCookie() || languePremiereVisite(navigator.language, fuseauDeLAppareil());
  if (!langueDuCookie()) garderLangue(langue);
  // Sans cookie, le serveur a choisi d'après l'en-tête Accept-Language seulement (il ne connaît pas le fuseau) : il a
  // pu envoyer la page en anglais alors qu'on vient de choisir le français. Dans ce cas on la réécrit en français.
  const pageServieEn = document.documentElement.lang === 'en';
  // Dates et nombres : « 3 oct. 2026 » et « 250 000 » en français, « 3 Oct 2026 » et « 250,000 » en anglais.
  const REGION = langue === 'en' ? 'en-GB' : 'fr-FR';
  const pluriel = new Intl.PluralRules(langue);

  // t('fil.reponses', { n: 3 }) → « 3 réponses ». Un texte peut être un pluriel { un, autres }, choisi d'après {n}
  // (en français 0 et 1 sont au singulier ; en anglais, 1 seulement). Une clé inconnue s'affiche telle quelle :
  // on la repère tout de suite à l'écran, et un test vérifie qu'aucune ne manque.
  function t(cle, variables = {}) {
    let texte = (LANGUES[langue] || {})[cle];
    if (texte === undefined) texte = (LANGUES.fr || {})[cle];
    if (texte === undefined) return cle;
    if (typeof texte === 'object') texte = pluriel.select(Number(variables.n)) === 'one' ? texte.un : texte.autres;
    return texte.replace(/\{(\w+)\}/g, (tout, nom) => (variables[nom] === undefined ? tout : String(variables[nom])));
  }
  const nombre = (valeur) => new Intl.NumberFormat(REGION).format(valeur);

  // Remplit les textes d'une page HTML : data-t (texte), data-t-placeholder, data-t-aria-label, data-t-title,
  // data-t-alt, data-t-content. En français il n'y a rien à faire : la page est déjà écrite en français.
  const ATTRIBUTS_TRADUITS = ['placeholder', 'aria-label', 'title', 'alt', 'content'];
  function traduirePage(racine = document) {
    document.documentElement.lang = langue;
    if (langue === 'fr' && !pageServieEn) return;
    // Le titre de l'onglet : la clé « titre.<nom de la page> » (titre.connexion pour /connexion, titre.accueil pour /).
    // Les pages dont le titre dépend du contenu (profil, projet, publication) l'écrivent elles-mêmes.
    if (racine === document) {
      const cleTitre = `titre.${window.location.pathname.split('/')[1] || 'accueil'}`;
      if ((LANGUES.fr || {})[cleTitre]) document.title = t(cleTitre);
    }
    racine.querySelectorAll('[data-t]').forEach((element) => { element.textContent = t(element.dataset.t); });
    ATTRIBUTS_TRADUITS.forEach((attribut) => {
      racine.querySelectorAll(`[data-t-${attribut}]`).forEach((element) => element.setAttribute(attribut, t(element.getAttribute(`data-t-${attribut}`))));
    });
  }
  // Ce fichier est chargé avec « defer » : la page est déjà lue en entier, on peut la traduire avant qu'elle s'affiche.
  traduirePage();

  // Changer de langue : le cookie, le compte du membre (s'il est connecté), puis la page est relue dans la nouvelle
  // langue. On reste sur la même page (même adresse, même rubrique).
  async function changerLangue(nouvelle, { connecte = false } = {}) {
    if (nouvelle !== 'fr' && nouvelle !== 'en') return;
    garderLangue(nouvelle);
    if (connecte) await api('/parametres/langue', { methode: 'PUT', donnees: { langue: nouvelle } }).catch(() => {});
    window.location.reload();
  }

  async function api(chemin, { methode = 'GET', donnees } = {}) {
    const options = { method: methode, headers: {}, credentials: 'same-origin' };
    if (donnees !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(donnees);
    }
    let reponse;
    try {
      reponse = await fetch(`/api${chemin}`, options);
    } catch {
      const erreur = new Error(t('commun.pas-de-connexion'));
      erreur.statut = 0;
      throw erreur;
    }
    const corps = await reponse.json().catch(() => ({}));
    if (!reponse.ok) {
      const erreur = new Error(corps.erreur || t('commun.erreur'));
      erreur.statut = reponse.status;
      erreur.champ = corps.champ;
      erreur.suite = corps.suite; // page où régler le problème (/bienvenue, /confirmer-email)
      // Email pas encore confirmé : le serveur refuse tout, on ramène la personne à la page du code.
      if (corps.suite === '/confirmer-email' && window.location.pathname !== '/confirmer-email') window.location.replace('/confirmer-email');
      // Compte désactivé : une seule page lui répond, celle où il peut le réactiver.
      if (corps.suite === '/bon-retour' && window.location.pathname !== '/bon-retour') window.location.replace('/bon-retour');
      throw erreur;
    }
    return corps;
  }

  // Le membre connecté est demandé une seule fois par page, puis gardé en mémoire.
  let promesseUtilisateur = null;
  function utilisateurConnecte() {
    if (!promesseUtilisateur) {
      promesseUtilisateur = api('/auth/moi').then((r) => r.utilisateur).catch(() => null);
    }
    return promesseUtilisateur;
  }

  // Crée un élément HTML sans jamais interpréter de texte comme du code :
  // le contenu écrit par les membres passe toujours par textContent (protection contre les injections).
  function el(balise, attributs = {}, enfants = []) {
    const noeud = document.createElement(balise);
    Object.entries(attributs).forEach(([cle, valeur]) => {
      if (valeur === null || valeur === undefined || valeur === false) return;
      if (cle === 'texte') noeud.textContent = valeur;
      else if (cle === 'classe') noeud.className = valeur;
      else noeud.setAttribute(cle, valeur === true ? '' : valeur);
    });
    [].concat(enfants).forEach((enfant) => {
      if (enfant !== null && enfant !== undefined) noeud.append(enfant);
    });
    return noeud;
  }

  // ---------- Icônes et illustrations ----------
  // Les icônes (Lucide) sont rangées dans un seul fichier, /icons/icones.svg : le navigateur le télécharge
  // une fois, puis chaque icône n'est qu'une référence. Une balise SVG se crée avec createElementNS.
  const SVG = 'http://www.w3.org/2000/svg';
  function dessin(fichier, nom, classe) {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('class', classe);
    svg.setAttribute('aria-hidden', 'true'); // décoratif : le texte ou l'aria-label voisin dit déjà l'essentiel
    svg.setAttribute('focusable', 'false');
    const use = document.createElementNS(SVG, 'use');
    use.setAttribute('href', `/icons/${fichier}.svg#${nom}`);
    svg.append(use);
    return svg;
  }
  const icone = (nom, classe = '') => dessin('icones', nom, `icone ${classe}`.trim());
  const illustration = (nom) => dessin('illustrations', nom, 'illustration');

  // État vide : une petite illustration, un titre encourageant, un texte, et éventuellement un bouton.
  function etatVide(nomIllustration, titre, texte, action = null) {
    return el('div', { classe: 'vide' }, [
      illustration(nomIllustration),
      el('p', { classe: 'vide-titre', texte: titre }),
      texte ? el('p', { texte }) : null,
      action,
    ]);
  }

  // Squelettes : des formes grises animées à la place du contenu pendant qu'il charge.
  // Affiche « nombre » squelettes dans la zone et renvoie la fonction qui les retire.
  function chargement(zone, nombre = 3) {
    const squelettes = Array.from({ length: nombre }, () => el('div', { classe: 'squelette', 'aria-hidden': 'true' }, [
      el('div', { classe: 'squelette-entete' }, [el('span', { classe: 'os os-rond' }), el('span', { classe: 'os os-court' })]),
      el('span', { classe: 'os' }),
      el('span', { classe: 'os os-moyen' }),
    ]));
    zone.setAttribute('aria-busy', 'true');
    zone.append(...squelettes);
    return () => {
      squelettes.forEach((s) => s.remove());
      zone.removeAttribute('aria-busy');
    };
  }

  // ---------- Défilement infini ----------
  // Charge la page suivante d'une liste TOUTE SEULE quand on approche de la fin, sans bouton « Voir plus ».
  //   const infini = chargementInfini(liste, chargerSuite, { fin: t('commun.tout-vu'), bouton });
  //   infini.reprendre(resteIlDesPages);   // après le premier chargement, ou après un changement de filtre
  // chargerSuite() ajoute la page suivante à la liste et répond true s'il en reste encore ; en cas de panne, elle
  // lève une erreur. La page garde donc sa requête ; tout le reste (guetter, squelettes, fin, erreur) est ici.
  //
  // Comment : un repère invisible est posé sous la liste. Un IntersectionObserver prévient quand ce repère arrive à
  // moins de 800 px du bas de l'écran. C'est le navigateur qui surveille : rien ne tourne pendant le défilement.
  // « bouton » : le « Voir plus » de la page, montré seulement si le navigateur ne connaît pas IntersectionObserver.
  function chargementInfini(liste, chargerSuite, { fin = t('commun.tout-vu'), bouton = null } = {}) {
    const pied = el('div', { classe: 'pied-infini' });               // squelettes, phrase de fin ou « Réessayer »
    const repere = el('div', { classe: 'repere-infini', 'aria-hidden': 'true' });
    liste.after(pied, repere);
    const guetteur = 'IntersectionObserver' in window
      ? new IntersectionObserver((entrees) => { if (entrees.some((e) => e.isIntersecting)) suite(); }, { rootMargin: '0px 0px 800px 0px' })
      : null;
    let reste = false;    // y a-t-il une page suivante ?
    let enCours = false;  // un seul chargement à la fois
    let tour = 0;         // augmente à chaque reprise : la réponse d'un ancien filtre est ignorée
    if (bouton) {
      bouton.hidden = true;
      bouton.addEventListener('click', suite);
    }

    // (Re)commence à guetter. Cesser puis reprendre l'observation fait redemander l'état du repère : si la page
    // chargée était courte et que le repère est toujours en vue, la suivante part aussitôt.
    function guetter() {
      if (!guetteur) {
        if (bouton) bouton.hidden = !reste;
        return;
      }
      guetteur.unobserve(repere);
      if (reste) guetteur.observe(repere);
    }

    function finir() {
      reste = false;
      guetter(); // plus rien à charger : on arrête d'observer
      // La phrase de fin n'a de sens qu'au bout d'une vraie liste, pas sous deux ou trois éléments.
      pied.replaceChildren(...(liste.children.length > 3 ? [el('p', { classe: 'fin-liste texte-discret', texte: fin })] : []));
    }

    async function suite() {
      if (enCours || !reste) return;
      enCours = true;
      const monTour = tour;
      if (bouton) bouton.hidden = true;
      pied.replaceChildren();
      const fini = chargement(pied, 2);
      try {
        const encore = await chargerSuite();
        fini();
        if (monTour !== tour) return; // la liste a été reprise entre-temps (autre filtre)
        enCours = false;
        if (encore) guetter();
        else finir();
      } catch (erreur) {
        fini();
        if (monTour !== tour) return;
        enCours = false;
        // Panne : on arrête de guetter (sinon le défilement relancerait l'appel en boucle) et on laisse la main.
        if (guetteur) guetteur.unobserve(repere);
        const reessayer = el('button', { classe: 'bouton bouton-contour', type: 'button' }, [icone('recharger'), t('commun.reessayer')]);
        reessayer.addEventListener('click', suite);
        pied.replaceChildren(el('div', { classe: 'erreur-infini', role: 'alert' }, [el('p', { classe: 'texte-discret', texte: erreur.message }), reessayer]));
      }
    }

    function reprendre(encore) {
      tour += 1;
      enCours = false;
      reste = Boolean(encore);
      pied.replaceChildren();
      if (reste) guetter();
      else finir();
    }
    return { reprendre };
  }

  // ---------- Petits messages (« toasts ») et fenêtre de confirmation ----------
  // Ils remplacent alert() et confirm() du navigateur, qui bloquent la page et ne suivent pas le style du site.
  function toast(texte, type = 'succes') {
    let zone = document.querySelector('.toasts');
    if (!zone) {
      zone = el('div', { classe: 'toasts', role: 'status', 'aria-live': 'polite' });
      document.body.append(zone);
    }
    const message = el('div', { classe: `toast toast-${type}` }, [icone(type === 'erreur' ? 'alerte' : 'valide'), el('span', { texte })]);
    zone.append(message);
    // Une erreur reste plus longtemps à l'écran qu'une simple confirmation.
    setTimeout(() => {
      message.classList.add('toast-sortie');
      setTimeout(() => message.remove(), 300);
    }, type === 'erreur' ? 6000 : 3500);
  }

  // Pose une question et renvoie une promesse : true si la personne confirme, false sinon (Annuler ou Échap).
  //   if (await confirmer('Supprimer cette publication ?', { bouton: 'Supprimer', danger: true })) { … }
  // La première phrase (jusqu'au « ? ») devient le titre, la suite l'explication.
  function confirmer(question, { bouton = t('commun.confirmer'), danger = false } = {}) {
    const coupe = question.indexOf('?') + 1;
    // espace insécable avant « ? » : le point d'interrogation ne se retrouve jamais seul à la ligne
    const titre = (coupe > 0 ? question.slice(0, coupe) : question).replace(/ \?/g, ' ?');
    const suite = coupe > 0 ? question.slice(coupe).trim() : '';
    return new Promise((resolve) => {
      const annuler = el('button', { classe: 'bouton bouton-lien', type: 'button', texte: t('commun.annuler') });
      const valider = el('button', { classe: `bouton ${danger ? 'bouton-danger' : 'bouton-principal'}`, type: 'button', 'data-confirmer': true, texte: bouton });
      const dialogue = el('dialog', {
        classe: 'dialogue dialogue-confirmation', role: 'alertdialog',
        'aria-labelledby': 'confirmation-titre', 'aria-describedby': suite ? 'confirmation-texte' : null,
      }, [
        el('h2', { id: 'confirmation-titre', texte: titre }),
        suite ? el('p', { id: 'confirmation-texte', texte: suite }) : null,
        el('div', { classe: 'dialogue-actions' }, [annuler, valider]),
      ]);
      let reponse = false;
      annuler.addEventListener('click', () => dialogue.close());
      valider.addEventListener('click', () => { reponse = true; dialogue.close(); });
      dialogue.addEventListener('close', () => { dialogue.remove(); resolve(reponse); });
      document.body.append(dialogue);
      dialogue.showModal(); // le focus va sur « Annuler » : la touche Entrée ne confirme pas par accident
    });
  }

  function initiales(nom) {
    return nom.split(/\s+/).filter(Boolean).slice(0, 2).map((m) => m[0].toUpperCase()).join('');
  }

  // ---------- Avatars, anneau de preuve et badge feuille ----------
  // Sans photo, l'avatar montre les initiales sur une des 6 teintes du logo (classes .teinte-0 à .teinte-5 du CSS).
  // La teinte est calculée à partir de l'identifiant : la même personne garde toujours la même couleur.
  function teinteAvatar(identifiant = '') {
    let somme = 0;
    for (const lettre of identifiant) somme = (somme * 31 + lettre.charCodeAt(0)) % 997;
    return somme % 6;
  }

  // L'anneau de preuve, signature de Palabre : un segment vert par projet au lien vérifié.
  // De 1 à 8 projets, autant d'arcs séparés par un petit espace ; au-delà de 8, l'anneau est plein.
  // Dessiné en SVG dans un carré de 100 : il suit donc toutes les tailles d'avatar.
  const MAX_SEGMENTS = 8;
  function anneauPreuve(nombre) {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('class', 'anneau');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const RAYON = 46;
    if (nombre > MAX_SEGMENTS) {
      const cercle = document.createElementNS(SVG, 'circle');
      cercle.setAttribute('cx', '50');
      cercle.setAttribute('cy', '50');
      cercle.setAttribute('r', String(RAYON));
      svg.append(cercle);
      return svg;
    }
    const ESPACE = 14; // degrés laissés vides entre deux segments
    const part = 360 / nombre;
    // Un point du cercle à l'angle donné (0° en haut, sens des aiguilles d'une montre).
    const point = (angle) => {
      const radians = (angle * Math.PI) / 180;
      return `${(50 + RAYON * Math.sin(radians)).toFixed(2)} ${(50 - RAYON * Math.cos(radians)).toFixed(2)}`;
    };
    for (let i = 0; i < nombre; i += 1) {
      const debut = i * part + ESPACE / 2;
      const fin = (i + 1) * part - ESPACE / 2;
      const arc = document.createElementNS(SVG, 'path');
      arc.setAttribute('d', `M ${point(debut)} A ${RAYON} ${RAYON} 0 ${fin - debut > 180 ? 1 : 0} 1 ${point(fin)}`);
      svg.append(arc);
    }
    return svg;
  }

  // L'avatar d'un membre, le même partout : sa photo (ou ses initiales) et, s'il a des projets vérifiés, son anneau.
  // Tailles : 'mini' (32 px), 'moyen' (44), 'rangee' (64), 'grand' (96), 'profil' (112).
  function avatar(personne, taille = 'moyen') {
    const image = personne.avatar
      ? el('img', { classe: 'avatar', src: personne.avatar, alt: '', loading: 'lazy', decoding: 'async' })
      : el('span', { classe: `avatar avatar-initiales teinte-${teinteAvatar(personne.identifiant)}`, 'aria-hidden': 'true', texte: initiales(personne.nom) });
    const prouve = personne.nbProjetsVerifies > 0;
    return el('span', { classe: `avatar-cadre avatar-${taille}${prouve ? ' avec-anneau' : ''}` }, [image, prouve ? anneauPreuve(personne.nbProjetsVerifies) : null]);
  }

  // Badge feuille : à côté du nom de tout dev qui a au moins un projet vérifié.
  function badgeFeuille() {
    return el('span', { classe: 'badge-feuille', role: 'img', 'aria-label': t('commun.profil-prouve'), title: t('commun.profil-prouve') }, [icone('feuille')]);
  }

  // Le nom d'un membre, avec son badge feuille s'il est prouvé. À utiliser partout où un nom s'affiche.
  // « lien: false » quand le nom est déjà dans un lien (un lien ne peut pas en contenir un autre).
  function nomMembre(membre, { lien = true } = {}) {
    // Un compte supprimé : son nom, « Membre parti », est écrit dans la langue de celui qui lit, et ne mène nulle part.
    // Un compte désactivé par son propriétaire : « Membre indisponible », sans lien non plus.
    const parti = /^membre-parti-/.test(membre.identifiant || '') || Boolean(membre.indisponible);
    const texte = membre.indisponible ? t('commun.membre-indisponible') : (parti ? t('commun.membre-parti') : membre.nom);
    const nom = lien && !parti
      ? el('a', { classe: 'nom-auteur', href: `/${membre.identifiant}`, texte })
      : el('span', { classe: 'nom-auteur', texte });
    return el('span', { classe: 'nom-membre' }, [nom, membre.nbProjetsVerifies > 0 ? badgeFeuille() : null]);
  }

  // Le prénom d'un membre : celui qu'il a saisi à l'inscription (envoyé par le serveur avec chaque aperçu de membre).
  // Secours si le prénom manque : le premier mot du nom.
  const prenom = (membre) => membre.prenom || String(membre.nom || '').trim().split(/\s+/)[0];

  // « il y a 5 min », « il y a 3 h », puis la date au-delà d'une semaine.
  function dateRelative(iso) {
    const date = new Date(iso);
    const secondes = Math.round((Date.now() - date.getTime()) / 1000);
    if (secondes < 60) return t('temps.instant');
    // Intl.RelativeTimeFormat écrit la phrase dans la langue : « il y a 5 min », « 5 min. ago ».
    const relatif = new Intl.RelativeTimeFormat(langue, { style: 'short' });
    if (secondes < 3600) return relatif.format(-Math.floor(secondes / 60), 'minute');
    if (secondes < 86400) return relatif.format(-Math.floor(secondes / 3600), 'hour');
    if (secondes < 7 * 86400) return relatif.format(-Math.floor(secondes / 86400), 'day');
    return date.toLocaleDateString(REGION, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // « de Bintou » mais « d'Awa » : l'élision devant une voyelle.
  // Un « y » suivi d'une voyelle se prononce comme une consonne : « de Yao », « de Youssouf », mais « d'Yves ».
  function deNom(nom) {
    return /^([aeiouhàâäéèêëîïôöùûü]|y(?![aeiouàâäéèêëîïôöùûü]))/i.test(nom) ? `d'${nom}` : `de ${nom}`;
  }

  // Montant en francs CFA : 250000 → « 250 000 FCFA ». Sans montant : « À discuter ».
  function fcfa(montant) {
    if (montant === null || montant === undefined) return t('commun.a-discuter');
    return `${nombre(montant)} FCFA`;
  }

  // Note sur 5 en étoiles, lisible aussi par un lecteur d'écran.
  function etoiles(note) {
    const pleines = Math.round(note);
    return el('span', { classe: 'etoiles', role: 'img', 'aria-label': t('commun.note-sur-5', { note: nombre(note) }), texte: '★'.repeat(pleines) + '☆'.repeat(5 - pleines) });
  }

  // Carte d'un projet réalisé : utilisée par la vitrine, les profils et « Mes projets ».
  function carteProjet(projet, { avecDev = true } = {}) {
    const adresse = `/projets/${projet.id}`;
    return el('article', { classe: 'carte-projet' }, [
      projet.image
        ? el('a', { classe: 'projet-visuel', href: adresse, tabindex: '-1', 'aria-hidden': 'true' }, [el('img', { src: projet.image, alt: '', loading: 'lazy' })])
        : null,
      el('div', { classe: 'projet-corps' }, [
        el('p', { classe: 'projet-meta' }, [
          el('span', { classe: 'texte-discret', texte: projet.nomSecteur }),
          projet.lienVerifie ? el('span', { classe: 'badge-verifie' }, [icone('verifie'), t('commun.lien-verifie')]) : null,
        ]),
        el('h3', {}, [el('a', { href: adresse, texte: projet.titre })]),
        avecDev ? el('p', { classe: 'texte-discret projet-auteur' }, [t('commun.par'), nomMembre(projet.dev)]) : null,
      ]),
    ]);
  }

  // Copie un lien dans le presse-papiers ; si le navigateur refuse, on le montre pour qu'il soit copié à la main.
  async function copierLien(url) {
    try {
      await navigator.clipboard.writeText(url);
      toast(t('commun.lien-copie'));
    } catch {
      const champ = el('input', { type: 'text', readonly: true, value: url, 'aria-label': t('commun.lien-a-copier') });
      const fermer = el('button', { classe: 'bouton bouton-principal', type: 'button', texte: t('commun.fermer') });
      const dialogue = el('dialog', { classe: 'dialogue', 'aria-labelledby': 'lien-titre' }, [
        el('h2', { id: 'lien-titre', texte: t('commun.copie-ce-lien') }), champ, el('div', { classe: 'dialogue-actions' }, [fermer]),
      ]);
      fermer.addEventListener('click', () => dialogue.close());
      dialogue.addEventListener('close', () => dialogue.remove());
      document.body.append(dialogue);
      dialogue.showModal();
      champ.select();
    }
  }

  // ---------- Listes de choix (à la place des <select> du navigateur) ----------
  // listeChoix(select) habille un <select> : un bouton au style du site, et à l'ouverture un menu « effet verre »
  // (flottant sur ordinateur, feuille qui monte du bas sur téléphone). Toutes les listes du site y passent,
  // toutes seules, au chargement de la page ; il suffit donc d'écrire un <select> normal dans le HTML.
  //
  // Le <select> RESTE dans la page, caché : c'est toujours lui qui porte la valeur. Le code des formulaires ne
  // change pas (formulaire.elements.pays.value), et si ce script ne se chargeait pas, la liste d'origine marcherait.
  // Une icône devant un choix : <option data-icone="code">.
  const sansAccent = (texte) => texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  // Le nom d'un pays dans la langue du site. La base garde toujours le nom français (« Côte d'Ivoire », « Tchad ») :
  // c'est la valeur envoyée au serveur. Seul l'affichage change : clé « pays.cote-d-ivoire », « pays.tchad ».
  const cleDe = (texte) => sansAccent(String(texte)).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  function nomPays(nom) {
    if (!nom) return nom;
    const cle = `pays.${cleDe(nom)}`;
    const traduit = t(cle);
    return traduit === cle ? nom : traduit; // un pays sans traduction s'affiche tel qu'il est en base
  }
  // « Koudougou, Burkina Faso » : la ville telle qu'elle est écrite, le pays dans la langue du site.
  const lieuDe = (membre) => [membre.ville, nomPays(membre.pays)].filter(Boolean).join(', ');
  const valeurNative = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  let numeroListe = 0;
  const HAUTEUR_MAX_MENU = 420; // au-delà, la liste défile à l'intérieur du menu

  function listeChoix(select) {
    if (!select || select.dataset.listeChoix || select.multiple) return;
    select.dataset.listeChoix = 'oui';
    numeroListe += 1;
    const base = `${select.id || 'liste'}-${numeroListe}`;
    const etiquette = select.labels && select.labels[0];
    const titre = () => (etiquette ? etiquette.textContent.trim() : select.getAttribute('aria-label') || select.title || t('commun.choisir'));

    const valeur = el('span', { classe: 'liste-choix-valeur', id: `${base}-valeur` });
    const bouton = el('button', { classe: 'liste-choix', type: 'button', id: `${base}-bouton`, 'aria-haspopup': 'listbox', 'aria-expanded': 'false' }, [valeur, icone('chevron-bas')]);
    if (etiquette) {
      // Toucher le libellé place le curseur sur le bouton, et un lecteur d'écran lit « Pays, Burkina Faso ».
      if (!etiquette.id) etiquette.id = `${base}-etiquette`;
      etiquette.htmlFor = bouton.id;
      bouton.setAttribute('aria-labelledby', `${etiquette.id} ${valeur.id}`);
    }
    select.classList.add('liste-native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    select.after(bouton);

    // Le bouton suit le <select> : choix affiché, grisé, en erreur.
    function suivre() {
      const option = select.options[select.selectedIndex];
      valeur.textContent = option ? option.textContent : '';
      bouton.classList.toggle('sans-choix', !option || option.value === '');
      bouton.disabled = select.disabled;
      if (select.getAttribute('aria-invalid') === 'true') bouton.setAttribute('aria-invalid', 'true');
      else bouton.removeAttribute('aria-invalid');
      if (!etiquette) bouton.setAttribute('aria-label', `${titre()} : ${valeur.textContent}`);
    }
    // « select.value = 'x' » écrit par une page ne prévient personne : on l'intercepte pour mettre le bouton à jour.
    Object.defineProperty(select, 'value', {
      configurable: true,
      get() { return valeurNative.get.call(select); },
      set(v) { valeurNative.set.call(select, v); suivre(); },
    });
    select.addEventListener('change', suivre);
    select.addEventListener('focus', () => bouton.focus()); // une page qui fait select.focus() (champ en erreur)
    if (select.form) select.form.addEventListener('reset', () => setTimeout(suivre));
    // Des choix ajoutés plus tard (pays, catégories demandés au serveur), ou la liste grisée par la page.
    new MutationObserver(suivre).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'aria-invalid', 'selected'] });
    suivre();

    let fenetre = null;
    function ouvrir() {
      if (fenetre || select.disabled) return;
      const telephone = window.matchMedia('(max-width: 767px)').matches;
      // « Choisir » (valeur vide) n'est pas proposé quand un choix est obligatoire ; ailleurs c'est « Tous les pays ».
      const options = [...select.options].filter((o) => !o.disabled && !(select.required && o.value === ''));
      const avecRecherche = options.length > 12;
      const idListe = `${base}-liste`;
      const lignes = options.map((option, rang) => {
        const ligne = el('li', { classe: 'choix', role: 'option', id: `${base}-choix-${rang}`, 'aria-selected': String(option.selected) }, [
          option.dataset.icone ? icone(option.dataset.icone) : null,
          el('span', { classe: 'choix-texte', texte: option.textContent }),
          el('span', { classe: 'choix-coche' }, [icone('valide')]),
        ]);
        ligne.addEventListener('click', () => choisir(rang));
        ligne.addEventListener('pointermove', () => activer(rang, { defiler: false }));
        return ligne;
      });
      const rien = el('li', { classe: 'choix-rien texte-discret', texte: t('commun.aucun-resultat'), hidden: true });
      const liste = el('ul', { classe: 'choix-liste', role: 'listbox', id: idListe, tabindex: '-1', 'aria-label': titre() }, [...lignes, rien]);
      const recherche = avecRecherche
        ? el('input', { classe: 'choix-recherche', type: 'search', placeholder: t('commun.chercher'), 'aria-label': t('commun.chercher-dans-liste', { titre: titre() }), autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': idListe, 'aria-autocomplete': 'list' })
        : null;
      const entete = el('div', { classe: 'choix-entete' }, [el('span', { classe: 'choix-poignee', 'aria-hidden': 'true' }), el('p', { classe: 'choix-titre', texte: titre() })]);
      // Le clavier reste sur la liste ou sur le champ de recherche ; le choix « actif » est annoncé par aria-activedescendant.
      // Sur téléphone, le focus va TOUJOURS sur la liste : le mettre dans la recherche ouvrirait le clavier de l'écran,
      // qui cacherait la moitié des choix. La recherche reste là pour qui la touche. Sur ordinateur, on tape tout de suite.
      liste.tabIndex = 0;
      const foyer = recherche && !telephone ? recherche : liste;
      const dansRecherche = () => Boolean(recherche) && document.activeElement === recherche;
      // Un <dialog> ouvert avec showModal() passe au-dessus de tout (même d'une autre fenêtre), garde le clavier,
      // se ferme avec Échap et rend le focus : le navigateur fait le travail.
      fenetre = el('dialog', { classe: `choix-fenetre ${telephone ? 'choix-feuille' : 'choix-menu'}` }, [
        el('div', { classe: 'choix-interieur' }, [entete, recherche, liste]),
      ]);

      let actif = -1;
      const visibles = () => lignes.map((l, rang) => (l.hidden ? -1 : rang)).filter((rang) => rang >= 0);
      function activer(rang, { defiler = true } = {}) {
        if (rang === actif || rang < 0) return;
        if (lignes[actif]) lignes[actif].classList.remove('actif');
        actif = rang;
        lignes[actif].classList.add('actif');
        liste.setAttribute('aria-activedescendant', lignes[actif].id);
        if (recherche) recherche.setAttribute('aria-activedescendant', lignes[actif].id);
        if (defiler) lignes[actif].scrollIntoView({ block: 'nearest' });
      }
      function deplacer(pas) {
        const rangs = visibles();
        if (rangs.length === 0) return;
        const position = rangs.indexOf(actif);
        const cible = pas === 'debut' ? 0 : pas === 'fin' ? rangs.length - 1 : Math.min(rangs.length - 1, Math.max(0, position + pas));
        activer(rangs[cible]);
      }
      function choisir(rang) {
        const option = options[rang];
        if (!option) return;
        const change = select.value !== option.value;
        select.value = option.value;
        fermer();
        // Les pages écoutent « change » (filtres, formulaires) : on prévient comme le ferait la liste du navigateur.
        if (change) {
          select.dispatchEvent(new Event('input', { bubbles: true }));
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      function fermer() {
        if (fenetre && fenetre.open) fenetre.close();
      }

      // Recherche par première(s) lettre(s), quand il n'y a pas de champ de recherche : « b », « bu »…
      let saisie = '';
      let minuteur = null;
      function parLettres(lettre) {
        saisie += sansAccent(lettre);
        clearTimeout(minuteur);
        minuteur = setTimeout(() => { saisie = ''; }, 700);
        const rang = visibles().find((r) => sansAccent(options[r].textContent).startsWith(saisie));
        if (rang !== undefined) activer(rang);
      }

      fenetre.addEventListener('keydown', (evenement) => {
        const { key } = evenement;
        if (key === 'ArrowDown' || key === 'ArrowUp') { evenement.preventDefault(); deplacer(key === 'ArrowDown' ? 1 : -1); }
        // Dans le champ de recherche, Début, Fin, Espace et les lettres servent à écrire ; ailleurs, à parcourir la liste.
        else if (key === 'Home' && !dansRecherche()) { evenement.preventDefault(); deplacer('debut'); }
        else if (key === 'End' && !dansRecherche()) { evenement.preventDefault(); deplacer('fin'); }
        else if (key === 'PageDown' || key === 'PageUp') { evenement.preventDefault(); deplacer(key === 'PageDown' ? 6 : -6); }
        else if (key === 'Enter' || (key === ' ' && !dansRecherche())) { evenement.preventDefault(); choisir(actif); }
        else if (key === 'Tab') { evenement.preventDefault(); fermer(); }
        else if (!dansRecherche() && key.length === 1 && !evenement.ctrlKey && !evenement.metaKey && !evenement.altKey) parLettres(key);
      });
      if (recherche) {
        recherche.addEventListener('input', () => {
          const mots = sansAccent(recherche.value.trim());
          lignes.forEach((ligne, rang) => { ligne.hidden = Boolean(mots) && !sansAccent(options[rang].textContent).includes(mots); });
          const rangs = visibles();
          rien.hidden = rangs.length > 0;
          if (lignes[actif]) lignes[actif].classList.remove('actif');
          actif = -1;
          liste.removeAttribute('aria-activedescendant');
          recherche.removeAttribute('aria-activedescendant');
          if (rangs.length) activer(rangs[0]);
        });
      }
      // Toucher le fond (à côté du menu) ferme : le clic arrive alors sur le <dialog> lui-même.
      fenetre.addEventListener('click', (evenement) => { if (evenement.target === fenetre) fermer(); });
      const surDefilement = () => fermer(); // sur ordinateur, le menu est accroché au bouton : si la page bouge, on ferme
      fenetre.addEventListener('close', () => {
        clearTimeout(minuteur);
        window.removeEventListener('resize', surDefilement);
        window.removeEventListener('scroll', surDefilement);
        fenetre.remove();
        fenetre = null;
        bouton.setAttribute('aria-expanded', 'false');
        bouton.focus();
      });

      if (telephone) {
        // Glisser la poignée (ou le titre) vers le bas referme la feuille ; un petit geste la laisse revenir.
        let depart = null;
        entete.addEventListener('pointerdown', (evenement) => { 
          depart = evenement.clientY;
          try { entete.setPointerCapture(evenement.pointerId); } catch { /* sans capture, le geste marche tant que le doigt reste sur l'en-tête */ }
        });
        entete.addEventListener('pointermove', (evenement) => {
          if (depart === null) return;
          fenetre.style.transform = `translateY(${Math.max(0, evenement.clientY - depart)}px)`;
        });
        const lacher = (evenement) => {
          if (depart === null) return;
          const descente = evenement.clientY - depart;
          depart = null;
          fenetre.style.transform = '';
          if (descente > 80) fermer();
        };
        entete.addEventListener('pointerup', lacher);
        entete.addEventListener('pointercancel', lacher);
      }

      document.body.append(fenetre);
      fenetre.showModal();
      bouton.setAttribute('aria-expanded', 'true');
      if (!telephone) {
        // Menu flottant. La fenêtre est dans le « calque du dessus » du navigateur (showModal) : rien ne peut passer
        // devant elle ni la couper, pas même une barre collée en bas de page.
        // Elle s'ouvre sous le bouton si toute la liste y tient ; sinon du côté où il y a le plus de place, donc vers
        // le HAUT quand le bouton est près du bas de l'écran. Trop de choix : la liste défile à l'intérieur.
        const cadre = bouton.getBoundingClientRect();
        const largeur = Math.max(cadre.width, 260);
        const besoin = Math.min(HAUTEUR_MAX_MENU, liste.scrollHeight + (recherche ? 56 : 0) + 4);
        const dessous = window.innerHeight - cadre.bottom - 16;
        const dessus = cadre.top - 16;
        const enBas = dessous >= besoin || dessous >= dessus;
        fenetre.style.width = `${largeur}px`;
        fenetre.style.left = `${Math.max(8, Math.min(cadre.left, window.innerWidth - largeur - 8))}px`;
        fenetre.style.maxHeight = `${Math.max(120, Math.min(besoin, enBas ? dessous : dessus))}px`;
        if (enBas) fenetre.style.top = `${cadre.bottom + 6}px`;
        else fenetre.style.bottom = `${window.innerHeight - cadre.top + 6}px`;
        fenetre.classList.toggle('vers-le-haut', !enBas);
        window.addEventListener('resize', surDefilement);
        window.addEventListener('scroll', surDefilement, { passive: true });
      }
      foyer.focus();
      const choisi = options.findIndex((o) => o.selected);
      activer(choisi >= 0 ? choisi : 0);
      if (lignes[actif]) lignes[actif].scrollIntoView({ block: 'center' });
    }

    bouton.addEventListener('click', ouvrir);
    // Comme une liste du navigateur : les flèches ouvrent aussi (Entrée et Espace « cliquent » déjà le bouton).
    bouton.addEventListener('keydown', (evenement) => {
      if (evenement.key === 'ArrowDown' || evenement.key === 'ArrowUp') {
        evenement.preventDefault();
        ouvrir();
      }
    });
  }

  // Toutes les listes de la page, et celles qu'une page crée plus tard (appeler listeChoix(select) après l'avoir posée).
  document.addEventListener('DOMContentLoaded', () => document.querySelectorAll('select').forEach(listeChoix));

  // ---------- Partager ----------
  // LA fonction de partage du site (publications, projets, profils) : partager({ titre, texte, url }).
  //  - sur un téléphone, le menu de partage de l'appareil (WhatsApp, Facebook, Messenger, SMS…) : navigator.share ;
  //  - ailleurs, une petite fenêtre avec WhatsApp, Facebook, X et « Copier le lien ».
  // Rien n'est envoyé à ces sites tant que la personne n'a pas touché un choix : ce ne sont que des liens.
  async function partager({ titre, texte = '', url }) {
    // « pointer: coarse » : un écran qu'on touche du doigt. Sur ordinateur, le menu du système est pauvre : on préfère la fenêtre.
    if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
      try {
        await navigator.share({ title: titre, text: texte, url });
        return;
      } catch (erreur) {
        if (erreur.name === 'AbortError') return; // la personne a refermé le menu : on ne dit rien
      }
    }
    fenetrePartage({ titre, texte, url });
  }

  function fenetrePartage({ titre, texte, url }) {
    const u = encodeURIComponent(url);
    const phrase = texte || titre;
    const choix = [
      ['whatsapp', 'WhatsApp', `https://wa.me/?text=${encodeURIComponent(`${phrase} ${url}`)}`],
      ['facebook', 'Facebook', `https://www.facebook.com/sharer/sharer.php?u=${u}`],
      ['x-reseau', 'X', `https://twitter.com/intent/tweet?url=${u}&text=${encodeURIComponent(phrase)}`],
    ];
    const copier = el('button', { classe: 'choix-partage', type: 'button' }, [el('span', { classe: 'choix-partage-rond' }, [icone('lien')]), t('commun.copier-le-lien')]);
    const fermer = el('button', { classe: 'bouton-icone', type: 'button', 'aria-label': t('commun.fermer'), title: t('commun.fermer') }, [icone('fermer')]);
    const dialogue = el('dialog', { classe: 'dialogue dialogue-partage', 'aria-labelledby': 'partage-titre' }, [
      el('div', { classe: 'partage-entete' }, [el('h2', { id: 'partage-titre', texte: t('commun.partager') }), fermer]),
      el('div', { classe: 'liste-partage' }, [
        // noopener : le site ouvert n'a aucun accès à la page Palabre ; l'adresse est construite ici, jamais par un membre.
        ...choix.map(([nom, libelle, lien]) => el('a', { classe: 'choix-partage', href: lien, target: '_blank', rel: 'noopener' }, [el('span', { classe: 'choix-partage-rond' }, [icone(nom)]), libelle])),
        copier,
      ]),
    ]);
    copier.addEventListener('click', () => {
      dialogue.close();
      copierLien(url);
    });
    fermer.addEventListener('click', () => dialogue.close());
    // Toucher à côté de la fenêtre la ferme (le clic arrive alors sur le <dialog> lui-même, pas sur son contenu).
    dialogue.addEventListener('click', (evenement) => { if (evenement.target === dialogue) dialogue.close(); });
    dialogue.addEventListener('close', () => dialogue.remove());
    document.body.append(dialogue);
    dialogue.showModal();
  }

  // ---------- Menu « … » (Plus d'options) ----------
  // Un bouton « … » qui ouvre un petit menu : Copier le lien, Signaler, Supprimer…
  // lister() renvoie les choix au moment de l'ouverture : [{ texte, icone, action, danger }] (les valeurs vides sont ignorées).
  // Le menu se ferme avec Échap, en touchant à côté, ou après un choix. Un seul menu est ouvert à la fois.
  let fermerMenuOuvert = null;
  function menuOptions(lister, { cote = 'droite', bouton: boutonChoisi = null } = {}) {
    const bouton = boutonChoisi || el('button', {
      classe: 'bouton-icone', type: 'button', 'aria-label': t('commun.plus-d-options'), title: t('commun.plus-d-options'),
      'aria-haspopup': 'menu', 'aria-expanded': 'false',
    }, [icone('options')]);
    const liste = el('div', { classe: `menu-liste menu-${cote}`, role: 'menu', hidden: true });
    const cadre = el('span', { classe: 'menu-options' }, [bouton, liste]);

    function fermer({ rendreFocus = false } = {}) {
      if (liste.hidden) return;
      liste.hidden = true;
      bouton.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', dehors);
      document.removeEventListener('keydown', clavier);
      if (fermerMenuOuvert === fermer) fermerMenuOuvert = null;
      if (rendreFocus) bouton.focus();
    }
    function dehors(evenement) {
      if (!cadre.contains(evenement.target)) fermer();
    }
    function clavier(evenement) {
      if (evenement.key === 'Escape') {
        evenement.preventDefault();
        fermer({ rendreFocus: true });
      } else if (evenement.key === 'ArrowDown' || evenement.key === 'ArrowUp') {
        // Les flèches passent d'un choix à l'autre, comme dans un menu d'ordinateur.
        evenement.preventDefault();
        const choix = [...liste.children];
        const position = choix.indexOf(document.activeElement) + (evenement.key === 'ArrowDown' ? 1 : -1);
        choix[(position + choix.length) % choix.length].focus();
      }
    }

    bouton.addEventListener('click', () => {
      if (!liste.hidden) {
        fermer();
        return;
      }
      if (fermerMenuOuvert) fermerMenuOuvert();
      liste.replaceChildren(...lister().filter(Boolean).map((choix) => {
        // Un choix qui mène à une page (« Voir mon profil ») est un vrai lien : clic du milieu, « ouvrir dans un onglet ».
        if (choix.href) return el('a', { classe: 'menu-choix', href: choix.href, role: 'menuitem' }, [icone(choix.icone), choix.texte]);
        const ligne = el('button', { classe: `menu-choix${choix.danger ? ' menu-danger' : ''}`, type: 'button', role: 'menuitem' }, [icone(choix.icone), choix.texte]);
        ligne.addEventListener('click', () => {
          fermer({ rendreFocus: true });
          choix.action();
        });
        return ligne;
      }));
      liste.hidden = false;
      bouton.setAttribute('aria-expanded', 'true');
      fermerMenuOuvert = fermer;
      document.addEventListener('pointerdown', dehors);
      document.addEventListener('keydown', clavier);
      liste.firstElementChild.focus();
    });
    return cadre;
  }

  // Réduit une image dans le navigateur avant l'envoi (côté le plus long : 1080 px, JPEG) :
  // une photo de plusieurs Mo devient une centaine de Ko, ce qui économise les données mobiles.
  async function reduireImage(fichier, coteMax = 1080) {
    let bitmap;
    try {
      bitmap = await createImageBitmap(fichier);
    } catch {
      throw new Error(t('commun.image-illisible'));
    }
    const echelle = Math.min(1, coteMax / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * echelle));
    canvas.height = Math.max(1, Math.round(bitmap.height * echelle));
    const contexte = canvas.getContext('2d');
    contexte.fillStyle = '#fff'; // fond blanc pour les images transparentes (le JPEG n'a pas de transparence)
    contexte.fillRect(0, 0, canvas.width, canvas.height);
    contexte.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    // Le serveur accepte 500 Ko : on baisse la qualité tant que l'image est trop lourde.
    for (const qualite of [0.8, 0.6, 0.4]) {
      const dataUrl = canvas.toDataURL('image/jpeg', qualite);
      if (dataUrl.length < 600000) return dataUrl;
    }
    throw new Error(t('commun.image-trop-lourde'));
  }

  // Fenêtre « Signaler » : la même pour une publication, un commentaire ou un profil.
  // La page envoie le code du motif ; le serveur écrit le libellé français que l'équipe lit dans /admin.
  const MOTIFS_SIGNALEMENT = [
    ['arnaque', 'signalement.motif.arnaque'],
    ['insulte', 'signalement.motif.insulte'],
    ['haine', 'signalement.motif.haine'],
    ['sexuel', 'signalement.motif.sexuel'],
    ['violence', 'signalement.motif.violence'],
    ['faux_profil', 'signalement.motif.faux-profil'],
    ['spam', 'signalement.motif.spam'],
    ['autre', 'signalement.motif.autre'],
  ];

  function signaler(cibleType, cible) {
    const motif = el('select', { id: 'signalement-motif' }, MOTIFS_SIGNALEMENT.map(([valeur, cle]) => el('option', { value: valeur, texte: t(cle) })));
    const precision = el('textarea', { id: 'signalement-precision', rows: '3', maxlength: '400', placeholder: t('signalement.precision-aide') });
    const zoneMessage = el('p', { classe: 'message', role: 'status' });
    const annuler = el('button', { classe: 'bouton bouton-lien', type: 'button', texte: t('commun.annuler') });
    const envoyer = el('button', { classe: 'bouton bouton-principal', type: 'submit', texte: t('commun.envoyer') });
    const formulaire = el('form', {}, [
      el('h2', { id: 'signalement-titre', texte: t('signalement.titre') }),
      el('p', { classe: 'texte-discret' }, [t('signalement.explication'), ' ', el('a', { href: '/regles', target: '_blank', rel: 'noopener', texte: t('signalement.voir-regles') })]),
      el('div', { classe: 'champ' }, [el('label', { for: 'signalement-motif', texte: t('signalement.question') }), motif]),
      el('div', { classe: 'champ' }, [el('label', { for: 'signalement-precision', texte: t('signalement.precision') }), precision]),
      zoneMessage,
      el('div', { classe: 'dialogue-actions' }, [annuler, envoyer]),
    ]);
    const dialogue = el('dialog', { classe: 'dialogue', 'aria-labelledby': 'signalement-titre' }, [formulaire]);
    listeChoix(motif); // une liste créée après le chargement de la page : on l'habille à la main

    annuler.addEventListener('click', () => dialogue.close());
    dialogue.addEventListener('close', () => dialogue.remove());
    formulaire.addEventListener('submit', async (evenement) => {
      evenement.preventDefault();
      envoyer.disabled = true;
      const detail = precision.value.trim();
      try {
        const reponse = await api('/signalements', {
          methode: 'POST',
          donnees: { cibleType, cible, categorie: motif.value, motif: detail },
        });
        zoneMessage.textContent = reponse.dejaSignale ? t('signalement.deja') : t('signalement.merci');
        zoneMessage.className = 'message succes';
        motif.disabled = true;
        precision.disabled = true;
        envoyer.hidden = true;
        annuler.textContent = t('commun.fermer');
      } catch (erreur) {
        zoneMessage.textContent = erreur.message;
        zoneMessage.className = 'message erreur';
        envoyer.disabled = false;
      }
    });

    document.body.append(dialogue);
    dialogue.showModal();
  }

  // ---------- Recherche de membres ----------
  // On tape un nom, les résultats arrivent en direct. On attend 300 ms après la dernière frappe avant d'interroger
  // le serveur : une seule requête par mot, pas une par lettre. Sert au panneau plein écran du téléphone (loupe)
  // et à la barre de recherche de l'en-tête sur ordinateur.
  function brancherRecherche(champ, resultats) {
    const avancee = () => el('a', { classe: 'bouton bouton-contour', href: '/chercher' }, [icone('devs'), t('recherche.par-competence')]);
    const conseil = (texte) => resultats.replaceChildren(el('p', { classe: 'texte-discret recherche-conseil', texte }), avancee());
    conseil(t('recherche.deux-lettres'));

    let minuterie = null;
    let numero = 0; // numéro de la dernière recherche : la réponse d'une ancienne frappe est ignorée
    champ.addEventListener('input', () => {
      clearTimeout(minuterie);
      numero += 1;
      const demande = numero;
      const q = champ.value.trim();
      if (q.length < 2) {
        conseil(t('recherche.deux-lettres'));
        return;
      }
      minuterie = setTimeout(async () => {
        try {
          const { devs } = await api(`/devs?q=${encodeURIComponent(q)}`);
          if (demande !== numero) return;
          if (devs.length === 0) {
            resultats.replaceChildren(etatVide('recherche', t('recherche.personne'), t('recherche.personne-aide'), avancee()));
            return;
          }
          resultats.replaceChildren(el('ul', { classe: 'liste-recherche' }, devs.map((membre) => el('li', {}, [
            el('a', { classe: 'resultat-membre', href: `/${membre.identifiant}` }, [
              avatar(membre, 'moyen'),
              el('span', { classe: 'resultat-texte' }, [
                nomMembre(membre, { lien: false }),
                el('span', { classe: 'texte-discret', texte: [membre.type === 'client' ? t('commun.client') : null, lieuDe(membre)].filter(Boolean).join(', ') }),
              ]),
            ]),
          ]))));
        } catch (erreur) {
          if (demande === numero) conseil(erreur.message);
        }
      }, 300);
    });
    return () => clearTimeout(minuterie);
  }

  // Téléphone : la loupe ouvre un panneau plein écran.
  function ouvrirRecherche() {
    const champ = el('input', {
      type: 'search', placeholder: t('recherche.par-nom'), 'aria-label': t('recherche.par-nom'),
      autocomplete: 'off', enterkeyhint: 'search', maxlength: '60',
    });
    const fermer = el('button', { classe: 'bouton-icone', type: 'button', 'aria-label': t('recherche.fermer') }, [icone('fleche-gauche')]);
    const resultats = el('div', { classe: 'recherche-resultats', 'aria-live': 'polite' });
    const panneau = el('dialog', { classe: 'panneau-recherche', 'aria-label': t('recherche.titre') }, [
      el('div', { classe: 'recherche-barre' }, [fermer, champ]),
      resultats,
    ]);
    const arreter = brancherRecherche(champ, resultats);
    fermer.addEventListener('click', () => panneau.close());
    panneau.addEventListener('close', () => {
      arreter();
      panneau.remove();
    });
    document.body.append(panneau);
    panneau.showModal();
    champ.focus();
  }

  // Ordinateur et tablette : une vraie barre de recherche dans l'en-tête, avec les résultats en liste dessous.
  // La liste s'ouvre quand on entre dans le champ et se ferme avec Échap ou quand on en sort.
  function barreRecherche() {
    const champ = el('input', {
      type: 'search', placeholder: t('recherche.membre'), 'aria-label': t('recherche.par-nom'),
      autocomplete: 'off', maxlength: '60', 'data-recherche-entete': true,
    });
    const resultats = el('div', { classe: 'recherche-deroulant', 'aria-live': 'polite', hidden: true });
    const barre = el('div', { classe: 'recherche-entete', role: 'search' }, [icone('recherche'), champ, resultats]);
    brancherRecherche(champ, resultats);
    champ.addEventListener('focus', () => { resultats.hidden = false; });
    barre.addEventListener('focusout', (evenement) => {
      if (!barre.contains(evenement.relatedTarget)) resultats.hidden = true;
    });
    barre.addEventListener('keydown', (evenement) => {
      if (evenement.key !== 'Escape') return;
      resultats.hidden = true;
      champ.blur();
    });
    return barre;
  }

  // La touche « / » place le curseur dans la recherche (sauf si on est déjà en train d'écrire quelque part).
  document.addEventListener('keydown', (evenement) => {
    if (evenement.key !== '/' || evenement.ctrlKey || evenement.metaKey || evenement.altKey) return;
    if (document.activeElement && document.activeElement.matches('input, textarea, select, [contenteditable]')) return;
    const champ = document.querySelector('[data-recherche-entete]');
    if (!champ) return;
    evenement.preventDefault();
    if (champ.offsetParent !== null) champ.focus(); // la barre est visible : ordinateur ou tablette
    else ouvrirRecherche();                         // téléphone : le panneau plein écran
  });

  // ---------- Version ordinateur : les colonnes de gauche et de droite ----------
  // Sur un écran large, la page d'un membre a trois colonnes (voir « Version ordinateur » dans le CSS) :
  // le menu à gauche, la page au centre, un panneau à droite. Sur téléphone, ces colonnes sont cachées par le CSS
  // et leur contenu n'est même pas demandé au serveur.
  const ECRAN_LARGE = window.matchMedia('(min-width: 768px)');

  function colonneGauche(moi) {
    const demandes = moi.demandesAmis || 0;
    const nonLues = moi.notifications || 0;
    const ici = (href) => (window.location.pathname === href || (href === '/messages' && window.location.pathname.startsWith('/messages/')) ? 'page' : null);
    const compteur = (nombre, classe) => (nombre ? el('span', { classe: `compteur ${classe}`, texte: nombre > 99 ? '99+' : String(nombre) }) : null);
    const lien = (href, nomIcone, texte, pastille = null) => el('li', {}, [
      el('a', { classe: 'lien-menu', href, 'aria-current': ici(href) }, [icone(nomIcone), el('span', { texte }), pastille]),
    ]);
    const estDev = moi.type === 'dev';
    return el('aside', { classe: 'colonne-gauche', 'aria-label': t('nav.menu-principal') }, [
      el('div', { classe: 'carte-moi' }, [
        el('a', { classe: 'lien-avatar', href: `/${moi.identifiant}`, 'aria-label': t('nav.mon-profil') }, [avatar(moi, 'moyen')]),
        el('div', {}, [nomMembre(moi), el('a', { classe: 'voir-profil', href: `/${moi.identifiant}`, texte: t('nav.voir-mon-profil') })]),
      ]),
      el('nav', { 'aria-label': t('nav.pages') }, [el('ul', { classe: 'menu-gauche-liens' }, [
        lien('/fil', 'fil', t('nav.fil')),
        lien('/demandes', 'demandes', t('nav.demandes')),
        lien('/chercher', 'devs', t('nav.devs')),
        lien('/amis', 'amis', t('nav.amis'), compteur(demandes, 'compteur-amis')),
        lien('/messages', 'commentaire', t('nav.messages'), el('span', { classe: 'compteur compteur-messages', hidden: true })),
        lien('/notifications', 'cloche', t('nav.notifications'), compteur(nonLues, 'compteur-notifications')),
        estDev ? lien('/projets', 'projet', t('nav.mes-projets')) : null,
        lien('/defis', 'trophee', t('nav.defi')),
        lien('/calculateur', 'calculatrice', t('nav.calculateur')),
        lien('/parametres', 'parametres', t('nav.parametres')),
        moi.estAdmin ? lien('/admin', 'admin', t('nav.administration')) : null,
      ])]),
      estDev
        ? el('a', { classe: 'bouton bouton-principal bouton-plein', href: '/projets' }, [icone('plus'), t('nav.ajouter-projet')])
        : el('a', { classe: 'bouton bouton-principal bouton-plein', href: '/demandes?publier=1' }, [icone('plus'), t('nav.publier-demande')]),
      el('p', { classe: 'pied-menu' }, [
        el('a', { href: '/a-propos', texte: t('nav.a-propos') }), el('a', { href: '/regles', texte: t('nav.regles-court') }), el('a', { href: '/conditions', texte: t('nav.conditions') }),
        el('span', { texte: t('nav.fait-au-burkina') }),
      ]),
    ]);
  }

  // Panneau de droite : les demandes récentes, puis des devs à découvrir.
  function colonneDroite(moi) {
    const zoneDemandes = el('div', { classe: 'liste-cote' });
    const zoneDevs = el('ul', { classe: 'liste-cote' });
    const blocDemandes = el('section', { classe: 'bloc-cote', 'aria-labelledby': 'titre-demandes-recentes' }, [
      el('h2', { id: 'titre-demandes-recentes', texte: moi.type === 'client' ? t('cote.mes-demandes') : t('cote.demandes-recentes') }),
      zoneDemandes,
      el('a', { classe: 'lien-cote', href: '/demandes', texte: t('cote.voir-demandes') }),
    ]);
    const blocDevs = el('section', { classe: 'bloc-cote', 'aria-labelledby': 'titre-devs-decouvrir', hidden: true }, [
      el('h2', { id: 'titre-devs-decouvrir', texte: t('cote.devs-a-decouvrir') }),
      zoneDevs,
      el('a', { classe: 'lien-cote', href: '/chercher', texte: t('cote.chercher-dev') }),
    ]);
    // Encadré « Défi de la semaine » : caché tant qu'on ne sait pas s'il y a un défi.
    const zoneDefi = el('div', { classe: 'liste-cote' });
    const blocDefi = el('section', { classe: 'bloc-cote bloc-defi', 'aria-labelledby': 'titre-defi-cote', hidden: true }, [
      el('h2', { id: 'titre-defi-cote' }, [icone('trophee'), t('nav.defi')]),
      zoneDefi,
      el('a', { classe: 'lien-cote', href: '/defis', texte: t('cote.voir-defi') }),
    ]);
    const colonne = el('aside', { classe: 'colonne-droite', 'aria-label': t('cote.a-decouvrir') }, [blocDefi, blocDemandes, blocDevs]);

    function boutonAjouter(dev) {
      const bouton = el('button', { classe: 'bouton bouton-contour bouton-compact', type: 'button', 'aria-label': t('cote.ajouter-en-ami', { nom: dev.nom }) }, [icone('ami-ajouter'), t('commun.ajouter')]);
      bouton.addEventListener('click', async () => {
        bouton.disabled = true;
        try {
          await api('/amis/demandes', { methode: 'POST', donnees: { identifiant: dev.identifiant } });
          bouton.replaceChildren(icone('horloge'), t('commun.demande-envoyee'));
          bouton.classList.add('envoyee');
          bouton.setAttribute('aria-label', t('cote.demande-ami-envoyee', { nom: dev.nom }));
        } catch (erreur) {
          bouton.disabled = false;
          toast(erreur.message, 'erreur');
        }
      });
      return bouton;
    }

    let charge = false;
    async function charger() {
      if (charge || !ECRAN_LARGE.matches) return; // sur téléphone, le panneau est caché : on ne demande rien au serveur
      charge = true;
      api('/defis/resume').then(({ defi }) => {
        if (!defi) return;
        zoneDefi.replaceChildren(
          el('p', { classe: 'demande-cote-titre', texte: defi.titre }),
          el('p', { classe: 'texte-discret', texte: etatDefi(defi) }),
        );
        blocDefi.hidden = false;
      }).catch(() => { /* l'encadré est un plus */ });
      const finiDemandes = chargement(zoneDemandes, 2);
      api(`/demandes${moi.type === 'client' ? '?miennes=1' : ''}`).then(({ demandes }) => {
        finiDemandes();
        if (demandes.length === 0) {
          zoneDemandes.replaceChildren(el('p', { classe: 'texte-discret', texte: moi.type === 'client' ? t('cote.pas-de-demande-publiee') : t('cote.aucune-demande') }));
          return;
        }
        zoneDemandes.replaceChildren(...demandes.slice(0, 3).map((demande) => {
          const propositions = t('commun.propositions', { n: demande.nbPropositions });
          return el('a', { classe: 'demande-cote', href: `/demande?id=${demande.id}` }, [
            el('span', { classe: 'demande-cote-titre', texte: demande.titre }),
            el('span', { classe: 'texte-discret', texte: moi.type === 'client' ? `${demande.nomCategorie}, ${propositions}` : demande.nomCategorie }),
            el('span', { classe: 'demande-cote-budget', texte: fcfa(demande.budgetFcfa) }),
          ]);
        }));
      }).catch(() => { finiDemandes(); blocDemandes.hidden = true; });

      api('/devs/suggestions').then(({ devs }) => {
        if (devs.length === 0) return;
        zoneDevs.replaceChildren(...devs.map((dev) => el('li', { classe: 'suggestion' }, [
          el('a', { classe: 'lien-avatar', href: `/${dev.identifiant}`, 'aria-label': t('commun.profil-de', { nom: dev.nom, deNom: deNom(dev.nom) }) }, [avatar(dev, 'moyen')]),
          el('div', { classe: 'suggestion-texte' }, [
            nomMembre(dev),
            el('span', { classe: 'texte-discret', texte: dev.raison }),
          ]),
          boutonAjouter(dev),
        ])));
        blocDevs.hidden = false;
      }).catch(() => { /* les suggestions sont un plus */ });
    }
    charger();
    ECRAN_LARGE.addEventListener('change', charger); // fenêtre élargie après coup
    return colonne;
  }

  function poserColonnes(moi) {
    const page = document.querySelector('body > main');
    if (!page) return;
    page.before(colonneGauche(moi));
    // Les pages « larges » (profil, demandes, devs, détail d'une demande) ont leur propre colonne de droite.
    if (!page.classList.contains('page-large')) page.after(colonneDroite(moi));
  }

  // ---------- Défi de la semaine : outils partagés par l'encadré de droite, la carte du fil et la page /defis ----------
  // « 2 jours et 5 heures », « 3 heures », « moins d'une heure » : le temps qui reste avant une date.
  function tempsRestant(iso) {
    const heures = Math.floor((new Date(iso).getTime() - Date.now()) / 3600000);
    if (heures < 1) return t('temps.moins-d-une-heure');
    const jours = Math.floor(heures / 24);
    const reste = heures % 24;
    const morceaux = [];
    if (jours) morceaux.push(t('temps.jours', { n: jours }));
    if (reste) morceaux.push(t('temps.heures', { n: reste }));
    return morceaux.join(t('temps.et'));
  }

  // Une ligne qui dit où en est le défi : « Réponses ouvertes, encore 2 jours et 5 heures ».
  function etatDefi(defi) {
    const reponses = t('commun.reponses', { n: defi.nbReponses });
    if (defi.phase === 'reponses') return t('defi.etat-reponses', { reponses, temps: tempsRestant(defi.finReponsesLe) });
    if (defi.phase === 'vote') return t('defi.etat-vote', { reponses, temps: tempsRestant(defi.finVoteLe) });
    return t('defi.etat-termine', { reponses });
  }

  // Bandeau « Termine ton profil de dev » : sous l'en-tête, tant qu'un dev n'a pas rempli la page /bienvenue.
  // (Pas sur la messagerie, dont la page occupe exactement la hauteur de l'écran.)
  function poserBandeauProfil(moi) {
    const entete = document.querySelector('body > .entete');
    if (moi.profilComplet || !entete || window.location.pathname.startsWith('/messages')) return;
    document.body.classList.add('avec-bandeau');
    entete.after(el('a', { classe: 'bandeau-profil', href: '/bienvenue' }, [
      icone('utilisateur'),
      el('span', { texte: t('bandeau.termine-profil') }),
      el('strong', { texte: t('bandeau.terminer') }),
    ]));
  }

  // Compte suspendu (sanction) : un bandeau dit jusqu'à quand, et mène à la page où lire le motif et contester.
  // Le membre peut tout lire ; c'est le serveur qui refuse ce qu'il essaierait de publier.
  function poserBandeauSuspension(moi) {
    const entete = document.querySelector('body > .entete');
    if (!moi.suspenduJusquA || !entete || document.querySelector('.bandeau-suspension')) return;
    const date = new Date(moi.suspenduJusquA).toLocaleDateString(REGION, { day: 'numeric', month: 'long' });
    document.body.classList.add('avec-bandeau');
    entete.after(el('a', { classe: 'bandeau-profil bandeau-suspension', href: '/sanctions' }, [
      icone('alerte'),
      el('span', { texte: t('bandeau.suspension', { date }) }),
      el('strong', { texte: t('bandeau.suspension-voir') }),
    ]));
  }

  // Bouton soleil / lune : passe du mode clair au mode sombre (voir public/js/theme.js, qui retient le choix).
  function boutonTheme() {
    const theme = window.PalabreTheme;
    if (!theme) return null;
    const bouton = el('button', { classe: 'nav-cloche nav-theme', type: 'button' });
    function dessiner() {
      const sombre = theme.actuel() === 'sombre';
      // L'icône et le nom disent ce que fera le bouton : en mode sombre, il propose le clair.
      bouton.replaceChildren(icone(sombre ? 'soleil' : 'lune'));
      bouton.setAttribute('aria-label', sombre ? t('theme.passer-clair') : t('theme.passer-sombre'));
      bouton.title = sombre ? t('theme.clair') : t('theme.sombre');
    }
    bouton.addEventListener('click', () => {
      theme.basculer();
      dessiner();
    });
    dessiner();
    document.addEventListener('palabre:theme', dessiner); // le choix vient d'être fait dans les paramètres
    return bouton;
  }

  // Se déconnecter : coupe aussi le push sur cet appareil (la personne suivante ne recevra pas mes notifications).
  async function seDeconnecter() {
    if (window.Palabre.push) await window.Palabre.push.couper().catch(() => {});
    await api('/auth/deconnexion', { methode: 'POST', donnees: {} }).catch(() => {});
    window.location.href = '/';
  }

  // Le petit menu de l'avatar, en haut à droite : mon profil, les paramètres, la déconnexion.
  function menuAvatar(moi) {
    const bouton = el('button', { classe: 'nav-profil', type: 'button', 'aria-label': t('nav.mon-compte'), title: t('nav.mon-compte'), 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, [avatar(moi, 'mini')]);
    const menu = menuOptions(() => [
      { texte: t('nav.voir-mon-profil'), icone: 'utilisateur', href: `/${moi.identifiant}` },
      { texte: t('nav.parametres-confidentialite'), icone: 'parametres', href: '/parametres' },
      { texte: t('nav.se-deconnecter'), icone: 'deconnexion', action: seDeconnecter },
    ], { bouton });
    menu.classList.add('menu-avatar');
    return menu;
  }

  // ---------- Messages : l'icône de l'en-tête et sa pastille de non lus ----------
  function lienMessages(nonLus) {
    return el('a', { classe: 'nav-cloche nav-messages', href: '/messages', 'aria-label': t('nav.messages'), title: t('nav.messages') }, [
      icone('commentaire'),
      el('span', { classe: 'compteur compteur-cloche compteur-messages', 'aria-hidden': 'true', hidden: nonLus === 0, texte: nonLus > 99 ? '99+' : String(nonLus) }),
    ]);
  }
  // Met à jour toutes les pastilles de messages (en-tête, menu de gauche). Appelée aussi par la page des messages.
  function majPastilleMessages(nonLus) {
    document.querySelectorAll('.compteur-messages').forEach((pastille) => {
      pastille.textContent = nonLus > 99 ? '99+' : String(nonLus);
      pastille.hidden = nonLus === 0;
    });
    const lien = document.querySelector('.nav-messages');
    if (lien) lien.setAttribute('aria-label', nonLus ? t('nav.messages-non-lus', { n: nonLus }) : t('nav.messages'));
  }
  // Pas de WebSocket : la pastille est redemandée toutes les 60 secondes, seulement quand l'onglet est visible.
  // Onglet caché : plus aucune requête ; de retour au premier plan, on rattrape tout de suite.
  // ---------- Appels ----------
  // Le script des appels (liaison WebRTC, écran d'appel) est lourd : il n'est chargé que si un appel commence.
  let scriptAppels = null;
  function chargerAppels() {
    if (window.Palabre.appels) return Promise.resolve(window.Palabre.appels);
    scriptAppels = scriptAppels || new Promise((pret, echec) => {
      const script = el('script', { src: '/js/appels.js' });
      script.addEventListener('load', () => pret(window.Palabre.appels));
      script.addEventListener('error', () => { scriptAppels = null; echec(new Error(t('appels.indisponibles'))); });
      document.head.append(script);
    });
    return scriptAppels;
  }
  // Un appel sonne pour moi (signalé par le serveur) : on montre l'écran « on t'appelle ».
  function appelEntrant(appel) {
    chargerAppels().then((appels) => appels.recevoir(appel)).catch(() => {});
  }
  // Lancer un appel depuis une conversation : { id, groupe, titre }, 'audio' ou 'video'.
  function appeler(conversation, type) {
    chargerAppels().then((appels) => appels.lancer(conversation, type)).catch((erreur) => toast(erreur.message, 'erreur'));
  }

  // ---------- Le Griot de Palabre : l'aide ----------
  // Un bouton rond « Besoin d'aide ? », en bas à droite, sur les pages où l'on peut se poser des questions. Pas dans
  // la messagerie, ni sur /admin. La fenêtre et la recherche (assistant.js, assistant-recherche.js, assistant.css)
  // ne sont chargées qu'au premier toucher : rien de plus à télécharger à l'ouverture d'une page, même en 3G.
  // Rien n'est envoyé au serveur : la recherche se fait dans le navigateur.
  const PAGES_GRIOT = {
    '/': 'accueil', '/connexion': 'connexion', '/inscription': 'inscription', '/calculateur': 'calculateur', '/regles': 'regles',
    '/a-propos': 'a-propos', '/fil': 'fil', '/demandes': 'demandes', '/demande': 'demande', '/parametres': 'parametres',
  };
  function pageDuGriot() {
    const chemin = window.location.pathname.replace(/\.html$/, '');
    if (PAGES_GRIOT[chemin]) return PAGES_GRIOT[chemin];
    return document.querySelector('[data-profil]') ? 'profil' : null; // la page d'un membre : /awa-ouedraogo
  }
  let fichiersGriot = null;
  function chargerGriot() {
    if (window.Palabre.griot) return Promise.resolve(window.Palabre.griot);
    const charger = (src) => new Promise((pret, echec) => {
      const script = el('script', { src });
      script.addEventListener('load', pret);
      script.addEventListener('error', () => echec(new Error(t('assistant.indisponible'))));
      document.head.append(script);
    });
    fichiersGriot = fichiersGriot || (async () => {
      document.head.append(el('link', { rel: 'stylesheet', href: '/css/assistant.css' }));
      await charger('/js/assistant-recherche.js'); // les sujets et la recherche d'abord : la fenêtre s'en sert
      await charger('/js/assistant.js');
      return window.Palabre.griot;
    })().catch((erreur) => { fichiersGriot = null; throw erreur; });
    return fichiersGriot;
  }
  function poserGriot() {
    const page = pageDuGriot();
    if (!page || document.querySelector('.bouton-griot')) return;
    const bouton = el('button', { classe: 'bouton-griot', type: 'button', 'aria-label': t('assistant.ouvrir'), 'aria-haspopup': 'dialog', title: t('assistant.besoin-aide') }, [icone('feuille')]);
    bouton.addEventListener('click', async () => {
      try {
        const [griot, moi] = await Promise.all([chargerGriot(), utilisateurConnecte().catch(() => null)]);
        // Les suggestions et les boutons des réponses dépendent de la personne : visiteur, développeur ou client.
        griot.ouvrir({ profil: moi ? moi.type : 'visiteur', page, bouton });
      } catch (erreur) {
        toast(erreur.message, 'erreur');
      }
    });
    document.body.append(bouton);
  }
  document.addEventListener('DOMContentLoaded', poserGriot);

  // La veille : toutes les 5 secondes, une petite requête demande « un appel sonne-t-il pour moi ? ».
  // Seulement quand l'onglet est visible : onglet caché ou site fermé, c'est la notification push qui prévient.
  // (Rien pendant un appel : la page interroge déjà le serveur chaque seconde.)
  function veiller() {
    let minuterie = 0;
    const demander = () => {
      if (window.Palabre.appels && window.Palabre.appels.enCours()) return;
      // « apres » : le numéro du dernier message déjà annoncé. Gardé le temps de l'onglet, pour qu'un changement
      // de page ne fasse ni oublier ni répéter un message.
      let apres = null;
      try { apres = sessionStorage.getItem(CLE_VEILLE); } catch { /* stockage refusé : on repart de maintenant */ }
      api(`/messages/veille${apres ? `?apres=${apres}` : ''}`).then(recevoirVeille).catch(() => {});
    };
    const regler = () => {
      clearInterval(minuterie);
      if (document.hidden) return;
      minuterie = setInterval(demander, 5000);
      demander();
    };
    document.addEventListener('visibilitychange', regler);
    regler();
  }
  const CLE_VEILLE = 'palabre-veille';
  function recevoirVeille(reponse) {
    if (reponse.appel) appelEntrant(reponse.appel);
    try { sessionStorage.setItem(CLE_VEILLE, String(reponse.dernier)); } catch { /* voir veiller() */ }
    // Un message arrivé pendant qu'on est ailleurs que dans sa conversation : une petite carte l'annonce.
    const ailleurs = (reponse.messages || []).filter((message) => window.Palabre.conversationOuverte !== message.conversationId);
    if (ailleurs.length === 0) return;
    ailleurs.forEach(toastMessage);
    // Un petit son, une fois pour l'ensemble, si le membre ne l'a pas coupé (réglage « Son des messages » du profil).
    utilisateurConnecte().then((moi) => { if (moi && moi.sonMessages && !document.hidden) sonMessage(); });
    api('/messages/non-lus').then(({ nonLus }) => majPastilleMessages(nonLus)).catch(() => {});
  }

  // Le son d'arrivée d'un message : deux notes douces fabriquées par le navigateur (Web Audio). Aucun fichier son,
  // rien de copié. Si le navigateur refuse de jouer (aucun geste de la personne sur cette page), on se tait.
  let contexteSon = null;
  function sonMessage() {
    try {
      contexteSon = contexteSon || new (window.AudioContext || window.webkitAudioContext)();
      const jouer = () => {
        if (contexteSon.state !== 'running') return;
        [[784, 0, 0.22], [1047, 0.13, 0.32]].forEach(([frequence, quand, duree]) => { // sol puis do, très courts
          const debut = contexteSon.currentTime + quand;
          const oscillateur = contexteSon.createOscillator();
          const volume = contexteSon.createGain();
          oscillateur.type = 'sine';
          oscillateur.frequency.value = frequence;
          volume.gain.setValueAtTime(0, debut);
          volume.gain.linearRampToValueAtTime(0.09, debut + 0.02);
          volume.gain.exponentialRampToValueAtTime(0.0001, debut + duree);
          oscillateur.connect(volume).connect(contexteSon.destination);
          oscillateur.start(debut);
          oscillateur.stop(debut + duree + 0.05);
        });
      };
      contexteSon.resume().then(jouer).catch(() => {});
    } catch { /* pas de son sur ce navigateur : la carte suffit */ }
  }

  // La carte d'arrivée d'un message : en verre, aux coins en feuille, elle glisse depuis le haut et s'en va au bout
  // de 5 secondes. La toucher ouvre la conversation. Trois au plus à l'écran.
  function toastMessage(message) {
    let zone = document.querySelector('.toasts-messages');
    if (!zone) {
      zone = el('div', { classe: 'toasts-messages', role: 'status', 'aria-live': 'polite' });
      document.body.append(zone);
    }
    const carte = el('a', { classe: 'toast-message', href: message.groupe ? `/messages/groupe/${message.conversationId}` : `/messages/${message.conversationId}` }, [
      avatar(message.auteur, 'moyen'),
      el('span', { classe: 'toast-message-texte' }, [
        // textContent partout : le nom, le titre du groupe et l'aperçu viennent de membres.
        el('strong', { texte: message.groupe ? `${prenom(message.auteur)}, ${message.titre}` : message.auteur.nom }),
        el('span', { texte: message.apercu }),
      ]),
    ]);
    zone.prepend(carte);
    [...zone.children].slice(3).forEach((ancienne) => ancienne.remove());
    setTimeout(() => carte.classList.add('part'), 5000);
    setTimeout(() => carte.remove(), 5500);
  }

  function surveillerMessages() {
    let minuterie = 0;
    const demander = () => api('/messages/non-lus').then(({ nonLus }) => majPastilleMessages(nonLus)).catch(() => {});
    const regler = () => {
      clearInterval(minuterie);
      if (document.hidden) return;
      minuterie = setInterval(demander, 60000);
    };
    document.addEventListener('visibilitychange', () => {
      regler();
      if (!document.hidden) demander();
    });
    regler();
  }

  // Le petit lien « English » / « Français » en bas des pages publiques (accueil, connexion, à propos…), pour les
  // visiteurs seulement : un membre choisit sa langue dans ses paramètres. La page le demande avec un élément
  // vide qui porte data-choix-langue.
  const NOMS_LANGUES = { fr: 'Français', en: 'English' }; // jamais traduits : « English » se lit « English » partout
  function poserChoixLangue(moi) {
    const zone = document.querySelector('[data-choix-langue]');
    if (!zone || moi) return;
    const autre = langue === 'fr' ? 'en' : 'fr';
    // Le nom de chaque langue s'écrit dans SA langue : on doit pouvoir le lire sans comprendre la page.
    const lien = el('button', { classe: 'bouton bouton-lien lien-langue', type: 'button', lang: autre }, [icone('globe'), NOMS_LANGUES[autre]]);
    lien.addEventListener('click', () => changerLangue(autre));
    zone.replaceChildren(lien);
  }

  // « Les règles ont changé » : le membre les accepte pour continuer, ou se déconnecte. La fenêtre ne se ferme pas
  // autrement ; et même si on la retirait de la page, le serveur refuse d'écrire tant qu'elles ne sont pas acceptées.
  function fenetreRegles() {
    if (document.querySelector('.dialogue-regles')) return;
    const accepter = el('button', { classe: 'bouton bouton-principal', type: 'button', texte: t('regles-fenetre.accepter') });
    const sortir = el('button', { classe: 'bouton bouton-lien', type: 'button', texte: t('nav.se-deconnecter') });
    const message = el('p', { classe: 'message', role: 'alert' });
    const dialogue = el('dialog', { classe: 'dialogue dialogue-regles', 'aria-labelledby': 'regles-fenetre-titre' }, [
      el('h2', { id: 'regles-fenetre-titre', texte: t('regles-fenetre.titre') }),
      el('p', {}, [t('regles-fenetre.texte'), ' ', el('a', { href: '/regles', target: '_blank', rel: 'noopener', texte: t('nav.regles') }), ', ', el('a', { href: '/conditions', target: '_blank', rel: 'noopener', texte: t('nav.conditions-utilisation') }), '.']),
      message,
      el('div', { classe: 'dialogue-actions' }, [sortir, accepter]),
    ]);
    // La touche Échap ne la ferme pas ; et si le navigateur la ferme quand même, elle se rouvre.
    let accepte = false;
    dialogue.addEventListener('cancel', (evenement) => evenement.preventDefault());
    dialogue.addEventListener('close', () => { if (!accepte && dialogue.isConnected) dialogue.showModal(); });
    sortir.addEventListener('click', seDeconnecter);
    accepter.addEventListener('click', async () => {
      accepter.disabled = true;
      try {
        await api('/auth/regles', { methode: 'POST', donnees: { accepte: true } });
        accepte = true;
        dialogue.close();
        dialogue.remove();
      } catch (erreur) {
        message.textContent = erreur.message;
        message.className = 'message erreur';
        accepter.disabled = false;
      }
    });
    document.body.append(dialogue);
    dialogue.showModal();
  }

  // Remplit la navigation de l'en-tête selon que la personne est connectée ou non.
  // En-tête : recherche, cloche, avatar. Sur téléphone, les onglets (et l'avatar) forment la barre du bas ;
  // sur ordinateur, ils sont dans la colonne de gauche.
  async function remplirNavigation() {
    const nav = document.querySelector('[data-nav]');
    if (!nav) return;
    const moi = await utilisateurConnecte();
    // Tant que l'email n'est pas confirmé, le membre ne voit que la page du code.
    if (moi && !moi.emailConfirme) return window.location.replace('/confirmer-email');
    // Compte désactivé (ou suppression demandée) : il faut d'abord le réactiver.
    if (moi && moi.desactive) return window.location.replace('/bon-retour');
    // Les règles de la communauté ont changé depuis son acceptation : une fenêtre, sauf sur les pages où on les lit.
    if (moi && moi.reglesAAccepter && !['/regles', '/conditions'].includes(window.location.pathname)) fenetreRegles();
    // La langue choisie dans le compte suit le membre sur tous ses appareils. Un compte qui n'a pas encore de
    // langue reçoit celle de ce navigateur (le serveur écrit ainsi ses notifications et ses emails dans la bonne).
    if (moi && moi.langue && moi.langue !== langue) return changerLangue(moi.langue);
    if (moi && !moi.langue) api('/parametres/langue', { methode: 'PUT', donnees: { langue } }).catch(() => {});
    poserChoixLangue(moi);
    nav.replaceChildren();
    const loupe = el('button', { classe: 'nav-cloche nav-loupe', type: 'button', 'aria-label': t('recherche.membre'), title: t('recherche.membre') }, [icone('recherche')]);
    loupe.addEventListener('click', ouvrirRecherche);
    if (moi) {
      const demandes = moi.demandesAmis || 0;
      const nonLues = moi.notifications || 0;
      const ici = (href) => (window.location.pathname === href ? 'page' : null);
      // Un onglet du menu : une icône, un texte, et aria-current sur la page où l'on se trouve.
      const lien = (href, nomIcone, texte, pastille = null) => el('a', { classe: 'onglet-nav', href, 'aria-current': ici(href) }, [
        el('span', { classe: 'onglet-icone' }, [icone(nomIcone), pastille]), el('span', { classe: 'onglet-texte', texte }),
      ]);
      const monProfil = `/${moi.identifiant}`;
      // « avec-barre » : la page d'un membre connecté (barre du bas sur téléphone, colonnes sur ordinateur).
      document.body.classList.add('avec-barre');
      // filter(Boolean) : append() écrirait le mot « null » à la place d'un élément absent (pas de lien « Admin »).
      nav.append(...[
        barreRecherche(),
        el('div', { classe: 'nav-liens' }, [
          lien('/fil', 'fil', t('nav.fil')),
          lien('/demandes', 'demandes', t('nav.demandes')),
          lien('/chercher', 'devs', t('nav.devs')),
          lien('/amis', 'amis', t('nav.amis'),
            demandes ? el('span', { classe: 'compteur compteur-amis', texte: String(demandes), 'aria-label': t('nav.demandes-en-attente', { n: demandes }) }) : null),
          // Cinquième onglet, visible seulement sur téléphone : mon avatar, vers mon profil.
          el('a', { classe: 'onglet-nav onglet-moi', href: monProfil, 'aria-current': ici(monProfil) }, [
            el('span', { classe: 'onglet-icone' }, [avatar(moi, 'nav')]), el('span', { classe: 'onglet-texte', texte: t('nav.profil') }),
          ]),
        ]),
        moi.estAdmin ? el('a', { classe: 'nav-cloche nav-admin', href: '/admin', 'aria-label': t('nav.administration'), title: t('nav.administration') }, [icone('admin')]) : null,
        loupe,
        boutonTheme(),
        lienMessages(moi.messagesNonLus || 0),
        el('a', {
          classe: 'nav-cloche', href: '/notifications',
          'aria-label': nonLues ? t('nav.notifications-non-lues', { n: nonLues }) : t('nav.notifications'),
        }, [
          icone('cloche'),
          nonLues ? el('span', { classe: 'compteur compteur-cloche', 'aria-hidden': 'true', texte: nonLues > 99 ? '99+' : String(nonLues) }) : null,
        ]),
        menuAvatar(moi),
      ].filter(Boolean));
      poserColonnes(moi);
      // Un seul bandeau à la fois : la suspension passe avant le profil à terminer.
      if (moi.suspenduJusquA) poserBandeauSuspension(moi);
      else poserBandeauProfil(moi);
      majPastilleMessages(moi.messagesNonLus || 0);
      surveillerMessages();
      veiller();
    } else {
      nav.append(...[barreRecherche(), loupe, boutonTheme(), el('a', { classe: 'bouton bouton-principal bouton-compact', href: '/connexion', texte: t('nav.se-connecter') })].filter(Boolean));
    }
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }

  document.addEventListener('DOMContentLoaded', remplirNavigation);

  window.Palabre = { nomPays, lieuDe, cleDe, t, langue, changerLangue, traduirePage, nombre, REGION, appeler, appelEntrant, listeChoix, chargementInfini, tempsRestant, etatDefi, api, utilisateurConnecte, el, avatar, nomMembre, badgeFeuille, prenom, initiales, dateRelative, deNom, fcfa, etoiles, carteProjet, partager, copierLien, menuOptions, majPastilleMessages, seDeconnecter, reduireImage, signaler, icone, illustration, etatVide, chargement, toast, confirmer };
})();
