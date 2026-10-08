// Page « Combien coûte mon projet ? » : quatre questions, une par écran, puis une fourchette de prix.
// Les questions sont construites à partir de la grille (grille-prix.js) : modifier la grille suffit.
// Le calcul se fait ici, dans le navigateur, sans rien envoyer au serveur.
(function () {
  const { el, fcfa, utilisateurConnecte } = window.Palabre;
  const GRILLE = window.GRILLE_PRIX;
  const { estimerPrix } = window;

  const NB_ETAPES = 4;
  let etape = 1; // 1 à 4 : les questions ; 5 : le résultat
  let moi = null;

  const formulaire = document.querySelector('[data-calculateur]');
  const resultat = document.querySelector('[data-resultat]');

  const pourcent = (p) => `+${p} %`;
  const typeChoisi = () => GRILLE.types.find((t) => t.id === formulaire.elements.type.value);
  const unite = () => (typeChoisi() ? typeChoisi().unite : 'pages ou écrans');

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
    const retour = el('button', { classe: 'bouton bouton-contour', type: 'button', texte: 'Retour', hidden: true, 'data-retour': true });
    const suivant = el('button', { classe: 'bouton bouton-principal', type: 'submit', texte: 'Continuer', 'data-suivant': true });

    formulaire.replaceChildren(
      ecran(1, 'Quel type de projet ?', null, GRILLE.types.flatMap((t) => carte('radio', 'type', t, t.nom, t.aide, `${fcfa(t.min).replace(' FCFA', '')} à ${fcfa(t.max)}`, false))),
      ecran(2, 'Quelle taille ?', 'Compte les pages d\'un site, ou les écrans d\'une application.', GRILLE.tailles.flatMap((t, i) => carte('radio', 'taille', t, t.nom, null, t.pourcentage ? pourcent(t.pourcentage) : 'Prix de base', i === 0))),
      ecran(3, 'Quelles options ?', 'Coche ce dont tu as besoin. Tu peux aussi ne rien cocher.', GRILLE.options.flatMap((o) => carte('checkbox', 'options', o, o.nom, o.aide, `+ ${fcfa(o.prix)}`, false))),
      ecran(4, 'Pour quand ?', null, GRILLE.delais.flatMap((d, i) => carte('radio', 'delai', d, d.nom, d.aide, d.pourcentage ? `${pourcent(d.pourcentage)} sur le total` : 'Sans supplément', i === 0))),
      erreur,
      el('div', { classe: 'actions-etape' }, [retour, suivant]),
    );

    retour.addEventListener('click', () => aller(etape - 1));
    formulaire.addEventListener('submit', (evenement) => {
      evenement.preventDefault();
      if (etape === 1 && !formulaire.elements.type.value) {
        erreur.textContent = 'Choisis un type de projet pour continuer.';
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
      formulaire.querySelector('[data-suivant]').textContent = etape === NB_ETAPES ? 'Voir l\'estimation' : 'Continuer';
      document.querySelector('[data-barre]').value = etape;
      document.querySelector('[data-texte-progression]').textContent = `Étape ${etape} sur ${NB_ETAPES}`;
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
    const texteWhatsApp = `D'après le calculateur de Palabre, mon projet (${type.nom.toLowerCase()}) coûterait entre ${fcfa(min).replace(' FCFA', '')} et ${fcfa(max)}. Fais ton estimation : ${window.location.origin}/calculateur`;

    const recommencer = el('button', { classe: 'bouton bouton-lien', type: 'button', texte: 'Modifier mes réponses' });
    recommencer.addEventListener('click', () => aller(1));

    resultat.replaceChildren(
      el('h2', { tabindex: '-1', texte: 'Ton estimation' }),
      el('p', { classe: 'fourchette' }, [
        'Entre ', el('strong', { texte: fcfa(min).replace(' FCFA', '') }), ' et ', el('strong', { texte: fcfa(max) }),
      ]),
      el('p', { classe: 'message', texte: 'C\'est une estimation. Le vrai prix se fixe avec le développeur, selon ce que tu veux exactement.' }),
      el('h3', { texte: 'Détail du calcul' }),
      el('dl', { classe: 'detail-calcul' }, [
        ligne(type.nom, `${fcfa(type.min).replace(' FCFA', '')} à ${fcfa(type.max)}`),
        ligne(`${taille.nom} ${type.unite}`, taille.pourcentage ? pourcent(taille.pourcentage) : 'prix de base'),
        ...options.map((o) => ligne(o.nom, `+ ${fcfa(o.prix)}`)),
        delai.pourcentage ? ligne(`Délai ${delai.nom.toLowerCase()}`, `${pourcent(delai.pourcentage)} sur le total`) : null,
        ligne('Total arrondi', `${fcfa(min).replace(' FCFA', '')} à ${fcfa(max)}`),
      ]),
      el('div', { classe: 'actions-resultat' }, [
        el('a', { classe: 'bouton bouton-principal bouton-plein', href: adressePublier, texte: 'Publier ma demande avec ce budget' }),
        el('a', { classe: 'bouton bouton-contour bouton-plein', href: `https://wa.me/?text=${encodeURIComponent(texteWhatsApp)}`, target: '_blank', rel: 'noopener', texte: 'Partager sur WhatsApp' }),
        recommencer,
      ]),
      el('p', { classe: 'texte-discret', texte: moi
        ? `Budget proposé dans la demande : ${fcfa(milieu)} (le milieu de la fourchette). Tu pourras le modifier.`
        : `Tu créeras d'abord ton compte client (gratuit). Budget proposé : ${fcfa(milieu)}, le milieu de la fourchette.` }),
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
