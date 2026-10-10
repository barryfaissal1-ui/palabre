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
  const adresse = (process.env.URL_PUBLIQUE || '').trim().replace(/\/+$/, ''); // sans « / » à la fin
  if (!production) return adresse || 'http://localhost:3000';
  if (!/^https:\/\/[^/\s]+$/.test(adresse)) {
    throw new Error('URL_PUBLIQUE doit être l\'adresse du site en https, sans chemin. Exemple : URL_PUBLIQUE=https://palabre.dev');
  }
  return adresse;
}

module.exports = {
  production,
  port: Number(process.env.PORT) || 3000,
  urlPublique: adressePublique(),
  databaseUrl: obligatoire('DATABASE_URL', 'postgres://palabre:palabre@localhost:5432/palabre'),
  databaseSsl: process.env.DATABASE_SSL === 'true',
  jwtSecret: cleSecrete(),
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    expediteur: process.env.SMTP_FROM || 'Palabre <no-reply@palabre.dev>',
  },
  // Notifications push (facultatif) : sans ces clés, le site marche normalement, simplement sans push.
  // Pour les fabriquer : npm run cles-push
  vapid: {
    publique: (process.env.VAPID_PUBLIQUE || '').trim(),
    privee: (process.env.VAPID_PRIVEE || '').trim(),
    sujet: (process.env.VAPID_SUJET || '').trim(),
  },
};
