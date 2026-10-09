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
  const NB_FLOTTANTS = 6;
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
        places.push({ x: aGauche ? 2 : largeur - 22, y: y + hasard(n, 5, 1) * 30, taille: 20, angle: hasard(n, 5, 2) * 30 - 15, numero: n * 3 + 1 });
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
        };
        // La place est testée un peu plus grande que le dessin : une fois tourné, il déborde légèrement de son carré.
        const emprise = { x: place.x - 4, y: place.y - 4, l: taille + 8, h: taille + 8 };
        const dehors = emprise.x < 0 || emprise.y < 0 || emprise.x + emprise.l > largeur || emprise.y + emprise.h > hauteur;
        // Ni sur une zone interdite, ni sur un dessin déjà posé (ceux des marges, sur téléphone).
        const surUnAutre = places.some((autre) => seTouchent(emprise, { x: autre.x, y: autre.y, l: autre.taille, h: autre.taille }));
        if (!dehors && !surUnAutre && !interdits.some((zone) => seTouchent(emprise, zone))) places.push(place);
      }
    }

    // Quelques dessins seulement flottent, pris à intervalles réguliers pour être répartis sur toute la page.
    const ecart = Math.max(1, Math.floor(places.length / NB_FLOTTANTS));
    motif.setAttribute('width', largeur);
    motif.setAttribute('height', hauteur);
    motif.setAttribute('viewBox', `0 0 ${largeur} ${hauteur}`);
    motif.replaceChildren(...places.map((place, rang) => {
      const dessin = document.createElementNS(SVG, 'use');
      dessin.setAttribute('href', `/icons/motif-acces.svg#${DESSINS[place.numero % DESSINS.length]}`);
      dessin.setAttribute('width', place.taille);
      dessin.setAttribute('height', place.taille);
      dessin.setAttribute('transform', `rotate(${place.angle.toFixed(1)} ${place.taille / 2} ${place.taille / 2})`);
      // Les dessins sont tracés dans un carré de 24 : pour un trait de 1,5 px à l'écran, on compense l'agrandissement.
      dessin.setAttribute('stroke-width', ((1.5 * 24) / place.taille).toFixed(2));
      const flottant = rang % ecart === Math.floor(ecart / 2) && Math.floor(rang / ecart) < NB_FLOTTANTS;
      const balancier = document.createElementNS(SVG, 'g'); // c'est lui que le CSS fait monter et descendre
      if (flottant) balancier.setAttribute('class', `flotte flotte-${Math.floor(rang / ecart) % 6}`);
      balancier.append(dessin);
      const groupe = document.createElementNS(SVG, 'g');
      groupe.setAttribute('class', rang % 2 ? 'motif-terre' : 'motif-feuille'); // alternance des deux couleurs du logo
      groupe.setAttribute('transform', `translate(${place.x.toFixed(1)} ${place.y.toFixed(1)})`);
      groupe.append(balancier);
      return groupe;
    }));
  }
  // La fenêtre change de taille, le téléphone tourne : on redessine, une seule fois par image affichée.
  let redessin = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(redessin);
    redessin = requestAnimationFrame(dessinerMotif);
  }).observe(zoneMotif);

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
