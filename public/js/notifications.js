// Page « Notifications » : par 10, les suivantes en défilant, rangées par période (aujourd'hui, cette semaine,
// plus ancien). Chaque ligne montre la personne qui a agi, avec une petite pastille qui dit de quoi il s'agit.
(function () {
  const { api, el, avatar, icone, utilisateurConnecte, dateRelative, etatVide, chargement, chargementInfini, toast } = window.Palabre;

  // Type de notification → icône de la pastille et sa couleur (classes .pastille-… du CSS).
  const TYPES = {
    jaime: ['coeur', 'rouge'],
    commentaire: ['commentaire', 'vert'],
    reponse_commentaire: ['commentaire', 'vert'],
    message: ['commentaire', 'bleu'],
    demande_message: ['commentaire', 'bleu'],
    nouvelle_proposition: ['demandes', 'terre'],
    proposition_acceptee: ['demandes', 'terre'],
    invitation_equipe: ['amis', 'prune'],
    equipe_reponses: ['amis', 'prune'],
    defi_gagne: ['trophee', 'ocre'],
    demande_ami: ['ami-ajouter', 'vert'],
    ami_accepte: ['ami-ajouter', 'vert'],
    avis_recu: ['etoile', 'ocre'],
    projet_facebook: ['facebook', 'bleu'],
  };
  const PERIODES = { jour: 'Aujourd\'hui', semaine: 'Cette semaine', avant: 'Plus ancien' };

  // « Aujourd'hui » : depuis minuit ; « Cette semaine » : les 7 derniers jours ; sinon « Plus ancien ».
  function periode(iso) {
    const date = new Date(iso);
    const minuit = new Date();
    minuit.setHours(0, 0, 0, 0);
    if (date >= minuit) return 'jour';
    return date >= new Date(minuit.getTime() - 6 * 86400000) ? 'semaine' : 'avant';
  }

  // La cloche du menu suit le nombre de notifications non lues.
  function majCloche(nonLues) {
    document.querySelectorAll('.compteur-cloche:not(.compteur-messages), .compteur-notifications').forEach((pastille) => {
      if (nonLues) pastille.textContent = String(nonLues);
      else pastille.remove();
    });
    document.querySelector('[data-tout-lire]').hidden = nonLues === 0;
  }

  // Le texte, avec le nom de la personne en gras quand la phrase commence par lui.
  // textContent partout : le nom et le texte viennent d'un membre, ils ne deviennent jamais du HTML.
  function texteAvecNom(notification) {
    const nom = notification.acteur && notification.acteur.nom;
    const zone = el('span', { classe: 'notif-texte' });
    if (nom && notification.texte.startsWith(nom)) zone.append(el('strong', { texte: nom }), notification.texte.slice(nom.length));
    else zone.textContent = notification.texte;
    return zone;
  }

  function ligne(notification) {
    const [nomIcone, couleur] = TYPES[notification.type] || ['cloche', 'vert'];
    // Le lien vient du serveur ; par prudence on n'accepte qu'une adresse interne au site.
    const interne = typeof notification.lien === 'string' && /^\/(?!\/)/.test(notification.lien);
    const lien = el('a', { classe: 'notif', href: interne ? notification.lien : '/notifications' }, [
      el('span', { classe: 'notif-qui' }, [
        // Sans personne (notification du site, compte supprimé) : un rond neutre avec l'icône du type.
        notification.acteur ? avatar(notification.acteur, 'moyen') : el('span', { classe: 'notif-sans-avatar' }, [icone(nomIcone)]),
        el('span', { classe: `notif-pastille pastille-${couleur}` }, [icone(nomIcone)]),
      ]),
      el('span', { classe: 'notif-corps' }, [
        notification.lue ? null : el('span', { classe: 'visuellement-cache', texte: 'Non lue : ' }),
        texteAvecNom(notification),
        el('span', { classe: 'texte-discret notif-date', texte: dateRelative(notification.creeLe) }),
      ]),
      notification.lue ? null : el('span', { classe: 'notif-point', 'aria-hidden': 'true' }),
    ]);
    const element = el('li', { classe: `notif-ligne${notification.lue ? '' : ' non-lue'}`, 'data-periode': periode(notification.creeLe) }, [lien]);
    if (!notification.lue) {
      // On marque comme lue avant de suivre le lien.
      lien.addEventListener('click', async (evenement) => {
        if (evenement.ctrlKey || evenement.metaKey || evenement.shiftKey) return; // ouverture dans un autre onglet
        evenement.preventDefault();
        await api('/notifications/lues', { methode: 'POST', donnees: { id: notification.id } }).catch(() => {});
        window.location.href = lien.href;
      });
    }
    return element;
  }

  // Ajoute des notifications à la liste, avec un titre chaque fois que la période change.
  function ajouter(liste, notifications) {
    notifications.forEach((notification) => {
      const cle = periode(notification.creeLe);
      const derniere = liste.lastElementChild && liste.lastElementChild.dataset.periode;
      if (cle !== derniere) liste.append(el('li', { classe: 'notif-periode', 'data-periode': cle }, [el('h2', { texte: PERIODES[cle] })]));
      liste.append(ligne(notification));
    });
  }

  // Demande une page de notifications. Répond true s'il en reste. « remplacer » : on repart du début.
  let suivant = null;
  async function page({ remplacer = false } = {}) {
    const liste = document.querySelector('[data-notifications]');
    const { notifications, nonLues, suivant: prochain } = await api(`/notifications${!remplacer && suivant ? `?avant=${suivant}` : ''}`);
    if (remplacer) liste.replaceChildren();
    ajouter(liste, notifications);
    majCloche(nonLues);
    suivant = prochain;
    return Boolean(suivant);
  }

  // Depuis le début (ouverture, « Tout marquer comme lu »). La suite arrive en défilant : chargementInfini() de app.js.
  let infini = null;
  async function charger() {
    const etat = document.querySelector('[data-etat]');
    const liste = document.querySelector('[data-notifications]');
    if (!infini) infini = chargementInfini(liste, () => page(), { fin: 'Tu as vu toutes tes notifications.' });
    etat.hidden = true;
    infini.reprendre(false);
    const fini = liste.children.length ? () => {} : chargement(liste, 3); // squelettes au premier chargement seulement
    try {
      const encore = await page({ remplacer: true });
      fini();
      infini.reprendre(encore);
      etat.hidden = liste.children.length > 0;
      etat.replaceChildren(etatVide('calme', 'Tout est calme', 'Tu seras prévenu ici d\'un j\'aime, d\'un message, d\'une invitation en équipe ou d\'une proposition.'));
    } catch (erreur) {
      fini();
      etat.hidden = false;
      etat.replaceChildren(etatVide('calme', 'Les notifications ne chargent pas', erreur.message));
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const moi = await utilisateurConnecte();
    if (!moi) {
      window.location.href = '/connexion?suite=/notifications';
      return;
    }
    document.querySelector('[data-tout-lire]').addEventListener('click', async () => {
      try {
        await api('/notifications/lues', { methode: 'POST', donnees: {} });
        toast('Tout est marqué comme lu.');
        charger();
      } catch (erreur) {
        toast(erreur.message, 'erreur');
      }
    });
    charger();
  });
})();
