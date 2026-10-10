// Page /defis : le défi de la semaine. L'énoncé et son compte à rebours, le formulaire de réponse (pour un dev),
// les réponses, puis le vote. Le serveur dit dans quelle phase on est et ce que le membre peut faire
// (peutRepondre, peutVoter) : la page ne fait que l'afficher.
(function () {
  const { api, el, avatar, nomMembre, icone, etatVide, toast, confirmer, utilisateurConnecte, tempsRestant } = window.Palabre;
  const zone = () => document.querySelector('[data-defi]');
  const PHASES = { reponses: 'Réponses ouvertes', vote: 'Vote en cours', termine: 'Terminé' };

  // « Il reste 2 jours et 5 heures pour répondre. »
  function compteARebours(defi) {
    if (defi.phase === 'termine') return 'Ce défi est terminé.';
    const reste = tempsRestant(defi.phase === 'reponses' ? defi.finReponsesLe : defi.finVoteLe);
    return `Il reste ${reste} pour ${defi.phase === 'reponses' ? 'répondre' : 'voter'}.`;
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
    const texte = el('textarea', { id: 'reponse-texte', rows: 6, minlength: 20, maxlength: 2000, required: true, placeholder: 'Explique ta solution : l\'idée, les outils, pourquoi ça marche…' });
    texte.value = mienne ? mienne.texte : '';
    const lien = el('input', { id: 'reponse-lien', type: 'url', inputmode: 'url', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', maxlength: 300, placeholder: 'https://github.com/…' });
    lien.value = mienne && mienne.lien ? mienne.lien : '';
    const erreurTexte = el('p', { classe: 'erreur-champ' });
    const erreurLien = el('p', { classe: 'erreur-champ' });
    const message = el('p', { classe: 'message', role: 'alert' });
    const compteur = el('span', { classe: 'aide' });
    const compter = () => { compteur.textContent = `${texte.value.trim().length} / 2000 (20 au moins)`; };
    texte.addEventListener('input', compter);
    compter();
    const envoyer = el('button', { classe: 'bouton bouton-principal', type: 'submit' }, [icone('envoyer'), mienne ? 'Enregistrer ma réponse' : 'Envoyer ma réponse']);
    const retirer = mienne ? el('button', { classe: 'bouton bouton-lien', type: 'button', texte: 'Retirer ma réponse' }) : null;

    const formulaire = el('form', { classe: 'bloc-formulaire formulaire-defi', novalidate: true }, [
      el('h2', { texte: mienne ? 'Ta réponse' : 'Ta réponse au défi' }),
      mienne ? el('p', { classe: 'texte-discret', texte: 'Tu peux la modifier tant que les réponses sont ouvertes.' }) : null,
      el('div', { classe: 'champ' }, [el('label', { for: 'reponse-texte', texte: 'Ta solution' }), texte, compteur, erreurTexte]),
      el('div', { classe: 'champ' }, [
        el('label', { for: 'reponse-lien' }, ['Lien ', el('span', { classe: 'aide', texte: '(facultatif : code, démonstration…)' })]),
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
        toast(reponse.modifiee ? 'Réponse modifiée.' : 'Réponse envoyée. Bonne chance !');
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
        if (!(await confirmer('Retirer ta réponse ? Tu pourras en écrire une autre tant que les réponses sont ouvertes.', { bouton: 'Retirer', danger: true }))) return;
        try {
          await api(`/defis/${defi.id}/reponse`, { methode: 'DELETE', donnees: {} });
          toast('Réponse retirée.');
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
      pied.push(el('span', { classe: 'texte-discret', texte: `${reponse.nbVotes} vote${reponse.nbVotes > 1 ? 's' : ''}` }));
    } else if (defi.phase === 'vote' && reponse.estMoi) {
      pied.push(el('span', { classe: 'texte-discret', texte: 'C\'est ta réponse : tu ne peux pas voter pour elle.' }));
    } else if (peutVoter) {
      const bouton = el('button', { classe: `bouton ${reponse.monVote ? 'bouton-principal' : 'bouton-contour'}`, type: 'button', 'aria-pressed': String(reponse.monVote) },
        [icone(reponse.monVote ? 'valide' : 'coeur'), reponse.monVote ? 'Ton vote' : 'Voter pour cette réponse']);
      bouton.addEventListener('click', async () => {
        if (reponse.monVote) return;
        bouton.disabled = true;
        try {
          await api(`/defis/${defi.id}/vote`, { methode: 'POST', donnees: { reponseId: reponse.id } });
          toast('Vote enregistré. Tu peux changer d\'avis jusqu\'à la fin du vote.');
          await afficher();
        } catch (erreur) {
          toast(erreur.message, 'erreur');
          bouton.disabled = false;
        }
      });
      pied.push(bouton);
    }
    return el('article', { classe: `carte-publication reponse-defi${reponse.gagnante ? ' gagnante' : ''}` }, [
      reponse.gagnante ? el('p', { classe: 'pastille pastille-gagnant' }, [icone('trophee'), 'Réponse gagnante']) : null,
      el('header', { classe: 'publication-entete' }, [
        el('a', { classe: 'lien-avatar', href: `/${reponse.auteur.identifiant}`, 'aria-label': `Profil de ${reponse.auteur.nom}` }, [avatar(reponse.auteur, 'moyen')]),
        el('div', { classe: 'publication-qui' }, [
          nomMembre(reponse.auteur),
          el('p', { classe: 'texte-discret publication-meta', texte: [reponse.auteur.ville, reponse.auteur.pays].filter(Boolean).join(', ') }),
        ]),
      ]),
      el('p', { classe: 'publication-texte', texte: reponse.texte }),
      reponse.lien ? el('p', { classe: 'reponse-lien' }, [
        el('a', { classe: 'avec-icone', href: reponse.lien, target: '_blank', rel: 'noopener nofollow' }, [icone('lien'), 'Voir le lien']),
        reponse.lienVerifie ? el('span', { classe: 'badge-verifie' }, [icone('verifie'), 'Lien vérifié']) : null,
      ]) : null,
      pied.length ? el('div', { classe: 'reponse-pied' }, pied) : null,
    ]);
  }

  // Ce qu'on dit à quelqu'un qui ne peut pas (encore) participer.
  function invitation(donnees, moi) {
    const { defi } = donnees;
    if (defi.phase === 'termine') return null;
    if (!moi) {
      return el('p', { classe: 'encart-defi' }, [`Connecte-toi pour ${defi.phase === 'reponses' ? 'répondre ou suivre le défi' : 'voter'}. `, el('a', { classe: 'bouton bouton-contour', href: '/connexion?suite=/defis', texte: 'Se connecter' })]);
    }
    if (donnees.profilIncomplet && defi.phase === 'reponses') {
      return el('p', { classe: 'encart-defi' }, ['Termine ton profil de dev pour répondre au défi. ', el('a', { classe: 'bouton bouton-contour', href: '/bienvenue?suite=/defis', texte: 'Terminer mon profil' })]);
    }
    if (defi.phase === 'reponses' && moi.type === 'client') {
      return el('p', { classe: 'encart-defi', texte: 'Les développeurs répondent en ce moment. Tu pourras voter dès que les réponses seront closes.' });
    }
    return null;
  }

  async function afficher() {
    const [donnees, moi] = await Promise.all([api('/defis/courant'), utilisateurConnecte()]);
    const { defi, reponses } = donnees;
    if (!defi) {
      zone().replaceChildren(etatVide('projets', 'Pas de défi en ce moment', 'Le prochain défi arrive bientôt : un problème concret, tes idées, et le vote des membres.'));
      return;
    }
    const mienne = reponses.find((r) => r.estMoi) || null;
    const titreReponses = reponses.length
      ? `${reponses.length} réponse${reponses.length > 1 ? 's' : ''}`
      : 'Réponses';
    zone().replaceChildren(...[
      carteDefi(defi),
      invitation(donnees, moi),
      donnees.peutRepondre ? formulaireReponse(defi, mienne) : null,
      el('h2', { classe: 'titre-reponses', texte: titreReponses }),
      defi.phase === 'vote' ? el('p', { classe: 'texte-discret', texte: 'Un seul vote par membre. Le nombre de votes sera montré à la fin.' }) : null,
      reponses.length
        ? el('div', { classe: 'liste-publications' }, reponses.map((r) => carteReponse(defi, r, donnees.peutVoter)))
        : etatVide('palabre', 'Aucune réponse pour l\'instant', defi.phase === 'reponses' ? 'Sois le premier à proposer une solution.' : 'Personne n\'a répondu à ce défi.'),
    ].filter(Boolean));
  }

  document.addEventListener('DOMContentLoaded', () => {
    afficher().catch((erreur) => {
      zone().replaceChildren(etatVide('calme', 'Le défi ne s\'affiche pas', erreur.message));
    });
  });
})();
