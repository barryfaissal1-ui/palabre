// Page « Combien coûte mon projet ? » : quatre questions, une par écran, puis une fourchette de prix.
// Les questions sont construites à partir de la grille (grille-prix.js) : modifier la grille suffit.
// Le calcul se fait ici, dans le navigateur, sans rien envoyer au serveur.
(function () {
  const { t, el, fcfa, utilisateurConnecte } = window.Palabre;
  // Les libellés de la grille (grille-prix.js les écrit en français) : traduits par leur identifiant,
  // clé « calcul.<famille>.<id>.<nom | aide | unite> ». Sans traduction, on garde le texte de la grille.
  const libelle = (famille, element, champ) => {
    const cle = `calcul.${famille}.${element.id}.${champ}`;
    const traduit = t(cle);
    return traduit === cle ? element[champ] : traduit;
  };
  const GRILLE = window.GRILLE_PRIX;
  const { estimerPrix } = window;

  const NB_ETAPES = 4;
  let etape = 1; // 1 à 4 : les questions ; 5 : le résultat
  let moi = null;

  const formulaire = document.querySelector('[data-calculateur]');
  const resultat = document.querySelector('[data-resultat]');

  const pourcent = (p) => `+${p} %`;
  const typeChoisi = () => GRILLE.types.find((t) => t.id === formulaire.elements.type.value);
  const unite = () => (typeChoisi() ? libelle('types', typeChoisi(), 'unite') : t('calcul.pages-ou-ecrans'));

  // Une carte à choisir : bouton radio (un seul choix) ou case à cocher (plusieurs).
  function carte(genre, nom, element, titre, aide, prix, coche) {
    const id = `${nom}-${element.id}`;
    return [
      el('input', { type: genre, name: nom, id, value: element.id, checked: coche }),
      el('label', { for: id }, [
        el('strong', { texte: titre }),
        aide ? el('span', { texte: aide }) : null,
        prix ? el('span', { classe: 'prix-carte', texte: prix }) : null,
      ]),
    ];
  }

  function ecran(numero, question, aide, cartes) {
    return el('fieldset', { classe: 'etape', 'data-etape': String(numero), hidden: numero !== 1 }, [
      el('legend', { tabindex: '-1', texte: question }),
      aide ? el('p', { classe: 'texte-discret', texte: aide }) : null,
      el('div', { classe: 'choix-cartes' }, cartes),
    ]);
  }

  function construire() {
    const erreur = el('p', { classe: 'erreur-champ', role: 'alert', 'data-erreur-etape': true });
    const retour = el('button', { classe: 'bouton bouton-contour', type: 'button', texte: t('commun.retour'), hidden: true, 'data-retour': true });
    const suivant = el('button', { classe: 'bouton bouton-principal', type: 'submit', texte: t('commun.continuer'), 'data-suivant': true });

    formulaire.replaceChildren(
      ecran(1, t('calcul.quel-type'), null, GRILLE.types.flatMap((type) => carte('radio', 'type', type, libelle('types', type, 'nom'), libelle('types', type, 'aide'), t('calcul.fourchette', { min: fcfa(type.min).replace(' FCFA', ''), max: fcfa(type.max) }), false))),
      ecran(2, t('calcul.quelle-taille'), t('calcul.taille-aide'), GRILLE.tailles.flatMap((taille, i) => carte('radio', 'taille', taille, libelle('tailles', taille, 'nom'), null, taille.pourcentage ? pourcent(taille.pourcentage) : t('calcul.prix-de-base-majuscule'), i === 0))),
      ecran(3, t('calcul.quelles-options'), t('calcul.options-aide'), GRILLE.options.flatMap((o) => carte('checkbox', 'options', o, libelle('options', o, 'nom'), libelle('options', o, 'aide'), `+ ${fcfa(o.prix)}`, false))),
      ecran(4, t('calcul.pour-quand'), null, GRILLE.delais.flatMap((d, i) => carte('radio', 'delai', d, libelle('delais', d, 'nom'), libelle('delais', d, 'aide'), d.pourcentage ? t('calcul.sur-le-total', { pourcent: pourcent(d.pourcentage) }) : t('calcul.sans-supplement'), i === 0))),
      erreur,
      el('div', { classe: 'actions-etape' }, [retour, suivant]),
    );

    retour.addEventListener('click', () => aller(etape - 1));
    formulaire.addEventListener('submit', (evenement) => {
      evenement.preventDefault();
      if (etape === 1 && !formulaire.elements.type.value) {
        erreur.textContent = t('calcul.choisis-type');
        return;
      }
      aller(etape + 1);
    });
    // Dès qu'un type est choisi, l'étape 2 parle de « pages » ou d'« écrans » selon le projet.
    formulaire.addEventListener('change', () => {
      erreur.textContent = '';
      formulaire.querySelectorAll('[name="taille"] + label strong').forEach((titre, i) => {
        titre.textContent = `${GRILLE.tailles[i].nom} ${unite()}`;
      });
    });
    formulaire.dispatchEvent(new Event('change'));
  }

  function aller(numero) {
    etape = Math.max(1, Math.min(numero, NB_ETAPES + 1));
    const fini = etape > NB_ETAPES;
    formulaire.hidden = fini;
    resultat.hidden = !fini;
    document.querySelector('[data-progression]').hidden = fini;
    formulaire.querySelector('[data-erreur-etape]').textContent = '';

    if (fini) {
      afficherResultat();
    } else {
      formulaire.querySelectorAll('.etape').forEach((e) => { e.hidden = Number(e.dataset.etape) !== etape; });
      formulaire.querySelector('[data-retour]').hidden = etape === 1;
      formulaire.querySelector('[data-suivant]').textContent = etape === NB_ETAPES ? t('calcul.voir-estimation') : t('commun.continuer');
      document.querySelector('[data-barre]').value = etape;
      document.querySelector('[data-texte-progression]').textContent = t('calcul.etape', { n: etape, total: NB_ETAPES });
    }
    // Le titre de l'écran reçoit le focus : les lecteurs d'écran annoncent la nouvelle question.
    const titre = fini ? resultat.querySelector('h2') : formulaire.querySelector(`.etape[data-etape="${etape}"] legend`);
    window.scrollTo(0, 0);
    titre.focus({ preventScroll: true });
  }

  function afficherResultat() {
    const estimation = estimerPrix(GRILLE, {
      type: formulaire.elements.type.value,
      taille: formulaire.elements.taille.value,
      options: [...formulaire.querySelectorAll('[name="options"]:checked')].map((c) => c.value),
      delai: formulaire.elements.delai.value,
    });
    const { type, taille, options, delai, min, max, milieu } = estimation;
    const ligne = (libelle, valeur) => el('div', {}, [el('dt', { texte: libelle }), el('dd', { texte: valeur })]);

    // Adresse du formulaire de demande, avec la catégorie et le budget déjà remplis.
    const versDemande = `/demandes?${new URLSearchParams({ publier: '1', categorie: type.categorie, budget: milieu })}`;
    // Sans compte : on passe d'abord par l'inscription « client », qui ramène ensuite au formulaire.
    const adressePublier = moi ? versDemande : `/inscription?${new URLSearchParams({ type: 'client', suite: versDemande })}`;
    const texteWhatsApp = t('calcul.whatsapp', { type: libelle('types', type, 'nom').toLowerCase(), min: fcfa(min).replace(' FCFA', ''), max: fcfa(max), lien: `${window.location.origin}/calculateur` });

    const recommencer = el('button', { classe: 'bouton bouton-lien', type: 'button', texte: t('calcul.modifier-reponses') });
    recommencer.addEventListener('click', () => aller(1));

    resultat.replaceChildren(
      el('h2', { tabindex: '-1', texte: t('calcul.ton-estimation') }),
      el('p', { classe: 'fourchette' }, [
        t('calcul.entre'), el('strong', { texte: fcfa(min).replace(' FCFA', '') }), t('calcul.et'), el('strong', { texte: fcfa(max) }),
      ]),
      el('p', { classe: 'message', texte: t('calcul.avertissement') }),
      el('h3', { texte: t('calcul.detail') }),
      el('dl', { classe: 'detail-calcul' }, [
        ligne(libelle('types', type, 'nom'), t('calcul.fourchette', { min: fcfa(type.min).replace(' FCFA', ''), max: fcfa(type.max) })),
        ligne(`${libelle('tailles', taille, 'nom')} ${libelle('types', type, 'unite')}`, taille.pourcentage ? pourcent(taille.pourcentage) : t('calcul.prix-de-base')),
        ...options.map((o) => ligne(libelle('options', o, 'nom'), `+ ${fcfa(o.prix)}`)),
        delai.pourcentage ? ligne(t('calcul.delai-nom', { nom: libelle('delais', delai, 'nom').toLowerCase() }), t('calcul.sur-le-total', { pourcent: pourcent(delai.pourcentage) })) : null,
        ligne(t('calcul.total-arrondi'), t('calcul.fourchette', { min: fcfa(min).replace(' FCFA', ''), max: fcfa(max) })),
      ]),
      el('div', { classe: 'actions-resultat' }, [
        el('a', { classe: 'bouton bouton-principal bouton-plein', href: adressePublier, texte: t('calcul.publier') }),
        el('a', { classe: 'bouton bouton-contour bouton-plein', href: `https://wa.me/?text=${encodeURIComponent(texteWhatsApp)}`, target: '_blank', rel: 'noopener', texte: t('calcul.partager-whatsapp') }),
        recommencer,
      ]),
      el('p', { classe: 'texte-discret', texte: moi
        ? t('calcul.budget-propose-membre', { budget: fcfa(milieu) })
        : t('calcul.budget-propose-visiteur', { budget: fcfa(milieu) }) }),
    );
  }

  document.addEventListener('DOMContentLoaded', () => {
    construire();
    // Savoir si la personne est connectée ne sert qu'au bouton « Publier » : le calcul n'attend pas la réponse.
    utilisateurConnecte().then((utilisateur) => {
      moi = utilisateur;
      if (etape > NB_ETAPES) afficherResultat();
    });
  });
})();
