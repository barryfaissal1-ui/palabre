// Vitrine de la page d'accueil : les projets réalisés, filtrés par secteur. Visible sans compte.
(function () {
  const { api, el, carteProjet, chargement } = window.Palabre;

  let secteur = '';
  let suivant = null;

  async function charger({ depuisLeDebut = false } = {}) {
    const grille = document.querySelector('[data-vitrine]');
    const vide = document.querySelector('[data-vitrine-vide]');
    const boutonPlus = document.querySelector('[data-vitrine-plus]');
    if (depuisLeDebut) {
      suivant = null;
      grille.replaceChildren();
    }
    const parametres = new URLSearchParams();
    if (suivant) parametres.set('avant', suivant);
    if (secteur) parametres.set('secteur', secteur);
    const secteurDemande = secteur;
    vide.hidden = true;
    const fini = chargement(grille, depuisLeDebut ? 2 : 1);
    try {
      const reponse = await api(`/projets?${parametres}`);
      fini();
      if (secteurDemande !== secteur) return; // le secteur a changé pendant le chargement
      grille.append(...reponse.projets.map((p) => carteProjet(p)));
      suivant = reponse.suivant;
      boutonPlus.hidden = !suivant;
      vide.hidden = grille.children.length > 0;
      document.querySelector('[data-vitrine-texte]').textContent = secteur
        ? 'Pas encore de projet dans ce secteur. Le tien sera peut-être le premier.'
        : 'La vitrine attend ses premiers projets. Inscris-toi et publie ce que tu as déjà construit.';
    } catch {
      fini();
      vide.hidden = grille.children.length > 0; // hors connexion : on garde ce qui est déjà affiché
    }
  }

  function boutonSecteur(id, nom) {
    const bouton = el('button', { classe: 'onglet', type: 'button', 'aria-pressed': String(id === secteur), texte: nom });
    bouton.addEventListener('click', () => {
      if (secteur === id) return;
      secteur = id;
      document.querySelectorAll('[data-secteurs] .onglet').forEach((b) => b.setAttribute('aria-pressed', String(b === bouton)));
      charger({ depuisLeDebut: true });
    });
    return bouton;
  }

  document.addEventListener('DOMContentLoaded', async () => {
    document.querySelector('[data-vitrine-plus]').addEventListener('click', () => charger());
    charger({ depuisLeDebut: true });
    try {
      const { secteurs } = await api('/secteurs');
      document.querySelector('[data-secteurs]').append(
        boutonSecteur('', 'Tous'),
        ...secteurs.map((s) => boutonSecteur(s.id, s.nom)),
      );
    } catch { /* sans la liste des secteurs, la vitrine reste affichée sans filtre */ }
  });
})();
