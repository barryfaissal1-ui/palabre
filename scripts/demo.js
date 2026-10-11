// Peuple le site avec un contenu de démonstration : membres, amis, publications, j'aime, commentaires,
// projets, demandes, propositions, équipe éclair, avis.
//   npm run demo             crée le contenu ; ne fait RIEN si les comptes de démonstration existent déjà
//                            (il leur ajoute seulement les conversations privées, si elles manquent)
//   npm run demo -- retirer  retire les comptes de démonstration et tout leur contenu
//   npm run demo -- --admin  (en production seulement) donne aussi le tableau /admin au compte dev@demo.palabre.dev
//
// Tous les comptes de démonstration ont un email en …@demo.palabre.dev : c'est ce qui permet de les reconnaître
// et de les retirer d'un coup (leurs publications, projets, demandes… partent avec eux, ON DELETE CASCADE).
// Leur mot de passe et leur liste sont dans docs/COMPTES-DEMO.md : c'est ce qu'on donne au jury.
//
// Le script passe par la vraie API du site (un serveur démarré juste pour lui) : les données respectent donc
// les mêmes règles que celles d'un vrai membre. Seuls les projets et les dates sont écrits directement en base.
// Les images sont dessinées par le script lui-même (de fausses captures d'écran) : aucune photo de personne.
const zlib = require('node:zlib');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const { pool, transaction } = require('../src/db/pool');
const { migrer } = require('../src/db/migrate');
const { creerApp } = require('../src/app');
const mailer = require('../src/utils/mailer');
const { jetonOuverture } = require('../src/utils/inscription');

const MOT_DE_PASSE = 'Palabre-Jury-2026'; // le même que dans docs/COMPTES-DEMO.md
const MOTIF_EMAIL = '%@demo.palabre.dev';
const ANCIEN_MOTIF = 'demo-%@palabre.test'; // comptes d'une première version du script
const email = (cle) => `${cle}@demo.palabre.dev`;

// cle, type, nom, ville, pays, disponible, bio, compétences, nombre de projets au lien vérifié
const MEMBRES = [
  ['awa', 'dev', 'Awa Ouédraogo', 'Koudougou', 'Burkina Faso', true, 'Développeuse full-stack, Node.js et PostgreSQL. Toujours partante pour une équipe éclair.', ['JavaScript', 'Node.js', 'PostgreSQL'], 4],
  ['bintou', 'dev', 'Bintou Traoré', 'Koudougou', 'Burkina Faso', true, 'J\'aide les commerçants à vendre en ligne, avec le paiement par Mobile Money.', ['JavaScript', 'React', 'Mobile Money'], 6],
  ['cheick', 'dev', 'Cheick Diallo', 'Ouagadougou', 'Burkina Faso', true, 'Applications mobiles Flutter pour les PME. Ancien de l\'université Joseph Ki-Zerbo.', ['Flutter', 'Dart', 'Firebase'], 2],
  ['fatou', 'dev', 'Fatoumata Koné', 'Abidjan', 'Côte d\'Ivoire', true, 'Dix ans de web. Livraison, restauration, paiement Wave : j\'ai fait le tour.', ['PHP', 'Laravel', 'MySQL'], 11],
  ['idrissa', 'dev', 'Idrissa Sawadogo', 'Bobo-Dioulasso', 'Burkina Faso', true, 'Étudiant en informatique, je cherche mes premiers clients.', ['HTML', 'CSS', 'JavaScript'], 0],
  ['mariam', 'dev', 'Mariam Sow', 'Dakar', 'Sénégal', true, 'Designer devenue développeuse. Des interfaces simples, pensées pour le téléphone.', ['UI/UX', 'Figma', 'CSS'], 3],
  ['kofi', 'dev', 'Kofi Mensah', 'Lomé', 'Togo', true, 'Logiciels de gestion pour écoles et pharmacies. Python avant tout.', ['Python', 'Django', 'PostgreSQL'], 8],
  ['oumar', 'dev', 'Oumar Bah', 'Bamako', 'Mali', false, 'Développeur backend. En mission jusqu\'à la fin du mois.', ['Java', 'Spring', 'Docker'], 1],
  ['aminata', 'dev', 'Aminata Diop', 'Thiès', 'Sénégal', true, 'WordPress et boutiques en ligne pour les artisans.', ['WordPress', 'PHP', 'SEO'], 5],
  ['yao', 'dev', 'Yao Kouassi', 'Bouaké', 'Côte d\'Ivoire', true, 'Mobile et web, avec une préférence pour le hors-ligne : là où le réseau est capricieux.', ['React Native', 'TypeScript', 'Node.js'], 2],
  ['nadege', 'dev', 'Nadège Mbarga', 'Douala', 'Cameroun', false, 'Données et tableaux de bord. Je transforme les fichiers Excel en outils.', ['Python', 'SQL', 'Power BI'], 1],
  ['ibrahim', 'dev', 'Ibrahim Maïga', 'Niamey', 'Niger', true, 'Sites vitrines rapides et pas chers pour les associations.', ['HTML', 'CSS', 'WordPress'], 0],
  ['salimata', 'client', 'Salimata Dao', 'Ouagadougou', 'Burkina Faso', true, 'Gérante d\'une boutique de pagnes et de bijoux.', [], 0],
  ['pascal', 'client', 'Pascal Zongo', 'Koudougou', 'Burkina Faso', true, 'Directeur d\'un collège privé.', [], 0],
  ['esther', 'client', 'Esther Akakpo', 'Cotonou', 'Bénin', true, 'Restauratrice, deux maquis et bientôt un troisième.', [], 0],
];

// Profil de dev de chaque compte (l'étape 2 de l'inscription) : spécialité, expérience, année de naissance inventée.
const PROFILS_DEV = {
  awa: ['web', '3-5', 1996], bintou: ['web', 'plus-5', 1992], cheick: ['mobile', '3-5', 1995], fatou: ['back-end', 'plus-5', 1988],
  idrissa: ['front-end', 'moins-1', 2004], mariam: ['design', '3-5', 1994], kofi: ['back-end', 'plus-5', 1990], oumar: ['back-end', '3-5', 1993],
  aminata: ['web', '3-5', 1997], yao: ['mobile', '1-2', 1999], nadege: ['data-ia', '1-2', 1998], ibrahim: ['front-end', 'moins-1', 2003],
};

const AMITIES = [
  ['awa', 'bintou'], ['awa', 'cheick'], ['awa', 'kofi'], ['awa', 'mariam'], ['bintou', 'cheick'], ['bintou', 'fatou'], ['bintou', 'aminata'],
  ['cheick', 'yao'], ['fatou', 'yao'], ['fatou', 'kofi'], ['mariam', 'aminata'], ['kofi', 'nadege'], ['idrissa', 'ibrahim'], ['idrissa', 'awa'],
  ['oumar', 'kofi'], ['salimata', 'bintou'], ['pascal', 'kofi'],
];

