// Page « Paramètres et confidentialité » (/parametres).
// Une liste de rubriques ; chaque réglage s'enregistre tout seul au changement, avec un toast « Enregistré ».
// La rubrique ouverte est dans l'adresse (/parametres#confidentialite) : le bouton « retour » du téléphone marche.
(function () {
  const { t, langue, changerLangue, api, utilisateurConnecte, el, icone, avatar, nomMembre, toast, confirmer, listeChoix, etatVide, chargement, dateRelative } = window.Palabre;

  const RUBRIQUES = [
    { cle: 'compte', icone: 'utilisateur', titre: t('parametres.compte.titre'), texte: t('parametres.compte.resume') },
    { cle: 'langue', icone: 'globe', titre: t('parametres.langue.titre'), texte: 'Français, English' },
    { cle: 'confidentialite', icone: 'cadenas', titre: t('parametres.confidentialite.titre'), texte: t('parametres.confidentialite.resume') },
    { cle: 'notifications', icone: 'cloche', titre: t('nav.notifications'), texte: t('parametres.notifications.resume') },
    { cle: 'securite', icone: 'bouclier', titre: t('parametres.securite.titre'), texte: t('parametres.securite.resume') },
    { cle: 'bloques', icone: 'bloquer', titre: t('parametres.bloques.titre'), texte: t('parametres.bloques.resume') },
    { cle: 'apparence', icone: 'soleil', titre: t('parametres.apparence.titre'), texte: t('parametres.apparence.resume') },
    { cle: 'donnees', icone: 'telecharger', titre: t('parametres.donnees.titre'), texte: t('parametres.donnees.resume') },
  ];

  // Les réglages de confidentialité : la clé et les valeurs sont celles de src/utils/confidentialite.js.
  // C'est le serveur qui applique chaque réglage ; cette page ne fait que l'enregistrer.
  const CONFIDENTIALITE = [
    { cle: 'publications', titre: t('confidentialite.publications'), choix: [['tous', t('confidentialite.choix.tous-sans-compte')], ['membres', t('confidentialite.choix.membres')], ['amis', t('fil.mes-amis')]] },
    { cle: 'listeAmis', titre: t('confidentialite.liste-amis'), choix: [['membres', t('confidentialite.choix.membres')], ['amis', t('fil.mes-amis')], ['moi', t('confidentialite.choix.moi')]] },
    { cle: 'whatsapp', titre: t('confidentialite.whatsapp'), choix: [['membres', t('confidentialite.choix.membres-connectes')], ['amis', t('fil.mes-amis')], ['personne', t('confidentialite.choix.personne')]] },
    { cle: 'messages', titre: t('confidentialite.messages'), aide: t('confidentialite.messages-aide'), choix: [['tous', t('fil.tout-le-monde')], ['proches', t('confidentialite.choix.proches-seulement')]] },
    { cle: 'appels', titre: t('confidentialite.appels'), aide: t('confidentialite.appels-aide'), choix: [['proches', t('confidentialite.choix.proches')], ['amis', t('confidentialite.choix.amis-seulement')], ['personne', t('confidentialite.choix.personne')]] },
    { cle: 'equipes', titre: t('confidentialite.equipes'), choix: [['amis', t('fil.mes-amis')], ['personne', t('confidentialite.choix.personne')]] },
    { cle: 'recherche', titre: t('confidentialite.recherche'), aide: t('confidentialite.recherche-aide'), interrupteur: true, seulementDev: true },
    { cle: 'presence', titre: t('confidentialite.presence'), aide: t('confidentialite.presence-aide'), interrupteur: true },
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
        toast(t('commun.enregistre'));
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
        toast(t('commun.enregistre'));
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
          toast(t('commun.enregistre'));
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
        toast(t('parametres.email.changee'));
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
        erreurDe(formSuppression, 'motDePasse').textContent = t('parametres.suppression.mot-de-passe');
        return;
      }
      if (!await confirmer(t('parametres.suppression.question'), { bouton: t('parametres.suppression.titre'), danger: true })) return;
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
        toast(t('commun.enregistre'));
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
      : t('parametres.securite.aucune');
    zone.querySelector('[data-deconnecter-autres]').addEventListener('click', async () => {
      if (!await confirmer(t('parametres.securite.question'), { bouton: t('parametres.securite.deconnecter') })) return;
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
        zone.replaceChildren(etatVide('calme', t('parametres.bloques.personne'), t('parametres.bloques.personne-aide')));
        return;
      }
      zone.replaceChildren(el('ul', { classe: 'liste-bloques' }, bloques.map((membre) => {
        const bouton = el('button', { classe: 'bouton bouton-contour bouton-compact', type: 'button', texte: t('messages.debloquer') });
        const ligne = el('li', { classe: 'ligne-bloque' }, [avatar(membre, 'moyen'), el('div', { classe: 'ligne-bloque-nom' }, [nomMembre(membre)]), bouton]);
        bouton.addEventListener('click', async () => {
          bouton.disabled = true;
          try {
            await api(`/messages/blocages/${encodeURIComponent(membre.identifiant)}`, { methode: 'DELETE', donnees: {} });
            toast(t('messages.est-debloque', { prenom: membre.prenom }));
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
      toast(t('commun.enregistre'));
    });
  }

  // ---------- Langue : le cookie, le compte, puis la page est relue dans la nouvelle langue ----------
  function brancherLangue() {
    const select = rubrique('langue').querySelector('[name="langue"]');
    select.value = langue;
    select.dispatchEvent(new Event('change')); // la liste habillée affiche la langue actuelle
    select.addEventListener('change', () => changerLangue(select.value, { connecte: true }));
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
        toast(t('parametres.donnees.telechargees'));
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
    brancherLangue();
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
