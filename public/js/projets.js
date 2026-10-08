// Page « Mes projets » : ajouter un projet réalisé, revérifier son lien, le supprimer.
(function () {
  const { api, el, utilisateurConnecte, carteProjet, reduireImage, etatVide, confirmer } = window.Palabre;

  let moi = null;
  let imageChoisie = null; // capture d'écran réduite, prête à être envoyée (data URL)

  function message(zone, texte, type) {
    zone.textContent = texte;
    zone.className = `message ${type || ''}`;
  }

  function carteGestion(projet) {
    const zoneMessage = document.querySelector('[data-message-liste]');
    const carte = carteProjet(projet, { avecDev: false });
    const actions = el('div', { classe: 'profil-actions' });

    if (projet.lien) {
      const reverifier = el('button', { classe: 'bouton bouton-contour', type: 'button', texte: 'Revérifier le lien' });
      reverifier.addEventListener('click', async () => {
        reverifier.disabled = true;
        message(zoneMessage, 'Visite du lien en cours…', '');
        try {
          const reponse = await api(`/projets/${projet.id}/verifier`, { methode: 'POST', donnees: {} });
          await chargerListe();
          message(zoneMessage, reponse.projet.lienVerifie
            ? 'Le lien répond : badge « Lien vérifié » accordé.'
            : 'Le lien ne répond pas pour l\'instant. Vérifie l\'adresse et que le site est bien en ligne.', reponse.projet.lienVerifie ? 'succes' : 'erreur');
        } catch (erreur) {
          message(zoneMessage, erreur.message, 'erreur');
          reverifier.disabled = false;
        }
      });
      actions.append(reverifier);
    }
    const supprimer = el('button', { classe: 'bouton bouton-lien', type: 'button', texte: 'Supprimer' });
    supprimer.addEventListener('click', async () => {
      if (!(await confirmer(`Supprimer le projet « ${projet.titre} » ?`, { bouton: 'Supprimer', danger: true }))) return;
      try {
        await api(`/projets/${projet.id}`, { methode: 'DELETE', donnees: {} });
        await chargerListe();
        message(zoneMessage, 'Projet supprimé.', 'succes');
      } catch (erreur) {
        message(zoneMessage, erreur.message, 'erreur');
      }
    });
    actions.append(supprimer);
    carte.querySelector('.projet-corps').append(actions);
    return carte;
  }

  async function chargerListe() {
    const etat = document.querySelector('[data-etat]');
    const { profil } = await api(`/profils/${encodeURIComponent(moi.identifiant)}`);
    document.querySelector('[data-liste]').replaceChildren(...profil.projets.map(carteGestion));
    document.querySelector('[data-titre-liste]').textContent = profil.projets.length ? `Mes projets (${profil.projets.length})` : 'Mes projets';
    etat.hidden = profil.projets.length > 0;
    etat.replaceChildren(etatVide('projets', 'Ton premier projet t\'attend', 'Ajoute un projet avec le formulaire ci-dessus. Il apparaîtra sur ton profil et dans la vitrine.'));
  }

  function brancherFormulaire() {
    const formulaire = document.querySelector('[data-ajouter]');
    const zoneMessage = formulaire.querySelector('[data-message]');
    const apercu = formulaire.querySelector('[data-apercu]');
    const choisir = formulaire.querySelector('[data-choisir-image]');
    const envoyer = formulaire.querySelector('button[type="submit"]');

    function retirerImage() {
      imageChoisie = null;
      apercu.hidden = true;
      formulaire.querySelector('[data-apercu-image]').removeAttribute('src');
    }

    choisir.addEventListener('change', async () => {
      const fichier = choisir.files[0];
      choisir.value = '';
      if (!fichier) return;
      message(zoneMessage, 'Préparation de l\'image…', '');
      try {
        imageChoisie = await reduireImage(fichier);
        formulaire.querySelector('[data-apercu-image]').src = imageChoisie;
        apercu.hidden = false;
        message(zoneMessage, '', '');
      } catch (erreur) {
        retirerImage();
        message(zoneMessage, erreur.message, 'erreur');
      }
    });
    formulaire.querySelector('[data-retirer-image]').addEventListener('click', retirerImage);

    formulaire.addEventListener('submit', async (evenement) => {
      evenement.preventDefault();
      formulaire.querySelectorAll('[data-erreur]').forEach((e) => { e.textContent = ''; });
      const donnees = {
        titre: formulaire.elements.titre.value,
        secteur: formulaire.elements.secteur.value,
        description: formulaire.elements.description.value,
        lien: formulaire.elements.lien.value,
        publierFacebook: formulaire.elements.publierFacebook.checked,
      };
      if (imageChoisie) donnees.image = imageChoisie;
      envoyer.disabled = true;
      message(zoneMessage, donnees.lien.trim() ? 'Enregistrement et visite du lien… (quelques secondes)' : 'Enregistrement…', '');
      try {
        const { projet } = await api('/projets', { methode: 'POST', donnees });
        formulaire.reset();
        retirerImage();
        await chargerListe();
        if (!projet.lien) message(zoneMessage, 'Projet ajouté.', 'succes');
        else if (projet.lienVerifie) message(zoneMessage, 'Projet ajouté. Le lien répond : badge « Lien vérifié » accordé.', 'succes');
        else message(zoneMessage, 'Projet ajouté, mais le lien ne répond pas : pas de badge pour l\'instant. Tu pourras le revérifier plus bas.', 'erreur');
      } catch (erreur) {
        const zone = erreur.champ && formulaire.querySelector(`[data-erreur="${erreur.champ}"]`);
        if (zone) {
          zone.textContent = erreur.message;
          formulaire.elements[erreur.champ].focus();
          message(zoneMessage, '', '');
        } else {
          message(zoneMessage, erreur.message, 'erreur');
        }
      } finally {
        envoyer.disabled = false;
      }
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    moi = await utilisateurConnecte();
    if (!moi) {
      window.location.href = '/connexion?suite=/projets';
      return;
    }
    if (moi.type !== 'dev') {
      window.location.href = '/chercher'; // les projets sont réservés aux développeurs
      return;
    }
    const { secteurs } = await api('/secteurs');
    document.querySelector('#secteur').append(...secteurs.map((s) => el('option', { value: s.id, texte: s.nom })));
    brancherFormulaire();
    chargerListe().catch((erreur) => {
      const etat = document.querySelector('[data-etat]');
      etat.hidden = false;
      etat.replaceChildren(etatVide('calme', 'Tes projets ne chargent pas', erreur.message));
    });
  });
})();
