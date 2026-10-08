// Gestion des formulaires d'authentification (inscription, connexion, mot de passe).
(function () {
  const { api } = window.Palabre;

  const actions = {
    async inscription(donnees) {
      await api('/auth/inscription', { methode: 'POST', donnees });
      window.location.href = '/fil';
    },
    async connexion(donnees) {
      await api('/auth/connexion', { methode: 'POST', donnees });
      const suite = new URLSearchParams(window.location.search).get('suite');
      window.location.href = suite && suite.startsWith('/') && !suite.startsWith('//') ? suite : '/fil';
    },
    async 'mot-de-passe-oublie'(donnees, formulaire) {
      const { message } = await api('/auth/mot-de-passe-oublie', { methode: 'POST', donnees });
      afficherMessage(formulaire, message, 'succes');
      formulaire.reset();
    },
    async reinitialiser(donnees, formulaire) {
      const jeton = new URLSearchParams(window.location.search).get('jeton') || '';
      const { message } = await api('/auth/reinitialiser', {
        methode: 'POST',
        donnees: { ...donnees, jeton },
      });
      afficherMessage(formulaire, `${message} Redirection…`, 'succes');
      setTimeout(() => { window.location.href = '/connexion'; }, 1800);
    },
  };

  function afficherMessage(formulaire, texte, type) {
    const zone = formulaire.querySelector('[data-message]');
    zone.textContent = texte;
    zone.className = `message ${type}`;
  }

  function effacerErreurs(formulaire) {
    formulaire.querySelectorAll('[data-erreur]').forEach((el) => { el.textContent = ''; });
    formulaire.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
    afficherMessage(formulaire, '', '');
  }

  function erreurSurChamp(formulaire, champ, texte) {
    const zone = formulaire.querySelector(`[data-erreur="${champ}"]`);
    const input = formulaire.elements[champ];
    if (!zone || !input || !input.focus) return false;
    zone.textContent = texte;
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    return true;
  }

  async function remplirPays(select) {
    try {
      const { pays } = await api('/pays');
      const actuel = select.value;
      select.innerHTML = '';
      pays.forEach((nom) => select.add(new Option(nom, nom, false, nom === actuel)));
    } catch {
      // On garde l'option par défaut si la liste ne charge pas.
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const typeDemande = new URLSearchParams(window.location.search).get('type');
    if (typeDemande === 'client' || typeDemande === 'dev') {
      const radio = document.getElementById(`type-${typeDemande}`);
      if (radio) radio.checked = true;
    }

    document.querySelectorAll('[data-liste-pays]').forEach(remplirPays);

    document.querySelectorAll('form[data-formulaire]').forEach((formulaire) => {
      formulaire.addEventListener('submit', async (evenement) => {
        evenement.preventDefault();
        effacerErreurs(formulaire);
        const bouton = formulaire.querySelector('button[type="submit"]');
        const donnees = Object.fromEntries(new FormData(formulaire));
        bouton.disabled = true;
        try {
          await actions[formulaire.dataset.formulaire](donnees, formulaire);
        } catch (erreur) {
          if (!(erreur.champ && erreurSurChamp(formulaire, erreur.champ, erreur.message))) {
            afficherMessage(formulaire, erreur.message, 'erreur');
          }
        } finally {
          bouton.disabled = false;
        }
      });
    });
  });
})();
