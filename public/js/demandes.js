// Page « Demandes » : liste par 10, filtres, et formulaire de publication pour les clients.
(function () {
  const { api, el, utilisateurConnecte, dateRelative, fcfa, icone, etatVide, chargement, chargementInfini } = window.Palabre;

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
        el('span', { classe: 'texte-discret', texte: ` ${demande.nomCategorie}, ${dateRelative(demande.creeLe)}` }),
      ]),
      el('h2', {}, [el('a', { href: `/demande?id=${demande.id}`, texte: demande.titre })]),
      el('p', { classe: 'publication-texte', texte: demande.description }),
      el('dl', { classe: 'faits' }, [
        el('div', {}, [el('dt', { classe: 'avec-icone' }, [icone('argent'), 'Budget']), el('dd', { texte: fcfa(demande.budgetFcfa) })]),
        el('div', {}, [el('dt', { classe: 'avec-icone' }, [icone('horloge'), 'Délai']), el('dd', { texte: demande.delai || 'À discuter' })]),
      ]),
      el('p', { classe: 'texte-discret pied-demande', texte: `${demande.estMoi ? 'Ta demande' : `Par ${demande.client.nom}`}, ${propositions.toLowerCase()}` }),
      el('a', { classe: 'bouton bouton-contour', href: `/demande?id=${demande.id}`, texte: 'Voir la demande' }),
    ]);
  }

  // Demande une page de demandes et l'ajoute à la liste. Répond true s'il en reste.
  async function pageSuivante(avantAjout = () => {}) {
    const parametres = new URLSearchParams();
    if (suivant) parametres.set('avant', suivant);
    if (categorie) parametres.set('categorie', categorie);
    if (filtre === 'miennes') parametres.set('miennes', '1');
    const demandeEnCours = `${filtre}|${categorie}`;
    const reponse = await api(`/demandes?${parametres}`);
    if (demandeEnCours !== `${filtre}|${categorie}`) return false; // le filtre a changé pendant le chargement
    avantAjout();
    document.querySelector('[data-liste]').append(...reponse.demandes.map(carteDemande));
    suivant = reponse.suivant;
    return Boolean(suivant);
  }

  // La liste depuis le début (ouverture, changement d'onglet ou de catégorie). Les pages suivantes arrivent toutes
  // seules en défilant : voir chargementInfini() dans app.js.
  let infini = null;
  async function chargerPage() {
    const liste = document.querySelector('[data-liste]');
    const etat = document.querySelector('[data-etat]');
    if (!infini) infini = chargementInfini(liste, () => pageSuivante(), { fin: 'Tu as vu toutes les demandes.', bouton: document.querySelector('[data-charger-plus]') });
    suivant = null;
    liste.replaceChildren();
    etat.hidden = true;
    infini.reprendre(false);
    const fini = chargement(liste, 3); // squelettes à la place du vide
    const demandeEnCours = `${filtre}|${categorie}`;
    try {
      const encore = await pageSuivante(fini);
      if (demandeEnCours !== `${filtre}|${categorie}`) return;
      infini.reprendre(encore);
      if (liste.children.length === 0) {
        etat.replaceChildren(filtre === 'miennes'
          ? etatVide('demandes', 'Rien ici pour l\'instant', 'Les demandes où tu es concerné apparaîtront dans cet onglet.')
          : etatVide('demandes', 'Aucune demande ouverte', 'Les demandes des clients arriveront ici. Reviens bientôt, ou change de catégorie.'));
        etat.hidden = false;
      }
    } catch (erreur) {
      fini();
      etat.replaceChildren(etatVide('calme', 'Les demandes ne chargent pas', erreur.message));
      etat.hidden = false;
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

  // Arrivée depuis le calculateur : /demandes?publier=1&categorie=site-web&budget=150000
  // ouvre le formulaire avec la catégorie et le budget déjà remplis.
  function reprendreCalculateur(moi, categories) {
    const parametres = new URLSearchParams(window.location.search);
    if (parametres.get('publier') !== '1') return;
    const zoneMessage = document.querySelector('[data-message-page]');
    if (moi.type !== 'client') {
      zoneMessage.textContent = 'Les demandes se publient avec un compte client. Ton compte est un compte développeur : tu peux répondre aux demandes ci-dessous.';
      zoneMessage.className = 'message';
      return;
    }
    const formulaire = document.querySelector('[data-publier]');
    formulaire.hidden = false;
    document.querySelector('[data-ouvrir-formulaire]').setAttribute('aria-expanded', 'true');

    // Ces valeurs viennent de l'adresse, donc de n'importe qui : on ne garde qu'une catégorie connue
    // et un nombre. Le serveur revérifie de toute façon à l'envoi.
    const categorie = parametres.get('categorie');
    if (categories.some((c) => c.id === categorie)) formulaire.elements.categorie.value = categorie;
    const budget = parametres.get('budget') || '';
    if (/^\d{1,10}$/.test(budget)) {
      formulaire.elements.budgetFcfa.value = budget.replace(/\B(?=(\d{3})+(?!\d))/g, ' '); // 150000 → 150 000
    }
    zoneMessage.textContent = 'Catégorie et budget repris du calculateur. Il te reste à donner un titre et à décrire ton projet.';
    zoneMessage.className = 'message succes';
    formulaire.elements.titre.focus();
  }

  function brancherFiltres() {
    const boutons = document.querySelectorAll('[data-filtre]');
    boutons.forEach((bouton) => {
      bouton.addEventListener('click', () => {
        if (filtre === bouton.dataset.filtre) return;
        filtre = bouton.dataset.filtre;
        boutons.forEach((b) => b.setAttribute('aria-pressed', String(b === bouton)));
        chargerPage();
      });
    });
    document.querySelector('[data-filtre-categorie]').addEventListener('change', (evenement) => {
      categorie = evenement.target.value;
      chargerPage();
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const moi = await utilisateurConnecte();
    if (!moi) {
      // On garde les paramètres de l'adresse (catégorie et budget venus du calculateur) pour l'après-connexion.
      window.location.href = `/connexion?suite=${encodeURIComponent(`/demandes${window.location.search}`)}`;
      return;
    }
    const { categories } = await api('/categories');
    const options = () => categories.map((c) => el('option', { value: c.id, texte: c.nom }));
    document.querySelector('[data-filtre-categorie]').append(...options());
    document.querySelector('#categorie').append(...options());

    if (moi.type === 'client') brancherFormulaire();
    else document.querySelector('[data-onglet-miennes]').textContent = 'Mes propositions';
    reprendreCalculateur(moi, categories);
    brancherFiltres();
    chargerPage();
  });
})();
