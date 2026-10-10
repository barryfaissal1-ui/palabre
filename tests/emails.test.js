// Tests des emails (src/utils/gabarit-email.js) : version HTML et version texte, code présent, valeurs échappées.
const test = require('node:test');
const assert = require('node:assert/strict');
const { creerApp } = require('../src/app');
const { migrer } = require('../src/db/migrate');
const { pool } = require('../src/db/pool');
const { emailCode, emailMotDePasse, gabaritEmail } = require('../src/utils/gabarit-email');
const { jetonAncien, emailsEnvoyes } = require('./aide');

const PIEGE = 'Awa <img src=x onerror="alert(1)"> & \'Co\'';

test('email du code : le code est dans le texte et dans le HTML, en gros, sans aucun lien', () => {
  const { sujet, texte, html } = emailCode({ prenom: 'Awa', code: '048213', dureeMin: 15 });
  assert.equal(sujet, 'Palabre – Ton code de confirmation : 048213');
  assert.match(texte, /^Bonjour Awa,/);
  assert.match(texte, /code de confirmation Palabre : 048213/);
  assert.match(texte, /valable 15 minutes/);
  assert.match(html, />048213<\/div>/);
  assert.match(html, /font-size:40px/);
  assert.match(html, /Bonjour Awa,/);
  assert.match(html, /valable 15 minutes/);
  assert.match(html, /L'équipe Palabre, fait au Burkina Faso/);
  // Pas de lien de connexion : quelqu'un qui intercepte l'email n'a rien à cliquer.
  assert.doesNotMatch(html, /<a\s/);
  assert.doesNotMatch(html, /<script|javascript:|onerror=|<style/i);
});

test('gabarit : un vrai email HTML (tableaux, 600 px, logo en adresse absolue, clair et sombre)', () => {
  const { html } = emailCode({ prenom: 'Awa', code: '123456', dureeMin: 15 });
  assert.ok(html.startsWith('<!doctype html>'));
  assert.match(html, /<html lang="fr">/);
  assert.match(html, /max-width:600px/);
  assert.match(html, /<table role="presentation"/);
  assert.match(html, /<meta name="color-scheme" content="light dark">/);
  assert.match(html, /<img src="http:\/\/localhost:3000\/icons\/icon-192\.png" width="56" height="56" alt="Palabre"/);
  // Aucune adresse relative : dans une boîte email, « /icons/… » ne mènerait nulle part.
  assert.doesNotMatch(html, /(src|href)="\//);
});

test('valeurs échappées : un prénom piégé reste du texte dans le HTML', () => {
  for (const { html, texte } of [emailCode({ prenom: PIEGE, code: '123456', dureeMin: 15 }), emailMotDePasse({ prenom: PIEGE, lien: 'http://localhost:3000/reinitialiser?jeton=abc', dureeMin: 30 })]) {
    assert.ok(html.includes('Bonjour Awa &lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;Co&#39;,'));
    assert.ok(!html.includes('<img src=x'));
    assert.ok(texte.includes(`Bonjour ${PIEGE},`)); // la version texte n'est pas du HTML : rien à échapper
  }
  // Un code ou un titre inattendu ne peut pas non plus injecter de balise.
  const html = gabaritEmail({ titre: '<b>titre</b>', prenom: 'Awa', code: '<i>1</i>', bouton: { texte: '<u>ok</u>', lien: 'http://exemple.test/?a=1&b="2"' } });
  assert.ok(!/<b>|<i>|<u>/.test(html));
  assert.ok(html.includes('href="http://exemple.test/?a=1&amp;b=&quot;2&quot;"'));
});

test('mot de passe oublié : même gabarit, un bouton vers le lien et le lien en clair', () => {
  const lien = 'http://localhost:3000/reinitialiser?jeton=0123abcd';
  const { sujet, texte, html } = emailMotDePasse({ prenom: 'Cheick', lien, dureeMin: 30 });
  assert.equal(sujet, 'Palabre – Réinitialise ton mot de passe');
  assert.ok(texte.includes(lien) && /valable 30 minutes/.test(texte));
  assert.ok(html.includes(`<a href="${lien}"`));
  assert.match(html, /Choisir un nouveau mot de passe<\/a>/);
  assert.match(html, /max-width:600px/);
  assert.match(html, /L'équipe Palabre, fait au Burkina Faso/);
  assert.doesNotMatch(html, /font-size:40px/); // pas d'encadré de code dans cet email
});

test('à l\'inscription, l\'email envoyé porte le même code en texte et en HTML ; le code enregistré est haché', async () => {
  await migrer();
  const serveur = creerApp().listen(0);
  const base = `http://localhost:${serveur.address().port}`;
  const email = `emails-awa-${Date.now()}@palabre.test`;
  try {
    const r = await fetch(`${base}/api/auth/inscription`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'client', prenom: 'Aïcha', nomFamille: 'Emails', email, motDePasse: 'motdepasse1', pays: 'Burkina Faso', ville: 'Koudougou', jeton: jetonAncien() }),
    });
    assert.equal(r.status, 201);
    const message = emailsEnvoyes.filter((m) => m.a === email).pop();
    const code = /code de confirmation Palabre : (\d{6})/.exec(message.texte)[1];
    assert.ok(message.html.includes(`>${code}</div>`));
    assert.ok(message.html.includes('Bonjour Aïcha,'));
    assert.ok(message.sujet.endsWith(code));
    // Les règles du serveur n'ont pas changé : le code n'est jamais gardé en clair.
    const { rows } = await pool.query('SELECT c.code_hash FROM confirmations_email c JOIN utilisateurs u ON u.id = c.utilisateur_id WHERE u.email = $1', [email]);
    assert.equal(rows.length, 1);
    assert.ok(!rows[0].code_hash.includes(code) && rows[0].code_hash.length >= 32);

    // Mot de passe oublié : l'email part lui aussi avec sa version HTML.
    await fetch(`${base}/api/auth/mot-de-passe-oublie`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    const oubli = emailsEnvoyes.filter((m) => m.a === email).pop();
    assert.match(oubli.sujet, /Réinitialise ton mot de passe/);
    const lien = /http\S+reinitialiser\?jeton=[0-9a-f]+/.exec(oubli.texte)[0];
    assert.ok(oubli.html.includes(`<a href="${lien}"`));
    assert.ok(oubli.html.includes('Bonjour Aïcha,'));
  } finally {
    await pool.query('DELETE FROM utilisateurs WHERE email = $1', [email]);
    await new Promise((fini) => serveur.close(fini));
    await pool.end();
  }
});
