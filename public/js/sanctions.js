// Page /sanctions : les sanctions prises contre mon compte, et la possibilité de contester chacune une fois.
// Deux façons d'arriver ici : connecté (toutes mes sanctions), ou par le lien « Contester » de l'email
// (/sanctions?jeton=…) : le jeton désigne une seule sanction, et marche même quand le compte est bloqué.
(function () {
  const { api, utilisateurConnecte, el, icone, t, REGION, toast, etatVide, chargement } = window.Palabre;
  const jeton = new URLSearchParams(window.location.search).get('jeton');
  const jour = (date) => new Date(date).toLocaleDateString(REGION, { day: 'numeric', month: 'long', year: 'numeric' });

  const TYPES = {
    avertissement: { nom: t('sanctions.type.avertissement'), icone: 'alerte' },
    suspension: { nom: t('sanctions.type.suspension'), icone: 'horloge' },
    exclusion: { nom: t('sanctions.type.exclusion'), icone: 'bloquer' },
  };

  function carte(sanction) {
    const sorte = TYPES[sanction.type];
    // Ce que la sanction change, en une phrase.
    let effet = t('sanctions.effet.avertissement');
    if (sanction.type === 'suspension') effet = t('sanctions.effet.suspension', { date: jour(sanction.fin) });
    if (sanction.type === 'exclusion') effet = t('sanctions.effet.exclusion');
    if (sanction.annulee) effet = t('sanctions.annulee');

    const zone = el('div', { classe: 'sanction-contestation' });
    function dessinerContestation() {
      const c = sanction.contestation;
      if (c) {
        const reponse = { acceptee: t('sanctions.contestation.acceptee'), rejetee: t('sanctions.contestation.rejetee') }[c.decision] || t('sanctions.contestation.en-attente');
        zone.replaceChildren(
          el('p', { classe: 'texte-discret', texte: t('sanctions.contestation.envoyee', { date: jour(c.le) }) }),
          el('blockquote', { classe: 'contenu-signale', texte: c.texte }),
          el('p', { classe: 'sanction-reponse', texte: reponse }),
        );
        return;
      }
      if (!sanction.contestable) { zone.replaceChildren(); return; }
      const champ = el('textarea', { id: `contester-${sanction.id}`, rows: '4', maxlength: '1000', placeholder: t('sanctions.contester.aide') });
      const erreur = el('p', { classe: 'erreur-champ', role: 'alert' });
      const bouton = el('button', { classe: 'bouton bouton-contour', type: 'submit', texte: t('sanctions.contester.bouton') });
      const formulaire = el('form', { classe: 'formulaire-contestation' }, [
        el('label', { for: `contester-${sanction.id}`, texte: t('sanctions.contester.titre') }), champ, erreur, bouton,
      ]);
      formulaire.addEventListener('submit', async (evenement) => {
        evenement.preventDefault();
        erreur.textContent = '';
        bouton.disabled = true;
        try {
          const reponse = jeton
            ? await api('/sanctions/lien', { methode: 'POST', donnees: { jeton, texte: champ.value } })
            : await api(`/sanctions/${sanction.id}/contester`, { methode: 'POST', donnees: { texte: champ.value } });
          Object.assign(sanction, reponse.sanction);
          dessinerContestation();
          toast(t('sanctions.contester.envoyee'));
        } catch (probleme) {
          erreur.textContent = probleme.message;
          bouton.disabled = false;
        }
      });
      zone.replaceChildren(formulaire);
    }
    dessinerContestation();

    return el('article', { classe: `carte-sanction${sanction.annulee ? ' sanction-annulee' : ''}` }, [
      el('p', { classe: 'sanction-entete' }, [
        el('span', { classe: 'rubrique-icone' }, [icone(sorte.icone)]),
        el('span', { classe: 'sanction-titre' }, [el('strong', { texte: sorte.nom }), el('span', { classe: 'texte-discret', texte: jour(sanction.debut) })]),
      ]),
      el('p', {}, [el('span', { classe: 'texte-discret', texte: t('sanctions.motif') }), ' ', el('span', { texte: sanction.motif })]),
      el('p', { classe: 'sanction-effet', texte: effet }),
      zone,
    ]);
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const zone = document.querySelector('[data-sanctions]');
    if (!jeton && !(await utilisateurConnecte())) {
      window.Palabre.versConnexion('/connexion?suite=/sanctions');
      return;
    }
    const fini = chargement(zone, 2);
    try {
      const { sanctions } = await api(jeton ? `/sanctions/lien?jeton=${encodeURIComponent(jeton)}` : '/sanctions');
      fini();
      if (sanctions.length === 0) {
        zone.replaceChildren(etatVide('calme', t('sanctions.aucune'), t('sanctions.aucune-aide')));
        return;
      }
      zone.replaceChildren(...sanctions.map(carte));
    } catch (erreur) {
      fini();
      zone.replaceChildren(el('p', { classe: 'message erreur', role: 'alert', texte: erreur.message }));
    }
  });
})();
