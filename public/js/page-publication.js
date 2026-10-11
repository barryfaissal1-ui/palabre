// Page publique d'une publication : palabre.dev/publication/12. C'est l'adresse qu'on partage.
// Lisible sans compte : un visiteur voit tout (auteur, texte, image ou vidéo, compteurs, 3 derniers commentaires)
// et, dans la carte, « Rejoindre Palabre pour réagir », « Voir le profil d'Awa » et « J'ai déjà un compte » ;
// un membre connecté a les vraies actions, comme dans le fil.
// La carte elle-même est celle du fil : cartePublication() de publication.js.
(function () {
  const { t, api, el, etatVide, utilisateurConnecte, cartePublication } = window.Palabre;
  const id = window.location.pathname.split('/')[2];

  async function afficher() {
    const zone = document.querySelector('[data-publication]');
    try {
      const [{ publication }, moi] = await Promise.all([api(`/publications/${encodeURIComponent(id)}`), utilisateurConnecte()]);
      zone.replaceChildren(...[
        cartePublication(publication, { visiteur: !moi, entiere: true }),
        moi ? el('a', { classe: 'bouton bouton-contour bouton-plein charger-plus', href: '/fil', texte: t('fil.voir-tout') }) : null,
      ].filter(Boolean));
    } catch (erreur) {
      const retour = el('a', { classe: 'bouton bouton-principal', href: '/', texte: t('publication.aller-accueil') });
      zone.replaceChildren(etatVide('calme', t('publication.introuvable'), erreur.statut === 404 ? t('publication.peut-etre-supprimee') : erreur.message, retour));
    }
  }

  document.addEventListener('DOMContentLoaded', afficher);
})();
