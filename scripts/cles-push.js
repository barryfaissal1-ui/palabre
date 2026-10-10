// Fabrique une paire de clés VAPID pour les notifications push : npm run cles-push
// À faire UNE fois, puis copier les trois lignes dans les variables d'environnement (fichier .env en local,
// réglages du service web chez Systalink). Changer de clés plus tard désabonnerait tous les appareils.
const { genererCles } = require('../src/utils/push');

const { publique, privee } = genererCles();
console.log('Copie ces trois lignes dans tes variables d\'environnement :\n');
console.log(`VAPID_PUBLIQUE=${publique}`);
console.log(`VAPID_PRIVEE=${privee}`);
console.log('VAPID_SUJET=mailto:contact@palabre.dev');
console.log('\nLa clé privée ne doit jamais aller sur GitHub. Remplace l\'adresse par un email où l\'équipe peut être jointe.');
process.exit(0);
