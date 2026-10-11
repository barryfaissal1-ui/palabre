// Les listes du filtre de modération (src/utils/moderation.js).
//
// Elles sont « maison » : écrites par l'équipe, sans fichier ni bibliothèque venus d'ailleurs. Ce fichier contient
// donc, par nécessité, des mots grossiers et haineux : il faut bien les nommer pour les refuser. Ils ne sont jamais
// affichés ; le message de refus ne répète pas le mot.
//
// Tout est écrit « nettoyé » : minuscules, sans accent. Le filtre nettoie le texte du membre de la même façon, et
// remet aussi les chiffres à leur place de lettres (« c0nnard » devient « connard »). La comparaison se fait par
// MOTS ENTIERS : « con » est refusé, « connexion », « concours » ou « économie » ne le sont pas.
//
// Avant d'ajouter un mot, se demander quel mot innocent il toucherait. Exemples de mots volontairement ABSENTS :
// « retard » (être en retard), « trainee » (stagiaire, en anglais), « queue » et « pipe » (des mots de développeur),
// « niger » (le pays), « tg » (le Togo), « mongol », « pédale ». Palabre est un réseau de développeurs : on y parle
// de « file d'attente », de « kill process » et de « dumb terminal » sans insulter personne.

// ---------- Insultes (refusé) ----------
// Français d'abord, puis anglais. Les variantes d'écriture courantes sont listées (« conard », « encule »).
const INSULTES = `
  connard connards conard conards connasse connasses conasse connerie conneries
  salaud salauds salop salope salopes saloperie salopard salopards
  pute putes putain putains pouffiasse poufiasse petasse pouffe
  encule encules enculer enculee enfoire enfoires enfoiree
  batard batards batarde bastard bastards
  merdeux merdeuse abruti abrutis abrutie cretin cretins cretine couillon couillons
  nique niquer niquez ntm fdp vtff
  chieur chieuse emmerdeur emmerdeuse
  asshole assholes bitch bitches bitchy dickhead dumbass jackass motherfucker motherfuckers mofo
  fuck fucker fuckers fucking fucked fck fuk stfu gtfo
  shit shitty bullshit moron morons scumbag wanker twat prick douchebag
  cunt cunts whore whores slut sluts
`;
// Insultes en français qui sont des mots ordinaires en anglais (« pros and cons ») : elles ne comptent que pour un
// membre dont le site est en français.
const INSULTES_FRANCAIS = 'con cons conne connes';

// Expressions de plusieurs mots (refusé) : insultes et menaces. Comparées mot à mot sur le texte nettoyé.
const INSULTES_EXPRESSIONS = [
  'fils de pute', 'fils de chien', 'fille de pute', 'ta gueule', 'ferme ta gueule', 'nique ta mere', 'nique ta race',
  'va te faire foutre', 'va te faire enculer', 'va chier', 'va mourir', 'sale con', 'sale conne', 'pauvre con', 'pauvre conne',
  'tete de noeud', 'casse toi pauvre', 'je vais te tuer', 'je vais te frapper', 'je sais ou tu habites',
  'tu vas mourir', 'on va te tuer',
  'son of a bitch', 'piece of shit', 'shut the fuck up', 'go to hell', 'fuck you', 'fuck off', 'screw you', 'kill yourself',
  'go die', 'i will kill you', 'i will find you', 'i know where you live',
];

// ---------- Mots haineux (refusé) ----------
// Injures qui visent une personne pour son origine, sa couleur, sa religion, son sexe, son orientation ou son
// handicap. « niger » (le pays, le fleuve) n'est pas dans la liste : seul le mot à deux « g » y est.
const HAINE = `
  negre negres negresse negro negros nigger niggers nigga niggas bamboula bougnoule bougnoules bicot bicots
  youpin youpins youtre feuj kike kikes chinetoque chinetoques niakoue rital ritals boche boches
  pede pedes tarlouze tarlouzes tantouze gouine gouines faggot faggots tranny
  mongolien mongolienne triso retarded spastic
`;

const HAINE_EXPRESSIONS = [
  'sale noir', 'sale noire', 'sale blanc', 'sale blanche', 'sale arabe', 'sale juif', 'sale juive', 'sale musulman', 'sale chretien',
  'sale pd', 'sale gouine', 'sale etranger', 'sale etrangere', 'sale race', 'sous race', 'sous homme', 'retourne dans ton pays',
  'dirty black', 'dirty arab', 'dirty jew', 'go back to your country', 'white trash', 'sub human',
];

