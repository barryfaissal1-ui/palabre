// Tableau de bord administrateur : statistiques, signalements, projets pour Facebook, membres bloqués.
// La page n'est qu'un affichage : c'est le serveur qui refuse tout à un membre qui n'est pas administrateur.
(function () {
  const { t, nombre, REGION, lieuDe, api, el, avatar, utilisateurConnecte, dateRelative, carteProjet, etatVide, confirmer, icone, toast, listeChoix } = window.Palabre;

  const NOMS_CIBLES = { publication: t('publication.titre'), commentaire: t('admin.cible.commentaire'), profil: t('nav.profil'), projet: t('publication.projet'), demande: t('admin.cible.demande'), message: t('admin.cible.message') };

  function message(texte, type) {
    const zone = document.querySelector('[data-message]');
    zone.textContent = texte;
    zone.className = `message ${type || ''}`;
    if (texte) zone.scrollIntoView({ block: 'nearest' });
  }

  // Bouton qui appelle l'API puis recharge tout le tableau de bord.
  function boutonAction(texte, classe, action, { confirmation, succes, danger = false }) {
    const bouton = el('button', { classe: `bouton ${classe}`, type: 'button', texte });
    bouton.addEventListener('click', async () => {
      if (confirmation && !(await confirmer(confirmation, { bouton: texte, danger }))) return;
      bouton.disabled = true;
      try {
        await action();
        await afficher();
        message(succes, 'succes');
      } catch (erreur) {
        message(erreur.message, 'erreur');
        bouton.disabled = false;
      }
    });
    return bouton;
  }

  function lienMembre(membre) {
    return el('a', { href: `/${membre.identifiant}`, texte: membre.nom });
  }

  // ---------- Statistiques ----------
  function sectionStatistiques(s) {
    const tuile = (nombre, libelle) => el('div', { classe: 'tuile' }, [el('dd', { texte: window.Palabre.nombre(nombre) }), el('dt', { texte: libelle })]);
    return el('section', { classe: 'section-profil' }, [
      el('h2', { texte: t('admin.statistiques') }),
      el('dl', { classe: 'tuiles' }, [
        tuile(s.devs, t('admin.developpeurs')),
        tuile(s.clients, t('admin.clients')),
        tuile(s.publications, t('profil.onglet.publications')),
        tuile(s.demandes, t('nav.demandes')),
        tuile(s.projets, t('profil.onglet.projets')),
        tuile(s.propositionsAcceptees, t('admin.propositions-acceptees')),
      ]),
    ]);
  }

  // ---------- Signalements ----------
  function carteSignalement(carte) {
    const { cible } = carte;
    const nombre = carte.signalements.length;
    const traiter = (action) => () => api(`/admin/signalements/${carte.id}/traiter`, { methode: 'POST', donnees: { action } });

    const boutons = [];
    if (cible && cible.masquable && !cible.dejaMasque) {
      boutons.push(boutonAction(t('admin.masquer'), 'bouton-principal', traiter('masquer'), {
        confirmation: t('admin.masquer-question'), succes: t('admin.masque'),
      }));
    }
    if (cible && !cible.membreEstAdmin && !cible.membreBloque) {
      boutons.push(boutonAction(t('admin.bloquer'), 'bouton-or', traiter('bloquer'), {
        confirmation: t('admin.bloquer-question', { nom: cible.membre.nom }),
        succes: t('admin.est-bloque', { nom: cible.membre.nom }), danger: true,
      }));
    }
    boutons.push(boutonAction(t('admin.classer'), 'bouton-contour', traiter('classer'), { succes: t('admin.classe') }));
    // Sanctionner l'auteur (le contenu est caché du même coup) : avertissement, suspension ou exclusion.
    const sanction = cible && !cible.membreEstAdmin && !cible.membreBloque
      ? zoneSanction((choix) => api(`/admin/signalements/${carte.id}/traiter`, { methode: 'POST', donnees: { action: 'sanctionner', ...choix } }), cible.membre.nom)
      : null;

    let contenu;
    if (!cible) {
      contenu = [el('p', { classe: 'texte-discret', texte: t('admin.supprime-par-auteur') })];
    } else {
      const etat = [cible.membreEstAdmin ? t('admin.etat.administrateur') : null, cible.membreBloque ? t('admin.etat.deja-bloque') : null, cible.dejaMasque ? t('admin.etat.deja-masque') : null].filter(Boolean).join(', ');
      contenu = [
        cible.texte ? el('blockquote', { classe: 'contenu-signale', texte: cible.texte }) : null,
        // Le texte a été modifié après coup : les versions d'avant, de la plus récente à la plus ancienne.
        cible.historique && cible.historique.length ? el('div', { classe: 'versions-precedentes' }, [
          el('p', { classe: 'texte-discret', texte: t('admin.versions-precedentes', { n: cible.historique.length }) }),
          ...cible.historique.map((version) => el('blockquote', { classe: 'contenu-signale', texte: version.texte })),
        ]) : null,
        el('p', { classe: 'texte-discret' }, [
          carte.cibleType === 'profil' ? t('admin.profil-de') : t('commun.par'),
          lienMembre(cible.membre),
          etat ? ` (${etat})` : null,
          cible.lien ? ', ' : null,
          cible.lien ? el('a', { href: cible.lien, texte: t('admin.voir-sur-site') }) : null,
        ]),
      ];
    }

    return el('article', { classe: 'carte-publication carte-signalement' }, [
      el('p', { classe: 'publication-meta' }, [
        el('span', { classe: 'type-signalement', texte: NOMS_CIBLES[carte.cibleType] }),
        el('span', { classe: 'texte-discret', texte: t('admin.signale', { n: nombre }) }),
      ]),
      ...contenu,
      el('ul', { classe: 'motifs' }, carte.signalements.map((s) => el('li', {}, [
        el('strong', { texte: s.motif }),
        el('span', { classe: 'texte-discret' }, [', par ', lienMembre(s.auteur), `, ${dateRelative(s.creeLe)}`]),
      ]))),
      el('div', { classe: 'profil-actions' }, boutons),
      sanction,
    ]);
  }

  function sectionSignalements(signalements) {
    return el('section', { classe: 'section-profil', id: 'signalements' }, [
      el('h2', { texte: signalements.length ? t('admin.signalements-n', { n: signalements.length }) : t('admin.signalements') }),
      signalements.length
        ? el('div', { classe: 'liste-publications' }, signalements.map(carteSignalement))
        : el('p', { classe: 'texte-discret', texte: t('admin.aucun-signalement') }),
    ]);
  }

  // ---------- Le filtre automatique : contenus retenus, domaines interdits ----------
  // Le choix d'une sanction : suivre la progression (avertissement, puis suspension de 7 jours, puis exclusion),
  // ou choisir directement une sanction plus forte pour une faute grave. Le motif est lu par le membre.
  function zoneSanction(envoyer, nom) {
    const choix = el('select', { 'aria-label': t('admin.sanction.choix') }, [
      el('option', { value: '', texte: t('admin.sanction.progressive') }),
      el('option', { value: 'avertissement', texte: t('sanctions.type.avertissement') }),
      el('option', { value: 'suspension', texte: t('sanctions.type.suspension') }),
      el('option', { value: 'exclusion', texte: t('sanctions.type.exclusion') }),
    ]);
    const motif = el('input', { type: 'text', maxlength: '300', placeholder: t('admin.sanction.motif'), 'aria-label': t('admin.sanction.motif') });
    const bouton = boutonAction(t('admin.sanction.bouton'), 'bouton-or', () => envoyer({ sanction: choix.value || null, motif: motif.value }), {
      confirmation: t('admin.sanction.question', { nom }), succes: t('admin.sanction.faite', { nom }), danger: true,
    });
    const zone = el('div', { classe: 'zone-sanction' }, [choix, motif, bouton]);
    listeChoix(choix); // une liste créée après le chargement de la page : on l'habille à la main
    return zone;
  }

  const TYPES_ATTENTE = { publication: t('admin.attente.type.publication'), commentaire: t('admin.attente.type.commentaire'), demande: t('admin.attente.type.demande'), projet: t('admin.attente.type.projet') };
  function carteAttente(attente) {
    const decider = (decision) => () => api(`/admin/moderation/attente/${attente.id}`, { methode: 'POST', donnees: { decision } });
    return el('article', { classe: 'publication carte-signalement' }, [
      el('p', { classe: 'publication-meta' }, [
        el('span', { classe: 'type-signalement', texte: TYPES_ATTENTE[attente.cibleType] }),
        el('span', { classe: 'texte-discret' }, [t('commun.par'), lienMembre(attente.auteur), `, ${dateRelative(attente.creeLe)}`]),
      ]),
      // Pourquoi il est là : retenu par le filtre, ou caché par les signalements de plusieurs membres.
      el('p', { classe: 'origine-attente', texte: attente.raison === 'signalements' ? t('admin.attente.origine.signalements', { n: attente.motifs.length }) : t('admin.attente.origine.filtre') }),
      attente.texte ? el('blockquote', { classe: 'contenu-signale', texte: attente.texte }) : null,
      attente.motifs.length ? el('ul', { classe: 'motifs' }, attente.motifs.map((motif) => el('li', { texte: motif }))) : null,
      el('div', { classe: 'profil-actions' }, [
        boutonAction(t('admin.attente.approuver'), 'bouton-principal', decider('approuver'), { succes: t('admin.attente.approuve') }),
        boutonAction(t('admin.attente.retirer'), 'bouton-contour', decider('retirer'), { succes: t('admin.attente.retire') }),
      ]),
      zoneSanction((choix) => api(`/admin/moderation/attente/${attente.id}`, { methode: 'POST', donnees: { decision: 'sanctionner', ...choix } }), attente.auteur.nom),
    ]);
  }
  function sectionAttente(attente) {
    return el('section', { classe: 'section-profil', id: 'a-moderer' }, [
      el('h2', { texte: t('admin.attente.titre') }),
      el('p', { classe: 'texte-discret', texte: t('admin.attente.aide') }),
      attente.length
        ? el('div', { classe: 'liste-publications' }, attente.map(carteAttente))
        : el('p', { classe: 'texte-discret', texte: t('admin.attente.vide') }),
    ]);
  }
  // Les sanctions contestées : le membre a écrit pourquoi, un administrateur annule ou maintient.
  function sectionContestations(contestations) {
    if (!contestations.length) return null;
    return el('section', { classe: 'section-profil', id: 'contestations' }, [
      el('h2', { texte: t('admin.contestations.titre', { n: contestations.length }) }),
      el('div', { classe: 'liste-publications' }, contestations.map((c) => el('article', { classe: 'publication carte-signalement' }, [
        el('p', { classe: 'publication-meta' }, [
          el('span', { classe: 'type-signalement', texte: t(`sanctions.type.${c.type}`) }),
          el('span', { classe: 'texte-discret' }, [lienMembre(c.membre), `, ${dateRelative(c.contesteeLe)}`]),
        ]),
        el('p', {}, [el('span', { classe: 'texte-discret', texte: t('sanctions.motif') }), ' ', el('span', { texte: c.motif })]),
        el('blockquote', { classe: 'contenu-signale', texte: c.texte }),
        el('div', { classe: 'profil-actions' }, [
          boutonAction(t('admin.contestations.annuler'), 'bouton-principal', () => api(`/admin/sanctions/${c.id}/annuler`, { methode: 'POST', donnees: {} }), { confirmation: t('admin.contestations.annuler-question', { nom: c.membre.nom }), succes: t('admin.contestations.annulee') }),
          boutonAction(t('admin.contestations.maintenir'), 'bouton-contour', () => api(`/admin/sanctions/${c.id}/maintenir`, { methode: 'POST', donnees: {} }), { succes: t('admin.contestations.maintenue') }),
        ]),
      ]))),
    ]);
  }

  // Le journal de modération : qui a décidé quoi, quand. Gardé un an par le serveur.
  const ACTIONS_JOURNAL = {
    contenu_approuve: t('admin.journal.contenu-approuve'), contenu_retire: t('admin.journal.contenu-retire'),
    sanction_avertissement: t('admin.journal.avertissement'), sanction_suspension: t('admin.journal.suspension'), sanction_exclusion: t('admin.journal.exclusion'),
    sanction_annulee: t('admin.journal.sanction-annulee'), contestation_rejetee: t('admin.journal.contestation-rejetee'),
    signalement_masquer: t('admin.journal.masquer'), signalement_bloquer: t('admin.journal.bloquer'), signalement_classer: t('admin.journal.classer'),
  };
  function sectionJournal(journal) {
    return el('section', { classe: 'section-profil', id: 'journal-moderation' }, [
      el('h2', { texte: t('admin.journal.titre') }),
      el('p', { classe: 'texte-discret', texte: t('admin.journal.aide') }),
      journal.length
        ? el('ul', { classe: 'liste-journal-moderation' }, journal.slice(0, 30).map((ligne) => el('li', {}, [
          el('strong', { texte: ACTIONS_JOURNAL[ligne.action] || ligne.action }),
          el('span', { classe: 'texte-discret', texte: [ligne.membre ? ligne.membre.nom : null, ligne.detail, ligne.admin ? t('admin.journal.par', { nom: ligne.admin }) : null, dateRelative(ligne.le)].filter(Boolean).join(', ') }),
        ])))
        : el('p', { classe: 'texte-discret', texte: t('admin.journal.vide') }),
    ]);
  }

  function sectionDomaines(domaines) {
    const champ = el('input', { id: 'domaine-interdit', type: 'text', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', maxlength: '100' });
    const formulaire = el('form', { classe: 'formulaire-domaine' }, [
      el('div', { classe: 'champ' }, [el('label', { for: 'domaine-interdit', texte: t('admin.domaines.champ') }), champ]),
      el('button', { classe: 'bouton bouton-contour', type: 'submit', texte: t('admin.domaines.ajouter') }),
    ]);
    formulaire.addEventListener('submit', async (evenement) => {
      evenement.preventDefault();
      try {
        const { domaine } = await api('/admin/domaines-interdits', { methode: 'POST', donnees: { domaine: champ.value } });
        await afficher();
        message(t('admin.domaines.ajoute', { domaine }), 'succes');
      } catch (erreur) {
        message(erreur.message, 'erreur');
      }
    });
    return el('section', { classe: 'section-profil', id: 'domaines' }, [
      el('h2', { texte: t('admin.domaines.titre') }),
      el('p', { classe: 'texte-discret', texte: t('admin.domaines.aide') }),
      formulaire,
      domaines.length
        ? el('ul', { classe: 'liste-domaines' }, domaines.map(({ domaine }) => el('li', {}, [
          el('span', { texte: domaine }),
          boutonAction(t('admin.domaines.retirer'), 'bouton-lien', () => api(`/admin/domaines-interdits/${encodeURIComponent(domaine)}`, { methode: 'DELETE', donnees: {} }), { succes: t('admin.domaines.retire', { domaine }) }),
        ])))
        : el('p', { classe: 'texte-discret', texte: t('admin.domaines.aucun') }),
    ]);
  }

  // ---------- Projets proposés pour Facebook ----------
  function carteFacebook(projet) {
    const decider = (decision) => () => api(`/admin/projets/${projet.id}/facebook`, { methode: 'POST', donnees: { decision } });
    const carte = carteProjet(projet);
    carte.querySelector('.projet-corps').append(...[
      projet.description ? el('p', { classe: 'description-projet', texte: projet.description }) : null,
      projet.lien ? el('p', {}, [el('a', { href: projet.lien, target: '_blank', rel: 'noopener nofollow', texte: t('admin.ouvrir-lien') })]) : null,
      el('div', { classe: 'profil-actions' }, [
        boutonAction(t('admin.valider'), 'bouton-principal', decider('valide'), { succes: t('admin.valide-facebook', { titre: projet.titre }) }),
        boutonAction(t('commun.refuser'), 'bouton-contour', decider('refuse'), { succes: t('admin.refuse-facebook', { titre: projet.titre }) }),
      ]),
    ].filter(Boolean));
    return carte;
  }

  function sectionFacebook(projets) {
    return el('section', { classe: 'section-profil', id: 'facebook' }, [
      el('h2', { texte: projets.length ? t('admin.proposes-n', { n: projets.length }) : t('admin.proposes') }),
      el('p', { classe: 'texte-discret', texte: t('admin.proposes-aide') }),
      projets.length
        ? el('div', { classe: 'liste-publications' }, projets.map(carteFacebook))
        : el('p', { classe: 'texte-discret', texte: t('admin.aucun-projet') }),
    ]);
  }

  // ---------- À publier sur Facebook ----------
  // Le serveur fournit le texte tout prêt et l'adresse de partage. L'administrateur retouche le texte s'il le veut,
  // le copie, ouvre Facebook (la carte du projet s'y dessine toute seule), publie, puis revient cocher « publié ».
  function carteAPublier(projet, complet) {
    const idTexte = `texte-facebook-${projet.id}`;
    const zone = el('textarea', { id: idTexte, rows: 8, classe: 'texte-facebook' });
    zone.value = projet.texte; // .value (comme textContent) : le texte reste du texte, jamais du code
    const copier = el('button', { classe: 'bouton bouton-contour', type: 'button' }, [icone('lien'), t('admin.copier-texte')]);
    copier.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(zone.value);
        toast(t('admin.texte-copie'));
      } catch {
        // Presse-papiers refusé par le navigateur : le texte est sélectionné, il reste à faire « Copier ».
        zone.focus();
        zone.select();
        toast(t('admin.texte-selectionne'), 'erreur');
      }
    });
    const carte = carteProjet(projet);
    carte.querySelector('.projet-corps').append(
      el('div', { classe: 'champ' }, [el('label', { for: idTexte, texte: t('admin.texte-publication') }), zone]),
      el('div', { classe: 'profil-actions' }, [
        copier,
        // noopener : la page Facebook ouverte ne peut pas agir sur l'onglet de Palabre.
        el('a', { classe: 'bouton bouton-contour', href: projet.lienPartage, target: '_blank', rel: 'noopener' }, [icone('facebook'), t('admin.ouvrir-facebook')]),
        complet ? null : boutonAction(t('admin.marquer-publie'), 'bouton-principal',
          () => api(`/admin/projets/${projet.id}/facebook-publie`, { methode: 'POST', donnees: {} }),
          { confirmation: t('admin.marquer-question', { titre: projet.titre }), succes: t('admin.marque-publie', { titre: projet.titre }) }),
      ]),
    );
    return carte;
  }

  function sectionAPublier({ projets, publiesAujourdhui, maxParJour }) {
    const complet = publiesAujourdhui >= maxParJour;
    return el('section', { classe: 'section-profil', id: 'a-publier' }, [
      el('h2', { texte: projets.length ? t('admin.a-publier-n', { n: projets.length }) : t('admin.a-publier') }),
      el('p', { classe: `compteur-facebook${complet ? ' complet' : ''}` }, [el('strong', { texte: t('admin.publies-aujourdhui', { n: publiesAujourdhui, max: maxParJour }) }), complet ? t('admin.maximum') : null]),
      projets.length
        ? el('div', { classe: 'liste-publications' }, projets.map((projet) => carteAPublier(projet, complet)))
        : el('p', { classe: 'texte-discret', texte: t('admin.aucun-valide') }),
    ]);
  }

  // ---------- Membres bloqués ----------
  function sectionBloques(membres) {
    if (membres.length === 0) return null;
    return el('section', { classe: 'section-profil', id: 'bloques' }, [
      el('h2', { texte: t('admin.bloques-n', { n: membres.length }) }),
      el('ul', { classe: 'liste-membres' }, membres.map((membre) => el('li', { classe: 'ligne-membre' }, [
        avatar(membre, 'moyen'),
        el('div', { classe: 'ligne-membre-infos' }, [
          el('p', { classe: 'nom-auteur', texte: membre.nom }),
          el('p', { classe: 'texte-discret', texte: [membre.ville, membre.pays].filter(Boolean).join(', ') }),
        ]),
        el('div', { classe: 'ligne-membre-actions' }, [
          boutonAction(t('messages.debloquer'), 'bouton-contour',
            () => api(`/admin/membres/${encodeURIComponent(membre.identifiant)}/debloquer`, { methode: 'POST', donnees: {} }),
            { confirmation: t('admin.debloquer-question', { nom: membre.nom }), succes: t('admin.peut-se-connecter', { nom: membre.nom }) }),
        ]),
      ]))),
    ]);
  }

  // ---------- Défi de la semaine ----------
  const PHASES_DEFI = { reponses: t('admin.phase.reponses'), vote: t('admin.phase.vote'), termine: t('admin.phase.termine') };
  function sectionDefis(defis) {
    const enCours = defis.some((d) => d.phase !== 'termine');
    const champ = (id, nom, controle, aide) => el('div', { classe: 'champ' }, [el('label', { for: id, texte: nom }), controle, aide ? el('span', { classe: 'aide', texte: aide }) : null, el('p', { classe: 'erreur-champ', 'data-erreur': controle.name })]);
    const titre = el('input', { id: 'defi-titre', name: 'titre', maxlength: 120, required: true });
    const probleme = el('textarea', { id: 'defi-probleme', name: 'probleme', rows: 5, maxlength: 3000, required: true });
    const finReponses = el('input', { id: 'defi-fin-reponses', name: 'finReponsesLe', type: 'datetime-local', required: true });
    const finVote = el('input', { id: 'defi-fin-vote', name: 'finVoteLe', type: 'datetime-local', required: true });
    const zoneMessage = el('p', { classe: 'message', role: 'alert' });
    const bouton = el('button', { classe: 'bouton bouton-principal', type: 'submit', texte: t('admin.lancer-defi') });
    const formulaire = el('form', { classe: 'bloc-formulaire', novalidate: true }, [
      champ('defi-titre', t('admin.titre-defi'), titre),
      champ('defi-probleme', t('admin.probleme'), probleme, t('admin.probleme-aide')),
      el('div', { classe: 'champs-cote-a-cote' }, [
        champ('defi-fin-reponses', t('admin.fin-reponses'), finReponses),
        champ('defi-fin-vote', t('admin.fin-vote'), finVote),
      ]),
      zoneMessage,
      el('div', {}, [bouton]),
    ]);
    formulaire.addEventListener('submit', async (evenement) => {
      evenement.preventDefault();
      formulaire.querySelectorAll('[data-erreur]').forEach((z) => { z.textContent = ''; });
      zoneMessage.textContent = '';
      zoneMessage.className = 'message';
      // Le champ donne l'heure du navigateur ; on l'envoie au serveur en heure universelle (format ISO).
      const versIso = (valeur) => (valeur ? new Date(valeur).toISOString() : '');
      bouton.disabled = true;
      try {
        await api('/admin/defis', { methode: 'POST', donnees: { titre: titre.value, probleme: probleme.value, finReponsesLe: versIso(finReponses.value), finVoteLe: versIso(finVote.value) } });
        await afficher();
        message(t('admin.defi-lance'), 'succes');
      } catch (erreur) {
        const zoneErreur = erreur.champ && formulaire.querySelector(`[data-erreur="${erreur.champ}"]`);
        if (zoneErreur) zoneErreur.textContent = erreur.message;
        else { zoneMessage.textContent = erreur.message; zoneMessage.className = 'message erreur'; }
        bouton.disabled = false;
      }
    });
    const date = (iso) => new Date(iso).toLocaleString(REGION, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    return el('section', { classe: 'section-profil', id: 'defis' }, [
      el('h2', { texte: t('nav.defi') }),
      enCours
        ? el('p', { classe: 'texte-discret', texte: t('admin.defi-en-cours') })
        : formulaire,
      defis.length ? el('ul', { classe: 'liste-membres' }, defis.map((d) => el('li', { classe: 'ligne-membre' }, [
        el('div', { classe: 'ligne-membre-infos' }, [
          el('a', { href: '/defis', texte: d.titre }),
          el('p', { classe: 'texte-discret', texte: [
            PHASES_DEFI[d.phase],
            t('commun.reponses', { n: d.nbReponses }),
            t('defis.votes', { n: d.nbVotes }),
            d.phase === 'reponses' ? t('admin.reponses-jusqu-au', { date: date(d.finReponsesLe) }) : null,
            d.phase !== 'termine' ? t('admin.vote-jusqu-au', { date: date(d.finVoteLe) }) : (d.gagnant ? t('admin.gagnant', { nom: d.gagnant }) : t('admin.pas-de-gagnant')),
          ].filter(Boolean).join(', ') }),
        ]),
        el('div', { classe: 'ligne-membre-actions' }, [
          boutonAction(t('commun.supprimer'), 'bouton-contour', () => api(`/admin/defis/${d.id}`, { methode: 'DELETE', donnees: {} }),
            { confirmation: t('admin.supprimer-defi-question', { titre: d.titre }), succes: t('admin.defi-supprime'), danger: true }),
        ]),
      ]))) : null,
    ]);
  }

  // ---------- Derniers inscrits ----------
  // Ce que seul l'administrateur voit : l'âge des devs et où en est chaque inscription.
  function sectionRecents(membres) {
    if (membres.length === 0) return null;
    const etat = (membre) => {
      if (!membre.emailConfirme) return t('admin.email-non-confirme');
      if (!membre.profilComplet) return t('admin.profil-a-completer');
      if (membre.sansLien) return t('admin.profil-a-confirmer');
      return null;
    };
    return el('section', { classe: 'section-profil', id: 'recents' }, [
      el('h2', { texte: t('admin.derniers-inscrits') }),
      el('ul', { classe: 'liste-membres' }, membres.map((membre) => el('li', { classe: 'ligne-membre' }, [
        avatar(membre, 'moyen'),
        el('div', { classe: 'ligne-membre-infos' }, [
          lienMembre(membre),
          el('p', { classe: 'texte-discret', texte: [
            membre.type === 'dev' ? t('acces.developpeur') : t('commun.client'),
            membre.age !== null ? t('admin.age', { n: membre.age }) : null,
            membre.specialite,
            membre.experience,
            lieuDe(membre),
            t('admin.inscrit', { quand: dateRelative(membre.inscritLe) }),
          ].filter(Boolean).join(', ') }),
          etat(membre) ? el('p', { classe: 'texte-discret etat-inscription', texte: etat(membre) }) : null,
        ]),
      ]))),
    ]);
  }

  async function afficher() {
    const [{ statistiques }, { signalements }, { projets }, { membres }, { membres: recents }, aPublier, { defis }, { attente }, { domaines }, { contestations }, { journal }] = await Promise.all([
      api('/admin/statistiques'), api('/admin/signalements'), api('/admin/projets-facebook'), api('/admin/membres-bloques'), api('/admin/membres-recents'), api('/admin/facebook-a-publier'), api('/admin/defis'),
      api('/admin/moderation/attente'), api('/admin/domaines-interdits'), api('/admin/moderation/contestations'), api('/admin/moderation/journal'),
    ]);
    document.querySelector('[data-admin]').replaceChildren(...[
      sectionStatistiques(statistiques),
      sectionAttente(attente),
      sectionContestations(contestations),
      sectionSignalements(signalements),
      sectionJournal(journal),
      sectionDomaines(domaines),
      sectionFacebook(projets),
      sectionAPublier(aPublier),
      sectionDefis(defis),
      sectionBloques(membres),
      sectionRecents(recents),
    ].filter(Boolean));
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const moi = await utilisateurConnecte();
    if (!moi) {
      window.location.href = '/connexion?suite=/admin';
      return;
    }
    const zone = document.querySelector('[data-admin]');
    if (!moi.estAdmin) {
      zone.replaceChildren(etatVide('calme', t('admin.reservee'), t('admin.reservee-aide'),
        el('a', { classe: 'bouton bouton-principal', href: '/fil', texte: t('admin.retour-fil') })));
      return;
    }
    try {
      await afficher();
    } catch (erreur) {
      zone.replaceChildren();
      message(erreur.message, 'erreur');
    }
  });
})();
