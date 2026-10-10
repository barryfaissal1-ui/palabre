// Page /bienvenue : « Ton profil de dev », l'étape 2 de l'inscription d'un développeur.
(function () {
  const { api, utilisateurConnecte } = window.Palabre;
  const LIENS = ['github', 'gitlab', 'portfolio', 'linkedin'];

  function suiteDemandee() {
    const suite = new URLSearchParams(window.location.search).get('suite');
    return suite && suite.startsWith('/') && !suite.startsWith('//') && !suite.includes('\\') ? suite : null;
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const formulaire = document.querySelector('[data-profil-dev]');
    const champs = formulaire.elements;
    const zoneMessage = formulaire.querySelector('[data-message]');
    const bouton = formulaire.querySelector('button[type="submit"]');

    const moi = await utilisateurConnecte();
    if (!moi) return window.location.replace('/connexion?suite=/bienvenue');
    if (!moi.emailConfirme) return window.location.replace('/confirmer-email');
    // Un client n'a pas d'étape 2 ; un dev qui l'a déjà faite modifie son profil sur la page habituelle.
    if (moi.type !== 'dev') return window.location.replace('/fil');
    if (moi.profilComplet) return window.location.replace('/modifier-profil');

    const suite = suiteDemandee();
    if (suite) document.querySelector('[data-plus-tard]').href = suite;

    // Un compte créé avant cette page a peut-être déjà un numéro et une présentation : on les reprend.
    champs.whatsapp.value = moi.whatsapp || '';
    champs.bio.value = moi.bio || '';
    // La date la plus récente acceptée : il y a 18 ans, jour pour jour (le serveur revérifie de toute façon).
    const limite = new Date();
    limite.setFullYear(limite.getFullYear() - 18);
    champs.dateNaissance.max = limite.toISOString().slice(0, 10);

    const compteur = formulaire.querySelector('[data-compteur-bio]');
    function compter() {
      compteur.textContent = `${champs.bio.value.trim().length} / 300 (20 au moins)`;
    }
    champs.bio.addEventListener('input', compter);
    compter();

    // « Je n'ai pas encore de lien » : les quatre champs sont grisés, pour que le choix soit clair.
    function reglerLiens() {
      LIENS.forEach((nom) => { champs[nom].disabled = champs.sansLien.checked; });
    }
    champs.sansLien.addEventListener('change', reglerLiens);
    // Écrire un lien décoche la case.
    LIENS.forEach((nom) => champs[nom].addEventListener('input', () => {
      if (champs[nom].value.trim()) champs.sansLien.checked = false;
    }));

    function effacerErreurs() {
      formulaire.querySelectorAll('[data-erreur]').forEach((zone) => { zone.textContent = ''; });
      formulaire.querySelectorAll('[aria-invalid]').forEach((champ) => champ.removeAttribute('aria-invalid'));
      zoneMessage.textContent = '';
      zoneMessage.className = 'message';
    }

    // Affiche l'erreur sous le champ concerné (le serveur donne son nom) ; sinon dans le message général.
    function montrerErreur(erreur) {
      const zone = erreur.champ && formulaire.querySelector(`[data-erreur="${erreur.champ}"]`);
      if (!zone) {
        zoneMessage.textContent = erreur.message;
        zoneMessage.className = 'message erreur';
        return;
      }
      zone.textContent = erreur.message;
      const champ = champs[erreur.champ === 'liens' ? 'github' : erreur.champ];
      if (champ && champ.focus) {
        if (erreur.champ !== 'liens') champ.setAttribute('aria-invalid', 'true');
        champ.focus();
      }
      zone.scrollIntoView({ block: 'center' });
    }

    formulaire.addEventListener('submit', async (evenement) => {
      evenement.preventDefault();
      effacerErreurs();
      const sansLien = champs.sansLien.checked;
      const donnees = {
        dateNaissance: champs.dateNaissance.value,
        specialite: champs.specialite.value,
        experience: champs.experience.value,
        liens: Object.fromEntries(LIENS.map((nom) => [nom, sansLien ? '' : champs[nom].value])),
        sansLien,
        whatsapp: champs.whatsapp.value,
        bio: champs.bio.value,
      };
      bouton.disabled = true;
      // Le serveur visite les liens : cela peut prendre quelques secondes, on le dit.
      const texteBouton = bouton.textContent;
      if (!sansLien) bouton.textContent = 'Vérification des liens…';
      try {
        const { profil } = await api('/profils/moi/profil-dev', { methode: 'PUT', donnees });
        window.location.href = suite || `/${profil.identifiant}`;
      } catch (erreur) {
        montrerErreur(erreur);
        bouton.disabled = false;
        bouton.textContent = texteBouton;
      }
    });
  });
})();
