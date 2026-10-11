// Page /confirmer-email : « les feuilles de l'arbre à palabres ».
// Le code à 6 chiffres s'écrit sur six petites feuilles. Au 6e chiffre il part tout seul au serveur ; pendant la
// vérification les feuilles tourbillonnent. Code bon : elles se posent en couronne sur un tronc, l'arbre à palabres
// se forme, puis on passe à la suite. Code faux : elles retombent, sèchent un instant, et on recommence.
//
// Les règles restent celles du serveur (code haché, 15 minutes, 5 essais, 1 renvoi par minute) : cette page n'est
// qu'une façon plus agréable de saisir le code. Le mouvement n'utilise que transform et opacity (element.animate,
// l'API d'animation du navigateur, sans bibliothèque).
(function () {
  const { api, utilisateurConnecte, toast, t } = window.Palabre;
  const ATTENTE_RENVOI_S = 60;   // le serveur refuse plus d'un code par minute
  const VERIFICATION_MIN_MS = 800; // le tourbillon dure au moins cela, même si le serveur répond tout de suite
  const AVANT_DE_PARTIR_MS = 1500; // temps laissé pour voir l'arbre avant de changer de page
  // Deux usages de cette page : confirmer son email à l'inscription, ou valider une connexion depuis un appareil
  // inconnu (validation en deux étapes, adresse /confirmer-email?motif=connexion).
  const connexion = new URLSearchParams(window.location.search).get('motif') === 'connexion';
  const CLE_ENVOI = connexion ? 'palabre-code-connexion-envoye-le' : 'palabre-code-envoye-le';
  const ROUTES = connexion
    ? { confirmer: '/auth/deux-etapes', renvoyer: '/auth/deux-etapes/renvoyer' }
    : { confirmer: '/auth/confirmer-email', renvoyer: '/auth/renvoyer-code' };
  // « Réduire les animations » (réglage du téléphone) : pas de tourbillon ni d'arbre, seulement des fondus.
  const calme = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pause = (ms) => new Promise((suite) => setTimeout(suite, ms));

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
    const grande = document.querySelector('[data-grande-feuille]');
    const branche = document.querySelector('[data-branche]');
    const feuilles = [...document.querySelectorAll('[data-feuille]')];
    const champs = feuilles.map((f) => f.querySelector('input'));
    const zoneErreur = formulaire.querySelector('[data-erreur="code"]');
    const annonce = formulaire.querySelector('[data-annonce]');
    const bouton = formulaire.querySelector('[data-confirmer]');
    const libelle = bouton.querySelector('[data-libelle]');
    const rond = bouton.querySelector('.rond-attente');
    const boutonRenvoyer = document.querySelector('[data-renvoyer]');

    const caseConfiance = formulaire.querySelector('[name="confiance"]');
    if (connexion) {
      // Pas encore de session : le serveur dit seulement à quelle adresse (masquée) le code est parti.
      let attente;
      try {
        attente = await api('/auth/deux-etapes');
      } catch {
        return window.location.replace('/connexion');
      }
      document.title = t('titre.deux-etapes');
      document.querySelector('[data-titre]').textContent = t('code.deux-etapes.titre');
      document.querySelector('[data-email]').textContent = attente.email;
      document.querySelector('[data-confiance]').hidden = false;
      document.querySelector('[data-zone-secours]').hidden = false;
      document.querySelector('[data-deconnexion]').textContent = t('code.deux-etapes.annuler');
    } else {
      const moi = await utilisateurConnecte();
      if (!moi) return window.location.replace('/connexion');
      if (moi.emailConfirme) return continuer(moi.profilComplet);
      document.querySelector('[data-email]').textContent = moi.email;
    }

    // ---------- La saisie : six champs qui se comportent comme un seul ----------
    const code = () => champs.map((c) => c.value).join('');
    function aller(rang) {
      const champ = champs[Math.max(0, Math.min(champs.length - 1, rang))];
      champ.focus();
      champ.select();
    }
    function poser(rang, chiffre) {
      const champ = champs[rang];
      champ.value = chiffre;
      if (!chiffre) return;
      champ.classList.remove('pop');
      void champ.offsetWidth; // relance l'animation « pop » même si le chiffre est le même
      champ.classList.add('pop');
    }
    // Plusieurs chiffres d'un coup (code collé, ou rempli par le téléphone depuis le SMS ou l'email) :
    // ils sont répartis sur les feuilles à partir de « depart ».
    function repartir(chiffres, depart) {
      [...chiffres].slice(0, champs.length - depart).forEach((chiffre, i) => poser(depart + i, chiffre));
      const prochain = Math.min(depart + chiffres.length, champs.length - 1);
      aller(prochain);
      if (code().length === champs.length) envoyer();
    }
    function effacerErreur() {
      zoneErreur.textContent = '';
      champs.forEach((c) => c.removeAttribute('aria-invalid'));
    }

    champs.forEach((champ, rang) => {
      let avant = '';
      champ.addEventListener('focus', () => { avant = champ.value; champ.select(); });
      champ.addEventListener('input', () => {
        effacerErreur();
        const chiffres = champ.value.replace(/\D/g, ''); // chiffres seulement
        if (chiffres.length <= 1) {
          poser(rang, chiffres);
          avant = chiffres;
          if (!chiffres) return;
          if (rang < champs.length - 1) aller(rang + 1);
          if (code().length === champs.length) envoyer();
          return;
        }
        // Deux caractères dans une feuille déjà remplie : on garde celui qui vient d'être tapé.
        if (chiffres.length === 2 && avant.length === 1) {
          const nouveau = chiffres[0] === avant ? chiffres[1] : chiffres[0];
          champ.value = '';
          repartir(nouveau, rang);
          return;
        }
        champ.value = '';
        repartir(chiffres, chiffres.length >= champs.length ? 0 : rang);
      });
      champ.addEventListener('keydown', (evenement) => {
        if (evenement.key === 'Backspace' && !champ.value && rang > 0) {
          // Retour arrière sur une feuille vide : on revient à la précédente et on l'efface.
          evenement.preventDefault();
          champs[rang - 1].value = '';
          aller(rang - 1);
        } else if (evenement.key === 'ArrowLeft') {
          evenement.preventDefault();
          aller(rang - 1);
        } else if (evenement.key === 'ArrowRight') {
          evenement.preventDefault();
          aller(rang + 1);
        }
      });
      champ.addEventListener('paste', (evenement) => {
        evenement.preventDefault();
        const chiffres = (evenement.clipboardData.getData('text') || '').replace(/\D/g, '');
        if (!chiffres) return;
        effacerErreur();
        repartir(chiffres, chiffres.length >= champs.length ? 0 : rang);
      });
    });
    aller(0);

    // ---------- Le mouvement ----------
    // La position qu'a une feuille à cet instant (au milieu d'une animation), pour repartir de là sans à-coup.
    function figer(element) {
      const transform = getComputedStyle(element).transform;
      element.getAnimations().forEach((animation) => animation.cancel());
      return transform === 'none' ? 'translate(0px, 0px)' : transform;
    }
    const terminee = (animation) => animation.finished.catch(() => {}); // une animation annulée n'est pas une erreur

    let enVol = false;
    // Le tourbillon : chaque feuille décolle, puis tourne sur une ellipse autour du centre de la branche, en
    // tournant sur elle-même. Les feuilles sont décalées les unes des autres (départ, vitesse, position).
    function decoller() {
      enVol = true;
      if (calme) {
        feuilles.forEach((f) => f.animate([{ opacity: 1 }, { opacity: 0.4 }], { duration: 250, fill: 'forwards' }));
        return;
      }
      const largeur = branche.clientWidth;
      const rayonX = Math.min(120, largeur * 0.34);
      const rayonY = 34;
      feuilles.forEach((feuille, rang) => {
        const versCentre = largeur / 2 - (feuille.offsetLeft + feuille.offsetWidth / 2);
        const point = (pas) => {
          const angle = (pas / 12) * 2 * Math.PI + rang * (Math.PI / 3);
          const x = versCentre + rayonX * Math.cos(angle);
          const y = rayonY * Math.sin(angle) - 6 * Math.sin(angle * 2);
          return `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${Math.round(pas * 60 + rang * 40)}deg) scale(0.86)`;
        };
        const envol = feuille.animate(
          [{ transform: 'translate(0px, 0px) rotate(0deg) scale(1)' }, { transform: point(0) }],
          { duration: 380, delay: rang * 45, easing: 'cubic-bezier(0.3, 0.7, 0.4, 1)', fill: 'both' },
        );
        terminee(envol).then(() => {
          if (!enVol || envol.playState !== 'finished') return;
          feuille.animate(Array.from({ length: 13 }, (_, pas) => ({ transform: point(pas) })), { duration: 1500 + rang * 70, iterations: Infinity });
          envol.cancel();
        });
      });
      // La grande feuille se balance à peine, comme une feuille dans le vent.
      grande.animate(
        [{ transform: 'rotate(0deg)' }, { transform: 'rotate(-1.4deg)' }, { transform: 'rotate(0deg)' }, { transform: 'rotate(1.4deg)' }, { transform: 'rotate(0deg)' }],
        { duration: 2600, iterations: Infinity, easing: 'ease-in-out' },
      );
    }

    // Code bon : les feuilles se posent en couronne, le tronc pousse, le badge « vérifié » apparaît.
    async function reussir(profilComplet) {
      enVol = false;
      annonce.textContent = t(connexion ? 'code.deux-etapes.reussi-annonce' : 'code.confirme-annonce');
      const tronc = branche.querySelector('[data-tronc]');
      const coche = branche.querySelector('[data-coche]');
      const onde = branche.querySelector('[data-onde]');
      grande.classList.add('reussi');
      if (calme) {
        feuilles.forEach((f) => f.animate([{ opacity: 0.4 }, { opacity: 0 }], { duration: 300, fill: 'forwards' }));
        await terminee(coche.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, fill: 'forwards' }));
      } else {
        const droit = figer(grande);
        grande.animate([{ transform: droit }, { transform: 'rotate(0deg)' }], { duration: 500, easing: 'ease-out', fill: 'forwards' });
        const largeur = branche.clientWidth;
        const centreY = -10; // la couronne est un peu au-dessus du milieu de la branche
        const rayon = 46;
        feuilles.forEach((feuille, rang) => {
          const depart = figer(feuille);
          const angle = (-165 + rang * 30) * (Math.PI / 180); // un arc au-dessus du tronc, de gauche à droite
          const x = largeur / 2 - (feuille.offsetLeft + feuille.offsetWidth / 2) + rayon * Math.cos(angle);
          const y = centreY + rayon * Math.sin(angle);
          // La pointe de la feuille regarde vers l'extérieur de la couronne.
          const tourne = (-165 + rang * 30) - (rang % 2 === 0 ? 45 : 135);
          feuille.animate(
            [{ transform: depart }, { transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${tourne}deg) scale(0.6)` }],
            { duration: 700, delay: rang * 55, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)', fill: 'both' },
          );
          champs[rang].animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: 'forwards' });
        });
        tronc.animate([{ opacity: 0, transform: 'scaleY(0.2)' }, { opacity: 1, transform: 'scaleY(1)' }], { duration: 450, delay: 450, easing: 'ease-out', fill: 'both' });
        onde.animate([{ opacity: 0.7, transform: 'scale(0.7)' }, { opacity: 0, transform: 'scale(2.6)' }], { duration: 800, delay: 950, easing: 'ease-out', fill: 'both' });
        await terminee(coche.animate(
          [{ opacity: 0, transform: 'scale(0.2)' }, { opacity: 1, transform: 'scale(1.18)', offset: 0.7 }, { opacity: 1, transform: 'scale(1)' }],
          { duration: 420, delay: 900, easing: 'ease-out', fill: 'both' },
        ));
      }
      document.querySelector('[data-titre]').textContent = t(connexion ? 'code.deux-etapes.reussi' : 'code.confirme');
      document.querySelector('[data-texte]').textContent = profilComplet ? t(connexion ? 'code.deux-etapes.bon-retour' : 'code.bienvenue') : t('code.encore-une-etape');
      document.querySelector('[data-confiance]').hidden = true;
      document.querySelector('[data-zone-secours]').hidden = true;
      rond.hidden = true;
      libelle.textContent = t('code.c-est-parti');
      bouton.disabled = false;
      bouton.type = 'button';
      bouton.addEventListener('click', () => continuer(profilComplet));
      document.querySelector('.feuille-renvoi').hidden = true;
      document.querySelector('.feuille-sortie').hidden = true;
      bouton.focus();
      await pause(AVANT_DE_PARTIR_MS);
      continuer(profilComplet);
    }

    // Code faux ou expiré : les feuilles retombent à leur place, frissonnent et sèchent un instant.
    async function echouer(erreur) {
      enVol = false;
      if (calme) {
        feuilles.forEach((f) => f.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 250, fill: 'forwards' }));
        feuilles.forEach((f) => f.querySelector('.petite-seche').animate([{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], { duration: 1100 }));
        await pause(300);
      } else {
        const droit = figer(grande);
        grande.animate(
          [{ transform: droit }, { transform: 'rotate(1deg)', offset: 0.35 }, { transform: 'rotate(-0.9deg)', offset: 0.5 }, { transform: 'rotate(0.7deg)', offset: 0.65 }, { transform: 'rotate(-0.4deg)', offset: 0.8 }, { transform: 'rotate(0deg)' }],
          { duration: 900, easing: 'ease-out' },
        );
        await Promise.all(feuilles.map((feuille, rang) => {
          const depart = figer(feuille);
          feuille.querySelector('.petite-seche').animate(
            [{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 1, offset: 0.75 }, { opacity: 0 }],
            { duration: 1300, delay: 150 + rang * 30 },
          );
          return terminee(feuille.animate(
            [
              { transform: depart },
              { transform: 'translate(0px, 0px) rotate(0deg) scale(1)', offset: 0.45 },
              { transform: 'translate(-3px, 0px) rotate(-4deg)', offset: 0.56 },
              { transform: 'translate(3px, 0px) rotate(4deg)', offset: 0.67 },
              { transform: 'translate(-2px, 0px) rotate(-3deg)', offset: 0.78 },
              { transform: 'translate(2px, 0px) rotate(2deg)', offset: 0.89 },
              { transform: 'translate(0px, 0px) rotate(0deg)' },
            ],
            { duration: 1000, delay: rang * 30, easing: 'ease-out' },
          ));
        }));
      }
      // Les feuilles redeviennent vertes et vides ; le message du serveur s'affiche dessous.
      champs.forEach((c) => { c.disabled = false; c.value = ''; c.setAttribute('aria-invalid', 'true'); });
      zoneErreur.textContent = erreur.message;
      rond.hidden = true;
      libelle.textContent = t('commun.confirmer');
      bouton.disabled = false;
      aller(0);
    }

    let envoiEnCours = false;
    async function envoyer() {
      if (envoiEnCours) return;
      if (code().length < champs.length) {
        zoneErreur.textContent = t('code.entre-six');
        aller(champs.findIndex((c) => !c.value));
        return;
      }
      envoiEnCours = true;
      effacerErreur();
      const saisi = code();
      // On quitte le champ avant de le figer : sinon son chiffre resterait surligné pendant l'animation.
      champs.forEach((c) => { c.blur(); c.disabled = true; });
      bouton.disabled = true;
      rond.hidden = false;
      libelle.textContent = t('code.verification');
      annonce.textContent = t('code.verification-du-code');
      decoller();
      const debut = performance.now();
      // Le tourbillon continue tant que le serveur n'a pas répondu, et dure au moins 800 ms.
      const donnees = connexion ? { code: saisi, confiance: caseConfiance.checked } : { code: saisi };
      const reponse = await api(ROUTES.confirmer, { methode: 'POST', donnees }).then((corps) => ({ corps }), (erreur) => ({ erreur }));
      await pause(Math.max(0, VERIFICATION_MIN_MS - (performance.now() - debut)));
      if (reponse.corps) {
        await reussir(reponse.corps.profilComplet);
      } else {
        await echouer(reponse.erreur);
        envoiEnCours = false;
      }
    }
    formulaire.addEventListener('submit', (evenement) => {
      evenement.preventDefault();
      envoyer();
    });

    // ---------- Renvoyer le code : un par minute, avec un compte à rebours ----------
    // L'heure du dernier envoi est gardée le temps de l'onglet : recharger la page ne remet pas le compteur à zéro.
    function dernierEnvoi() {
      try {
        const garde = Number(sessionStorage.getItem(CLE_ENVOI));
        if (garde) return garde;
        sessionStorage.setItem(CLE_ENVOI, String(Date.now())); // première visite : le code de l'inscription vient de partir
      } catch { /* stockage refusé (navigation privée) : on compte à partir de maintenant */ }
      return Date.now();
    }
    let minuteur = null;
    function patienter(depuis) {
      clearInterval(minuteur);
      const afficher = () => {
        const reste = Math.ceil(ATTENTE_RENVOI_S - (Date.now() - depuis) / 1000);
        if (reste <= 0) {
          clearInterval(minuteur);
          boutonRenvoyer.disabled = false;
          boutonRenvoyer.textContent = t('code.renvoyer');
          return;
        }
        boutonRenvoyer.disabled = true;
        boutonRenvoyer.textContent = t('code.renvoyer-dans', { temps: `${Math.floor(reste / 60)}:${String(reste % 60).padStart(2, '0')}` });
      };
      afficher();
      minuteur = setInterval(afficher, 1000);
    }
    patienter(dernierEnvoi());
    boutonRenvoyer.addEventListener('click', async () => {
      boutonRenvoyer.disabled = true;
      try {
        const reponse = await api(ROUTES.renvoyer, { methode: 'POST', donnees: {} });
        toast(reponse.message);
        effacerErreur();
        champs.forEach((c) => { c.value = ''; });
        aller(0);
        try { sessionStorage.setItem(CLE_ENVOI, String(Date.now())); } catch { /* voir dernierEnvoi() */ }
        patienter(Date.now());
      } catch (erreur) {
        toast(erreur.message, 'erreur');
        boutonRenvoyer.disabled = false;
      }
    });

    document.querySelector('[data-deconnexion]').addEventListener('click', async () => {
      await api(connexion ? '/auth/deux-etapes/annuler' : '/auth/deconnexion', { methode: 'POST', donnees: {} }).catch(() => {});
      try { sessionStorage.removeItem(CLE_ENVOI); } catch { /* rien à retirer */ }
      window.location.href = connexion ? '/connexion' : '/inscription';
    });

    // ---------- Code de secours (deux étapes) : pour qui n'a plus accès à sa boîte email ----------
    if (connexion) {
      const zone = document.querySelector('[data-zone-secours]');
      const formulaireSecours = zone.querySelector('[data-secours]');
      const erreurSecours = formulaireSecours.querySelector('[data-erreur]');
      zone.querySelector('[data-ouvrir-secours]').addEventListener('click', (evenement) => {
        evenement.currentTarget.hidden = true;
        formulaireSecours.hidden = false;
        formulaireSecours.elements.secours.focus();
      });
      formulaireSecours.addEventListener('submit', async (evenement) => {
        evenement.preventDefault();
        erreurSecours.textContent = '';
        const boutonSecours = formulaireSecours.querySelector('button');
        boutonSecours.disabled = true;
        try {
          const corps = await api(ROUTES.confirmer, { methode: 'POST', donnees: { secours: formulaireSecours.elements.secours.value, confiance: caseConfiance.checked } });
          try { sessionStorage.removeItem(CLE_ENVOI); } catch { /* rien à retirer */ }
          continuer(corps.profilComplet);
        } catch (erreur) {
          erreurSecours.textContent = erreur.message;
          boutonSecours.disabled = false;
        }
      });
    }
  });
})();
