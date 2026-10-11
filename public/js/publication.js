// Une publication du fil : en-tête, texte, image, preuve sociale, j'aime, commentaires.
// Partagé par le fil (/fil), l'onglet « Publications » d'un profil et la page publique /publication/12 :
// le même code, le même rendu. Un visiteur sans compte la voit en lecture seule (option « visiteur »).
(function () {
  const { t, chargementInfini, api, el, avatar, nomMembre, prenom, dateRelative, deNom, signaler, icone, chargement, toast, confirmer, menuOptions, copierLien, partager, utilisateurConnecte } = window.Palabre;

  // Un administrateur peut supprimer le contenu des autres : le menu « … » le lui propose.
  // (Le serveur revérifie de toute façon : cacher un bouton n'est jamais une protection.)
  let estAdmin = false;
  utilisateurConnecte().then((moi) => { estAdmin = Boolean(moi && moi.estAdmin); });

  // Chaque type a son nom et son icône ; sa couleur est dans le CSS (.badge-idee, .badge-question, .badge-projet).
  const TYPES = {
    idee: { nom: t('publication.idee'), icone: 'idee' },
    question: { nom: t('publication.question'), icone: 'question' },
    projet: { nom: t('publication.projet'), icone: 'projet' },
  };

  function lienAuteur(auteur, taille) {
    return el('a', { classe: 'lien-avatar', href: `/${auteur.identifiant}`, 'aria-label': t('commun.profil-de', { nom: auteur.nom, deNom: deNom(auteur.nom) }) }, [avatar(auteur, taille)]);
  }

  // « Aimé par Awa et 12 autres » : un prénom connu donne plus envie de lire qu'un simple chiffre.
  function texteAime(publication) {
    const { nbJaime, jaimeParMoi, aimePar } = publication;
    if (!nbJaime) return '';
    const autres = t('publication.autres', { n: nbJaime - 1 });
    if (jaimeParMoi) return nbJaime === 1 ? t('publication.aime-par-toi') : t('publication.aime-par-toi-et', { autres });
    if (!aimePar) return t('publication.nb-jaime', { n: nbJaime });
    return nbJaime === 1 ? t('publication.aime-par', { prenom: prenom(aimePar) }) : t('publication.aime-par-et', { prenom: prenom(aimePar), autres });
  }

  // ---------- Modifier un texte (publication ou commentaire), pendant 48 heures ----------
  // La règle est vérifiée par le serveur ; ici on évite seulement de proposer « Modifier » trop tard.
  const encoreModifiable = (creeLe) => Date.now() - new Date(creeLe).getTime() < 48 * 3600 * 1000;
  // « il y a 2 h », ou « il y a 2 h, modifiée » : la mention reste discrète, à côté de la date.
  const dateEtMention = (creeLe, modifie, cle) => (modifie ? t(cle, { quand: dateRelative(creeLe) }) : dateRelative(creeLe));
  // Remplace un texte par un champ, avec « Annuler » et « Enregistrer ». Le texte revient à la fin, modifié ou non.
  function champModification({ element, texte, max, enregistrer, apres = () => {} }) {
    if (element.hidden) return; // déjà en cours de modification
    const zone = el('textarea', { classe: 'champ-modification', rows: '3', maxlength: String(max), 'aria-label': t('publication.modifier-texte') });
    zone.value = texte;
    const erreurZone = el('p', { classe: 'erreur-champ', role: 'alert' });
    const annuler = el('button', { classe: 'bouton bouton-lien', type: 'button', texte: t('commun.annuler') });
    const valider = el('button', { classe: 'bouton bouton-principal bouton-compact', type: 'submit', texte: t('commun.enregistrer') });
    const formulaire = el('form', { classe: 'formulaire-modification' }, [zone, erreurZone, el('div', { classe: 'modification-actions' }, [annuler, valider])]);
    const fermer = () => { formulaire.remove(); element.hidden = false; apres(); };
    annuler.addEventListener('click', fermer);
    formulaire.addEventListener('submit', async (evenement) => {
      evenement.preventDefault();
      erreurZone.textContent = '';
      valider.disabled = true;
      try {
        // « enregistrer » rend faux quand le texte corrigé a été retenu par le filtre : il a déjà prévenu l'auteur.
        const visible = await enregistrer(zone.value);
        fermer();
        if (visible !== false) toast(t('commun.enregistre'));
      } catch (erreur) {
        erreurZone.textContent = erreur.message;
        valider.disabled = false;
      }
    });
    element.hidden = true;
    element.after(formulaire);
    zone.focus();
    zone.setSelectionRange(zone.value.length, zone.value.length);
  }

  // ---------- Commentaires ----------
  function elementCommentaire(commentaire, publication, apresSuppression, visiteur) {
    async function supprimer() {
      if (!(await confirmer(t('publication.supprimer-commentaire'), { bouton: t('commun.supprimer'), danger: true }))) return;
      try {
        await api(`/publications/${publication.id}/commentaires/${commentaire.id}`, { methode: 'DELETE', donnees: {} });
        element.remove();
        apresSuppression();
        toast(t('publication.commentaire-supprime'));
      } catch (erreur) {
        toast(erreur.message, 'erreur');
      }
    }
    const texteCommentaire = el('p', { classe: 'commentaire-texte', texte: commentaire.texte });
    const quand = el('span', { classe: 'texte-discret' });
    const ecrireDate = () => { quand.textContent = dateEtMention(commentaire.creeLe, commentaire.modifie, t('publication.date-modifie')); };
    ecrireDate();
    // Modifier son commentaire (48 heures) : le texte devient un champ, juste là où il est.
    const modifier = () => champModification({
      element: texteCommentaire,
      texte: commentaire.texte,
      max: 1000,
      enregistrer: async (nouveau) => {
        const reponse = await api(`/publications/${publication.id}/commentaires/${commentaire.id}`, { methode: 'PUT', donnees: { texte: nouveau } });
        if (reponse.enAttente) {
          toast(reponse.message);
          element.remove();
          apresSuppression();
          return false;
        }
        Object.assign(commentaire, reponse.commentaire);
        texteCommentaire.textContent = commentaire.texte;
        ecrireDate();
      },
    });
    // Un visiteur ne peut ni signaler ni supprimer : pas de menu « … » pour lui.
    const menu = visiteur ? null : menuOptions(() => [
      commentaire.modifiable && encoreModifiable(commentaire.creeLe) ? { texte: t('commun.modifier'), icone: 'modifier', action: modifier } : null,
      commentaire.estMoi || estAdmin ? { texte: t('commun.supprimer'), icone: 'supprimer', danger: true, action: supprimer } : null,
      commentaire.estMoi ? null : { texte: t('signalement.titre'), icone: 'signaler', action: () => signaler('commentaire', commentaire.id) },
    ], { cote: 'gauche' });
    const element = el('li', { classe: 'commentaire' }, [
      lienAuteur(commentaire.auteur, 'mini'),
      el('div', { classe: 'commentaire-corps' }, [
        el('div', { classe: 'commentaire-bulle' }, [
          nomMembre(commentaire.auteur),
          texteCommentaire,
        ]),
        el('div', { classe: 'commentaire-pied' }, [quand, menu]),
      ]),
    ]);
    return element;
  }

  // Les 2 derniers commentaires sont déjà là (envoyés avec le fil) ; « Voir les N commentaires » charge le reste.
  function zoneCommentaires(publication, afficherCompteur, visiteur) {
    const liste = el('ul', { classe: 'liste-commentaires' });
    const voirTout = el('button', { classe: 'bouton-discret voir-commentaires', type: 'button' });
    const champ = el('input', { type: 'text', maxlength: '1000', placeholder: t('publication.ecrire-commentaire-aide'), 'aria-label': t('publication.ecrire-commentaire'), required: true });
    const envoyer = el('button', { classe: 'bouton bouton-principal', type: 'submit', 'aria-label': t('publication.envoyer-commentaire'), title: t('commun.envoyer') }, [icone('envoyer')]);
    const zoneErreur = el('p', { classe: 'erreur-champ', role: 'alert' });
    const formulaire = el('form', { classe: 'form-commentaire', hidden: true }, [champ, envoyer]);
    const zone = el('div', { classe: 'commentaires' }, [voirTout, liste, formulaire, zoneErreur]);
    let toutCharge = false;

    function compter(variation = 0) {
      publication.nbCommentaires += variation;
      const caches = publication.nbCommentaires - liste.children.length;
      voirTout.hidden = visiteur || toutCharge || caches <= 0; // la liste complète demande un compte
      voirTout.textContent = t('publication.voir-les-commentaires', { n: publication.nbCommentaires });
      zone.hidden = liste.children.length === 0 && formulaire.hidden && voirTout.hidden;
      afficherCompteur();
    }
    const commentaire = (c) => elementCommentaire(c, publication, () => compter(-1), visiteur);

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
        // Retenu par le filtre automatique : il sera visible après vérification.
        if (reponse.enAttente) {
          champ.value = '';
          toast(reponse.message);
          return;
        }
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
    const attributs = { classe: 'publication-image', src: publication.image, alt: t('publication.image-jointe'), loading: 'lazy', decoding: 'async' };
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
        title: t('publication.video', { plateforme: plateforme.nom }),
        allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
        allowfullscreen: true,
        // Le site n'envoie d'habitude aucune « adresse d'origine » (réglage de Helmet), mais YouTube refuse de lire sans elle :
        // on donne seulement le nom du site, jamais la page où se trouve le membre.
        referrerpolicy: 'strict-origin-when-cross-origin',
      }));
    }
    if (video.plateforme === 'youtube') {
      const vignette = el('button', { classe: 'video-vignette', type: 'button', 'aria-label': t('publication.lire-youtube') }, [
        // Sur téléphone, la petite miniature (320 px, environ 10 Ko) suffit ; la grande (480 px) pèse trois fois plus.
        el('img', { src: `https://i.ytimg.com/vi/${video.id}/${window.matchMedia('(max-width: 767px)').matches ? 'mqdefault' : 'hqdefault'}.jpg`, alt: '', width: 480, height: 360, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' }),
        el('span', { classe: 'video-bouton-lecture' }, [icone('lecture')]),
      ]);
      vignette.addEventListener('click', lire);
      cadre.append(vignette);
    } else {
      const bouton = el('button', { classe: 'bouton bouton-principal', type: 'button' }, [icone('lecture'), t('publication.lire-video')]);
      bouton.addEventListener('click', lire);
      cadre.append(el('div', { classe: 'video-carte' }, [
        el('span', { classe: 'video-logo' }, [icone(video.plateforme)]),
        el('strong', { texte: t('publication.video', { plateforme: plateforme.nom }) }),
        bouton,
      ]));
    }
    return el('div', { classe: 'publication-video' }, [
      cadre,
      el('p', { classe: 'video-mention texte-discret', texte: t('publication.video-donnees') }),
    ]);
  }

  // ---------- Une publication ----------
  // « nouvelle » : la publication vient d'être écrite, elle apparaît en douceur en haut du fil.
  // « visiteur » : personne n'est connecté (page publique). Tout se lit, mais les actions sont remplacées par
  //   un bouton « Rejoindre Palabre pour réagir ». « entiere » : le texte n'est pas coupé après 5 lignes.
  function cartePublication(publication, { nouvelle = false, visiteur = false, entiere = false } = {}) {
    const type = TYPES[publication.type];
    const boutonJaime = el('button', { classe: 'bouton-action bouton-jaime', type: 'button' }, [icone('coeur'), t('publication.jaime')]);
    const boutonCommenter = el('button', { classe: 'bouton-action', type: 'button' }, [icone('commentaire'), t('publication.commenter')]);
    async function supprimer() {
      // La mienne part dans ma corbeille (30 jours pour changer d'avis) ; celle d'un autre, supprimée par un
      // administrateur, part pour de bon.
      const question = publication.estMoi ? t('publication.supprimer') : t('publication.supprimer-admin');
      if (!(await confirmer(question, { bouton: t('commun.supprimer'), danger: true }))) return;
      try {
        const { corbeille } = await api(`/publications/${publication.id}`, { methode: 'DELETE', donnees: {} });
        carte.remove();
        toast(corbeille ? t('publication.dans-corbeille') : t('publication.supprimee'));
      } catch (erreur) {
        toast(erreur.message, 'erreur');
      }
    }
    // L'adresse partagée est la page publique /publication/12 (envoyée par le serveur), lisible sans compte.
    const lien = publication.lien || `${window.location.origin}/publication/${publication.id}`;
    const apercu = publication.texte.replace(/\s+/g, ' ').trim();
    const menu = menuOptions(() => [
      { texte: t('commun.partager'), icone: 'partager', action: () => partager({ titre: t('publication.sur-palabre', { nom: publication.auteur.nom }), texte: apercu.length > 120 ? `${apercu.slice(0, 119)}…` : apercu, url: lien }) },
      { texte: t('commun.copier-le-lien'), icone: 'lien', action: () => copierLien(lien) },
      // Modifier (l'auteur, pendant 48 heures), Supprimer (l'auteur), Signaler (les autres).
      publication.modifiable && !visiteur && encoreModifiable(publication.creeLe) ? { texte: t('commun.modifier'), icone: 'modifier', action: modifier } : null,
      publication.estMoi || estAdmin ? { texte: t('commun.supprimer'), icone: 'supprimer', danger: true, action: supprimer } : null,
      publication.estMoi || visiteur ? null : { texte: t('signalement.titre'), icone: 'signaler', action: () => signaler('publication', publication.id) },
    ]);
    menu.classList.add('publication-menu');

    // Preuve sociale : qui a aimé à gauche, nombre de commentaires à droite.
    const aime = el('span', { classe: 'preuve-aime' });
    // Pour un membre, le compteur est un bouton qui déplie tous les commentaires ; pour un visiteur, un simple texte.
    const nbCommentaires = visiteur ? el('span', { classe: 'preuve-commentaires texte-discret' }) : el('button', { classe: 'bouton-discret preuve-commentaires', type: 'button' });
    const preuve = el('div', { classe: 'publication-preuve' }, [aime, nbCommentaires]);

    function afficherPreuve() {
      const texte = texteAime(publication);
      aime.replaceChildren(...(texte ? [icone('coeur'), texte] : []));
      const n = publication.nbCommentaires;
      nbCommentaires.textContent = n ? t('commun.commentaires', { n }) : '';
      nbCommentaires.hidden = !n;
      preuve.hidden = !texte && !n;
      boutonJaime.setAttribute('aria-pressed', String(publication.jaimeParMoi));
    }
    const commentaires = zoneCommentaires(publication, afficherPreuve, visiteur);
    commentaires.compter();

    // Texte coupé après 5 lignes (CSS) ; « Voir plus » n'apparaît que si le texte dépasse vraiment.
    const texte = el('p', { classe: `publication-texte${entiere ? '' : ' coupe'}`, texte: publication.texte });
    const voirPlus = el('button', { classe: 'bouton-discret voir-plus', type: 'button', texte: t('commun.voir-plus'), hidden: true });
    voirPlus.addEventListener('click', () => {
      texte.classList.remove('coupe');
      voirPlus.remove();
    });
    const corps = el('div', { classe: 'publication-corps' }, [texte, voirPlus]);
    const quand = el('span', { classe: 'texte-discret' });
    const ecrireDate = () => { quand.textContent = dateEtMention(publication.creeLe, publication.modifiee, t('publication.date-modifiee')); };
    ecrireDate();
    // Modifier sa publication : le texte seulement (le type, l'image et la vidéo restent).
    function modifier() {
      voirPlus.hidden = true;
      champModification({
        element: texte,
        texte: publication.texte,
        max: 3000,
        enregistrer: async (nouveau) => {
          const reponse = await api(`/publications/${publication.id}`, { methode: 'PUT', donnees: { texte: nouveau } });
          if (reponse.enAttente) {
            toast(reponse.message);
            carte.remove();
            return false;
          }
          publication.texte = reponse.publication.texte;
          publication.modifiee = reponse.publication.modifiee;
          texte.textContent = publication.texte;
          ecrireDate();
          return true;
        },
        apres: () => texte.classList.remove('coupe'), // après une modification, on montre le texte en entier
      });
    }
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
            quand,
            el('span', { classe: `badge-type badge-${publication.type}` }, [icone(type.icone), type.nom]),
          ]),
        ]),
        menu,
      ]),
      corps,
      publication.image ? imagePublication(publication) : null,
      publication.video ? videoPublication(publication.video) : null,
      preuve,
      visiteur
        // Les trois sorties d'un visiteur, dans la carte, l'une sous l'autre et sur toute la largeur.
        ? el('div', { classe: 'publication-rejoindre' }, [
          el('a', { classe: 'bouton bouton-principal bouton-plein', href: `/inscription?suite=${encodeURIComponent(`/publication/${publication.id}`)}`, texte: t('publication.rejoindre') }),
          el('a', { classe: 'bouton bouton-contour bouton-plein', href: `/${publication.auteur.identifiant}`, texte: t('publication.voir-profil', { prenom: prenom(publication.auteur), dePrenom: deNom(prenom(publication.auteur)) }) }),
          el('a', { classe: 'bouton bouton-lien bouton-plein', href: `/connexion?suite=${encodeURIComponent(`/publication/${publication.id}`)}`, texte: t('acces.deja-un-compte') }),
        ])
        : el('div', { classe: 'publication-actions' }, [boutonJaime, boutonCommenter]),
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
    if (!visiteur) nbCommentaires.addEventListener('click', commentaires.toutVoir);

    return carte;
  }

  // ---------- Un fil chargé 10 par 10, tout seul en défilant ----------
  // zone : où vont les publications ; etat : zone du message (fil vide, erreur) ;
  // boutonPlus : « Voir plus », gardé pour les rares navigateurs sans IntersectionObserver ;
  // parametres() : les filtres de la requête (amis=1, auteur=…) ; vide() : ce qu'on montre quand il n'y a rien ;
  // fin : la phrase affichée au bout du fil.
  function filPublications({ zone, etat, boutonPlus = null, parametres, vide, fin = t('publication.tout-vu') }) {
    let suivant = null; // numéro à partir duquel charger la page suivante
    let numero = 0;     // si un filtre change pendant un chargement, l'ancienne réponse est ignorée

    // Demande une page et l'ajoute au fil. Répond true s'il en reste. « avantAjout » retire les squelettes du début.
    async function page(avantAjout = () => {}) {
      const demande = numero;
      const requete = new URLSearchParams(parametres());
      if (suivant) requete.set('avant', suivant);
      const reponse = await api(`/publications?${requete}`);
      if (demande !== numero) return false;
      avantAjout();
      zone.append(...reponse.publications.map((p) => cartePublication(p)));
      suivant = reponse.suivant;
      return Boolean(suivant);
    }
    // Les pages suivantes : chargementInfini() les demande quand on approche de la fin.
    const infini = chargementInfini(zone, () => page(), { fin, bouton: boutonPlus });

    // Le fil depuis le début (ouverture de la page, changement de filtre).
    async function charger() {
      numero += 1;
      const demande = numero;
      suivant = null;
      zone.replaceChildren();
      etat.hidden = true;
      infini.reprendre(false);
      const fini = chargement(zone, 3); // squelettes à la place du vide
      try {
        const encore = await page(fini);
        if (demande !== numero) return;
        if (zone.children.length === 0) {
          etat.replaceChildren(vide());
          etat.hidden = false;
        }
        infini.reprendre(encore);
      } catch (erreur) {
        if (demande !== numero) return;
        fini();
        etat.replaceChildren(window.Palabre.etatVide('calme', t('publication.ne-chargent-pas'), erreur.message));
        etat.hidden = false;
      }
    }

    function ajouterEnTete(publication) {
      zone.prepend(cartePublication(publication, { nouvelle: true }));
      etat.hidden = true;
    }

    return { charger, ajouterEnTete };
  }

  Object.assign(window.Palabre, { cartePublication, filPublications, videoPublication });
})();