// ---------- Contenu sexuel explicite (refusé) ----------
// Seulement des mots sans double sens. « queue », « pipe », « baiser », « sexe » (dans un formulaire), « bite »
// (mordre, en anglais) ont un sens ordinaire : ils ne comptent que dans une des expressions de la liste suivante.
const SEXUEL = `
  porno pornos porn pornographie pornographique sextape sexting nudes
  nichons couilles baise baisee branler branlette fellation sodomie sodomiser partouze levrette ejaculer orgasme masturbation masturber
  pussy pussies boobs blowjob handjob cumshot horny hentai onlyfans
`;
const SEXUEL_EXPRESSIONS = [
  'plan cul', 'plan q', 'photo nue', 'photos nues', 'video porno', 'film porno', 'site porno', 'sex tape', 'sexe gratuit',
  'rencontre coquine', 'rencontres coquines', 'massage coquin', 'envoie tes nudes', 'envoie des nudes', 'je veux te baiser', 'baiser avec toi',
  'faire l amour avec toi', 'ton cul', 'ta chatte', 'ma bite', 'ta bite', 'suce moi', 'send nudes', 'naked pics', 'nude pics', 'free sex', 'sex video',
  'hot girls', 'hot singles', 'escort girl', 'escorte girl',
];

// Expressions innocentes qui contiennent un mot de ces listes : retirées du texte avant la comparaison.
const EXPRESSIONS_INNOCENTES = ['pros and cons', 'pro and con', 'pros cons', 'con artist', 'comic con', 'def con'];

// ---------- Phrases typiques d'arnaque (mis en attente, vérifié par un administrateur) ----------
// Des expressions régulières, appliquées au texte nettoyé. On ne refuse pas : un vrai développeur peut parler
// d'acompte. Une personne de l'équipe regarde, puis publie ou retire.
// Elles sont écrites pour ne pas toucher le vocabulaire du métier : « envoie ton code » ou « partage ton code »
// parlent de code source et ne sont PAS retenus ; « envoie le code reçu par SMS » l'est.
const SOMME = '(\\d[\\d .,]*(fcfa|f cfa|cfa|francs?|euros?|dollars?|usd|k)|\\$ ?\\d+|de l argent|l argent|des millions|un million)';
const ARNAQUES = [
  // payer d'avance pour débloquer quelque chose
  /\b(paie|paies|paye|payes|payer|payez|verse|verser|versez|vire|virer|virez)\b.{0,50}\b(d abord|en avance|d avance|pour debloquer|pour activer|pour valider ton|pour valider votre|avant de recevoir|avant tout travail)\b/,
  new RegExp(`\\b(envoie|envoies|envoyer|envoyez|depose|deposer|deposez|transfere|transferer|transferez)\\b.{0,25}\\b${SOMME}\\b.{0,40}\\b(d abord|avant|en avance|d avance|pour debloquer|pour activer|pour recevoir)\\b`),
  /\b(paiement|versement|depot|transfert)\b.{0,30}\b(d avance obligatoire|obligatoire avant|avant tout|pour debloquer|pour activer)\b/,
  /\bfrais (de dossier|d inscription|d adhesion|de deblocage|d activation|de retrait|d ouverture de compte|de traitement du dossier)\b/,
  /\b(debloquer|activer|recuperer) (ton|votre|ta|tes|vos|le|les) (gain|gains|fonds|lot|cadeau|bonus)\b/,
  // gains rapides garantis
  /\b(gain|gains|revenu|revenus|profit|profits|benefice|benefices|rendement|rendements)\b.{0,25}\b(garanti|garantis|garantie|garanties|assure|assures|sans risque|sans effort)\b/,
  new RegExp(`\\b(gagne|gagner|gagnez|touche|toucher|touchez|recois|recevoir|recevez)\\b.{0,15}\\b${SOMME}\\b.{0,40}\\b(par jour|par semaine|chaque jour|en 24 ?h|en 48 ?h|rapidement|facilement|sans effort|sans rien faire|depuis ton telephone|depuis votre telephone)\\b`),
  /\b(argent|gain|gains|revenu) (facile|faciles|rapide|rapides|garanti|garantis)\b/,
  /\b(100|200|300|500) ?(%|pour cent) (garanti|de gain|de gains|de benefice|de profit|de rendement)\b/,
  // doubler son argent
  /\b(double|doubler|doublez|triple|tripler|triplez|multiplie|multiplier|multipliez)\b.{0,20}\b(ton|votre|ta|vos|tes) (argent|mise|capital|depot|investissement|fcfa)\b/,
  /\b(investis|investir|investissez)\b.{0,40}\b(recois|recevez|gagne|gagnez|recupere|recuperez)\b/,
  // le code reçu par SMS, le mot de passe, le code secret
  /\b(envoie|envoies|envoyer|envoyez|donne|donner|donnez|communique|communiquez|transmets|transmettez)\b.{0,25}\b(ton|votre|le|ce) (mot de passe|mdp|pin|otp|code secret|code pin|code de confirmation|code de validation|code de verification|code recu|code sms|code orange|code moov|code wave)\b/,
  /\b(ton|votre|le|ce) code\b.{0,25}\b(recu par sms|recu par message|par sms|a 6 chiffres|a 4 chiffres|otp)\b/,
  // faux recrutement payant
  /\b(recrutement|recrute|recrutons|embauche|visa|bourse)\b.{0,60}\b(frais|payer|payez|versement|caution)\b/,
  /\b(payer|payez|frais|caution)\b.{0,40}\b(pour postuler|pour etre recrute|pour etre embauche|pour l entretien|pour le visa|pour la bourse)\b/,
  // crypto et placements miracles
  /\b(bitcoin|btc|crypto|cryptomonnaie|cryptomonnaies|usdt|ethereum|forex|trading|binance|minage|mining)\b.{0,60}\b(garanti|garantis|sans risque|double|doubler|x2|x10|profit rapide|gains rapides|revenu passif|par jour)\b/,
  /\b(revenu passif|liberte financiere)\b.{0,40}\b(garanti|sans effort|en quelques jours|rapidement)\b/,
  // les mêmes en anglais
  /\b(pay|deposit|transfer)\b.{0,40}\b(first|upfront|in advance|to unlock|to activate|to release your)\b/,
  /\b(registration|processing|activation|unlock|clearance|withdrawal) fee\b/,
  /\b(guaranteed|risk free)\b.{0,25}\b(profit|profits|return|returns|income|earnings|winnings)\b/,
  /\b(earn|make)\b.{0,15}(\$ ?\d|\d+ ?(\$|usd|dollars|fcfa|k)\b|\bmoney\b|\bcash\b).{0,40}\b(per day|a day|daily|every day|fast|easily|from your phone|from home|without effort)\b/,
  /\b(easy|quick|fast) (money|cash|income)\b/,
  /\bget rich quick\b/,
  /\b(double|triple|multiply)\b.{0,15}\b(your|ur) (money|investment|deposit|capital|bitcoin)\b/,
  /\b(send|give|tell)\b.{0,20}\b(me |us )?(your|the) (password|pin|otp|verification code|confirmation code|sms code|secret code)\b/,
  /\b(bitcoin|btc|crypto|usdt|forex|trading|binance)\b.{0,60}\b(guaranteed|risk free|double|x2|x10|daily profit|passive income)\b/,
];

