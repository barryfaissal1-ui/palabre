// Page /recherche?q=… : chercher dans les publications (et, en haut, les membres dont le nom correspond).
// Les résultats viennent de GET /api/publications/recherche : les questions résolues d'abord, puis les plus récentes,
// chargés 10 par 10 en défilant (filPublications() de publication.js, le même fil que /fil).
(function () {
  const { t, api, el, avatar, nomMembre, lieuDe, utilisateurConnecte, etatVide, filPublications } = window.Palabre;
  let q = '';
  let type = '';

  // L'adresse suit la recherche : on peut la copier, la partager, ou revenir en arrière.
  function ecrireAdresse() {
    const requete = new URLSearchParams();
    if (q) requete.set('q', q);
    if (type) requete.set('type', type);
    window.history.replaceState(null, '', `/recherche${requete.size ? `?${requete}` : ''}`);
    document.title = q ? t('titre.recherche-de', { q }) : t('titre.recherche');
  }

  // Les membres dont le nom contient le texte : trois au plus, la recherche complète est sur /chercher.
  async function afficherMembres() {
    const section = document.querySelector('[data-membres]');
    const demande = q;
    section.hidden = true;
    if (q.length < 2) return;
    try {
      const { devs } = await api(`/devs?q=${encodeURIComponent(q)}`);
      if (demande !== q || devs.length === 0) return;
      section.querySelector('[data-liste-membres]').replaceChildren(...devs.slice(0, 3).map((membre) => el('li', {}, [
        el('a', { classe: 'resultat-membre', href: `/${membre.identifiant}` }, [
          avatar(membre, 'moyen'),
          el('span', { classe: 'resultat-texte' }, [
            nomMembre(membre, { lien: false }),
            el('span', { classe: 'texte-discret', texte: [membre.type === 'client' ? t('commun.client') : null, lieuDe(membre)].filter(Boolean).join(', ') }),
          ]),
        ]),
      ])));
      section.hidden = false;
    } catch { /* les membres sont un plus : sans eux, les publications restent là */ }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const moi = await utilisateurConnecte();
    if (!moi) {
      window.location.href = `/connexion?suite=${encodeURIComponent(window.location.pathname + window.location.search)}`;
      return;
    }
    const formulaire = document.querySelector('[data-recherche]');
    const champ = formulaire.elements.q;
    const puces = formulaire.querySelectorAll('[data-type]');
    const etat = document.querySelector('[data-etat-fil]');
    const zone = document.querySelector('[data-fil]');
    const titre = document.querySelector('[data-titre-publications]');
    const depart = new URLSearchParams(window.location.search);
    q = (depart.get('q') || '').trim().slice(0, 100);
    type = [...puces].some((puce) => puce.dataset.type === depart.get('type')) ? depart.get('type') : '';
    champ.value = q;
    puces.forEach((puce) => puce.setAttribute('aria-pressed', String(puce.dataset.type === type)));

    const fil = filPublications({
      zone,
      etat,
      boutonPlus: document.querySelector('[data-charger-plus]'),
      chemin: '/publications/recherche',
      cleSuite: 'apres',
      parametres: () => (type ? { q, type } : { q }),
      vide: () => etatVide('recherche', t('recherche.rien'), type ? t('recherche.rien-type') : t('recherche.rien-aide')),
      fin: t('recherche.tout-vu'),
    });

    function lancer() {
      ecrireAdresse();
      // Moins de 2 lettres : on n'interroge pas le serveur, on dit quoi faire.
      if (q.length < 2) {
        zone.replaceChildren();
        titre.hidden = true;
        document.querySelector('[data-membres]').hidden = true;
        etat.replaceChildren(etatVide('recherche', t('recherche.invite'), t('recherche.invite-aide')));
        etat.hidden = false;
        return;
      }
      titre.hidden = false;
      afficherMembres();
      fil.charger();
    }

    formulaire.addEventListener('submit', (evenement) => {
      evenement.preventDefault();
      q = champ.value.trim();
      champ.blur(); // sur téléphone, le clavier se referme et laisse voir les résultats
      lancer();
    });
    puces.forEach((puce) => puce.addEventListener('click', () => {
      if (type === puce.dataset.type) return;
      type = puce.dataset.type;
      q = champ.value.trim();
      puces.forEach((p) => p.setAttribute('aria-pressed', String(p === puce)));
      lancer();
    }));
    lancer();
    if (!q) champ.focus();
  });
})();
