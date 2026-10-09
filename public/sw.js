// Service worker : met en cache les fichiers de l'interface pour un chargement rapide, même en 3G.
// Les données (/api) ne sont jamais mises en cache.
const VERSION = 'palabre-v21';
const FICHIERS = [
  '/',
  '/connexion',
  '/inscription',
  '/fil',
  '/css/style.css',
  '/js/theme.js',
  '/js/app.js',
  '/js/formulaires.js',
  '/js/acces.js',
  '/js/fonds.js',
  '/js/publication.js',
  '/js/fil.js',
  '/js/amis.js',
  '/amis',
  '/js/demandes.js',
  '/demandes',
  '/js/demande.js',
  '/demande.html',
  '/js/notifications.js',
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
  '/icons/logo-256.png',
  '/icons/icon-512.png',
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

// Réseau d'abord (pour avoir la dernière version), cache en secours si pas de connexion.
self.addEventListener('fetch', (evenement) => {
  const requete = evenement.request;
  const url = new URL(requete.url);
  if (requete.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    return;
  }
  evenement.respondWith(
    fetch(requete)
      .then((reponse) => {
        if (reponse.ok) {
          const copie = reponse.clone();
          caches.open(VERSION).then((cache) => cache.put(requete, copie));
        }
        return reponse;
      })
      .catch(() => caches.match(requete).then((r) => r || caches.match('/'))),
  );
});
