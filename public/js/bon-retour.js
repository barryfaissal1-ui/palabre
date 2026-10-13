// Page /bon-retour : un membre s'est reconnecté à un compte désactivé, ou dont la suppression est prévue.
// Un seul bouton : réactiver (ce qui annule aussi la suppression). Sinon, il se déconnecte et rien ne change.
(function () {
  const { api, utilisateurConnecte, prenom, t, REGION } = window.Palabre;

  document.addEventListener('DOMContentLoaded', async () => {
    const moi = await utilisateurConnecte();
    if (!moi) return window.Palabre.versConnexion('/connexion');
    if (!moi.desactive) return window.location.replace('/fil');

    const bouton = document.querySelector('[data-reactiver]');
    const message = document.querySelector('[data-message]');
    document.querySelector('[data-titre]').textContent = t('bon-retour.titre-prenom', { prenom: prenom(moi) });
    if (moi.suppressionPrevueLe) {
      // La suppression a été demandée : on rappelle la date, et le bouton dit ce qu'il fait vraiment.
      const date = new Date(moi.suppressionPrevueLe).toLocaleDateString(REGION, { day: 'numeric', month: 'long', year: 'numeric' });
      document.querySelector('[data-texte]').textContent = t('bon-retour.suppression', { date });
      bouton.textContent = t('bon-retour.annuler-suppression');
    }

    bouton.addEventListener('click', async () => {
      bouton.disabled = true;
      try {
        const { profilComplet } = await api('/auth/reactiver', { methode: 'POST', donnees: {} });
        window.location.href = profilComplet ? '/fil' : '/bienvenue';
      } catch (erreur) {
        message.textContent = erreur.message;
        message.className = 'message erreur';
        bouton.disabled = false;
      }
    });
    document.querySelector('[data-plus-tard]').addEventListener('click', async () => {
      await api('/auth/deconnexion', { methode: 'POST', donnees: {} }).catch(() => {});
      window.location.href = '/';
    });
  });
})();
