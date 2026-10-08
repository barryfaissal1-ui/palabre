// Page « Demandes » : liste par 10, filtres, et formulaire de publication pour les clients.
(function () {
  const { api, el, utilisateurConnecte, dateRelative, fcfa } = window.Palabre;

  const NOMS_STATUTS = { ouverte: 'Ouverte', attribuee: 'Attribuée', terminee: 'Terminée', annulee: 'Annulée' };

  let filtre = 'ouvertes'; // 'ouvertes' ou 'miennes'
  let categorie = '';
  let suivant = null;

  function carteDemande(demande) {
    const propositions = demande.nbPropositions
      ? `${demande.nbPropositions} proposition${demande.nbPropositions > 1 ? 's' : ''}`
      : 'Aucune proposition';
    return el('article', { classe: 'carte-publication carte-demande' }, [
      el('p', { classe: 'publication-meta' }, [
        el('span', { classe: `statut-demande statut-${demande.statut}`, texte: NOMS_STATUTS[demande.statut] }),
        el('span', { classe: 'texte-discret', texte: ` · ${demande.nomCategorie} · ${dateRelative(demande.creeLe)}` }),
      ]),
      el('h2', {}, [el('a', { href: `/demande?id=${demande.id}`, texte: demande.titre })]),
      el('p', { classe: 'publication-texte', texte: demande.description }),
      el('dl', { classe: 'faits' }, [
        el('div', {}, [el('dt', { texte: 'Budget' }), el('dd', { texte: fcfa(demande.budgetFcfa) })]),
        el('div', {}, [el('dt', { texte: 'Délai' }), el('dd', { texte: demande.delai || 'À discuter' })]),
      ]),
      el('p', { classe: 'texte-discret pied-demande', texte: `${demande.estMoi ? 'Ta demande' : `Par ${demande.client.nom}`} · ${propositions}` }),
      el('a', { classe: 'bouton bouton-contour', href: `/demande?id=${demande.id}`, texte: 'Voir la demande' }),
    ]);
  }

  async function chargerPage({ depuisLeDebut = false } = {}) {
    const liste = document.querySelector('[data-liste]');
    const etat = document.querySelector('[data-etat]');
    const boutonPlus = document.querySelector('[data-charger-plus]');
    if (depuisLeDebut) {
      suivant = null;
      liste.replaceChildren();
    }
    boutonPlus.hidden = true;
    etat.hidden = false;
    etat.textContent = 'Chargement…';

    const parametres = new URLSearchParams();
    if (suivant) parametres.set('avant', suivant);
    if (categorie) parametres.set('categorie', categorie);
    if (filtre === 'miennes') parametres.set('miennes', '1');
    const demandeEnCours = `${filtre}|${categorie}`;
    try {
      const reponse = await api(`/demandes?${parametres}`);
      if (demandeEnCours !== `${filtre}|${categorie}`) return; // le filtre a changé pendant le chargement
      liste.append(...reponse.demandes.map(carteDemande));
      suivant = reponse.suivant;
      boutonPlus.hidden = !suivant;
      if (liste.children.length === 0) {
        etat.textContent = filtre === 'miennes' ? 'Rien ici pour l\'instant.' : 'Aucune demande ouverte pour l\'instant.';
      } else {
        etat.hidden = true;
      }
    } catch (erreur) {
      etat.textContent = erreur.message;
      boutonPlus.hidden = !suivant;
    }
  }

  // ---------- Formulaire du client ----------
  function brancherFormulaire() {
    const bouton = document.querySelector('[data-ouvrir-formulaire]');
    const formulaire = document.querySelector('[data-publier]');
    const zoneMessage = formulaire.querySelector('[data-message]');
    document.querySelector('[data-zone-client]').hidden = false;

    bouton.addEventListener('click', () => {
      formulaire.hidden = !formulaire.hidden;
      bouton.setAttribute('aria-expanded', String(!formulaire.hidden));
      if (!formulaire.hidden) formulaire.elements.titre.focus();
    });

    formulaire.addEventListener('submit', async (evenement) => {
      evenement.preventDefault();
      formulaire.querySelectorAll('[data-erreur]').forEach((e) => { e.textContent = ''; });
      zoneMessage.textContent = '';
      zoneMessage.className = 'message';
      const envoyer = formulaire.querySelector('button[type="submit"]');
      envoyer.disabled = true;
      try {
        const { demande } = await api('/demandes', {
          methode: 'POST',
          donnees: {
            titre: formulaire.elements.titre.value,
            categorie: formulaire.elements.categorie.value,
            description: formulaire.elements.description.value,
            budgetFcfa: formulaire.elements.budgetFcfa.value.trim(),
            delai: formulaire.elements.delai.value,
          },
        });
        window.location.href = `/demande?id=${demande.id}`;
      } catch (erreur) {
        const zone = erreur.champ && formulaire.querySelector(`[data-erreur="${erreur.champ}"]`);
        if (zone) {
          zone.textContent = erreur.message;
          formulaire.elements[erreur.champ].focus();
        } else {
          zoneMessage.textContent = erreur.message;
          zoneMessage.className = 'message erreur';
        }
        envoyer.disabled = false;
      }
    });
  }

  function brancherFiltres() {
    const boutons = document.querySelectorAll('[data-filtre]');
    boutons.forEach((bouton) => {
      bouton.addEventListener('click', () => {
        if (filtre === bouton.dataset.filtre) return;
        filtre = bouton.dataset.filtre;
        boutons.forEach((b) => b.setAttribute('aria-pressed', String(b === bouton)));
        chargerPage({ depuisLeDebut: true });
      });
    });
    document.querySelector('[data-filtre-categorie]').addEventListener('change', (evenement) => {
      categorie = evenement.target.value;
      chargerPage({ depuisLeDebut: true });
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const moi = await utilisateurConnecte();
    if (!moi) {
      window.location.href = '/connexion?suite=/demandes';
      return;
    }
    const { categories } = await api('/categories');
    const options = () => categories.map((c) => el('option', { value: c.id, texte: c.nom }));
    document.querySelector('[data-filtre-categorie]').append(...options());
    document.querySelector('#categorie').append(...options());

    if (moi.type === 'client') brancherFormulaire();
    else document.querySelector('[data-onglet-miennes]').textContent = 'Mes propositions';
    brancherFiltres();
    document.querySelector('[data-charger-plus]').addEventListener('click', () => chargerPage());
    chargerPage({ depuisLeDebut: true });
  });
})();
