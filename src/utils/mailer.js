// Envoi d'emails via SMTP (E-mail Pro Systalink en production).
// Sans configuration SMTP (en local), l'email est affiché dans la console.
const nodemailer = require('nodemailer');
const config = require('../config');

let transporteur = null;
if (config.smtp.host) {
  transporteur = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    // Un serveur d'email qui ne répond pas : on abandonne après 10 secondes (sans réglage, la bibliothèque attend
    // jusqu'à 2 minutes, et l'inscription attendrait avec elle).
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
}

async function envoyerEmail({ a, sujet, texte, html }) {
  if (!transporteur) {
    console.log(`\n[email non envoyé : SMTP non configuré]\nÀ : ${a}\nSujet : ${sujet}\n${texte}\n`);
    return;
  }
  await transporteur.sendMail({ from: config.smtp.expediteur, to: a, subject: sujet, text: texte, html });
}

module.exports = { envoyerEmail };