// ---------- Paiement d'avance (bandeau anti-arnaque) ----------
// Dans un message privé ou une proposition, rien n'est refusé ni lu par quelqu'un : mais si le texte parle d'argent
// à envoyer, le DESTINATAIRE voit un rappel discret (« ne paie jamais avant d'avoir vérifié le profil et les avis »).
// On préfère prévenir une fois de trop : un vrai développeur qui parle d'acompte ne perd rien à ce rappel.
const PAIEMENT_AVANCE = [
  /\b(mobile money|orange money|moov money|wave|mtn money|mtn momo|momo|airtel money|m pesa|mpesa|western union|moneygram|flooz|t money|tmoney)\b/,
  /\b(paiement|payer|paie|paye|payez|acompte|avance|versement|virement|depot|transfert)\b.{0,30}\b(d avance|en avance|avant|d abord|au debut|a la commande|pour commencer)\b/,
  /\b(envoie|envoyer|envoyez|verse|verser|versez|paie|paye|payer|payez)\b.{0,20}\b(d abord|moi d abord|l argent|de l argent|la somme|le montant|les frais)\b/,
  /\bfrais (de dossier|d inscription|d adhesion|de deblocage|d activation|de retrait|d ouverture|de traitement)\b/,
  /\b(pay|send|transfer|deposit)\b.{0,30}\b(first|upfront|in advance|before i start|before we start|the money|the fee)\b/,
  /\b(advance payment|upfront payment|down payment|registration fee|processing fee)\b/,
];

// ---------- Liens ----------
// Raccourcisseurs : on ne voit pas où le lien mène. Le membre doit coller l'adresse complète.
const RACCOURCISSEURS = [
  'bit.ly', 'bitly.com', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly', 'cutt.ly', 'shorturl.at', 'short.io',
  'tiny.cc', 'rb.gy', 'lnkd.in', 'adf.ly', 'bl.ink', 'soo.gd', 's.id', 'v.gd', 'x.co', 'urlz.fr', 'clck.ru', 'shorte.st', 'linktr.ee',
  'cli.re', 'tr.im', 'u.to', 'qr.ae', 'trib.al', 'dlvr.it', 'shrtco.de', 'urlr.me', 'lc.cx', 'vu.fr', 'petitlien.fr', 'zpr.io', 'kutt.it',
];

