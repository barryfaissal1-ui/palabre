// Palabre Messages : la liste des conversations et la conversation ouverte, dans la même page.
//   /messages                 la liste (et, sur ordinateur, la dernière conversation choisie à droite)
//   /messages/12              la conversation n° 12
//   /messages/groupe/34       le groupe n° 34 (la discussion d'une équipe éclair)
//   /messages?avec=awa-dev    écrire à un membre depuis son profil ou depuis une proposition
//
// Pas de WebSocket : la page redemande au serveur « quoi de neuf depuis le message n° X ? » toutes les 5 secondes,
// seulement quand une conversation est ouverte ET que l'onglet est visible. En arrière-plan, plus aucune requête.
(function () {
  const {
    api, el, avatar, nomMembre, utilisateurConnecte, reduireImage, signaler, icone, etatVide, chargement, toast, confirmer, menuOptions, prenom, dateRelative,
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
  const adresseDe = (conversation) => (conversation.type === 'groupe' ? `/messages/groupe/${conversation.id}` : `/messages/${conversation.id}`);
  // Un groupe se reconnaît à ses avatars empilés (trois au plus).
  function avatarsEmpiles(membres, taille = 'mini') {
    return el('span', { classe: `avatars-empiles avatars-${Math.max(1, Math.min(3, membres.length))}`, 'aria-hidden': 'true' }, membres.slice(0, 3).map((m) => avatar(m, taille)));
  }

  function ligneConversation(conversation) {
    const groupe = conversation.type === 'groupe';
    const dernier = conversation.dernierMessage;
    let apercu = '';
    if (dernier && groupe) apercu = dernier.systeme ? dernier.texte : `${dernier.estMoi ? 'Toi' : dernier.prenom} : ${dernier.texte}`;
    else if (dernier) apercu = `${dernier.estMoi ? 'Toi : ' : ''}${dernier.texte}`;
    const cote = el('span', { classe: 'conversation-cote' }, [
      dernier ? el('span', { texte: quand(dernier.creeLe) }) : null,
      conversation.nonLus
        ? el('span', { classe: 'compteur', texte: String(conversation.nonLus), 'aria-label': `${conversation.nonLus} message${conversation.nonLus > 1 ? 's' : ''} non lu${conversation.nonLus > 1 ? 's' : ''}` })
        : null,
      conversation.enAttente ? el('span', { classe: 'etiquette-attente', texte: 'En attente' }) : null,
    ]);
    const lien = el('a', {
      classe: `conversation-item${conversation.nonLus ? ' non-lue' : ''}`, href: adresseDe(conversation),
      'aria-current': ouverte && ouverte.id === conversation.id ? 'true' : null,
    }, [
      groupe ? avatarsEmpiles(conversation.membres) : el('span', { classe: `avec-presence${conversation.presence && conversation.presence.enLigne ? ' en-ligne' : ''}` }, [avatar(conversation.autre, 'moyen')]),
      el('span', { classe: 'conversation-texte' }, [
        groupe ? el('strong', { classe: 'conversation-titre', texte: conversation.titre }) : nomMembre(conversation.autre, { lien: false }),
        el('span', { classe: 'conversation-apercu' }, [dernier && dernier.aImage ? icone('image') : null, apercu]),
      ]),
      cote,
    ]);
    lien.addEventListener('click', (evenement) => {
      if (evenement.ctrlKey || evenement.metaKey || evenement.shiftKey) return; // nouvel onglet
      evenement.preventDefault();
      aller(adresseDe(conversation));
    });
    return el('li', {}, [lien]);
  }

  function dessinerListe() {
    const filtre = recherche.value.trim().toLowerCase();
    const visibles = filtre ? conversations.filter((c) => (c.type === 'groupe' ? c.titre : c.autre.nom).toLowerCase().includes(filtre)) : conversations;
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
      // Conversations privées et groupes d'équipe, mêlés : la plus récente en premier.
      conversations = [...reponse.conversations, ...(reponse.groupes || [])].sort((a, b) => new Date(b.actifLe) - new Date(a.actifLe));
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
  // Les six réactions (la même liste que le serveur, qui refuse toute autre valeur).
  const REACTIONS = ['❤️', '😂', '👍', '😮', '😢', '🙏'];

  // Remplace la bulle d'un message par sa nouvelle version (réaction ajoutée, message supprimé…).
  function redessiner(message) {
    const ancienne = ouverte && ouverte.zone.querySelector(`[data-message="${message.id}"]`);
    if (!ancienne) return;
    // La personne est en train de choisir dans le menu de cette bulle (ou une réaction) : on ne la lui retire pas
    // des mains, on redessinera juste après.
    if (ancienne.querySelector('[aria-expanded="true"], .barre-reactions')) {
      setTimeout(() => redessiner(message), 1500);
      return;
    }
    ancienne.replaceWith(bulle(message));
  }

  // La petite barre des six réactions, posée au-dessus de la bulle. Toucher la sienne une seconde fois l'enlève.
  function choisirReaction(message, element) {
    document.querySelectorAll('.barre-reactions').forEach((b) => b.remove());
    const mienne = (message.reactions.find((r) => r.moi) || {}).emoji;
    const barre = el('div', { classe: 'barre-reactions', role: 'group', 'aria-label': 'Réagir à ce message' }, REACTIONS.map((emoji) => {
      const bouton = el('button', { type: 'button', texte: emoji, 'aria-pressed': String(emoji === mienne), 'aria-label': `Réagir avec ${emoji}` });
      bouton.addEventListener('click', async () => {
        fermer();
        try {
          const reponse = emoji === mienne
            ? await api(`/messages/message/${message.id}/reaction`, { methode: 'DELETE', donnees: {} })
            : await api(`/messages/message/${message.id}/reaction`, { methode: 'POST', donnees: { emoji } });
          redessiner(reponse.message);
        } catch (erreur) {
          toast(erreur.message, 'erreur');
        }
      });
      return bouton;
    }));
    function dehors(evenement) { if (!barre.contains(evenement.target)) fermer(); }
    function clavier(evenement) { if (evenement.key === 'Escape') fermer(); }
    function fermer() {
      barre.remove();
      document.removeEventListener('pointerdown', dehors, true);
      document.removeEventListener('keydown', clavier);
    }
    element.append(barre);
    barre.querySelector(mienne ? '[aria-pressed="true"]' : 'button').focus();
    // Au prochain tour : sinon le toucher qui a ouvert la barre la refermerait aussitôt.
    setTimeout(() => {
      document.addEventListener('pointerdown', dehors, true);
      document.addEventListener('keydown', clavier);
    });
  }

  // Qui a réagi : une petite fenêtre, ouverte en touchant le compteur sous la bulle.
  function montrerReactions(message) {
    const fermer = el('button', { classe: 'bouton bouton-principal', type: 'button', texte: 'Fermer' });
    const dialogue = el('dialog', { classe: 'dialogue', 'aria-labelledby': 'reactions-titre' }, [
      el('h2', { id: 'reactions-titre', texte: 'Réactions' }),
      el('ul', { classe: 'liste-reactions' }, message.reactions.map((r) => el('li', {}, [
        el('span', { classe: 'reaction-emoji', texte: r.emoji, 'aria-hidden': 'true' }),
        el('span', { texte: r.qui.join(', ') + (r.nombre > r.qui.length ? ` et ${r.nombre - r.qui.length} autres` : '') }),
      ]))),
      el('div', { classe: 'dialogue-actions' }, [fermer]),
    ]);
    fermer.addEventListener('click', () => dialogue.close());
    dialogue.addEventListener('close', () => dialogue.remove());
    document.body.append(dialogue);
    dialogue.showModal();
  }

  async function supprimerMessage(message, pourTous) {
    const question = pourTous
      ? 'Supprimer ce message pour tout le monde ? Son texte et sa photo seront effacés. Il restera la mention « Message supprimé ».'
      : 'Supprimer ce message pour toi ? Les autres le garderont.';
    if (!(await confirmer(question, { bouton: 'Supprimer', danger: true }))) return;
    try {
      const reponse = await api(`/messages/message/${message.id}`, { methode: 'DELETE', donnees: { pourTous } });
      if (reponse.message) redessiner(reponse.message);
      else {
        const element = ouverte && ouverte.zone.querySelector(`[data-message="${message.id}"]`);
        if (element) element.remove();
      }
      chargerListe();
    } catch (erreur) {
      toast(erreur.message, 'erreur');
    }
  }

  function repondreA(message) {
    if (ouverte && ouverte.ecriture && ouverte.ecriture.repondreA) ouverte.ecriture.repondreA(message);
  }

  function bulle(message) {
    // Message « système » d'un groupe (« Awa a rejoint l'équipe ») : une ligne discrète au centre, pas une bulle.
    if (message.systeme) return el('p', { classe: 'message-systeme', 'data-message': message.id, texte: message.texte });
    // Dans un groupe, la bulle d'un autre dit de qui elle vient.
    const signee = ouverte && ouverte.estGroupe && !message.estMoi && message.auteur;
    const peutAgir = ouverte && ouverte.donnees.peutEcrire && !message.supprime;

    // La citation du message auquel celui-ci répond : la toucher y ramène.
    let citation = null;
    if (message.reponse) {
      citation = el('button', { classe: 'bulle-citation', type: 'button' }, [
        el('strong', { texte: message.reponse.prenom }),
        el('span', { texte: message.reponse.texte === null ? 'Message supprimé' : message.reponse.texte }),
      ]);
      citation.addEventListener('click', () => {
        const origine = ouverte.zone.querySelector(`[data-message="${message.reponse.id}"]`);
        if (!origine) {
          toast('Ce message est plus haut : touche « Voir les messages précédents ».');
          return;
        }
        origine.scrollIntoView({ block: 'center', behavior: 'smooth' });
        origine.classList.add('bulle-eclairee');
        setTimeout(() => origine.classList.remove('bulle-eclairee'), 1600);
      });
    }

    // Les réactions, regroupées : « 👍 2 ». Toucher le compteur montre qui a réagi.
    let reactions = null;
    if (message.reactions && message.reactions.length) {
      reactions = el('div', { classe: 'bulle-reactions' }, message.reactions.map((r) => {
        const bouton = el('button', { classe: `reaction${r.moi ? ' reaction-moi' : ''}`, type: 'button', 'aria-label': `${r.nombre} réaction${r.nombre > 1 ? 's' : ''} ${r.emoji} : voir qui` }, [
          el('span', { texte: r.emoji, 'aria-hidden': 'true' }), el('span', { texte: String(r.nombre) }),
        ]);
        bouton.addEventListener('click', () => montrerReactions(message));
        return bouton;
      }));
    }

    const menu = menuOptions(() => [
      peutAgir ? { texte: 'Répondre', icone: 'repondre', action: () => repondreA(message) } : null,
      peutAgir ? { texte: 'Réagir', icone: 'sourire', action: () => choisirReaction(message, element) } : null,
      message.supprime ? null : { texte: 'Copier', icone: 'copier', action: async () => {
        try {
          await navigator.clipboard.writeText(message.texte);
          toast('Message copié.');
        } catch {
          toast('Ton navigateur n\'a pas permis la copie.', 'erreur');
        }
      } },
      message.supprimable ? { texte: 'Supprimer pour tout le monde', icone: 'supprimer', danger: true, action: () => supprimerMessage(message, true) } : null,
      { texte: 'Supprimer pour moi', icone: 'supprimer', danger: true, action: () => supprimerMessage(message, false) },
      message.estMoi || message.supprime ? null : { texte: 'Signaler', icone: 'signaler', action: () => signaler('message', message.id) },
    ], { cote: message.estMoi ? 'droite' : 'gauche' });
    menu.classList.add('bulle-menu');
    menu.querySelector('button').setAttribute('aria-label', 'Actions sur ce message');

    const element = el('div', {
      classe: `bulle ${message.estMoi ? 'bulle-moi' : 'bulle-autre'}${signee ? ' bulle-signee' : ''}${message.supprime ? ' bulle-supprimee' : ''}`,
      'data-message': message.id,
    }, [
      signee ? el('a', { classe: 'bulle-auteur', href: `/${message.auteur.identifiant}`, texte: message.auteur.nom }) : null,
      citation,
      message.image
        ? el('a', { href: message.image, target: '_blank', rel: 'noopener', 'aria-label': 'Ouvrir la photo' }, [el('img', { src: message.image, alt: 'Photo jointe au message', loading: 'lazy', decoding: 'async' })])
        : null,
      // textContent : le texte d'un membre n'est jamais interprété. Un lien écrit dans un message reste du simple texte.
      el('span', { classe: 'bulle-texte', texte: message.supprime ? 'Message supprimé' : message.texte }),
      el('span', { classe: 'bulle-heure', texte: heure(message.creeLe) }),
      reactions,
      menu,
    ]);

    // Sur téléphone : un appui long ouvre le menu, glisser la bulle vers la droite répond.
    let depart = null;
    let appuiLong = 0;
    const annuler = () => { clearTimeout(appuiLong); appuiLong = 0; };
    element.addEventListener('pointerdown', (evenement) => {
      if (evenement.pointerType === 'mouse' || evenement.target.closest('button, a')) return;
      depart = { x: evenement.clientX, y: evenement.clientY, glisse: false };
      appuiLong = setTimeout(() => {
        depart = null;
        menu.querySelector('button').click();
      }, 500);
    });
    element.addEventListener('pointermove', (evenement) => {
      if (!depart) return;
      const dx = evenement.clientX - depart.x;
      const dy = evenement.clientY - depart.y;
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) annuler();
      if (!peutAgir || Math.abs(dy) > 30 || dx < 0) return;
      depart.glisse = dx > 12;
      if (depart.glisse) element.style.transform = `translateX(${Math.min(dx, 72)}px)`;
    });
    const relacher = (evenement) => {
      annuler();
      if (!depart) return;
      const assez = depart.glisse && evenement.clientX - depart.x > 56;
      depart = null;
      element.style.transform = '';
      if (assez) repondreA(message);
    };
    element.addEventListener('pointerup', relacher);
    element.addEventListener('pointercancel', relacher);
    // L'appui long ne doit pas ouvrir en plus le menu du téléphone (copier / coller).
    element.addEventListener('contextmenu', (evenement) => { if (evenement.pointerType !== 'mouse' && !evenement.target.closest('a')) evenement.preventDefault(); });
    return element;
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
      if (message.systeme) return;
      if (message.estMoi) ouverte.monDernierId = message.id;
      else ouverte.dernierDeLAutre = message.id;
    });
  }

  // ---------- « Awa écrit… », « En ligne », « Vu par » ----------
  // Tout arrive par la requête déjà faite toutes les 5 secondes (route « nouveaux ») : aucun appel de plus.
  const adresseOuverte = () => (ouverte.estGroupe ? `/messages/groupes/${ouverte.id}` : `/messages/conversations/${ouverte.id}`);

  // La ligne « Awa écrit… », avec ses trois petits points, posée juste au-dessus de la zone d'écriture.
  function ligneEcriture() {
    return el('p', { classe: 'ecrit-en-ce-moment', hidden: true, 'aria-live': 'polite' });
  }
  function dessinerEcriture(prenoms) {
    if (!ouverte || !ouverte.ecritIci) return;
    const ligne = ouverte.ecritIci;
    ligne.hidden = prenoms.length === 0;
    if (ligne.hidden) return;
    let texte = `${prenoms[0]} écrit`;
    if (prenoms.length === 2) texte = `${prenoms[0]} et ${prenoms[1]} écrivent`;
    else if (prenoms.length > 2) texte = 'Plusieurs personnes écrivent';
    // Les prénoms viennent d'autres membres : textContent, comme partout.
    ligne.replaceChildren(el('span', { texte }), el('span', { classe: 'points-ecriture', 'aria-hidden': 'true' }, [el('span'), el('span'), el('span')]));
  }
  // « En ligne » ou « Actif il y a 2 h » ; rien si l'un des deux cache son statut.
  const textePresence = (presence) => (presence.enLigne ? 'En ligne' : `Actif ${dateRelative(presence.vuLe)}`);

  // Dans un groupe : le petit avatar de chacun sous le dernier message qu'il a lu.
  function dessinerVusPar() {
    if (!ouverte || !ouverte.estGroupe) return;
    ouverte.zone.querySelectorAll('.vus-par').forEach((ligne) => ligne.remove());
    const bulles = [...ouverte.zone.querySelectorAll('[data-message]')];
    const parMessage = new Map();
    ouverte.donnees.membres.filter((m) => !m.estMoi && m.luJusqua).forEach((membre) => {
      // Le dernier message affiché que ce membre a lu.
      const lue = bulles.filter((b) => Number(b.dataset.message) <= membre.luJusqua).pop();
      if (!lue) return;
      if (!parMessage.has(lue)) parMessage.set(lue, []);
      parMessage.get(lue).push(membre);
    });
    parMessage.forEach((lecteurs, apresBulle) => {
      apresBulle.after(el('div', { classe: 'vus-par', role: 'img', 'aria-label': `Vu par ${lecteurs.map((m) => m.prenom).join(', ')}` }, lecteurs.map((m) => avatar(m, 'mini'))));
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
      let nonLus;
      if (ouverte.estGroupe) {
        await api(`/messages/groupes/${ouverte.id}/lu`, { methode: 'POST', donnees: {} });
        ({ nonLus } = await api('/messages/non-lus'));
      } else {
        ({ nonLus } = await api(`/messages/conversations/${ouverte.id}/lu`, { methode: 'POST', donnees: {} }));
      }
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
    let reponse = null; // le message auquel on répond (sa citation s'affiche au-dessus du champ)
    const champ = el('textarea', { rows: '1', maxlength: '2000', placeholder: 'Écrire un message…', 'aria-label': 'Écrire un message' });
    const choisir = el('input', { type: 'file', accept: 'image/*', classe: 'visuellement-cache', 'aria-label': 'Joindre une photo' });
    const boutonPhoto = el('label', { classe: 'bouton-icone', title: 'Joindre une photo' }, [icone('image'), choisir]);
    const boutonEnvoyer = el('button', { classe: 'bouton bouton-principal bouton-envoyer', type: 'submit', 'aria-label': 'Envoyer le message', title: 'Envoyer' }, [icone('envoyer')]);
    const retirer = el('button', { classe: 'bouton-discret', type: 'button', texte: 'Retirer la photo' });
    const apercu = el('div', { classe: 'apercu-photo', hidden: true }, [el('img', { alt: 'Photo à envoyer' }), retirer]);
    const erreurZone = el('p', { classe: 'erreur-champ', role: 'alert' });
    const annulerReponse = el('button', { classe: 'bouton-icone', type: 'button', 'aria-label': 'Ne plus répondre à ce message' }, [icone('fermer')]);
    const citationReponse = el('p', { classe: 'reponse-texte' });
    const barreReponse = el('div', { classe: 'reponse-en-cours', hidden: true }, [icone('repondre'), citationReponse, annulerReponse]);
    const formulaire = el('form', { classe: 'zone-ecriture', novalidate: true }, [
      avertissement ? el('p', { classe: 'texte-discret avertissement-message', texte: avertissement }) : null,
      barreReponse,
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
    function oublierReponse() {
      reponse = null;
      barreReponse.hidden = true;
    }
    annulerReponse.addEventListener('click', oublierReponse);
    // Appelée par le menu d'un message ou par le glissement de sa bulle.
    formulaire.repondreA = (message) => {
      reponse = message;
      citationReponse.replaceChildren(el('strong', { texte: message.estMoi ? 'Toi' : message.auteur.prenom }), ` ${message.texte}`);
      barreReponse.hidden = false;
      champ.focus();
    };
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
    let dernierSignal = 0;
    champ.addEventListener('input', () => {
      champ.style.height = 'auto';
      champ.style.height = `${champ.scrollHeight}px`;
      // « J'écris » : un signal au serveur au plus toutes les 3 secondes pendant la frappe (il l'oublie après 6 s).
      if (!champ.value.trim() || Date.now() - dernierSignal < 3000 || !ouverte || !ouverte.id) return;
      dernierSignal = Date.now();
      api(`${adresseOuverte()}/ecrit`, { methode: 'POST', donnees: {} }).catch(() => {});
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
        await envoyer({ texte: champ.value, ...(image ? { image } : {}), ...(reponse ? { reponseA: reponse.id } : {}) });
        champ.value = '';
        champ.style.height = 'auto';
        retirerPhoto();
        oublierReponse();
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
    const role = [autre.type === 'client' ? 'Client' : 'Développeur', autre.ville].filter(Boolean).join(', ');
    const sousTitre = el('p', { classe: 'texte-discret', texte: role });
    const lienAvatar = el('a', { classe: 'lien-avatar avec-presence', href: `/${autre.identifiant}`, 'aria-label': `Profil de ${autre.nom}` }, [avatar(autre, 'moyen')]);
    const entete = el('header', { classe: 'conversation-entete' }, [
      retour,
      lienAvatar,
      el('div', { classe: 'conversation-qui' }, [nomMembre(autre), sousTitre]),
      menu,
    ]);
    // Point vert et « En ligne » quand on le sait ; sinon on garde « Développeur, Koudougou ».
    entete.majPresence = (presence) => {
      lienAvatar.classList.toggle('en-ligne', Boolean(presence && presence.enLigne));
      sousTitre.textContent = presence ? textePresence(presence) : role;
      sousTitre.classList.toggle('presence-en-ligne', Boolean(presence && presence.enLigne));
    };
    return entete;
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
    toast(`${prenom(autre)} est bloqué.`);
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
            toast(`${prenom(autre)} est débloqué.`);
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
        el('p', {}, [el('strong', { texte: `${prenom(autre)} veut t'écrire.` }), ' Vous n\'êtes pas amis. Tant que tu n\'acceptes pas, cette personne ne peut rien envoyer d\'autre et ne sait pas que tu as lu.']),
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
    ouverte.entete = enteteConversation(autre, { menu });
    ouverte.entete.majPresence(conversation.presence);
    panneau.replaceChildren(...[
      ouverte.entete,
      // Client et dev : on rappelle la demande dont il est question.
      conversation.demande
        ? el('a', { classe: 'bandeau-demande', href: `/demande?id=${conversation.demande.id}` }, [icone('demandes'), el('span', {}, ['À propos de la demande : ', el('strong', { texte: conversation.demande.titre })])])
        : null,
      zone,
      (ouverte.ecritIci = ligneEcriture()),
      bas,
    ].filter(Boolean));
    ouverte.ecriture = bas;
    ouverte.maintenant = reponse.maintenant;
    allerEnBas();
    dessinerListe(); // met en avant la conversation ouverte dans la liste
    marquerLu();
    demarrerConversation();
  }

  // ---------- Ouvrir un groupe (la discussion d'une équipe éclair) ----------
  const roleDe = (membre) => [membre.chef ? 'Chef d\'équipe' : null, membre.estClient ? 'Client' : null, membre.roleEquipe].filter(Boolean).join(', ');

  // Le panneau « Membres » : qui est là, et son rôle dans l'équipe.
  function montrerMembres(groupe) {
    const fermer = el('button', { classe: 'bouton bouton-principal', type: 'button', texte: 'Fermer' });
    const dialogue = el('dialog', { classe: 'dialogue dialogue-membres', 'aria-labelledby': 'membres-titre' }, [
      el('h2', { id: 'membres-titre', texte: `${groupe.membres.length} membre${groupe.membres.length > 1 ? 's' : ''}` }),
      el('ul', { classe: 'liste-membres-groupe' }, groupe.membres.map((membre) => el('li', {}, [
        el('a', { classe: 'lien-avatar', href: `/${membre.identifiant}`, 'aria-label': `Profil de ${membre.nom}` }, [avatar(membre, 'moyen')]),
        el('div', {}, [nomMembre(membre), el('p', { classe: 'texte-discret', texte: `${roleDe(membre) || 'Membre'}${membre.estMoi ? ' (toi)' : ''}` })]),
      ]))),
      el('div', { classe: 'dialogue-actions' }, [fermer]),
    ]);
    fermer.addEventListener('click', () => dialogue.close());
    dialogue.addEventListener('close', () => dialogue.remove());
    document.body.append(dialogue);
    dialogue.showModal();
  }

  // Renommer le groupe : réservé au chef (le serveur le vérifie aussi).
  function renommer(groupe) {
    const champ = el('input', { id: 'titre-groupe', type: 'text', maxlength: '80', required: true });
    champ.value = groupe.titre;
    const erreurZone = el('p', { classe: 'erreur-champ', role: 'alert' });
    const annuler = el('button', { classe: 'bouton bouton-lien', type: 'button', texte: 'Annuler' });
    const valider = el('button', { classe: 'bouton bouton-principal', type: 'submit', texte: 'Enregistrer' });
    const formulaire = el('form', { novalidate: true }, [
      el('h2', { id: 'renommer-titre', texte: 'Nom du groupe' }),
      el('div', { classe: 'champ' }, [el('label', { for: 'titre-groupe', texte: 'Nom' }), champ, erreurZone]),
      el('div', { classe: 'dialogue-actions' }, [annuler, valider]),
    ]);
    const dialogue = el('dialog', { classe: 'dialogue', 'aria-labelledby': 'renommer-titre' }, [formulaire]);
    annuler.addEventListener('click', () => dialogue.close());
    dialogue.addEventListener('close', () => dialogue.remove());
    formulaire.addEventListener('submit', async (evenement) => {
      evenement.preventDefault();
      valider.disabled = true;
      try {
        await api(`/messages/groupes/${groupe.id}`, { methode: 'PUT', donnees: { titre: champ.value } });
        dialogue.close();
        toast('Groupe renommé.');
        chargerListe();
        ouvrirGroupe(groupe.id);
      } catch (erreur) {
        erreurZone.textContent = erreur.message;
        valider.disabled = false;
      }
    });
    document.body.append(dialogue);
    dialogue.showModal();
    champ.select();
  }

  async function ouvrirGroupe(id) {
    arreterConversation();
    document.body.classList.add('conversation-ouverte');
    panneau.replaceChildren();
    const fini = chargement(panneau, 2);
    let reponse;
    try {
      reponse = await api(`/messages/groupes/${id}`);
    } catch (erreur) {
      fini();
      panneau.replaceChildren(etatVide('calme', 'Groupe introuvable', erreur.statut === 404 ? 'Il n\'existe pas, ou tu n\'en fais plus partie.' : erreur.message,
        el('a', { classe: 'bouton bouton-principal', href: '/messages', texte: 'Toutes mes conversations' })));
      return;
    }
    fini();
    const { groupe } = reponse;
    document.title = `${groupe.titre} – Messages – Palabre`;
    const zone = el('div', { classe: 'fil-messages', role: 'log', 'aria-label': `Messages du groupe ${groupe.titre}`, tabindex: '0' });
    const mentionVu = el('p', { classe: 'mention-vu', hidden: true });
    ouverte = { id, estGroupe: true, donnees: groupe, zone, mentionVu, dernierId: 0, monDernierId: 0, dernierDeLAutre: 0, dernierJour: null, vuJusqua: 0 };

    const menu = menuOptions(() => [
      { texte: 'Membres', icone: 'amis', action: () => montrerMembres(groupe) },
      groupe.demande ? { texte: 'Voir la demande', icone: 'demandes', action: () => { window.location.href = `/demande?id=${groupe.demande.id}`; } } : null,
      groupe.jeSuisChef && !groupe.ferme ? { texte: 'Renommer le groupe', icone: 'modifier', action: () => renommer(groupe) } : null,
      { texte: groupe.sourdine ? 'Réactiver les notifications' : 'Mettre en sourdine', icone: 'cloche', action: async () => {
        try {
          await api(`/messages/groupes/${id}/sourdine`, { methode: 'POST', donnees: { active: !groupe.sourdine } });
          groupe.sourdine = !groupe.sourdine;
          toast(groupe.sourdine ? 'Groupe en sourdine : plus de notification pour lui.' : 'Notifications du groupe réactivées.');
        } catch (erreur) { toast(erreur.message, 'erreur'); }
      } },
      { texte: 'Signaler', icone: 'signaler', action: () => {
        if (ouverte.dernierDeLAutre) signaler('message', ouverte.dernierDeLAutre);
        else toast('Il n\'y a aucun message d\'un autre membre à signaler.', 'erreur');
      } },
      // Le chef ne quitte pas : il dissout l'équipe depuis la page de la demande.
      groupe.jeSuisChef && !groupe.ferme ? null : { texte: 'Quitter le groupe', icone: 'deconnexion', danger: true, action: async () => {
        const moiDansLeGroupe = groupe.membres.find((m) => m.estMoi);
        const question = groupe.ferme || (moiDansLeGroupe && moiDansLeGroupe.estClient)
          ? 'Quitter ce groupe ? Tu ne verras plus ses messages.'
          : 'Quitter ce groupe ? Tu ne verras plus ses messages. Si le client n\'a pas encore choisi, tu quittes aussi l\'équipe.';
        if (!(await confirmer(question, { bouton: 'Quitter', danger: true }))) return;
        try {
          const { quitteLEquipe } = await api(`/messages/groupes/${id}/quitter`, { methode: 'POST', donnees: {} });
          toast(quitteLEquipe ? 'Tu as quitté l\'équipe et son groupe.' : 'Tu as quitté le groupe.');
          chargerListe();
          aller('/messages');
        } catch (erreur) { toast(erreur.message, 'erreur'); }
      } },
    ]);

    const retour = el('button', { classe: 'bouton-icone bouton-retour', type: 'button', 'aria-label': 'Retour à la liste des conversations' }, [icone('fleche-gauche')]);
    retour.addEventListener('click', () => aller('/messages'));
    const ouvrirMembres = el('button', { classe: 'entete-groupe', type: 'button', 'aria-label': `${groupe.titre}, ${groupe.membres.length} membres : voir les membres` }, [
      avatarsEmpiles(groupe.membres.filter((m) => !m.estMoi).concat(groupe.membres.filter((m) => m.estMoi)), 'mini'),
      el('span', { classe: 'conversation-qui' }, [
        el('strong', { classe: 'conversation-titre', texte: groupe.titre }),
        el('span', { classe: 'texte-discret', texte: `${groupe.membres.length} membre${groupe.membres.length > 1 ? 's' : ''}${groupe.ferme ? ', équipe dissoute' : ''}` }),
      ]),
    ]);
    ouvrirMembres.addEventListener('click', () => montrerMembres(groupe));

    const bas = groupe.peutEcrire
      ? zoneEcriture({
        envoyer: async (donnees) => {
          const { message } = await api(`/messages/groupes/${id}`, { methode: 'POST', donnees });
          ajouterMessages([message]);
          dessinerVusPar();
          allerEnBas();
          chargerListe();
        },
      })
      : el('p', { classe: 'zone-demande texte-discret', texte: groupe.raison });

    const plusAnciens = el('button', { classe: 'bouton bouton-contour bouton-compact plus-anciens', type: 'button', texte: 'Voir les messages précédents', hidden: !reponse.precedent });
    let precedent = reponse.precedent;
    plusAnciens.addEventListener('click', async () => {
      plusAnciens.disabled = true;
      try {
        const suite = await api(`/messages/groupes/${id}?avant=${precedent}`);
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
    panneau.replaceChildren(...[
      el('header', { classe: 'conversation-entete' }, [retour, ouvrirMembres, menu]),
      groupe.demande
        ? el('a', { classe: 'bandeau-demande', href: `/demande?id=${groupe.demande.id}` }, [icone('demandes'), el('span', {}, ['Équipe éclair pour la demande : ', el('strong', { texte: groupe.demande.titre })])])
        : null,
      zone,
      (ouverte.ecritIci = ligneEcriture()),
      bas,
    ].filter(Boolean));
    ouverte.ecriture = bas;
    ouverte.maintenant = reponse.maintenant;
    dessinerVusPar();
    allerEnBas();
    dessinerListe();
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
            ? `Vous n'êtes pas encore amis : ton premier message sera une demande. Tu pourras continuer quand ${prenom(info.autre)} l'aura acceptée.`
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
        el('div', { classe: 'fil-messages' }, [etatVide('palabre', `Écris à ${prenom(info.autre)}`, 'Présente-toi en quelques mots : c\'est le début de la conversation.')]),
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
    // « depuis » : l'heure du serveur à notre dernière lecture. Il renvoie les messages déjà affichés qui ont changé
    // (réaction, suppression) : la même requête qu'avant, toutes les 5 secondes, sans appel de plus.
    const depuis = ouverte.maintenant ? `&depuis=${encodeURIComponent(ouverte.maintenant)}` : '';
    try {
      if (ouverte.estGroupe) {
        const reponse = await api(`/messages/groupes/${id}/nouveaux?apres=${ouverte.dernierId}${depuis}`);
        if (!ouverte || ouverte.id !== id) return;
        ouverte.maintenant = reponse.maintenant;
        (reponse.modifies || []).forEach(redessiner);
        dessinerEcriture(reponse.ecrivent || []);
        // Jusqu'où chacun a lu : les petits avatars « vu par » suivent.
        (reponse.lectures || []).forEach((lecture) => {
          const membre = ouverte.donnees.membres.find((m) => m.identifiant === lecture.identifiant);
          if (membre) membre.luJusqua = lecture.luJusqua;
        });
        // Le groupe vient d'être fermé (équipe dissoute) ou renommé : on redessine tout.
        if (reponse.ferme !== ouverte.donnees.ferme || reponse.titre !== ouverte.donnees.titre) {
          chargerListe();
          ouvrirGroupe(id);
          return;
        }
        const enBas = ouverte.zone.scrollHeight - ouverte.zone.scrollTop - ouverte.zone.clientHeight < 80;
        const nouveaux = reponse.messages.filter((m) => m.id > ouverte.dernierId);
        if (nouveaux.length) ajouterMessages(nouveaux);
        dessinerVusPar();
        if (nouveaux.length) {
          if (enBas) allerEnBas();
          if (nouveaux.some((m) => !m.estMoi)) {
            marquerLu();
            chargerListe();
          }
        }
        return;
      }
      const reponse = await api(`/messages/conversations/${id}/nouveaux?apres=${ouverte.dernierId}${depuis}`);
      if (!ouverte || ouverte.id !== id) return; // on a changé de conversation pendant la requête
      ouverte.maintenant = reponse.maintenant;
      (reponse.modifies || []).forEach(redessiner);
      dessinerEcriture(reponse.ecrivent || []);
      if (ouverte.entete) ouverte.entete.majPresence(reponse.presence);
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
    const groupe = /^\/messages\/groupe\/(\d+)$/.exec(window.location.pathname);
    const parametres = new URLSearchParams(window.location.search);
    if (groupe) ouvrirGroupe(Number(groupe[1]));
    else if (numero) ouvrir(Number(numero[1]));
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
