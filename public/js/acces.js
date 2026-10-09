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
  }

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
