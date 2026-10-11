// Pages ouvertes depuis un email, avec un jeton à usage unique dans l'adresse :
//  - /pas-moi : le bouton « Ce n'était pas moi » de l'alerte de nouvelle connexion. Le serveur déconnecte tous les
//    appareils, verrouille le compte, puis donne l'adresse où choisir un nouveau mot de passe ;
//  - /annuler-suppression : le bouton « Annuler la suppression ». Le serveur réactive le compte.
// Ouvrir la page ne fait rien : c'est le bouton qui appelle le serveur (data-route dit quelle route).
(function () {
  const { api } = window.Palabre;
  // Où aller ensuite : seulement une adresse que cette page connaît, jamais une adresse quelconque venue d'ailleurs.
  const SUITES_PERMISES = [/^\/reinitialiser\?jeton=[0-9a-f]{64}$/, /^\/connexion$/];

  document.addEventListener('DOMContentLoaded', () => {
    const bouton = document.querySelector('[data-proteger]');
    const message = document.querySelector('[data-message]');
    const jeton = new URLSearchParams(window.location.search).get('jeton') || '';
    bouton.addEventListener('click', async () => {
      bouton.disabled = true;
      try {
        const reponse = await api(bouton.dataset.route || '/auth/pas-moi', { methode: 'POST', donnees: { jeton } });
        message.textContent = reponse.message;
        message.className = 'message succes';
        const suite = SUITES_PERMISES.some((motif) => motif.test(String(reponse.suite || ''))) ? reponse.suite : '/connexion';
        setTimeout(() => { window.location.href = suite; }, 2200);
      } catch (erreur) {
        message.textContent = erreur.message;
        message.className = 'message erreur';
        bouton.disabled = false;
      }
    });
  });
})();
