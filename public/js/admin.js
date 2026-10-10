// Tableau de bord administrateur : statistiques, signalements, projets pour Facebook, membres bloqués.
// La page n'est qu'un affichage : c'est le serveur qui refuse tout à un membre qui n'est pas administrateur.
(function () {
  const { api, el, avatar, utilisateurConnecte, dateRelative, carteProjet, etatVide, confirmer, icone, toast } = window.Palabre;

  const NOMS_CIBLES = { publication: 'Publication', commentaire: 'Commentaire', profil: 'Profil', projet: 'Projet', demande: 'Demande', message: 'Message privé' };

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
    const tuile = (nombre, libelle) => el('div', { classe: 'tuile' }, [el('dd', { texte: nombre.toLocaleString('fr-FR') }), el('dt', { texte: libelle })]);
    return el('section', { classe: 'section-profil' }, [
      el('h2', { texte: 'Statistiques' }),
      el('dl', { classe: 'tuiles' }, [
        tuile(s.devs, 'Développeurs'),
        tuile(s.clients, 'Clients'),
        tuile(s.publications, 'Publications'),
        tuile(s.demandes, 'Demandes'),
        tuile(s.projets, 'Projets'),
        tuile(s.propositionsAcceptees, 'Propositions acceptées'),
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
      boutons.push(boutonAction('Masquer le contenu', 'bouton-principal', traiter('masquer'), {
        confirmation: 'Masquer ce contenu ? Plus personne ne le verra sur Palabre.', succes: 'Contenu masqué.',
      }));
    }
    if (cible && !cible.membreEstAdmin && !cible.membreBloque) {
      boutons.push(boutonAction('Bloquer le membre', 'bouton-or', traiter('bloquer'), {
        confirmation: `Bloquer ${cible.membre.nom} ? Ce membre ne pourra plus se connecter et tout ce qu'il a publié disparaîtra.`,
        succes: `${cible.membre.nom} est bloqué.`, danger: true,
      }));
    }
    boutons.push(boutonAction('Classer sans suite', 'bouton-contour', traiter('classer'), { succes: 'Signalement classé sans suite.' }));

    let contenu;
    if (!cible) {
      contenu = [el('p', { classe: 'texte-discret', texte: 'Ce contenu a été supprimé par son auteur. Il ne reste qu\'à classer le signalement.' })];
    } else {
      const etat = [cible.membreEstAdmin ? 'administrateur' : null, cible.membreBloque ? 'déjà bloqué' : null, cible.dejaMasque ? 'contenu déjà masqué' : null].filter(Boolean).join(', ');
      contenu = [
        cible.texte ? el('blockquote', { classe: 'contenu-signale', texte: cible.texte }) : null,
        el('p', { classe: 'texte-discret' }, [
          carte.cibleType === 'profil' ? 'Profil de ' : 'Par ',
          lienMembre(cible.membre),
          etat ? ` (${etat})` : null,
          cible.lien ? ', ' : null,
          cible.lien ? el('a', { href: cible.lien, texte: 'Voir sur le site' }) : null,
        ]),
      ];
    }

    return el('article', { classe: 'carte-publication carte-signalement' }, [
      el('p', { classe: 'publication-meta' }, [
        el('span', { classe: 'type-signalement', texte: NOMS_CIBLES[carte.cibleType] }),
        el('span', { classe: 'texte-discret', texte: nombre > 1 ? `, signalé ${nombre} fois` : ', signalé 1 fois' }),
      ]),
      ...contenu,
      el('ul', { classe: 'motifs' }, carte.signalements.map((s) => el('li', {}, [
        el('strong', { texte: s.motif }),
        el('span', { classe: 'texte-discret' }, [', par ', lienMembre(s.auteur), `, ${dateRelative(s.creeLe)}`]),
      ]))),
      el('div', { classe: 'profil-actions' }, boutons),
    ]);
  }

  function sectionSignalements(signalements) {
    return el('section', { classe: 'section-profil', id: 'signalements' }, [
      el('h2', { texte: signalements.length ? `Signalements à traiter (${signalements.length})` : 'Signalements à traiter' }),
      signalements.length
        ? el('div', { classe: 'liste-publications' }, signalements.map(carteSignalement))
        : el('p', { classe: 'texte-discret', texte: 'Aucun signalement en attente.' }),
    ]);
  }

  // ---------- Projets proposés pour Facebook ----------
  function carteFacebook(projet) {
    const decider = (decision) => () => api(`/admin/projets/${projet.id}/facebook`, { methode: 'POST', donnees: { decision } });
    const carte = carteProjet(projet);
    carte.querySelector('.projet-corps').append(...[
      projet.description ? el('p', { classe: 'description-projet', texte: projet.description }) : null,
      projet.lien ? el('p', {}, [el('a', { href: projet.lien, target: '_blank', rel: 'noopener nofollow', texte: 'Ouvrir le lien du projet' })]) : null,
      el('div', { classe: 'profil-actions' }, [
        boutonAction('Valider', 'bouton-principal', decider('valide'), { succes: `« ${projet.titre} » est validé pour Facebook.` }),
        boutonAction('Refuser', 'bouton-contour', decider('refuse'), { succes: `« ${projet.titre} » est refusé pour Facebook. Il reste visible sur Palabre.` }),
      ]),
    ].filter(Boolean));
    return carte;
  }

  function sectionFacebook(projets) {
    return el('section', { classe: 'section-profil', id: 'facebook' }, [
      el('h2', { texte: projets.length ? `Projets proposés pour Facebook (${projets.length})` : 'Projets proposés pour Facebook' }),
      el('p', { classe: 'texte-discret', texte: 'Ces développeurs ont accepté que leur projet soit présenté sur la page « Palabre Dev ». Valide ceux qui donnent une bonne image de la plateforme.' }),
      projets.length
        ? el('div', { classe: 'liste-publications' }, projets.map(carteFacebook))
        : el('p', { classe: 'texte-discret', texte: 'Aucun projet en attente.' }),
    ]);
  }

  // ---------- À publier sur Facebook ----------
  // Le serveur fournit le texte tout prêt et l'adresse de partage. L'administrateur retouche le texte s'il le veut,
  // le copie, ouvre Facebook (la carte du projet s'y dessine toute seule), publie, puis revient cocher « publié ».
  function carteAPublier(projet, complet) {
    const idTexte = `texte-facebook-${projet.id}`;
    const zone = el('textarea', { id: idTexte, rows: 8, classe: 'texte-facebook' });
    zone.value = projet.texte; // .value (comme textContent) : le texte reste du texte, jamais du code
    const copier = el('button', { classe: 'bouton bouton-contour', type: 'button' }, [icone('lien'), 'Copier le texte']);
    copier.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(zone.value);
        toast('Texte copié. Colle-le dans la publication Facebook.');
      } catch {
        // Presse-papiers refusé par le navigateur : le texte est sélectionné, il reste à faire « Copier ».
        zone.focus();
        zone.select();
        toast('Le texte est sélectionné : copie-le avec ton clavier.', 'erreur');
      }
    });
    const carte = carteProjet(projet);
    carte.querySelector('.projet-corps').append(
      el('div', { classe: 'champ' }, [el('label', { for: idTexte, texte: 'Texte de la publication (modifiable)' }), zone]),
      el('div', { classe: 'profil-actions' }, [
        copier,
        // noopener : la page Facebook ouverte ne peut pas agir sur l'onglet de Palabre.
        el('a', { classe: 'bouton bouton-contour', href: projet.lienPartage, target: '_blank', rel: 'noopener' }, [icone('facebook'), 'Ouvrir Facebook']),
        complet ? null : boutonAction('Marquer comme publié', 'bouton-principal',
          () => api(`/admin/projets/${projet.id}/facebook-publie`, { methode: 'POST', donnees: {} }),
          { confirmation: `Marquer « ${projet.titre} » comme publié ? À faire seulement après l'avoir vraiment publié sur la page Facebook : le développeur sera prévenu.`, succes: `« ${projet.titre} » est marqué comme publié. Son développeur est prévenu.` }),
      ]),
    );
    return carte;
  }

  function sectionAPublier({ projets, publiesAujourdhui, maxParJour }) {
    const complet = publiesAujourdhui >= maxParJour;
    return el('section', { classe: 'section-profil', id: 'a-publier' }, [
      el('h2', { texte: projets.length ? `À publier sur Facebook (${projets.length})` : 'À publier sur Facebook' }),
      el('p', { classe: `compteur-facebook${complet ? ' complet' : ''}` }, [el('strong', { texte: `Publiés aujourd'hui : ${publiesAujourdhui} / ${maxParJour}` }), complet ? ' Maximum atteint, reprends demain.' : null]),
      projets.length
        ? el('div', { classe: 'liste-publications' }, projets.map((projet) => carteAPublier(projet, complet)))
        : el('p', { classe: 'texte-discret', texte: 'Aucun projet validé en attente de publication.' }),
    ]);
  }

  // ---------- Membres bloqués ----------
  function sectionBloques(membres) {
    if (membres.length === 0) return null;
    return el('section', { classe: 'section-profil', id: 'bloques' }, [
      el('h2', { texte: `Membres bloqués (${membres.length})` }),
      el('ul', { classe: 'liste-membres' }, membres.map((membre) => el('li', { classe: 'ligne-membre' }, [
        avatar(membre, 'moyen'),
        el('div', { classe: 'ligne-membre-infos' }, [
          el('p', { classe: 'nom-auteur', texte: membre.nom }),
          el('p', { classe: 'texte-discret', texte: [membre.ville, membre.pays].filter(Boolean).join(', ') }),
        ]),
        el('div', { classe: 'ligne-membre-actions' }, [
          boutonAction('Débloquer', 'bouton-contour',
            () => api(`/admin/membres/${encodeURIComponent(membre.identifiant)}/debloquer`, { methode: 'POST', donnees: {} }),
            { confirmation: `Débloquer ${membre.nom} ?`, succes: `${membre.nom} peut de nouveau se connecter.` }),
        ]),
      ]))),
    ]);
  }

  // ---------- Défi de la semaine ----------
  const PHASES_DEFI = { reponses: 'réponses ouvertes', vote: 'vote en cours', termine: 'terminé' };
  function sectionDefis(defis) {
    const enCours = defis.some((d) => d.phase !== 'termine');
    const champ = (id, nom, controle, aide) => el('div', { classe: 'champ' }, [el('label', { for: id, texte: nom }), controle, aide ? el('span', { classe: 'aide', texte: aide }) : null, el('p', { classe: 'erreur-champ', 'data-erreur': controle.name })]);
    const titre = el('input', { id: 'defi-titre', name: 'titre', maxlength: 120, required: true });
    const probleme = el('textarea', { id: 'defi-probleme', name: 'probleme', rows: 5, maxlength: 3000, required: true });
    const finReponses = el('input', { id: 'defi-fin-reponses', name: 'finReponsesLe', type: 'datetime-local', required: true });
    const finVote = el('input', { id: 'defi-fin-vote', name: 'finVoteLe', type: 'datetime-local', required: true });
    const zoneMessage = el('p', { classe: 'message', role: 'alert' });
    const bouton = el('button', { classe: 'bouton bouton-principal', type: 'submit', texte: 'Lancer le défi' });
    const formulaire = el('form', { classe: 'bloc-formulaire', novalidate: true }, [
      champ('defi-titre', 'Titre du défi', titre),
      champ('defi-probleme', 'Problème à résoudre', probleme, 'Un problème concret, que plusieurs solutions peuvent résoudre.'),
      el('div', { classe: 'champs-cote-a-cote' }, [
        champ('defi-fin-reponses', 'Fin des réponses', finReponses),
        champ('defi-fin-vote', 'Fin du vote', finVote),
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
        message('Le défi est lancé. Il apparaît sur /defis, dans le fil et dans la colonne de droite.', 'succes');
      } catch (erreur) {
        const zoneErreur = erreur.champ && formulaire.querySelector(`[data-erreur="${erreur.champ}"]`);
        if (zoneErreur) zoneErreur.textContent = erreur.message;
        else { zoneMessage.textContent = erreur.message; zoneMessage.className = 'message erreur'; }
        bouton.disabled = false;
      }
    });
    const date = (iso) => new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    return el('section', { classe: 'section-profil', id: 'defis' }, [
      el('h2', { texte: 'Défi de la semaine' }),
      enCours
        ? el('p', { classe: 'texte-discret', texte: 'Un défi est en cours. Le suivant pourra être lancé quand il sera terminé (ou supprimé).' })
        : formulaire,
      defis.length ? el('ul', { classe: 'liste-membres' }, defis.map((d) => el('li', { classe: 'ligne-membre' }, [
        el('div', { classe: 'ligne-membre-infos' }, [
          el('a', { href: '/defis', texte: d.titre }),
          el('p', { classe: 'texte-discret', texte: [
            PHASES_DEFI[d.phase],
            `${d.nbReponses} réponse${d.nbReponses > 1 ? 's' : ''}`,
            `${d.nbVotes} vote${d.nbVotes > 1 ? 's' : ''}`,
            d.phase === 'reponses' ? `réponses jusqu'au ${date(d.finReponsesLe)}` : null,
            d.phase !== 'termine' ? `vote jusqu'au ${date(d.finVoteLe)}` : (d.gagnant ? `gagnant : ${d.gagnant}` : 'pas de gagnant'),
          ].filter(Boolean).join(', ') }),
        ]),
        el('div', { classe: 'ligne-membre-actions' }, [
          boutonAction('Supprimer', 'bouton-contour', () => api(`/admin/defis/${d.id}`, { methode: 'DELETE', donnees: {} }),
            { confirmation: `Supprimer le défi « ${d.titre} » ? Ses réponses et ses votes seront supprimés aussi.`, succes: 'Défi supprimé.', danger: true }),
        ]),
      ]))) : null,
    ]);
  }

  // ---------- Derniers inscrits ----------
  // Ce que seul l'administrateur voit : l'âge des devs et où en est chaque inscription.
  function sectionRecents(membres) {
    if (membres.length === 0) return null;
    const etat = (membre) => {
      if (!membre.emailConfirme) return 'Email non confirmé';
      if (!membre.profilComplet) return 'Profil de dev à compléter';
      if (membre.sansLien) return 'Profil à confirmer (aucun lien)';
      return null;
    };
    return el('section', { classe: 'section-profil', id: 'recents' }, [
      el('h2', { texte: 'Derniers inscrits' }),
      el('ul', { classe: 'liste-membres' }, membres.map((membre) => el('li', { classe: 'ligne-membre' }, [
        avatar(membre, 'moyen'),
        el('div', { classe: 'ligne-membre-infos' }, [
          lienMembre(membre),
          el('p', { classe: 'texte-discret', texte: [
            membre.type === 'dev' ? 'Développeur' : 'Client',
            membre.age !== null ? `${membre.age} ans` : null,
            membre.specialite,
            membre.experience,
            [membre.ville, membre.pays].filter(Boolean).join(', '),
            `inscrit ${dateRelative(membre.inscritLe)}`,
          ].filter(Boolean).join(', ') }),
          etat(membre) ? el('p', { classe: 'texte-discret etat-inscription', texte: etat(membre) }) : null,
        ]),
      ]))),
    ]);
  }

  async function afficher() {
    const [{ statistiques }, { signalements }, { projets }, { membres }, { membres: recents }, aPublier, { defis }] = await Promise.all([
      api('/admin/statistiques'), api('/admin/signalements'), api('/admin/projets-facebook'), api('/admin/membres-bloques'), api('/admin/membres-recents'), api('/admin/facebook-a-publier'), api('/admin/defis'),
    ]);
    document.querySelector('[data-admin]').replaceChildren(...[
      sectionStatistiques(statistiques),
      sectionSignalements(signalements),
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
      zone.replaceChildren(etatVide('calme', 'Page réservée', 'Cette page est réservée aux administrateurs de Palabre.',
        el('a', { classe: 'bouton bouton-principal', href: '/fil', texte: 'Retour au fil' })));
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
