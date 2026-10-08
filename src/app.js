// Construction de l'application Express (séparée de server.js pour pouvoir la tester).
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { chargerUtilisateur } = require('./middleware/auth');
const { IDENTIFIANTS_RESERVES } = require('./utils/validation');

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
      },
    },
  }));

  // Les envois d'images ont droit à un corps plus gros (image compressée en base64) ;
  // toutes les autres requêtes restent limitées à 200 Ko.
  app.use('/api/profils/moi/avatar', express.json({ limit: '750kb' }));
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
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/profils', require('./routes/profils'));
  app.use('/api', require('./routes/references'));

  app.get('/api/sante', (req, res) => res.json({ ok: true }));
  app.use('/api', (req, res) => res.status(404).json({ erreur: 'Route introuvable.' }));

  app.use('/fichiers', require('./routes/fichiers'));

  app.use(express.static(DOSSIER_PUBLIC, {
    extensions: ['html'],
    setHeaders(res, fichier) {
      if (fichier.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
    },
  }));

  // Liens courts de profil : palabre.dev/barry-faissal affiche la page profil.
  // La page lit l'identifiant dans l'adresse et demande le profil à l'API.
  app.get('/:identifiant', (req, res, next) => {
    const id = req.params.identifiant.toLowerCase();
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id) || IDENTIFIANTS_RESERVES.has(id)) return next();
    res.sendFile(path.join(DOSSIER_PUBLIC, 'profil.html'));
  });

  // Gestion centralisée des erreurs.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.statut === 400) {
      return res.status(400).json({ erreur: err.message, champ: err.champ });
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
