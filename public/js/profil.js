// Page profil public : palabre.dev/identifiant
// En haut : couverture, photo, nom, chiffres. En dessous, des onglets : Publications, Projets, Avis, Amis.
(function () {
  const {
    api, el, avatar, nomMembre, badgeFeuille, prenom, utilisateurConnecte, signaler, partager, carteProjet, etoiles,
    dateRelative, deNom, reduireImage, icone, etatVide, chargement, toast, confirmer, filPublications, menuOptions, copierLien,
  } = window.Palabre;

  const identifiant = decodeURIComponent(window.location.pathname.slice(1)).toLowerCase();
  const LARGEUR_COUVERTURE = 1200; // la couverture est réduite à 1200 px de large avant l'envoi
  let ongletActif = null;          // gardé quand la page se redessine (après une demande d'ami, par exemple)

  const pluriel = (nombre, mot) => `${mot}${nombre > 1 ? 's' : ''}`;
  const virgule = (note) => String(note).replace('.', ',');

  function lienWhatsApp(numero, nom) {
    const chiffres = numero.replace(/\D/g, '');
    const message = `Bonjour ${nom}, je t'ai trouvé sur Palabre.`;
    return `https://wa.me/${chiffres}?text=${encodeURIComponent(message)}`;
  }

  // Boutons d'amitié selon le lien actuel : aucune, demande envoyée, demande reçue, déjà amis.
  function boutonsAmitie(profil) {
    const cible = encodeURIComponent(profil.identifiant);
    function bouton(texte, classe, nomIcone, appel, succes) {
      const b = el('button', { classe: `bouton ${classe}`, type: 'button' }, [nomIcone ? icone(nomIcone) : null, texte]);
      b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          await appel();
          await afficher(); // relit le profil pour montrer le nouvel état
          toast(succes);
        } catch (erreur) {
          toast(erreur.message, 'erreur');
          b.disabled = false;
        }
      });
      return b;
    }

    if (profil.amitie === 'aucune') {
      return [bouton('Ajouter en ami', 'bouton-principal', 'ami-ajouter', () => api('/amis/demandes', { methode: 'POST', donnees: { identifiant: profil.identifiant } }), 'Demande d\'ami envoyée.')];
    }
    if (profil.amitie === 'envoyee') {
      return [el('button', { classe: 'bouton bouton-contour', type: 'button', disabled: true }, [icone('horloge'), 'Demande envoyée'])];
    }
    if (profil.amitie === 'recue') {
      return [
        bouton('Accepter la demande d\'ami', 'bouton-principal', 'valide', () => api(`/amis/demandes/${cible}/accepter`, { methode: 'POST', donnees: {} }), 'Vous êtes maintenant amis.'),
        bouton('Refuser', 'bouton-contour', null, () => api(`/amis/demandes/${cible}/refuser`, { methode: 'POST', donnees: {} }), 'Demande refusée.'),
      ];
    }
    return [];
  }

  function actions(profil) {
    const zone = el('div', { classe: 'profil-actions' });
    if (profil.estMoi) {
      zone.append(el('a', { classe: 'bouton bouton-principal', href: '/modifier-profil' }, [icone('modifier'), 'Modifier mon profil']));
    } else {
      zone.append(...boutonsAmitie(profil));
      // « amitie » n'existe que pour un membre connecté : un visiteur ne voit pas ce bouton.
      if (profil.amitie) zone.append(el('a', { classe: 'bouton bouton-contour', href: `/messages?avec=${encodeURIComponent(profil.identifiant)}` }, [icone('commentaire'), 'Message']));
      if (profil.whatsapp) {
        zone.append(el('a', {
          classe: `bouton ${profil.amitie === 'aucune' ? 'bouton-contour' : 'bouton-principal'}`,
          href: lienWhatsApp(profil.whatsapp, prenom(profil)),
          target: '_blank',
          rel: 'noopener',
        }, [icone('commentaire'), 'WhatsApp']));
      } else if (profil.whatsappMasque) {
        zone.append(el('a', { classe: 'bouton bouton-principal', href: `/connexion?suite=/${profil.identifiant}`, texte: 'Se connecter pour contacter' }));
      }
    }
    const boutonPartage = el('button', { classe: 'bouton bouton-contour', type: 'button' }, [icone('partager'), 'Partager']);
    boutonPartage.addEventListener('click', () => partager(`${window.location.origin}/${profil.identifiant}`, `${profil.nom} sur Palabre`, boutonPartage));
    zone.append(boutonPartage);
    // « amitie » n'est renseigné que pour un membre connecté qui regarde le profil de quelqu'un d'autre.
    if (profil.amitie) {
      zone.append(menuOptions(() => [
        { texte: 'Copier le lien', icone: 'lien', action: () => copierLien(`${window.location.origin}/${profil.identifiant}`) },
        { texte: 'Signaler', icone: 'signaler', action: () => signaler('profil', profil.identifiant) },
      ], { cote: 'gauche' }));
    }
    return zone;
  }

  // ---------- Couverture ----------
  // La photo choisie par le membre, ou le motif tissé de Palabre. Sur son propre profil : « Modifier la couverture ».
  function couverture(profil) {
    const zone = el('div', { classe: `profil-couverture${profil.couverture ? '' : ' sans-photo'}` }, [
      profil.couverture ? el('img', { src: profil.couverture, alt: '', decoding: 'async' }) : null,
    ]);
    if (!profil.estMoi) return zone;

    const choisir = el('input', { type: 'file', accept: 'image/*', classe: 'visuellement-cache' });
    const boutons = el('div', { classe: 'couverture-actions' }, [
      el('label', { classe: 'bouton bouton-compact bouton-flottant' }, [icone('photo'), 'Modifier la couverture', choisir]),
    ]);
    choisir.addEventListener('change', async () => {
      const fichier = choisir.files[0];
      choisir.value = '';
      if (!fichier) return;
      try {
        const image = await reduireImage(fichier, LARGEUR_COUVERTURE);
        await api('/profils/moi/couverture', { methode: 'POST', donnees: { image } });
        await afficher();
        toast('Couverture mise à jour.');
      } catch (erreur) {
        toast(erreur.message, 'erreur');
      }
    });
    if (profil.couverture) {
      const retirer = el('button', { classe: 'bouton-icone bouton-flottant', type: 'button', 'aria-label': 'Retirer la couverture', title: 'Retirer la couverture' }, [icone('supprimer')]);
      retirer.addEventListener('click', async () => {
        if (!(await confirmer('Retirer ta photo de couverture ? Le motif de Palabre reviendra à la place.', { bouton: 'Retirer', danger: true }))) return;
        try {
          await api('/profils/moi/couverture', { methode: 'DELETE', donnees: {} });
          await afficher();
          toast('Couverture retirée.');
        } catch (erreur) {
          toast(erreur.message, 'erreur');
        }
      });
      boutons.append(retirer);
    }
    zone.append(boutons);
    return zone;
  }

  // ---------- Liens du dev (GitHub, GitLab, portfolio, LinkedIn) ----------
  // Chaque lien que le serveur a pu visiter porte le badge « Lien vérifié ». Sans aucun lien : « Profil à confirmer ».
  function liensDev(profil) {
    if (profil.type !== 'dev') return null;
    if (profil.aConfirmer) {
      return el('p', { classe: 'profil-a-confirmer' }, [
        el('span', { classe: 'pastille pastille-confirmer', texte: 'Profil à confirmer' }),
        profil.estMoi ? el('a', { href: profil.specialite ? '/modifier-profil' : '/bienvenue', texte: 'Ajouter un lien' }) : null,
      ]);
    }
    return el('ul', { classe: 'profil-liens' }, profil.liens.map((lien) => el('li', {}, [
      // noopener : le site ouvert ne peut pas agir sur la page Palabre ; nofollow : pas de coup de pouce au référencement.
      el('a', { classe: 'avec-icone', href: lien.url, target: '_blank', rel: 'noopener nofollow' }, [icone('lien'), lien.nom]),
      lien.verifie ? el('span', { classe: 'badge-verifie' }, [icone('verifie'), 'Lien vérifié']) : null,
    ])));
  }

  // ---------- Haut du profil ----------
  function teteProfil(profil) {
    const estDev = profil.type === 'dev';
    const lieu = [profil.ville, profil.pays].filter(Boolean).join(', ');
    // Les chiffres. Un client n'a ni projets ni avis : on ne montre que ses amis.
    const chiffre = (nombre, nom) => el('div', {}, [el('dt', { texte: nom }), el('dd', { texte: String(nombre) })]);
    const chiffres = [chiffre(profil.nbAmis, pluriel(profil.nbAmis, 'ami'))];
    if (estDev) {
      chiffres.unshift(chiffre(profil.nbProjetsVerifies, profil.nbProjetsVerifies > 1 ? 'projets vérifiés' : 'projet vérifié'));
      chiffres.push(chiffre(profil.nbAvis, profil.nbAvis ? `avis, ${virgule(profil.noteMoyenne)} sur 5` : 'avis'));
    }
    const commun = profil.amisEnCommun;

    // Trois blocs. Sur téléphone ils se suivent, comme une seule carte. Sur ordinateur (CSS), les actions viennent
    // à droite du nom, et la présentation forme une colonne à gauche du contenu des onglets.
    const tete = el('section', { classe: 'profil-tete' }, [
      couverture(profil),
      el('div', { classe: 'profil-identite' }, [
        avatar(profil, 'profil'),
        el('h1', { classe: 'profil-nom' }, [profil.nom, profil.nbProjetsVerifies > 0 ? badgeFeuille() : null]),
        el('p', { classe: 'profil-lieu' }, [icone('lieu'), `${estDev ? 'Développeur' : 'Client'} à ${lieu}`]),
      ]),
    ]);
    const presentation = el('section', { classe: 'profil-presentation', 'aria-labelledby': 'titre-presentation' }, [
      el('h2', { id: 'titre-presentation', texte: 'Présentation' }),
      profil.bio ? el('p', { classe: 'profil-bio', texte: profil.bio }) : null,
      // Profil de dev : « Développement web, 3 à 5 ans d'expérience ».
      estDev && profil.specialiteNom
        ? el('p', { classe: 'profil-metier avec-icone' }, [icone('devs'), [profil.specialiteNom, profil.experienceNom ? `${profil.experienceNom.toLowerCase()} d'expérience` : null].filter(Boolean).join(', ')])
        : null,
      liensDev(profil),
      estDev
        ? el('span', { classe: `pastille ${profil.disponible ? 'pastille-dispo' : 'pastille-occupe'}`, texte: profil.disponible ? 'Disponible pour des projets' : 'Occupé en ce moment' })
        : null,
      estDev && profil.competences.length ? el('ul', { classe: 'puces' }, profil.competences.map((c) => el('li', { texte: c.nom }))) : null,
      estDev && profil.estMoi && !profil.competences.length
        ? el('p', { classe: 'texte-discret', texte: 'Ajoute tes compétences pour que les clients te trouvent.' }) : null,
      // Le numéro n'est envoyé par le serveur qu'aux membres connectés.
      profil.whatsapp && !profil.estMoi
        ? el('p', { classe: 'presentation-whatsapp avec-icone' }, [icone('commentaire'), 'WhatsApp : ', el('a', { href: lienWhatsApp(profil.whatsapp, prenom(profil)), target: '_blank', rel: 'noopener', texte: profil.whatsapp })])
        : null,
      el('dl', { classe: 'profil-chiffres' }, chiffres),
    ]);
    const zoneActions = el('div', { classe: 'profil-zone-actions' }, [
      profil.amitie === 'amis' ? el('p', { classe: 'profil-lien avec-icone' }, [icone('valide'), 'Vous êtes amis']) : null,
      commun ? el('p', { classe: 'profil-lien avec-icone' }, [icone('amis'), `${commun} ${pluriel(commun, 'ami')} en commun`]) : null,
      actions(profil),
    ]);
    return [tete, presentation, zoneActions];
  }

  // ---------- Onglets ----------
  const invitation = (profil, texte) => etatVide('amis', 'Réservé aux membres', texte,
    el('a', { classe: 'bouton bouton-principal', href: `/connexion?suite=/${profil.identifiant}`, texte: 'Se connecter' }));

  function ongletPublications(profil, moi) {
    if (!moi) return invitation(profil, `Connecte-toi pour lire les publications ${deNom(prenom(profil))}.`);
    const zone = el('div', { classe: 'fil-social' });
    const etat = el('div', { role: 'status', hidden: true });
    const boutonPlus = el('button', { classe: 'bouton bouton-contour bouton-plein charger-plus', type: 'button', hidden: true, texte: 'Voir plus de publications' });
    const fil = filPublications({
      zone, etat, boutonPlus,
      parametres: () => ({ auteur: profil.identifiant }),
      vide: () => (profil.estMoi
        ? etatVide('palabre', 'Tu n\'as encore rien publié', 'Partage une idée, pose une question ou montre un projet.',
          el('a', { classe: 'bouton bouton-principal', href: '/fil' }, [icone('plus'), 'Publier dans le fil']))
        : etatVide('palabre', 'Pas encore de publication', `${prenom(profil)} n'a encore rien publié.`)),
    });
    fil.charger({ depuisLeDebut: true });
    return el('div', {}, [zone, etat, boutonPlus]);
  }

  function ongletProjets(profil) {
    const gerer = profil.estMoi
      ? el('a', { classe: 'bouton bouton-contour', href: '/projets' }, [icone(profil.projets.length ? 'modifier' : 'plus'), profil.projets.length ? 'Gérer mes projets' : 'Ajouter mon premier projet'])
      : null;
    if (!profil.projets.length) {
      return profil.estMoi
        ? etatVide('projets', 'Montre ce que tu sais faire', 'Ajoute tes projets réalisés : chaque lien qui répond ajoute un segment à ton anneau de preuve.', gerer)
        : etatVide('projets', 'Pas encore de réalisation', `${prenom(profil)} n'a pas encore ajouté de projet.`);
    }
    return el('div', { classe: 'panneau-marge' }, [
      el('div', { classe: 'grille-projets' }, profil.projets.map((p) => carteProjet(p, { avecDev: false }))),
      gerer,
    ]);
  }

  // Avis laissés par de vrais clients : chacun correspond à une demande terminée et attribuée à ce dev.
  function ongletAvis(profil) {
    if (!profil.nbAvis) {
      return etatVide('calme', 'Pas encore d\'avis', 'Seuls les clients qui ont travaillé avec ce développeur sur Palabre peuvent en laisser un.');
    }
    return el('div', { classe: 'panneau-marge' }, [
      el('p', { classe: 'note-moyenne' }, [etoiles(profil.noteMoyenne), ` ${virgule(profil.noteMoyenne)} sur 5, ${profil.nbAvis} avis`]),
      el('ul', { classe: 'liste-avis' }, profil.avis.map((a) => el('li', { classe: 'avis' }, [
        el('p', { classe: 'avis-entete' }, [etoiles(a.note), ' ', el('a', { href: `/${a.client.identifiant}`, texte: a.client.nom }), el('span', { classe: 'texte-discret', texte: `, ${dateRelative(a.creeLe)}` })]),
        a.commentaire ? el('p', { classe: 'avis-texte', texte: a.commentaire }) : null,
        el('p', { classe: 'texte-discret avis-demande', texte: `Demande : ${a.titreDemande}` }),
      ]))),
    ]);
  }

  function ongletAmis(profil, moi) {
    if (!moi) return invitation(profil, 'Connecte-toi pour voir ses amis.');
    const zone = el('div', { classe: 'panneau-marge' });
    const fini = chargement(zone, 2);
    api(`/profils/${encodeURIComponent(profil.identifiant)}/amis`).then(({ amis }) => {
      fini();
      if (!amis.length) {
        zone.replaceChildren(profil.estMoi
          ? etatVide('amis', 'Ton cercle commence ici', 'Ouvre le profil d\'un membre et touche « Ajouter en ami ».',
            el('a', { classe: 'bouton bouton-principal', href: '/chercher' }, [icone('recherche'), 'Trouver des développeurs']))
          : etatVide('amis', 'Pas encore d\'ami', `${prenom(profil)} n'a pas encore d'ami sur Palabre.`));
        return;
      }
      zone.replaceChildren(...[
        el('ul', { classe: 'liste-membres' }, amis.map((ami) => el('li', { classe: 'ligne-membre' }, [
          el('a', { classe: 'lien-avatar', href: `/${ami.identifiant}`, 'aria-label': `Profil de ${ami.nom}` }, [avatar(ami, 'moyen')]),
          el('div', { classe: 'ligne-membre-infos' }, [
            nomMembre(ami),
            el('p', { classe: 'texte-discret', texte: [ami.ville, ami.pays].filter(Boolean).join(', ') }),
          ]),
        ]))),
        profil.estMoi ? el('a', { classe: 'bouton bouton-contour', href: '/amis' }, [icone('amis'), 'Gérer mes amis']) : null,
      ].filter(Boolean));
    }).catch((erreur) => {
      fini();
      zone.replaceChildren(etatVide('calme', 'La liste ne charge pas', erreur.message));
    });
    return zone;
  }

  // Les onglets restent collés en haut de l'écran pendant le défilement (position: sticky dans le CSS).
  function onglets(profil, moi) {
    const estDev = profil.type === 'dev';
    const liste = [
      { id: 'publications', nom: 'Publications', contenu: () => ongletPublications(profil, moi) },
      estDev ? { id: 'projets', nom: 'Projets', contenu: () => ongletProjets(profil) } : null,
      estDev ? { id: 'avis', nom: 'Avis', contenu: () => ongletAvis(profil) } : null,
      { id: 'amis', nom: 'Amis', contenu: () => ongletAmis(profil, moi) },
    ].filter(Boolean);
    // Sans compte, les publications sont fermées : un visiteur arrive sur les projets du dev.
    if (!liste.some((o) => o.id === ongletActif)) ongletActif = !moi && estDev ? 'projets' : 'publications';

    const panneau = el('div', { classe: 'profil-panneau', role: 'tabpanel', id: 'panneau-profil', tabindex: '0' });
    const barre = el('div', { classe: 'onglets-profil', role: 'tablist', 'aria-label': 'Contenu du profil' });
    const boutons = liste.map((onglet) => {
      const bouton = el('button', { classe: 'onglet-profil', type: 'button', role: 'tab', id: `onglet-${onglet.id}`, 'aria-controls': 'panneau-profil', texte: onglet.nom });
      bouton.addEventListener('click', () => choisir(onglet));
      return bouton;
    });
    function choisir(onglet) {
      ongletActif = onglet.id;
      boutons.forEach((b, i) => b.setAttribute('aria-selected', String(liste[i] === onglet)));
      panneau.setAttribute('aria-labelledby', `onglet-${onglet.id}`);
      panneau.replaceChildren(onglet.contenu());
    }
    barre.append(...boutons);
    choisir(liste.find((o) => o.id === ongletActif));
    return [barre, panneau];
  }

  async function afficher() {
    const zone = document.querySelector('[data-profil]');
    try {
      const [{ profil }, moi] = await Promise.all([api(`/profils/${encodeURIComponent(identifiant)}`), utilisateurConnecte()]);
      document.title = `${profil.nom} – Palabre`;
      zone.replaceChildren(...teteProfil(profil), ...onglets(profil, moi));
    } catch (erreur) {
      document.title = 'Profil introuvable – Palabre';
      zone.replaceChildren(etatVide('recherche', 'Profil introuvable',
        erreur.statut === 404 ? 'Ce profil n\'existe pas ou a été supprimé.' : erreur.message,
        el('a', { classe: 'bouton bouton-principal', href: '/chercher', texte: 'Chercher un développeur' })));
    }
  }

  document.addEventListener('DOMContentLoaded', afficher);
})();
