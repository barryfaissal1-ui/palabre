// Une publication du fil : en-tête, texte, image, preuve sociale, j'aime, commentaires.
// Partagé par le fil (/fil) et par l'onglet « Publications » d'un profil : le même code, le même rendu.
(function () {
  const { api, el, avatar, nomMembre, prenom, dateRelative, signaler, icone, chargement, toast, confirmer, menuOptions, copierLien, utilisateurConnecte } = window.Palabre;

  // Un administrateur peut supprimer le contenu des autres : le menu « … » le lui propose.
  // (Le serveur revérifie de toute façon : cacher un bouton n'est jamais une protection.)
  let estAdmin = false;
  utilisateurConnecte().then((moi) => { estAdmin = Boolean(moi && moi.estAdmin); });

  // Chaque type a son nom et son icône ; sa couleur est dans le CSS (.badge-idee, .badge-question, .badge-projet).
  const TYPES = {
    idee: { nom: 'Idée', icone: 'idee' },
    question: { nom: 'Question', icone: 'question' },
    projet: { nom: 'Projet', icone: 'projet' },
  };

  function lienAuteur(auteur, taille) {
    return el('a', { classe: 'lien-avatar', href: `/${auteur.identifiant}`, 'aria-label': `Profil de ${auteur.nom}` }, [avatar(auteur, taille)]);
  }

  // « Aimé par Awa et 12 autres » : un prénom connu donne plus envie de lire qu'un simple chiffre.
  function texteAime(publication) {
    const { nbJaime, jaimeParMoi, aimePar } = publication;
    if (!nbJaime) return '';
    const autres = nbJaime - 1 === 1 ? '1 autre' : `${nbJaime - 1} autres`;
    if (jaimeParMoi) return nbJaime === 1 ? 'Aimé par toi' : `Aimé par toi et ${autres}`;
    if (!aimePar) return `${nbJaime} j'aime`;
    return nbJaime === 1 ? `Aimé par ${prenom(aimePar)}` : `Aimé par ${prenom(aimePar)} et ${autres}`;
  }

  // ---------- Commentaires ----------
  function elementCommentaire(commentaire, publication, apresSuppression) {
    async function supprimer() {
      if (!(await confirmer('Supprimer ce commentaire ?', { bouton: 'Supprimer', danger: true }))) return;
      try {
        await api(`/publications/${publication.id}/commentaires/${commentaire.id}`, { methode: 'DELETE', donnees: {} });
        element.remove();
        apresSuppression();
        toast('Commentaire supprimé.');
      } catch (erreur) {
        toast(erreur.message, 'erreur');
      }
    }
    const menu = menuOptions(() => [
      commentaire.estMoi ? null : { texte: 'Signaler', icone: 'signaler', action: () => signaler('commentaire', commentaire.id) },
      commentaire.estMoi || estAdmin ? { texte: 'Supprimer', icone: 'supprimer', danger: true, action: supprimer } : null,
    ], { cote: 'gauche' });
    const element = el('li', { classe: 'commentaire' }, [
      lienAuteur(commentaire.auteur, 'mini'),
      el('div', { classe: 'commentaire-corps' }, [
        el('div', { classe: 'commentaire-bulle' }, [
          nomMembre(commentaire.auteur),
          el('p', { classe: 'commentaire-texte', texte: commentaire.texte }),
        ]),
        el('div', { classe: 'commentaire-pied' }, [el('span', { classe: 'texte-discret', texte: dateRelative(commentaire.creeLe) }), menu]),
      ]),
    ]);
    return element;
  }

  // Les 2 derniers commentaires sont déjà là (envoyés avec le fil) ; « Voir les N commentaires » charge le reste.
  function zoneCommentaires(publication, afficherCompteur) {
    const liste = el('ul', { classe: 'liste-commentaires' });
    const voirTout = el('button', { classe: 'bouton-discret voir-commentaires', type: 'button' });
    const champ = el('input', { type: 'text', maxlength: '1000', placeholder: 'Écrire un commentaire…', 'aria-label': 'Écrire un commentaire', required: true });
    const envoyer = el('button', { classe: 'bouton bouton-principal', type: 'submit', 'aria-label': 'Envoyer le commentaire', title: 'Envoyer' }, [icone('envoyer')]);
    const zoneErreur = el('p', { classe: 'erreur-champ', role: 'alert' });
    const formulaire = el('form', { classe: 'form-commentaire', hidden: true }, [champ, envoyer]);
    const zone = el('div', { classe: 'commentaires' }, [voirTout, liste, formulaire, zoneErreur]);
    let toutCharge = false;

    function compter(variation = 0) {
      publication.nbCommentaires += variation;
      const caches = publication.nbCommentaires - liste.children.length;
      voirTout.hidden = toutCharge || caches <= 0;
      voirTout.textContent = `Voir les ${publication.nbCommentaires} commentaires`;
      zone.hidden = liste.children.length === 0 && formulaire.hidden && voirTout.hidden;
      afficherCompteur();
    }
    const commentaire = (c) => elementCommentaire(c, publication, () => compter(-1));

    async function toutVoir() {
      if (toutCharge) return;
      voirTout.disabled = true;
      const fini = chargement(liste, 1);
      try {
        const { commentaires } = await api(`/publications/${publication.id}/commentaires`);
        fini();
        liste.replaceChildren(...commentaires.map(commentaire));
        toutCharge = true;
        publication.nbCommentaires = commentaires.length;
      } catch (erreur) {
        fini();
        toast(erreur.message, 'erreur');
      }
      voirTout.disabled = false;
      compter();
    }

    // Le bouton « Commenter » montre le champ et y place le curseur.
    function ecrire() {
      formulaire.hidden = false;
      zone.hidden = false;
      champ.focus();
    }

    voirTout.addEventListener('click', toutVoir);
    formulaire.addEventListener('submit', async (evenement) => {
      evenement.preventDefault();
      zoneErreur.textContent = '';
      if (!champ.value.trim()) return;
      envoyer.disabled = true;
      try {
        const reponse = await api(`/publications/${publication.id}/commentaires`, { methode: 'POST', donnees: { texte: champ.value } });
        liste.append(commentaire(reponse.commentaire));
        champ.value = '';
        compter(1);
      } catch (erreur) {
        zoneErreur.textContent = erreur.message;
      } finally {
        envoyer.disabled = false;
      }
    });

    liste.append(...publication.derniersCommentaires.map(commentaire));
    return { zone, ecrire, toutVoir, compter };
  }

  // Image jointe : toute la largeur, proportions gardées, au plus 4:5 en hauteur (une image plus haute est recadrée).
  // Les attributs width et height (envoyés par le serveur) donnent sa forme au navigateur AVANT le chargement :
  // il réserve la place, et la page ne saute pas quand l'image arrive.
  // Pour une image plus haute que 4:5, la classe .image-haute impose la forme 4:5 (aspect-ratio dans le CSS).
  function imagePublication(publication) {
    const { imageLargeur: largeur, imageHauteur: hauteur } = publication;
    const attributs = { classe: 'publication-image', src: publication.image, alt: 'Image jointe à la publication', loading: 'lazy', decoding: 'async' };
    if (largeur && hauteur) {
      const tropHaute = hauteur > largeur * 1.25;
      attributs.width = largeur;
      attributs.height = tropHaute ? Math.round(largeur * 1.25) : hauteur;
      if (tropHaute) attributs.classe += ' image-haute';
    }
    return el('img', attributs);
  }

  // ---------- Vidéo jointe (YouTube, TikTok, Facebook) ----------
  // Le serveur n'envoie que { plateforme, id } : c'est ici que l'adresse du lecteur officiel est reconstruite.
  // Économie de données : RIEN n'est demandé à TikTok ni à Facebook tant que le membre n'a pas touché la vidéo,
  // et YouTube ne fournit qu'une petite image (la miniature). Le lecteur (un cadre « iframe », lourd) n'arrive qu'au toucher.
  const VIDEOS = {
    youtube: { nom: 'YouTube', lecteur: (id) => `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0` },
    tiktok: { nom: 'TikTok', lecteur: (id) => `https://www.tiktok.com/player/v1/${id}?autoplay=1` },
    facebook: {
      nom: 'Facebook',
      // Un identifiant tout en chiffres vient de facebook.com/…/videos/… ; sinon c'est le code d'un lien court fb.watch.
      lecteur: (id) => `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(/^\d+$/.test(id) ? `https://www.facebook.com/watch/?v=${id}` : `https://fb.watch/${id}/`)}&show_text=false&autoplay=true`,
    },
  };

  function videoPublication(video) {
    const plateforme = video && VIDEOS[video.plateforme];
    // Deuxième contrôle, côté navigateur : un identifiant qui n'a pas la bonne forme n'est jamais mis dans une adresse.
    if (!plateforme || !/^[A-Za-z0-9_-]{4,25}$/.test(video.id)) return null;
    const cadre = el('div', { classe: `video-cadre video-${video.plateforme}` });
    function lire() {
      cadre.classList.add('en-lecture');
      cadre.replaceChildren(el('iframe', {
        src: plateforme.lecteur(video.id),
        title: `Vidéo ${plateforme.nom}`,
        allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
        allowfullscreen: true,
        // Le site n'envoie d'habitude aucune « adresse d'origine » (réglage de Helmet), mais YouTube refuse de lire sans elle :
        // on donne seulement le nom du site, jamais la page où se trouve le membre.
        referrerpolicy: 'strict-origin-when-cross-origin',
      }));
    }
    if (video.plateforme === 'youtube') {
      const vignette = el('button', { classe: 'video-vignette', type: 'button', 'aria-label': 'Lire la vidéo YouTube' }, [
        el('img', { src: `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`, alt: '', width: 480, height: 360, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' }),
        el('span', { classe: 'video-bouton-lecture' }, [icone('lecture')]),
      ]);
      vignette.addEventListener('click', lire);
      cadre.append(vignette);
    } else {
      const bouton = el('button', { classe: 'bouton bouton-principal', type: 'button' }, [icone('lecture'), 'Lire la vidéo']);
      bouton.addEventListener('click', lire);
      cadre.append(el('div', { classe: 'video-carte' }, [
        el('span', { classe: 'video-logo' }, [icone(video.plateforme)]),
        el('strong', { texte: `Vidéo ${plateforme.nom}` }),
        bouton,
      ]));
    }
    return el('div', { classe: 'publication-video' }, [
      cadre,
      el('p', { classe: 'video-mention texte-discret', texte: 'La vidéo utilise tes données mobiles.' }),
    ]);
  }

  // ---------- Une publication ----------
  // « nouvelle » : la publication vient d'être écrite, elle apparaît en douceur en haut du fil.
  function cartePublication(publication, { nouvelle = false } = {}) {
    const type = TYPES[publication.type];
    const boutonJaime = el('button', { classe: 'bouton-action bouton-jaime', type: 'button' }, [icone('coeur'), 'J\'aime']);
    const boutonCommenter = el('button', { classe: 'bouton-action', type: 'button' }, [icone('commentaire'), 'Commenter']);
    async function supprimer() {
      if (!(await confirmer('Supprimer cette publication ? Ses commentaires et ses j\'aime partiront avec.', { bouton: 'Supprimer', danger: true }))) return;
      try {
        await api(`/publications/${publication.id}`, { methode: 'DELETE', donnees: {} });
        carte.remove();
        toast('Publication supprimée.');
      } catch (erreur) {
        toast(erreur.message, 'erreur');
      }
    }
    const menu = menuOptions(() => [
      { texte: 'Copier le lien', icone: 'lien', action: () => copierLien(`${window.location.origin}/fil?publication=${publication.id}`) },
      publication.estMoi ? null : { texte: 'Signaler', icone: 'signaler', action: () => signaler('publication', publication.id) },
      publication.estMoi || estAdmin ? { texte: 'Supprimer', icone: 'supprimer', danger: true, action: supprimer } : null,
    ]);
    menu.classList.add('publication-menu');

    // Preuve sociale : qui a aimé à gauche, nombre de commentaires à droite.
    const aime = el('span', { classe: 'preuve-aime' });
    const nbCommentaires = el('button', { classe: 'bouton-discret preuve-commentaires', type: 'button' });
    const preuve = el('div', { classe: 'publication-preuve' }, [aime, nbCommentaires]);

    function afficherPreuve() {
      const texte = texteAime(publication);
      aime.replaceChildren(...(texte ? [icone('coeur'), texte] : []));
      const n = publication.nbCommentaires;
      nbCommentaires.textContent = n ? `${n} commentaire${n > 1 ? 's' : ''}` : '';
      nbCommentaires.hidden = !n;
      preuve.hidden = !texte && !n;
      boutonJaime.setAttribute('aria-pressed', String(publication.jaimeParMoi));
    }
    const commentaires = zoneCommentaires(publication, afficherPreuve);
    commentaires.compter();

    // Texte coupé après 5 lignes (CSS) ; « Voir plus » n'apparaît que si le texte dépasse vraiment.
    const texte = el('p', { classe: 'publication-texte coupe', texte: publication.texte });
    const voirPlus = el('button', { classe: 'bouton-discret voir-plus', type: 'button', texte: 'Voir plus', hidden: true });
    voirPlus.addEventListener('click', () => {
      texte.classList.remove('coupe');
      voirPlus.remove();
    });
    requestAnimationFrame(() => { // au prochain affichage, la carte est dans la page : on peut mesurer le texte
      if (texte.scrollHeight > texte.clientHeight + 2) voirPlus.hidden = false;
      else texte.classList.remove('coupe');
    });

    const carte = el('article', { classe: `publication${nouvelle ? ' vient-de-paraitre' : ''}` }, [
      el('header', { classe: 'publication-entete' }, [
        lienAuteur(publication.auteur, 'moyen'),
        el('div', { classe: 'publication-qui' }, [
          nomMembre(publication.auteur),
          el('p', { classe: 'publication-meta' }, [
            el('span', { classe: 'texte-discret', texte: dateRelative(publication.creeLe) }),
            el('span', { classe: `badge-type badge-${publication.type}` }, [icone(type.icone), type.nom]),
          ]),
        ]),
        menu,
      ]),
      el('div', { classe: 'publication-corps' }, [texte, voirPlus]),
      publication.image ? imagePublication(publication) : null,
      publication.video ? videoPublication(publication.video) : null,
      preuve,
      el('div', { classe: 'publication-actions' }, [boutonJaime, boutonCommenter]),
      commentaires.zone,
    ]);

    // J'aime instantané : le cœur et le compteur changent tout de suite, sans attendre le serveur.
    // Sur une connexion lente, l'appli paraît quand même immédiate. Si le serveur refuse, on revient en arrière.
    let envoiEnCours = false;
    boutonJaime.addEventListener('click', async () => {
      if (envoiEnCours) return;
      envoiEnCours = true;
      const avant = { nbJaime: publication.nbJaime, jaimeParMoi: publication.jaimeParMoi };
      publication.jaimeParMoi = !avant.jaimeParMoi;
      publication.nbJaime = avant.nbJaime + (publication.jaimeParMoi ? 1 : -1);
      boutonJaime.classList.toggle('vient-d-aimer', publication.jaimeParMoi); // le « pop » du cœur
      afficherPreuve();
      try {
        const reponse = await api(`/publications/${publication.id}/jaime`, { methode: publication.jaimeParMoi ? 'POST' : 'DELETE', donnees: {} });
        Object.assign(publication, reponse); // le vrai compteur, au cas où d'autres ont aimé entre-temps
      } catch (erreur) {
        Object.assign(publication, avant);
        boutonJaime.classList.remove('vient-d-aimer');
        toast(erreur.message, 'erreur');
      }
      afficherPreuve();
      envoiEnCours = false;
    });

    boutonCommenter.addEventListener('click', commentaires.ecrire);
    nbCommentaires.addEventListener('click', commentaires.toutVoir);

    return carte;
  }

  // ---------- Un fil chargé 10 par 10 ----------
  // zone : où vont les publications ; etat : zone du message (fil vide, erreur) ; boutonPlus : « Voir plus » ;
  // parametres() : les filtres de la requête (amis=1, auteur=…) ; vide() : ce qu'on montre quand il n'y a rien.
  function filPublications({ zone, etat, boutonPlus, parametres, vide }) {
    let suivant = null; // numéro à partir duquel charger la page suivante
    let numero = 0;     // si un filtre change pendant un chargement, l'ancienne réponse est ignorée

    async function charger({ depuisLeDebut = false } = {}) {
      numero += 1;
      const demande = numero;
      if (depuisLeDebut) {
        suivant = null;
        zone.replaceChildren();
      }
      boutonPlus.hidden = true;
      etat.hidden = true;
      const fini = chargement(zone, depuisLeDebut ? 3 : 1); // squelettes à la place du vide

      const requete = new URLSearchParams(parametres());
      if (suivant) requete.set('avant', suivant);
      try {
        const reponse = await api(`/publications?${requete}`);
        fini();
        if (demande !== numero) return;
        zone.append(...reponse.publications.map((p) => cartePublication(p)));
        suivant = reponse.suivant;
        boutonPlus.hidden = !suivant;
        if (zone.children.length === 0) {
          etat.replaceChildren(vide());
          etat.hidden = false;
        }
      } catch (erreur) {
        fini();
        if (demande !== numero) return;
        etat.replaceChildren(window.Palabre.etatVide('calme', 'Les publications ne chargent pas', erreur.message));
        etat.hidden = zone.children.length > 0;
        if (zone.children.length > 0) toast(erreur.message, 'erreur');
        boutonPlus.hidden = !suivant;
      }
    }

    function ajouterEnTete(publication) {
      zone.prepend(cartePublication(publication, { nouvelle: true }));
      etat.hidden = true;
    }

    boutonPlus.addEventListener('click', () => charger());
    return { charger, ajouterEnTete };
  }

  Object.assign(window.Palabre, { cartePublication, filPublications, videoPublication });
})();
