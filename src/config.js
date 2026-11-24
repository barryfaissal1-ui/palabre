// Configuration centralisée, lue depuis les variables d'environnement (.env en local).
require('dotenv').config({ quiet: true });

const production = process.env.NODE_ENV === 'production';

function obligatoire(nom, valeurDev) {
  const valeur = process.env[nom];
  if (valeur) return valeur;
  if (production) {
    throw new Error(`Variable d'environnement manquante : ${nom}`);
  }
  return valeurDev;
}

// Clé secrète des sessions. En production, le serveur refuse de démarrer avec une clé absente, trop courte ou
// restée à la valeur d'exemple : avec une clé devinable, n'importe qui pourrait fabriquer une session
// (y compris celle d'un administrateur).
function cleSecrete() {
  const cle = obligatoire('JWT_SECRET', 'secret-de-developpement-a-changer');
  if (production && (cle.length < 32 || /a-remplacer|secret-de-developpement/i.test(cle))) {
    throw new Error('JWT_SECRET est trop court ou encore à sa valeur d\'exemple. Il faut au moins 32 caractères au hasard.\n'
      + 'Pour en générer un : node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
  }
  return cle;
}

// Adresse publique du site (liens des emails, cartes de partage Facebook / WhatsApp, texte des publications).
// En production elle est obligatoire et en https : sinon les emails contiendraient des liens vers « localhost ».
function adressePublique() {
  // Chez Render, l'adresse du site est fournie par l'hébergeur lui-même (RENDER_EXTERNAL_URL).
  const adresse = (process.env.URL_PUBLIQUE || process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/+$/, ''); // sans « / » à la fin
  if (!production) return adresse || 'http://localhost:3000';
  // Sans URL_PUBLIQUE, l'adresse est apprise à la première requête, mais seulement si c'est un sous-domaine
  // de Systalink (voir src/app.js) : jamais un en-tête Host inventé par un visiteur.
  if (!adresse) return '';
  if (!/^https:\/\/[^/\s]+$/.test(adresse)) {
    throw new Error('URL_PUBLIQUE doit être l\'adresse du site en https, sans chemin. Exemple : URL_PUBLIQUE=https://palabre.dev');
  }
  return adresse;
}

// Adresse de la base. DATABASE_HOTE et DATABASE_PORT (facultatifs) remplacent l'hôte et le port de DATABASE_URL :
// chez Systalink, l'adresse publique de la base n'est pas joignable depuis le service web, seule l'adresse
// privée l'est. On peut ainsi la régler sans retaper l'adresse complète, qui contient le mot de passe.
function adresseBase() {
  const adresse = obligatoire('DATABASE_URL', 'postgres://palabre:palabre@localhost:5432/palabre');
  const hote = (process.env.DATABASE_HOTE || '').trim();
  const port = (process.env.DATABASE_PORT || '').trim();
  if (!hote && !port) return adresse;
  const url = new URL(adresse);
  if (hote) url.hostname = hote;
  if (port) url.port = port;
  return url.toString();
}

module.exports = {
  production,
  port: Number(process.env.PORT) || 3000,
  urlPublique: adressePublique(),
  databaseUrl: adresseBase(),
  databaseSsl: process.env.DATABASE_SSL === 'true',
  jwtSecret: cleSecrete(),
  // Adresse où écrire à l'équipe pour un signalement grave : affichée sur /regles et /conditions.
  contactModeration: (process.env.CONTACT_MODERATION || 'moderation@palabre.dev').trim(),
  // Lieu approximatif d'une connexion (facultatif) : le nom des en-têtes où l'hébergeur ou le proxy écrit le pays
  // et la ville du visiteur. Sans eux, Palabre n'affiche simplement aucun lieu (src/utils/sessions.js).
  entetePays: (process.env.ENTETE_PAYS || '').trim(),
  enteteVille: (process.env.ENTETE_VILLE || '').trim(),
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER || '',
    // Les mots de passe d'application Google s'affichent en 4 groupes de 4 lettres : les espaces collés avec eux sont retirés.
    pass: (process.env.SMTP_PASS || '').replace(/\s+/g, ''),
    expediteur: process.env.SMTP_FROM || 'Palabre <no-reply@palabre.dev>',
  },
  // Appels audio et vidéo. STUN : serveurs publics par défaut. TURN (facultatif) : notre relais, pour les réseaux
  // qui bloquent la liaison directe (docs/APPELS-TURN.md). Sans TURN, les appels marchent là où le réseau le permet.
  appels: {
    stun: (process.env.STUN_URLS || 'stun:stun.l.google.com:19302,stun:stun.cloudflare.com:3478').split(',').map((u) => u.trim()).filter(Boolean),
    turnUrls: (process.env.TURN_URL || '').split(',').map((u) => u.trim()).filter(Boolean),
    turnSecret: (process.env.TURN_SECRET || '').trim(),
  },
  // Notifications push (facultatif) : sans ces clés, le site marche normalement, simplement sans push.
  // Pour les fabriquer : npm run cles-push
  vapid: {
    publique: (process.env.VAPID_PUBLIQUE || '').trim(),
    privee: (process.env.VAPID_PRIVEE || '').trim(),
    sujet: (process.env.VAPID_SUJET || '').trim(),
  },
};
