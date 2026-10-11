// Page « Paramètres et confidentialité » (/parametres).
// Une liste de rubriques ; chaque réglage s'enregistre tout seul au changement, avec un toast « Enregistré ».
// La rubrique ouverte est dans l'adresse (/parametres#confidentialite) : le bouton « retour » du téléphone marche.
(function () {
  const { api, utilisateurConnecte, el, icone, avatar, nomMembre, toast, confirmer, listeChoix, etatVide, chargement, dateRelative } = window.Palabre;

  const RUBRIQUES = [
    { cle: 'compte', icone: 'utilisateur', titre: 'Compte', texte: 'Nom, lien du profil, email, mot de passe' },
    { cle: 'confidentialite', icone: 'cadenas', titre: 'Confidentialité', texte: 'Qui voit quoi, qui peut te contacter' },
    { cle: 'notifications', icone: 'cloche', titre: 'Notifications', texte: 'Sons et notifications sur tes appareils' },
    { cle: 'securite', icone: 'bouclier', titre: 'Sécurité', texte: 'Dernière connexion, autres appareils' },
    { cle: 'bloques', icone: 'bloquer', titre: 'Membres bloqués', texte: 'Voir la liste, débloquer' },
    { cle: 'apparence', icone: 'soleil', titre: 'Apparence', texte: 'Clair, sombre ou automatique' },
    { cle: 'donnees', icone: 'telecharger', titre: 'Mes données', texte: 'Télécharger tout ce que tu as écrit' },
  ];

  // Les réglages de confidentialité : la clé et les valeurs sont celles de src/utils/confidentialite.js.
  // C'est le serveur qui applique chaque réglage ; cette page ne fait que l'enregistrer.
  const CONFIDENTIALITE = [
    { cle: 'publications', titre: 'Qui peut voir mes publications', choix: [['tous', 'Tout le monde, même sans compte'], ['membres', 'Les membres de Palabre'], ['amis', 'Mes amis']] },
    { cle: 'listeAmis', titre: 'Qui peut voir ma liste d\'amis', choix: [['membres', 'Les membres de Palabre'], ['amis', 'Mes amis'], ['moi', 'Moi seulement']] },
    { cle: 'whatsapp', titre: 'Qui peut voir mon numéro WhatsApp', choix: [['membres', 'Les membres connectés'], ['amis', 'Mes amis'], ['personne', 'Personne']] },
    { cle: 'messages', titre: 'Qui peut m\'envoyer un message', aide: 'Tout le monde : un inconnu t\'envoie d\'abord une demande de message, que tu acceptes ou non.', choix: [['tous', 'Tout le monde'], ['proches', 'Mes amis et mes clients seulement']] },
    { cle: 'appels', titre: 'Qui peut m\'appeler', aide: 'Un appel n\'est possible que dans une conversation que tu as acceptée.', choix: [['proches', 'Mes amis et mes clients'], ['amis', 'Mes amis seulement'], ['personne', 'Personne']] },
    { cle: 'equipes', titre: 'Qui peut m\'inviter dans une équipe éclair', choix: [['amis', 'Mes amis'], ['personne', 'Personne']] },
    { cle: 'recherche', titre: 'Apparaître dans la recherche de devs et « Devs à découvrir »', aide: 'Si tu dis non, les clients à qui tu as envoyé une proposition te retrouvent quand même.', interrupteur: true, seulementDev: true },
    { cle: 'presence', titre: 'Afficher quand je suis en ligne', aide: 'Dans la messagerie, tes contacts voient un point vert quand tu es là. Si tu le caches, tu ne vois plus le leur non plus.', interrupteur: true },
  ];

  const page = () => document.querySelector('.page-parametres');
  const rubrique = (cle) => document.querySelector(`[data-rubrique="${cle}"]`);
  const erreurDe = (zone, champ) => zone.querySelector(`[data-erreur="${champ}"]`);
  const effacerErreurs = (zone) => zone.querySelectorAll('[data-erreur]').forEach((p) => { p.textContent = ''; });
  // Une erreur du serveur : sous le champ concerné s'il y en a un, sinon en toast.
  function montrerErreur(zone, erreur) {
    const sous = erreur.champ && erreurDe(zone, erreur.champ);
    if (sous) sous.textContent = erreur.message;
    else toast(erreur.message, 'erreur');
  }

  // ---------- La liste des rubriques et la rubrique ouverte ----------
  function dessinerListe() {
    document.querySelector('[data-rubriques]').replaceChildren(...RUBRIQUES.map((r) => el('li', {}, [
      el('a', { classe: 'lien-rubrique', href: `#${r.cle}`, 'data-lien-rubrique': r.cle }, [
        el('span', { classe: 'rubrique-icone' }, [icone(r.icone)]),
        el('span', { classe: 'rubrique-texte' }, [el('strong', { texte: r.titre }), el('span', { texte: r.texte })]),
        icone('fleche-droite', 'rubrique-fleche'),
      ]),
    ])));
  }

  const ordinateur = window.matchMedia('(min-width: 768px)');
  function ouvrirRubrique() {
    const demandee = window.location.hash.slice(1);
    const connue = RUBRIQUES.some((r) => r.cle === demandee);
    // Sur ordinateur, une rubrique est toujours ouverte ; sur téléphone, sans rubrique dans l'adresse, on voit la liste.
    const cle = connue ? demandee : (ordinateur.matches ? RUBRIQUES[0].cle : null);
    page().classList.toggle('rubrique-ouverte', connue);
    RUBRIQUES.forEach((r) => { rubrique(r.cle).hidden = r.cle !== cle; });
    document.querySelectorAll('[data-lien-rubrique]').forEach((lien) => {
      if (lien.dataset.lienRubrique === cle) lien.setAttribute('aria-current', 'page');
      else lien.removeAttribute('aria-current');
    });
    if (connue) window.scrollTo(0, 0);
    if (cle === 'bloques') chargerBloques();
  }

  // ---------- Petits composants ----------
  // Un réglage à choix : une liste (listeChoix) qui enregistre au changement et revient en arrière si le serveur refuse.
  function reglageListe({ titre, aide, choix }, valeur, enregistrer) {
    const id = `reglage-${titre.length}-${Math.random().toString(36).slice(2, 7)}`;
    const select = el('select', { id }, choix.map(([v, texte]) => el('option', { value: v, texte })));
    select.value = valeur;
    let actuelle = valeur;
    select.addEventListener('change', async () => {
      if (select.value === actuelle) return; // retour en arrière après un refus : rien à enregistrer
      try {
        await enregistrer(select.value);
        actuelle = select.value;
        toast('Enregistré');
      } catch (erreur) {
        select.value = actuelle;
        select.dispatchEvent(new Event('change')); // la liste habillée se redessine
        toast(erreur.message, 'erreur');
      }
    });
    return el('div', { classe: 'champ' }, [el('label', { for: id, texte: titre }), select, aide ? el('span', { classe: 'aide', texte: aide }) : null]);
  }

  function reglageInterrupteur({ titre, aide }, coche, enregistrer) {
    const caseACocher = el('input', { type: 'checkbox' });
    caseACocher.checked = coche;
    caseACocher.addEventListener('change', async () => {
      try {
        await enregistrer(caseACocher.checked);
        toast('Enregistré');
      } catch (erreur) {
        caseACocher.checked = !caseACocher.checked;
        toast(erreur.message, 'erreur');
      }
    });
    return el('div', { classe: 'champ' }, [
      el('label', { classe: 'interrupteur' }, [caseACocher, el('span', { classe: 'interrupteur-piste', 'aria-hidden': 'true' }), el('span', { texte: titre })]),
      aide ? el('span', { classe: 'aide', texte: aide }) : null,
    ]);
  }

  // ---------- Compte ----------
  function brancherCompte(compte) {
    const zone = rubrique('compte');
    zone.querySelector('[data-prefixe]').textContent = `${window.location.host}/`;
    // Prénom, nom, identifiant : enregistrés quand on quitte le champ (événement « change »).
    ['prenom', 'nomFamille', 'identifiant'].forEach((nom) => {
      const champ = zone.querySelector(`[name="${nom}"]`);
      champ.value = compte[nom] || '';
      let enregistree = champ.value;
      champ.addEventListener('change', async () => {
        erreurDe(zone, nom).textContent = '';
        if (champ.value.trim() === enregistree) return;
        try {
          const { compte: neuf } = await api('/parametres/compte', { methode: 'PUT', donnees: { [nom]: champ.value } });
          champ.value = neuf[nom];
          enregistree = neuf[nom];
          toast('Enregistré');
        } catch (erreur) {
          montrerErreur(zone, erreur);
        }
      });
    });

    // Email : le code part à la nouvelle adresse ; l'adresse ne change qu'une fois le code saisi.
    const formEmail = zone.querySelector('[data-formulaire-email]');
    const zoneCode = formEmail.querySelector('[data-zone-code]');
    const montrerAttente = (email) => {
      formEmail.querySelector('[data-email-attente]').textContent = email;
      zoneCode.hidden = !email;
    };
    formEmail.querySelector('[data-email-actuel]').textContent = compte.email;
    montrerAttente(compte.emailEnAttente);
    formEmail.addEventListener('submit', async (evenement) => {
      evenement.preventDefault();
      effacerErreurs(formEmail);
      try {
        const reponse = await api('/parametres/email', { methode: 'POST', donnees: { email: formEmail.email.value, motDePasse: formEmail.motDePasse.value } });
        formEmail.motDePasse.value = '';
        montrerAttente(reponse.emailEnAttente);
        toast(reponse.message);
        formEmail.code.focus();
      } catch (erreur) {
        montrerErreur(formEmail, erreur);
      }
    });
    formEmail.querySelector('[data-confirmer-email]').addEventListener('click', async () => {
      effacerErreurs(formEmail);
      try {
        const { email } = await api('/parametres/email/confirmer', { methode: 'POST', donnees: { code: formEmail.code.value } });
        formEmail.querySelector('[data-email-actuel]').textContent = email;
        formEmail.reset();
        montrerAttente(null);
        toast('Ton adresse email est changée.');
      } catch (erreur) {
        montrerErreur(formEmail, erreur);
      }
    });

    const formMotDePasse = zone.querySelector('[data-formulaire-mot-de-passe]');
    formMotDePasse.addEventListener('submit', async (evenement) => {
      evenement.preventDefault();
      effacerErreurs(formMotDePasse);
      try {
        const { message } = await api('/parametres/mot-de-passe', { methode: 'PUT', donnees: { ancien: formMotDePasse.ancien.value, nouveau: formMotDePasse.nouveau.value } });
        formMotDePasse.reset();
        toast(message);
      } catch (erreur) {
        montrerErreur(formMotDePasse, erreur);
      }
    });

    const formSuppression = zone.querySelector('[data-formulaire-suppression]');
    formSuppression.addEventListener('submit', async (evenement) => {
      evenement.preventDefault();
      effacerErreurs(formSuppression);
      if (!formSuppression.motDePasse.value) {
        erreurDe(formSuppression, 'motDePasse').textContent = 'Écris ton mot de passe pour confirmer.';
        return;
      }
      if (!await confirmer('Supprimer ton compte ? Ton profil et tout ce que tu as publié seront effacés pour de bon. C\'est définitif.', { bouton: 'Supprimer mon compte', danger: true })) return;
      try {
        if (window.Palabre.push) await window.Palabre.push.couper().catch(() => {});
        await api('/parametres/compte', { methode: 'DELETE', donnees: { motDePasse: formSuppression.motDePasse.value } });
        window.location.href = '/';
      } catch (erreur) {
        montrerErreur(formSuppression, erreur);
      }
    });
  }

  // ---------- Confidentialité ----------
  function brancherConfidentialite(reglages, moi) {
    const enregistrer = (cle) => (valeur) => api('/parametres/confidentialite', { methode: 'PUT', donnees: { cle, valeur } });
    const zone = rubrique('confidentialite').querySelector('[data-reglages-confidentialite]');
    zone.replaceChildren(
      ...CONFIDENTIALITE.filter((r) => !r.seulementDev || moi.type === 'dev').map((r) => (r.interrupteur
        ? reglageInterrupteur(r, reglages[r.cle], enregistrer(r.cle))
        : reglageListe(r, reglages[r.cle], enregistrer(r.cle)))),
    );
    // Les listes sont habillées une fois posées dans la page (listeChoix a besoin de leur libellé).
    zone.querySelectorAll('select').forEach(listeChoix);
  }

  // ---------- Notifications (les réglages du push sont dessinés par push.js dans [data-reglages-push]) ----------
  function brancherNotifications(moi) {
    const caseSon = rubrique('notifications').querySelector('[name="son-messages"]');
    caseSon.checked = moi.sonMessages !== false;
    caseSon.addEventListener('change', async () => {
      try {
        await api('/profils/moi/son-messages', { methode: 'PUT', donnees: { actif: caseSon.checked } });
        moi.sonMessages = caseSon.checked; // le son suit tout de suite, sans recharger la page
        toast('Enregistré');
      } catch (erreur) {
        caseSon.checked = !caseSon.checked;
        toast(erreur.message, 'erreur');
      }
    });
  }

  // ---------- Sécurité ----------
  function brancherSecurite(securite) {
    const zone = rubrique('securite');
    const derniere = securite.derniereConnexion;
    zone.querySelector('[data-derniere-connexion]').textContent = derniere
      ? `${derniere.appareil}, ${dateRelative(derniere.le)}`
      : 'Aucune connexion enregistrée depuis que cette rubrique existe.';
    zone.querySelector('[data-deconnecter-autres]').addEventListener('click', async () => {
      if (!await confirmer('Déconnecter tes autres appareils ? Il faudra s\'y reconnecter avec ton mot de passe.', { bouton: 'Déconnecter' })) return;
      try {
        toast((await api('/parametres/deconnecter-autres', { methode: 'POST', donnees: {} })).message);
      } catch (erreur) {
        toast(erreur.message, 'erreur');
      }
    });
  }

  // ---------- Membres bloqués ----------
  async function chargerBloques() {
    const zone = document.querySelector('[data-bloques]');
    const fini = chargement(zone, 2);
    try {
      const { bloques } = await api('/parametres/bloques');
      fini();
      if (bloques.length === 0) {
        zone.replaceChildren(etatVide('calme', 'Personne n\'est bloqué', 'Pour bloquer quelqu\'un, ouvre votre conversation puis le menu « … ».'));
        return;
      }
      zone.replaceChildren(el('ul', { classe: 'liste-bloques' }, bloques.map((membre) => {
        const bouton = el('button', { classe: 'bouton bouton-contour bouton-compact', type: 'button', texte: 'Débloquer' });
        const ligne = el('li', { classe: 'ligne-bloque' }, [avatar(membre, 'moyen'), el('div', { classe: 'ligne-bloque-nom' }, [nomMembre(membre)]), bouton]);
        bouton.addEventListener('click', async () => {
          bouton.disabled = true;
          try {
            await api(`/messages/blocages/${encodeURIComponent(membre.identifiant)}`, { methode: 'DELETE', donnees: {} });
            toast(`${membre.prenom} est débloqué.`);
            chargerBloques();
          } catch (erreur) {
            bouton.disabled = false;
            toast(erreur.message, 'erreur');
          }
        });
        return ligne;
      })));
    } catch (erreur) {
      fini();
      toast(erreur.message, 'erreur');
    }
  }

  // ---------- Apparence : le même réglage que le bouton soleil / lune (public/js/theme.js) ----------
  function brancherApparence() {
    const select = rubrique('apparence').querySelector('[name="theme"]');
    select.value = window.PalabreTheme.choix();
    select.dispatchEvent(new Event('change')); // la liste habillée affiche le choix actuel
    select.addEventListener('change', () => {
      window.PalabreTheme.choisir(select.value);
      // Le bouton soleil / lune de l'en-tête doit montrer le bon dessin.
      document.dispatchEvent(new Event('palabre:theme'));
      toast('Enregistré');
    });
  }

  // ---------- Mes données ----------
  function brancherDonnees() {
    const bouton = rubrique('donnees').querySelector('[data-telecharger]');
    bouton.addEventListener('click', async () => {
      bouton.disabled = true;
      try {
        const donnees = await api('/parametres/export', { methode: 'POST', donnees: {} });
        // Le fichier est fabriqué dans le navigateur à partir de la réponse, puis proposé au téléchargement.
        const adresse = URL.createObjectURL(new Blob([JSON.stringify(donnees, null, 2)], { type: 'application/json' }));
        const lien = el('a', { href: adresse, download: `palabre-mes-donnees-${new Date().toISOString().slice(0, 10)}.json` });
        document.body.append(lien);
        lien.click();
        lien.remove();
        setTimeout(() => URL.revokeObjectURL(adresse), 10000);
        toast('Tes données sont téléchargées.');
      } catch (erreur) {
        toast(erreur.message, 'erreur');
      }
      bouton.disabled = false;
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const moi = await utilisateurConnecte();
    if (!moi) {
      window.location.replace('/connexion?suite=/parametres');
      return;
    }
    dessinerListe();
    brancherApparence();
    brancherDonnees();
    brancherNotifications(moi);
    window.addEventListener('hashchange', ouvrirRubrique);
    // Le retour vers la liste (téléphone) : sans recharger la page.
    document.querySelector('[data-retour] a').addEventListener('click', (evenement) => {
      evenement.preventDefault();
      window.history.pushState(null, '', '/parametres');
      ouvrirRubrique();
    });
    window.addEventListener('popstate', ouvrirRubrique);
    ordinateur.addEventListener('change', ouvrirRubrique);
    try {
      const { compte, confidentialite, securite } = await api('/parametres');
      brancherCompte(compte);
      brancherConfidentialite(confidentialite, moi);
      brancherSecurite(securite);
    } catch (erreur) {
      toast(erreur.message, 'erreur');
    }
    ouvrirRubrique();
  });
})();
