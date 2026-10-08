// Tableau de bord administrateur : statistiques, signalements, projets pour Facebook, membres bloqués.
// La page n'est qu'un affichage : c'est le serveur qui refuse tout à un membre qui n'est pas administrateur.
(function () {
  const { api, el, avatar, utilisateurConnecte, dateRelative, carteProjet } = window.Palabre;

  const NOMS_CIBLES = { publication: 'Publication', commentaire: 'Commentaire', profil: 'Profil', projet: 'Projet', demande: 'Demande' };

  function message(texte, type) {
    const zone = document.querySelector('[data-message]');
    zone.textContent = texte;
    zone.className = `message ${type || ''}`;
    if (texte) zone.scrollIntoView({ block: 'nearest' });
  }

  // Bouton qui appelle l'API puis recharge tout le tableau de bord.
  function boutonAction(texte, classe, action, { confirmation, succes }) {
    const bouton = el('button', { classe: `bouton ${classe}`, type: 'button', texte });
    bouton.addEventListener('click', async () => {
      if (confirmation && !window.confirm(confirmation)) return;
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
        succes: `${cible.membre.nom} est bloqué.`,
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
          cible.lien ? ' · ' : null,
          cible.lien ? el('a', { href: cible.lien, texte: 'Voir sur le site' }) : null,
        ]),
      ];
    }

    return el('article', { classe: 'carte-publication carte-signalement' }, [
      el('p', { classe: 'publication-meta' }, [
        el('span', { classe: 'type-signalement', texte: NOMS_CIBLES[carte.cibleType] }),
        el('span', { classe: 'texte-discret', texte: nombre > 1 ? ` · signalé ${nombre} fois` : ' · signalé 1 fois' }),
      ]),
      ...contenu,
      el('ul', { classe: 'motifs' }, carte.signalements.map((s) => el('li', {}, [
        el('strong', { texte: s.motif }),
        el('span', { classe: 'texte-discret' }, [' — ', lienMembre(s.auteur), ` · ${dateRelative(s.creeLe)}`]),
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

  async function afficher() {
    const [{ statistiques }, { signalements }, { projets }, { membres }] = await Promise.all([
      api('/admin/statistiques'), api('/admin/signalements'), api('/admin/projets-facebook'), api('/admin/membres-bloques'),
    ]);
    document.querySelector('[data-admin]').replaceChildren(...[
      sectionStatistiques(statistiques),
      sectionSignalements(signalements),
      sectionFacebook(projets),
      sectionBloques(membres),
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
      zone.replaceChildren(el('div', { classe: 'vide' }, [
        el('p', { texte: 'Cette page est réservée aux administrateurs de Palabre.' }),
        el('a', { classe: 'bouton bouton-principal', href: '/fil', texte: 'Retour au fil' }),
      ]));
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
