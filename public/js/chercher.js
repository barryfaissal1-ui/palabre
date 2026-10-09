// Recherche de développeurs par compétence, pays, ville et disponibilité. Visible sans compte.
(function () {
  const { api, el, avatar, etoiles, icone, etatVide, chargement, nomMembre } = window.Palabre;

  const MAX_COMPETENCES_AFFICHEES = 5;
  let pageSuivante = null;

  function carteDev(dev) {
    const lieu = [dev.ville, dev.pays].filter(Boolean).join(', ');
    const visibles = dev.competences.slice(0, MAX_COMPETENCES_AFFICHEES);
    const reste = dev.competences.length - visibles.length;
    const preuves = [];
    if (dev.nbAvis) {
      preuves.push(el('span', {}, [etoiles(dev.noteMoyenne), ` ${String(dev.noteMoyenne).replace('.', ',')} (${dev.nbAvis} avis)`]));
    }
    if (dev.projetsVerifies) {
      preuves.push(el('span', { classe: 'badge-verifie' }, [icone('verifie'), `${dev.projetsVerifies} projet${dev.projetsVerifies > 1 ? 's' : ''} vérifié${dev.projetsVerifies > 1 ? 's' : ''}`]));
    } else if (dev.nbProjets) {
      preuves.push(el('span', { classe: 'texte-discret', texte: `${dev.nbProjets} projet${dev.nbProjets > 1 ? 's' : ''}` }));
    }
    return el('article', { classe: 'carte-publication carte-dev' }, [
      el('div', { classe: 'publication-entete' }, [
        el('a', { classe: 'lien-avatar', href: `/${dev.identifiant}`, 'aria-label': `Profil de ${dev.nom}` }, [avatar(dev, 'moyen')]),
        el('div', {}, [
          el('h2', {}, [nomMembre(dev)]),
          el('p', { classe: 'texte-discret publication-meta avec-icone' }, [icone('lieu'), lieu]),
        ]),
      ]),
      el('span', { classe: `pastille ${dev.disponible ? 'pastille-dispo' : 'pastille-occupe'}`, texte: dev.disponible ? 'Disponible' : 'Occupé en ce moment' }),
      preuves.length ? el('p', { classe: 'preuves' }, preuves) : null,
      visibles.length
        ? el('ul', { classe: 'puces' }, [...visibles.map((c) => el('li', { texte: c })), reste > 0 ? el('li', { texte: `+ ${reste}` }) : null])
        : null,
      el('a', { classe: 'bouton bouton-contour', href: `/${dev.identifiant}`, texte: 'Voir le profil' }),
    ]);
  }

  async function chercher(page = 1) {
    const formulaire = document.querySelector('[data-recherche]');
    const resultats = document.querySelector('[data-resultats]');
    const etat = document.querySelector('[data-etat]');
    const boutonPlus = document.querySelector('[data-charger-plus]');
    if (page === 1) resultats.replaceChildren();
    boutonPlus.hidden = true;
    etat.hidden = true;
    const fini = chargement(resultats, page === 1 ? 3 : 1);

    const parametres = new URLSearchParams({ page });
    if (formulaire.elements.competence.value) parametres.set('competence', formulaire.elements.competence.value);
    if (formulaire.elements.pays.value) parametres.set('pays', formulaire.elements.pays.value);
    if (formulaire.elements.ville.value.trim()) parametres.set('ville', formulaire.elements.ville.value.trim());
    if (formulaire.elements.disponible.checked) parametres.set('disponible', '1');
    try {
      const reponse = await api(`/devs?${parametres}`);
      fini();
      resultats.append(...reponse.devs.map(carteDev));
      pageSuivante = reponse.pageSuivante;
      boutonPlus.hidden = !pageSuivante;
      etat.hidden = resultats.children.length > 0;
      etat.replaceChildren(etatVide('recherche', 'Aucun développeur ne correspond', 'Essaie avec moins de critères, ou une autre ville.'));
    } catch (erreur) {
      fini();
      etat.hidden = false;
      etat.replaceChildren(etatVide('calme', 'La recherche ne répond pas', erreur.message));
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const formulaire = document.querySelector('[data-recherche]');
    formulaire.addEventListener('submit', (evenement) => {
      evenement.preventDefault();
      chercher(1);
    });
    document.querySelector('[data-charger-plus]').addEventListener('click', () => chercher(pageSuivante));
    chercher(1);
    try {
      const [{ competences }, { pays }] = await Promise.all([api('/competences'), api('/pays')]);
      formulaire.elements.competence.append(...competences.map((c) => el('option', { value: c.id, texte: c.nom })));
      formulaire.elements.pays.append(...pays.map((p) => el('option', { value: p, texte: p })));
    } catch { /* sans les listes, la recherche par ville reste possible */ }
  });
})();