// Publications, de la plus ancienne à la plus récente : auteur, type, texte, photo (numéro de public/img/fond), qui aime, commentaires.
const PUBLICATIONS = [
  ['kofi', 'projet', 'Le logiciel de gestion du collège Sainte-Thérèse est en service : notes, bulletins et paiements des frais de scolarité. Trois mois de travail, zéro papier perdu depuis.', 4, ['awa', 'fatou', 'nadege', 'pascal', 'oumar', 'bintou'], [['pascal', 'Les parents reçoivent enfin les bulletins à temps. Merci Kofi.'], ['nadege', 'Tu génères les bulletins en PDF côté serveur ?'], ['kofi', 'Oui, avec un modèle par classe. Je peux te montrer.']]],
  ['idrissa', 'question', 'Je débute et je dois choisir : apprendre React ou rester sur du JavaScript simple pour mes premiers sites ? Vos avis m\'intéressent.', null, ['ibrahim', 'awa'], [['awa', 'Reste simple tant que tu n\'es pas à l\'aise avec le DOM. React viendra tout seul après.'], ['mariam', 'D\'accord avec Awa. Les clients veulent un site qui marche, pas un framework.']]],
  ['fatou', 'idee', 'Petit rappel du vendredi : compressez vos images. Sur un forfait de 500 Mo, une page de 4 Mo, c\'est un client qui ne revient pas.', null, ['bintou', 'yao', 'kofi', 'mariam', 'cheick', 'aminata', 'awa'], [['yao', 'Et testez en 3G bridée dans le navigateur. Ça calme.']]],
  ['mariam', 'projet', 'Refonte du site de la coopérative de karité de Thiès. Avant : un PDF. Maintenant : un catalogue, les prix, et un bouton WhatsApp.', 3, ['aminata', 'awa', 'fatou', 'bintou'], [['aminata', 'Très propre. La galerie se charge vite, bravo.']]],
  ['cheick', 'question', 'Quelqu\'un a déjà intégré Orange Money dans une appli Flutter ? Je cherche un retour d\'expérience sur les délais de validation du compte marchand.\n\nJ\'ai lu la documentation trois fois et il me reste des doutes sur le mode bac à sable.\n\nPremier point : les notifications de paiement arrivent-elles toujours ?\n\nDeuxième point : comment tester un remboursement ?\n\nMerci d\'avance à ceux qui prendront le temps de répondre.', null, ['awa', 'bintou', 'yao'], [['bintou', 'Oui, sur deux projets. Compte une bonne semaine pour la validation.'], ['yao', 'Les notifications arrivent, mais prévois une vérification toutes les minutes en secours.'], ['cheick', 'Merci à vous deux, c\'est exactement ce qu\'il me fallait.']]],
  ['aminata', 'idee', 'On devrait avoir une liste commune des hébergeurs qui acceptent le paiement Mobile Money. Qui commence ?', null, ['mariam', 'ibrahim', 'kofi'], []],
  ['yao', 'projet', 'Appli de prise de commande pour les maquis, qui marche sans réseau : les commandes partent dès que la connexion revient.', 1, ['fatou', 'cheick', 'esther', 'awa', 'bintou', 'kofi', 'mariam', 'aminata'], [['esther', 'Je l\'utilise dans mes deux maquis. Les serveurs ont compris en dix minutes.'], ['fatou', 'Le mode hors-ligne, c\'est ce qui manque à presque toutes les applis d\'ici.'], ['cheick', 'Tu stockes en local avec quoi ?'], ['yao', 'SQLite, puis une file d\'attente d\'envoi.']]],
  ['nadege', 'question', 'Vous hébergez vos bases PostgreSQL où, pour des clients au Cameroun ? Je cherche quelque chose de stable et pas trop loin.', null, ['kofi'], [['kofi', 'J\'ai de bons résultats avec un hébergeur à Abidjan. Je t\'envoie le nom.']]],
  ['bintou', 'projet', 'La boutique de pagnes de Salimata est en ligne. Catalogue, panier et paiement Mobile Money : tout fonctionne sur un petit téléphone.', 5, ['salimata', 'cheick', 'fatou', 'awa', 'aminata', 'kofi'], [['salimata', 'Trois commandes dès le premier jour. Je n\'en reviens pas.'], ['cheick', 'Le panier est rapide même en 3G, beau travail.'], ['awa', 'Félicitations Bintou.']]],
  ['ibrahim', 'idee', 'Un site vitrine n\'a pas besoin de base de données. Du HTML, du CSS, un formulaire : c\'est rapide, pas cher, et ça ne tombe jamais en panne.', null, ['idrissa', 'fatou'], [['idrissa', 'Je note. Je me compliquais la vie.']]],
  ['awa', 'idee', 'Et si on organisait un atelier Git à Koudougou le mois prochain ? Une matinée, gratuit, pour les étudiants. Qui serait partant pour animer avec moi ?', null, ['bintou', 'cheick', 'idrissa', 'kofi', 'mariam'], [['bintou', 'Partante. Je peux prendre la partie « travailler à plusieurs ».'], ['idrissa', 'Je viens, et j\'amène ma promo.']]],
  ['oumar', 'question', 'Docker sur un petit serveur de 1 Go de mémoire : bonne ou mauvaise idée ?', null, ['kofi', 'nadege'], [['kofi', 'Pour une seule appli, ça passe. Pour trois, non.']]],
  ['fatou', 'projet', 'Nouvelle version de l\'appli de livraison pour les maquis d\'Abidjan : suivi du livreur en direct et paiement Wave.', 2, ['bintou', 'kofi', 'yao', 'esther', 'mariam', 'awa', 'cheick'], [['esther', 'On peut l\'avoir à Cotonou ?'], ['fatou', 'On en parle ! Publie une demande, je te réponds avec Yao.']]],
  ['mariam', 'idee', 'Avant de coder, dessinez l\'écran sur une feuille et montrez-la au client. Dix minutes de crayon évitent trois jours de modifications.', null, ['awa', 'aminata', 'idrissa', 'bintou'], []],
  ['kofi', 'question', 'Comment vous fixez vos prix pour un logiciel de gestion ? Au forfait, ou à la journée ?', null, ['fatou', 'nadege', 'awa'], [['fatou', 'Au forfait, avec un acompte de 40 %. Jamais sans acompte.'], ['awa', 'Le calculateur de Palabre donne une bonne base pour démarrer la discussion.']]],
  ['bintou', 'idee', 'Le badge « Lien vérifié » m\'a déjà valu deux contacts cette semaine. Mettez vos projets en ligne, même les petits.', null, ['awa', 'cheick', 'aminata', 'yao', 'kofi'], [['aminata', 'Pareil ici. Les clients regardent d\'abord les projets.']]],
];

const SECTEURS_DEMO = ['commerce', 'restauration', 'education', 'sante', 'agriculture', 'finance', 'transport', 'services', 'culture'];
const TITRES_PROJETS = {
  commerce: 'Boutique en ligne', restauration: 'Commandes d\'un restaurant', education: 'Gestion d\'une école', sante: 'Rendez-vous d\'une clinique',
  agriculture: 'Suivi d\'une coopérative', finance: 'Tontine sur téléphone', transport: 'Suivi de livraisons', services: 'Site d\'une association', culture: 'Billetterie d\'un festival',
};

// ---------- Images de démonstration, dessinées ici ----------
// Une fausse capture d'écran d'application : un bandeau de couleur, un titre, des cartes. Le script remplit un tableau
// de pixels puis l'enregistre en PNG (format simple : un en-tête, les pixels compressés par zlib, des sommes de contrôle).
const COULEURS = [[200, 98, 63], [24, 122, 59], [168, 106, 18], [63, 76, 154], [107, 74, 53], [31, 110, 140]];
const TABLE_CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(octets) {
  let c = 0xffffffff;
  for (const octet of octets) c = TABLE_CRC[(c ^ octet) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function png(largeur, hauteur, pixels) {
  // Chaque ligne commence par un octet de « filtre ». Le filtre 1 (Sub) enregistre chaque valeur comme sa différence
  // avec le pixel de gauche : un dégradé devient une suite de petits nombres, que zlib compresse très bien.
  const lignes = Buffer.alloc((largeur * 3 + 1) * hauteur);
  for (let y = 0; y < hauteur; y += 1) {
    const d = y * (largeur * 3 + 1);
    lignes[d] = 1;
    for (let x = 0; x < largeur * 3; x += 1) {
      const gauche = x >= 3 ? pixels[y * largeur * 3 + x - 3] : 0;
      lignes[d + 1 + x] = (pixels[y * largeur * 3 + x] - gauche) & 0xff;
    }
  }
  const bloc = (type, donnees) => {
    const corps = Buffer.concat([Buffer.from(type), donnees]);
    const longueur = Buffer.alloc(4); longueur.writeUInt32BE(donnees.length);
    const somme = Buffer.alloc(4); somme.writeUInt32BE(crc32(corps));
    return Buffer.concat([longueur, corps, somme]);
  };
  const entete = Buffer.alloc(13);
  entete.writeUInt32BE(largeur, 0); entete.writeUInt32BE(hauteur, 4);
  entete[8] = 8; entete[9] = 2; // 8 bits par couleur, rouge-vert-bleu
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), bloc('IHDR', entete), bloc('IDAT', zlib.deflateSync(lignes)), bloc('IEND', Buffer.alloc(0))]);
}
// Couverture de profil : un dégradé doux entre deux couleurs du logo, et par-dessus un motif géométrique très fin
// (lignes obliques, losanges, chevrons ou points). Le numéro choisit les couleurs, l'angle et le motif :
// chaque membre a une couverture différente.
const DEGRADES = [
  [[15, 61, 34], [34, 160, 75]], [[122, 52, 30], [200, 98, 63]], [[31, 54, 92], [31, 110, 140]], [[70, 44, 30], [168, 106, 18]],
  [[24, 122, 59], [168, 150, 60]], [[84, 40, 68], [200, 98, 63]], [[18, 48, 44], [31, 110, 140]], [[107, 74, 53], [214, 150, 110]],
];
function couverture(numero, largeur, hauteur) {
  const pixels = Buffer.alloc(largeur * hauteur * 3);
  const [depart, arrivee] = DEGRADES[numero % DEGRADES.length];
  const angle = [0.35, 0.6, 0.15, 0.8][numero % 4]; // part de la hauteur dans la direction du dégradé
  const motif = Math.floor(numero / 2) % 4;
  const pas = 28 + (numero % 3) * 8;
  for (let y = 0; y < hauteur; y += 1) {
    for (let x = 0; x < largeur; x += 1) {
      const t = Math.min(1, Math.max(0, (x / largeur) * (1 - angle) + (y / hauteur) * angle));
      // Le motif éclaircit légèrement certains pixels (12 % de blanc) : on le devine sans qu'il s'impose.
      let trait = false;
      if (motif === 0) trait = (x + y) % pas < 2;                                             // lignes obliques
      else if (motif === 1) trait = (x + y) % pas < 2 || (x - y + 4000) % pas < 2;            // losanges
      else if (motif === 2) trait = Math.abs(((x % pas) - pas / 2)) + (y % pas) === pas / 2 || Math.abs(((x % pas) - pas / 2)) + (y % pas) === pas / 2 + 1; // chevrons
      else trait = (x % pas) < 3 && (y % pas) < 3;                                            // points
      const i = (y * largeur + x) * 3;
      for (let c = 0; c < 3; c += 1) {
        const valeur = depart[c] + (arrivee[c] - depart[c]) * t;
        pixels[i + c] = Math.round(trait ? valeur + (255 - valeur) * 0.12 : valeur);
      }
    }
  }
  return pixels;
}

