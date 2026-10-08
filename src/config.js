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

module.exports = {
  production,
  port: Number(process.env.PORT) || 3000,
  // Adresse publique du site, utilisée dans les emails (lien de réinitialisation).
  urlPublique: process.env.URL_PUBLIQUE || 'http://localhost:3000',
  databaseUrl: obligatoire('DATABASE_URL', 'postgres://palabre:palabre@localhost:5432/palabre'),
  databaseSsl: process.env.DATABASE_SSL === 'true',
  jwtSecret: obligatoire('JWT_SECRET', 'secret-de-developpement-a-changer'),
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    expediteur: process.env.SMTP_FROM || 'Palabre <no-reply@palabre.dev>',
  },
};
