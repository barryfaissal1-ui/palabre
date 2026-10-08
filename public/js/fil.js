// Fil d'actualité : publier, lire par 10, aimer, commenter, signaler, supprimer.
(function () {
  const { api, el, avatar, utilisateurConnecte, dateRelative, reduireImage, signaler } = window.Palabre;

  const NOMS_TYPES = { idee: 'Idée', question: 'Question', projet: 'Projet' };

  let filtre = 'tout';   // 'tout' ou 'amis'
  let suivant = null;    // numéro à partir duquel charger la page suivante
  let imageChoisie = null; // image réduite, prête à être envoyée (data URL)

  function pluriel(nombre, mot) {
    return `${nombre} ${mot}${nombre > 1 ? 's' : ''}`;
  }

  function lienAuteur(auteur, taille) {
    return el('a', { classe: 'lien-avatar', href: `/${auteur.identifiant}`, 'aria-label': `Profil de ${auteur.nom}` }, [avatar(auteur, taille)]);
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
      if (!window.confirm('Supprimer ce commentaire ?')) return;
      try {
        await api(`/publications/${publication.id}/commentaires/${commentaire.id}`, { methode: 'DELETE', donnees: {} });
        element.remove();
        apresSuppression();
      } catch (erreur) {
        window.alert(erreur.message);
      }
    });
    return element;
  }

  function zoneCommentaires(publication, boutonCommenter) {
    const liste = el('ul', { classe: 'liste-commentaires' });
    const etat = el('p', { classe: 'texte-discret', texte: 'Chargement des commentaires…' });
    const champ = el('input', { type: 'text', maxlength: '1000', placeholder: 'Écrire un commentaire…', 'aria-label': 'Écrire un commentaire', required: true });
    const envoyer = el('button', { classe: 'bouton bouton-principal', type: 'submit', texte: 'Envoyer' });
    const zoneErreur = el('p', { classe: 'erreur-champ', role: 'alert' });
    const formulaire = el('form', { classe: 'form-commentaire' }, [champ, envoyer]);
    const zone = el('div', { classe: 'commentaires', hidden: true }, [etat, liste, formulaire, zoneErreur]);
    let charge = false;

    function compter(variation) {
      publication.nbCommentaires += variation;
      boutonCommenter.textContent = publication.nbCommentaires ? pluriel(publication.nbCommentaires, 'commentaire') : 'Commenter';
    }

    async function ouvrir() {
      zone.hidden = !zone.hidden;
      boutonCommenter.setAttribute('aria-expanded', String(!zone.hidden));
      if (zone.hidden || charge) return;
      try {
        const { commentaires } = await api(`/publications/${publication.id}/commentaires`);
        liste.replaceChildren(...commentaires.map((c) => elementCommentaire(c, publication, () => compter(-1))));
        etat.hidden = true;
        charge = true;
      } catch (erreur) {
        etat.textContent = erreur.message;
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
    const boutonJaime = el('button', { classe: 'bouton-action', type: 'button' });
    const boutonCommenter = el('button', {
      classe: 'bouton-action', type: 'button', 'aria-expanded': 'false',
      texte: publication.nbCommentaires ? pluriel(publication.nbCommentaires, 'commentaire') : 'Commenter',
    });
    const boutonAutre = el('button', { classe: 'bouton-action bouton-action-fin', type: 'button', texte: publication.estMoi ? 'Supprimer' : 'Signaler' });
    const commentaires = zoneCommentaires(publication, boutonCommenter);

    function afficherJaime() {
      boutonJaime.textContent = publication.nbJaime ? `J'aime · ${publication.nbJaime}` : 'J\'aime';
      boutonJaime.setAttribute('aria-pressed', String(publication.jaimeParMoi));
    }
    afficherJaime();

    const carte = el('article', { classe: 'carte-publication' }, [
      el('header', { classe: 'publication-entete' }, [
        lienAuteur(publication.auteur, 'moyen'),
        el('div', {}, [
          el('a', { classe: 'nom-auteur', href: `/${publication.auteur.identifiant}`, texte: publication.auteur.nom }),
          el('p', { classe: 'publication-meta' }, [
            el('span', { classe: `type-publication type-${publication.type}`, texte: NOMS_TYPES[publication.type] }),
            el('span', { classe: 'texte-discret', texte: ` · ${dateRelative(publication.creeLe)}` }),
          ]),
        ]),
      ]),
      el('p', { classe: 'publication-texte', texte: publication.texte }),
      publication.image ? el('img', { classe: 'publication-image', src: publication.image, alt: 'Image jointe à la publication', loading: 'lazy' }) : null,
      el('div', { classe: 'publication-actions' }, [boutonJaime, boutonCommenter, boutonAutre]),
      commentaires.zone,
    ]);

    boutonJaime.addEventListener('click', async () => {
      boutonJaime.disabled = true;
      try {
        const reponse = await api(`/publications/${publication.id}/jaime`, { methode: publication.jaimeParMoi ? 'DELETE' : 'POST', donnees: {} });
        publication.nbJaime = reponse.nbJaime;
        publication.jaimeParMoi = reponse.jaimeParMoi;
        afficherJaime();
      } catch (erreur) {
        window.alert(erreur.message);
      } finally {
        boutonJaime.disabled = false;
      }
    });

    boutonCommenter.addEventListener('click', commentaires.ouvrir);

    boutonAutre.addEventListener('click', async () => {
      if (!publication.estMoi) return signaler('publication', publication.id);
      if (!window.confirm('Supprimer cette publication ?')) return;
      try {
        await api(`/publications/${publication.id}`, { methode: 'DELETE', donnees: {} });
        carte.remove();
      } catch (erreur) {
        window.alert(erreur.message);
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
    etat.hidden = false;
    etat.textContent = 'Chargement…';

    const parametres = new URLSearchParams();
    if (suivant) parametres.set('avant', suivant);
    if (filtre === 'amis') parametres.set('amis', '1');
    const filtreDemande = filtre;
    try {
      const reponse = await api(`/publications?${parametres}`);
      if (filtreDemande !== filtre) return; // la personne a changé d'onglet pendant le chargement
      fil.append(...reponse.publications.map(cartePublication));
      suivant = reponse.suivant;
      boutonPlus.hidden = !suivant;
      if (fil.children.length === 0) {
        etat.textContent = filtre === 'amis'
          ? 'Aucune publication de tes amis pour l\'instant. Ajoute des amis depuis leur profil.'
          : 'Aucune publication pour l\'instant. Lance la palabre : publie la première !';
      } else {
        etat.hidden = true;
      }
    } catch (erreur) {
      etat.textContent = erreur.message;
      boutonPlus.hidden = !suivant;
    }
  }

  // ---------- Formulaire « Publier » ----------
  function brancherPublier() {
    const formulaire = document.querySelector('[data-publier]');
    const zoneMessage = formulaire.querySelector('[data-message]');
    const zoneErreur = formulaire.querySelector('[data-erreur="texte"]');
    const apercu = formulaire.querySelector('[data-apercu]');
    const choisir = formulaire.querySelector('[data-choisir-image]');
    const bouton = formulaire.querySelector('button[type="submit"]');

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
        message('Publié.', 'succes');
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
    brancherPublier();
    brancherFiltres();
    document.querySelector('[data-charger-plus]').addEventListener('click', () => chargerPage());
    chargerPage({ depuisLeDebut: true });
  });
})();
