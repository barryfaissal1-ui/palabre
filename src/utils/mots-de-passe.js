// Mots de passe refusés : trop courants, ou construits avec le nom de la personne.
//
// La liste ci-dessous est « maison » : écrite par l'équipe, sans fichier ni bibliothèque venus d'ailleurs. Elle réunit
// ce que les gens choisissent le plus souvent : suites de chiffres, touches voisines du clavier (azerty, qwerty),
// mots doux, prénoms, clubs, villes et pays d'Afrique de l'Ouest, et les mots de Palabre lui-même.
// Tout est écrit en minuscules, sans accent : la comparaison se fait sur le mot de passe « nettoyé » de la même façon.
const MOTS_COURANTS = new Set(`
  12345678 123456789 1234567890 0123456789 87654321 987654321 0987654321 11111111 00000000 22222222 33333333
  44444444 55555555 66666666 77777777 88888888 99999999 12341234 12121212 11223344 12344321 01234567 123123123
  10203040 01020304 11112222 12345679 13579246 24681357 147258369 123654789 789456123 159753 741852963 112233445566
  azerty azertyui azertyuiop azerty123 azerty1234 azerty12345 azerty01 azerty00 azertyazerty aqwzsxedc azeqsdwxc
  qsdfghjk qsdfghjklm wxcvbn wxcvbnaz aze123 azer1234 azert12345 qwerty qwertyui qwertyuiop qwerty123 qwerty1234
  qwerty12345 qwertyqwerty asdfghjk asdfghjkl zxcvbnm zxcvbnmasd qazwsx qazwsxedc 1qaz2wsx 1q2w3e4r 1q2w3e4r5t
  q1w2e3r4 q1w2e3r4t5 a1b2c3d4 abcd1234 abc12345 abcdefgh abcdefghi abcdefghij abcd abc123 aaaaaaaa aaaa1111
  motdepasse motdepasse1 motdepasse123 monmotdepasse lemotdepasse mdp mdp12345 mdp123456 passe passe123 secret
  secret123 monsecret password password1 password12 password123 password1234 passw0rd p@ssword p@ssw0rd pass1234
  pass12345 mypassword letmein welcome welcome1 welcome123 bienvenue bienvenue1 bienvenue123 bonjour bonjour1
  bonjour123 bonsoir salut salut123 coucou coucou123 merci merci123 bisous bisous123 jetaime jetaime1 jetaime123
  jetadore iloveyou iloveyou1 iloveu loveyou lovelove amour amour123 monamour monamour1 mavie mavie123 moncoeur
  cherie chouchou doudou doudou123 loulou loulou123 bebe bebe1234 monbebe princesse princesse1 princess soleil
  soleil123 etoile etoile123 bonheur liberte liberte1 paradis chocolat chocolat1 vanille papillon tigrou nounours
  dragon dragon123 monkey master master123 shadow superman batman spiderman pokemon naruto naruto123 onepiece
  football football1 foot1234 basketball soccer barcelone barcelona fcbarcelone realmadrid madrid chelsea arsenal
  liverpool manchester juventus marseille olympique parisparis psg12345 messi messi10 ronaldo ronaldo7 cr7cr7cr7
  neymar mbappe drogba etoo sadiomane salah lesetalons etalons elephants lionsindomptables lions aigles superaigles
  dieu dieumerci dieuestgrand dieuestbon gloireadieu jesus jesus123 jesuschrist seigneur alleluia amen amen1234
  allah allahakbar bismillah inchallah mashallah alhamdulillah mohamed mohammed muhammad ibrahim moussa issouf
  ousmane abdoul abdoulaye amadou mamadou souleymane adama oumar seydou boubacar ismael youssouf karim rachid
  fatou fatoumata fatimata aminata mariam mariama awa aicha aissata kadiatou salimata rokia bintou ramata safiatou
  christian patrick olivier pascal serge michel daniel david emmanuel junior francois pierre marie nicole sandrine
  nathalie stephanie michael jordan jennifer jessica ashley charlie thomas nicolas alexandre maxime
  burkina burkinafaso burkina226 faso fasofaso lefaso ouaga ouaga2000 ouagadougou koudougou bobo bobodioulasso
  banfora ouahigouya kaya tenkodogo fadangourma dedougou afrique afrique1 africa africa123 lafrique monafrique
  cotedivoire abidjan abidjan225 yamoussoukro bouake mali bamako bamako223 senegal dakar dakar221 togo lome
  benin cotonou niger niamey ghana accra nigeria lagos kenya nairobi cameroun yaounde douala guinee conakry
  gabon libreville congo kinshasa brazzaville tchad ndjamena maroc casablanca france paris paris123 canada
  palabre palabre1 palabre123 palabre2026 palabredev palabre226 arbreapalabres cadev cadev2026 systalink datacloud
  developpeur developpeur1 developer dev12345 devdevdev codeur codecode code1234 programmeur javascript python
  python123 java1234 html5css3 nodejs react github gitlab linux ubuntu windows windows10 android android1 iphone
  samsung samsung1 tecno infinix itel huawei nokia orange orange123 moov telecel telmob airtel internet internet1
  wifi wifi1234 connexion connexion1 ordinateur telephone portable facebook facebook1 whatsapp instagram tiktok
  youtube google google123 gmail yahoo hotmail admin admin123 admin1234 administrateur root toor rootroot
  test test1234 testtest tester essai essai123 demo demo1234 user user1234 utilisateur client client123 invite
  guest changeme changezmoi nouveau nouveau123 temporaire azertyuiop123 motdepasse2024 motdepasse2025
  motdepasse2026 azerty2024 azerty2025 azerty2026 password2024 password2025 password2026 burkina2024 burkina2025
  burkina2026 bonjour2024 bonjour2025 bonjour2026 argent argent123 millionnaire fortune business patron boss
  chef chef1234 president ministre capitaine sankara thomassankara revolution lapatrie patrie patrieoulamort
  famille famille1 mafamille maman maman123 papa papa1234 papamaman mamanpapa mamancherie monpere mamere frere
  soeur enfant enfants monfils mafille ecole ecole123 lycee universite etudiant etudiant1 eleve professeur
  maison maison123 voiture moto moto1234 yamaha honda toyota mercedes ferrari lamborghini bmw12345
`.split(/\s+/).filter(Boolean));

