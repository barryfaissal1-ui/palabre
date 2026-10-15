// Service worker : met en cache les fichiers de l'interface pour un chargement rapide, même en 3G.
// Les données (/api) ne sont jamais mises en cache.
const VERSION = 'palabre-v58';
const FICHIERS = [
  '/',
  '/connexion',
  '/inscription',
  '/fil',
  '/recherche',
  '/js/recherche.js',
  '/css/style.css',
  '/css/confirmer-email.css',
  '/css/assistant.css',
  '/js/assistant-recherche.js',
  '/js/assistant.js',
  '/js/theme.js',
  '/langues/fr.js',
  '/langues/en.js',
  '/js/app.js',
  '/js/formulaires.js',
  '/js/acces.js',
  '/js/fonds.js',
  '/js/defis.js',
  '/defis',
  '/js/confirmer-email.js',
  '/confirmer-email',
  '/js/bienvenue.js',
  '/js/date-naissance.js',
  '/bienvenue',
  '/js/publication.js',
  '/js/push.js',
  '/js/appels.js',
  '/css/appels.css',
  '/js/page-publication.js',
  '/publication.html',
  '/js/fil.js',
  '/js/amis.js',
  '/js/parametres.js',
  '/regles',
  '/js/sanctions.js',
  '/sanctions',
  '/js/pas-moi.js',
  '/pas-moi',
  '/annuler-suppression',
  '/js/bon-retour.js',
  '/bon-retour',
  '/parametres',
  '/amis',
  '/js/demandes.js',
  '/demandes',
  '/js/demande.js',
  '/demande.html',
  '/js/notifications.js',
  '/js/messages.js',
  '/messages',
  '/notifications',
  '/icons/icones.svg',
  '/icons/illustrations.svg',
  '/icons/motif-acces.svg',
  '/icons/motif-banniere.svg',
  '/img/palabre-partage-1200x630.png',
  '/js/vitrine.js',
  '/js/projets.js',
  '/projets',
  '/js/projet.js',
  '/projet.html',
  '/js/chercher.js',
  '/chercher',
  '/js/admin.js',
  '/admin',
  '/js/grille-prix.js',
  '/js/calcul-prix.js',
  '/js/calculateur.js',
  '/calculateur',
  '/a-propos',
  '/conditions',
  '/js/profil.js',
  '/js/modifier-profil.js',
  '/profil.html',
  '/modifier-profil',
  '/icons/logo-96.webp',
  '/icons/icon-512.png',
  '/icons/arbre-512.webp',
  '/fonts/bricolage-grotesque-latin-700-normal.woff2',
  '/fonts/bricolage-grotesque-latin-800-normal.woff2',
];

self.addEventListener('install', (evenement) => {
  evenement.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(FICHIERS)));
  self.skipWaiting();
});

self.addEventListener('activate', (evenement) => {
  evenement.waitUntil(
    caches.keys().then((cles) => Promise.all(cles.filter((c) => c !== VERSION).map((c) => caches.delete(c)))),
  );
  self.clients.claim();
});

// Ce qui est gardé : les pages de la liste et les fichiers de l'interface. Rien d'autre : ni les profils visités
// (le cache grossirait sans fin), ni les images des membres (/fichiers/ : le navigateur les garde déjà lui-même,
// et la photo d'un message privé ne doit jamais rester ici, où le serveur ne peut plus vérifier qui la demande).
const DOSSIERS_GARDES = ['/css/', '/js/', '/icons/', '/fonts/', '/img/', '/langues/'];
const aGarder = (chemin) => FICHIERS.includes(chemin) || DOSSIERS_GARDES.some((dossier) => chemin.startsWith(dossier));

