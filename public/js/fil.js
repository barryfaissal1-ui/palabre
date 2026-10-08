// Page du fil (provisoire) : accueille le membre connecté.
(function () {
  const { api, utilisateurConnecte } = window.Palabre;

  document.addEventListener('DOMContentLoaded', async () => {
    const utilisateur = await utilisateurConnecte();
    if (!utilisateur) {
      window.location.href = '/connexion?suite=/fil';
      return;
    }

    const prenom = utilisateur.nom.split(' ')[0];
    document.querySelector('[data-salutation]').textContent = `Bienvenue, ${prenom}`;
    document.querySelector('[data-lien-profil]').textContent =
      utilisateur.type === 'dev'
        ? `Ton lien de profil : palabre.dev/${utilisateur.identifiant}`
        : 'Tu pourras bientôt publier ta première demande.';

    document.querySelector('[data-deconnexion]').addEventListener('click', async () => {
      await api('/auth/deconnexion', { methode: 'POST', donnees: {} }).catch(() => {});
      window.location.href = '/';
    });
  });
})();
