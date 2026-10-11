// Recherche de développeurs par compétence, pays, ville et disponibilité. Visible sans compte.
(function () {
  const { t, deNom, nombre, nomPays, lieuDe, api, el, avatar, etoiles, icone, etatVide, chargement, chargementInfini, nomMembre } = window.Palabre;

  const MAX_COMPETENCES_AFFICHEES = 5;
  let pageSuivante = null;

  function carteDev(dev) {
    const lieu = lieuDe(dev);
    const visibles = dev.competences.slice(0, MAX_COMPETENCES_AFFICHEES);
    const reste = dev.competences.length - visibles.length;
    const preuves = [];
    if (dev.nbAvis) {
      preuves.push(el('span', {}, [etoiles(dev.noteMoyenne), t('chercher.note', { note: nombre(dev.noteMoyenne), n: dev.nbAvis })]));
    }
    if (dev.projetsVerifies) {
      preuves.push(el('span', { classe: 'badge-verifie' }, [icone('verifie'), t('chercher.projets-verifies', { n: dev.projetsVerifies })]));
    } else if (dev.nbProjets) {
      preuves.push(el('span', { classe: 'texte-discret', texte: t('commun.projets', { n: dev.nbProjets }) }));
    }
    return el('article', { classe: 'carte-publication carte-dev' }, [
      el('div', { classe: 'publication-entete' }, [
        el('a', { classe: 'lien-avatar', href: `/${dev.identifiant}`, 'aria-label': t('commun.profil-de', { nom: dev.nom, deNom: deNom(dev.nom) }) }, [avatar(dev, 'moyen')]),
        el('div', {}, [
          el('h2', {}, [nomMembre(dev)]),
          el('p', { classe: 'texte-discret publication-meta avec-icone' }, [icone('lieu'), lieu]),
        ]),
      ]),
      el('span', { classe: `pastille ${dev.disponible ? 'pastille-dispo' : 'pastille-occupe'}`, texte: dev.disponible ? t('chercher.disponible') : t('profil.occupe') }),
      preuves.length ? el('p', { classe: 'preuves' }, preuves) : null,
      visibles.length
        ? el('ul', { classe: 'puces' }, [...visibles.map((c) => el('li', { texte: c })), reste > 0 ? el('li', { texte: `+ ${reste}` }) : null])
        : null,
      el('a', { classe: 'bouton bouton-contour', href: `/${dev.identifiant}`, texte: t('chercher.voir-profil') }),
    ]);
  }

  // Demande une page de résultats et l'ajoute. Répond true s'il en reste.
  let recherche = 0; // une nouvelle recherche pendant un chargement : l'ancienne réponse est ignorée
  async function page(numero, avantAjout = () => {}) {
    const formulaire = document.querySelector('[data-recherche]');
    const maRecherche = recherche;
    const parametres = new URLSearchParams({ page: numero });
    if (formulaire.elements.competence.value) parametres.set('competence', formulaire.elements.competence.value);
    if (formulaire.elements.pays.value) parametres.set('pays', formulaire.elements.pays.value);
    if (formulaire.elements.ville.value.trim()) parametres.set('ville', formulaire.elements.ville.value.trim());
    if (formulaire.elements.disponible.checked) parametres.set('disponible', '1');
    const reponse = await api(`/devs?${parametres}`);
    if (maRecherche !== recherche) return false;
    avantAjout();
    document.querySelector('[data-resultats]').append(...reponse.devs.map(carteDev));
    pageSuivante = reponse.pageSuivante;
    return Boolean(pageSuivante);
  }

  // Une recherche depuis le début. Les pages suivantes arrivent en défilant (chargementInfini() dans app.js).
  let infini = null;
  async function chercher() {
    const resultats = document.querySelector('[data-resultats]');
    const etat = document.querySelector('[data-etat]');
    if (!infini) infini = chargementInfini(resultats, () => page(pageSuivante), { fin: t('chercher.tous-vus'), bouton: document.querySelector('[data-charger-plus]') });
    recherche += 1;
    const maRecherche = recherche;
    resultats.replaceChildren();
    etat.hidden = true;
    infini.reprendre(false);
    const fini = chargement(resultats, 3);
    try {
      const encore = await page(1, fini);
      if (maRecherche !== recherche) return;
      infini.reprendre(encore);
      etat.hidden = resultats.children.length > 0;
      etat.replaceChildren(etatVide('recherche', t('chercher.aucun'), t('chercher.aucun-aide')));
    } catch (erreur) {
      fini();
      etat.hidden = false;
      etat.replaceChildren(etatVide('calme', t('chercher.ne-repond-pas'), erreur.message));
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const formulaire = document.querySelector('[data-recherche]');
    formulaire.addEventListener('submit', (evenement) => {
      evenement.preventDefault();
      chercher();
    });
    chercher();
    try {
      const [{ competences }, { pays }] = await Promise.all([api('/competences'), api('/pays')]);
      formulaire.elements.competence.append(...competences.map((c) => el('option', { value: c.id, texte: c.nom })));
      formulaire.elements.pays.append(...pays.map((p) => el('option', { value: p, texte: nomPays(p) })));
    } catch { /* sans les listes, la recherche par ville reste possible */ }
  });
})();
