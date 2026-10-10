// Outils communs à toutes les pages : appels à l'API, session, navigation, installation PWA.
(function () {
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
      const erreur = new Error('Pas de connexion internet. Vérifie ton réseau et réessaie.');
      erreur.statut = 0;
      throw erreur;
    }
    const corps = await reponse.json().catch(() => ({}));
    if (!reponse.ok) {
      const erreur = new Error(corps.erreur || 'Une erreur est survenue. Réessaie.');
      erreur.statut = reponse.status;
      erreur.champ = corps.champ;
      erreur.suite = corps.suite; // page où régler le problème (/bienvenue, /confirmer-email)
      // Email pas encore confirmé : le serveur refuse tout, on ramène la personne à la page du code.
      if (corps.suite === '/confirmer-email' && window.location.pathname !== '/confirmer-email') window.location.replace('/confirmer-email');
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
  //   const infini = chargementInfini(liste, chargerSuite, { fin: 'Tu as tout vu.', bouton });
  //   infini.reprendre(resteIlDesPages);   // après le premier chargement, ou après un changement de filtre
  // chargerSuite() ajoute la page suivante à la liste et répond true s'il en reste encore ; en cas de panne, elle
  // lève une erreur. La page garde donc sa requête ; tout le reste (guetter, squelettes, fin, erreur) est ici.
  //
  // Comment : un repère invisible est posé sous la liste. Un IntersectionObserver prévient quand ce repère arrive à
  // moins de 800 px du bas de l'écran. C'est le navigateur qui surveille : rien ne tourne pendant le défilement.
  // « bouton » : le « Voir plus » de la page, montré seulement si le navigateur ne connaît pas IntersectionObserver.
  function chargementInfini(liste, chargerSuite, { fin = 'Tu as tout vu.', bouton = null } = {}) {
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
        const reessayer = el('button', { classe: 'bouton bouton-contour', type: 'button' }, [icone('recharger'), 'Réessayer']);
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
  function confirmer(question, { bouton = 'Confirmer', danger = false } = {}) {
    const coupe = question.indexOf('?') + 1;
    // espace insécable avant « ? » : le point d'interrogation ne se retrouve jamais seul à la ligne
    const titre = (coupe > 0 ? question.slice(0, coupe) : question).replace(/ \?/g, ' ?');
    const suite = coupe > 0 ? question.slice(coupe).trim() : '';
    return new Promise((resolve) => {
      const annuler = el('button', { classe: 'bouton bouton-lien', type: 'button', texte: 'Annuler' });
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
    return el('span', { classe: 'badge-feuille', role: 'img', 'aria-label': 'Profil prouvé', title: 'Profil prouvé' }, [icone('feuille')]);
  }

  // Le nom d'un membre, avec son badge feuille s'il est prouvé. À utiliser partout où un nom s'affiche.
  // « lien: false » quand le nom est déjà dans un lien (un lien ne peut pas en contenir un autre).
  function nomMembre(membre, { lien = true } = {}) {
    const nom = lien
      ? el('a', { classe: 'nom-auteur', href: `/${membre.identifiant}`, texte: membre.nom })
      : el('span', { classe: 'nom-auteur', texte: membre.nom });
    return el('span', { classe: 'nom-membre' }, [nom, membre.nbProjetsVerifies > 0 ? badgeFeuille() : null]);
  }

  // Le prénom d'un membre : celui qu'il a saisi à l'inscription (envoyé par le serveur avec chaque aperçu de membre).
  // Secours si le prénom manque : le premier mot du nom.
  const prenom = (membre) => membre.prenom || String(membre.nom || '').trim().split(/\s+/)[0];

  // « il y a 5 min », « il y a 3 h », puis la date au-delà d'une semaine.
  function dateRelative(iso) {
    const date = new Date(iso);
    const secondes = Math.round((Date.now() - date.getTime()) / 1000);
    if (secondes < 60) return 'à l\'instant';
    if (secondes < 3600) return `il y a ${Math.floor(secondes / 60)} min`;
    if (secondes < 86400) return `il y a ${Math.floor(secondes / 3600)} h`;
    if (secondes < 7 * 86400) return `il y a ${Math.floor(secondes / 86400)} j`;
    return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // « de Bintou » mais « d'Awa » : l'élision devant une voyelle.
  // Un « y » suivi d'une voyelle se prononce comme une consonne : « de Yao », « de Youssouf », mais « d'Yves ».
  function deNom(nom) {
    return /^([aeiouhàâäéèêëîïôöùûü]|y(?![aeiouàâäéèêëîïôöùûü]))/i.test(nom) ? `d'${nom}` : `de ${nom}`;
  }

  // Montant en francs CFA : 250000 → « 250 000 FCFA ». Sans montant : « À discuter ».
  function fcfa(montant) {
    if (montant === null || montant === undefined) return 'À discuter';
    return `${montant.toLocaleString('fr-FR')} FCFA`;
  }

  // Note sur 5 en étoiles, lisible aussi par un lecteur d'écran.
  function etoiles(note) {
    const pleines = Math.round(note);
    return el('span', { classe: 'etoiles', role: 'img', 'aria-label': `${String(note).replace('.', ',')} sur 5`, texte: '★'.repeat(pleines) + '☆'.repeat(5 - pleines) });
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
          projet.lienVerifie ? el('span', { classe: 'badge-verifie' }, [icone('verifie'), 'Lien vérifié']) : null,
        ]),
        el('h3', {}, [el('a', { href: adresse, texte: projet.titre })]),
        avecDev ? el('p', { classe: 'texte-discret projet-auteur' }, ['Par ', nomMembre(projet.dev)]) : null,
      ]),
    ]);
  }

  // Copie un lien dans le presse-papiers ; si le navigateur refuse, on le montre pour qu'il soit copié à la main.
  async function copierLien(url) {
    try {
      await navigator.clipboard.writeText(url);
      toast('Lien copié. Colle-le où tu veux.');
    } catch {
      const champ = el('input', { type: 'text', readonly: true, value: url, 'aria-label': 'Lien à copier' });
      const fermer = el('button', { classe: 'bouton bouton-principal', type: 'button', texte: 'Fermer' });
      const dialogue = el('dialog', { classe: 'dialogue', 'aria-labelledby': 'lien-titre' }, [
        el('h2', { id: 'lien-titre', texte: 'Copie ce lien' }), champ, el('div', { classe: 'dialogue-actions' }, [fermer]),
      ]);
      fermer.addEventListener('click', () => dialogue.close());
      dialogue.addEventListener('close', () => dialogue.remove());
      document.body.append(dialogue);
      dialogue.showModal();
      champ.select();
    }
  }

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
    const copier = el('button', { classe: 'choix-partage', type: 'button' }, [el('span', { classe: 'choix-partage-rond' }, [icone('lien')]), 'Copier le lien']);
    const fermer = el('button', { classe: 'bouton-icone', type: 'button', 'aria-label': 'Fermer', title: 'Fermer' }, [icone('fermer')]);
    const dialogue = el('dialog', { classe: 'dialogue dialogue-partage', 'aria-labelledby': 'partage-titre' }, [
      el('div', { classe: 'partage-entete' }, [el('h2', { id: 'partage-titre', texte: 'Partager' }), fermer]),
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
  function menuOptions(lister, { cote = 'droite' } = {}) {
    const bouton = el('button', {
      classe: 'bouton-icone', type: 'button', 'aria-label': 'Plus d\'options', title: 'Plus d\'options',
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
      throw new Error('Impossible de lire cette image. Choisis une photo JPEG ou PNG.');
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
    throw new Error('Image trop lourde. Choisis-en une autre.');
  }

  // Fenêtre « Signaler » : la même pour une publication, un commentaire ou un profil.
  const MOTIFS_SIGNALEMENT = [
    'Spam ou arnaque',
    'Insultes ou harcèlement',
    'Contenu choquant ou illégal',
    'Faux profil ou usurpation',
    'Autre raison',
  ];

  function signaler(cibleType, cible) {
    const motif = el('select', { id: 'signalement-motif' }, MOTIFS_SIGNALEMENT.map((m) => el('option', { value: m, texte: m })));
    const precision = el('textarea', { id: 'signalement-precision', rows: '3', maxlength: '400', placeholder: 'Explique en quelques mots (facultatif)' });
    const zoneMessage = el('p', { classe: 'message', role: 'status' });
    const annuler = el('button', { classe: 'bouton bouton-lien', type: 'button', texte: 'Annuler' });
    const envoyer = el('button', { classe: 'bouton bouton-principal', type: 'submit', texte: 'Envoyer' });
    const formulaire = el('form', {}, [
      el('h2', { id: 'signalement-titre', texte: 'Signaler' }),
      el('p', { classe: 'texte-discret', texte: 'L\'équipe Palabre vérifiera. La personne signalée ne saura pas que cela vient de toi.' }),
      el('div', { classe: 'champ' }, [el('label', { for: 'signalement-motif', texte: 'Quel est le problème ?' }), motif]),
      el('div', { classe: 'champ' }, [el('label', { for: 'signalement-precision', texte: 'Précision' }), precision]),
      zoneMessage,
      el('div', { classe: 'dialogue-actions' }, [annuler, envoyer]),
    ]);
    const dialogue = el('dialog', { classe: 'dialogue', 'aria-labelledby': 'signalement-titre' }, [formulaire]);

    annuler.addEventListener('click', () => dialogue.close());
    dialogue.addEventListener('close', () => dialogue.remove());
    formulaire.addEventListener('submit', async (evenement) => {
      evenement.preventDefault();
      envoyer.disabled = true;
      const detail = precision.value.trim();
      try {
        const reponse = await api('/signalements', {
          methode: 'POST',
          donnees: { cibleType, cible, motif: detail ? `${motif.value} : ${detail}` : motif.value },
        });
        zoneMessage.textContent = reponse.dejaSignale ? 'Tu avais déjà signalé ce contenu. Merci.' : 'Merci, ton signalement est envoyé.';
        zoneMessage.className = 'message succes';
        motif.disabled = true;
        precision.disabled = true;
        envoyer.hidden = true;
        annuler.textContent = 'Fermer';
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
    const avancee = () => el('a', { classe: 'bouton bouton-contour', href: '/chercher' }, [icone('devs'), 'Chercher par compétence ou par ville']);
    const conseil = (texte) => resultats.replaceChildren(el('p', { classe: 'texte-discret recherche-conseil', texte }), avancee());
    conseil('Écris au moins 2 lettres du nom.');

    let minuterie = null;
    let numero = 0; // numéro de la dernière recherche : la réponse d'une ancienne frappe est ignorée
    champ.addEventListener('input', () => {
      clearTimeout(minuterie);
      numero += 1;
      const demande = numero;
      const q = champ.value.trim();
      if (q.length < 2) {
        conseil('Écris au moins 2 lettres du nom.');
        return;
      }
      minuterie = setTimeout(async () => {
        try {
          const { devs } = await api(`/devs?q=${encodeURIComponent(q)}`);
          if (demande !== numero) return;
          if (devs.length === 0) {
            resultats.replaceChildren(etatVide('recherche', 'Personne à ce nom', 'Vérifie l\'orthographe, ou cherche plutôt par compétence.', avancee()));
            return;
          }
          resultats.replaceChildren(el('ul', { classe: 'liste-recherche' }, devs.map((membre) => el('li', {}, [
            el('a', { classe: 'resultat-membre', href: `/${membre.identifiant}` }, [
              avatar(membre, 'moyen'),
              el('span', { classe: 'resultat-texte' }, [
                nomMembre(membre, { lien: false }),
                el('span', { classe: 'texte-discret', texte: [membre.type === 'client' ? 'Client' : null, membre.ville, membre.pays].filter(Boolean).join(', ') }),
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
      type: 'search', placeholder: 'Chercher un membre par son nom', 'aria-label': 'Chercher un membre par son nom',
      autocomplete: 'off', enterkeyhint: 'search', maxlength: '60',
    });
    const fermer = el('button', { classe: 'bouton-icone', type: 'button', 'aria-label': 'Fermer la recherche' }, [icone('fleche-gauche')]);
    const resultats = el('div', { classe: 'recherche-resultats', 'aria-live': 'polite' });
    const panneau = el('dialog', { classe: 'panneau-recherche', 'aria-label': 'Recherche de membres' }, [
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
      type: 'search', placeholder: 'Chercher un membre', 'aria-label': 'Chercher un membre par son nom',
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
    return el('aside', { classe: 'colonne-gauche', 'aria-label': 'Menu principal' }, [
      el('div', { classe: 'carte-moi' }, [
        el('a', { classe: 'lien-avatar', href: `/${moi.identifiant}`, 'aria-label': 'Mon profil' }, [avatar(moi, 'moyen')]),
        el('div', {}, [nomMembre(moi), el('a', { classe: 'voir-profil', href: `/${moi.identifiant}`, texte: 'Voir mon profil' })]),
      ]),
      el('nav', { 'aria-label': 'Pages' }, [el('ul', { classe: 'menu-gauche-liens' }, [
        lien('/fil', 'fil', 'Fil'),
        lien('/demandes', 'demandes', 'Demandes'),
        lien('/chercher', 'devs', 'Devs'),
        lien('/amis', 'amis', 'Amis', compteur(demandes, 'compteur-amis')),
        lien('/messages', 'commentaire', 'Messages', el('span', { classe: 'compteur compteur-messages', hidden: true })),
        lien('/notifications', 'cloche', 'Notifications', compteur(nonLues, 'compteur-notifications')),
        estDev ? lien('/projets', 'projet', 'Mes projets') : null,
        lien('/defis', 'trophee', 'Défi de la semaine'),
        lien('/calculateur', 'calculatrice', 'Calculateur'),
        moi.estAdmin ? lien('/admin', 'admin', 'Administration') : null,
      ])]),
      estDev
        ? el('a', { classe: 'bouton bouton-principal bouton-plein', href: '/projets' }, [icone('plus'), 'Ajouter un projet'])
        : el('a', { classe: 'bouton bouton-principal bouton-plein', href: '/demandes?publier=1' }, [icone('plus'), 'Publier une demande']),
      el('p', { classe: 'pied-menu' }, [
        el('a', { href: '/a-propos', texte: 'À propos' }), el('a', { href: '/conditions', texte: 'Conditions' }),
        el('span', { texte: 'Palabre, fait au Burkina Faso, 2026' }),
      ]),
    ]);
  }

  // Panneau de droite : les demandes récentes, puis des devs à découvrir.
  function colonneDroite(moi) {
    const zoneDemandes = el('div', { classe: 'liste-cote' });
    const zoneDevs = el('ul', { classe: 'liste-cote' });
    const blocDemandes = el('section', { classe: 'bloc-cote', 'aria-labelledby': 'titre-demandes-recentes' }, [
      el('h2', { id: 'titre-demandes-recentes', texte: moi.type === 'client' ? 'Mes demandes' : 'Demandes récentes' }),
      zoneDemandes,
      el('a', { classe: 'lien-cote', href: '/demandes', texte: 'Voir toutes les demandes' }),
    ]);
    const blocDevs = el('section', { classe: 'bloc-cote', 'aria-labelledby': 'titre-devs-decouvrir', hidden: true }, [
      el('h2', { id: 'titre-devs-decouvrir', texte: 'Devs à découvrir' }),
      zoneDevs,
      el('a', { classe: 'lien-cote', href: '/chercher', texte: 'Chercher un développeur' }),
    ]);
    // Encadré « Défi de la semaine » : caché tant qu'on ne sait pas s'il y a un défi.
    const zoneDefi = el('div', { classe: 'liste-cote' });
    const blocDefi = el('section', { classe: 'bloc-cote bloc-defi', 'aria-labelledby': 'titre-defi-cote', hidden: true }, [
      el('h2', { id: 'titre-defi-cote' }, [icone('trophee'), 'Défi de la semaine']),
      zoneDefi,
      el('a', { classe: 'lien-cote', href: '/defis', texte: 'Voir le défi' }),
    ]);
    const colonne = el('aside', { classe: 'colonne-droite', 'aria-label': 'À découvrir' }, [blocDefi, blocDemandes, blocDevs]);

    function boutonAjouter(dev) {
      const bouton = el('button', { classe: 'bouton bouton-contour bouton-compact', type: 'button', 'aria-label': `Ajouter ${dev.nom} en ami` }, [icone('ami-ajouter'), 'Ajouter']);
      bouton.addEventListener('click', async () => {
        bouton.disabled = true;
        try {
          await api('/amis/demandes', { methode: 'POST', donnees: { identifiant: dev.identifiant } });
          bouton.replaceChildren(icone('horloge'), 'Demande envoyée');
          bouton.classList.add('envoyee');
          bouton.setAttribute('aria-label', `Demande d'ami envoyée à ${dev.nom}`);
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
          zoneDemandes.replaceChildren(el('p', { classe: 'texte-discret', texte: moi.type === 'client' ? 'Tu n\'as pas encore publié de demande.' : 'Aucune demande ouverte pour l\'instant.' }));
          return;
        }
        zoneDemandes.replaceChildren(...demandes.slice(0, 3).map((demande) => {
          const propositions = `${demande.nbPropositions} proposition${demande.nbPropositions > 1 ? 's' : ''}`;
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
          el('a', { classe: 'lien-avatar', href: `/${dev.identifiant}`, 'aria-label': `Profil de ${dev.nom}` }, [avatar(dev, 'moyen')]),
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
    if (heures < 1) return 'moins d\'une heure';
    const jours = Math.floor(heures / 24);
    const reste = heures % 24;
    const morceaux = [];
    if (jours) morceaux.push(`${jours} jour${jours > 1 ? 's' : ''}`);
    if (reste) morceaux.push(`${reste} heure${reste > 1 ? 's' : ''}`);
    return morceaux.join(' et ');
  }

  // Une ligne qui dit où en est le défi : « Réponses ouvertes, encore 2 jours et 5 heures ».
  function etatDefi(defi) {
    const reponses = `${defi.nbReponses} réponse${defi.nbReponses > 1 ? 's' : ''}`;
    if (defi.phase === 'reponses') return `${reponses}, encore ${tempsRestant(defi.finReponsesLe)} pour répondre`;
    if (defi.phase === 'vote') return `${reponses}, encore ${tempsRestant(defi.finVoteLe)} pour voter`;
    return `Terminé, ${reponses} : découvre le gagnant`;
  }

  // Bandeau « Termine ton profil de dev » : sous l'en-tête, tant qu'un dev n'a pas rempli la page /bienvenue.
  // (Pas sur la messagerie, dont la page occupe exactement la hauteur de l'écran.)
  function poserBandeauProfil(moi) {
    const entete = document.querySelector('body > .entete');
    if (moi.profilComplet || !entete || window.location.pathname.startsWith('/messages')) return;
    document.body.classList.add('avec-bandeau');
    entete.after(el('a', { classe: 'bandeau-profil', href: '/bienvenue' }, [
      icone('utilisateur'),
      el('span', { texte: 'Termine ton profil de dev pour répondre aux demandes.' }),
      el('strong', { texte: 'Terminer' }),
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
      bouton.setAttribute('aria-label', sombre ? 'Passer en mode clair' : 'Passer en mode sombre');
      bouton.title = sombre ? 'Mode clair' : 'Mode sombre';
    }
    bouton.addEventListener('click', () => {
      theme.basculer();
      dessiner();
    });
    dessiner();
    return bouton;
  }

  // ---------- Messages : l'icône de l'en-tête et sa pastille de non lus ----------
  function lienMessages(nonLus) {
    return el('a', { classe: 'nav-cloche nav-messages', href: '/messages', 'aria-label': 'Messages', title: 'Messages' }, [
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
    if (lien) lien.setAttribute('aria-label', nonLus ? `Messages : ${nonLus} non lu${nonLus > 1 ? 's' : ''}` : 'Messages');
  }
  // Pas de WebSocket : la pastille est redemandée toutes les 60 secondes, seulement quand l'onglet est visible.
  // Onglet caché : plus aucune requête ; de retour au premier plan, on rattrape tout de suite.
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

  // Remplit la navigation de l'en-tête selon que la personne est connectée ou non.
  // En-tête : recherche, cloche, avatar. Sur téléphone, les onglets (et l'avatar) forment la barre du bas ;
  // sur ordinateur, ils sont dans la colonne de gauche.
  async function remplirNavigation() {
    const nav = document.querySelector('[data-nav]');
    if (!nav) return;
    const moi = await utilisateurConnecte();
    // Tant que l'email n'est pas confirmé, le membre ne voit que la page du code.
    if (moi && !moi.emailConfirme) return window.location.replace('/confirmer-email');
    nav.replaceChildren();
    const loupe = el('button', { classe: 'nav-cloche nav-loupe', type: 'button', 'aria-label': 'Chercher un membre', title: 'Chercher un membre' }, [icone('recherche')]);
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
          lien('/fil', 'fil', 'Fil'),
          lien('/demandes', 'demandes', 'Demandes'),
          lien('/chercher', 'devs', 'Devs'),
          lien('/amis', 'amis', 'Amis',
            demandes ? el('span', { classe: 'compteur compteur-amis', texte: String(demandes), 'aria-label': `${demandes} demande${demandes > 1 ? 's' : ''} en attente` }) : null),
          // Cinquième onglet, visible seulement sur téléphone : mon avatar, vers mon profil.
          el('a', { classe: 'onglet-nav onglet-moi', href: monProfil, 'aria-current': ici(monProfil) }, [
            el('span', { classe: 'onglet-icone' }, [avatar(moi, 'nav')]), el('span', { classe: 'onglet-texte', texte: 'Profil' }),
          ]),
        ]),
        moi.estAdmin ? el('a', { classe: 'nav-cloche nav-admin', href: '/admin', 'aria-label': 'Administration', title: 'Administration' }, [icone('admin')]) : null,
        loupe,
        boutonTheme(),
        lienMessages(moi.messagesNonLus || 0),
        el('a', {
          classe: 'nav-cloche', href: '/notifications',
          'aria-label': nonLues ? `Notifications : ${nonLues} non lue${nonLues > 1 ? 's' : ''}` : 'Notifications',
        }, [
          icone('cloche'),
          nonLues ? el('span', { classe: 'compteur compteur-cloche', 'aria-hidden': 'true', texte: nonLues > 99 ? '99+' : String(nonLues) }) : null,
        ]),
        el('a', { classe: 'nav-profil', href: monProfil, 'aria-label': 'Mon profil' }, [avatar(moi, 'mini')]),
      ].filter(Boolean));
      poserColonnes(moi);
      poserBandeauProfil(moi);
      majPastilleMessages(moi.messagesNonLus || 0);
      surveillerMessages();
    } else {
      nav.append(...[barreRecherche(), loupe, boutonTheme(), el('a', { classe: 'bouton bouton-principal bouton-compact', href: '/connexion', texte: 'Se connecter' })].filter(Boolean));
    }
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }

  document.addEventListener('DOMContentLoaded', remplirNavigation);

  window.Palabre = { chargementInfini, tempsRestant, etatDefi, api, utilisateurConnecte, el, avatar, nomMembre, badgeFeuille, prenom, initiales, dateRelative, deNom, fcfa, etoiles, carteProjet, partager, copierLien, menuOptions, majPastilleMessages, reduireImage, signaler, icone, illustration, etatVide, chargement, toast, confirmer };
})();
