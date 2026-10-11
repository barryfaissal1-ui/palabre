// Langue à la première visite (sans cookie) : la règle est dans public/js/app.js, qui ne tourne que dans un
// navigateur. On l'exécute donc ici dans un faux navigateur, juste assez complet pour aller jusqu'au choix de la
// langue (le script s'arrête ensuite : il n'y a pas de vraie page), et on lit le cookie « langue » qu'il a posé.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');

function langueChoisie({ navigateur, fuseau, cookie = '' }) {
  const document = { cookie, documentElement: { lang: 'fr' } };
  const fauxIntl = {
    PluralRules: Intl.PluralRules,
    NumberFormat: Intl.NumberFormat,
    DateTimeFormat: () => {
      if (fuseau === 'panne') throw new Error('pas de fuseau');
      return { resolvedOptions: () => ({ timeZone: fuseau }) };
    },
  };
  const monde = { window: { PalabreLangues: {} }, document, navigator: { language: navigateur }, Intl: fauxIntl };
  try { vm.runInNewContext(script, monde); } catch { /* attendu : plus loin, le script a besoin d'une vraie page */ }
  const trouve = /langue=(fr|en)/.exec(document.cookie);
  return trouve ? trouve[1] : null;
}

test('navigateur en français : toujours le français, où que l\'on soit', () => {
  for (const fuseau of ['Africa/Ouagadougou', 'Africa/Lagos', 'Europe/Paris', 'America/New_York']) {
    assert.equal(langueChoisie({ navigateur: 'fr-FR', fuseau }), 'fr', fuseau);
  }
});

test('navigateur en anglais dans un pays africain francophone : français', () => {
  const fuseaux = ['Africa/Ouagadougou', 'Africa/Abidjan', 'Africa/Dakar', 'Africa/Bamako', 'Africa/Lome', 'Africa/Porto-Novo',
    'Africa/Douala', 'Africa/Kinshasa', 'Africa/Casablanca', 'Indian/Antananarivo'];
  for (const fuseau of fuseaux) assert.equal(langueChoisie({ navigateur: 'en-US', fuseau }), 'fr', fuseau);
});

test('navigateur en anglais dans un pays africain anglophone : anglais (les 19 fuseaux)', () => {
  const villes = ['Lagos', 'Accra', 'Nairobi', 'Johannesburg', 'Kampala', 'Dar_es_Salaam', 'Kigali', 'Lusaka', 'Harare', 'Gaborone',
    'Windhoek', 'Monrovia', 'Freetown', 'Banjul', 'Blantyre', 'Maseru', 'Mbabane', 'Juba', 'Khartoum'];
  assert.equal(villes.length, 19);
  for (const ville of villes) assert.equal(langueChoisie({ navigateur: 'en-GB', fuseau: `Africa/${ville}` }), 'en', ville);
});

test('navigateur en anglais hors d\'Afrique : anglais ; fuseau inconnu : français', () => {
  for (const fuseau of ['Europe/London', 'America/New_York', 'Asia/Kolkata', 'UTC']) {
    assert.equal(langueChoisie({ navigateur: 'en', fuseau }), 'en', fuseau);
  }
  assert.equal(langueChoisie({ navigateur: 'en-US', fuseau: '' }), 'fr');
  assert.equal(langueChoisie({ navigateur: 'en-US', fuseau: 'panne' }), 'fr');
});

test('un choix déjà fait (cookie) passe avant tout', () => {
  assert.equal(langueChoisie({ navigateur: 'en-US', fuseau: 'Africa/Ouagadougou', cookie: 'langue=en' }), 'en');
  assert.equal(langueChoisie({ navigateur: 'en-US', fuseau: 'Africa/Lagos', cookie: 'langue=fr' }), 'fr');
});