// « Azerty-2024 ! » → « azerty-2024 ! » : minuscules, accents retirés.
function normaliser(texte) {
  return String(texte || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Trop courant ? On compare le mot de passe entier, puis ce qu'il en reste sans chiffres ni signes : « Burkina2026! »
// reste « burkina ». Une seule lettre répétée (« aaaaaaaa ») ou une suite de chiffres est refusée aussi.
function tropCourant(motDePasse) {
  const propre = normaliser(motDePasse);
  const lettres = propre.replace(/[^a-z]/g, '');
  const sansSignes = propre.replace(/[^a-z0-9]/g, '');
  if (MOTS_COURANTS.has(propre) || MOTS_COURANTS.has(sansSignes)) return true;
  if (lettres.length >= 3 && MOTS_COURANTS.has(lettres)) return true;
  if (new Set(sansSignes).size <= 2) return true; // « aaaaaaaa », « 12121212 », « abababab »
  return /^\d+$/.test(sansSignes) && ('01234567890123456789'.includes(sansSignes) || '98765432109876543210'.includes(sansSignes));
}

// Contient le prénom, le nom ou l'identifiant ? (3 lettres au moins : « Al » est dans trop de mots.)
// « awa-ouedraogo » est essayé en entier, sans tiret, et morceau par morceau.
function contientLeNom(motDePasse, proches = []) {
  const propre = normaliser(motDePasse);
  const serre = propre.replace(/[^a-z0-9]/g, '');
  const morceaux = new Set();
  for (const proche of proches) {
    const valeur = normaliser(proche);
    [valeur, valeur.replace(/[^a-z0-9]/g, ''), ...valeur.split(/[^a-z0-9]+/)].forEach((morceau) => { if (morceau.length >= 3) morceaux.add(morceau); });
  }
  return [...morceaux].some((morceau) => propre.includes(morceau) || serre.includes(morceau));
}

module.exports = { MOTS_COURANTS, normaliser, tropCourant, contientLeNom };
