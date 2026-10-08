// Construction de l'application Express (séparée de server.js pour pouvoir la tester).
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { chargerUtilisateur } = require('./middleware/auth');

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
  app.use('/api', require('./routes/references'));

  app.get('/api/sante', (req, res) => res.json({ ok: true }));
  app.use('/api', (req, res) => res.status(404).json({ erreur: 'Route introuvable.' }));

  app.use(express.static(path.join(__dirname, '..', 'public'), {
    extensions: ['html'],
    setHeaders(res, fichier) {
      if (fichier.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
    },
  }));

  // Gestion centralisée des erreurs.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.statut === 400) {
      return res.status(400).json({ erreur: err.message, champ: err.champ });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ erreur: 'Données illisibles.' });
    }
    console.error(err);
    res.status(500).json({ erreur: 'Une erreur est survenue. Réessaie.' });
  });

  return app;
}

module.exports = { creerApp };
