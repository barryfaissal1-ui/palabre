// Outils communs à toutes les pages : appels à l'API, session, installation PWA.
(function () {
  async function api(chemin, { methode = 'GET', donnees } = {}) {
    const options = { method: methode, headers: {}, credentials: 'same-origin' };
    if (donnees !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(donnees);
    }
    let reponse;
    try {
      reponse = await fetch(`/api${chemin}`, options);
    } catch {
      const erreur = new Error('Pas de connexion internet. Vérifie ton réseau et réessaie.');
      erreur.statut = 0;
      throw erreur;
    }
    const corps = await reponse.json().catch(() => ({}));
    if (!reponse.ok) {
      const erreur = new Error(corps.erreur || 'Une erreur est survenue. Réessaie.');
      erreur.statut = reponse.status;
      erreur.champ = corps.champ;
      throw erreur;
    }
    return corps;
  }

  async function utilisateurConnecte() {
    try {
      const { utilisateur } = await api('/auth/moi');
      return utilisateur;
    } catch {
      return null;
    }
  }

  // Affiche la bonne navigation (visiteur ou membre) quand la page en propose deux.
  async function ajusterNavigation() {
    const visiteur = document.querySelector('[data-nav-visiteur]');
    const membre = document.querySelector('[data-nav-membre]');
    if (!visiteur || !membre) return;
    if (await utilisateurConnecte()) {
      visiteur.hidden = true;
      membre.hidden = false;
    }
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }

  document.addEventListener('DOMContentLoaded', ajusterNavigation);

  window.Palabre = { api, utilisateurConnecte };
})();
