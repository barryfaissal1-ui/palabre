// Le gabarit HTML des emails de Palabre (code de confirmation, mot de passe oublié).
//
// Un email n'est pas une page web : Gmail, Outlook et les autres retirent les feuilles de style et la plupart des
// mises en page modernes. On écrit donc « à l'ancienne » : des tableaux, des styles directement sur chaque balise,
// 600 px de large au plus. C'est le SEUL endroit du projet où les styles en ligne sont permis (la règle « pas de
// style en ligne » protège les pages du site, pas les emails).
// Chaque email part aussi en version texte (pour les lecteurs d'écran et les messageries qui refusent le HTML).
const config = require('../config');
const textes = require('./textes');

const VERT = '#187A3B';
const VERT_CLAIR = '#E6F2E9';
const ENCRE = '#1A1C18';
const GRIS = '#62665E';
const POLICE = 'font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;';

// Les valeurs qui viennent d'un membre (son prénom) sont neutralisées avant d'entrer dans le HTML :
// un prénom comme <img src=x onerror=…> doit rester du texte.
function echapperHtml(texte) {
  return String(texte).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const paragraphe = (texte) => `<p style="margin:0 0 16px;${POLICE}font-size:16px;line-height:24px;color:${ENCRE};">${texte}</p>`;

// prenom : pour « Bonjour … » ; avant / apres : paragraphes (texte simple, échappé ici) ;
// code : affiché en très gros dans un encadré vert clair ; bouton : { texte, lien } (mot de passe oublié seulement).
// langue : 'fr' (par défaut) ou 'en', celle du destinataire.
function gabaritEmail({ titre, prenom, avant = [], code = null, bouton = null, apres = [], langue = 'fr' }) {
  const T = (cle, variables) => textes.t(langue, cle, variables);
  const logo = `${config.urlPublique}/icons/icon-192.png`;
  const blocCode = code ? `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
            <tr><td align="center" bgcolor="${VERT_CLAIR}" style="background-color:${VERT_CLAIR};border:1px solid #BFDFC8;border-radius:28px 6px 28px 6px;padding:22px 12px 20px;">
              <div style="${POLICE}font-size:13px;line-height:18px;color:${VERT};font-weight:bold;">&#127807; ${T('email.ton-code')}</div>
              <div style="font-family:Consolas,Menlo,'Courier New',monospace;font-size:40px;line-height:52px;font-weight:bold;letter-spacing:10px;color:#0F3D22;padding-left:10px;">${echapperHtml(code)}</div>
            </td></tr>
          </table>` : '';
  const blocBouton = bouton ? `
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
            <tr><td align="center" bgcolor="${VERT}" style="background-color:${VERT};border-radius:24px;">
              <a href="${echapperHtml(bouton.lien)}" style="display:inline-block;padding:14px 28px;${POLICE}font-size:16px;font-weight:bold;color:#FFFFFF;text-decoration:none;">${echapperHtml(bouton.texte)}</a>
            </td></tr>
          </table>
          <p style="margin:0 0 16px;${POLICE}font-size:13px;line-height:20px;color:${GRIS};word-break:break-all;">${T('email.bouton-secours')}<br>${echapperHtml(bouton.lien)}</p>` : '';
  return `<!doctype html>
<html lang="${langue}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${echapperHtml(titre)}</title>
</head>
<body style="margin:0;padding:0;background-color:#F1F0EB;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F1F0EB" style="background-color:#F1F0EB;">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
      <tr><td align="center" style="padding:0 0 16px;">
        <img src="${echapperHtml(logo)}" width="56" height="56" alt="Palabre" style="display:block;border:0;border-radius:14px;">
        <div style="${POLICE}font-size:20px;line-height:28px;font-weight:bold;color:${ENCRE};padding-top:6px;">Palabre</div>
      </td></tr>
      <tr><td bgcolor="#FFFFFF" style="background-color:#FFFFFF;border-radius:16px;padding:28px 24px 12px;">
          <h1 style="margin:0 0 16px;${POLICE}font-size:22px;line-height:28px;color:${ENCRE};">${echapperHtml(titre)}</h1>
          ${paragraphe(T('email.bonjour', { prenom: echapperHtml(prenom) }))}
          ${avant.map((phrase) => paragraphe(echapperHtml(phrase))).join('\n          ')}${blocCode}${blocBouton}
          ${apres.map((phrase) => paragraphe(echapperHtml(phrase))).join('\n          ')}
      </td></tr>
      <tr><td align="center" style="padding:20px 12px 0;${POLICE}font-size:13px;line-height:20px;color:${GRIS};">
        ${T('email.pied')}<br>${T('email.pied-suite')}
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// Email du code de confirmation : { sujet, texte, html }. Aucun lien de connexion : seulement le code à recopier.
// motif 'connexion' : le code de la validation en deux étapes (« Confirme que c'est toi »).
function emailCode({ prenom, code, dureeMin, langue = 'fr', motif = 'inscription' }) {
  const famille = motif === 'connexion' ? 'email.connexion' : 'email.code';
  const T = (cle, variables) => textes.t(langue, cle, variables);
  return {
    sujet: T(`${famille}.sujet`, { code }),
    texte: `${T('email.bonjour', { prenom })}\n\n${T(`${famille}.texte-code`, { code })}\n\n${T(`${famille}.texte-suite`, { n: dureeMin })}\n\n${T('email.signature')}`,
    html: gabaritEmail({
      langue,
      titre: T(`${famille}.titre`),
      prenom,
      avant: [T(`${famille}.avant`)],
      code,
      apres: [T('email.code.valable', { n: dureeMin }), T(`${famille}.ignore`)],
    }),
  };
}

// « 11 octobre 2026 à 14:32 GMT » : l'heure de Ouagadougou, la même pour tous les membres.
function dateGmt(date, langue) {
  return `${new Intl.DateTimeFormat(langue === 'en' ? 'en-GB' : 'fr-FR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }).format(date)} GMT`;
}

// Email « Nouvelle connexion à ton compte Palabre » : l'appareil, la date, le pays s'il est connu, et un bouton
// « Ce n'était pas moi » (lien à usage unique, src/utils/deux-etapes.js).
function emailAlerteConnexion({ prenom, appareil, date, pays = null, lien, langue = 'fr' }) {
  const T = (cle, variables) => textes.t(langue, cle, variables);
  const details = [
    T('email.alerte.appareil', { appareil: textes.traduire(langue, appareil) }),
    T('email.alerte.date', { date: dateGmt(date, langue) }),
    pays ? T('email.alerte.pays', { pays }) : null,
  ].filter(Boolean);
  return {
    sujet: T('email.alerte.sujet'),
    texte: `${T('email.bonjour', { prenom })}\n\n${T('email.alerte.avant')}\n${details.join('\n')}\n\n${T('email.alerte.c-etait-toi')}\n\n${T('email.alerte.texte-pas-toi')}\n${lien}\n\n${T('email.signature')}`,
    html: gabaritEmail({
      langue,
      titre: T('email.alerte.sujet'),
      prenom,
      avant: [T('email.alerte.avant'), ...details, T('email.alerte.c-etait-toi')],
      bouton: { texte: T('email.alerte.bouton'), lien },
      apres: [T('email.alerte.apres')],
    }),
  };
}

// Email « mot de passe oublié » : le même gabarit, avec un bouton vers la page de réinitialisation.
function emailMotDePasse({ prenom, lien, dureeMin, langue = 'fr' }) {
  const T = (cle, variables) => textes.t(langue, cle, variables);
  return {
    sujet: T('email.mdp.sujet'),
    texte: `${T('email.bonjour', { prenom })}\n\n${T('email.mdp.texte', { n: dureeMin })}\n${lien}\n\n${T('email.mdp.texte-ignore')}\n\n${T('email.signature')}`,
    html: gabaritEmail({
      langue,
      titre: T('email.mdp.titre'),
      prenom,
      avant: [T('email.mdp.avant', { n: dureeMin })],
      bouton: { texte: T('email.mdp.bouton'), lien },
      apres: [T('email.mdp.ignore')],
    }),
  };
}

module.exports = { gabaritEmail, emailCode, emailMotDePasse, emailAlerteConnexion, dateGmt, echapperHtml };