// numero choisit la couleur et la disposition ; « large » donne un format de couverture de profil.
function maquette(numero, { large = false } = {}) {
  const [largeur, hauteur] = large ? [1200, 400] : [[900, 600], [720, 900], [900, 675]][numero % 3];
  const pixels = Buffer.alloc(largeur * hauteur * 3);
  const couleur = COULEURS[numero % COULEURS.length];
  const rectangle = (x0, y0, l, h, [r, g, b]) => {
    for (let y = Math.max(0, y0); y < Math.min(hauteur, y0 + h); y += 1) {
      for (let x = Math.max(0, x0); x < Math.min(largeur, x0 + l); x += 1) {
        const i = (y * largeur + x) * 3;
        pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b;
      }
    }
  };
  const clair = couleur.map((c) => Math.round(c + (255 - c) * 0.82));
  rectangle(0, 0, largeur, hauteur, [241, 240, 235]);
  if (large) return png(largeur, hauteur, couverture(numero, largeur, hauteur));
  rectangle(0, 0, largeur, 84, couleur);                         // bandeau du haut
  rectangle(32, 28, 180, 28, [255, 255, 255]);                   // nom de l'application
  rectangle(largeur - 76, 22, 40, 40, clair);                    // avatar
  rectangle(32, 116, Math.round(largeur * 0.55), 34, [26, 28, 24]); // titre
  rectangle(32, 164, Math.round(largeur * 0.38), 16, [150, 152, 146]);
  const colonnes = numero % 2 ? 2 : 3;
  const l = Math.floor((largeur - 32 * (colonnes + 1)) / colonnes);
  for (let rangee = 0; rangee * 250 + 210 < hauteur; rangee += 1) {
    for (let c = 0; c < colonnes; c += 1) {
      const x = 32 + c * (l + 32); const y = 210 + rangee * 250;
      rectangle(x, y, l, 218, [255, 255, 255]);
      rectangle(x, y, l, 120, (c + rangee + numero) % 2 ? clair : couleur.map((v) => Math.round(v + (255 - v) * 0.45)));
      rectangle(x + 16, y + 138, Math.round(l * 0.7), 16, [26, 28, 24]);
      rectangle(x + 16, y + 166, Math.round(l * 0.45), 12, [150, 152, 146]);
      rectangle(x + 16, y + 186, 84, 20, couleur);
    }
  }
  return png(largeur, hauteur, pixels);
}

async function retirer() {
  const { rowCount } = await pool.query('DELETE FROM utilisateurs WHERE email LIKE $1 OR email LIKE $2', [MOTIF_EMAIL, ANCIEN_MOTIF]);
  return rowCount;
}

// Les comptes de démonstration sont « confirmés et complets » : email confirmé, profil de dev rempli.
// Écrit directement en base (aucun email à envoyer, aucun lien à visiter) et sans risque d'être rejoué :
// seuls les profils encore incomplets sont touchés. Sert aussi aux comptes créés par une version précédente du script.
// ATTENTION : comme pour les projets, le lien de portfolio est inventé et marqué « vérifié » pour la démonstration.
// Les devs sans projet vérifié (Idrissa, Ibrahim) n'ont pas de lien : ils montrent la mention « Profil à confirmer ».
async function completerProfils() {
  await pool.query('UPDATE utilisateurs SET email_confirme_le = now() WHERE email LIKE $1 AND email_confirme_le IS NULL', [MOTIF_EMAIL]);
  let nombre = 0;
  for (const [cle, type, , , , , , , verifies] of MEMBRES) {
    if (type !== 'dev') continue;
    const [specialite, experience, annee] = PROFILS_DEV[cle];
    const { rowCount } = await pool.query(
      `UPDATE utilisateurs
          SET specialite = $2, experience = $3, date_naissance = make_date($4, 5, 15), profil_complete_le = now(),
              lien_portfolio = CASE WHEN $5 THEN 'https://demo.palabre.dev/' || identifiant END,
              lien_portfolio_verifie_le = CASE WHEN $5 THEN now() END
        WHERE email = $1 AND profil_complete_le IS NULL`,
      [email(cle), specialite, experience, annee, verifies > 0],
    );
    nombre += rowCount;
  }
  return nombre;
}

