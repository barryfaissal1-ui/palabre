// Page /pas-moi : le bouton « Ce n'était pas moi » de l'email d'alerte de nouvelle connexion.
// Le jeton de l'adresse ne sert qu'une fois. Le serveur déconnecte tous les appareils, verrouille le compte, puis
// donne l'adresse où choisir un nouveau mot de passe.
(function () {
  const { api } = window.Palabre;

  document.addEventListener('DOMContentLoaded', () => {
    const bouton = document.querySelector('[data-proteger]');
    const message = document.querySelector('[data-message]');
    const jeton = new URLSearchParams(window.location.search).get('jeton') || '';
    bouton.addEventListener('click', async () => {
      bouton.disabled = true;
      try {
        const reponse = await api('/auth/pas-moi', { methode: 'POST', donnees: { jeton } });
        message.textContent = reponse.message;
        message.className = 'message succes';
        // La suite vient du serveur, mais on n'y va que si c'est bien la page du nouveau mot de passe.
        const suite = String(reponse.suite || '').startsWith('/reinitialiser?jeton=') ? reponse.suite : '/mot-de-passe-oublie';
        setTimeout(() => { window.location.href = suite; }, 1800);
      } catch (erreur) {
        message.textContent = erreur.message;
        message.className = 'message erreur';
        bouton.disabled = false;
      }
    });
  });
})();
