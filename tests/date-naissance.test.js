// Tests de la date de naissance en trois listes (public/js/date-naissance.js) : la date composée dans le navigateur
// est bien celle que le serveur attend (« AAAA-MM-JJ »), et les dates impossibles sont refusées des deux côtés.
const test = require('node:test');
const assert = require('node:assert/strict');
const { dateComposee, anneesProposees, lireDate, MOIS } = require('../public/js/date-naissance');
const profilDev = require('../src/utils/profil-dev');

test('date composée : jour, mois et année donnent « AAAA-MM-JJ »', () => {
  assert.equal(dateComposee(5, 3, 1998), '1998-03-05');
  assert.equal(dateComposee(31, 12, 1940), '1940-12-31');
  // Les listes envoient du texte : « 7 », « 11 », « 2001 ».
  assert.equal(dateComposee('7', '11', '2001'), '2001-11-07');
  assert.equal(dateComposee(29, 2, 2000), '2000-02-29'); // année bissextile
});

test('date composée : une date impossible ou incomplète donne null', () => {
  assert.equal(dateComposee(31, 2, 1998), null); // 31 février
  assert.equal(dateComposee(30, 2, 2000), null);
  assert.equal(dateComposee(29, 2, 2001), null); // 2001 n'est pas bissextile
  assert.equal(dateComposee(31, 4, 1995), null); // avril a 30 jours
  for (const [j, m, a] of [['', 3, 1998], [5, '', 1998], [5, 3, ''], [0, 3, 1998], [5, 13, 1998], [5, 0, 1998], ['abc', 3, 1998], [1.5, 3, 1998]]) {
    assert.equal(dateComposee(j, m, a), null, `${j}/${m}/${a}`);
  }
});

test('message clair pour une date incomplète ou qui n\'existe pas', () => {
  assert.deepEqual(lireDate('5', '3', '1998'), { date: '1998-03-05' });
  assert.match(lireDate('', '3', '1998').erreur, /Choisis le jour, le mois et l'année/);
  assert.equal(lireDate('31', '2', '1998').erreur, 'Cette date n\'existe pas : il n\'y a pas de 31 février.');
  assert.equal(lireDate('29', '2', '2001').erreur, 'Cette date n\'existe pas : il n\'y a pas de 29 février en 2001.');
  assert.equal(MOIS.length, 12);
});

test('années proposées : de « il y a 18 ans » (en premier) jusqu\'à 1940', () => {
  const annees = anneesProposees(new Date('2026-10-10T12:00:00Z'));
  assert.equal(annees[0], 2008);
  assert.equal(annees[annees.length - 1], 1940);
  assert.equal(annees.length, 69);
  assert.deepEqual(annees.slice(0, 3), [2008, 2007, 2006]);
});

test('le serveur accepte la date composée, et refuse toujours les moins de 18 ans', () => {
  // Ce que le navigateur envoie est exactement ce que la validation du serveur attend.
  assert.equal(profilDev.dateNaissance(dateComposee(15, 5, 1995)), '1995-05-15');
  // L'année la plus récente des listes peut encore donner 17 ans (anniversaire pas encore passé) : le serveur tranche.
  const annee = new Date().getFullYear() - 18;
  assert.throws(() => profilDev.dateNaissance(dateComposee(31, 12, annee + 1)), /18 ans/);
  assert.throws(() => profilDev.dateNaissance('1998-02-31'), /Date invalide/); // même sans passer par la page
});