async function creer() {
  await migrer();
  // Déjà fait ? On ne touche à rien : relancer le script ne crée jamais de doublons.
  const { rows: [deja] } = await pool.query('SELECT count(*)::int AS nb FROM utilisateurs WHERE email LIKE $1', [MOTIF_EMAIL]);
  if (deja.nb > 0) return null;
  await pool.query('DELETE FROM utilisateurs WHERE email LIKE $1', [ANCIEN_MOTIF]);
  const serveur = creerApp().listen(0);
  const base = `http://localhost:${serveur.address().port}`;
  const m = {}; // cle → { cookie, identifiant, id }

  async function appel(chemin, { methode = 'GET', donnees, qui } = {}) {
    const headers = {};
    if (donnees) headers['Content-Type'] = 'application/json';
    if (qui) headers.Cookie = m[qui].cookie;
    const reponse = await fetch(`${base}/api${chemin}`, { method: methode, headers, body: donnees ? JSON.stringify(donnees) : undefined });
    const corps = await reponse.json().catch(() => ({}));
    if (!reponse.ok) throw new Error(`${methode} ${chemin} → ${reponse.status} ${corps.erreur || ''}`);
    return { corps, entetes: reponse.headers };
  }
  const poster = (chemin, qui, donnees = {}) => appel(chemin, { methode: 'POST', qui, donnees });
  const dataUrl = (numero, options) => `data:image/png;base64,${maquette(numero, options).toString('base64')}`;

  try {
    // 1. Les comptes, puis leur profil (bio, compétences, disponibilité)
    const { corps: { competences } } = await appel('/competences');
    for (const [cle, type, nom, ville, pays, disponible, bio, noms] of MEMBRES) {
      // « Fatoumata Koné » → prénom « Fatoumata », nom de famille « Koné » : les deux champs de l'inscription.
      const [prenom, ...reste] = nom.split(' ');
      const nomFamille = reste.join(' ');
      // jeton : l'heure d'ouverture du formulaire, signée, que l'inscription exige (ici datée de 10 secondes plus tôt).
      const inscription = await appel('/auth/inscription', { methode: 'POST', donnees: { type, prenom, nomFamille, email: email(cle), motDePasse: MOT_DE_PASSE, pays, ville, jeton: jetonOuverture(Date.now() - 10000) } });
      // Pas de code à saisir pour ces comptes : leur email est confirmé tout de suite.
      const { rows } = await pool.query('UPDATE utilisateurs SET email_confirme_le = now() WHERE email = $1 RETURNING id', [email(cle)]);
      m[cle] = { cookie: inscription.entetes.get('set-cookie').split(';')[0], identifiant: inscription.corps.utilisateur.identifiant, id: rows[0].id };
      await appel('/profils/moi', {
        methode: 'PUT', qui: cle,
        donnees: { prenom, nomFamille, identifiant: m[cle].identifiant, pays, ville, bio, disponible, whatsapp: null, competences: competences.filter((c) => noms.includes(c.nom)).map((c) => c.id) },
      });
    }
    await completerProfils(); // avant les propositions : un dev au profil incomplet ne peut pas répondre aux demandes
    // Une couverture différente pour chaque développeur ; les clients gardent le motif tissé du site.
    for (const [rangMembre, [cle, type]] of MEMBRES.entries()) {
      if (type === 'dev') await poster('/profils/moi/couverture', cle, { image: dataUrl(rangMembre, { large: true }) });
    }

    // 2. Les projets réalisés. Écrits directement en base : passer par l'API ferait visiter chaque lien par le serveur.
    //    ATTENTION : ces liens sont inventés et marqués « vérifiés » pour la démonstration.
    let rang = 0;
    for (const [cle, , , , , , , , verifies] of MEMBRES) {
      for (let i = 0; i < verifies + (verifies > 0 && verifies < 4 ? 1 : 0); i += 1) {
        const secteur = SECTEURS_DEMO[rang % SECTEURS_DEMO.length];
        let image = null;
        if (i < 2) { // les deux premiers projets de chaque dev ont une image
          const octets = maquette(rang);
          const { rows } = await pool.query('INSERT INTO fichiers (proprietaire_id, type_mime, taille, donnees) VALUES ($1, \'image/png\', $2, $3) RETURNING id', [m[cle].id, octets.length, octets]);
          image = rows[0].id;
        }
        await pool.query(
          `INSERT INTO projets (dev_id, titre, description, secteur, lien, image, lien_verifie_le, cree_le)
           VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7 THEN now() END, now() - make_interval(days => $8))`,
          [m[cle].id, `${TITRES_PROJETS[secteur]} ${['à', 'pour', 'de'][i % 3]} ${MEMBRES[(rang * 7) % MEMBRES.length][3]}`,
            'Projet de démonstration : conçu pour le téléphone, léger en données, avec paiement par Mobile Money quand il y en a besoin.',
            secteur, `https://demo.palabre.dev/${m[cle].identifiant}/${i + 1}`, image, i < verifies, 3 + rang],
        );
        rang += 1;
      }
    }

    // 3. Les amitiés
    for (const [a, b] of AMITIES) {
      await poster('/amis/demandes', a, { identifiant: m[b].identifiant });
      await poster(`/amis/demandes/${m[a].identifiant}/accepter`, b);
    }

    // 4. Les publications, leurs j'aime et leurs commentaires
    const publications = [];
    for (const [auteur, type, texte, numeroPhoto, aime, commentaires] of PUBLICATIONS) {
      const { corps } = await poster('/publications', auteur, { type, texte, image: numeroPhoto ? dataUrl(numeroPhoto + publications.length) : undefined });
      const { id } = corps.publication;
      publications.push(id);
      for (const qui of aime) await poster(`/publications/${id}/jaime`, qui);
      for (const [qui, commentaire] of commentaires) await poster(`/publications/${id}/commentaires`, qui, { texte: commentaire });
    }
    // Les dates sont étalées sur une semaine (la plus ancienne en premier), sinon tout serait daté « à l'instant ».
    for (const [i, id] of publications.entries()) {
      const heures = (publications.length - i) * 9 + 2;
      await pool.query('UPDATE publications SET cree_le = now() - make_interval(hours => $2) WHERE id = $1', [id, heures]);
      await pool.query('UPDATE commentaires SET cree_le = now() - make_interval(hours => $2) + (id % 7) * interval \'11 minutes\' WHERE publication_id = $1', [id, heures - 1]);
    }

    // 5. Les demandes des clients, les propositions, une équipe éclair, un choix, des avis
    const demander = async (qui, donnees) => (await poster('/demandes', qui, donnees)).corps.demande.id;
    const proposer = (id, qui, message, montantFcfa) => poster(`/demandes/${id}/propositions`, qui, { message, montantFcfa });
    const propositionDe = async (id, client, cle) => (await appel(`/demandes/${id}`, { qui: client })).corps.propositions.find((p) => p.auteur.identifiant === m[cle].identifiant).id;

    // Terminée, avec avis : la boutique de Salimata, réalisée par Bintou
    const boutique = await demander('salimata', { titre: 'Boutique en ligne pour mes pagnes', description: 'Je vends des pagnes et des bijoux à Ouagadougou. Je voudrais un site où mes clientes commandent et paient par Orange Money.', budgetFcfa: 300000, delai: '1 mois', categorie: 'boutique-en-ligne' });
    await proposer(boutique, 'bintou', 'Bonjour Salimata, j\'ai déjà réalisé plusieurs boutiques avec paiement Mobile Money. Je peux livrer en trois semaines.', 280000);
    await proposer(boutique, 'aminata', 'Bonjour, je propose une boutique WordPress simple à gérer vous-même, avec une formation d\'une heure.', 250000);
    await poster(`/demandes/${boutique}/choisir`, 'salimata', { propositionId: await propositionDe(boutique, 'salimata', 'bintou') });
    await poster(`/demandes/${boutique}/terminer`, 'salimata');
    await poster('/avis', 'salimata', { demandeId: boutique, identifiant: m.bintou.identifiant, note: 5, commentaire: 'Livré avant la date, et Bintou m\'a montré comment ajouter mes articles moi-même. Trois commandes dès le premier jour.' });

    // Terminée, avec avis : le logiciel du collège de Pascal, réalisé par Kofi
    const college = await demander('pascal', { titre: 'Logiciel de notes et de bulletins pour un collège', description: 'Collège de 600 élèves à Koudougou. Nous voulons saisir les notes, imprimer les bulletins et suivre les frais de scolarité.', budgetFcfa: 600000, delai: '3 mois', categorie: 'logiciel-gestion' });
    await proposer(college, 'kofi', 'Bonjour, j\'ai développé ce type de logiciel pour deux écoles à Lomé. Je vous propose une démonstration avant de commencer.', 550000);
    await proposer(college, 'nadege', 'Bonjour, je peux aussi reprendre vos fichiers Excel actuels pour ne perdre aucune donnée.', 600000);
    await poster(`/demandes/${college}/choisir`, 'pascal', { propositionId: await propositionDe(college, 'pascal', 'kofi') });
    await poster(`/demandes/${college}/terminer`, 'pascal');
    await poster('/avis', 'pascal', { demandeId: college, identifiant: m.kofi.identifiant, note: 5, commentaire: 'Sérieux et patient avec nos enseignants. Les bulletins sortent en une matinée au lieu d\'une semaine.' });

    // Attribuée à une équipe éclair : Fatou invite Yao, qui accepte ; Esther choisit l'équipe
    const livraison = await demander('esther', { titre: 'Application de livraison pour mes maquis', description: 'J\'ai deux maquis à Cotonou. Je voudrais une application pour que les clients commandent et suivent le livreur, avec paiement à la livraison ou par Mobile Money.', budgetFcfa: 900000, delai: '2 mois', categorie: 'appli-mobile' });
    const equipe = await poster(`/demandes/${livraison}/equipes`, 'fatou', { message: 'Bonjour Esther, nous avons déjà fait cette application à Abidjan. À deux, nous livrons en six semaines.', montantFcfa: 850000, roleChef: 'Serveur et paiement', membres: [{ identifiant: m.yao.identifiant, role: 'Application mobile' }] });
    await poster(`/equipes/${equipe.corps.propositions.find((p) => p.equipe).equipe.id}/accepter`, 'yao');
    await proposer(livraison, 'cheick', 'Bonjour, je peux réaliser l\'application en Flutter pour Android et iPhone.', 800000);
    await poster(`/demandes/${livraison}/choisir`, 'esther', { propositionId: await propositionDe(livraison, 'esther', 'fatou') });
    // Le groupe de discussion de l'équipe (créé avec elle) : la cheffe, Yao qui a accepté, puis Esther qui les a choisis.
    const groupeLivraison = equipe.corps.propositions.find((p) => p.equipe).equipe.groupeId;
    for (const [qui, texte] of [
      ['fatou', 'Bienvenue Esther ! Voici l\'équipe : je m\'occupe du serveur et du paiement, Yao de l\'application.'],
      ['esther', 'Merci à vous deux. Mes deux maquis ferment à 23 h : il faudrait que les commandes s\'arrêtent à 22 h 30.'],
      ['yao', 'Noté. Je prévois un réglage « heure de la dernière commande » par maquis.'],
      ['fatou', 'Première démonstration vendredi, sur un téléphone d\'entrée de gamme. On vous envoie le lien ici.'],
    ]) await poster(`/messages/groupes/${groupeLivraison}`, qui, { texte });

    // Ouvertes : elles attendent des propositions
    const vitrine = await demander('salimata', { titre: 'Site vitrine pour une association de femmes', description: 'Notre association forme des jeunes filles à la couture. Nous voulons un site simple : qui nous sommes, nos activités, comment nous aider.', budgetFcfa: 100000, delai: '3 semaines', categorie: 'site-web' });
    await proposer(vitrine, 'ibrahim', 'Bonjour, c\'est exactement le type de site que je fais pour les associations, rapide et facile à mettre à jour.', 90000);
    await proposer(vitrine, 'idrissa', 'Bonjour, je débute mais je suis disponible tout de suite et je vous montre l\'avancement chaque semaine.', 75000);
    await demander('pascal', { titre: 'Paiement des frais de scolarité par Mobile Money', description: 'Nous voudrions que les parents puissent payer les frais de scolarité depuis leur téléphone et recevoir un reçu.', budgetFcfa: 250000, delai: '1 mois', categorie: 'paiement-mobile' });
    await demander('esther', { titre: 'Logo et menu pour un nouveau maquis', description: 'J\'ouvre un troisième maquis à Cotonou. Il me faut un logo, une carte des plats à imprimer et les visuels pour Facebook.', budgetFcfa: null, delai: '2 semaines', categorie: 'design' });

    // 6. En local seulement, un peu de vie pour les vrais comptes déjà inscrits : deux membres de démonstration
    //    leur demandent d'être amis. Jamais en production : on n'écrit pas aux vrais membres du site.
    const { rows: vrais } = config.production ? { rows: [] } : await pool.query('SELECT identifiant FROM utilisateurs WHERE email NOT LIKE $1 AND email NOT LIKE \'%@palabre.test\' AND bloque = FALSE LIMIT 20', [MOTIF_EMAIL]);
    for (const { identifiant } of vrais) {
      for (const cle of ['awa', 'bintou']) await poster('/amis/demandes', cle, { identifiant }).catch(() => {});
    }
    // Les sessions ouvertes à l'inscription servent ensuite aux conversations : inutile de se reconnecter.
    const sessions = Object.fromEntries(Object.entries(m).map(([cle, membre]) => [cle, membre.cookie]));
    return { membres: MEMBRES.length, publications: publications.length, vrais: vrais.length, sessions };
  } finally {
    serveur.close();
  }
}

// ---------- Publications avec une vidéo ----------
// De vraies vidéos publiques de cours de programmation en français (YouTube), vérifiées le 10 octobre 2026.
// Écrites à part et directement en base, pour pouvoir être ajoutées à des comptes créés avant cette fonction.
// Ne fait rien si un compte de démonstration a déjà publié une vidéo (pas de doublons).
// auteur, type, texte, identifiant YouTube, il y a combien d'heures, qui aime
const VIDEOS = [
  ['idrissa', 'idee', 'Pour ceux qui débutent comme moi : ce cours de Pierre Giraud sur HTML et CSS est gratuit, en français, et il part vraiment de zéro.', 'Y80juYcu3ZI', 30, ['awa', 'ibrahim', 'mariam']],
  ['nadege', 'idee', 'On me demande souvent par où commencer Python. Je renvoie toujours vers cette série de Graven : courte, claire, en français.', 'psaDHhZ0cPs', 52, ['kofi', 'oumar']],
  ['awa', 'question', 'Je prépare l\'atelier JavaScript du mois prochain. Vous feriez regarder ce cours avant de venir, ou vous avez mieux à conseiller ?', 'VZLflMqC6dI', 7, ['bintou', 'cheick', 'idrissa', 'yao']],
];

