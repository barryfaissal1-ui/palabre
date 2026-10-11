// Page publique d'un projet réalisé : palabre.dev/projets/12
(function () {
  const { t, deNom, api, el, avatar, utilisateurConnecte, partager, signaler, icone, etatVide, nomMembre } = window.Palabre;

  const id = window.location.pathname.split('/')[2];

  function page(projet, moi) {
    const lieu = [projet.dev.ville, projet.dev.pays].filter(Boolean).join(', ');
    const boutonPartage = el('button', { classe: 'bouton bouton-contour', type: 'button' }, [icone('partager'), t('commun.partager')]);
    boutonPartage.addEventListener('click', () => partager({ titre: t('projet.partage-titre', { titre: projet.titre }), texte: t('projet.partage-texte', { titre: projet.titre, nom: projet.dev.nom }), url: `${window.location.origin}/projets/${projet.id}` }));

    const actions = el('div', { classe: 'profil-actions' }, [
      projet.lien
        // nofollow / noopener : le site visité ne reçoit ni recommandation ni accès à la page Palabre.
        ? el('a', { classe: 'bouton bouton-principal', href: projet.lien, target: '_blank', rel: 'noopener nofollow' }, [icone('lien-externe'), t('projet.voir-en-ligne')])
        : null,
      boutonPartage,
    ]);
    if (projet.estMoi) {
      actions.append(el('a', { classe: 'bouton bouton-lien', href: '/projets', texte: t('profil.gerer-projets') }));
    } else if (moi) {
      const boutonSignaler = el('button', { classe: 'bouton bouton-lien', type: 'button', texte: t('signalement.titre') });
      boutonSignaler.addEventListener('click', () => signaler('projet', projet.id));
      actions.append(boutonSignaler);
    }

    return [
      el('article', { classe: 'carte-profil' }, [
        projet.image ? el('img', { classe: 'projet-grande-image', src: projet.image, alt: t('projet.capture', { titre: projet.titre }) }) : null,
        el('p', { classe: 'projet-meta' }, [
          el('span', { classe: 'texte-discret', texte: projet.nomSecteur }),
          projet.lienVerifie ? el('span', { classe: 'badge-verifie' }, [icone('verifie'), t('commun.lien-verifie')]) : null,
        ]),
        el('h1', { classe: 'titre-demande', texte: projet.titre }),
        projet.description ? el('p', { classe: 'profil-bio', texte: projet.description }) : null,
        projet.lienVerifie
          ? el('p', { classe: 'texte-discret note-verification', texte: t('projet.visite') })
          : null,
        actions,
      ]),
      el('section', { classe: 'section-profil' }, [
        el('h2', { texte: t('projet.realise-par') }),
        el('div', { classe: 'ligne-membre' }, [
          el('a', { classe: 'lien-avatar', href: `/${projet.dev.identifiant}`, 'aria-label': t('commun.profil-de', { nom: projet.dev.nom, deNom: deNom(projet.dev.nom) }) }, [avatar(projet.dev, 'moyen')]),
          el('div', { classe: 'ligne-membre-infos' }, [
            nomMembre(projet.dev),
            el('p', { classe: 'texte-discret', texte: lieu }),
          ]),
          el('div', { classe: 'ligne-membre-actions' }, [
            el('a', { classe: 'bouton bouton-contour', href: `/${projet.dev.identifiant}`, texte: t('chercher.voir-profil') }),
          ]),
        ]),
      ]),
    ];
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const zone = document.querySelector('[data-projet]');
    try {
      const [{ projet }, moi] = await Promise.all([api(`/projets/${encodeURIComponent(id)}`), utilisateurConnecte()]);
      zone.replaceChildren(...page(projet, moi));
    } catch (erreur) {
      zone.replaceChildren(etatVide('projets', t('projet.introuvable'), erreur.message,
        el('a', { classe: 'bouton bouton-principal', href: '/', texte: t('projet.voir-vitrine') })));
    }
  });
})();
