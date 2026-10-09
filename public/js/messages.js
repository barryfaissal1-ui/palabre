// Palabre Messages : la liste des conversations et la conversation ouverte, dans la même page.
//   /messages                 la liste (et, sur ordinateur, la dernière conversation choisie à droite)
//   /messages/12              la conversation n° 12
//   /messages?avec=awa-dev    écrire à un membre depuis son profil ou depuis une proposition
//
// Pas de WebSocket : la page redemande au serveur « quoi de neuf depuis le message n° X ? » toutes les 5 secondes,
// seulement quand une conversation est ouverte ET que l'onglet est visible. En arrière-plan, plus aucune requête.
(function () {
  const {
    api, el, avatar, nomMembre, utilisateurConnecte, reduireImage, signaler, icone, etatVide, chargement, toast, confirmer, menuOptions, prenom,
  } = window.Palabre;

  const DELAI_CONVERSATION = 5000; // nouveaux messages de la conversation ouverte
  const DELAI_LISTE = 60000;       // liste des conversations
  const zoneListe = document.querySelector('[data-conversations]');
  const etatListe = document.querySelector('[data-etat-liste]');
  const panneau = document.querySelector('[data-conversation]');
  const recherche = document.querySelector('[data-recherche]');

  let onglet = 'principal';
  let conversations = [];
  let ouverte = null;     // { id, donnees, dernierId, vuJusqua, zone, mentionVu… } : la conversation affichée
  let minuterieConversation = 0;
  let minuterieListe = 0;

  // ---------- Dates ----------
  const heure = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const memeJour = (a, b) => a.toDateString() === b.toDateString();
  // « Aujourd'hui », « Hier », puis la date : le titre qui sépare les messages de deux jours différents.
  function nomDuJour(iso) {
    const date = new Date(iso);
    const hier = new Date();
    hier.setDate(hier.getDate() - 1);
    if (memeJour(date, new Date())) return 'Aujourd\'hui';
    if (memeJour(date, hier)) return 'Hier';
    return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
  }
  // Dans la liste : l'heure pour aujourd'hui, sinon « Hier » ou la date courte.
  function quand(iso) {
    const date = new Date(iso);
    if (memeJour(date, new Date())) return heure(iso);
    const nom = nomDuJour(iso);
    return nom === 'Hier' ? nom : date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  }

  // ---------- La liste des conversations ----------
  function ligneConversation(conversation) {
    const dernier = conversation.dernierMessage;
    let apercu = '';
    if (dernier) apercu = `${dernier.estMoi ? 'Toi : ' : ''}${dernier.texte}`;
    const cote = el('span', { classe: 'conversation-cote' }, [
      dernier ? el('span', { texte: quand(dernier.creeLe) }) : null,
      conversation.nonLus
        ? el('span', { classe: 'compteur', texte: String(conversation.nonLus), 'aria-label': `${conversation.nonLus} message${conversation.nonLus > 1 ? 's' : ''} non lu${conversation.nonLus > 1 ? 's' : ''}` })
        : null,
      conversation.enAttente ? el('span', { classe: 'etiquette-attente', texte: 'En attente' }) : null,
    ]);
    const lien = el('a', {
      classe: `conversation-item${conversation.nonLus ? ' non-lue' : ''}`, href: `/messages/${conversation.id}`,
      'aria-current': ouverte && ouverte.id === conversation.id ? 'true' : null,
    }, [
      avatar(conversation.autre, 'moyen'),
      el('span', { classe: 'conversation-texte' }, [
        nomMembre(conversation.autre, { lien: false }),
        el('span', { classe: 'conversation-apercu' }, [dernier && dernier.aImage ? icone('image') : null, apercu]),
      ]),
      cote,
    ]);
    lien.addEventListener('click', (evenement) => {
      if (evenement.ctrlKey || evenement.metaKey || evenement.shiftKey) return; // nouvel onglet
      evenement.preventDefault();
      aller(`/messages/${conversation.id}`);
    });
    return el('li', {}, [lien]);
  }

  function dessinerListe() {
    const filtre = recherche.value.trim().toLowerCase();
    const visibles = filtre ? conversations.filter((c) => c.autre.nom.toLowerCase().includes(filtre)) : conversations;
    zoneListe.replaceChildren(...visibles.map(ligneConversation));
    etatListe.hidden = visibles.length > 0;
    if (visibles.length > 0) return;
    if (filtre) etatListe.replaceChildren(etatVide('recherche', 'Aucune conversation à ce nom', 'Vérifie l\'orthographe, ou efface la recherche.'));
    else if (onglet === 'demandes') etatListe.replaceChildren(etatVide('calme', 'Aucune demande de message', 'Quand un membre que tu ne connais pas t\'écrit, son premier message arrive ici. Tu choisis de l\'accepter ou non.'));
    else {
      etatListe.replaceChildren(etatVide('palabre', 'Pas encore de message', 'Ouvre le profil d\'un membre et touche « Message » pour lancer la conversation.',
        el('a', { classe: 'bouton bouton-principal', href: '/amis' }, [icone('amis'), 'Voir mes amis'])));
    }
  }

  async function chargerListe({ squelettes = false } = {}) {
    const fini = squelettes ? chargement(zoneListe, 3) : () => {};
    const demande = onglet;
    try {
      const reponse = await api(`/messages/conversations?onglet=${onglet}`);
      fini();
      if (demande !== onglet) return; // l'onglet a changé pendant le chargement
      conversations = reponse.conversations;
      const pastille = document.querySelector('[data-nb-demandes]');
      pastille.textContent = String(reponse.nbDemandes);
      pastille.hidden = reponse.nbDemandes === 0;
      dessinerListe();
    } catch (erreur) {
      fini();
      if (squelettes) {
        etatListe.replaceChildren(etatVide('calme', 'Les messages ne chargent pas', erreur.message));
        etatListe.hidden = false;
      }
    }
  }

  // ---------- Les messages d'une conversation ----------
  function bulle(message) {
    return el('div', { classe: `bulle ${message.estMoi ? 'bulle-moi' : 'bulle-autre'}`, 'data-message': message.id }, [
      message.image
        ? el('a', { href: message.image, target: '_blank', rel: 'noopener', 'aria-label': 'Ouvrir la photo' }, [el('img', { src: message.image, alt: 'Photo jointe au message', loading: 'lazy', decoding: 'async' })])
        : null,
      // textContent : le texte d'un membre n'est jamais interprété. Un lien écrit dans un message reste du simple texte.
      el('span', { classe: 'bulle-texte', texte: message.texte }),
      el('span', { classe: 'bulle-heure', texte: heure(message.creeLe) }),
    ]);
  }

  // Ajoute des messages en bas, avec un titre de jour quand la date change.
  function ajouterMessages(messages) {
    messages.forEach((message) => {
      if (!ouverte.dernierJour || !memeJour(new Date(ouverte.dernierJour), new Date(message.creeLe))) {
        ouverte.zone.append(el('p', { classe: 'jour-messages', texte: nomDuJour(message.creeLe) }));
      }
      ouverte.dernierJour = message.creeLe;
      ouverte.zone.append(bulle(message));
      ouverte.dernierId = Math.max(ouverte.dernierId, message.id);
      if (message.estMoi) ouverte.monDernierId = message.id;
      else ouverte.dernierDeLAutre = message.id;
    });
  }

  // « Vu » sous mon dernier message, quand l'autre l'a lu.
  function dessinerVu() {
    ouverte.mentionVu.hidden = !(ouverte.monDernierId && ouverte.vuJusqua >= ouverte.monDernierId && ouverte.monDernierId >= ouverte.dernierId);
    ouverte.zone.append(ouverte.mentionVu); // toujours tout en bas
  }
  const allerEnBas = () => { ouverte.zone.scrollTop = ouverte.zone.scrollHeight; };

  async function marquerLu() {
    if (!ouverte || !ouverte.id || ouverte.donnees.estDemandeRecue || document.hidden) return;
    try {
      const { nonLus } = await api(`/messages/conversations/${ouverte.id}/lu`, { methode: 'POST', donnees: {} });
      window.Palabre.majPastilleMessages(nonLus);
      const dansLaListe = conversations.find((c) => c.id === ouverte.id);
      if (dansLaListe && dansLaListe.nonLus) {
        dansLaListe.nonLus = 0;
        dessinerListe();
      }
    } catch { /* on réessaiera à la prochaine actualisation */ }
  }

  // ---------- Zone d'écriture ----------
  function zoneEcriture({ envoyer, avertissement = null }) {
    let image = null;
    const champ = el('textarea', { rows: '1', maxlength: '2000', placeholder: 'Écrire un message…', 'aria-label': 'Écrire un message' });
    const choisir = el('input', { type: 'file', accept: 'image/*', classe: 'visuellement-cache', 'aria-label': 'Joindre une photo' });
    const boutonPhoto = el('label', { classe: 'bouton-icone', title: 'Joindre une photo' }, [icone('image'), choisir]);
    const boutonEnvoyer = el('button', { classe: 'bouton bouton-principal bouton-envoyer', type: 'submit', 'aria-label': 'Envoyer le message', title: 'Envoyer' }, [icone('envoyer')]);
    const retirer = el('button', { classe: 'bouton-discret', type: 'button', texte: 'Retirer la photo' });
    const apercu = el('div', { classe: 'apercu-photo', hidden: true }, [el('img', { alt: 'Photo à envoyer' }), retirer]);
    const erreurZone = el('p', { classe: 'erreur-champ', role: 'alert' });
    const formulaire = el('form', { classe: 'zone-ecriture', novalidate: true }, [
      avertissement ? el('p', { classe: 'texte-discret avertissement-message', texte: avertissement }) : null,
      apercu,
      erreurZone,
      el('div', { classe: 'ligne-ecriture' }, [boutonPhoto, champ, boutonEnvoyer]),
    ]);

    function retirerPhoto() {
      image = null;
      apercu.hidden = true;
      apercu.querySelector('img').removeAttribute('src');
    }
    retirer.addEventListener('click', retirerPhoto);
    choisir.addEventListener('change', async () => {
      const fichier = choisir.files[0];
      choisir.value = '';
      if (!fichier) return;
      erreurZone.textContent = '';
      try {
        image = await reduireImage(fichier); // compressée dans le navigateur, comme les autres images du site
        apercu.querySelector('img').src = image;
        apercu.hidden = false;
        champ.focus();
      } catch (erreur) {
        erreurZone.textContent = erreur.message;
      }
    });
    // Le champ grandit avec le texte (jusqu'à une limite fixée par le CSS).
    champ.addEventListener('input', () => {
      champ.style.height = 'auto';
      champ.style.height = `${champ.scrollHeight}px`;
    });
    // Sur ordinateur : Entrée envoie, Maj+Entrée va à la ligne. Sur téléphone, Entrée va à la ligne.
    champ.addEventListener('keydown', (evenement) => {
      if (evenement.key === 'Enter' && !evenement.shiftKey && window.matchMedia('(hover: hover)').matches) {
        evenement.preventDefault();
        formulaire.requestSubmit();
      }
    });
    formulaire.addEventListener('submit', async (evenement) => {
      evenement.preventDefault();
      erreurZone.textContent = '';
      if (!champ.value.trim()) {
        erreurZone.textContent = image ? 'Ajoute un mot avec ta photo.' : '';
        champ.focus();
        return;
      }
      boutonEnvoyer.disabled = true;
      try {
        await envoyer({ texte: champ.value, ...(image ? { image } : {}) });
        champ.value = '';
        champ.style.height = 'auto';
        retirerPhoto();
      } catch (erreur) {
        erreurZone.textContent = erreur.message;
      }
      boutonEnvoyer.disabled = false;
      champ.focus();
    });
    return formulaire;
  }

  // ---------- Le haut de la conversation ----------
  function enteteConversation(autre, { menu = null } = {}) {
    const retour = el('button', { classe: 'bouton-icone bouton-retour', type: 'button', 'aria-label': 'Retour à la liste des conversations' }, [icone('fleche-gauche')]);
    retour.addEventListener('click', () => aller('/messages'));
    return el('header', { classe: 'conversation-entete' }, [
      retour,
      el('a', { classe: 'lien-avatar', href: `/${autre.identifiant}`, 'aria-label': `Profil de ${autre.nom}` }, [avatar(autre, 'moyen')]),
      el('div', { classe: 'conversation-qui' }, [
        nomMembre(autre),
        el('p', { classe: 'texte-discret', texte: [autre.type === 'client' ? 'Client' : 'Développeur', autre.ville].filter(Boolean).join(', ') }),
      ]),
      menu,
    ]);
  }

  // Bouton qui appelle l'API puis recharge la conversation (Accepter, Refuser, Bloquer…).
  function boutonAction(texte, classe, action) {
    const bouton = el('button', { classe: `bouton ${classe}`, type: 'button', texte });
    bouton.addEventListener('click', async () => {
      bouton.disabled = true;
      try {
        await action();
      } catch (erreur) {
        toast(erreur.message, 'erreur');
        bouton.disabled = false;
      }
    });
    return bouton;
  }

  async function bloquer(autre) {
    if (!(await confirmer(`Bloquer ${autre.nom} ? Cette personne ne pourra plus t'écrire ni voir vos conversations. Elle ne sera pas prévenue.`, { bouton: 'Bloquer', danger: true }))) return false;
    await api(`/messages/blocages/${encodeURIComponent(autre.identifiant)}`, { methode: 'POST', donnees: {} });
    toast(`${prenom(autre.nom)} est bloqué.`);
    return true;
  }

  // ---------- Ouvrir une conversation ----------
  async function ouvrir(id) {
    arreterConversation();
    document.body.classList.add('conversation-ouverte');
    panneau.replaceChildren();
    const fini = chargement(panneau, 2);
    let reponse;
    try {
      reponse = await api(`/messages/conversations/${id}`);
    } catch (erreur) {
      fini();
      panneau.replaceChildren(etatVide('calme', 'Conversation introuvable', erreur.statut === 404 ? 'Elle n\'existe pas, ou tu n\'y as plus accès.' : erreur.message,
        el('a', { classe: 'bouton bouton-principal', href: '/messages', texte: 'Toutes mes conversations' })));
      return;
    }
    fini();
    const { conversation } = reponse;
    const { autre } = conversation;
    document.title = `${autre.nom} – Messages – Palabre`;

    const zone = el('div', { classe: 'fil-messages', role: 'log', 'aria-label': `Messages avec ${autre.nom}`, tabindex: '0' });
    const mentionVu = el('p', { classe: 'mention-vu', texte: 'Vu', hidden: true });
    ouverte = { id, donnees: conversation, zone, mentionVu, dernierId: 0, monDernierId: 0, dernierDeLAutre: 0, dernierJour: null, vuJusqua: conversation.vuJusqua };

    const menu = menuOptions(() => [
      { texte: 'Voir le profil', icone: 'utilisateur', action: () => { window.location.href = `/${autre.identifiant}`; } },
      conversation.jeBloque
        ? { texte: 'Débloquer', icone: 'valide', action: async () => {
          try {
            await api(`/messages/blocages/${encodeURIComponent(autre.identifiant)}`, { methode: 'DELETE', donnees: {} });
            toast(`${prenom(autre.nom)} est débloqué.`);
            ouvrir(id);
          } catch (erreur) { toast(erreur.message, 'erreur'); }
        } }
        : { texte: 'Bloquer', icone: 'bloquer', action: async () => {
          try { if (await bloquer(autre)) ouvrir(id); } catch (erreur) { toast(erreur.message, 'erreur'); }
        } },
      // On signale le dernier message reçu : l'équipe ne verra que celui-là, pas le reste de la conversation.
      { texte: 'Signaler', icone: 'signaler', action: () => {
        if (ouverte.dernierDeLAutre) signaler('message', ouverte.dernierDeLAutre);
        else toast('Il n\'y a aucun message de cette personne à signaler.', 'erreur');
      } },
      { texte: 'Supprimer la conversation', icone: 'supprimer', danger: true, action: async () => {
        if (!(await confirmer('Supprimer cette conversation ? Elle disparaîtra de ta liste seulement : l\'autre personne la garde.', { bouton: 'Supprimer', danger: true }))) return;
        try {
          await api(`/messages/conversations/${id}/masquer`, { methode: 'POST', donnees: {} });
          toast('Conversation supprimée de ta liste.');
          aller('/messages');
        } catch (erreur) { toast(erreur.message, 'erreur'); }
      } },
    ]);

    // Le bas de la conversation dépend de la situation : écrire, répondre à une demande, ou une explication.
    let bas;
    if (conversation.estDemandeRecue) {
      bas = el('div', { classe: 'zone-demande' }, [
        el('p', {}, [el('strong', { texte: `${prenom(autre.nom)} veut t'écrire.` }), ' Vous n\'êtes pas amis. Tant que tu n\'acceptes pas, cette personne ne peut rien envoyer d\'autre et ne sait pas que tu as lu.']),
        el('div', { classe: 'profil-actions' }, [
          boutonAction('Accepter', 'bouton-principal', async () => {
            await api(`/messages/conversations/${id}/accepter`, { methode: 'POST', donnees: {} });
            onglet = 'principal';
            choisirOnglet();
            await ouvrir(id);
          }),
          boutonAction('Refuser', 'bouton-contour', async () => {
            await api(`/messages/conversations/${id}/refuser`, { methode: 'POST', donnees: {} });
            toast('Demande refusée.');
            aller('/messages');
          }),
          boutonAction('Bloquer', 'bouton-lien', async () => { if (await bloquer(autre)) aller('/messages'); }),
        ]),
      ]);
    } else if (conversation.peutEcrire) {
      bas = zoneEcriture({
        envoyer: async (donnees) => {
          const { message } = await api(`/messages/conversations/${id}`, { methode: 'POST', donnees });
          ajouterMessages([message]);
          dessinerVu();
          allerEnBas();
          chargerListe();
        },
      });
    } else {
      bas = el('p', { classe: 'zone-demande texte-discret', texte: conversation.raison });
    }

    const plusAnciens = el('button', { classe: 'bouton bouton-contour bouton-compact plus-anciens', type: 'button', texte: 'Voir les messages précédents', hidden: !reponse.precedent });
    let precedent = reponse.precedent;
    plusAnciens.addEventListener('click', async () => {
      plusAnciens.disabled = true;
      try {
        const suite = await api(`/messages/conversations/${id}?avant=${precedent}`);
        // Les anciens messages se placent au-dessus, sans faire bouger ce qu'on est en train de lire.
        const hauteurAvant = zone.scrollHeight;
        const morceau = document.createDocumentFragment();
        let jour = null;
        suite.messages.forEach((message) => {
          if (!jour || !memeJour(new Date(jour), new Date(message.creeLe))) morceau.append(el('p', { classe: 'jour-messages', texte: nomDuJour(message.creeLe) }));
          jour = message.creeLe;
          morceau.append(bulle(message));
        });
        plusAnciens.after(morceau);
        zone.scrollTop += zone.scrollHeight - hauteurAvant;
        precedent = suite.precedent;
        plusAnciens.hidden = !precedent;
      } catch (erreur) {
        toast(erreur.message, 'erreur');
      }
      plusAnciens.disabled = false;
    });

    zone.append(plusAnciens);
    ajouterMessages(reponse.messages);
    dessinerVu();
    panneau.replaceChildren(...[
      enteteConversation(autre, { menu }),
      // Client et dev : on rappelle la demande dont il est question.
      conversation.demande
        ? el('a', { classe: 'bandeau-demande', href: `/demande?id=${conversation.demande.id}` }, [icone('demandes'), el('span', {}, ['À propos de la demande : ', el('strong', { texte: conversation.demande.titre })])])
        : null,
      zone,
      bas,
    ].filter(Boolean));
    allerEnBas();
    dessinerListe(); // met en avant la conversation ouverte dans la liste
    marquerLu();
    demarrerConversation();
  }

  // Écrire à un membre avec qui je n'ai pas encore de conversation (depuis son profil ou une proposition).
  async function ouvrirAvec(identifiant, demandeId) {
    arreterConversation();
    document.body.classList.add('conversation-ouverte');
    panneau.replaceChildren();
    const fini = chargement(panneau, 2);
    try {
      const info = await api(`/messages/avec/${encodeURIComponent(identifiant)}${demandeId ? `?demande=${encodeURIComponent(demandeId)}` : ''}`);
      fini();
      if (info.conversationId) {
        window.history.replaceState(null, '', `/messages/${info.conversationId}`);
        await ouvrir(info.conversationId);
        return;
      }
      document.title = `${info.autre.nom} – Messages – Palabre`;
      const bas = info.peutEcrire
        ? zoneEcriture({
          avertissement: info.seraUneDemande
            ? `Vous n'êtes pas encore amis : ton premier message sera une demande. Tu pourras continuer quand ${prenom(info.autre.nom)} l'aura acceptée.`
            : null,
          envoyer: async (donnees) => {
            const reponse = await api(`/messages/avec/${encodeURIComponent(identifiant)}`, { methode: 'POST', donnees: { ...donnees, ...(demandeId ? { demandeId: Number(demandeId) } : {}) } });
            window.history.replaceState(null, '', `/messages/${reponse.conversationId}`);
            chargerListe();
            await ouvrir(reponse.conversationId);
          },
        })
        : el('p', { classe: 'zone-demande texte-discret', texte: info.raison });
      panneau.replaceChildren(
        enteteConversation(info.autre),
        el('div', { classe: 'fil-messages' }, [etatVide('palabre', `Écris à ${prenom(info.autre.nom)}`, 'Présente-toi en quelques mots : c\'est le début de la conversation.')]),
        bas,
      );
      const champ = panneau.querySelector('textarea');
      if (champ) champ.focus();
    } catch (erreur) {
      fini();
      panneau.replaceChildren(etatVide('calme', 'Impossible d\'écrire à ce membre', erreur.message,
        el('a', { classe: 'bouton bouton-principal', href: '/messages', texte: 'Toutes mes conversations' })));
    }
  }

  function fermer() {
    arreterConversation();
    ouverte = null;
    document.body.classList.remove('conversation-ouverte');
    document.title = 'Messages – Palabre';
    panneau.replaceChildren(etatVide('palabre', 'Tes conversations', 'Choisis une conversation dans la liste, ou écris à un membre depuis son profil.'));
    dessinerListe();
  }

  // ---------- Actualisation ----------
  async function actualiserConversation() {
    if (!ouverte || !ouverte.id || document.hidden) return;
    const { id } = ouverte;
    try {
      const reponse = await api(`/messages/conversations/${id}/nouveaux?apres=${ouverte.dernierId}`);
      if (!ouverte || ouverte.id !== id) return; // on a changé de conversation pendant la requête
      // La demande que j'avais envoyée vient d'être acceptée (ou l'inverse) : on redessine pour montrer la zone d'écriture.
      if (reponse.statut !== ouverte.donnees.statut) {
        ouvrir(id);
        return;
      }
      const enBas = ouverte.zone.scrollHeight - ouverte.zone.scrollTop - ouverte.zone.clientHeight < 80;
      const nouveaux = reponse.messages.filter((m) => m.id > ouverte.dernierId);
      if (nouveaux.length) ajouterMessages(nouveaux);
      ouverte.vuJusqua = reponse.vuJusqua;
      dessinerVu();
      if (nouveaux.length) {
        if (enBas) allerEnBas(); // on ne déplace pas quelqu'un qui relit plus haut
        if (nouveaux.some((m) => !m.estMoi)) {
          marquerLu();
          chargerListe();
        }
      }
    } catch (erreur) {
      if (erreur.statut === 404) aller('/messages'); // la conversation n'est plus accessible
    }
  }
  function demarrerConversation() {
    clearInterval(minuterieConversation);
    if (!document.hidden && ouverte && ouverte.id) minuterieConversation = setInterval(actualiserConversation, DELAI_CONVERSATION);
  }
  function arreterConversation() {
    clearInterval(minuterieConversation);
    minuterieConversation = 0;
  }
  // Onglet caché : on arrête tout. De retour : on rattrape tout de suite, puis on reprend le rythme.
  document.addEventListener('visibilitychange', () => {
    clearInterval(minuterieListe);
    arreterConversation();
    if (document.hidden) return;
    minuterieListe = setInterval(chargerListe, DELAI_LISTE);
    chargerListe();
    if (ouverte && ouverte.id) {
      actualiserConversation().then(marquerLu);
      demarrerConversation();
    }
  });

  // ---------- Navigation dans la page (sans rechargement) ----------
  function afficherSelonAdresse() {
    const numero = /^\/messages\/(\d+)$/.exec(window.location.pathname);
    const parametres = new URLSearchParams(window.location.search);
    if (numero) ouvrir(Number(numero[1]));
    else if (parametres.get('avec')) ouvrirAvec(parametres.get('avec'), parametres.get('demande'));
    else fermer();
  }
  function aller(adresse) {
    window.history.pushState(null, '', adresse);
    afficherSelonAdresse();
  }
  window.addEventListener('popstate', afficherSelonAdresse);

  function choisirOnglet() {
    document.querySelectorAll('[data-onglet]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.onglet === onglet)));
  }

  // Sur téléphone, le clavier réduit la partie visible de l'écran : la conversation prend exactement cette hauteur,
  // pour que la zone d'écriture reste au-dessus du clavier.
  if (window.visualViewport) {
    const ajuster = () => {
      document.documentElement.style.setProperty('--hauteur-visible', `${window.visualViewport.height}px`);
      if (ouverte && ouverte.zone) allerEnBas();
    };
    window.visualViewport.addEventListener('resize', ajuster);
    document.documentElement.style.setProperty('--hauteur-visible', `${window.visualViewport.height}px`);
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const moi = await utilisateurConnecte();
    if (!moi) {
      window.location.href = `/connexion?suite=${encodeURIComponent(window.location.pathname + window.location.search)}`;
      return;
    }
    if (new URLSearchParams(window.location.search).get('onglet') === 'demandes') onglet = 'demandes';
    choisirOnglet();
    document.querySelectorAll('[data-onglet]').forEach((bouton) => {
      bouton.addEventListener('click', () => {
        if (onglet === bouton.dataset.onglet) return;
        onglet = bouton.dataset.onglet;
        choisirOnglet();
        zoneListe.replaceChildren();
        chargerListe({ squelettes: true });
      });
    });
    recherche.addEventListener('input', dessinerListe);
    afficherSelonAdresse();
    await chargerListe({ squelettes: true });
    minuterieListe = setInterval(chargerListe, DELAI_LISTE);
  });
})();
