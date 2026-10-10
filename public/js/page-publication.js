// Page publique d'une publication : palabre.dev/publication/12. C'est l'adresse qu'on partage.
// Lisible sans compte : un visiteur voit tout (auteur, texte, image ou vidéo, compteurs, 3 derniers commentaires)
// et, dans la carte, « Rejoindre Palabre pour réagir », « Voir le profil d'Awa » et « J'ai déjà un compte » ;
// un membre connecté a les vraies actions, comme dans le fil.
// La carte elle-même est celle du fil : cartePublication() de publication.js.
(function () {
  const { api, el, etatVide, utilisateurConnecte, cartePublication } = window.Palabre;
  const id = window.location.pathname.split('/')[2];

  async function afficher() {
    const zone = document.querySelector('[data-publication]');
    try {
      const [{ publication }, moi] = await Promise.all([api(`/publications/${encodeURIComponent(id)}`), utilisateurConnecte()]);
      zone.replaceChildren(...[
        cartePublication(publication, { visiteur: !moi, entiere: true }),
        moi ? el('a', { classe: 'bouton bouton-contour bouton-plein charger-plus', href: '/fil', texte: 'Voir tout le fil' }) : null,
      ].filter(Boolean));
    } catch (erreur) {
      const retour = el('a', { classe: 'bouton bouton-principal', href: '/', texte: 'Aller à l\'accueil' });
      zone.replaceChildren(etatVide('calme', 'Publication introuvable', erreur.statut === 404 ? 'Elle a peut-être été supprimée.' : erreur.message, retour));
    }
  }

  document.addEventListener('DOMContentLoaded', afficher);
})();
