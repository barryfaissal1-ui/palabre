// Page « Modifier mon profil » : informations, compétences, photo, déconnexion.
(function () {
  const { api, el, avatar, utilisateurConnecte } = window.Palabre;
  const MAX_COMPETENCES = 15;
  const TAILLE_PHOTO = 400; // pixels : largement suffisant pour une photo de profil

  let profil = null;
  let competencesChoisies = new Set();
  const LIENS_DEV = ['github', 'gitlab', 'portfolio', 'linkedin'];

  // ---------- Messages et erreurs ----------
  function message(zone, texte, type) {
    zone.textContent = texte;
    zone.className = `message ${type || ''}`;
  }

  function effacerErreurs(formulaire) {
    formulaire.querySelectorAll('[data-erreur]').forEach((e) => { e.textContent = ''; });
    formulaire.querySelectorAll('[aria-invalid]').forEach((e) => e.removeAttribute('aria-invalid'));
  }

  function erreurSurChamp(formulaire, champ, texte) {
    const zone = formulaire.querySelector(`[data-erreur="${champ}"]`);
    if (!zone) return false;
    zone.textContent = texte;
    const input = formulaire.elements[champ];
    if (input && input.focus) {
      input.setAttribute('aria-invalid', 'true');
      input.focus();
    }
    return true;
  }

  // ---------- Photo de profil ----------
  // L'image est réduite à 400 × 400 px et compressée en JPEG dans le navigateur :
  // une photo de 4 Mo devient environ 40 Ko, ce qui économise les données mobiles.
  async function compresserImage(fichier) {
    const bitmap = await createImageBitmap(fichier);
    const cote = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = TAILLE_PHOTO;
    canvas.height = TAILLE_PHOTO;
    canvas.getContext('2d').drawImage(
      bitmap,
      (bitmap.width - cote) / 2, (bitmap.height - cote) / 2, cote, cote, // recadrage carré au centre
      0, 0, TAILLE_PHOTO, TAILLE_PHOTO,
    );
    bitmap.close();
    return canvas.toDataURL('image/jpeg', 0.85);
  }

  function afficherPhoto() {
    const zone = document.querySelector('[data-photo]');
    zone.replaceChildren(avatar(profil, 'grand'));
    document.querySelector('[data-retirer-photo]').hidden = !profil.avatar;
  }

  function brancherPhoto() {
    const input = document.querySelector('[data-choisir-photo]');
    const zoneMessage = document.querySelector('[data-message-photo]');

    input.addEventListener('change', async () => {
      const fichier = input.files[0];
      input.value = '';
      if (!fichier) return;
      if (!fichier.type.startsWith('image/')) {
        message(zoneMessage, 'Choisis une image (photo JPEG ou PNG).', 'erreur');
        return;
      }
      message(zoneMessage, 'Envoi de la photo…', '');
      try {
        const image = await compresserImage(fichier);
        const { avatar: url } = await api('/profils/moi/avatar', { methode: 'POST', donnees: { image } });
        profil.avatar = url;
        afficherPhoto();
        message(zoneMessage, 'Photo mise à jour.', 'succes');
      } catch (erreur) {
        message(zoneMessage, erreur.message || 'Impossible de lire cette image.', 'erreur');
      }
    });

    document.querySelector('[data-retirer-photo]').addEventListener('click', async () => {
      try {
        await api('/profils/moi/avatar', { methode: 'DELETE', donnees: {} });
        profil.avatar = null;
        afficherPhoto();
        message(zoneMessage, 'Photo retirée.', 'succes');
      } catch (erreur) {
        message(zoneMessage, erreur.message, 'erreur');
      }
    });
  }

  // ---------- Compétences ----------
  function mettreAJourCompteur() {
    document.querySelector('[data-compteur-competences]').textContent = `${competencesChoisies.size} / ${MAX_COMPETENCES}`;
  }

  async function brancherCompetences() {
    const liste = document.querySelector('[data-liste-competences]');
    const filtre = document.querySelector('[data-filtre-competences]');
    const { competences } = await api('/competences');

    competences.forEach((c) => {
      const id = `competence-${c.id}`;
      const case_ = el('input', { type: 'checkbox', id, value: c.id, checked: competencesChoisies.has(c.id) });
      case_.addEventListener('change', () => {
        if (case_.checked && competencesChoisies.size >= MAX_COMPETENCES) {
          case_.checked = false;
          erreurSurChamp(document.querySelector('form'), 'competences', `${MAX_COMPETENCES} compétences au maximum.`);
          return;
        }
        if (case_.checked) competencesChoisies.add(c.id);
        else competencesChoisies.delete(c.id);
        mettreAJourCompteur();
      });
      liste.append(el('li', { 'data-nom': c.nom.toLowerCase() }, [case_, el('label', { for: id, texte: c.nom })]));
    });

    filtre.addEventListener('input', () => {
      const recherche = filtre.value.trim().toLowerCase();
      liste.querySelectorAll('li').forEach((li) => {
        li.hidden = recherche && !li.dataset.nom.includes(recherche);
      });
    });
    mettreAJourCompteur();
  }

  // ---------- Formulaire principal ----------
  function remplirFormulaire(formulaire) {
    formulaire.elements.prenom.value = profil.prenom || '';
    formulaire.elements.nomFamille.value = profil.nomFamille || '';
    formulaire.elements.identifiant.value = profil.identifiant;
    formulaire.elements.ville.value = profil.ville;
    formulaire.elements.whatsapp.value = profil.whatsapp || '';
    formulaire.elements.bio.value = profil.bio || '';
    formulaire.elements.disponible.checked = profil.disponible;
    // Profil de dev : spécialité, expérience et liens.
    formulaire.elements.specialite.value = profil.specialite || '';
    formulaire.elements.experience.value = profil.experience || '';
    LIENS_DEV.forEach((nom) => {
      const lien = (profil.liens || []).find((l) => l.type === nom);
      formulaire.elements[nom].value = lien ? lien.url : '';
    });
    document.querySelector('[data-compteur-bio]').textContent = `${(profil.bio || '').length} / 500`;
  }

  async function remplirPays(select) {
    const { pays } = await api('/pays');
    select.replaceChildren(...pays.map((nom) => new Option(nom, nom, false, nom === profil.pays)));
  }

  function brancherFormulaire(formulaire) {
    const zoneMessage = formulaire.querySelector('[data-message]');
    const bio = formulaire.elements.bio;
    bio.addEventListener('input', () => {
      document.querySelector('[data-compteur-bio]').textContent = `${bio.value.length} / 500`;
    });
    const identifiant = formulaire.elements.identifiant;
    identifiant.addEventListener('input', () => {
      identifiant.value = identifiant.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
    });

    formulaire.addEventListener('submit', async (evenement) => {
      evenement.preventDefault();
      effacerErreurs(formulaire);
      message(zoneMessage, '', '');
      const bouton = formulaire.querySelector('button[type="submit"]');
      bouton.disabled = true;
      try {
        const donnees = {
          prenom: formulaire.elements.prenom.value,
          nomFamille: formulaire.elements.nomFamille.value,
          identifiant: formulaire.elements.identifiant.value,
          pays: formulaire.elements.pays.value,
          ville: formulaire.elements.ville.value,
          whatsapp: formulaire.elements.whatsapp.value,
          bio: formulaire.elements.bio.value,
          disponible: formulaire.elements.disponible.checked,
          competences: [...competencesChoisies],
        };
        if (profil.type === 'dev') {
          // Une liste laissée sur « Choisir » n'est pas envoyée : le serveur garde alors ce qu'il a.
          if (formulaire.elements.specialite.value) donnees.specialite = formulaire.elements.specialite.value;
          if (formulaire.elements.experience.value) donnees.experience = formulaire.elements.experience.value;
          donnees.liens = Object.fromEntries(LIENS_DEV.map((nom) => [nom, formulaire.elements[nom].value]));
        }
        const resultat = await api('/profils/moi', { methode: 'PUT', donnees });
        profil = resultat.profil;
        message(zoneMessage, 'Profil enregistré.', 'succes');
        const lien = el('a', { href: `/${profil.identifiant}`, texte: ' Voir mon profil' });
        zoneMessage.append(lien);
      } catch (erreur) {
        if (!(erreur.champ && erreurSurChamp(formulaire, erreur.champ, erreur.message))) {
          message(zoneMessage, erreur.message, 'erreur');
        }
      } finally {
        bouton.disabled = false;
      }
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const moi = await utilisateurConnecte();
    if (!moi) {
      window.location.href = '/connexion?suite=/modifier-profil';
      return;
    }
    const resultat = await api(`/profils/${moi.identifiant}`);
    profil = resultat.profil;
    competencesChoisies = new Set(profil.competences.map((c) => c.id));

    const formulaire = document.querySelector('form[data-profil]');
    document.querySelectorAll('[data-seulement-dev]').forEach((e) => { e.hidden = profil.type !== 'dev'; });
    document.querySelector('[data-prefixe]').textContent = `${window.location.host}/`;

    afficherPhoto();
    brancherPhoto();
    remplirFormulaire(formulaire);
    await remplirPays(formulaire.elements.pays);
    if (profil.type === 'dev') await brancherCompetences();
    brancherFormulaire(formulaire);
    document.querySelector('[data-chargement]').hidden = true;
    formulaire.hidden = false;

    document.querySelector('[data-deconnexion]').addEventListener('click', async () => {
      // Se déconnecter coupe aussi le push sur cet appareil : la personne suivante ne recevra pas mes notifications.
      if (window.Palabre.push) await window.Palabre.push.couper().catch(() => {});
      await api('/auth/deconnexion', { methode: 'POST', donnees: {} }).catch(() => {});
      window.location.href = '/';
    });
  });
})();
