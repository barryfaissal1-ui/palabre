// Outils communs à toutes les pages : appels à l'API, session, navigation, installation PWA.
(function () {
  async function api(chemin, { methode = 'GET', donnees } = {}) {
    const options = { method: methode, headers: {}, credentials: 'same-origin' };
    if (donnees !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(donnees);
    }
    let reponse;
    try {
      reponse = await fetch(`/api${chemin}`, options);
    } catch {
      const erreur = new Error('Pas de connexion internet. Vérifie ton réseau et réessaie.');
      erreur.statut = 0;
      throw erreur;
    }
    const corps = await reponse.json().catch(() => ({}));
    if (!reponse.ok) {
      const erreur = new Error(corps.erreur || 'Une erreur est survenue. Réessaie.');
      erreur.statut = reponse.status;
      erreur.champ = corps.champ;
      throw erreur;
    }
    return corps;
  }

  // Le membre connecté est demandé une seule fois par page, puis gardé en mémoire.
  let promesseUtilisateur = null;
  function utilisateurConnecte() {
    if (!promesseUtilisateur) {
      promesseUtilisateur = api('/auth/moi').then((r) => r.utilisateur).catch(() => null);
    }
    return promesseUtilisateur;
  }

  // Crée un élément HTML sans jamais interpréter de texte comme du code :
  // le contenu écrit par les membres passe toujours par textContent (protection contre les injections).
  function el(balise, attributs = {}, enfants = []) {
    const noeud = document.createElement(balise);
    Object.entries(attributs).forEach(([cle, valeur]) => {
      if (valeur === null || valeur === undefined || valeur === false) return;
      if (cle === 'texte') noeud.textContent = valeur;
      else if (cle === 'classe') noeud.className = valeur;
      else noeud.setAttribute(cle, valeur === true ? '' : valeur);
    });
    [].concat(enfants).forEach((enfant) => {
      if (enfant !== null && enfant !== undefined) noeud.append(enfant);
    });
    return noeud;
  }

  function initiales(nom) {
    return nom.split(/\s+/).filter(Boolean).slice(0, 2).map((m) => m[0].toUpperCase()).join('');
  }

  // Photo de profil, ou initiales sur fond terre cuite quand il n'y a pas de photo.
  function avatar(personne, taille = 'moyen') {
    if (personne.avatar) {
      return el('img', { classe: `avatar avatar-${taille}`, src: personne.avatar, alt: '' });
    }
    return el('span', { classe: `avatar avatar-${taille} avatar-initiales`, 'aria-hidden': 'true', texte: initiales(personne.nom) });
  }

  // « il y a 5 min », « il y a 3 h », puis la date au-delà d'une semaine.
  function dateRelative(iso) {
    const date = new Date(iso);
    const secondes = Math.round((Date.now() - date.getTime()) / 1000);
    if (secondes < 60) return 'à l\'instant';
    if (secondes < 3600) return `il y a ${Math.floor(secondes / 60)} min`;
    if (secondes < 86400) return `il y a ${Math.floor(secondes / 3600)} h`;
    if (secondes < 7 * 86400) return `il y a ${Math.floor(secondes / 86400)} j`;
    return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // Réduit une image dans le navigateur avant l'envoi (côté le plus long : 1080 px, JPEG) :
  // une photo de plusieurs Mo devient une centaine de Ko, ce qui économise les données mobiles.
  async function reduireImage(fichier, coteMax = 1080) {
    let bitmap;
    try {
      bitmap = await createImageBitmap(fichier);
    } catch {
      throw new Error('Impossible de lire cette image. Choisis une photo JPEG ou PNG.');
    }
    const echelle = Math.min(1, coteMax / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * echelle));
    canvas.height = Math.max(1, Math.round(bitmap.height * echelle));
    const contexte = canvas.getContext('2d');
    contexte.fillStyle = '#fff'; // fond blanc pour les images transparentes (le JPEG n'a pas de transparence)
    contexte.fillRect(0, 0, canvas.width, canvas.height);
    contexte.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    // Le serveur accepte 500 Ko : on baisse la qualité tant que l'image est trop lourde.
    for (const qualite of [0.8, 0.6, 0.4]) {
      const dataUrl = canvas.toDataURL('image/jpeg', qualite);
      if (dataUrl.length < 600000) return dataUrl;
    }
    throw new Error('Image trop lourde. Choisis-en une autre.');
  }

  // Fenêtre « Signaler » : la même pour une publication, un commentaire ou un profil.
  const MOTIFS_SIGNALEMENT = [
    'Spam ou arnaque',
    'Insultes ou harcèlement',
    'Contenu choquant ou illégal',
    'Faux profil ou usurpation',
    'Autre raison',
  ];

  function signaler(cibleType, cible) {
    const motif = el('select', { id: 'signalement-motif' }, MOTIFS_SIGNALEMENT.map((m) => el('option', { value: m, texte: m })));
    const precision = el('textarea', { id: 'signalement-precision', rows: '3', maxlength: '400', placeholder: 'Explique en quelques mots (facultatif)' });
    const zoneMessage = el('p', { classe: 'message', role: 'status' });
    const annuler = el('button', { classe: 'bouton bouton-lien', type: 'button', texte: 'Annuler' });
    const envoyer = el('button', { classe: 'bouton bouton-principal', type: 'submit', texte: 'Envoyer' });
    const formulaire = el('form', {}, [
      el('h2', { id: 'signalement-titre', texte: 'Signaler' }),
      el('p', { classe: 'texte-discret', texte: 'L\'équipe Palabre vérifiera. La personne signalée ne saura pas que cela vient de toi.' }),
      el('div', { classe: 'champ' }, [el('label', { for: 'signalement-motif', texte: 'Quel est le problème ?' }), motif]),
      el('div', { classe: 'champ' }, [el('label', { for: 'signalement-precision', texte: 'Précision' }), precision]),
      zoneMessage,
      el('div', { classe: 'dialogue-actions' }, [annuler, envoyer]),
    ]);
    const dialogue = el('dialog', { classe: 'dialogue', 'aria-labelledby': 'signalement-titre' }, [formulaire]);

    annuler.addEventListener('click', () => dialogue.close());
    dialogue.addEventListener('close', () => dialogue.remove());
    formulaire.addEventListener('submit', async (evenement) => {
      evenement.preventDefault();
      envoyer.disabled = true;
      const detail = precision.value.trim();
      try {
        const reponse = await api('/signalements', {
          methode: 'POST',
          donnees: { cibleType, cible, motif: detail ? `${motif.value} : ${detail}` : motif.value },
        });
        zoneMessage.textContent = reponse.dejaSignale ? 'Tu avais déjà signalé ce contenu. Merci.' : 'Merci, ton signalement est envoyé.';
        zoneMessage.className = 'message succes';
        motif.disabled = true;
        precision.disabled = true;
        envoyer.hidden = true;
        annuler.textContent = 'Fermer';
      } catch (erreur) {
        zoneMessage.textContent = erreur.message;
        zoneMessage.className = 'message erreur';
        envoyer.disabled = false;
      }
    });

    document.body.append(dialogue);
    dialogue.showModal();
  }

  // Remplit la navigation de l'en-tête selon que la personne est connectée ou non.
  async function remplirNavigation() {
    const nav = document.querySelector('[data-nav]');
    if (!nav) return;
    const moi = await utilisateurConnecte();
    nav.replaceChildren();
    if (moi) {
      const demandes = moi.demandesAmis || 0;
      nav.append(
        el('a', { classe: 'bouton bouton-lien', href: '/fil', texte: 'Fil' }),
        el('a', { classe: 'bouton bouton-lien', href: '/amis' }, [
          'Amis',
          demandes ? el('span', { classe: 'compteur', texte: String(demandes), 'aria-label': `${demandes} demande${demandes > 1 ? 's' : ''} en attente` }) : null,
        ]),
        el('a', { classe: 'nav-profil', href: `/${moi.identifiant}`, 'aria-label': 'Mon profil' }, [avatar(moi, 'mini')]),
      );
    } else {
      nav.append(el('a', { classe: 'bouton bouton-lien', href: '/connexion', texte: 'Se connecter' }));
    }
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }

  document.addEventListener('DOMContentLoaded', remplirNavigation);

  window.Palabre = { api, utilisateurConnecte, el, avatar, initiales, dateRelative, reduireImage, signaler };
})();
