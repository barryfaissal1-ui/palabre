// Notifications push, côté navigateur : activer ou couper sur CET appareil, l'encadré du fil, les réglages.
// Le chiffrement et l'envoi sont côté serveur (src/utils/push.js) ; l'affichage est dans public/sw.js.
//
// Règle : la permission n'est JAMAIS demandée au chargement d'une page. Elle l'est seulement quand la personne
// touche « Activer » (un navigateur qui reçoit la question trop tôt la refuse, et un refus est définitif).
(function () {
  const { t, api, el, icone, toast, utilisateurConnecte, couperPush } = window.Palabre;
  const CLE_PROPOSE = 'palabre-push-propose';
  const FAMILLES = [
    ['messages', t('nav.messages')],
    ['demandes', t('push.famille.demandes')],
    ['equipes', t('push.famille.equipes')],
    ['social', t('push.famille.social')],
    ['defis', t('nav.defi')],
  ];
  const surIphone = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const installee = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const capable = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  // La clé publique du site arrive en texte ; le navigateur la veut en octets.
  const enOctets = (texte) => Uint8Array.from(atob(texte.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  // Le service worker est enregistré au chargement de la page (app.js) : on l'attend, mais pas indéfiniment.
  const serviceWorker = () => Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, refus) => setTimeout(() => refus(new Error(t('push.pas-pret'))), 5000)),
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
    const systeme = /Android/.test(ua) ? 'Android' : surIphone ? 'iPhone' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : t('specialite.autre');
    const navigateur = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : t('push.navigateur');
    return t('push.appareil', { navigateur, systeme });
  }

  // À appeler depuis un clic seulement : c'est ici que le navigateur pose sa question.
  async function activer() {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      throw new Error(permission === 'denied' ? t('push.refusees') : t('push.non-activees'));
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

  // Couper sur cet appareil : le serveur oublie l'abonnement, puis le navigateur aussi (couperPush() de app.js).
  const couper = couperPush;

  // Quand une session est fermée de force (mot de passe changé, « Déconnecter les autres appareils »), le serveur
  // retire TOUS les abonnements du membre : il ne sait pas lequel appartient à quel appareil. Un appareil encore
  // connecté, où le push est déjà autorisé, redonne donc le sien : aucune question n'est posée (la permission est
  // déjà là). Une fois par session du navigateur, sauf « force » (juste après une de ces actions).
  const CLE_SYNCHRO = 'palabre-push-synchro';
  async function resynchroniser(moi, force = false) {
    if (!capable || Notification.permission !== 'granted') return;
    try { if (!force && sessionStorage.getItem(CLE_SYNCHRO) === String(moi.id)) return; } catch { /* navigation privée */ }
    if (!(await infos()).actif) return;
    const abonnement = await abonnementActuel();
    if (!abonnement) return;
    const { endpoint, keys: cles } = abonnement.toJSON();
    await api('/notifications/push', { methode: 'POST', donnees: { endpoint, cles, appareil: nomAppareil() } });
    try { sessionStorage.setItem(CLE_SYNCHRO, String(moi.id)); } catch { /* tant pis */ }
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
    const plusTard = el('button', { classe: 'bouton bouton-lien', type: 'button', texte: situation === 'iphone' ? t('push.compris') : t('push.plus-tard') });
    plusTard.addEventListener('click', ranger);
    const boutons = [plusTard];
    let texte = t('push.ajoute-ecran');
    if (situation === 'inactif') {
      texte = moi.type === 'client'
        ? t('push.active-client')
        : t('push.active-dev');
      const bouton = el('button', { classe: 'bouton bouton-principal', type: 'button', texte: t('push.activer') });
      bouton.addEventListener('click', async () => {
        bouton.disabled = true;
        try {
          await activer();
          toast(t('push.activees'));
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
    eteint: t('push.etat.eteint'),
    indisponible: t('push.etat.indisponible'),
    iphone: t('push.etat.iphone'),
    refuse: t('push.etat.refuse'),
    inactif: t('push.etat.inactif'),
    actif: t('push.etat.actif'),
  };
  async function reglages(zone) {
    const { preferences } = await infos();
    const texteEtat = el('p', { classe: 'aide', role: 'status' });
    const bouton = el('button', { classe: 'bouton bouton-contour', type: 'button', hidden: true });
    const familles = el('fieldset', { classe: 'familles-push' }, [el('legend', { texte: t('push.ce-que-je-recois') })]);

    async function afficher() {
      const situation = await etat().catch(() => 'eteint');
      texteEtat.textContent = EXPLICATIONS[situation];
      bouton.hidden = !['actif', 'inactif'].includes(situation);
      bouton.textContent = situation === 'actif' ? t('push.couper-ici') : t('push.activer-ici');
      bouton.dataset.situation = situation;
      familles.hidden = situation === 'eteint';
    }
    bouton.addEventListener('click', async () => {
      bouton.disabled = true;
      try {
        if (bouton.dataset.situation === 'actif') {
          await couper();
          toast(t('push.coupees'));
        } else {
          await activer();
          toast(t('push.activees'));
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
          toast(t('push.reglage-enregistre'));
        } catch (erreur) {
          coche.checked = !coche.checked; // le serveur a refusé : la case revient comme avant
          toast(erreur.message, 'erreur');
        }
      });
      familles.append(el('label', { classe: 'interrupteur' }, [coche, el('span', { classe: 'interrupteur-piste', 'aria-hidden': 'true' }), el('span', { texte: nom })]));
    });

    zone.replaceChildren(
      el('h2', { texte: t('nav.notifications') }),
      el('p', { classe: 'aide', texte: t('push.cloche-garde-tout') }),
      el('div', { classe: 'etat-push' }, [texteEtat, bouton]),
      familles,
    );
    zone.hidden = false;
    await afficher();
  }

  window.Palabre.push = { etat, activer, couper, resynchroniser };

  document.addEventListener('DOMContentLoaded', async () => {
    const zoneEncadre = document.querySelector('[data-encadre-push]');
    const zoneReglages = document.querySelector('[data-reglages-push]');
    if (!zoneEncadre && !zoneReglages) return;
    const moi = await utilisateurConnecte();
    if (!moi) return;
    resynchroniser(moi).catch(() => {});
    // Les deux sont des « plus » : une erreur ici ne doit jamais gêner le fil ni le profil.
    if (zoneEncadre) encadre(zoneEncadre, moi).catch(() => {});
    if (zoneReglages) reglages(zoneReglages).catch(() => {});
  });
})();
