// Page profil public : palabre.dev/identifiant
(function () {
  const { api, el, avatar, signaler, partager, carteProjet, etoiles, dateRelative, icone, etatVide, toast } = window.Palabre;

  const identifiant = decodeURIComponent(window.location.pathname.slice(1)).toLowerCase();

  function lienWhatsApp(numero, nom) {
    const chiffres = numero.replace(/\D/g, '');
    const message = `Bonjour ${nom}, je t'ai trouvé sur Palabre.`;
    return `https://wa.me/${chiffres}?text=${encodeURIComponent(message)}`;
  }


  // Boutons d'amitié selon le lien actuel : aucune, demande envoyée, demande reçue, déjà amis.
  function boutonsAmitie(profil) {
    const cible = encodeURIComponent(profil.identifiant);
    function bouton(texte, classe, nomIcone, appel, succes) {
      const b = el('button', { classe: `bouton ${classe}`, type: 'button' }, [nomIcone ? icone(nomIcone) : null, texte]);
      b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          await appel();
          await afficher(); // relit le profil pour montrer le nouvel état
          toast(succes);
        } catch (erreur) {
          toast(erreur.message, 'erreur');
          b.disabled = false;
        }
      });
      return b;
    }

    if (profil.amitie === 'aucune') {
      return [bouton('Ajouter en ami', 'bouton-or', 'ami-ajouter', () => api('/amis/demandes', { methode: 'POST', donnees: { identifiant: profil.identifiant } }), 'Demande d\'ami envoyée.')];
    }
    if (profil.amitie === 'envoyee') {
      return [el('button', { classe: 'bouton bouton-contour', type: 'button', disabled: true }, [icone('horloge'), 'Demande envoyée'])];
    }
    if (profil.amitie === 'recue') {
      return [
        bouton('Accepter la demande d\'ami', 'bouton-or', 'valide', () => api(`/amis/demandes/${cible}/accepter`, { methode: 'POST', donnees: {} }), 'Vous êtes maintenant amis.'),
        bouton('Refuser', 'bouton-contour', null, () => api(`/amis/demandes/${cible}/refuser`, { methode: 'POST', donnees: {} }), 'Demande refusée.'),
      ];
    }
    return [];
  }

  function actions(profil) {
    const zone = el('div', { classe: 'profil-actions' });
    if (profil.estMoi) {
      zone.append(el('a', { classe: 'bouton bouton-principal', href: '/modifier-profil' }, [icone('modifier'), 'Modifier mon profil']));
    } else if (profil.whatsapp) {
      zone.append(el('a', {
        classe: 'bouton bouton-principal',
        href: lienWhatsApp(profil.whatsapp, profil.nom.split(' ')[0]),
        target: '_blank',
        rel: 'noopener',
      }, [icone('commentaire'), 'Contacter sur WhatsApp']));
    } else if (profil.whatsappMasque) {
      zone.append(el('a', {
        classe: 'bouton bouton-principal',
        href: `/connexion?suite=/${profil.identifiant}`,
        texte: 'Se connecter pour contacter',
      }));
    }
    zone.append(...boutonsAmitie(profil));
    const boutonPartage = el('button', { classe: 'bouton bouton-contour', type: 'button' }, [icone('partager'), 'Partager le profil']);
    boutonPartage.addEventListener('click', () => partager(`${window.location.origin}/${profil.identifiant}`, `${profil.nom} sur Palabre`, boutonPartage));
    zone.append(boutonPartage);
    // « amitie » n'est renseigné que pour un membre connecté qui regarde le profil de quelqu'un d'autre.
    if (profil.amitie) {
      const boutonSignaler = el('button', { classe: 'bouton bouton-lien', type: 'button' }, [icone('signaler'), 'Signaler']);
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
    // Les chiffres du profil. Un client n'a ni projets ni avis : on ne montre que ses amis.
    const chiffre = (nombre, nom) => el('div', {}, [el('dt', { texte: nom }), el('dd', { texte: String(nombre) })]);
    const chiffres = profil.type === 'dev'
      ? [chiffre(profil.projets.length, profil.projets.length > 1 ? 'projets' : 'projet'), chiffre(profil.nbAmis, profil.nbAmis > 1 ? 'amis' : 'ami'), chiffre(profil.nbAvis, 'avis')]
      : [chiffre(profil.nbAmis, profil.nbAmis > 1 ? 'amis' : 'ami')];

    return el('section', { classe: 'carte-profil profil-membre' }, [
      el('div', { classe: 'profil-banniere' }), // motif décoratif (CSS), la photo vient chevaucher son bord
      el('div', { classe: 'profil-entete' }, [
        avatar(profil, 'grand'),
        el('div', {}, [
          el('h1', { texte: profil.nom }),
          el('p', { classe: 'profil-role', texte: profil.type === 'dev' ? 'Développeur' : 'Client' }),
          el('p', { classe: 'profil-lieu' }, [icone('lieu'), lieu]),
        ]),
      ]),
      el('dl', { classe: 'profil-chiffres' }, chiffres),
      statut,
      profil.nbAvis ? el('p', { classe: 'note-moyenne' }, [etoiles(profil.noteMoyenne), ` ${String(profil.noteMoyenne).replace('.', ',')} sur 5 (${profil.nbAvis} avis)`]) : null,
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
    const gerer = profil.estMoi
      ? el('a', { classe: 'bouton bouton-contour', href: '/projets' }, [icone(profil.projets.length ? 'modifier' : 'plus'), profil.projets.length ? 'Gérer mes projets' : 'Ajouter mon premier projet'])
      : null;
    const contenu = profil.projets.length
      ? el('div', { classe: 'grille-projets' }, profil.projets.map((p) => carteProjet(p, { avecDev: false })))
      : (profil.estMoi
        ? etatVide('projets', 'Montre ce que tu sais faire', 'Ajoute tes projets réalisés : ceux dont le lien répond reçoivent le badge « Lien vérifié ».', gerer)
        : etatVide('projets', 'Pas encore de réalisation', `${profil.nom.split(' ')[0]} n'a pas encore ajouté de projet.`));
    return el('section', { classe: 'section-profil' }, [
      el('h2', { texte: profil.projets.length ? `Réalisations (${profil.projets.length})` : 'Réalisations' }),
      contenu,
      profil.projets.length ? gerer : null,
    ]);
  }

  // Avis laissés par de vrais clients : chacun correspond à une demande terminée et attribuée à ce dev.
  function sectionAvis(profil) {
    const section = el('section', { classe: 'section-profil' }, [
      el('h2', { texte: profil.nbAvis ? `Avis des clients (${profil.nbAvis})` : 'Avis des clients' }),
    ]);
    if (!profil.nbAvis) {
      section.append(el('p', { classe: 'texte-discret', texte: 'Pas encore d\'avis. Seuls les clients qui ont travaillé avec ce développeur sur Palabre peuvent en laisser un.' }));
      return section;
    }
    section.append(
      el('p', { classe: 'note-moyenne' }, [etoiles(profil.noteMoyenne), ` ${String(profil.noteMoyenne).replace('.', ',')} sur 5`]),
      el('ul', { classe: 'liste-avis' }, profil.avis.map((a) => el('li', { classe: 'avis' }, [
        el('p', { classe: 'avis-entete' }, [
          etoiles(a.note),
          el('span', { classe: 'texte-discret' }, [' · ', el('a', { href: `/${a.client.identifiant}`, texte: a.client.nom }), ` · ${dateRelative(a.creeLe)}`]),
        ]),
        a.commentaire ? el('p', { classe: 'avis-texte', texte: a.commentaire }) : null,
        el('p', { classe: 'texte-discret avis-demande', texte: `Demande : ${a.titreDemande}` }),
      ]))),
    );
    return section;
  }

  async function afficher() {
    const zone = document.querySelector('[data-profil]');
    try {
      const { profil } = await api(`/profils/${encodeURIComponent(identifiant)}`);
      document.title = `${profil.nom} – Palabre`;
      zone.replaceChildren(carteProfil(profil));
      if (profil.type === 'dev') zone.append(sectionCompetences(profil), sectionRealisations(profil), sectionAvis(profil));
    } catch (erreur) {
      document.title = 'Profil introuvable – Palabre';
      zone.replaceChildren(etatVide('recherche', 'Profil introuvable',
        erreur.statut === 404 ? 'Ce profil n\'existe pas ou a été supprimé.' : erreur.message,
        el('a', { classe: 'bouton bouton-principal', href: '/chercher', texte: 'Chercher un développeur' })));
    }
  }

  document.addEventListener('DOMContentLoaded', afficher);
})();