async function creerVideos() {
  const { rows: [deja] } = await pool.query(
    'SELECT count(*)::int AS nb FROM publications p JOIN utilisateurs u ON u.id = p.auteur_id WHERE u.email LIKE $1 AND p.video_id IS NOT NULL',
    [MOTIF_EMAIL],
  );
  const { rows: comptes } = await pool.query('SELECT id, email FROM utilisateurs WHERE email LIKE $1', [MOTIF_EMAIL]);
  if (deja.nb > 0 || comptes.length === 0) return 0;
  const id = (cle) => comptes.find((c) => c.email === email(cle)).id;
  for (const [auteur, type, texte, video, heures, aime] of VIDEOS) {
    const { rows: [publication] } = await pool.query(
      `INSERT INTO publications (auteur_id, type, texte, video_plateforme, video_id, cree_le)
       VALUES ($1, $2, $3, 'youtube', $4, now() - make_interval(hours => $5::int)) RETURNING id`,
      [id(auteur), type, texte, video, heures],
    );
    for (const qui of aime) await pool.query('INSERT INTO jaime (publication_id, utilisateur_id) VALUES ($1, $2)', [publication.id, id(qui)]);
  }
  return VIDEOS.length;
}

// ---------- Défis de la semaine ----------
// Deux défis, écrits directement en base (leurs dates sont dans le passé, ce que le site ne permet pas de saisir) :
//  - un défi terminé la semaine dernière, gagné par Fatoumata (son profil porte le badge « Gagnant du défi ») ;
//  - le défi en cours, en phase de vote pour encore 3 jours : on peut voter avec n'importe quel compte.
// Ne fait rien si un compte de démonstration a déjà créé un défi (pas de doublons).
const DEFIS = [
  {
    titre: 'Un reçu de paiement qui passe par SMS',
    probleme: 'Une vendeuse du marché veut envoyer un reçu à chaque client qui paie par Mobile Money, sans imprimante et sans application à installer.\nComment faire tenir un reçu clair et vérifiable dans un simple SMS de 160 caractères ?',
    finReponses: -10, finVote: -7, gagnante: 'fatou',
    reponses: [
      ['fatou', 'Un code court à 6 caractères dans le SMS (montant, date, code). Le client vérifie le reçu en envoyant ce code à un numéro gratuit : le serveur répond par le détail du paiement. Tout tient en 110 caractères.', ['awa', 'bintou', 'kofi', 'salimata', 'yao']],
      ['kofi', 'Je génère le reçu en PDF côté serveur et j\'envoie seulement le lien court dans le SMS. Simple, mais il faut des données mobiles pour l\'ouvrir.', ['nadege', 'oumar']],
      ['yao', 'Un SMS en deux lignes : montant et référence de la transaction de l\'opérateur. La vendeuse garde la liste dans un carnet numérique hors ligne, synchronisé le soir.', ['cheick']],
    ],
  },
  {
    titre: 'Une boutique qui marche sans connexion',
    probleme: 'Dans beaucoup de villes, le réseau coupe plusieurs fois par jour. Un boutiquier doit pourtant continuer à enregistrer ses ventes sur son téléphone.\nComment garder les ventes en sécurité hors connexion, puis les envoyer au serveur sans doublon quand le réseau revient ?',
    finReponses: -1, finVote: 3, gagnante: null,
    reponses: [
      ['awa', 'Chaque vente reçoit un identifiant unique créé sur le téléphone (UUID) et part dans une file d\'attente locale. Au retour du réseau, on envoie la file ; le serveur ignore les identifiants qu\'il connaît déjà. Aucun doublon, même si l\'envoi est répété.', ['bintou', 'kofi', 'pascal']],
      ['yao', 'IndexedDB pour stocker, un service worker avec « background sync » pour renvoyer tout seul. Sur les vieux téléphones sans background sync, un bouton « Envoyer mes ventes ».', ['cheick', 'fatou']],
      ['bintou', 'Je garde les ventes dans le stockage du navigateur et j\'affiche un compteur « 3 ventes à envoyer » toujours visible. Le boutiquier sait où il en est, c\'est ce qui le rassure le plus.', ['awa', 'salimata']],
      ['idrissa', 'Un simple fichier CSV sur le téléphone, envoyé par WhatsApp au comptable en fin de journée. Pas élégant, mais ça marche partout.', []],
    ],
  },
];

async function creerDefis() {
  const { rows: comptes } = await pool.query('SELECT id, email FROM utilisateurs WHERE email LIKE $1', [MOTIF_EMAIL]);
  const { rows: [deja] } = await pool.query('SELECT count(*)::int AS nb FROM defis d JOIN utilisateurs u ON u.id = d.auteur_id WHERE u.email LIKE $1', [MOTIF_EMAIL]);
  if (comptes.length === 0 || deja.nb > 0) return 0;
  const id = (cle) => comptes.find((c) => c.email === email(cle)).id;
  for (const defi of DEFIS) {
    const { rows: [cree] } = await pool.query(
      `INSERT INTO defis (auteur_id, titre, probleme, debut_le, fin_reponses_le, fin_vote_le, statut)
       VALUES ($1, $2, $3, now() + make_interval(days => $4::int - 6), now() + make_interval(days => $4::int), now() + make_interval(days => $5::int), $6) RETURNING id`,
      [id('awa'), defi.titre, defi.probleme, defi.finReponses, defi.finVote, defi.finVote < 0 ? 'termine' : 'ouvert'],
    );
    for (const [auteur, texte, votants] of defi.reponses) {
      const { rows: [reponse] } = await pool.query(
        'INSERT INTO defi_reponses (defi_id, dev_id, texte, cree_le) VALUES ($1, $2, $3, now() + make_interval(days => $4::int - 3)) RETURNING id',
        [cree.id, id(auteur), texte, defi.finReponses],
      );
      for (const votant of votants) await pool.query('INSERT INTO defi_votes (defi_id, utilisateur_id, reponse_id) VALUES ($1, $2, $3)', [cree.id, id(votant), reponse.id]);
      if (auteur === defi.gagnante) await pool.query('UPDATE defis SET gagnant_id = $2, gagnant_reponse_id = $3 WHERE id = $1', [cree.id, id(auteur), reponse.id]);
    }
  }
  return DEFIS.length;
}

// ---------- Conversations privées de démonstration ----------
// Écrites à part, pour pouvoir être ajoutées à des comptes de démonstration créés avant la messagerie.
// Ne fait rien s'il existe déjà une conversation entre deux comptes de démonstration (pas de doublons).
const CONVERSATIONS = [
  // Deux amies qui préparent l'atelier Git. Le dernier message de Bintou reste à lire pour Awa.
  { entre: ['awa', 'bintou'], messages: [
    ['awa', 'Salut Bintou ! Tu es toujours partante pour l\'atelier Git du mois prochain ?'],
    ['bintou', 'Oui, avec plaisir. Je prends la partie « travailler à plusieurs » : les branches, les conflits.'],
    ['awa', 'Parfait. Idrissa amène sa promo, on sera une vingtaine.'],
    ['bintou', 'Il nous faudra une salle avec du courant pour tout le monde. Le centre culturel ?'],
    ['awa', 'Je les appelle demain matin.'],
    ['bintou', 'Super. Je prépare un petit exercice sur un faux projet, je te l\'envoie ce week-end.'],
  ] },
  // Cliente et développeuse, à propos d'une demande : pas besoin d'être amies, la proposition suffit.
  { entre: ['salimata', 'bintou'], demande: 'Boutique en ligne pour mes pagnes', messages: [
    ['salimata', 'Bonjour Bintou, merci pour votre proposition. Est-ce que mes clientes pourront payer par Orange Money ?'],
    ['bintou', 'Bonjour Salimata. Oui, Orange Money et Moov Money. Le paiement arrive directement sur votre compte marchand.'],
    ['salimata', 'Très bien. Et pour ajouter mes nouveaux pagnes, je pourrai le faire moi-même ?'],
    ['bintou', 'Oui : une photo, un prix, un bouton. Je vous montre en une heure à la livraison.'],
    ['salimata', 'Parfait, on y va. Merci encore, les trois premières commandes sont arrivées dès le premier jour !'],
  ] },
  // Cliente et cheffe d'une équipe éclair.
  { entre: ['esther', 'fatou'], demande: 'Application de livraison pour mes maquis', messages: [
    ['esther', 'Bonjour Fatoumata, j\'ai choisi votre équipe. Quand pouvez-vous commencer ?'],
    ['fatou', 'Bonjour Esther, merci pour votre confiance. Lundi, avec Yao pour la partie mobile.'],
    ['fatou', 'Pouvez-vous m\'envoyer la carte de vos deux maquis et les zones de livraison ?'],
    ['esther', 'Je vous envoie tout ça ce soir.'],
  ] },
  // Une demande de message en attente : Idrissa et Fatoumata ne sont pas amis.
  { entre: ['idrissa', 'fatou'], messages: [
    ['idrissa', 'Bonjour Fatoumata, je suis étudiant à Bobo et j\'admire votre travail. Accepteriez-vous de jeter un œil à mon premier site ?'],
  ] },
];

