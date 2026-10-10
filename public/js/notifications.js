// Page « Notifications » : par 10, les suivantes en défilant ; les non lues mises en avant.
(function () {
  const { api, el, utilisateurConnecte, dateRelative, etatVide, chargement, chargementInfini } = window.Palabre;

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

  // Demande une page de notifications. Répond true s'il en reste. « remplacer » : on repart du début.
  let suivant = null;
  async function page({ remplacer = false } = {}) {
    const liste = document.querySelector('[data-notifications]');
    const { notifications, nonLues, suivant: prochain } = await api(`/notifications${!remplacer && suivant ? `?avant=${suivant}` : ''}`);
    if (remplacer) liste.replaceChildren();
    liste.append(...notifications.map(ligne));
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
