// Page « Mes amis » : demandes reçues, amis, demandes envoyées.
(function () {
  const { t, deNom, lieuDe, api, el, avatar, utilisateurConnecte, icone, etatVide, confirmer, nomMembre } = window.Palabre;

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
    const lieu = lieuDe(membre);
    return el('li', { classe: 'ligne-membre' }, [
      el('a', { classe: 'lien-avatar', href: `/${membre.identifiant}`, 'aria-label': t('commun.profil-de', { nom: membre.nom, deNom: deNom(membre.nom) }) }, [avatar(membre, 'moyen')]),
      el('div', { classe: 'ligne-membre-infos' }, [
        nomMembre(membre),
        el('p', { classe: 'texte-discret', texte: lieu }),
      ]),
      el('div', { classe: 'ligne-membre-actions' }, boutons),
    ]);
  }

  function section(titre, membres, boutonsPour, siVide) {
    const contenu = membres.length
      ? el('ul', { classe: 'liste-membres' }, membres.map((m) => ligneMembre(m, boutonsPour(m))))
      : siVide;
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
      sections.push(section(t('amis.demandes-recues'), recues, (m) => [
        boutonAction(t('commun.accepter'), 'bouton-principal', async () => {
          await api(`/amis/demandes/${cible(m)}/accepter`, { methode: 'POST', donnees: {} });
          return t('amis.maintenant-amis', { nom: m.nom });
        }),
        boutonAction(t('commun.refuser'), 'bouton-contour', async () => {
          await api(`/amis/demandes/${cible(m)}/refuser`, { methode: 'POST', donnees: {} });
          return t('profil.demande-refusee');
        }),
      ]));
    }
    sections.push(section(t('nav.amis'), amis, (m) => [
      boutonAction(t('commun.retirer'), 'bouton-lien', async () => {
        if (!(await confirmer(t('amis.retirer-question', { nom: m.nom }), { bouton: t('commun.retirer'), danger: true }))) return null;
        await api(`/amis/${cible(m)}`, { methode: 'DELETE', donnees: {} });
        return t('amis.retire', { nom: m.nom });
      }),
    ], etatVide('amis', t('amis.cercle'), t('amis.cercle-aide'),
      el('a', { classe: 'bouton bouton-principal', href: '/chercher' }, [icone('recherche'), t('fil.trouver-devs')]))));
    if (envoyees.length) {
      sections.push(section(t('amis.demandes-envoyees'), envoyees, (m) => [
        boutonAction(t('commun.annuler'), 'bouton-lien', async () => {
          await api(`/amis/${cible(m)}`, { methode: 'DELETE', donnees: {} });
          return t('amis.demande-annulee');
        }),
      ]));
    }
    zone.replaceChildren(...sections);

    // La pastille du menu suit le nombre de demandes qui restent à traiter.
    document.querySelectorAll('.compteur-amis').forEach((pastille) => {
      if (recues.length) pastille.textContent = String(recues.length);
      else pastille.remove();
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const moi = await utilisateurConnecte();
    if (!moi) {
      window.Palabre.versConnexion('/connexion?suite=/amis');
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
