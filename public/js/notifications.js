// Page « Notifications » : les 30 dernières, les non lues mises en avant.
(function () {
  const { api, el, utilisateurConnecte, dateRelative, etatVide, chargement } = window.Palabre;

  // La cloche du menu suit le nombre de notifications non lues.
  function majCloche(nonLues) {
    document.querySelectorAll('.compteur-cloche, .compteur-notifications').forEach((pastille) => {
      if (nonLues) pastille.textContent = String(nonLues);
      else pastille.remove();
    });
    document.querySelector('[data-tout-lire]').hidden = nonLues === 0;
  }

  function ligne(notification) {
    // Le lien vient du serveur ; par prudence on n'accepte qu'une adresse interne au site.
    const interne = typeof notification.lien === 'string' && /^\/(?!\/)/.test(notification.lien);
    const lien = el('a', { classe: 'notification', href: interne ? notification.lien : '/notifications' }, [
      el('span', { classe: 'notification-texte', texte: notification.texte }),
      el('span', { classe: 'texte-discret', texte: dateRelative(notification.creeLe) }),
    ]);
    const element = el('li', { classe: notification.lue ? '' : 'non-lue' }, [lien]);
    if (!notification.lue) {
      lien.prepend(el('span', { classe: 'visuellement-cache', texte: 'Non lue : ' }));
      // On marque comme lue avant de suivre le lien.
      lien.addEventListener('click', async (evenement) => {
        evenement.preventDefault();
        await api('/notifications/lues', { methode: 'POST', donnees: { id: notification.id } }).catch(() => {});
        window.location.href = lien.href;
      });
    }
    return element;
  }

  async function charger() {
    const etat = document.querySelector('[data-etat]');
    const liste = document.querySelector('[data-notifications]');
    etat.hidden = true;
    const fini = liste.children.length ? () => {} : chargement(liste, 3); // squelettes au premier chargement seulement
    try {
      const { notifications, nonLues } = await api('/notifications');
      fini();
      liste.replaceChildren(...notifications.map(ligne));
      majCloche(nonLues);
      etat.hidden = notifications.length > 0;
      etat.replaceChildren(etatVide('calme', 'Tout est calme', 'Tu seras prévenu ici d\'une demande d\'ami, d\'une invitation en équipe ou d\'une proposition.'));
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
      await api('/notifications/lues', { methode: 'POST', donnees: {} });
      charger();
    });
    charger();
  });
})();
