// Page « Mes amis » : demandes reçues, amis, demandes envoyées.
(function () {
  const { api, el, avatar, utilisateurConnecte } = window.Palabre;

  function message(texte, type) {
    const zone = document.querySelector('[data-message]');
    zone.textContent = texte;
    zone.className = `message ${type || ''}`;
  }

  // Un bouton qui appelle l'API puis recharge les listes.
  function boutonAction(texte, classe, action) {
    const bouton = el('button', { classe: `bouton ${classe}`, type: 'button', texte });
    bouton.addEventListener('click', async () => {
      bouton.disabled = true;
      try {
        const texteSucces = await action();
        if (texteSucces === null) { // action annulée par la personne
          bouton.disabled = false;
          return;
        }
        await charger();
        message(texteSucces, 'succes');
      } catch (erreur) {
        message(erreur.message, 'erreur');
        bouton.disabled = false;
      }
    });
    return bouton;
  }

  function ligneMembre(membre, boutons) {
    const lieu = [membre.ville, membre.pays].filter(Boolean).join(', ');
    return el('li', { classe: 'ligne-membre' }, [
      el('a', { classe: 'lien-avatar', href: `/${membre.identifiant}`, 'aria-label': `Profil de ${membre.nom}` }, [avatar(membre, 'moyen')]),
      el('div', { classe: 'ligne-membre-infos' }, [
        el('a', { classe: 'nom-auteur', href: `/${membre.identifiant}`, texte: membre.nom }),
        el('p', { classe: 'texte-discret', texte: lieu }),
      ]),
      el('div', { classe: 'ligne-membre-actions' }, boutons),
    ]);
  }

  function section(titre, membres, boutonsPour, texteVide) {
    const contenu = membres.length
      ? el('ul', { classe: 'liste-membres' }, membres.map((m) => ligneMembre(m, boutonsPour(m))))
      : el('p', { classe: 'texte-discret', texte: texteVide });
    return el('section', { classe: 'section-profil' }, [
      el('h2', { texte: membres.length ? `${titre} (${membres.length})` : titre }),
      contenu,
    ]);
  }

  async function charger() {
    const zone = document.querySelector('[data-amis]');
    const { amis, recues, envoyees } = await api('/amis');
    const cible = (m) => encodeURIComponent(m.identifiant);

    const sections = [];
    if (recues.length) {
      sections.push(section('Demandes reçues', recues, (m) => [
        boutonAction('Accepter', 'bouton-principal', async () => {
          await api(`/amis/demandes/${cible(m)}/accepter`, { methode: 'POST', donnees: {} });
          return `${m.nom} et toi êtes maintenant amis.`;
        }),
        boutonAction('Refuser', 'bouton-contour', async () => {
          await api(`/amis/demandes/${cible(m)}/refuser`, { methode: 'POST', donnees: {} });
          return 'Demande refusée.';
        }),
      ]));
    }
    sections.push(section('Amis', amis, (m) => [
      boutonAction('Retirer', 'bouton-lien', async () => {
        if (!window.confirm(`Retirer ${m.nom} de tes amis ?`)) return null;
        await api(`/amis/${cible(m)}`, { methode: 'DELETE', donnees: {} });
        return `${m.nom} ne fait plus partie de tes amis.`;
      }),
    ], 'Tu n\'as pas encore d\'amis sur Palabre. Ouvre le profil d\'un membre depuis le fil et clique sur « Ajouter en ami ».'));
    if (envoyees.length) {
      sections.push(section('Demandes envoyées', envoyees, (m) => [
        boutonAction('Annuler', 'bouton-lien', async () => {
          await api(`/amis/${cible(m)}`, { methode: 'DELETE', donnees: {} });
          return 'Demande annulée.';
        }),
      ]));
    }
    zone.replaceChildren(...sections);

    // La pastille du menu suit le nombre de demandes qui restent à traiter.
    const pastille = document.querySelector('[data-nav] .compteur');
    if (pastille && recues.length) pastille.textContent = String(recues.length);
    else if (pastille) pastille.remove();
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const moi = await utilisateurConnecte();
    if (!moi) {
      window.location.href = '/connexion?suite=/amis';
      return;
    }
    try {
      await charger();
    } catch (erreur) {
      document.querySelector('[data-amis]').replaceChildren();
      message(erreur.message, 'erreur');
    }
  });
})();
