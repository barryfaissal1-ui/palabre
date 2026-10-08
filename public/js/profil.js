// Page profil public : palabre.dev/identifiant
(function () {
  const { api, el, avatar, signaler } = window.Palabre;

  const identifiant = decodeURIComponent(window.location.pathname.slice(1)).toLowerCase();

  function lienWhatsApp(numero, nom) {
    const chiffres = numero.replace(/\D/g, '');
    const message = `Bonjour ${nom}, je t'ai trouvé sur Palabre.`;
    return `https://wa.me/${chiffres}?text=${encodeURIComponent(message)}`;
  }

  async function partager(profil, bouton) {
    const url = `${window.location.origin}/${profil.identifiant}`;
    const titre = `${profil.nom} sur Palabre`;
    if (navigator.share) {
      try {
        await navigator.share({ title: titre, url });
        return;
      } catch {
        return; // partage annulé par la personne
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      bouton.textContent = 'Lien copié';
      setTimeout(() => { bouton.textContent = 'Partager le profil'; }, 2000);
    } catch {
      window.prompt('Copie ce lien :', url);
    }
  }

  // Boutons d'amitié selon le lien actuel : aucune, demande envoyée, demande reçue, déjà amis.
  function boutonsAmitie(profil) {
    const cible = encodeURIComponent(profil.identifiant);
    function bouton(texte, classe, appel) {
      const b = el('button', { classe: `bouton ${classe}`, type: 'button', texte });
      b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          await appel();
          await afficher(); // relit le profil pour montrer le nouvel état
        } catch (erreur) {
          window.alert(erreur.message);
          b.disabled = false;
        }
      });
      return b;
    }

    if (profil.amitie === 'aucune') {
      return [bouton('Ajouter en ami', 'bouton-or', () => api('/amis/demandes', { methode: 'POST', donnees: { identifiant: profil.identifiant } }))];
    }
    if (profil.amitie === 'envoyee') {
      return [el('button', { classe: 'bouton bouton-contour', type: 'button', disabled: true, texte: 'Demande envoyée' })];
    }
    if (profil.amitie === 'recue') {
      return [
        bouton('Accepter la demande d\'ami', 'bouton-or', () => api(`/amis/demandes/${cible}/accepter`, { methode: 'POST', donnees: {} })),
        bouton('Refuser', 'bouton-contour', () => api(`/amis/demandes/${cible}/refuser`, { methode: 'POST', donnees: {} })),
      ];
    }
    return [];
  }

  function actions(profil) {
    const zone = el('div', { classe: 'profil-actions' });
    if (profil.estMoi) {
      zone.append(el('a', { classe: 'bouton bouton-principal', href: '/modifier-profil', texte: 'Modifier mon profil' }));
    } else if (profil.whatsapp) {
      zone.append(el('a', {
        classe: 'bouton bouton-principal',
        href: lienWhatsApp(profil.whatsapp, profil.nom.split(' ')[0]),
        target: '_blank',
        rel: 'noopener',
        texte: 'Contacter sur WhatsApp',
      }));
    } else if (profil.whatsappMasque) {
      zone.append(el('a', {
        classe: 'bouton bouton-principal',
        href: `/connexion?suite=/${profil.identifiant}`,
        texte: 'Se connecter pour contacter',
      }));
    }
    zone.append(...boutonsAmitie(profil));
    const boutonPartage = el('button', { classe: 'bouton bouton-contour', type: 'button', texte: 'Partager le profil' });
    boutonPartage.addEventListener('click', () => partager(profil, boutonPartage));
    zone.append(boutonPartage);
    // « amitie » n'est renseigné que pour un membre connecté qui regarde le profil de quelqu'un d'autre.
    if (profil.amitie) {
      const boutonSignaler = el('button', { classe: 'bouton bouton-lien', type: 'button', texte: 'Signaler' });
      boutonSignaler.addEventListener('click', () => signaler('profil', profil.identifiant));
      zone.append(boutonSignaler);
    }
    return zone;
  }

  function carteProfil(profil) {
    const lieu = [profil.ville, profil.pays].filter(Boolean).join(', ');
    const statut = profil.type === 'dev'
      ? el('span', { classe: `pastille ${profil.disponible ? 'pastille-dispo' : 'pastille-occupe'}`, texte: profil.disponible ? 'Disponible pour des projets' : 'Occupé en ce moment' })
      : null;

    return el('section', { classe: 'carte-profil' }, [
      el('div', { classe: 'profil-entete' }, [
        avatar(profil, 'grand'),
        el('div', {}, [
          el('h1', { texte: profil.nom }),
          el('p', { classe: 'profil-role', texte: profil.type === 'dev' ? 'Développeur' : 'Client' }),
          el('p', { classe: 'profil-lieu', texte: lieu }),
        ]),
      ]),
      statut,
      profil.amitie === 'amis' ? el('span', { classe: 'pastille pastille-ami', texte: 'Vous êtes amis' }) : null,
      profil.bio ? el('p', { classe: 'profil-bio', texte: profil.bio }) : null,
      actions(profil),
    ]);
  }

  function sectionCompetences(profil) {
    const contenu = profil.competences.length
      ? el('ul', { classe: 'puces' }, profil.competences.map((c) => el('li', { texte: c.nom })))
      : el('p', { classe: 'texte-discret', texte: profil.estMoi ? 'Ajoute tes compétences pour que les clients te trouvent.' : 'Aucune compétence renseignée pour l\'instant.' });
    return el('section', { classe: 'section-profil' }, [el('h2', { texte: 'Compétences' }), contenu]);
  }

  function sectionRealisations(profil) {
    return el('section', { classe: 'section-profil' }, [
      el('h2', { texte: 'Réalisations' }),
      el('div', { classe: 'vide' }, [
        el('p', {
          texte: profil.estMoi
            ? 'Tes projets réalisés apparaîtront ici, avec un badge « Lien vérifié ». Cette partie arrive très bientôt.'
            : 'Aucun projet publié pour l\'instant.',
        }),
      ]),
    ]);
  }

  async function afficher() {
    const zone = document.querySelector('[data-profil]');
    try {
      const { profil } = await api(`/profils/${encodeURIComponent(identifiant)}`);
      document.title = `${profil.nom} – Palabre`;
      zone.replaceChildren(carteProfil(profil));
      if (profil.type === 'dev') zone.append(sectionCompetences(profil), sectionRealisations(profil));
    } catch (erreur) {
      document.title = 'Profil introuvable – Palabre';
      zone.replaceChildren(el('div', { classe: 'vide' }, [
        el('p', { texte: erreur.statut === 404 ? 'Ce profil n\'existe pas ou a été supprimé.' : erreur.message }),
        el('a', { classe: 'bouton bouton-principal', href: '/', texte: 'Retour à l\'accueil' }),
      ]));
    }
  }

  document.addEventListener('DOMContentLoaded', afficher);
})();