// sessions : les cookies des comptes qui viennent d'être créés. Sans eux (comptes créés lors d'un lancement
// précédent), le script se connecte. On évite ainsi de dépasser la limite de 20 inscriptions et connexions
// par quart d'heure quand tout est créé d'un coup.
async function creerConversations(sessions = null) {
  const { rows: [deja] } = await pool.query(
    `SELECT count(*)::int AS nb FROM conversations c
       JOIN utilisateurs a ON a.id = c.membre_a JOIN utilisateurs b ON b.id = c.membre_b
      WHERE a.email LIKE $1 AND b.email LIKE $1`,
    [MOTIF_EMAIL],
  );
  if (deja.nb > 0) return 0;

  const serveur = creerApp().listen(0);
  const base = `http://localhost:${serveur.address().port}`;
  const cookies = { ...sessions };
  const appel = async (chemin, qui, donnees) => {
    const reponse = await fetch(`${base}/api${chemin}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(qui ? { Cookie: cookies[qui] } : {}) }, body: JSON.stringify(donnees) });
    const corps = await reponse.json().catch(() => ({}));
    if (!reponse.ok) throw new Error(`POST ${chemin} → ${reponse.status} ${corps.erreur || ''}`);
    return { corps, entetes: reponse.headers };
  };
  try {
    for (const cle of new Set(CONVERSATIONS.flatMap((c) => c.entre))) {
      if (cookies[cle]) continue;
      const connexion = await appel('/auth/connexion', null, { email: email(cle), motDePasse: MOT_DE_PASSE });
      cookies[cle] = connexion.entetes.get('set-cookie').split(';')[0];
    }
    const { rows: comptes } = await pool.query('SELECT email, identifiant FROM utilisateurs WHERE email LIKE $1', [MOTIF_EMAIL]);
    const identifiant = (cle) => comptes.find((c) => c.email === email(cle)).identifiant;

    for (const [rang, conversation] of CONVERSATIONS.entries()) {
      let demandeId;
      if (conversation.demande) {
        const { rows } = await pool.query(
          'SELECT d.id FROM demandes d JOIN utilisateurs u ON u.id = d.client_id WHERE d.titre = $1 AND u.email LIKE $2 ORDER BY d.id DESC LIMIT 1',
          [conversation.demande, MOTIF_EMAIL],
        );
        demandeId = rows[0] && rows[0].id;
      }
      let conversationId = null;
      for (const [auteur, texte] of conversation.messages) {
        const autre = conversation.entre.find((cle) => cle !== auteur);
        const { corps } = await appel(`/messages/avec/${identifiant(autre)}`, auteur, { texte, ...(demandeId ? { demandeId } : {}) });
        conversationId = corps.conversationId;
      }
      // Les messages sont étalés sur les deux derniers jours (sinon tout serait daté de la même seconde).
      const fin = 40 + rang * 95; // minutes écoulées depuis le dernier message de cette conversation
      await pool.query(
        `UPDATE messages m SET cree_le = now() - make_interval(mins => ($2 + (t.total - t.position) * 37)::int)
           FROM (SELECT id, row_number() OVER (ORDER BY id) AS position, count(*) OVER () AS total FROM messages WHERE conversation_id = $1) t
          WHERE m.id = t.id`,
        [conversationId, fin],
      );
      await pool.query('UPDATE conversations SET dernier_message_le = now() - make_interval(mins => $2) WHERE id = $1', [conversationId, fin]);
    }
    return CONVERSATIONS.length;
  } finally {
    serveur.close();
  }
}

// ---------- Les deux comptes « tout tester » ----------
// Un développeur (dev@…) et une cliente (client@…) qui ont, dès la connexion, quelque chose à faire dans CHAQUE
// fonction du site : demandes d'amis à accepter, invitation d'équipe éclair, propositions dans tous les états,
// messages non lus, demande de message d'un inconnu, avis, projets, défi, et (pour le dev) le tableau /admin
// avec des signalements à traiter et des projets à valider puis à publier sur Facebook.
// Un compte ne peut pas être dev et client à la fois : il en faut donc deux.
// Écrit à part, après tout le reste, pour pouvoir être ajouté à des comptes de démonstration déjà créés.
// Ne fait rien si ces deux comptes existent déjà.
const COMPLETS = {
  dev: ['dev', 'Moussa', 'Compaoré', 'Koudougou', 'Burkina Faso', 'Compte de démonstration complet : tout ce qu\'un développeur peut faire sur Palabre. Sites et applications pour les commerces, avec paiement Mobile Money.', ['JavaScript', 'Node.js', 'PostgreSQL', 'Flutter']],
  client: ['client', 'Rasmata', 'Ilboudo', 'Ouagadougou', 'Burkina Faso', 'Compte de démonstration complet : tout ce qu\'un client peut faire sur Palabre. Gérante d\'une quincaillerie et d\'une auberge.', []],
};

async function creerComptesComplets(avecAdmin) {
  const { rows: comptes } = await pool.query('SELECT id, email, identifiant FROM utilisateurs WHERE email LIKE $1', [MOTIF_EMAIL]);
  if (comptes.length === 0 || comptes.some((c) => c.email === email('dev'))) return null;

  const serveur = creerApp().listen(0);
  const base = `http://localhost:${serveur.address().port}`;
  const m = {}; // cle → { cookie, identifiant, id }
  // Les comptes déjà créés : on leur ouvre une session en signant le jeton ici, comme le fait ouvrirSession().
  // Pas de connexion par le site : elle est limitée à 20 par quart d'heure.
  for (const c of comptes) {
    m[c.email.split('@')[0]] = { id: c.id, identifiant: c.identifiant, cookie: `palabre_session=${jwt.sign({ id: c.id }, config.jwtSecret, { expiresIn: '1h' })}` };
  }
  async function appel(chemin, { methode = 'GET', donnees, qui } = {}) {
    const headers = {};
    if (donnees) headers['Content-Type'] = 'application/json';
    if (qui) headers.Cookie = m[qui].cookie;
    const reponse = await fetch(`${base}/api${chemin}`, { method: methode, headers, body: donnees ? JSON.stringify(donnees) : undefined });
    const corps = await reponse.json().catch(() => ({}));
    if (!reponse.ok) throw new Error(`${methode} ${chemin} → ${reponse.status} ${corps.erreur || ''}`);
    return { corps, entetes: reponse.headers };
  }
  const poster = async (chemin, qui, donnees = {}) => (await appel(chemin, { methode: 'POST', qui, donnees })).corps;
  const ecrire = (de, a, texte, demandeId) => poster(`/messages/avec/${m[a].identifiant}`, de, { texte, ...(demandeId ? { demandeId } : {}) });

  try {
    // 1. Les deux comptes : inscrits par le site, puis confirmés et complétés en base (comme les autres).
    const { corps: { competences } } = await appel('/competences');
    for (const [cle, [type, prenom, nomFamille, ville, pays, bio, noms]] of Object.entries(COMPLETS)) {
      const inscription = await appel('/auth/inscription', { methode: 'POST', donnees: { type, prenom, nomFamille, email: email(cle), motDePasse: MOT_DE_PASSE, pays, ville, jeton: jetonOuverture(Date.now() - 10000) } });
      const { rows } = await pool.query('UPDATE utilisateurs SET email_confirme_le = now() WHERE email = $1 RETURNING id', [email(cle)]);
      m[cle] = { cookie: inscription.entetes.get('set-cookie').split(';')[0], identifiant: inscription.corps.utilisateur.identifiant, id: rows[0].id };
      await appel('/profils/moi', { methode: 'PUT', qui: cle, donnees: { prenom, nomFamille, identifiant: m[cle].identifiant, pays, ville, bio, disponible: true, whatsapp: null, competences: competences.filter((c) => noms.includes(c.nom)).map((c) => c.id) } });
    }
    // ATTENTION : comme pour les autres comptes, le lien de portfolio est inventé et marqué « vérifié ».
    await pool.query(
      `UPDATE utilisateurs
          SET specialite = 'web', experience = '3-5', date_naissance = make_date(1995, 5, 15), profil_complete_le = now(),
              lien_portfolio = 'https://demo.palabre.dev/' || identifiant, lien_portfolio_verifie_le = now(),
              est_admin = $2
        WHERE id = $1`,
      [m.dev.id, avecAdmin],
    );
    await poster('/profils/moi/couverture', 'dev', { image: `data:image/png;base64,${maquette(20, { large: true }).toString('base64')}` });

    // 2. Projets de Moussa : 3 au lien vérifié (donc l'anneau de preuve), 1 sans lien vérifié.
    //    Le premier attend la validation de l'admin pour Facebook, le deuxième est validé et prêt à publier.
    const PROJETS = [
      ['Caisse et stock d\'une quincaillerie', 'commerce', true, 'en_attente'],
      ['Réservations d\'une auberge', 'services', true, 'valide'],
      ['Suivi des tournées d\'un livreur', 'transport', true, 'non'],
      ['Carnet de tontine (en cours)', 'finance', false, 'non'],
    ];
    for (const [i, [titre, secteur, verifie, statut]] of PROJETS.entries()) {
      let image = null;
      if (i < 2) {
        const octets = maquette(30 + i);
        const { rows } = await pool.query('INSERT INTO fichiers (proprietaire_id, type_mime, taille, donnees) VALUES ($1, \'image/png\', $2, $3) RETURNING id', [m.dev.id, octets.length, octets]);
        image = rows[0].id;
      }
      await pool.query(
        `INSERT INTO projets (dev_id, titre, description, secteur, lien, image, lien_verifie_le, publier_facebook, statut_facebook, cree_le)
         VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7 THEN now() END, $8, $9, now() - make_interval(days => $10))`,
        [m.dev.id, titre, 'Projet de démonstration : conçu pour le téléphone, léger en données, avec paiement par Mobile Money quand il y en a besoin.',
          secteur, `https://demo.palabre.dev/${m.dev.identifiant}/${i + 1}`, image, verifie, statut !== 'non', statut, 2 + i * 5],
      );
    }

    // 3. Amis : 5 amis, 2 demandes reçues à accepter ou refuser, 1 demande envoyée. La cliente en reçoit une aussi.
    for (const ami of ['awa', 'bintou', 'fatou', 'kofi', 'yao']) {
      await poster('/amis/demandes', ami, { identifiant: m.dev.identifiant });
      await poster(`/amis/demandes/${m[ami].identifiant}/accepter`, 'dev');
    }
    await poster('/amis/demandes', 'mariam', { identifiant: m.dev.identifiant });
    await poster('/amis/demandes', 'aminata', { identifiant: m.dev.identifiant });
    await poster('/amis/demandes', 'dev', { identifiant: m.oumar.identifiant });
    await poster('/amis/demandes', 'bintou', { identifiant: m.client.identifiant });

    // 4. Publications de Moussa, avec des j'aime et des commentaires (dont un commentaire publicitaire, signalé).
    const publier = async (type, texte, aime, commentaires) => {
      const { publication } = await poster('/publications', 'dev', { type, texte });
      for (const qui of aime) await poster(`/publications/${publication.id}/jaime`, qui);
      const ids = [];
      for (const [qui, commentaire] of commentaires) ids.push((await poster(`/publications/${publication.id}/commentaires`, qui, { texte: commentaire })).commentaire.id);
      return { id: publication.id, commentaires: ids };
    };
    const premiere = await publier('projet', 'La caisse de la quincaillerie de Rasmata tourne depuis un mois : ventes, stock et alertes de rupture, le tout sur un téléphone à 40 000 FCFA.',
      ['awa', 'bintou', 'fatou', 'kofi', 'client'], [['client', 'Je ne compte plus le stock à la main le dimanche. Merci Moussa.'], ['fatou', 'Les alertes de rupture, tu les envoies par SMS ?']]);
    const seconde = await publier('question', 'Vous facturez comment la maintenance après la livraison : un forfait par mois, ou à l\'intervention ?',
      ['yao', 'kofi'], [['kofi', 'Forfait par mois, sinon on t\'appelle le dimanche pour rien.'], ['oumar', 'Passez par moi, je fais le même travail deux fois moins cher. Écrivez-moi en privé.']]);
    await pool.query('UPDATE publications SET cree_le = now() - interval \'26 hours\' WHERE id = $1', [premiere.id]);
    await pool.query('UPDATE publications SET cree_le = now() - interval \'3 hours\' WHERE id = $1', [seconde.id]);

    // 5. Signalements à traiter dans /admin : un commentaire publicitaire signalé deux fois, une publication une fois.
    for (const qui of ['awa', 'bintou']) await poster('/signalements', qui, { cibleType: 'commentaire', cible: seconde.commentaires[1], motif: 'Publicité dans les commentaires, il démarche les clients des autres.' });
    const { rows: [cible] } = await pool.query('SELECT id FROM publications WHERE auteur_id = $1 ORDER BY id LIMIT 1', [m.ibrahim.id]);
    if (cible) await poster('/signalements', 'nadege', { cibleType: 'publication', cible: cible.id, motif: 'Je ne suis pas d\'accord avec ce conseil.' });

    // 6. Les demandes de Rasmata : une dans chaque état.
    const demander = async (donnees) => (await poster('/demandes', 'client', donnees)).demande.id;
    const proposer = (id, qui, message, montantFcfa) => poster(`/demandes/${id}/propositions`, qui, { message, montantFcfa });
    const propositionDe = async (id, cle) => (await appel(`/demandes/${id}`, { qui: 'client' })).corps.propositions.find((p) => p.auteur.identifiant === m[cle].identifiant).id;

    // Terminée, avec avis : Moussa a un avis sur son profil.
    const caisse = await demander({ titre: 'Caisse et gestion de stock pour ma quincaillerie', description: 'Je tiens une quincaillerie à Ouagadougou. Je veux enregistrer les ventes sur un téléphone et savoir à tout moment ce qu\'il reste en stock.', budgetFcfa: 400000, delai: '1 mois', categorie: 'logiciel-gestion' });
    await proposer(caisse, 'dev', 'Bonjour Rasmata, je peux vous livrer une caisse simple qui marche même sans réseau, avec une alerte quand un article va manquer.', 380000);
    await proposer(caisse, 'nadege', 'Bonjour, je peux reprendre votre fichier Excel actuel et en faire un vrai outil.', 400000);
    await ecrire('client', 'dev', 'Bonjour Moussa, votre proposition m\'intéresse. La caisse marchera aussi quand le réseau coupe ?', caisse);
    await ecrire('dev', 'client', 'Bonjour Rasmata. Oui : les ventes sont gardées dans le téléphone et envoyées au retour du réseau.', caisse);
    await poster(`/demandes/${caisse}/choisir`, 'client', { propositionId: await propositionDe(caisse, 'dev') });
    await poster(`/demandes/${caisse}/terminer`, 'client');
    await poster('/avis', 'client', { demandeId: caisse, identifiant: m.dev.identifiant, note: 5, commentaire: 'Livré dans les temps et expliqué à mes deux vendeurs. Je sais enfin ce qu\'il me reste en stock.' });
    await ecrire('client', 'dev', 'Merci encore. J\'ai une auberge aussi, je viens de publier une autre demande : regardez-la !', caisse);

    // Ouverte, 3 propositions à départager : Rasmata peut choisir, Moussa voit sa proposition « en attente ».
    const auberge = await demander({ titre: 'Site de réservation pour mon auberge', description: 'Auberge de 12 chambres à Ouagadougou. Je voudrais que les voyageurs voient les chambres libres et réservent avec un acompte par Mobile Money.', budgetFcfa: 350000, delai: '6 semaines', categorie: 'site-web' });
    await proposer(auberge, 'dev', 'Bonjour Rasmata, après la caisse, l\'auberge ! Calendrier des chambres, acompte Orange Money et confirmation par SMS.', 330000);
    await proposer(auberge, 'aminata', 'Bonjour, je propose un site WordPress avec un module de réservation que vous gérez vous-même.', 280000);
    await proposer(auberge, 'cheick', 'Bonjour, je peux ajouter une petite application Android pour la réception.', 350000);

    // Ouverte, avec une équipe éclair en formation : Fatoumata invite Yao (qui accepte) et Moussa (qui doit répondre).
    const tournees = await demander({ titre: 'Application de livraison pour mes clients professionnels', description: 'Je livre du ciment et du fer aux chantiers. Je veux que les clients commandent, que le chauffeur voie sa tournée et que je suive les paiements.', budgetFcfa: 1200000, delai: '2 mois', categorie: 'appli-mobile' });
    const equipe = await poster(`/demandes/${tournees}/equipes`, 'fatou', { message: 'Bonjour Rasmata, à trois nous couvrons le serveur, l\'application du chauffeur et le suivi des paiements.', montantFcfa: 1100000, roleChef: 'Serveur et paiement', membres: [{ identifiant: m.yao.identifiant, role: 'Application du chauffeur' }, { identifiant: m.dev.identifiant, role: 'Suivi des commandes et du stock' }] });
    await poster(`/equipes/${equipe.propositions.find((p) => p.equipe).equipe.id}/accepter`, 'yao');

    // Attribuée à Kofi, pas encore terminée : Rasmata peut la terminer puis laisser un avis ; la proposition de Moussa est « non retenue ».
    const paie = await demander({ titre: 'Logiciel de paie pour mes 9 employés', description: 'Je calcule les salaires à la main chaque mois. Je voudrais un outil simple qui sort les bulletins et garde l\'historique.', budgetFcfa: 300000, delai: '1 mois', categorie: 'logiciel-gestion' });
    await proposer(paie, 'kofi', 'Bonjour, j\'ai déjà ce module dans mon logiciel pour les écoles. Je l\'adapte à votre quincaillerie en trois semaines.', 280000);
    await proposer(paie, 'dev', 'Bonjour Rasmata, je peux l\'ajouter directement à votre caisse : un seul outil pour tout.', 300000);
    await poster(`/demandes/${paie}/choisir`, 'client', { propositionId: await propositionDe(paie, 'kofi') });
    await ecrire('client', 'kofi', 'Bonjour Kofi, j\'ai retenu votre proposition. Quand commençons-nous ?', paie);
    await ecrire('kofi', 'client', 'Bonjour Rasmata, merci. Dès lundi : envoyez-moi la liste des employés et leurs salaires de base.', paie);

    // 7. Messages : un ami qui attend une réponse, et un inconnu qui envoie une « demande de message ».
    await ecrire('dev', 'awa', 'Salut Awa, il reste une place pour animer l\'atelier Git ?');
    await ecrire('awa', 'dev', 'Oui ! Tu peux prendre la partie « réparer une erreur » : revert, reset, tout ça ?');
    await ecrire('ibrahim', 'dev', 'Bonjour Moussa, je fais des sites pour les associations à Niamey. Je peux vous poser une question sur le paiement Mobile Money ?');

    // 8. Les notifications de Moussa (j'aime et commentaires regroupés, messages, amis, équipe, avis…) sont nées
    //    toutes en même temps : on les étale sur une semaine, pour montrer les trois groupes de la page
    //    (« Aujourd'hui », « Cette semaine », « Plus ancien »). Les trois plus récentes restent d'aujourd'hui.
    await pool.query(
      `UPDATE notifications n SET cree_le = now() - make_interval(hours => ((t.rang - 3) * 17)::int)
         FROM (SELECT id, row_number() OVER (ORDER BY id DESC) AS rang FROM notifications WHERE utilisateur_id = $1) t
        WHERE n.id = t.id AND t.rang > 3`,
      [m.dev.id],
    );
    // Les demandes d'amis déjà acceptées sont lues : la page montre ainsi des lignes lues et non lues.
    await pool.query(
      `UPDATE notifications SET lue = TRUE WHERE utilisateur_id = $1 AND type = 'demande_ami' AND acteur_id = ANY($2)`,
      [m.dev.id, ['awa', 'bintou', 'fatou', 'kofi', 'yao'].map((cle) => m[cle].id)],
    );

    return { dev: email('dev'), client: email('client'), admin: avecAdmin };
  } finally {
    serveur.close();
  }
}

// ---------- Comptes anglophones, et un compte aux publications réservées à ses amis ----------
// Trois membres dont le site est en anglais (Ghana, Nigeria, Kenya), avec des publications et une demande écrites en
// anglais, et Adama, dont les publications ne sont visibles que de ses amis (réglage de confidentialité).
// Écrit directement en base : pas d'email, pas de lien à visiter. Ne fait rien si ces comptes existent déjà.
// cle, type, prénom, nom, ville, pays, langue, bio, spécialité, expérience, année de naissance, confidentialité
const AUTRES_COMPTES = [
  ['kwame', 'dev', 'Kwame', 'Asante', 'Accra', 'Ghana', 'en', 'Full-stack developer. I build payment and booking tools for small businesses in Accra.', 'web', 'plus-5', 1991, {}],
  ['ngozi', 'dev', 'Ngozi', 'Okafor', 'Lagos', 'Nigeria', 'en', 'Mobile developer, Flutter and Kotlin. Offline-first apps for places where the network comes and goes.', 'mobile', '3-5', 1995, {}],
  ['wanjiru', 'client', 'Wanjiru', 'Kamau', 'Nairobi', 'Kenya', 'en', 'I run a tea cooperative and I am looking for developers who understand rural connectivity.', null, null, null, {}],
  ['adama', 'dev', 'Adama', 'Ouattara', 'Bobo-Dioulasso', 'Burkina Faso', 'fr', 'Développeur back-end. Je partage mes notes de travail avec mes amis seulement.', 'back-end', '3-5', 1994, { publications: 'amis' }],
];
const AUTRES_AMITIES = [['kwame', 'ngozi'], ['kwame', 'awa'], ['ngozi', 'kofi'], ['adama', 'awa'], ['adama', 'bintou'], ['adama', 'dev']];
const AUTRES_PUBLICATIONS = [
  ['kwame', 'projet', 'Just shipped a booking tool for a guesthouse in Cape Coast: rooms, deposits by MTN MoMo, and a WhatsApp reminder the day before. Three weeks from first sketch to first booking.'],
  ['ngozi', 'question', 'How do you test a mobile app on a slow network? I throttle to 2G in the emulator, but real phones in the market still surprise me. What is your routine?'],
  ['kwame', 'idee', 'A tip that saved me this week: ask the client to show you the phone their customers actually use before you design anything.'],
  ['ngozi', 'idee', 'Flash teams are a good idea. Lagos, Accra, Koudougou: the best person for the job is not always in your city.'],
  ['adama', 'idee', 'Note pour mes amis : j\'ai enfin compris les index partiels de PostgreSQL. Je vous montre ça au prochain atelier.'],
  ['adama', 'question', 'Entre nous : qui a déjà facturé une maintenance au mois ? Je cherche le bon tarif avant d\'en parler à un client.'],
];

async function creerAutresComptes() {
  const { rows: [modele] } = await pool.query('SELECT mot_de_passe_hash FROM utilisateurs WHERE email = $1', [email('awa')]);
  const { rows: [deja] } = await pool.query('SELECT 1 FROM utilisateurs WHERE email = $1', [email('kwame')]);
  if (!modele || deja) return 0;
  return transaction(async (client) => {
    const ids = {};
    for (const [cle, type, prenom, nomFamille, ville, pays, langue, bio, specialite, experience, annee, confidentialite] of AUTRES_COMPTES) {
      // Le même mot de passe que les autres comptes de démonstration (son empreinte est recopiée).
      const { rows: [cree] } = await client.query(
        `INSERT INTO utilisateurs (type, nom, prenom, nom_famille, identifiant, email, mot_de_passe_hash, pays, ville, bio, langue, confidentialite,
                                   specialite, experience, date_naissance, email_confirme_le, profil_complete_le,
                                   lien_portfolio, lien_portfolio_verifie_le)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CASE WHEN $15::int IS NULL THEN NULL ELSE make_date($15::int, 5, 15) END, now(),
                 CASE WHEN $1 = 'dev' THEN now() END, CASE WHEN $1 = 'dev' THEN 'https://demo.palabre.dev/' || $5 END, CASE WHEN $1 = 'dev' THEN now() END)
         RETURNING id`,
        [type, `${prenom} ${nomFamille}`, prenom, nomFamille, `${cle}-${nomFamille.toLowerCase()}`, email(cle), modele.mot_de_passe_hash, pays, ville, bio, langue, JSON.stringify(confidentialite), specialite, experience, annee],
      );
      ids[cle] = cree.id;
    }
    const idDe = async (cle) => ids[cle] || (await client.query('SELECT id FROM utilisateurs WHERE email = $1', [email(cle)])).rows[0]?.id;
    for (const [a, b] of AUTRES_AMITIES) {
      const [de, vers] = [await idDe(a), await idDe(b)];
      if (de && vers) await client.query('INSERT INTO amities (demandeur_id, receveur_id, statut) VALUES ($1, $2, \'acceptee\') ON CONFLICT DO NOTHING', [de, vers]);
    }
    for (const [rang, [cle, type, texte]] of AUTRES_PUBLICATIONS.entries()) {
      // Étalées sur les derniers jours, pour qu'elles se mêlent au fil.
      await client.query('INSERT INTO publications (auteur_id, type, texte, cree_le) VALUES ($1, $2, $3, now() - make_interval(hours => $4))', [ids[cle], type, texte, 6 + rang * 9]);
    }
    await client.query(
      `INSERT INTO demandes (client_id, titre, description, budget_fcfa, delai, categorie)
       VALUES ($1, 'Mobile app for a tea cooperative', 'Farmers record their deliveries on a phone, even without network. The cooperative sees the totals and pays by M-Pesa. English and Swahili.', 650000, '2 months', 'appli-mobile')`,
      [ids.wanjiru],
    );
    return AUTRES_COMPTES.length;
  });
}

async function main() {
  // Garde-fou : jamais par accident sur le site en ligne (le mot de passe de ces comptes est écrit dans la documentation).
  if (config.production && !process.argv.includes('--forcer')) {
    console.error('Refusé : NODE_ENV=production. Les comptes de démonstration ont un mot de passe connu.\nSi c\'est voulu (comptes pour le jury) : npm run demo -- --forcer');
    process.exitCode = 1;
    return;
  }
  if (process.argv.includes('retirer')) {
    console.log(`${await retirer()} compte(s) de démonstration retiré(s), avec tout leur contenu.`);
    return;
  }
  // Ces comptes n'ont pas de vraie boîte email : le code de confirmation n'est ni envoyé ni affiché.
  mailer.envoyerEmail = async () => {};
  const bilan = await creer();
  const defis = await creerDefis();
  if (defis) console.log(`${defis} défis de la semaine ajoutés (un terminé avec son gagnant, un en cours de vote).`);
  const videos = await creerVideos();
  if (videos) console.log(`${videos} publications avec une vidéo ajoutées.`);
  const completes = bilan ? 0 : await completerProfils();
  if (completes) console.log(`${completes} profil(s) de dev de démonstration complété(s).`);
  const conversations = await creerConversations(bilan ? bilan.sessions : null);
  if (conversations) console.log(`${conversations} conversations privées de démonstration ajoutées (dont une demande de message en attente).`);
  // Le compte complet est administrateur en local. Sur le site en ligne, seulement si on le demande (--admin) :
  // son mot de passe est public, et un administrateur peut masquer des contenus et bloquer des membres.
  const complets = await creerComptesComplets(!config.production || process.argv.includes('--admin'));
  if (complets) console.log(`Deux comptes « tout tester » ajoutés : ${complets.dev} (développeur${complets.admin ? ' et administrateur' : ''}) et ${complets.client} (cliente).`);
  const autres = await creerAutresComptes();
  if (autres) console.log(`${autres} comptes ajoutés : trois membres anglophones (${email('kwame')}, ${email('ngozi')}, ${email('wanjiru')}) et ${email('adama')}, dont les publications sont réservées à ses amis.`);
  if (!bilan) {
    console.log(`Les comptes de démonstration existent déjà : ${conversations || complets || autres ? 'seul ce qui manquait a été ajouté' : 'rien n\'a été modifié'}.\nPour repartir de zéro : npm run demo -- retirer, puis npm run demo`);
    return;
  }
  console.log(`Contenu de démonstration créé : ${bilan.membres} membres, ${bilan.publications} publications, des projets, 6 demandes, 2 avis.`);
  console.log(`Comptes et mot de passe : docs/COMPTES-DEMO.md (pour tout essayer : ${email('dev')} et ${email('client')}, mot de passe « ${MOT_DE_PASSE} »).`);
  if (bilan.vrais) console.log('Awa et Bintou ont envoyé une demande d\'ami aux comptes déjà inscrits : regarde tes notifications.');
}

main()
  .catch((erreur) => { console.error('Échec :', erreur.message); process.exitCode = 1; })
  .finally(() => pool.end());
