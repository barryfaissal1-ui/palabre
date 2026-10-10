// Page /confirmer-email : saisir le code à 6 chiffres reçu par email, ou en demander un nouveau.
(function () {
  const { api, utilisateurConnecte } = window.Palabre;
  const ATTENTE_RENVOI_S = 60; // le serveur refuse plus d'un code par minute

  // Page où aller ensuite : le paramètre « suite », seulement s'il s'agit d'une adresse interne.
  function suiteDemandee() {
    const suite = new URLSearchParams(window.location.search).get('suite');
    return suite && suite.startsWith('/') && !suite.startsWith('//') && !suite.includes('\\') ? suite : null;
  }

  // Email confirmé : un dev continue vers « Ton profil de dev » (étape 2), les autres entrent sur le site.
  function continuer(profilComplet) {
    const suite = suiteDemandee();
    if (!profilComplet) window.location.replace(`/bienvenue${suite ? `?suite=${encodeURIComponent(suite)}` : ''}`);
    else window.location.replace(suite || '/fil');
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const formulaire = document.querySelector('[data-code]');
    const champ = formulaire.elements.code;
    const zoneErreur = formulaire.querySelector('[data-erreur="code"]');
    const zoneMessage = formulaire.querySelector('[data-message]');
    const boutonRenvoyer = document.querySelector('[data-renvoyer]');

    const moi = await utilisateurConnecte();
    if (!moi) return window.location.replace('/connexion');
    if (moi.emailConfirme) return continuer(moi.profilComplet);
    document.querySelector('[data-email]').textContent = moi.email;
    champ.focus();

    function message(texte, type = '') {
      zoneMessage.textContent = texte;
      zoneMessage.className = `message ${type}`;
    }

    // Seuls les chiffres comptent : on retire le reste pendant la saisie (un code collé avec des espaces passe aussi).
    champ.addEventListener('input', () => {
      champ.value = champ.value.replace(/\D/g, '').slice(0, 6);
      zoneErreur.textContent = '';
      champ.removeAttribute('aria-invalid');
    });
    champ.addEventListener('paste', (evenement) => {
      evenement.preventDefault();
      champ.value = (evenement.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
    });

    formulaire.addEventListener('submit', async (evenement) => {
      evenement.preventDefault();
      const bouton = formulaire.querySelector('button[type="submit"]');
      message('');
      bouton.disabled = true;
      try {
        const { profilComplet } = await api('/auth/confirmer-email', { methode: 'POST', donnees: { code: champ.value } });
        continuer(profilComplet);
      } catch (erreur) {
        zoneErreur.textContent = erreur.message;
        champ.setAttribute('aria-invalid', 'true');
        champ.select();
        bouton.disabled = false;
      }
    });

    // « Renvoyer le code » : le bouton se bloque une minute, avec un compte à rebours.
    function patienter(secondes) {
      boutonRenvoyer.disabled = true;
      let reste = secondes;
      const afficher = () => { boutonRenvoyer.textContent = `Renvoyer le code (${reste} s)`; };
      afficher();
      const minuteur = setInterval(() => {
        reste -= 1;
        if (reste > 0) return afficher();
        clearInterval(minuteur);
        boutonRenvoyer.disabled = false;
        boutonRenvoyer.textContent = 'Renvoyer le code';
      }, 1000);
    }
    boutonRenvoyer.addEventListener('click', async () => {
      boutonRenvoyer.disabled = true;
      try {
        const reponse = await api('/auth/renvoyer-code', { methode: 'POST', donnees: {} });
        message(reponse.message, 'succes');
        zoneErreur.textContent = '';
        champ.value = '';
        champ.focus();
        patienter(ATTENTE_RENVOI_S);
      } catch (erreur) {
        message(erreur.message, 'erreur');
        boutonRenvoyer.disabled = false;
      }
    });

    document.querySelector('[data-deconnexion]').addEventListener('click', async () => {
      await api('/auth/deconnexion', { methode: 'POST', donnees: {} }).catch(() => {});
      window.location.href = '/inscription';
    });
  });
})();
