// Notifications push, côté navigateur : activer ou couper sur CET appareil, l'encadré du fil, les réglages.
// Le chiffrement et l'envoi sont côté serveur (src/utils/push.js) ; l'affichage est dans public/sw.js.
//
// Règle : la permission n'est JAMAIS demandée au chargement d'une page. Elle l'est seulement quand la personne
// touche « Activer » (un navigateur qui reçoit la question trop tôt la refuse, et un refus est définitif).
(function () {
  const { api, el, icone, toast, utilisateurConnecte } = window.Palabre;
  const CLE_PROPOSE = 'palabre-push-propose';
  const FAMILLES = [
    ['messages', 'Messages'],
    ['demandes', 'Demandes, propositions et avis'],
    ['equipes', 'Équipes éclair'],
    ['social', 'J\'aime, commentaires et amis'],
    ['defis', 'Défi de la semaine'],
  ];
  const surIphone = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const installee = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const capable = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  // La clé publique du site arrive en texte ; le navigateur la veut en octets.
  const enOctets = (texte) => Uint8Array.from(atob(texte.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  // Le service worker est enregistré au chargement de la page (app.js) : on l'attend, mais pas indéfiniment.
  const serviceWorker = () => Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, refus) => setTimeout(() => refus(new Error('Le site n\'est pas encore prêt pour les notifications. Recharge la page et réessaie.')), 5000)),
  ]);
  const abonnementActuel = async () => (await serviceWorker()).pushManager.getSubscription();

  let reponseServeur = null; // { actif, clePublique, preferences } : demandé une fois par page
  const infos = () => { reponseServeur = reponseServeur || api('/notifications/push'); return reponseServeur; };

  // Où en est cet appareil : 'eteint' (le site n'a pas de clés), 'iphone' (à installer d'abord), 'indisponible',
  // 'refuse' (bloqué dans le navigateur), 'actif' ou 'inactif'.
  async function etat() {
    if (!(await infos()).actif) return 'eteint';
    if (!capable) return surIphone && !installee ? 'iphone' : 'indisponible';
    if (Notification.permission === 'denied') return 'refuse';
    try {
      return Notification.permission === 'granted' && (await abonnementActuel()) ? 'actif' : 'inactif';
    } catch {
      return 'inactif';
    }
  }

  function nomAppareil() {
    const ua = navigator.userAgent;
    const systeme = /Android/.test(ua) ? 'Android' : surIphone ? 'iPhone' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : 'Autre';
    const navigateur = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'navigateur';
    return `${navigateur} sur ${systeme}`;
  }

  // À appeler depuis un clic seulement : c'est ici que le navigateur pose sa question.
  async function activer() {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      throw new Error(permission === 'denied' ? 'Notifications refusées. Tu peux les autoriser plus tard dans les réglages de ton navigateur.' : 'Notifications non activées.');
    }
    const enregistrement = await serviceWorker();
    const options = { userVisibleOnly: true, applicationServerKey: enOctets((await infos()).clePublique) };
    let abonnement = await enregistrement.pushManager.getSubscription();
    if (!abonnement) {
      abonnement = await enregistrement.pushManager.subscribe(options);
    }
    const { endpoint, keys: cles } = abonnement.toJSON();
    await api('/notifications/push', { methode: 'POST', donnees: { endpoint, cles, appareil: nomAppareil() } });
  }

  // Couper sur cet appareil : le serveur oublie l'abonnement, puis le navigateur aussi.
  async function couper() {
    if (!capable) return;
    const abonnement = await abonnementActuel().catch(() => null);
    if (!abonnement) return;
    await api('/notifications/push', { methode: 'DELETE', donnees: { endpoint: abonnement.endpoint } }).catch(() => {});
    await abonnement.unsubscribe().catch(() => {});
  }

  // ---------- L'encadré du fil : proposé une fois, après la première connexion ----------
  async function encadre(zone, moi) {
    let dejaVu = null;
    try { dejaVu = localStorage.getItem(CLE_PROPOSE); } catch { /* navigation privée : on le proposera à chaque visite */ }
    if (dejaVu) return;
    const situation = await etat().catch(() => 'eteint');
    if (situation !== 'inactif' && situation !== 'iphone') return;
    const ranger = () => {
      try { localStorage.setItem(CLE_PROPOSE, '1'); } catch { /* tant pis */ }
      zone.hidden = true;
    };
    const plusTard = el('button', { classe: 'bouton bouton-lien', type: 'button', texte: situation === 'iphone' ? 'Compris' : 'Plus tard' });
    plusTard.addEventListener('click', ranger);
    const boutons = [plusTard];
    let texte = 'Ajoute Palabre à l\'écran d\'accueil pour recevoir les notifications : bouton Partager, puis « Sur l\'écran d\'accueil ».';
    if (situation === 'inactif') {
      texte = moi.type === 'client'
        ? 'Active les notifications pour savoir quand un développeur te répond.'
        : 'Active les notifications pour savoir quand un client t\'écrit.';
      const bouton = el('button', { classe: 'bouton bouton-principal', type: 'button', texte: 'Activer' });
      bouton.addEventListener('click', async () => {
        bouton.disabled = true;
        try {
          await activer();
          toast('Notifications activées sur cet appareil.');
        } catch (erreur) {
          toast(erreur.message, 'erreur');
        }
        ranger(); // activé ou refusé, on ne repose pas la question ici ; elle reste dans les réglages du profil
      });
      boutons.unshift(bouton);
    }
    zone.className = 'bloc-fil encadre-push';
    zone.replaceChildren(
      el('span', { classe: 'encadre-push-icone' }, [icone('cloche')]),
      el('p', { classe: 'encadre-push-texte', texte }),
      el('div', { classe: 'encadre-push-boutons' }, boutons),
    );
    zone.hidden = false;
  }

  // ---------- Les réglages (page « Modifier mon profil ») ----------
  const EXPLICATIONS = {
    eteint: 'Les notifications sur le téléphone ne sont pas encore en service sur ce site.',
    indisponible: 'Ce navigateur ne sait pas recevoir de notifications.',
    iphone: 'Sur iPhone, ajoute d\'abord Palabre à l\'écran d\'accueil (bouton Partager, puis « Sur l\'écran d\'accueil »), et ouvre Palabre depuis cette icône.',
    refuse: 'Les notifications sont bloquées pour Palabre dans ce navigateur. Autorise-les dans ses réglages (le cadenas à côté de l\'adresse), puis reviens ici.',
    inactif: 'Reçois un signal sur cet appareil, même quand Palabre est fermé.',
    actif: 'Activées sur cet appareil.',
  };
  async function reglages(zone) {
    const { preferences } = await infos();
    const texteEtat = el('p', { classe: 'aide', role: 'status' });
    const bouton = el('button', { classe: 'bouton bouton-contour', type: 'button', hidden: true });
    const familles = el('fieldset', { classe: 'familles-push' }, [el('legend', { texte: 'Ce que je reçois sur mes appareils' })]);

    async function afficher() {
      const situation = await etat().catch(() => 'eteint');
      texteEtat.textContent = EXPLICATIONS[situation];
      bouton.hidden = !['actif', 'inactif'].includes(situation);
      bouton.textContent = situation === 'actif' ? 'Couper sur cet appareil' : 'Activer sur cet appareil';
      bouton.dataset.situation = situation;
      familles.hidden = situation === 'eteint';
    }
    bouton.addEventListener('click', async () => {
      bouton.disabled = true;
      try {
        if (bouton.dataset.situation === 'actif') {
          await couper();
          toast('Notifications coupées sur cet appareil.');
        } else {
          await activer();
          toast('Notifications activées sur cet appareil.');
        }
      } catch (erreur) {
        toast(erreur.message, 'erreur');
      }
      bouton.disabled = false;
      afficher();
    });

    const cases = {};
    FAMILLES.forEach(([cle, nom]) => {
      const coche = el('input', { type: 'checkbox', name: `push-${cle}` });
      coche.checked = preferences[cle] !== false;
      cases[cle] = coche;
      coche.addEventListener('change', async () => {
        try {
          await api('/notifications/push/preferences', { methode: 'PUT', donnees: Object.fromEntries(FAMILLES.map(([c]) => [c, cases[c].checked])) });
          toast('Réglage enregistré.');
        } catch (erreur) {
          coche.checked = !coche.checked; // le serveur a refusé : la case revient comme avant
          toast(erreur.message, 'erreur');
        }
      });
      familles.append(el('label', { classe: 'interrupteur' }, [coche, el('span', { classe: 'interrupteur-piste', 'aria-hidden': 'true' }), el('span', { texte: nom })]));
    });

    zone.replaceChildren(
      el('h2', { texte: 'Notifications' }),
      el('p', { classe: 'aide', texte: 'La cloche du site garde toujours tout. Ici, tu règles ce qui arrive sur tes appareils.' }),
      el('div', { classe: 'etat-push' }, [texteEtat, bouton]),
      familles,
    );
    zone.hidden = false;
    await afficher();
  }

  window.Palabre.push = { etat, activer, couper };

  document.addEventListener('DOMContentLoaded', async () => {
    const zoneEncadre = document.querySelector('[data-encadre-push]');
    const zoneReglages = document.querySelector('[data-reglages-push]');
    if (!zoneEncadre && !zoneReglages) return;
    const moi = await utilisateurConnecte();
    if (!moi) return;
    // Les deux sont des « plus » : une erreur ici ne doit jamais gêner le fil ni le profil.
    if (zoneEncadre) encadre(zoneEncadre, moi).catch(() => {});
    if (zoneReglages) reglages(zoneReglages).catch(() => {});
  });
})();
