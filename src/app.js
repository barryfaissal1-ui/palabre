// Construction de l'application Express (séparée de server.js pour pouvoir la tester).
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const config = require('./config');
const { chargerUtilisateur, exigerEmailConfirme } = require('./middleware/auth');

const DOSSIER_PUBLIC = path.join(__dirname, '..', 'public');

function creerApp() {
  const app = express();
  app.set('trust proxy', 1); // derrière le proxy de l'hébergeur

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        styleSrc: ["'self'"],
        fontSrc: ["'self'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
        // En local il n'y a pas de HTTPS : sans cela, un téléphone du même Wi-Fi
        // ne peut charger ni le style ni les scripts.
        ...(config.production ? {} : { upgradeInsecureRequests: null }),
      },
    },
  }));

  // Les envois d'images ont droit à un corps plus gros (image compressée en base64) ;
  // toutes les autres requêtes restent limitées à 200 Ko.
  app.use('/api/profils/moi/avatar', express.json({ limit: '750kb' }));
  app.use('/api/profils/moi/couverture', express.json({ limit: '750kb' }));
  app.use('/api/messages', express.json({ limit: '750kb' })); // un message peut porter une photo
  app.post('/api/publications', express.json({ limit: '750kb' }));
  app.post('/api/projets', express.json({ limit: '750kb' }));
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());

  // Protection CSRF simple : les requêtes qui modifient des données doivent être en JSON.
  app.use('/api', (req, res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !req.is('application/json')) {
      return res.status(415).json({ erreur: 'Format de requête non accepté.' });
    }
    next();
  });

  app.use('/api', chargerUtilisateur);
  // Tant que l'email n'est pas confirmé, seul /api/auth répond (le code, le renvoi, la déconnexion).
  app.use('/api', exigerEmailConfirme);
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/profils', require('./routes/profils'));
  app.use('/api/publications', require('./routes/publications'));
  app.use('/api/amis', require('./routes/amis'));
  app.use('/api/signalements', require('./routes/signalements'));
  app.use('/api/demandes', require('./routes/demandes'));
  app.use('/api/equipes', require('./routes/equipes'));
  app.use('/api/notifications', require('./routes/notifications'));
  app.use('/api/projets', require('./routes/projets'));
  app.use('/api/avis', require('./routes/avis'));
  app.use('/api/devs', require('./routes/devs'));
  app.use('/api/messages', require('./routes/messages'));
  app.use('/api/admin', require('./routes/admin'));
  app.use('/api', require('./routes/references'));

  app.get('/api/sante', (req, res) => res.json({ ok: true }));
  app.use('/api', (req, res) => res.status(404).json({ erreur: 'Route introuvable.' }));

  app.use('/fichiers', require('./routes/fichiers'));

  // Accueil, liens courts de profil (palabre.dev/barry-faissal) et pages de projet :
  // le serveur y ajoute les balises de partage Facebook / WhatsApp (voir routes/pages.js).
  // Placé avant les fichiers statiques, sinon l'accueil serait servi sans passer par là.
  app.use(require('./routes/pages'));

  app.use(express.static(DOSSIER_PUBLIC, {
    extensions: ['html'],
    setHeaders(res, fichier) {
      if (fichier.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
    },
  }));

  // Gestion centralisée des erreurs.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    // Erreurs prévues (ErreurValidation, ErreurHttp) : le message est destiné à la personne.
    if ([400, 403, 404, 429].includes(err.statut)) {
      return res.status(err.statut).json({ erreur: err.message, champ: err.champ, suite: err.suite });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ erreur: 'Données illisibles.' });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ erreur: 'Envoi trop volumineux.' });
    }
    console.error(err);
    res.status(500).json({ erreur: 'Une erreur est survenue. Réessaie.' });
  });

  return app;
}

module.exports = { creerApp };