// Réseau d'abord (pour avoir la dernière version), cache en secours si pas de connexion.
self.addEventListener('fetch', (evenement) => {
  const requete = evenement.request;
  const url = new URL(requete.url);
  if (requete.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/fichiers/')) {
    return;
  }
  evenement.respondWith(
    fetch(requete)
      .then((reponse) => {
        if (reponse.ok && aGarder(url.pathname)) {
          const copie = reponse.clone();
          caches.open(VERSION).then((cache) => cache.put(requete, copie));
        }
        return reponse;
      })
      // ignoreSearch : le style et les scripts sont demandés avec « ?v=empreinte » ; hors connexion, la copie gardée
      // sous l'adresse simple fait l'affaire.
      .catch(() => caches.match(requete).then((r) => r || caches.match(requete, { ignoreSearch: true }))
        // Hors connexion, une page inconnue reçoit l'accueil ; une image ou un script introuvable, rien.
        .then((r) => r || (requete.mode === 'navigate' ? caches.match('/') : Response.error()))),
  );
});

// ---------- Notifications push ----------
// Le serveur envoie un message chiffré (src/utils/push.js) ; le téléphone réveille ce fichier, même site fermé.
// Seule une adresse interne au site est acceptée comme lien.
const lienInterne = (lien) => (typeof lien === 'string' && /^\/(?!\/)/.test(lien) ? lien : '/notifications');

// Ce fichier ne lit pas les dictionnaires : le serveur envoie les textes dans la langue du membre (« boutons »
// pour un appel). Seul le texte de secours, pour un message illisible, suit la langue du téléphone.
const EN_ANGLAIS = /^en/i.test(self.navigator.language || '');
const SECOURS = EN_ANGLAIS
  ? { texte: 'You have a new notification.', decrocher: 'Answer', refuser: 'Decline' }
  : { texte: 'Tu as une nouvelle notification.', decrocher: 'Décrocher', refuser: 'Refuser' };

self.addEventListener('push', (evenement) => {
  let message = {};
  try { message = evenement.data ? evenement.data.json() : {}; } catch { /* message illisible : texte par défaut */ }
  evenement.waitUntil(self.registration.showNotification(message.titre || 'Palabre', {
    body: message.texte || SECOURS.texte,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png', // une feuille blanche : Android n'en garde que la forme, dans la barre d'état
    // Même « tag » : la nouvelle notification remplace la précédente du même sujet au lieu de s'empiler.
    tag: message.tag || 'palabre',
    renotify: true,
    vibrate: message.appel ? [200, 100, 200, 100, 200] : [120],
    // Un appel : la notification reste affichée tant qu'on n'y a pas touché, avec deux boutons quand le téléphone le permet.
    requireInteraction: Boolean(message.appel),
    actions: message.appel ? [
      { action: 'decrocher', title: (message.boutons || {}).decrocher || SECOURS.decrocher },
      { action: 'refuser', title: (message.boutons || {}).refuser || SECOURS.refuser },
    ] : [],
    data: { lien: lienInterne(message.lien), appel: message.appel || null },
  }));
});

// Toucher la notification : on réutilise un onglet Palabre déjà ouvert (mis au premier plan), sinon on en ouvre un.
self.addEventListener('notificationclick', (evenement) => {
  evenement.notification.close();
  const donnees = evenement.notification.data || {};
  // « Refuser » un appel depuis la notification : on le dit au serveur, sans ouvrir le site.
  if (evenement.action === 'refuser' && donnees.appel) {
    evenement.waitUntil(fetch(`/api/messages/appels/${donnees.appel}/refuser`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', credentials: 'same-origin' }).catch(() => {}));
    return;
  }
  const adresse = new URL(lienInterne(donnees.lien), self.location.origin).href;
  evenement.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((onglets) => {
    const ouvert = onglets.find((onglet) => new URL(onglet.url).origin === self.location.origin);
    if (!ouvert) return self.clients.openWindow(adresse);
    return ouvert.navigate(adresse).then((onglet) => (onglet || ouvert).focus()).catch(() => self.clients.openWindow(adresse));
  }));
});
