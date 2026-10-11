// Page profil public : palabre.dev/identifiant
// En haut : couverture, photo, nom, chiffres. En dessous, des onglets : Publications, Projets, Avis, Amis.
(function () {
  const {
    t, nombre, lieuDe, api, el, avatar, nomMembre, badgeFeuille, prenom, utilisateurConnecte, signaler, partager, carteProjet, etoiles,
    dateRelative, deNom, reduireImage, icone, etatVide, chargement, toast, confirmer, filPublications, menuOptions, copierLien,
  } = window.Palabre;

  const identifiant = decodeURIComponent(window.location.pathname.slice(1)).toLowerCase();
  const LARGEUR_COUVERTURE = 1200; // la couverture est réduite à 1200 px de large avant l'envoi
  let ongletActif = null;          // gardé quand la page se redessine (après une demande d'ami, par exemple)

  const virgule = (note) => nombre(note); // « 4,5 » en français, « 4.5 » en anglais

  function lienWhatsApp(numero, nom) {
    const chiffres = numero.replace(/\D/g, '');
    const message = t('profil.whatsapp-bonjour', { nom });
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
      return [bouton(t('profil.ajouter-ami'), 'bouton-principal', 'ami-ajouter', () => api('/amis/demandes', { methode: 'POST', donnees: { identifiant: profil.identifiant } }), t('profil.demande-ami-envoyee'))];
    }
    if (profil.amitie === 'envoyee') {
      return [el('button', { classe: 'bouton bouton-contour', type: 'button', disabled: true }, [icone('horloge'), t('commun.demande-envoyee')])];
    }
    if (profil.amitie === 'recue') {
      return [
        bouton(t('profil.accepter-ami'), 'bouton-principal', 'valide', () => api(`/amis/demandes/${cible}/accepter`, { methode: 'POST', donnees: {} }), t('profil.maintenant-amis')),
        bouton(t('commun.refuser'), 'bouton-contour', null, () => api(`/amis/demandes/${cible}/refuser`, { methode: 'POST', donnees: {} }), t('profil.demande-refusee')),
      ];
    }
    return [];
  }

  function actions(profil) {
    const zone = el('div', { classe: 'profil-actions' });
    if (profil.estMoi) {
      zone.append(
        el('a', { classe: 'bouton bouton-principal', href: '/modifier-profil' }, [icone('modifier'), t('profil.modifier')]),
        el('a', { classe: 'bouton bouton-contour', href: '/parametres' }, [icone('parametres'), t('nav.parametres')]),
      );
    } else {
      zone.append(...boutonsAmitie(profil));
      // « amitie » n'existe que pour un membre connecté : un visiteur ne voit pas ce bouton.
      if (profil.amitie) zone.append(el('a', { classe: 'bouton bouton-contour', href: `/messages?avec=${encodeURIComponent(profil.identifiant)}` }, [icone('commentaire'), t('profil.message')]));
      if (profil.whatsapp) {
        zone.append(el('a', {
          classe: `bouton ${profil.amitie === 'aucune' ? 'bouton-contour' : 'bouton-principal'}`,
          href: lienWhatsApp(profil.whatsapp, prenom(profil)),
          target: '_blank',
          rel: 'noopener',
        }, [icone('commentaire'), 'WhatsApp']));
      } else if (profil.whatsappMasque) {
        zone.append(el('a', { classe: 'bouton bouton-principal', href: `/connexion?suite=/${profil.identifiant}`, texte: t('profil.connecter-pour-contacter') }));
      }
    }
    const boutonPartage = el('button', { classe: 'bouton bouton-contour', type: 'button' }, [icone('partager'), t('commun.partager')]);
    const partage = { titre: t('publication.sur-palabre', { nom: profil.nom }), texte: t('profil.partage-texte', { nom: profil.nom, deNom: deNom(profil.nom) }), url: `${window.location.origin}/${profil.identifiant}` };
    boutonPartage.addEventListener('click', () => partager(partage));
    zone.append(boutonPartage);
    // « amitie » n'est renseigné que pour un membre connecté qui regarde le profil de quelqu'un d'autre.
    if (profil.amitie) {
      zone.append(menuOptions(() => [
        { texte: t('commun.partager'), icone: 'partager', action: () => partager(partage) },
        { texte: t('commun.copier-le-lien'), icone: 'lien', action: () => copierLien(`${window.location.origin}/${profil.identifiant}`) },
        { texte: t('signalement.titre'), icone: 'signaler', action: () => signaler('profil', profil.identifiant) },
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
      el('label', { classe: 'bouton bouton-compact bouton-flottant' }, [icone('photo'), t('profil.modifier-couverture'), choisir]),
    ]);
    choisir.addEventListener('change', async () => {
      const fichier = choisir.files[0];
      choisir.value = '';
      if (!fichier) return;
      try {
        const image = await reduireImage(fichier, LARGEUR_COUVERTURE);
        await api('/profils/moi/couverture', { methode: 'POST', donnees: { image } });
        await afficher();
        toast(t('profil.couverture-a-jour'));
      } catch (erreur) {
        toast(erreur.message, 'erreur');
      }
    });
    if (profil.couverture) {
      const retirer = el('button', { classe: 'bouton-icone bouton-flottant', type: 'button', 'aria-label': t('profil.retirer-couverture'), title: t('profil.retirer-couverture') }, [icone('supprimer')]);
      retirer.addEventListener('click', async () => {
        if (!(await confirmer(t('profil.retirer-couverture-question'), { bouton: t('commun.retirer'), danger: true }))) return;
        try {
          await api('/profils/moi/couverture', { methode: 'DELETE', donnees: {} });
          await afficher();
          toast(t('profil.couverture-retiree'));
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
        el('span', { classe: 'pastille pastille-confirmer', texte: t('profil.a-confirmer') }),
        profil.estMoi ? el('a', { href: profil.specialite ? '/modifier-profil' : '/bienvenue', texte: t('profil.ajouter-lien') }) : null,
      ]);
    }
    return el('ul', { classe: 'profil-liens' }, profil.liens.map((lien) => el('li', {}, [
      // noopener : le site ouvert ne peut pas agir sur la page Palabre ; nofollow : pas de coup de pouce au référencement.
      el('a', { classe: 'avec-icone', href: lien.url, target: '_blank', rel: 'noopener nofollow' }, [icone('lien'), lien.nom]),
      lien.verifie ? el('span', { classe: 'badge-verifie' }, [icone('verifie'), t('commun.lien-verifie')]) : null,
    ])));
  }

  // ---------- Haut du profil ----------
  function teteProfil(profil) {
    const estDev = profil.type === 'dev';
    const lieu = lieuDe(profil);
    // Les chiffres. Un client n'a ni projets ni avis : on ne montre que ses amis.
    const chiffre = (nombre, nom) => el('div', {}, [el('dt', { texte: nom }), el('dd', { texte: String(nombre) })]);
    const chiffres = [chiffre(profil.nbAmis, t('profil.chiffre.amis', { n: profil.nbAmis }))];
    if (estDev) {
      chiffres.unshift(chiffre(profil.nbProjetsVerifies, t('profil.chiffre.projets-verifies', { n: profil.nbProjetsVerifies })));
      chiffres.push(chiffre(profil.nbAvis, profil.nbAvis ? t('profil.chiffre.avis-note', { note: virgule(profil.noteMoyenne) }) : t('profil.chiffre.avis')));
    }
    const commun = profil.amisEnCommun;

    // Trois blocs. Sur téléphone ils se suivent, comme une seule carte. Sur ordinateur (CSS), les actions viennent
    // à droite du nom, et la présentation forme une colonne à gauche du contenu des onglets.
    const tete = el('section', { classe: 'profil-tete' }, [
      couverture(profil),
      el('div', { classe: 'profil-identite' }, [
        avatar(profil, 'profil'),
        el('h1', { classe: 'profil-nom' }, [profil.nom, profil.nbProjetsVerifies > 0 ? badgeFeuille() : null]),
        el('p', { classe: 'profil-lieu' }, [icone('lieu'), t(estDev ? 'profil.dev-a' : 'profil.client-a', { lieu })]),
      ]),
    ]);
    const presentation = el('section', { classe: 'profil-presentation', 'aria-labelledby': 'titre-presentation' }, [
      el('h2', { id: 'titre-presentation', texte: t('profil.presentation') }),
      profil.bio ? el('p', { classe: 'profil-bio', texte: profil.bio }) : null,
      // Profil de dev : « Développement web, 3 à 5 ans d'expérience ».
      estDev && profil.specialiteNom
        ? el('p', { classe: 'profil-metier avec-icone' }, [icone('devs'), [profil.specialite ? t(`specialite.${profil.specialite}`) : null, profil.experience ? t('profil.d-experience', { duree: t(`experience.${profil.experience}`).toLowerCase() }) : null].filter(Boolean).join(', ')])
        : null,
      liensDev(profil),
      profil.nbDefisGagnes > 0
        ? el('a', { classe: 'pastille pastille-gagnant', href: '/defis' }, [icone('trophee'), profil.nbDefisGagnes > 1 ? t('profil.gagnant-defis', { n: profil.nbDefisGagnes }) : t('profil.gagnant-defi')])
        : null,
      estDev
        ? el('span', { classe: `pastille ${profil.disponible ? 'pastille-dispo' : 'pastille-occupe'}`, texte: profil.disponible ? t('profil.disponible') : t('profil.occupe') })
        : null,
      estDev && profil.competences.length ? el('ul', { classe: 'puces' }, profil.competences.map((c) => el('li', { texte: c.nom }))) : null,
      estDev && profil.estMoi && !profil.competences.length
        ? el('p', { classe: 'texte-discret', texte: t('profil.ajoute-competences') }) : null,
      // Le numéro n'est envoyé par le serveur qu'aux membres connectés.
      profil.whatsapp && !profil.estMoi
        ? el('p', { classe: 'presentation-whatsapp avec-icone' }, [icone('commentaire'), 'WhatsApp : ', el('a', { href: lienWhatsApp(profil.whatsapp, prenom(profil)), target: '_blank', rel: 'noopener', texte: profil.whatsapp })])
        : null,
      el('dl', { classe: 'profil-chiffres' }, chiffres),
    ]);
    const zoneActions = el('div', { classe: 'profil-zone-actions' }, [
      profil.amitie === 'amis' ? el('p', { classe: 'profil-lien avec-icone' }, [icone('valide'), t('profil.vous-etes-amis')]) : null,
      commun ? el('p', { classe: 'profil-lien avec-icone' }, [icone('amis'), `${commun} ${pluriel(commun, 'ami')} en commun`]) : null,
      actions(profil),
    ]);
    return [tete, presentation, zoneActions];
  }

  // ---------- Onglets ----------
  const invitation = (profil, texte) => etatVide('amis', t('profil.reserve-membres'), texte,
    el('a', { classe: 'bouton bouton-principal', href: `/connexion?suite=/${profil.identifiant}`, texte: t('nav.se-connecter') }));

  function ongletPublications(profil, moi) {
    if (!moi) return invitation(profil, t('profil.connecte-publications', { prenom: prenom(profil), dePrenom: deNom(prenom(profil)) }));
    const zone = el('div', { classe: 'fil-social' });
    const etat = el('div', { role: 'status', hidden: true });
    const boutonPlus = el('button', { classe: 'bouton bouton-contour bouton-plein charger-plus', type: 'button', hidden: true, texte: t('fil.voir-plus') });
    // Le bloc est créé AVANT le fil : chargementInfini() pose son repère juste après « zone », il lui faut un parent.
    const bloc = el('div', {}, [zone, etat, boutonPlus]);
    const fil = filPublications({
      zone, etat, boutonPlus,
      fin: t('profil.toutes-publications-vues'),
      parametres: () => ({ auteur: profil.identifiant }),
      vide: () => (profil.estMoi
        ? etatVide('palabre', t('profil.rien-publie-moi'), t('profil.rien-publie-moi-aide'),
          el('a', { classe: 'bouton bouton-principal', href: '/fil' }, [icone('plus'), t('profil.publier-dans-fil')]))
        : etatVide('palabre', t('profil.pas-de-publication'), t('profil.rien-publie', { prenom: prenom(profil) }))),
    });
    fil.charger();
    return bloc;
  }

  function ongletProjets(profil) {
    const gerer = profil.estMoi
      ? el('a', { classe: 'bouton bouton-contour', href: '/projets' }, [icone(profil.projets.length ? 'modifier' : 'plus'), profil.projets.length ? t('profil.gerer-projets') : t('profil.premier-projet')])
      : null;
    if (!profil.projets.length) {
      return profil.estMoi
        ? etatVide('projets', t('profil.montre'), t('profil.montre-aide'), gerer)
        : etatVide('projets', t('profil.pas-de-realisation'), t('profil.pas-de-projet', { prenom: prenom(profil) }));
    }
    return el('div', { classe: 'panneau-marge' }, [
      el('div', { classe: 'grille-projets' }, profil.projets.map((p) => carteProjet(p, { avecDev: false }))),
      gerer,
    ]);
  }

  // Avis laissés par de vrais clients : chacun correspond à une demande terminée et attribuée à ce dev.
  function ongletAvis(profil) {
    if (!profil.nbAvis) {
      return etatVide('calme', t('profil.pas-d-avis'), t('profil.pas-d-avis-aide'));
    }
    return el('div', { classe: 'panneau-marge' }, [
      el('p', { classe: 'note-moyenne' }, [etoiles(profil.noteMoyenne), t('profil.note-moyenne', { note: virgule(profil.noteMoyenne), n: profil.nbAvis })]),
      el('ul', { classe: 'liste-avis' }, profil.avis.map((a) => el('li', { classe: t('profil.chiffre.avis') }, [
        el('p', { classe: 'avis-entete' }, [etoiles(a.note), ' ', el('a', { href: `/${a.client.identifiant}`, texte: a.client.nom }), el('span', { classe: 'texte-discret', texte: `, ${dateRelative(a.creeLe)}` })]),
        a.commentaire ? el('p', { classe: 'avis-texte', texte: a.commentaire }) : null,
        a.titreDemande ? el('p', { classe: 'texte-discret avis-demande', texte: t('profil.avis-demande', { titre: a.titreDemande }) }) : null,
      ]))),
    ]);
  }

  function ongletAmis(profil, moi) {
    if (!moi) return invitation(profil, t('profil.connecte-amis'));
    const zone = el('div', { classe: 'panneau-marge' });
    const fini = chargement(zone, 2);
    api(`/profils/${encodeURIComponent(profil.identifiant)}/amis`).then(({ amis }) => {
      fini();
      if (!amis.length) {
        zone.replaceChildren(profil.estMoi
          ? etatVide('amis', t('amis.cercle'), t('profil.cercle-aide'),
            el('a', { classe: 'bouton bouton-principal', href: '/chercher' }, [icone('recherche'), t('fil.trouver-devs')]))
          : etatVide('amis', t('profil.pas-d-ami'), t('profil.pas-d-ami-texte', { prenom: prenom(profil) })));
        return;
      }
      zone.replaceChildren(...[
        el('ul', { classe: 'liste-membres' }, amis.map((ami) => el('li', { classe: 'ligne-membre' }, [
          el('a', { classe: 'lien-avatar', href: `/${ami.identifiant}`, 'aria-label': t('commun.profil-de', { nom: ami.nom, deNom: deNom(ami.nom) }) }, [avatar(ami, 'moyen')]),
          el('div', { classe: 'ligne-membre-infos' }, [
            nomMembre(ami),
            el('p', { classe: 'texte-discret', texte: [ami.ville, ami.pays].filter(Boolean).join(', ') }),
          ]),
        ]))),
        profil.estMoi ? el('a', { classe: 'bouton bouton-contour', href: '/amis' }, [icone('amis'), t('profil.gerer-amis')]) : null,
      ].filter(Boolean));
    }).catch((erreur) => {
      fini();
      zone.replaceChildren(etatVide('calme', t('profil.liste-ne-charge-pas'), erreur.message));
    });
    return zone;
  }

  // Les onglets restent collés en haut de l'écran pendant le défilement (position: sticky dans le CSS).
  function onglets(profil, moi) {
    const estDev = profil.type === 'dev';
    const liste = [
      { id: 'publications', nom: t('profil.onglet.publications'), contenu: () => ongletPublications(profil, moi) },
      estDev ? { id: 'projets', nom: t('profil.onglet.projets'), contenu: () => ongletProjets(profil) } : null,
      estDev ? { id: t('profil.chiffre.avis'), nom: t('profil.onglet.avis'), contenu: () => ongletAvis(profil) } : null,
      { id: 'amis', nom: t('nav.amis'), contenu: () => ongletAmis(profil, moi) },
    ].filter(Boolean);
    // Sans compte, les publications sont fermées : un visiteur arrive sur les projets du dev.
    if (!liste.some((o) => o.id === ongletActif)) ongletActif = !moi && estDev ? 'projets' : 'publications';

    const panneau = el('div', { classe: 'profil-panneau', role: 'tabpanel', id: 'panneau-profil', tabindex: '0' });
    const barre = el('div', { classe: 'onglets-profil', role: 'tablist', 'aria-label': t('profil.contenu') });
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
      document.title = t('profil.introuvable-titre');
      zone.replaceChildren(etatVide('recherche', t('profil.introuvable'),
        erreur.statut === 404 ? t('profil.introuvable-aide') : erreur.message,
        el('a', { classe: 'bouton bouton-principal', href: '/chercher', texte: t('cote.chercher-dev') })));
    }
  }

  document.addEventListener('DOMContentLoaded', afficher);
})();
