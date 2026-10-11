// Le Griot de Palabre : la fenêtre d'aide. Chargé seulement au premier toucher du bouton « Besoin d'aide ? »
// (chargerGriot() dans app.js), avec assistant-recherche.js (les sujets et la recherche) et css/assistant.css.
//
// Ce n'est pas une intelligence artificielle : la question est comparée, ici dans le navigateur, aux mots-clés de
// chaque sujet. Rien n'est envoyé au serveur ; aucune question n'est enregistrée ni lue par personne.
// Tous les textes viennent de public/langues (famille « assistant. »).
(function () {
  const { t, el, icone } = window.Palabre;
  const moteur = window.PalabreAssistant;
  // L'index : les mots-clés des deux langues, préparés une fois.
  const index = moteur.indexer(window.PalabreLangues || {});
  let fenetre = null;

  // L'adresse de l'équipe (variable CONTACT_MODERATION). Elle n'est écrite dans aucun script : le serveur la pose
  // dans la page /regles (avecContact() de src/utils/statique.js). On la lit là, la première fois qu'il la faut.
  let adresseEquipe = null;
  async function lireAdresse() {
    if (adresseEquipe) return adresseEquipe;
    const dans = (racine) => {
      const lien = racine.querySelector('a[data-contact-moderation]');
      const href = lien ? lien.getAttribute('href') || '' : '';
      return /^mailto:[^\s<>"]+@[^\s<>"]+$/.test(href) ? href : null;
    };
    adresseEquipe = dans(document);
    if (!adresseEquipe) {
      try {
        const page = await (await fetch('/regles', { credentials: 'same-origin' })).text();
        adresseEquipe = dans(new DOMParser().parseFromString(page, 'text/html'));
      } catch { /* sans réseau : le bouton mène simplement à la page des règles, où l'adresse est écrite */ }
    }
    return adresseEquipe;
  }
  // Le bouton « Écrire à l'équipe » : il mène d'abord à /regles, puis devient un lien « mailto: » dès que
  // l'adresse est connue.
  function boutonContact(texte) {
    const lien = el('a', { classe: 'bouton bouton-contour bouton-compact', href: '/regles' }, [icone('enveloppe'), texte]);
    lireAdresse().then((adresse) => { if (adresse) lien.href = adresse; });
    return lien;
  }

  function construire({ profil, page, bouton }) {
    const fil = el('div', { classe: 'griot-fil', role: 'log', 'aria-live': 'polite', 'aria-label': t('assistant.conversation'), tabindex: '0' });
    const champ = el('input', { classe: 'griot-champ', type: 'text', maxlength: '200', autocomplete: 'off', enterkeyhint: 'send', placeholder: t('assistant.champ'), 'aria-label': t('assistant.champ') });
    const envoyer = el('button', { classe: 'griot-envoyer', type: 'submit', 'aria-label': t('assistant.envoyer') }, [icone('envoyer')]);
    const formulaire = el('form', { classe: 'griot-forme' }, [champ, envoyer]);
    const fermer = el('button', { classe: 'griot-fermer', type: 'button', 'aria-label': t('assistant.fermer') }, [icone('fermer')]);

    // Une bulle : « moi » (ce que la personne a écrit ou touché) ou « griot » (la réponse).
    // Le texte écrit par la personne passe par textContent (el()) : il n'est jamais interprété.
    function bulle(qui, contenu) {
      const element = el('div', { classe: `griot-bulle griot-bulle-${qui}` }, contenu);
      fil.append(element);
      // La réponse arrive en haut de la zone visible : on lit depuis le début, pas depuis les boutons.
      requestAnimationFrame(() => { fil.scrollTop = Math.max(0, element.offsetTop - 12); });
      return element;
    }
    const lienVers = (bouton) => {
      if (bouton.contact) return boutonContact(t('assistant.bouton.contact'));
      const lien = el('a', { classe: 'bouton bouton-contour bouton-compact', href: bouton.href, texte: t(`assistant.bouton.${bouton.id}`) });
      // Un lien vers une rubrique de la page où l'on est déjà (/parametres#langue) : la fenêtre se referme.
      lien.addEventListener('click', () => dialogue.close());
      return lien;
    };

    // Répondre : par le sujet touché, ou par la recherche dans ce qui a été écrit.
    function repondre(question, sujet = null) {
      bulle('moi', [el('p', { texte: question })]);
      const id = sujet || moteur.chercher(question, index);
      if (!id) {
        bulle('griot', [el('p', { texte: t('assistant.pas-compris') }), el('div', { classe: 'griot-boutons' }, [boutonContact(t('assistant.ecrire-equipe'))])]);
        return;
      }
      const boutons = moteur.boutonsPour(id, profil).map(lienVers);
      bulle('griot', [el('p', { texte: t(`assistant.sujet.${id}.reponse`) }), boutons.length ? el('div', { classe: 'griot-boutons' }, boutons) : null].filter(Boolean));
    }

    // Les suggestions : adaptées à la personne (visiteur, dev, client) et à la page.
    const sujets = el('div', { classe: 'griot-sujets', role: 'group', 'aria-label': t('assistant.sujets') }, moteur.suggestionsPour(profil, page).map((id) => {
      const puce = el('button', { classe: 'griot-puce', type: 'button', texte: t(`assistant.sujet.${id}.question`) });
      puce.addEventListener('click', () => repondre(puce.textContent, id));
      return puce;
    }));

    const dialogue = el('dialog', { classe: 'griot', 'aria-labelledby': 'griot-titre' }, [
      el('header', { classe: 'griot-entete' }, [
        el('span', { classe: 'griot-medaillon', 'aria-hidden': 'true' }, [icone('feuille')]),
        el('div', { classe: 'griot-qui' }, [
          el('h2', { id: 'griot-titre', texte: t('assistant.titre') }),
          el('p', { classe: 'griot-automatique', texte: t('assistant.automatique') }),
        ]),
        fermer,
      ]),
      fil,
      sujets,
      formulaire,
    ]);
    bulle('griot', [el('p', { texte: t('assistant.bonjour') }), el('p', { classe: 'texte-discret', texte: t('assistant.choisis') })]);

    formulaire.addEventListener('submit', (evenement) => {
      evenement.preventDefault();
      const question = champ.value.trim();
      if (!question) return;
      champ.value = '';
      repondre(question);
    });
    fermer.addEventListener('click', () => dialogue.close());
    // À la fermeture (croix, Échap, toucher sur le fond), le focus revient au bouton « Besoin d'aide ? ». Tous les
    // navigateurs ne le font pas seuls : certains ne donnent pas le focus à un bouton qu'on touche.
    dialogue.addEventListener('close', () => { if (bouton) bouton.focus(); });
    // Un toucher sur le fond (hors de la fenêtre) la referme, comme la touche Échap.
    dialogue.addEventListener('click', (evenement) => { if (evenement.target === dialogue) dialogue.close(); });
    document.body.append(dialogue);
    return dialogue;
  }

  // ouvrir({ profil, page, bouton }) : profil = 'visiteur', 'dev' ou 'client' ; page = 'accueil', 'fil'… ; bouton :
  // celui qui a ouvert la fenêtre, pour lui rendre le focus.
  // La fenêtre est construite une fois par page : rouverte, elle garde ce qui a déjà été demandé.
  // showModal() donne la touche Échap pour fermer, garde le focus dans la fenêtre, et le rend au bouton à la fermeture.
  function ouvrir(contexte) {
    fenetre = fenetre || construire(contexte);
    if (!fenetre.open) fenetre.showModal();
  }

  window.Palabre.griot = { ouvrir };
})();