// Banques, opérateurs et services d'argent que les faux sites imitent. Pour chacun : les domaines officiels.
// Un lien dont un morceau RESSEMBLE au nom sans être sur un domaine officiel est refusé (« 0range-money.com »,
// « ecobannk.net », « wave-bonus.xyz »).
const MARQUES = {
  orange: ['orange.com', 'orange.bf', 'orange.ci', 'orange.sn', 'orange.ml', 'orange.fr', 'orange.cm', 'orange.ne', 'orange-money.com', 'orangemoney.bf', 'orangemoney.ci', 'orangemoney.sn'],
  moov: ['moov-africa.bf', 'moov-africa.ci', 'moov-africa.tg', 'moov-africa.bj', 'moov-africa.ml', 'moov-africa.ne', 'moov-africa.com', 'moovmoney.bf'],
  wave: ['wave.com'],
  ecobank: ['ecobank.com'],
  corisbank: ['coris.bank', 'corisbank.bf', 'coris-bank.com'],
  mtn: ['mtn.com', 'mtn.ci', 'mtn.com.gh', 'mtn.ng', 'mtn.cm', 'mtn.bj'],
  airtel: ['airtel.africa', 'airtel.com', 'airtel.in'],
  telecel: ['telecel.bf', 'telecel.com.gh'],
  paypal: ['paypal.com', 'paypal.me'],
  westernunion: ['westernunion.com'],
  moneygram: ['moneygram.com'],
  mpesa: ['safaricom.co.ke', 'm-pesa.africa'],
  ubagroup: ['ubagroup.com'],
  mastercard: ['mastercard.com', 'mastercard.fr'],
  palabre: ['palabre.dev'],
};
// Mots d'appât : un lien qui porte le nom exact d'une marque ET l'un de ces mots, hors de ses domaines officiels,
// est refusé (« wave-bonus.xyz »). Sans appât, le nom seul ne suffit pas (« the-orange-tree.com » est innocent).
const APPATS = ['bonus', 'promo', 'gratuit', 'gratuite', 'cadeau', 'cadeaux', 'gain', 'gains', 'gagne', 'gagnant', 'loterie', 'tombola', 'free', 'win', 'winner', 'gift', 'prize',
  'login', 'connexion', 'secure', 'securite', 'verif', 'verification', 'verify', 'compte', 'account', 'support', 'recharge', 'credit', 'forfait', 'money', 'pay', 'paiement', 'retrait', 'transfert'];

// Reconnaître un lien écrit sans « http » : seulement avec une de ces terminaisons. « node.js » ou « fichier.txt »
// ne sont donc pas pris pour des liens.
const TERMINAISONS = ['com', 'net', 'org', 'io', 'dev', 'app', 'co', 'me', 'info', 'biz', 'xyz', 'top', 'link', 'click', 'online', 'site', 'shop', 'store', 'live', 'club', 'vip', 'pro',
  'africa', 'bf', 'ci', 'sn', 'ml', 'tg', 'bj', 'ne', 'gh', 'ng', 'ke', 'za', 'cm', 'ga', 'cd', 'cg', 'gn', 'mr', 'ma', 'dz', 'tn', 'rw', 'ug', 'tz', 'fr', 'be', 'ch', 'ca', 'uk', 'us', 'de', 'ru', 'cn', 'in',
  'ly', 'gl', 'gd', 'cc', 'tk', 'cf', 'gq', 'ws', 'to', 'at', 'cx', 're', 'tv', 'ai', 'bank'];
// Noms de technologies qui ressemblent à une adresse : jamais comptés comme des liens.
const NOMS_TECHNIQUES = new Set(['socket.io', 'asp.net', 'vb.net', 'ado.net', 'ml.net', 'draw.io', 'fly.io', 'deno.land']);

const mots = (liste) => new Set(liste.split(/\s+/).filter(Boolean));

module.exports = {
  INSULTES: mots(INSULTES), INSULTES_FRANCAIS: mots(INSULTES_FRANCAIS), INSULTES_EXPRESSIONS, HAINE: mots(HAINE), HAINE_EXPRESSIONS,
  SEXUEL: mots(SEXUEL), SEXUEL_EXPRESSIONS, EXPRESSIONS_INNOCENTES, ARNAQUES, PAIEMENT_AVANCE,
  RACCOURCISSEURS: new Set(RACCOURCISSEURS), MARQUES, APPATS: new Set(APPATS), TERMINAISONS: new Set(TERMINAISONS), NOMS_TECHNIQUES,
};
