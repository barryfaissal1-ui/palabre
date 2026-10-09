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
      ? el('img', { classe: 'avatar', src: personne.avatar, alt: '', decoding: 'async' })
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

  const prenom = (nom) => nom.trim().split(/\s+/)[0];

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
  function deNom(nom) {
    return /^[aeiouyhàâäéèêëîïôöùûü]/i.test(nom) ? `d'${nom}` : `de ${nom}`;
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

  // Partage d'une page : menu de partage du téléphone s'il existe, sinon copie du lien.
  async function partager(url, titre, bouton) {
    if (navigator.share) {
      try { await navigator.share({ title: titre, url }); } catch { /* partage annulé par la personne */ }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast('Lien copié. Colle-le où tu veux.');
    } catch {
      // Copie refusée par le navigateur : on montre le lien pour qu'il soit copié à la main.
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

  // ---------- Recherche de membres (loupe de l'en-tête) ----------
  // Un panneau plein écran : on tape un nom, les résultats arrivent en direct.
  // On attend 300 ms après la dernière frappe avant d'interroger le serveur : une seule requête par mot, pas une par lettre.
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

    fermer.addEventListener('click', () => panneau.close());
    panneau.addEventListener('close', () => {
      clearTimeout(minuterie);
      panneau.remove();
    });
    document.body.append(panneau);
    panneau.showModal();
    champ.focus();
  }

  // Remplit la navigation de l'en-tête selon que la personne est connectée ou non.
  // En-tête : loupe, cloche, avatar. Sur téléphone, les onglets (et l'avatar) forment la barre du bas.
  async function remplirNavigation() {
    const nav = document.querySelector('[data-nav]');
    if (!nav) return;
    const moi = await utilisateurConnecte();
    nav.replaceChildren();
    const loupe = el('button', { classe: 'nav-cloche', type: 'button', 'aria-label': 'Chercher un membre', title: 'Chercher un membre' }, [icone('recherche')]);
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
      // Sur téléphone, ces liens forment une barre fixe en bas de l'écran (voir .nav-liens dans le CSS).
      document.body.classList.add('avec-barre');
      // filter(Boolean) : append() écrirait le mot « null » à la place d'un élément absent (pas de lien « Admin »).
      nav.append(...[
        el('div', { classe: 'nav-liens' }, [
          lien('/fil', 'fil', 'Fil'),
          lien('/demandes', 'demandes', 'Demandes'),
          lien('/chercher', 'devs', 'Devs'),
          lien('/amis', 'amis', 'Amis',
            demandes ? el('span', { classe: 'compteur', texte: String(demandes), 'aria-label': `${demandes} demande${demandes > 1 ? 's' : ''} en attente` }) : null),
          // Cinquième onglet, visible seulement sur téléphone : mon avatar, vers mon profil.
          el('a', { classe: 'onglet-nav onglet-moi', href: monProfil, 'aria-current': ici(monProfil) }, [
            el('span', { classe: 'onglet-icone' }, [avatar(moi, 'nav')]), el('span', { classe: 'onglet-texte', texte: 'Profil' }),
          ]),
        ]),
        moi.estAdmin ? el('a', { classe: 'nav-cloche', href: '/admin', 'aria-label': 'Administration', title: 'Administration' }, [icone('admin')]) : null,
        loupe,
        el('a', {
          classe: 'nav-cloche', href: '/notifications',
          'aria-label': nonLues ? `Notifications : ${nonLues} non lue${nonLues > 1 ? 's' : ''}` : 'Notifications',
        }, [
          icone('cloche'),
          nonLues ? el('span', { classe: 'compteur compteur-cloche', 'aria-hidden': 'true', texte: nonLues > 99 ? '99+' : String(nonLues) }) : null,
        ]),
        el('a', { classe: 'nav-profil', href: monProfil, 'aria-label': 'Mon profil' }, [avatar(moi, 'mini')]),
      ].filter(Boolean));
    } else {
      nav.append(loupe, el('a', { classe: 'bouton bouton-principal bouton-compact', href: '/connexion', texte: 'Se connecter' }));
    }
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }

  document.addEventListener('DOMContentLoaded', remplirNavigation);

  window.Palabre = { api, utilisateurConnecte, el, avatar, nomMembre, badgeFeuille, prenom, initiales, dateRelative, deNom, fcfa, etoiles, carteProjet, partager, reduireImage, signaler, icone, illustration, etatVide, chargement, toast, confirmer };
})();
