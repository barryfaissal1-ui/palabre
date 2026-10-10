// Tests du calculateur « Combien coûte mon projet ? » : la grille, le calcul, la page.
const test = require('node:test');
const assert = require('node:assert/strict');
const GRILLE = require('../public/js/grille-prix.js');
const { estimerPrix } = require('../public/js/calcul-prix.js');
const { creerApp } = require('../src/app');
const { pool } = require('../src/db/pool');
const { CATEGORIES_DEMANDE, IDENTIFIANTS_RESERVES } = require('../src/utils/validation');

const estimer = (choix) => {
  const { min, max, milieu } = estimerPrix(GRILLE, { taille: 'petite', options: [], delai: 'normal', ...choix });
  return { min, max, milieu };
};

test('grille : montants cohérents et catégories qui existent', () => {
  assert.equal(GRILLE.types.length, 4);
  for (const type of GRILLE.types) {
    assert.ok(Number.isInteger(type.min) && Number.isInteger(type.max) && type.min > 0 && type.min < type.max, type.id);
    assert.ok(CATEGORIES_DEMANDE[type.categorie], `${type.id} : la catégorie « ${type.categorie} » doit exister pour pré-remplir la demande`);
  }
  for (const option of GRILLE.options) assert.ok(Number.isInteger(option.prix) && option.prix > 0, option.id);
  for (const liste of [GRILLE.types, GRILLE.tailles, GRILLE.options, GRILLE.delais]) {
    assert.equal(new Set(liste.map((e) => e.id)).size, liste.length, 'pas deux fois le même id');
  }
  assert.equal(GRILLE.tailles[0].pourcentage, 0);
  assert.equal(GRILLE.delais[0].pourcentage, 0);
});

test('prix de base : la fourchette de chaque type, sans option ni majoration', () => {
  assert.deepEqual(estimer({ type: 'site-vitrine' }), { min: 75000, max: 150000, milieu: 115000 });
  assert.deepEqual(estimer({ type: 'boutique-en-ligne' }), { min: 200000, max: 450000, milieu: 325000 });
  assert.deepEqual(estimer({ type: 'appli-mobile' }), { min: 350000, max: 900000, milieu: 625000 });
  assert.deepEqual(estimer({ type: 'logiciel-gestion' }), { min: 250000, max: 700000, milieu: 475000 });
});

test('taille : +30 % de 6 à 15, +60 % au-delà, sur le prix de base seulement', () => {
  // 75 000 × 1,3 = 97 500 → 100 000 ; 150 000 × 1,3 = 195 000
  assert.deepEqual(estimer({ type: 'site-vitrine', taille: 'moyenne' }), { min: 100000, max: 195000, milieu: 150000 });
  // 350 000 × 1,6 = 560 000 ; 900 000 × 1,6 = 1 440 000
  assert.deepEqual(estimer({ type: 'appli-mobile', taille: 'grande' }), { min: 560000, max: 1440000, milieu: 1000000 });
  // La majoration ne touche pas les options : 200 000 × 1,3 + 75 000 = 335 000 (et non 357 500).
  assert.equal(estimer({ type: 'boutique-en-ligne', taille: 'moyenne', options: ['mobile-money'] }).min, 335000);
});

test('options : chaque case cochée ajoute son prix, une seule fois', () => {
  assert.deepEqual(estimer({ type: 'site-vitrine', options: ['logo'] }), { min: 100000, max: 175000, milieu: 140000 });
  const toutes = ['mobile-money', 'administration', 'langues', 'logo', 'hebergement']; // 240 000 en tout
  assert.deepEqual(estimer({ type: 'site-vitrine', options: toutes }), { min: 315000, max: 390000, milieu: 355000 });
  assert.equal(estimer({ type: 'site-vitrine', options: ['logo', 'logo'] }).min, 100000, 'une option en double ne compte qu\'une fois');
});

test('délai urgent : +25 % sur le total, options comprises', () => {
  // (75 000 + 25 000) × 1,25 = 125 000 ; (150 000 + 25 000) × 1,25 = 218 750 → 220 000
  assert.deepEqual(estimer({ type: 'site-vitrine', options: ['logo'], delai: 'urgent' }), { min: 125000, max: 220000, milieu: 175000 });
});

test('calcul complet : (base × taille) + options, × 1,25 si urgent, arrondi à 5 000', () => {
  // Boutique, 6 à 15 pages, Mobile Money + logo, urgent :
  //   min : (200 000 × 1,3 + 100 000) × 1,25 = 450 000
  //   max : (450 000 × 1,3 + 100 000) × 1,25 = 856 250 → 855 000
  //   milieu : 652 500 → 655 000
  assert.deepEqual(
    estimer({ type: 'boutique-en-ligne', taille: 'moyenne', options: ['mobile-money', 'logo'], delai: 'urgent' }),
    { min: 450000, max: 855000, milieu: 655000 },
  );
  // Tous les résultats possibles sont des multiples de 5 000, avec min ≤ milieu ≤ max.
  for (const type of GRILLE.types) {
    for (const taille of GRILLE.tailles) {
      for (const delai of GRILLE.delais) {
        for (const options of [[], ['logo'], GRILLE.options.map((o) => o.id)]) {
          const r = estimer({ type: type.id, taille: taille.id, delai: delai.id, options });
          for (const montant of [r.min, r.max, r.milieu]) assert.equal(montant % 5000, 0);
          assert.ok(r.min <= r.milieu && r.milieu <= r.max);
        }
      }
    }
  }
});

test('un choix qui n\'existe pas est refusé', () => {
  assert.throws(() => estimer({ type: 'fusee' }), /type de projet/);
  assert.throws(() => estimer({ type: 'site-vitrine', taille: 'geante' }), /taille/);
  assert.throws(() => estimer({ type: 'site-vitrine', options: ['piscine'] }), /options/);
  assert.throws(() => estimer({ type: 'site-vitrine', delai: 'hier' }), /délai/);
  assert.throws(() => estimerPrix(GRILLE, {}), /type de projet/);
});

test('la page /calculateur est ouverte à tous, avec ses balises de partage', async () => {
  const serveur = creerApp().listen(0);
  try {
    const base = `http://localhost:${serveur.address().port}`;
    const page = await fetch(`${base}/calculateur`);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /data-calculateur/);
    assert.ok(html.includes('<meta property="og:title" content="Combien coûte mon projet ? – Palabre">'));
    assert.ok(html.includes('<meta property="og:url" content="http://localhost:3000/calculateur">'));
    assert.match(html, /<meta property="og:description" content="[^"]+FCFA[^"]*">/);
    assert.equal((html.match(/<title>/g) || []).length, 1);
    for (const script of ['/js/grille-prix.js', '/js/calcul-prix.js', '/js/calculateur.js']) {
      assert.ok(html.includes(`src="${script}?v=`), script); // l'adresse porte l'empreinte du fichier (cache long)
      assert.equal((await fetch(`${base}${script}`)).status, 200, script);
    }
    assert.ok(IDENTIFIANTS_RESERVES.has('calculateur'), 'aucun membre ne peut prendre « calculateur » comme identifiant');
  } finally {
    serveur.close();
    await pool.end();
  }
});
