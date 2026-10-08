// Fil d'actualité : publier, lire par 10, aimer, commenter, signaler, supprimer.
(function () {
  const { api, el, avatar, utilisateurConnecte, dateRelative, reduireImage, signaler, icone, etatVide, chargement, toast, confirmer } = window.Palabre;

  // Chaque type a son nom et son icône ; sa couleur est dans le CSS (.badge-idee, .badge-question, .badge-projet).
  const TYPES = {
    idee: { nom: 'Idée', icone: 'idee' },
    question: { nom: 'Question', icone: 'question' },
    projet: { nom: 'Projet', icone: 'projet' },
  };

  let filtre = 'tout';   // 'tout' ou 'amis'
  let suivant = null;    // numéro à partir duquel charger la page suivante
  let imageChoisie = null; // image réduite, prête à être envoyée (data URL)

  function lienAuteur(auteur, taille) {
    return el('a', { classe: 'lien-avatar', href: `/${auteur.identifiant}`, 'aria-label': `Profil de ${auteur.nom}` }, [avatar(auteur, taille)]);
  }

  // Bouton d'action d'une publication : une icône, un compteur éventuel, et un nom pour les lecteurs d'écran.
  function boutonAction(nomIcone, nom, classe = '') {
    const compteur = el('span', { classe: 'compteur-action' });
    const bouton = el('button', { classe: `bouton-action ${classe}`.trim(), type: 'button', 'aria-label': nom, title: nom }, [icone(nomIcone), compteur]);
    // Affiche le nombre (rien pour zéro) ; « anime » le fait glisser quand il change.
    bouton.compter = (nombre, anime = false) => {
      compteur.textContent = nombre ? String(nombre) : '';
      bouton.setAttribute('aria-label', nombre ? `${nom} (${nombre})` : nom);
      if (anime) {
        compteur.classList.remove('change');
        void compteur.offsetWidth; // force le navigateur à rejouer l'animation
        compteur.classList.add('change');
      }
    };
    return bouton;
  }

  // ---------- Commentaires ----------
  function elementCommentaire(commentaire, publication, apresSuppression) {
    const action = el('button', { classe: 'bouton-discret', type: 'button', texte: commentaire.estMoi ? 'Supprimer' : 'Signaler' });
    const element = el('li', { classe: 'commentaire' }, [
      lienAuteur(commentaire.auteur, 'mini'),
      el('div', { classe: 'commentaire-corps' }, [
        el('p', { classe: 'commentaire-entete' }, [
          el('a', { classe: 'nom-auteur', href: `/${commentaire.auteur.identifiant}`, texte: commentaire.auteur.nom }),
          el('span', { classe: 'texte-discret', texte: ` · ${dateRelative(commentaire.creeLe)}` }),
        ]),
        el('p', { classe: 'commentaire-texte', texte: commentaire.texte }),
        action,
      ]),
    ]);
    action.addEventListener('click', async () => {
      if (!commentaire.estMoi) return signaler('commentaire', commentaire.id);
      if (!(await confirmer('Supprimer ce commentaire ?', { bouton: 'Supprimer', danger: true }))) return;
      try {
        await api(`/publications/${publication.id}/commentaires/${commentaire.id}`, { methode: 'DELETE', donnees: {} });
        element.remove();
        apresSuppression();
        toast('Commentaire supprimé.');
      } catch (erreur) {
        toast(erreur.message, 'erreur');
      }
    });
    return element;
  }

  function zoneCommentaires(publication, boutonCommenter) {
    const liste = el('ul', { classe: 'liste-commentaires' });
    const champ = el('input', { type: 'text', maxlength: '1000', placeholder: 'Écrire un commentaire…', 'aria-label': 'Écrire un commentaire', required: true });
    const envoyer = el('button', { classe: 'bouton bouton-principal', type: 'submit', 'aria-label': 'Envoyer le commentaire', title: 'Envoyer' }, [icone('envoyer')]);
    const zoneErreur = el('p', { classe: 'erreur-champ', role: 'alert' });
    const formulaire = el('form', { classe: 'form-commentaire' }, [champ, envoyer]);
    const zone = el('div', { classe: 'commentaires', hidden: true }, [liste, formulaire, zoneErreur]);
    let charge = false;

    function compter(variation) {
      publication.nbCommentaires += variation;
      boutonCommenter.compter(publication.nbCommentaires, true);
    }

    async function ouvrir() {
      zone.hidden = !zone.hidden;
      boutonCommenter.setAttribute('aria-expanded', String(!zone.hidden));
      if (zone.hidden || charge) return;
      const fini = chargement(liste, Math.min(publication.nbCommentaires, 2));
      try {
        const { commentaires } = await api(`/publications/${publication.id}/commentaires`);
        fini();
        liste.replaceChildren(...commentaires.map((c) => elementCommentaire(c, publication, () => compter(-1))));
        charge = true;
        champ.focus();
      } catch (erreur) {
        fini();
        zoneErreur.textContent = erreur.message;
      }
    }

    formulaire.addEventListener('submit', async (evenement) => {
      evenement.preventDefault();
      zoneErreur.textContent = '';
      if (!champ.value.trim()) return;
      envoyer.disabled = true;
      try {
        const { commentaire } = await api(`/publications/${publication.id}/commentaires`, { methode: 'POST', donnees: { texte: champ.value } });
        liste.append(elementCommentaire(commentaire, publication, () => compter(-1)));
        champ.value = '';
        compter(1);
      } catch (erreur) {
        zoneErreur.textContent = erreur.message;
      } finally {
        envoyer.disabled = false;
      }
    });

    return { zone, ouvrir };
  }

  // ---------- Une publication ----------
  function cartePublication(publication) {
    const type = TYPES[publication.type];
    const boutonJaime = boutonAction('coeur', 'J\'aime', 'bouton-jaime');
    const boutonCommenter = boutonAction('commentaire', 'Commenter');
    boutonCommenter.setAttribute('aria-expanded', 'false');
    const boutonAutre = publication.estMoi
      ? boutonAction('supprimer', 'Supprimer', 'bouton-action-fin')
      : boutonAction('signaler', 'Signaler', 'bouton-action-fin');
    const commentaires = zoneCommentaires(publication, boutonCommenter);

    function afficherJaime(anime = false) {
      boutonJaime.compter(publication.nbJaime, anime);
      boutonJaime.setAttribute('aria-pressed', String(publication.jaimeParMoi));
    }
    afficherJaime();
    boutonCommenter.compter(publication.nbCommentaires);

    const carte = el('article', { classe: `carte-publication publication-${publication.type}` }, [
      el('header', { classe: 'publication-entete' }, [
        lienAuteur(publication.auteur, 'moyen'),
        el('div', {}, [
          el('a', { classe: 'nom-auteur', href: `/${publication.auteur.identifiant}`, texte: publication.auteur.nom }),
          el('p', { classe: 'publication-meta texte-discret', texte: dateRelative(publication.creeLe) }),
        ]),
        el('span', { classe: `badge-type badge-${publication.type}` }, [icone(type.icone), type.nom]),
      ]),
      el('p', { classe: 'publication-texte', texte: publication.texte }),
      publication.image ? el('img', { classe: 'publication-image', src: publication.image, alt: 'Image jointe à la publication', loading: 'lazy' }) : null,
      el('div', { classe: 'publication-actions' }, [boutonJaime, boutonCommenter, boutonAutre]),
      commentaires.zone,
    ]);

    boutonJaime.addEventListener('click', async () => {
      // L'affichage change tout de suite (le cœur se remplit et fait son « pop »), sans attendre le serveur :
      // sur une connexion lente, l'appli paraît quand même instantanée. En cas d'échec, on revient en arrière.
      const avant = { nbJaime: publication.nbJaime, jaimeParMoi: publication.jaimeParMoi };
      publication.jaimeParMoi = !avant.jaimeParMoi;
      publication.nbJaime = avant.nbJaime + (publication.jaimeParMoi ? 1 : -1);
      boutonJaime.classList.toggle('vient-d-aimer', publication.jaimeParMoi);
      afficherJaime(true);
      boutonJaime.disabled = true;
      try {
        const reponse = await api(`/publications/${publication.id}/jaime`, { methode: publication.jaimeParMoi ? 'POST' : 'DELETE', donnees: {} });
        Object.assign(publication, reponse); // le vrai compteur, au cas où d'autres ont aimé entre-temps
        afficherJaime();
      } catch (erreur) {
        Object.assign(publication, avant);
        boutonJaime.classList.remove('vient-d-aimer');
        afficherJaime();
        toast(erreur.message, 'erreur');
      } finally {
        boutonJaime.disabled = false;
      }
    });

    boutonCommenter.addEventListener('click', commentaires.ouvrir);

    boutonAutre.addEventListener('click', async () => {
      if (!publication.estMoi) return signaler('publication', publication.id);
      if (!(await confirmer('Supprimer cette publication ? Ses commentaires et ses j\'aime partiront avec.', { bouton: 'Supprimer', danger: true }))) return;
      try {
        await api(`/publications/${publication.id}`, { methode: 'DELETE', donnees: {} });
        carte.remove();
        toast('Publication supprimée.');
      } catch (erreur) {
        toast(erreur.message, 'erreur');
      }
    });

    return carte;
  }

  // ---------- Chargement du fil, 10 par 10 ----------
  async function chargerPage({ depuisLeDebut = false } = {}) {
    const fil = document.querySelector('[data-fil]');
    const etat = document.querySelector('[data-etat-fil]');
    const boutonPlus = document.querySelector('[data-charger-plus]');
    if (depuisLeDebut) {
      suivant = null;
      fil.replaceChildren();
    }
    boutonPlus.hidden = true;
    etat.hidden = true;
    const fini = chargement(fil, depuisLeDebut ? 3 : 1); // squelettes à la place du vide

    const parametres = new URLSearchParams();
    if (suivant) parametres.set('avant', suivant);
    if (filtre === 'amis') parametres.set('amis', '1');
    const filtreDemande = filtre;
    try {
      const reponse = await api(`/publications?${parametres}`);
      fini();
      if (filtreDemande !== filtre) return; // la personne a changé d'onglet pendant le chargement
      fil.append(...reponse.publications.map(cartePublication));
      suivant = reponse.suivant;
      boutonPlus.hidden = !suivant;
      if (fil.children.length === 0) {
        etat.replaceChildren(filtre === 'amis'
          ? etatVide('amis', 'Tes amis n\'ont encore rien publié', 'Ajoute des amis depuis leur profil pour retrouver leurs publications ici.',
            el('a', { classe: 'bouton bouton-principal', href: '/chercher', texte: 'Trouver des développeurs' }))
          : etatVide('palabre', 'Lance la palabre !', 'Personne n\'a encore publié. Partage une idée, pose une question ou montre un projet.'));
        etat.hidden = false;
      }
    } catch (erreur) {
      fini();
      etat.replaceChildren(etatVide('calme', 'Le fil ne charge pas', erreur.message));
      etat.hidden = fil.children.length > 0;
      if (fil.children.length > 0) toast(erreur.message, 'erreur');
      boutonPlus.hidden = !suivant;
    }
  }

  // ---------- Zone « Publier » ----------
  function brancherPublier(moi) {
    const formulaire = document.querySelector('[data-publier]');
    const zoneMessage = formulaire.querySelector('[data-message]');
    const zoneErreur = formulaire.querySelector('[data-erreur="texte"]');
    const apercu = formulaire.querySelector('[data-apercu]');
    const choisir = formulaire.querySelector('[data-choisir-image]');
    const bouton = formulaire.querySelector('button[type="submit"]');
    formulaire.querySelector('[data-mon-avatar]').replaceChildren(avatar(moi, 'moyen'));
    formulaire.elements.texte.placeholder = `Quoi de neuf, ${moi.nom.split(' ')[0]} ?`;

    // Le champ compact s'agrandit dès qu'on touche dedans, qu'on y arrive au clavier ou qu'on y écrit.
    ['focusin', 'click', 'input'].forEach((evenement) => {
      formulaire.addEventListener(evenement, () => formulaire.classList.add('ouvert'));
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
      formulaire.classList.add('ouvert');
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
      const texte = formulaire.elements.texte.value;
      if (!texte.trim()) {
        zoneErreur.textContent = 'Écris quelque chose avant de publier.';
        formulaire.elements.texte.focus();
        return;
      }
      bouton.disabled = true;
      try {
        const donnees = { type: formulaire.elements.type.value, texte };
        if (imageChoisie) donnees.image = imageChoisie;
        const { publication } = await api('/publications', { methode: 'POST', donnees });
        formulaire.elements.texte.value = '';
        retirerImage();
        document.querySelector('[data-fil]').prepend(cartePublication(publication));
        document.querySelector('[data-etat-fil]').hidden = true;
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

  function brancherFiltres() {
    const boutons = document.querySelectorAll('[data-filtre]');
    boutons.forEach((bouton) => {
      bouton.addEventListener('click', () => {
        if (filtre === bouton.dataset.filtre) return;
        filtre = bouton.dataset.filtre;
        boutons.forEach((b) => b.setAttribute('aria-pressed', String(b === bouton)));
        chargerPage({ depuisLeDebut: true });
      });
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const moi = await utilisateurConnecte();
    if (!moi) {
      window.location.href = '/connexion?suite=/fil';
      return;
    }
    brancherPublier(moi);
    brancherFiltres();
    document.querySelector('[data-charger-plus]').addEventListener('click', () => chargerPage());
    chargerPage({ depuisLeDebut: true });
  });
})();
