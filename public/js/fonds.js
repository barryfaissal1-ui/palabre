// Photos de fond (haut de l'accueil, panneau vert de la connexion) : un fondu lent d'une photo à l'autre.
//
// Pensé pour la 3G :
//  - la page n'arrive qu'avec UNE photo (écrite dans le HTML par le serveur, src/routes/pages.js) ;
//  - les autres ne sont demandées qu'une fois la page entièrement chargée, une seule à la fois,
//    juste avant d'être montrées ;
//  - sur une connexion lente, ou si la personne économise ses données, elles ne sont jamais demandées.
(function () {
  const PAUSE = 8000; // durée d'affichage d'une photo, en millisecondes (le fondu lui-même est dans le CSS)

  // Connexion lente ? Le navigateur le dit parfois lui-même (navigator.connection, surtout sur Android).
  // Sinon, on regarde le temps qu'a pris le chargement de la page : plus de 4 secondes, on n'insiste pas.
  function connexionLente() {
    const reseau = navigator.connection;
    if (reseau) return Boolean(reseau.saveData) || ['slow-2g', '2g', '3g'].includes(reseau.effectiveType);
    return performance.now() > 4000;
  }

  function creerPhoto(photo) {
    const image = document.createElement('img');
    image.alt = ''; // décorative : rien à lire pour un lecteur d'écran
    image.decoding = 'async';
    const webp = document.createElement('source');
    webp.type = 'image/webp';
    webp.srcset = photo.webp;
    const cadre = document.createElement('picture');
    cadre.append(webp, image);
    // Le navigateur choisit le WebP s'il le lit, sinon le JPEG de secours.
    const prete = new Promise((resolve, reject) => {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', reject, { once: true });
    });
    image.src = photo.jpg;
    return { cadre, prete };
  }

  function animer(zone) {
    let suivantes = [];
    try { suivantes = JSON.parse(zone.dataset.suivantes || '[]'); } catch { /* attribut illisible : pas de fondu */ }
    const premiere = zone.querySelector('picture');
    if (!premiere || suivantes.length === 0) return;

    const cadres = [premiere]; // les photos déjà chargées restent dans la page : au deuxième tour, plus aucun téléchargement
    let position = 0;
    let occupe = false;

    async function passerALaSuivante() {
      if (occupe || document.hidden) return; // onglet en arrière-plan : on ne télécharge rien
      occupe = true;
      const prochaine = (position + 1) % (suivantes.length + 1);
      try {
        if (!cadres[prochaine]) {
          const { cadre, prete } = creerPhoto(suivantes[prochaine - 1]);
          zone.append(cadre);
          await prete;
          cadres[prochaine] = cadre;
          void cadre.offsetWidth; // le navigateur note l'état de départ (invisible) avant le fondu
        }
        cadres[prochaine].classList.add('visible');
        cadres[position].classList.remove('visible');
        position = prochaine;
      } catch {
        clearInterval(minuterie); // une photo ne charge pas : on reste sur celle qui est affichée
      }
      occupe = false;
    }
    const minuterie = setInterval(passerALaSuivante, PAUSE);
  }

  window.addEventListener('load', () => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || connexionLente()) return;
    document.querySelectorAll('[data-fond]').forEach(animer);
  });
})();
