// Construction de l'application Express (séparée de server.js pour pouvoir la tester).
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const { chargerUtilisateur, exigerEmailConfirme, exigerCompteActif } = require('./middleware/auth');
const { langueDe } = require('./utils/langue');
const { exigerReglesAcceptees } = require('./utils/regles');
const { exigerNonSuspendu } = require('./utils/sanctions');
const { codeDe, traduireReponse } = require('./utils/textes');

const { DOSSIER_PUBLIC, pagesHtml, entetesDeCache, pageErreur } = require('./utils/statique');

function creerApp() {
  const app = express();
  app.set('trust proxy', 1); // derrière le proxy de l'hébergeur

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // i.ytimg.com : les miniatures des vidéos YouTube du fil (une simple image, sans traceur).
        imgSrc: ["'self'", 'data:', 'blob:', 'https://i.ytimg.com'],
        // Les seuls cadres autorisés : les lecteurs officiels des vidéos jointes aux publications.
        // Ils ne sont créés qu'au moment où le membre touche la vidéo (public/js/publication.js).
        frameSrc: ['https://www.youtube-nocookie.com', 'https://www.tiktok.com', 'https://www.facebook.com'],
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

  // Compression gzip des réponses en texte (pages, style, scripts, icônes SVG, réponses de l'API) : en 3G,
  // la feuille de style passe d'environ 100 Ko à moins de 20. Les images, déjà compressées, ne sont pas retouchées.
  app.use(compression());

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

  // Langue des réponses. Le code du serveur écrit ses messages en français ; juste avant l'envoi, chaque réponse
  // de l'API passe ici :
  //  - une erreur reçoit un « code » stable (« adresse-email-invalide »), le même dans toutes les langues ;
  //  - pour une personne qui lit l'anglais, les textes écrits par le serveur sont traduits (src/utils/textes.js).
  // La langue : le cookie « langue », sinon celle du compte, sinon celle du navigateur (src/utils/langue.js).
  app.use('/api', (req, res, next) => {
    const envoyer = res.json.bind(res);
    res.json = (corps) => {
      if (!corps || typeof corps !== 'object' || Array.isArray(corps)) return envoyer(corps);
      const langue = langueDe(req);
      // On travaille sur une copie : certains messages (limites de fréquence) sont des objets partagés par toutes
      // les requêtes, qu'il ne faut surtout pas modifier.
      const reponse = langue === 'fr' ? { ...corps } : JSON.parse(JSON.stringify(corps));
      if (typeof corps.erreur === 'string') reponse.code = codeDe(corps.erreur);
      return envoyer(traduireReponse(langue, reponse));
    };
    next();
  });

  app.use('/api', chargerUtilisateur);
  // Les routes ouvertes sans compte (recherche de devs, vitrine, profils) pourraient être aspirées par un robot.
  // Un visiteur a droit à 300 appels par minute et par adresse IP : bien plus qu'une personne, bien moins qu'un robot.
  // Les membres connectés ne sont pas concernés (ils ont leurs propres limites, par membre et par action).
  app.use('/api', rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: (req) => Boolean(req.utilisateur),
    message: { erreur: 'Trop de requêtes. Réessaie dans une minute.' },
  }));
  // Tant que l'email n'est pas confirmé, seul /api/auth répond (le code, le renvoi, la déconnexion).
  app.use('/api', exigerEmailConfirme);
  // Compte désactivé par son propriétaire : seul /api/auth répond (réactiver, se déconnecter).
  app.use('/api', exigerCompteActif);
  // Les règles de la communauté ont changé depuis son acceptation : il lit, mais n'écrit plus avant de les accepter.
  app.use('/api', exigerReglesAcceptees);
  // Compte suspendu (sanction) : lecture seule jusqu'à la date de fin.
  app.use('/api', exigerNonSuspendu);
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
  app.use('/api/defis', require('./routes/defis'));
  app.use('/api/parametres', require('./routes/parametres'));
  app.use('/api/sanctions', require('./routes/sanctions'));
  app.use('/api/admin', require('./routes/admin'));
  app.use('/api', require('./routes/references'));

  app.get('/api/sante', (req, res) => res.json({ ok: true }));
  app.use('/api', (req, res) => res.status(404).json({ erreur: 'Route introuvable.' }));

  app.use('/fichiers', require('./routes/fichiers'));

  // Accueil, liens courts de profil (palabre.dev/barry-faissal) et pages de projet :
  // le serveur y ajoute les balises de partage Facebook / WhatsApp (voir routes/pages.js).
  // Placé avant les fichiers statiques, sinon l'accueil serait servi sans passer par là.
  app.use(require('./routes/pages'));

  // Les pages simples (/fil, /amis…), puis les autres fichiers avec leur durée de cache (voir utils/statique.js).
  app.use(pagesHtml);
  app.use(express.static(DOSSIER_PUBLIC, { index: false, setHeaders: entetesDeCache }));

  // Rien n'a répondu : page 404 dans le style du site.
  app.use((req, res) => pageErreur(res, 404));

  // Gestion centralisée des erreurs.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    // Erreurs prévues (ErreurValidation, ErreurHttp) : le message est destiné à la personne.
    // 409 : l'action entre en conflit avec l'état actuel (déjà en appel) ; 410 : la chose n'existe plus (appel terminé).
    if ([400, 403, 404, 409, 410, 429].includes(err.statut)) {
      return res.status(err.statut).json({ erreur: err.message, champ: err.champ, suite: err.suite });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ erreur: 'Données illisibles.' });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ erreur: 'Envoi trop volumineux.' });
    }
    // Adresse mal écrite (« %E0 » tout seul…) : c'est une erreur de la demande, pas du serveur.
    if (err.status === 400 || err instanceof URIError) {
      return req.path.startsWith('/api/') ? res.status(400).json({ erreur: 'Adresse illisible.' }) : pageErreur(res, 404);
    }
    console.error(err);
    // L'API répond en JSON ; une page demandée par le navigateur reçoit la page d'erreur du site.
    // Dans les deux cas, aucun détail technique ne sort : il reste dans le journal du serveur.
    if (!req.path.startsWith('/api/') && !req.path.startsWith('/fichiers/')) return pageErreur(res, 500);
    res.status(500).json({ erreur: 'Une erreur est survenue. Réessaie.' });
  });

  return app;
}

module.exports = { creerApp };
