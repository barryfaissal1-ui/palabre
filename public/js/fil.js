// Fil d'actualité : zone « Publier », rangée « Disponibles maintenant », puis les publications par 10.
// La carte d'une publication (j'aime, commentaires…) est dans publication.js.
(function () {
  const { api, el, avatar, prenom, utilisateurConnecte, reduireImage, icone, etatVide, toast, filPublications, cartePublication } = window.Palabre;

  let filtre = 'tout';     // 'tout' ou 'amis'
  let imageChoisie = null; // image réduite, prête à être envoyée (data URL)
  let fil = null;

  // ---------- « Disponibles maintenant » ----------
  // Les devs prêts à travailler, amis d'abord (le tri est fait par le serveur). Personne de disponible : pas de rangée.
  async function afficherDisponibles() {
    const section = document.querySelector('[data-disponibles]');
    try {
      const { devs } = await api('/devs/disponibles');
      if (devs.length === 0) return;
      section.querySelector('[data-rangee]').replaceChildren(...devs.map((dev) => el('li', {}, [
        el('a', { classe: 'dev-disponible', href: `/${dev.identifiant}`, 'aria-label': `Profil de ${dev.nom}` }, [
          avatar(dev, 'rangee'),
          el('span', { classe: 'dev-prenom', texte: prenom(dev) }),
        ]),
      ])));
      section.hidden = false;
    } catch { /* la rangée est un plus : sans elle, le fil reste utilisable */ }
  }

  // ---------- Zone « Publier » ----------
  function brancherPublier(moi) {
    const formulaire = document.querySelector('[data-publier]');
    const zoneMessage = formulaire.querySelector('[data-message]');
    const zoneErreur = formulaire.querySelector('[data-erreur="texte"]');
    const apercu = formulaire.querySelector('[data-apercu]');
    const choisir = formulaire.querySelector('[data-choisir-image]');
    const bouton = formulaire.querySelector('button[type="submit"]');
    const champ = formulaire.elements.texte;
    formulaire.querySelector('[data-mon-avatar]').replaceChildren(avatar(moi, 'moyen'));
    champ.placeholder = `Quoi de neuf, ${prenom(moi)} ?`;

    // Le champ compact s'agrandit dès qu'on touche dedans, qu'on y arrive au clavier ou qu'on y écrit.
    const ouvrir = () => formulaire.classList.add('ouvert');
    ['focus', 'click', 'input'].forEach((evenement) => champ.addEventListener(evenement, ouvrir));

    // Raccourcis « Question » et « Projet » : ils préchoisissent le type et ouvrent la zone.
    formulaire.querySelectorAll('[data-raccourci]').forEach((raccourci) => {
      raccourci.addEventListener('click', () => {
        formulaire.elements.type.value = raccourci.dataset.raccourci;
        ouvrir();
        champ.focus();
      });
    });

    function message(texte, type) {
      zoneMessage.textContent = texte;
      zoneMessage.className = `message ${type || ''}`;
    }

    function retirerImage() {
      imageChoisie = null;
      apercu.hidden = true;
      formulaire.querySelector('[data-apercu-image]').removeAttribute('src');
    }

    choisir.addEventListener('change', async () => {
      const fichier = choisir.files[0];
      choisir.value = '';
      if (!fichier) return;
      ouvrir();
      message('Préparation de l\'image…', '');
      try {
        imageChoisie = await reduireImage(fichier);
        formulaire.querySelector('[data-apercu-image]').src = imageChoisie;
        apercu.hidden = false;
        message('', '');
      } catch (erreur) {
        retirerImage();
        message(erreur.message, 'erreur');
      }
    });
    formulaire.querySelector('[data-retirer-image]').addEventListener('click', retirerImage);

    formulaire.addEventListener('submit', async (evenement) => {
      evenement.preventDefault();
      zoneErreur.textContent = '';
      message('', '');
      if (!champ.value.trim()) {
        zoneErreur.textContent = 'Écris quelque chose avant de publier.';
        champ.focus();
        return;
      }
      bouton.disabled = true;
      try {
        const donnees = { type: formulaire.elements.type.value, texte: champ.value };
        if (imageChoisie) donnees.image = imageChoisie;
        const { publication } = await api('/publications', { methode: 'POST', donnees });
        champ.value = '';
        formulaire.elements.type.value = 'idee';
        retirerImage();
        fil.ajouterEnTete(publication);
        // La zone se replie, prête pour la prochaine publication.
        document.activeElement.blur();
        formulaire.classList.remove('ouvert');
        toast('Publié !');
      } catch (erreur) {
        if (erreur.champ === 'texte') zoneErreur.textContent = erreur.message;
        else message(erreur.message, 'erreur');
      } finally {
        bouton.disabled = false;
      }
    });
  }

  // Lien copié depuis le menu « … » d'une publication : /fil?publication=12 n'affiche que celle-là.
  async function afficherUneSeule(id) {
    const zone = document.querySelector('[data-fil]');
    const etat = document.querySelector('[data-etat-fil]');
    document.querySelector('.filtres-fil').hidden = true;
    const toutLeFil = el('a', { classe: 'bouton bouton-contour bouton-plein charger-plus', href: '/fil', texte: 'Voir tout le fil' });
    try {
      const { publication } = await api(`/publications/${encodeURIComponent(id)}`);
      zone.replaceChildren(cartePublication(publication));
      zone.after(toutLeFil);
    } catch (erreur) {
      etat.replaceChildren(etatVide('calme', 'Publication introuvable', erreur.statut === 404 ? 'Elle a peut-être été supprimée.' : erreur.message, toutLeFil));
      etat.hidden = false;
    }
  }

  function brancherFiltres() {
    const boutons = document.querySelectorAll('[data-filtre]');
    boutons.forEach((bouton) => {
      bouton.addEventListener('click', () => {
        if (filtre === bouton.dataset.filtre) return;
        filtre = bouton.dataset.filtre;
        boutons.forEach((b) => b.setAttribute('aria-pressed', String(b === bouton)));
        fil.charger({ depuisLeDebut: true });
      });
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const moi = await utilisateurConnecte();
    if (!moi) {
      window.location.href = `/connexion?suite=${encodeURIComponent(window.location.pathname + window.location.search)}`;
      return;
    }
    fil = filPublications({
      zone: document.querySelector('[data-fil]'),
      etat: document.querySelector('[data-etat-fil]'),
      boutonPlus: document.querySelector('[data-charger-plus]'),
      parametres: () => (filtre === 'amis' ? { amis: '1' } : {}),
      vide: () => (filtre === 'amis'
        ? etatVide('amis', 'Tes amis n\'ont encore rien publié', 'Ajoute des amis depuis leur profil pour retrouver leurs publications ici.',
          el('a', { classe: 'bouton bouton-principal', href: '/chercher' }, [icone('recherche'), 'Trouver des développeurs']))
        : etatVide('palabre', 'Lance la palabre !', 'Personne n\'a encore publié. Partage une idée, pose une question ou montre un projet.')),
    });
    brancherPublier(moi);
    brancherFiltres();
    const seule = new URLSearchParams(window.location.search).get('publication');
    if (seule) {
      afficherUneSeule(seule);
      return;
    }
    afficherDisponibles();
    fil.charger({ depuisLeDebut: true });
  });
})();
