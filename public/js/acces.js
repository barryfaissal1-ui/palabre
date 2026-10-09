// Page d'accès (/connexion et /inscription) : passage d'un formulaire à l'autre avec la « lame » verte,
// bouton œil des mots de passe, indicateur de force. L'envoi des formulaires reste dans formulaires.js.
(function () {
  const carte = document.querySelector('[data-carte]');
  if (!carte) return;

  // Durée d'une moitié de l'animation (la lame couvre, puis se retire) : la même valeur que --duree-lame dans le CSS.
  const DEMI_DUREE = 450;
  const TITRES = { connexion: 'Se connecter – Palabre', inscription: 'Créer un compte – Palabre' };
  const telephone = window.matchMedia('(max-width: 767px)');
  const moinsDeMouvement = window.matchMedia('(prefers-reduced-motion: reduce)');
  const attendre = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
  const vueDeLAdresse = () => (window.location.pathname.startsWith('/inscription') ? 'inscription' : 'connexion');
  let enCours = false;

  // Montre un formulaire et son message. L'autre est réellement mis hors d'atteinte du clavier
  // et des lecteurs d'écran (attribut inert), pas seulement caché à l'œil.
  function montrer(vue) {
    carte.dataset.vue = vue;
    document.title = TITRES[vue];
    carte.querySelectorAll('[data-pour]').forEach((zone) => { zone.inert = zone.dataset.pour !== vue; });
    dessinerMotif(); // le formulaire a changé de taille : le motif se replace autour
  }

  // ---------- Motif du fond : de petits dessins au trait, sur le thème des développeurs ----------
  // Les dessins sont dans un seul petit fichier, /icons/motif-acces.svg. Ce code les dispose sur une grille dont
  // chaque case reçoit un dessin, décalé, tourné et dimensionné « au hasard » : placement irrégulier mais équilibré.
  // Le hasard est calculé à partir du numéro de la case : le même écran donne toujours le même motif.
  // Une case qui toucherait la zone interdite (la carte sur ordinateur ; le panneau vert et le formulaire sur
  // téléphone) reste vide : aucun dessin ne passe sous un champ.
  const SVG = 'http://www.w3.org/2000/svg';
  const DESSINS = ['code', 'accolades', 'fleche', 'terminal', 'portable', 'telephone', 'cafe', 'ampoule', 'fusee', 'bulles', 'sourire', 'groupe', 'feuille', 'wifi'];
  const zoneMotif = carte.parentElement; // <main class="acces">
  const motif = document.createElementNS(SVG, 'svg');
  motif.setAttribute('class', 'motif-acces');
  motif.setAttribute('aria-hidden', 'true'); // purement décoratif
  motif.setAttribute('focusable', 'false');
  zoneMotif.prepend(motif);

  // Un nombre entre 0 et 1, toujours le même pour les mêmes numéros.
  function hasard(a, b, c) {
    const x = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
    return x - Math.floor(x);
  }
  const seTouchent = (a, b) => a.x < b.x + b.l && a.x + a.l > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  function dessinerMotif() {
    const cadre = zoneMotif.getBoundingClientRect();
    const largeur = Math.round(cadre.width);
    const hauteur = Math.round(zoneMotif.scrollHeight);
    const rectangle = (element, marge) => {
      const r = element.getBoundingClientRect();
      return { x: r.left - cadre.left - marge, y: r.top - cadre.top - marge, l: r.width + marge * 2, h: r.height + marge * 2 };
    };
    const petit = telephone.matches;
    const places = []; // { x, y, taille, angle, numero }
    let interdits;
    let pas; let tailleMin; let tailleMax;

    if (petit) {
      // Téléphone : rien sur le panneau vert, rien derrière le formulaire. Le motif vit sous le formulaire…
      const formulaire = carte.querySelector(`.acces-formulaire[data-pour="${carte.dataset.vue}"]`);
      const lame = carte.querySelector('.lame-message:not([inert])') || carte;
      const basLame = lame.getBoundingClientRect().bottom - cadre.top + 44; // la diagonale et son liseré descendent un peu plus bas
      interdits = [{ x: 0, y: 0, l: largeur, h: basLame }, rectangle(formulaire, 3)];
      [pas, tailleMin, tailleMax] = [58, 20, 28];
      // … et dans les deux marges, de chaque côté des champs (20 px, dans une marge de 24 px).
      for (let n = 0, y = basLame + 14; y < hauteur - 24; n += 1, y += 86) {
        const aGauche = n % 2 === 0;
        places.push({ x: aGauche ? 2 : largeur - 22, y: y + hasard(n, 5, 1) * 30, taille: 20, angle: hasard(n, 5, 2) * 30 - 15, numero: n * 3 + 1, graine: [n, 91], marge: true });
      }
    } else {
      // Ordinateur et tablette : tout le fond, sauf la carte (avec une marge autour).
      interdits = [rectangle(carte, 22)];
      [pas, tailleMin, tailleMax] = [104, 24, 40];
    }

    for (let j = 0; j * pas < hauteur; j += 1) {
      for (let i = 0; i * pas < largeur; i += 1) {
        const taille = Math.round(tailleMin + hasard(i, j, 1) * (tailleMax - tailleMin));
        const place = {
          x: i * pas + 6 + hasard(i, j, 2) * (pas - taille - 12),
          y: j * pas + 6 + hasard(i, j, 3) * (pas - taille - 12),
          taille,
          angle: hasard(i, j, 4) * 30 - 15, // entre -15° et +15°
          numero: i * 5 + j * 3 + (j % 2) * 7,
          graine: [i, j],
        };
        // La place est testée un peu plus grande que le dessin : une fois tourné, il déborde légèrement de son carré.
        // Sur téléphone on garde en plus la place de ses mouvements (vent et inclinaison) : il ne doit jamais
        // glisser sous un champ, même un instant.
        const jeu = petit ? 16 : 4;
        const emprise = { x: place.x - jeu, y: place.y - jeu, l: taille + jeu * 2, h: taille + jeu * 2 };
        const dehors = emprise.x < 0 || emprise.y < 0 || emprise.x + emprise.l > largeur || emprise.y + emprise.h > hauteur;
        // Ni sur une zone interdite, ni sur un dessin déjà posé (ceux des marges, sur téléphone).
        const surUnAutre = places.some((autre) => seTouchent(emprise, { x: autre.x, y: autre.y, l: autre.taille, h: autre.taille }));
        if (!dehors && !surUnAutre && !interdits.some((zone) => seTouchent(emprise, zone))) places.push(place);
      }
    }

    motif.setAttribute('width', largeur);
    motif.setAttribute('height', hauteur);
    motif.setAttribute('viewBox', `0 0 ${largeur} ${hauteur}`);
    // Chaque dessin est fait de quatre éléments emboîtés, un par mouvement, pour qu'ils s'additionnent sans se gêner :
    //   <g position> → <g profondeur> → <g vent> → <use dessin, tourné>
    motif.replaceChildren(...places.map((place, rang) => {
      const dessin = document.createElementNS(SVG, 'use');
      dessin.setAttribute('href', `/icons/motif-acces.svg#${DESSINS[place.numero % DESSINS.length]}`);
      dessin.setAttribute('width', place.taille);
      dessin.setAttribute('height', place.taille);
      dessin.setAttribute('transform', `rotate(${place.angle.toFixed(1)} ${place.taille / 2} ${place.taille / 2})`);
      // Les dessins sont tracés dans un carré de 24 : pour un trait de 1,5 px à l'écran, on compense l'agrandissement.
      dessin.setAttribute('stroke-width', ((1.5 * 24) / place.taille).toFixed(2));

      // Le vent : tous les dessins flottent, mais jamais ensemble. Le « hasard » de la case choisit une des 3 danses,
      // une des 9 durées (6 à 14 s) et un des 8 décalages de départ : 216 combinaisons (classes du CSS).
      const [a, b] = place.graine;
      const vent = document.createElementNS(SVG, 'g');
      // Dans les marges du téléphone, il n'y a que 2 px entre le dessin et les champs : il ne bouge que de haut en bas.
      vent.setAttribute('class', `vent vent-${place.marge ? 3 : Math.floor(hasard(a, b, 5) * 3)} duree-${Math.floor(hasard(a, b, 6) * 9)} retard-${Math.floor(hasard(a, b, 7) * 8)}`);
      vent.append(dessin);

      // La profondeur : plus un dessin est grand, plus il paraît proche, et plus il se décale quand la souris bouge
      // (5 niveaux, de 4 px pour les plus petits à 12 px pour les plus grands).
      const profondeur = document.createElementNS(SVG, 'g');
      const niveau = Math.max(0, Math.min(4, Math.round(((place.taille - tailleMin) / (tailleMax - tailleMin)) * 4)));
      if (!place.marge) profondeur.setAttribute('class', `profondeur profondeur-${niveau}`);
      profondeur.append(vent);

      const groupe = document.createElementNS(SVG, 'g');
      groupe.setAttribute('class', rang % 2 ? 'motif-terre' : 'motif-feuille'); // alternance des deux couleurs du logo
      groupe.setAttribute('transform', `translate(${place.x.toFixed(1)} ${place.y.toFixed(1)})`);
      groupe.append(profondeur);
      return groupe;
    }));
  }
  // La fenêtre change de taille, le téléphone tourne : on redessine, une seule fois par image affichée.
  let redessin = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(redessin);
    redessin = requestAnimationFrame(dessinerMotif);
  }).observe(zoneMotif);

  // ---------- Profondeur : le motif réagit à la souris (ordinateur) ou à l'inclinaison (téléphone) ----------
  // On ne déplace pas les dessins un par un : on écrit seulement deux nombres entre -1 et 1 (--px et --py) sur le
  // motif, et le CSS décale chaque niveau de profondeur en proportion, dans le sens opposé au pointeur.
  // Les nombres se rapprochent de leur cible un peu à chaque image (requestAnimationFrame) : le mouvement est doux,
  // et la boucle s'arrête d'elle-même dès qu'il n'y a plus rien à bouger.
  const cible = { x: 0, y: 0 };
  const position = { x: 0, y: 0 };
  let boucle = 0;
  function avancer() {
    position.x += (cible.x - position.x) * 0.08;
    position.y += (cible.y - position.y) * 0.08;
    motif.style.setProperty('--px', position.x.toFixed(3));
    motif.style.setProperty('--py', position.y.toFixed(3));
    const arrive = Math.abs(cible.x - position.x) < 0.002 && Math.abs(cible.y - position.y) < 0.002;
    boucle = arrive ? 0 : requestAnimationFrame(avancer);
  }
  function viser(x, y) {
    cible.x = Math.max(-1, Math.min(1, x));
    cible.y = Math.max(-1, Math.min(1, y));
    if (!boucle) boucle = requestAnimationFrame(avancer);
  }
  const surSouris = (evenement) => {
    if (evenement.pointerType !== 'mouse') return;
    viser((evenement.clientX / window.innerWidth) * 2 - 1, (evenement.clientY / window.innerHeight) * 2 - 1);
  };
  const sourisPartie = () => viser(0, 0); // la souris quitte la page : retour doux au centre
  // gamma : inclinaison gauche-droite ; beta : avant-arrière (un téléphone se tient penché d'environ 45°).
  const surInclinaison = (evenement) => {
    if (evenement.gamma === null || evenement.beta === null) return;
    viser(evenement.gamma / 30, (evenement.beta - 45) / 30);
  };
  // On se contente d'écouter, sans jamais demander d'autorisation : sur les téléphones qui en exigent une (iPhone),
  // le navigateur n'envoie simplement aucune inclinaison, et il reste le flottement seul.
  const inclinaisonLibre = 'DeviceOrientationEvent' in window;

  // On n'écoute que si la page est visible et si la personne n'a pas demandé moins de mouvement.
  // Onglet caché : plus d'écoute, plus de boucle, et le flottement est mis en pause (classe .en-pause).
  function reglerEcoute() {
    const actif = !document.hidden && !moinsDeMouvement.matches;
    motif.classList.toggle('en-pause', document.hidden);
    window.removeEventListener('pointermove', surSouris);
    document.documentElement.removeEventListener('pointerleave', sourisPartie);
    window.removeEventListener('deviceorientation', surInclinaison);
    if (!actif) {
      cancelAnimationFrame(boucle);
      boucle = 0;
      return;
    }
    window.addEventListener('pointermove', surSouris, { passive: true });
    document.documentElement.addEventListener('pointerleave', sourisPartie);
    if (inclinaisonLibre && telephone.matches) window.addEventListener('deviceorientation', surInclinaison, { passive: true });
  }
  document.addEventListener('visibilitychange', reglerEcoute);
  moinsDeMouvement.addEventListener('change', reglerEcoute);
  reglerEcoute();

  // Petite surprise : connexion ou inscription réussie, les dessins s'envolent (20 px vers le haut, effacés en 400 ms)
  // juste avant le changement de page. formulaires.js attend cette promesse avant de changer d'adresse.
  window.Palabre.celebrerAcces = () => {
    if (moinsDeMouvement.matches) return Promise.resolve(); // aucun mouvement demandé : on part tout de suite
    motif.classList.add('envol');
    return attendre(400);
  };

  function focusPremierChamp() {
    const premier = carte.querySelector(`.acces-formulaire[data-pour="${carte.dataset.vue}"] :is(input, select):not([type="radio"]:not(:checked))`);
    if (premier) premier.focus();
  }

  // Le passage d'un formulaire à l'autre, en trois temps :
  //  1. la lame verte s'étend jusqu'à couvrir toute la carte (data-etat="couvre") ;
  //  2. bien cachés dessous, les formulaires s'échangent ;
  //  3. la lame se retire de l'autre côté (le CSS lit data-vue pour savoir où elle se range).
  // Le CSS n'anime que clip-path : le navigateur n'a rien à recalculer, cela reste fluide sur un petit téléphone.
  async function aller(vue) {
    if (enCours || vue === carte.dataset.vue) return;
    enCours = true;

    if (moinsDeMouvement.matches) {
      // Animations réduites demandées : pas de balayage, un simple fondu.
      montrer(vue);
      carte.classList.add('fondu');
      await attendre(250);
      carte.classList.remove('fondu');
    } else {
      if (telephone.matches) {
        // Sur téléphone, la lame est en haut de la page. Pendant l'animation elle est fixée à l'écran,
        // pour le couvrir même si on avait fait défiler le formulaire. Si elle n'était plus visible,
        // elle repart de zéro (repliée tout en haut) au lieu d'apparaître d'un coup.
        if (window.scrollY > 0) {
          carte.classList.add('sans-transition');
          carte.dataset.etat = 'replie';
        }
        carte.classList.add('lame-fixe');
        void carte.offsetWidth; // le navigateur prend en compte l'état de départ avant d'animer
        carte.classList.remove('sans-transition');
      }
      carte.dataset.etat = 'couvre';
      await attendre(DEMI_DUREE);
      montrer(vue);
      if (telephone.matches) window.scrollTo(0, 0); // invisible : l'écran est entièrement vert à cet instant
      carte.classList.remove('lame-fixe');
      delete carte.dataset.etat;
      await attendre(DEMI_DUREE);
    }

    enCours = false;
    focusPremierChamp();
    // Le bouton retour a pu être touché pendant l'animation : on rattrape l'adresse.
    if (vueDeLAdresse() !== carte.dataset.vue) aller(vueDeLAdresse());
  }

  // « Créer un compte » / « J'ai déjà un compte » : on change l'adresse sans recharger la page (pushState).
  // Les paramètres (?suite=…, ?type=…) suivent : formulaires.js les lira au moment de l'envoi.
  carte.querySelectorAll('[data-aller]').forEach((lien) => {
    lien.addEventListener('click', (evenement) => {
      if (evenement.ctrlKey || evenement.metaKey || evenement.shiftKey) return; // ouverture dans un nouvel onglet
      evenement.preventDefault();
      if (enCours) return;
      window.history.pushState(null, '', `/${lien.dataset.aller}${window.location.search}`);
      aller(lien.dataset.aller);
    });
  });
  // Bouton retour (ou avance) du téléphone : l'adresse a changé, la page suit.
  window.addEventListener('popstate', () => aller(vueDeLAdresse()));

  // ---------- Bouton œil : afficher ou masquer le mot de passe ----------
  carte.querySelectorAll('[data-oeil]').forEach((bouton) => {
    const champ = bouton.parentElement.querySelector('input');
    bouton.addEventListener('click', () => {
      const visible = champ.type === 'password';
      champ.type = visible ? 'text' : 'password';
      bouton.setAttribute('aria-pressed', String(visible));
      bouton.setAttribute('aria-label', visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
      bouton.querySelector('use').setAttribute('href', `/icons/icones.svg#${visible ? 'oeil-barre' : 'oeil'}`);
    });
  });

  // ---------- Indicateur de force du mot de passe ----------
  // Volontairement simple : la longueur compte le plus, la variété des caractères ensuite.
  // C'est un conseil ; la vraie règle (8 caractères minimum) est vérifiée par le serveur.
  function force(motDePasse) {
    if (motDePasse.length < 8) return 0;
    const sortes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z0-9]/].filter((sorte) => sorte.test(motDePasse)).length;
    if (motDePasse.length >= 12 && sortes >= 3) return 3;
    if (motDePasse.length >= 10 || sortes >= 3) return 2;
    return 1;
  }
  const NOMS_FORCE = ['Trop court : 8 caractères minimum.', 'Faible : ajoute des chiffres ou allonge-le.', 'Correct.', 'Solide.'];
  carte.querySelectorAll('[data-mesurer-force]').forEach((champ) => {
    const zone = champ.closest('.champ').querySelector('[data-force]');
    champ.addEventListener('input', () => {
      const niveau = force(champ.value);
      zone.dataset.niveau = champ.value ? String(niveau) : '';
      zone.querySelector('[data-force-texte]').textContent = champ.value ? NOMS_FORCE[niveau] : '8 caractères minimum.';
    });
  });

  montrer(carte.dataset.vue);
})();
