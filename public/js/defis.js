// Page /defis : le défi de la semaine. L'énoncé et son compte à rebours, le formulaire de réponse (pour un dev),
// les réponses, puis le vote. Le serveur dit dans quelle phase on est et ce que le membre peut faire
// (peutRepondre, peutVoter) : la page ne fait que l'afficher.
(function () {
  const { t, deNom, api, el, avatar, nomMembre, icone, etatVide, toast, confirmer, utilisateurConnecte, tempsRestant } = window.Palabre;
  const zone = () => document.querySelector('[data-defi]');
  const PHASES = { reponses: t('defis.phase.reponses'), vote: t('defis.phase.vote'), termine: t('defis.phase.termine') };

  // « Il reste 2 jours et 5 heures pour répondre. »
  function compteARebours(defi) {
    if (defi.phase === 'termine') return t('defis.termine');
    const reste = tempsRestant(defi.phase === 'reponses' ? defi.finReponsesLe : defi.finVoteLe);
    return t(defi.phase === 'reponses' ? 'defis.il-reste-repondre' : 'defis.il-reste-voter', { temps: reste });
  }

  function carteDefi(defi) {
    return el('section', { classe: 'carte-publication carte-defi', 'aria-labelledby': 'titre-defi' }, [
      el('p', { classe: 'defi-etat' }, [
        el('span', { classe: `pastille pastille-defi phase-${defi.phase}`, texte: PHASES[defi.phase] }),
        el('span', { classe: 'texte-discret avec-icone' }, [icone('horloge'), compteARebours(defi)]),
      ]),
      el('h2', { id: 'titre-defi', texte: defi.titre }),
      el('p', { classe: 'defi-probleme', texte: defi.probleme }),
    ]);
  }

  // ---------- Répondre (ou modifier sa réponse) ----------
  function formulaireReponse(defi, mienne) {
    const texte = el('textarea', { id: 'reponse-texte', rows: 6, minlength: 20, maxlength: 2000, required: true, placeholder: t('defis.solution-aide') });
    texte.value = mienne ? mienne.texte : '';
    const lien = el('input', { id: 'reponse-lien', type: 'url', inputmode: 'url', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', maxlength: 300, placeholder: 'https://github.com/…' });
    lien.value = mienne && mienne.lien ? mienne.lien : '';
    const erreurTexte = el('p', { classe: 'erreur-champ' });
    const erreurLien = el('p', { classe: 'erreur-champ' });
    const message = el('p', { classe: 'message', role: 'alert' });
    const compteur = el('span', { classe: 'aide' });
    const compter = () => { compteur.textContent = t('defis.compteur', { n: texte.value.trim().length }); };
    texte.addEventListener('input', compter);
    compter();
    const envoyer = el('button', { classe: 'bouton bouton-principal', type: 'submit' }, [icone('envoyer'), mienne ? t('defis.enregistrer-reponse') : t('defis.envoyer-reponse')]);
    const retirer = mienne ? el('button', { classe: 'bouton bouton-lien', type: 'button', texte: t('defis.retirer-reponse') }) : null;

    const formulaire = el('form', { classe: 'bloc-formulaire formulaire-defi', novalidate: true }, [
      el('h2', { texte: mienne ? t('defis.ta-reponse') : t('defis.ta-reponse-au-defi') }),
      mienne ? el('p', { classe: 'texte-discret', texte: t('defis.modifiable') }) : null,
      el('div', { classe: 'champ' }, [el('label', { for: 'reponse-texte', texte: t('defis.ta-solution') }), texte, compteur, erreurTexte]),
      el('div', { classe: 'champ' }, [
        el('label', { for: 'reponse-lien' }, [t('defis.lien'), el('span', { classe: 'aide', texte: t('defis.lien-aide') })]),
        lien, erreurLien,
      ]),
      message,
      el('div', { classe: 'profil-actions' }, [envoyer, retirer]),
    ]);

    formulaire.addEventListener('submit', async (evenement) => {
      evenement.preventDefault();
      erreurTexte.textContent = '';
      erreurLien.textContent = '';
      message.textContent = '';
      message.className = 'message';
      envoyer.disabled = true;
      try {
        const reponse = await api(`/defis/${defi.id}/reponse`, { methode: 'POST', donnees: { texte: texte.value, lien: lien.value } });
        toast(reponse.modifiee ? t('defis.reponse-modifiee') : t('defis.reponse-envoyee'));
        await afficher();
      } catch (erreur) {
        if (erreur.champ === 'texte') { erreurTexte.textContent = erreur.message; texte.focus(); }
        else if (erreur.champ === 'lien') { erreurLien.textContent = erreur.message; lien.focus(); }
        else { message.textContent = erreur.message; message.className = 'message erreur'; }
        envoyer.disabled = false;
      }
    });
    if (retirer) {
      retirer.addEventListener('click', async () => {
        if (!(await confirmer(t('defis.retirer-question'), { bouton: t('commun.retirer'), danger: true }))) return;
        try {
          await api(`/defis/${defi.id}/reponse`, { methode: 'DELETE', donnees: {} });
          toast(t('defis.reponse-retiree'));
          await afficher();
        } catch (erreur) {
          toast(erreur.message, 'erreur');
        }
      });
    }
    return formulaire;
  }

  // ---------- Une réponse ----------
  function carteReponse(defi, reponse, peutVoter) {
    const pied = [];
    if (defi.phase === 'termine') {
      pied.push(el('span', { classe: 'texte-discret', texte: t('defis.votes', { n: reponse.nbVotes }) }));
    } else if (defi.phase === 'vote' && reponse.estMoi) {
      pied.push(el('span', { classe: 'texte-discret', texte: t('defis.pas-pour-soi') }));
    } else if (peutVoter) {
      const bouton = el('button', { classe: `bouton ${reponse.monVote ? 'bouton-principal' : 'bouton-contour'}`, type: 'button', 'aria-pressed': String(reponse.monVote) },
        [icone(reponse.monVote ? 'valide' : 'coeur'), reponse.monVote ? t('defis.ton-vote') : t('defis.voter')]);
      bouton.addEventListener('click', async () => {
        if (reponse.monVote) return;
        bouton.disabled = true;
        try {
          await api(`/defis/${defi.id}/vote`, { methode: 'POST', donnees: { reponseId: reponse.id } });
          toast(t('defis.vote-enregistre'));
          await afficher();
        } catch (erreur) {
          toast(erreur.message, 'erreur');
          bouton.disabled = false;
        }
      });
      pied.push(bouton);
    }
    return el('article', { classe: `carte-publication reponse-defi${reponse.gagnante ? ' gagnante' : ''}` }, [
      reponse.gagnante ? el('p', { classe: 'pastille pastille-gagnant' }, [icone('trophee'), t('defis.gagnante')]) : null,
      el('header', { classe: 'publication-entete' }, [
        el('a', { classe: 'lien-avatar', href: `/${reponse.auteur.identifiant}`, 'aria-label': t('commun.profil-de', { nom: reponse.auteur.nom, deNom: deNom(reponse.auteur.nom) }) }, [avatar(reponse.auteur, 'moyen')]),
        el('div', { classe: 'publication-qui' }, [
          nomMembre(reponse.auteur),
          el('p', { classe: 'texte-discret publication-meta', texte: [reponse.auteur.ville, reponse.auteur.pays].filter(Boolean).join(', ') }),
        ]),
      ]),
      el('p', { classe: 'publication-texte', texte: reponse.texte }),
      reponse.lien ? el('p', { classe: 'reponse-lien' }, [
        el('a', { classe: 'avec-icone', href: reponse.lien, target: '_blank', rel: 'noopener nofollow' }, [icone('lien'), t('defis.voir-lien')]),
        reponse.lienVerifie ? el('span', { classe: 'badge-verifie' }, [icone('verifie'), t('commun.lien-verifie')]) : null,
      ]) : null,
      pied.length ? el('div', { classe: 'reponse-pied' }, pied) : null,
    ]);
  }

  // Ce qu'on dit à quelqu'un qui ne peut pas (encore) participer.
  function invitation(donnees, moi) {
    const { defi } = donnees;
    if (defi.phase === 'termine') return null;
    if (!moi) {
      return el('p', { classe: 'encart-defi' }, [t(defi.phase === 'reponses' ? 'defis.connecte-repondre' : 'defis.connecte-voter'), el('a', { classe: 'bouton bouton-contour', href: '/connexion?suite=/defis', texte: t('nav.se-connecter') })]);
    }
    if (donnees.profilIncomplet && defi.phase === 'reponses') {
      return el('p', { classe: 'encart-defi' }, [t('defis.termine-profil'), el('a', { classe: 'bouton bouton-contour', href: '/bienvenue?suite=/defis', texte: t('defis.terminer-profil') })]);
    }
    if (defi.phase === 'reponses' && moi.type === 'client') {
      return el('p', { classe: 'encart-defi', texte: t('defis.en-cours') });
    }
    return null;
  }

  async function afficher() {
    const [donnees, moi] = await Promise.all([api('/defis/courant'), utilisateurConnecte()]);
    const { defi, reponses } = donnees;
    if (!defi) {
      zone().replaceChildren(etatVide('projets', t('defis.pas-de-defi'), t('defis.pas-de-defi-aide')));
      return;
    }
    const mienne = reponses.find((r) => r.estMoi) || null;
    const titreReponses = reponses.length
      ? t('commun.reponses', { n: reponses.length })
      : t('defis.reponses');
    zone().replaceChildren(...[
      carteDefi(defi),
      invitation(donnees, moi),
      donnees.peutRepondre ? formulaireReponse(defi, mienne) : null,
      el('h2', { classe: 'titre-reponses', texte: titreReponses }),
      defi.phase === 'vote' ? el('p', { classe: 'texte-discret', texte: t('defis.un-vote') }) : null,
      reponses.length
        ? el('div', { classe: 'liste-publications' }, reponses.map((r) => carteReponse(defi, r, donnees.peutVoter)))
        : etatVide('palabre', t('defis.aucune-reponse'), defi.phase === 'reponses' ? t('defis.sois-premier') : t('defis.personne')),
    ].filter(Boolean));
  }

  document.addEventListener('DOMContentLoaded', () => {
    afficher().catch((erreur) => {
      zone().replaceChildren(etatVide('calme', t('defis.ne-s-affiche-pas'), erreur.message));
    });
  });
})();
