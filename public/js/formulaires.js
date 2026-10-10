// Gestion des formulaires d'authentification (inscription, connexion, mot de passe).
(function () {
  const { api } = window.Palabre;

  // Page où aller après l'inscription ou la connexion : le paramètre « suite » de l'adresse.
  // On n'accepte qu'une adresse interne (« /… ») : jamais un autre site, même si quelqu'un fabrique le lien.
  function suiteDemandee() {
    const suite = new URLSearchParams(window.location.search).get('suite');
    return suite && suite.startsWith('/') && !suite.startsWith('//') && !suite.includes('\\') ? suite : null;
  }

  // Sur la page d'accès, acces.js fait s'envoler le motif du fond (0,4 s) avant le changement de page.
  // Ailleurs, ou si l'animation échoue, on continue tout de suite : rien ne doit retarder la connexion.
  async function celebrer() {
    try {
      if (window.Palabre.celebrerAcces) await window.Palabre.celebrerAcces();
    } catch { /* l'animation est un plus */ }
  }

  // Heure d'ouverture de la page, signée par le serveur (protection contre les robots, voir src/utils/inscription.js).
  // Elle est demandée à l'API et non écrite dans la page : la page peut venir du cache du téléphone, pas elle.
  let jetonOuverture = null;
  async function demanderJeton() {
    try {
      jetonOuverture = (await api('/auth/jeton-inscription')).jeton;
    } catch { /* sans réseau : on redemandera au moment de l'envoi */ }
  }

  // Adresse d'une étape de l'inscription, en gardant la destination finale (« suite »).
  function etape(page) {
    const suite = suiteDemandee();
    return suite ? `${page}?suite=${encodeURIComponent(suite)}` : page;
  }

  const actions = {
    async inscription(donnees, formulaire) {
      if (!jetonOuverture) await demanderJeton();
      // Le numéro WhatsApp n'est demandé ici qu'aux clients (les devs le donnent à l'étape 2).
      if (formulaire.querySelector('[data-seulement-client]')?.hidden) delete donnees.whatsapp;
      await api('/auth/inscription', { methode: 'POST', donnees: { ...donnees, jeton: jetonOuverture } });
      await celebrer();
      // Étape suivante pour tout le monde : le code reçu par email.
      window.location.href = etape('/confirmer-email');
    },
    async connexion(donnees) {
      const { utilisateur } = await api('/auth/connexion', { methode: 'POST', donnees });
      await celebrer();
      // Une inscription laissée en route reprend là où elle s'était arrêtée.
      if (!utilisateur.emailConfirme) window.location.href = etape('/confirmer-email');
      else if (!utilisateur.profilComplet) window.location.href = etape('/bienvenue');
      else window.location.href = suiteDemandee() || '/fil';
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

    // « Déjà inscrit ? » / « Pas encore de compte ? » : la destination suit la personne d'une page à l'autre.
    const suite = suiteDemandee();
    if (suite) {
      document.querySelectorAll('.liens-formulaire a[href^="/connexion"], .liens-formulaire a[href^="/inscription"]').forEach((lien) => {
        const url = new URL(lien.href);
        url.searchParams.set('suite', suite);
        lien.href = url.pathname + url.search;
      });
    }

    document.querySelectorAll('[data-liste-pays]').forEach(remplirPays);
    if (document.querySelector('form[data-formulaire="inscription"]')) demanderJeton();

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
