// Page d'une demande : le client compare et choisit ; le dev propose seul ou forme une équipe éclair.
(function () {
  const { api, el, avatar, utilisateurConnecte, dateRelative, deNom, fcfa, signaler, etatVide, confirmer, icone, nomMembre } = window.Palabre;

  const id = new URLSearchParams(window.location.search).get('id');
  const NOMS_STATUTS = { ouverte: 'Ouverte', attribuee: 'Attribuée', terminee: 'Terminée', annulee: 'Annulée' };
  const NOMS_PROPOSITIONS = {
    brouillon: 'En attente des réponses de l\'équipe',
    envoyee: 'Envoyée au client',
    acceptee: 'Choisie par le client',
    refusee: 'Non retenue',
  };
  const NOMS_REPONSES = { invite: 'n\'a pas encore répondu', accepte: 'a accepté', refuse: 'a refusé' };
  let moi = null;

  function message(texte, type) {
    const zone = document.querySelector('[data-message]');
    zone.textContent = texte;
    zone.className = `message ${type || ''}`;
    if (texte) zone.scrollIntoView({ block: 'nearest' });
  }

  // Bouton qui appelle l'API puis réaffiche la page. « confirmation » : question posée avant d'agir.
  function boutonAction(texte, classe, action, { confirmation, succes, danger = false } = {}) {
    const bouton = el('button', { classe: `bouton ${classe}`, type: 'button', texte });
    bouton.addEventListener('click', async () => {
      if (confirmation && !(await confirmer(confirmation, { danger }))) return;
      bouton.disabled = true;
      try {
        await action();
        await afficher();
        message(succes || '', 'succes');
      } catch (erreur) {
        message(erreur.message, 'erreur');
        bouton.disabled = false;
      }
    });
    return bouton;
  }

  function ligneMembre(membre, { avecReponse }) {
    const precision = membre.estChef ? 'chef d\'équipe' : (avecReponse ? NOMS_REPONSES[membre.statut] : '');
    return el('li', { classe: 'membre-equipe' }, [
      el('a', { classe: 'lien-avatar', href: `/${membre.identifiant}`, 'aria-label': `Profil de ${membre.nom}` }, [avatar(membre, 'mini')]),
      el('div', {}, [
        nomMembre(membre),
        el('p', { classe: 'texte-discret', texte: precision ? `${membre.role}, ${precision}` : membre.role }),
      ]),
    ]);
  }

  // Une proposition : son auteur (ou son équipe), son message, son montant, puis les boutons selon la situation.
  function carteProposition(proposition, boutons, { avecReponses = false } = {}) {
    const qui = proposition.equipe
      ? [
        el('h3', { texte: `Équipe éclair ${deNom(proposition.auteur.nom)}` }),
        el('ul', { classe: 'liste-equipe' }, proposition.equipe.membres.map((m) => ligneMembre(m, { avecReponse: avecReponses }))),
      ]
      : [
        el('div', { classe: 'publication-entete' }, [
          el('a', { classe: 'lien-avatar', href: `/${proposition.auteur.identifiant}`, 'aria-label': `Profil de ${proposition.auteur.nom}` }, [avatar(proposition.auteur, 'moyen')]),
          el('div', {}, [
            nomMembre(proposition.auteur),
            el('p', { classe: 'texte-discret publication-meta', texte: [proposition.auteur.ville, proposition.auteur.pays].filter(Boolean).join(', ') }),
          ]),
        ]),
      ];
    return el('article', { classe: `carte-publication carte-proposition proposition-${proposition.statut}` }, [
      el('p', { classe: 'publication-meta' }, [
        el('span', { classe: `statut-proposition statut-${proposition.statut}`, texte: NOMS_PROPOSITIONS[proposition.statut] }),
      ]),
      ...qui,
      el('p', { classe: 'publication-texte', texte: proposition.message }),
      el('p', { classe: 'montant' }, [el('span', { classe: 'texte-discret', texte: 'Montant proposé : ' }), fcfa(proposition.montantFcfa)]),
      boutons.length ? el('div', { classe: 'profil-actions' }, boutons) : null,
    ]);
  }

  function enteteDemande(demande) {
    return el('section', { classe: 'carte-profil' }, [
      el('p', { classe: 'publication-meta' }, [
        el('span', { classe: `statut-demande statut-${demande.statut}`, texte: NOMS_STATUTS[demande.statut] }),
        el('span', { classe: 'texte-discret', texte: ` ${demande.nomCategorie}, ${dateRelative(demande.creeLe)}` }),
      ]),
      el('h1', { classe: 'titre-demande', texte: demande.titre }),
      el('p', { classe: 'texte-discret' }, [
        demande.estMoi ? 'Ta demande' : 'Publiée par ',
        demande.estMoi ? null : el('a', { href: `/${demande.client.identifiant}`, texte: demande.client.nom }),
      ]),
      el('dl', { classe: 'faits' }, [
        el('div', {}, [el('dt', { classe: 'avec-icone' }, [icone('argent'), 'Budget']), el('dd', { texte: fcfa(demande.budgetFcfa) })]),
        el('div', {}, [el('dt', { classe: 'avec-icone' }, [icone('horloge'), 'Délai']), el('dd', { texte: demande.delai || 'À discuter' })]),
      ]),
      el('p', { classe: 'profil-bio', texte: demande.description }),
      demande.estMoi ? null : boutonSignaler(demande),
    ]);
  }

  function boutonSignaler(demande) {
    const bouton = el('button', { classe: 'bouton-discret', type: 'button', texte: 'Signaler cette demande' });
    bouton.addEventListener('click', () => signaler('demande', demande.id));
    return bouton;
  }

  // ---------- Avis du client, une fois la demande terminée ----------
  function formulaireAvis(demande, dev) {
    const radios = [1, 2, 3, 4, 5].flatMap((n) => [
      el('input', { type: 'radio', name: `note-${dev.identifiant}`, id: `note-${dev.identifiant}-${n}`, value: String(n), checked: n === 5 }),
      el('label', { for: `note-${dev.identifiant}-${n}`, 'aria-label': `${n} sur 5`, texte: `${n} ★` }),
    ]);
    const commentaire = el('textarea', { rows: '3', maxlength: '1000', placeholder: 'Qualité du travail, respect des délais, communication… (facultatif)', 'aria-label': `Ton avis sur ${dev.nom}` });
    const zoneErreur = el('p', { classe: 'erreur-champ', role: 'alert' });
    const envoyer = el('button', { classe: 'bouton bouton-principal', type: 'submit', texte: 'Envoyer mon avis' });
    const formulaire = el('form', { classe: 'bloc-formulaire' }, [
      el('h3', {}, ['Ton avis sur ', el('a', { href: `/${dev.identifiant}`, texte: dev.nom })]),
      el('fieldset', { classe: 'choix-puces' }, [el('legend', { classe: 'visuellement-cache', texte: `Note pour ${dev.nom}` }), ...radios]),
      commentaire,
      zoneErreur,
      envoyer,
    ]);
    formulaire.addEventListener('submit', async (evenement) => {
      evenement.preventDefault();
      zoneErreur.textContent = '';
      envoyer.disabled = true;
      try {
        await api('/avis', {
          methode: 'POST',
          donnees: { demandeId: demande.id, identifiant: dev.identifiant, note: Number(formulaire.elements[`note-${dev.identifiant}`].value), commentaire: commentaire.value },
        });
        await afficher();
        message(`Merci, ton avis est publié sur le profil ${deNom(dev.nom)}.`, 'succes');
      } catch (erreur) {
        zoneErreur.textContent = erreur.message;
        envoyer.disabled = false;
      }
    });
    return formulaire;
  }

  function sectionAvis(demande, propositions, avisDonnes) {
    const choisie = propositions.find((p) => p.statut === 'acceptee');
    if (demande.statut !== 'terminee' || !choisie) return null;
    const devs = choisie.equipe ? choisie.equipe.membres : [choisie.auteur];
    const aNoter = devs.filter((d) => !avisDonnes.includes(d.identifiant));
    return el('section', { classe: 'section-profil' }, [
      el('h2', { texte: 'Ton avis' }),
      aNoter.length
        ? el('p', { classe: 'texte-discret', texte: 'Ton avis apparaîtra sur le profil du développeur. Tu ne peux le donner qu\'une fois.' })
        : el('p', { classe: 'message succes', texte: 'Merci, tu as donné ton avis.' }),
      ...aNoter.map((dev) => formulaireAvis(demande, dev)),
    ]);
  }

  // ---------- Vue du client propriétaire ----------
  function sectionClient(demande, propositions) {
    const section = el('section', { classe: 'section-profil' }, [
      el('h2', { texte: propositions.length ? `Propositions reçues (${propositions.length})` : 'Propositions reçues' }),
    ]);
    if (propositions.length === 0) {
      section.append(etatVide('demandes', 'Ta demande est en ligne', 'Aucune proposition pour l\'instant. Tu recevras une notification dès qu\'un développeur ou une équipe répondra.'));
    }
    // La proposition choisie en premier.
    const triees = [...propositions].sort((a, b) => Number(b.statut === 'acceptee') - Number(a.statut === 'acceptee'));
    section.append(el('div', { classe: 'liste-publications' }, triees.map((p) => carteProposition(p, demande.statut === 'ouverte' ? [
      boutonAction('Choisir cette proposition', 'bouton-principal',
        () => api(`/demandes/${demande.id}/choisir`, { methode: 'POST', donnees: { propositionId: p.id } }),
        {
          confirmation: `Choisir la proposition ${p.equipe ? `de l'équipe ${deNom(p.auteur.nom)}` : deNom(p.auteur.nom)} ? Les autres propositions seront refusées.`,
          succes: 'Proposition choisie. Contacte maintenant le développeur depuis son profil.',
        }),
    ] : []))));

    const gestion = el('div', { classe: 'profil-actions gestion-demande' });
    if (demande.statut === 'ouverte') {
      gestion.append(boutonAction('Annuler la demande', 'bouton-lien',
        () => api(`/demandes/${demande.id}/annuler`, { methode: 'POST', donnees: {} }),
        { confirmation: 'Annuler cette demande ? Les développeurs ne pourront plus y répondre.', succes: 'Demande annulée.' }));
    } else if (demande.statut === 'attribuee') {
      gestion.append(boutonAction('Marquer comme terminée', 'bouton-contour',
        () => api(`/demandes/${demande.id}/terminer`, { methode: 'POST', donnees: {} }),
        { confirmation: 'Le travail est terminé ?', succes: 'Demande terminée.' }));
    }
    section.append(gestion);
    return section;
  }

  // ---------- Vue d'un développeur ----------
  function cartePourDev(demande, proposition) {
    const ouverte = demande.statut === 'ouverte';
    const equipe = proposition.equipe;
    let boutons = [];
    if (proposition.maPlace === 'invite' && ouverte) {
      boutons = [
        boutonAction('Rejoindre l\'équipe', 'bouton-principal',
          () => api(`/equipes/${equipe.id}/accepter`, { methode: 'POST', donnees: {} }), { succes: 'Tu fais partie de l\'équipe.' }),
        boutonAction('Refuser', 'bouton-contour',
          () => api(`/equipes/${equipe.id}/refuser`, { methode: 'POST', donnees: {} }), { succes: 'Invitation refusée.' }),
      ];
    } else if (proposition.maPlace === 'chef' && proposition.statut !== 'acceptee') {
      boutons = [boutonAction('Dissoudre l\'équipe', 'bouton-lien',
        () => api(`/equipes/${equipe.id}`, { methode: 'DELETE', donnees: {} }),
        { confirmation: 'Dissoudre cette équipe ? Sa proposition sera retirée.', succes: 'Équipe dissoute.' })];
    } else if (proposition.maPlace === 'solo' && proposition.statut === 'envoyee') {
      boutons = [boutonAction('Retirer ma proposition', 'bouton-lien',
        () => api(`/demandes/${demande.id}/propositions/mienne`, { methode: 'DELETE', donnees: {} }),
        { confirmation: 'Retirer ta proposition ?', succes: 'Proposition retirée.' })];
    }
    const carte = carteProposition(proposition, boutons, { avecReponses: true });
    if (proposition.maPlace === 'invite') {
      const monRole = equipe.membres.find((m) => m.identifiant === moi.identifiant)?.role;
      carte.prepend(el('p', { classe: 'message succes', texte: `${proposition.auteur.nom} t'invite dans son équipe éclair. Ton rôle : ${monRole}.` }));
    }
    return carte;
  }

  // Formulaire : proposer seul, ou créer une équipe éclair avec des amis développeurs.
  function formulaireProposition(demande, { soloPossible, equipePossible }, amisDevs) {
    const radio = (valeur, texte, coche) => [
      el('input', { type: 'radio', name: 'mode', id: `mode-${valeur}`, value: valeur, checked: coche }),
      el('label', { for: `mode-${valeur}`, texte }),
    ];
    const modes = el('fieldset', { classe: 'choix-puces' }, [
      el('legend', { classe: 'visuellement-cache', texte: 'Comment veux-tu répondre ?' }),
      ...(soloPossible ? radio('solo', 'Seul', true) : []),
      ...(equipePossible ? radio('equipe', 'En équipe éclair', !soloPossible) : []),
    ]);
    const texte = el('textarea', { id: 'proposition-message', rows: '4', maxlength: '2000', placeholder: 'Présente ta solution : ce que tu vas faire, en combien de temps, ton expérience…' });
    const montant = el('input', { id: 'proposition-montant', inputmode: 'numeric', autocomplete: 'off', placeholder: 'Ex. 200 000' });
    const roleChef = el('input', { id: 'proposition-role', maxlength: '40', placeholder: 'Ex. Chef de projet, back-end' });
    const erreurs = {
      message: el('p', { classe: 'erreur-champ' }),
      montantFcfa: el('p', { classe: 'erreur-champ' }),
      roleChef: el('p', { classe: 'erreur-champ' }),
      membres: el('p', { classe: 'erreur-champ' }),
    };

    // Un ami par ligne : une case à cocher, et son rôle à remplir une fois coché.
    const lignesAmis = amisDevs.map((ami, index) => {
      const coche = el('input', { type: 'checkbox', id: `ami-${index}` });
      const role = el('input', { maxlength: '40', placeholder: 'Son rôle (ex. Design)', 'aria-label': `Rôle de ${ami.nom}`, disabled: true });
      coche.addEventListener('change', () => {
        role.disabled = !coche.checked;
        if (coche.checked) role.focus();
      });
      return { ami, coche, role, element: el('li', { classe: 'choix-ami' }, [coche, el('label', { for: `ami-${index}`, texte: ami.nom }), role]) };
    });
    const zoneEquipe = el('div', { classe: 'zone-equipe', hidden: soloPossible }, [
      el('div', { classe: 'champ' }, [el('label', { for: 'proposition-role', texte: 'Ton rôle dans l\'équipe' }), roleChef, erreurs.roleChef]),
      el('div', { classe: 'champ' }, [
        el('p', { classe: 'etiquette', texte: 'Amis à inviter (5 au maximum)' }),
        amisDevs.length
          ? el('ul', { classe: 'liste-amis-equipe' }, lignesAmis.map((l) => l.element))
          : el('p', { classe: 'texte-discret' }, ['Tu n\'as pas encore d\'amis développeurs. ', el('a', { href: '/amis', texte: 'Voir mes amis' })]),
        el('span', { classe: 'aide', texte: 'La proposition partira chez le client quand tous tes invités auront répondu.' }),
        erreurs.membres,
      ]),
    ]);
    const envoyer = el('button', { classe: 'bouton bouton-principal bouton-plein', type: 'submit', texte: soloPossible ? 'Envoyer ma proposition' : 'Inviter mon équipe' });
    const formulaire = el('form', { classe: 'bloc-formulaire', novalidate: true }, [
      el('h2', { texte: 'Répondre à cette demande' }),
      modes,
      el('div', { classe: 'champ' }, [el('label', { for: 'proposition-message', texte: 'Ta proposition' }), texte, erreurs.message]),
      el('div', { classe: 'champ' }, [
        el('label', { for: 'proposition-montant', texte: 'Montant en FCFA' }), montant,
        el('span', { classe: 'aide', texte: 'Laisse vide si tu préfères en discuter.' }), erreurs.montantFcfa,
      ]),
      zoneEquipe,
      envoyer,
    ]);

    const mode = () => formulaire.elements.mode.value;
    modes.addEventListener('change', () => {
      zoneEquipe.hidden = mode() !== 'equipe';
      envoyer.textContent = mode() === 'equipe' ? 'Inviter mon équipe' : 'Envoyer ma proposition';
    });

    formulaire.addEventListener('submit', async (evenement) => {
      evenement.preventDefault();
      Object.values(erreurs).forEach((e) => { e.textContent = ''; });
      message('', '');
      envoyer.disabled = true;
      const donnees = { message: texte.value, montantFcfa: montant.value.trim() };
      try {
        if (mode() === 'equipe') {
          donnees.roleChef = roleChef.value;
          donnees.membres = lignesAmis.filter((l) => l.coche.checked).map((l) => ({ identifiant: l.ami.identifiant, role: l.role.value }));
          await api(`/demandes/${demande.id}/equipes`, { methode: 'POST', donnees });
        } else {
          await api(`/demandes/${demande.id}/propositions`, { methode: 'POST', donnees });
        }
        await afficher();
        message(mode() === 'equipe' ? 'Invitations envoyées. La proposition partira quand tous auront répondu.' : 'Proposition envoyée au client.', 'succes');
      } catch (erreur) {
        if (erreurs[erreur.champ]) erreurs[erreur.champ].textContent = erreur.message;
        else message(erreur.message, 'erreur');
        envoyer.disabled = false;
      }
    });
    return formulaire;
  }

  async function sectionDev(demande, propositions) {
    const section = el('section', { classe: 'section-profil' });
    if (propositions.length) {
      section.append(
        el('h2', { texte: 'Ta participation' }),
        el('div', { classe: 'liste-publications' }, propositions.map((p) => cartePourDev(demande, p))),
      );
    }
    const soloPossible = !propositions.some((p) => p.maPlace === 'solo');
    const equipePossible = !propositions.some((p) => p.maPlace === 'chef');
    if (demande.statut === 'ouverte' && (soloPossible || equipePossible)) {
      const { amis } = await api('/amis');
      section.append(formulaireProposition(demande, { soloPossible, equipePossible }, amis.filter((a) => a.type === 'dev')));
    } else if (demande.statut !== 'ouverte' && propositions.length === 0) {
      section.append(el('p', { classe: 'texte-discret', texte: 'Cette demande n\'accepte plus de propositions.' }));
    }
    return section;
  }

  async function afficher() {
    const zone = document.querySelector('[data-demande]');
    try {
      const { demande, propositions, avisDonnes } = await api(`/demandes/${encodeURIComponent(id)}`);
      document.title = `${demande.titre} – Palabre`;
      const blocs = [enteteDemande(demande)];
      if (demande.estMoi) blocs.push(sectionAvis(demande, propositions, avisDonnes || []), sectionClient(demande, propositions));
      else if (moi.type === 'dev') blocs.push(await sectionDev(demande, propositions));
      zone.replaceChildren(...blocs.filter(Boolean));
    } catch (erreur) {
      zone.replaceChildren(etatVide('demandes', 'Demande introuvable', erreur.message,
        el('a', { classe: 'bouton bouton-principal', href: '/demandes', texte: 'Voir les demandes' })));
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    moi = await utilisateurConnecte();
    if (!moi) {
      window.location.href = `/connexion?suite=${encodeURIComponent(`/demande?id=${id}`)}`;
      return;
    }
    afficher();
  });
})();
