// Vérification des messages vocaux envoyés par les membres.
// Le navigateur enregistre avec MediaRecorder : du WebM (Opus) sur Android et ordinateur, du MP4 (AAC) sur iPhone.
// Comme pour les images, le serveur ne fait confiance à rien : type annoncé, taille, premiers octets, durée.
const { ErreurValidation } = require('./validation');

const TAILLE_MAX = 400 * 1024; // 400 Ko : à 24 kb/s, une minute pèse environ 180 Ko
const DUREE_MAX_S = 60;

// Les premiers octets d'un fichier révèlent son vrai format, quel que soit le type annoncé.
const SIGNATURES = {
  'audio/webm': (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3, // en-tête EBML (Matroska / WebM)
  'audio/ogg': (b) => b.subarray(0, 4).toString('ascii') === 'OggS',
  'audio/mp4': (b) => b.subarray(4, 8).toString('ascii') === 'ftyp',
};

// vocal : { donnees: 'data:audio/webm;codecs=opus;base64,…', duree: 12 } → { typeMime, donnees, duree }
function lireVocal(vocal, champ = 'vocal') {
  if (!vocal || typeof vocal.donnees !== 'string') throw new ErreurValidation('Aucun enregistrement reçu.', champ);
  // « ;codecs=opus » est accepté dans l'annonce, mais seul le type de base est gardé et vérifié.
  const correspondance = /^data:(audio\/(?:webm|ogg|mp4))(?:;codecs=[a-z0-9.,]+)?;base64,([A-Za-z0-9+/=]+)$/i.exec(vocal.donnees);
  if (!correspondance) throw new ErreurValidation('Ce format audio n\'est pas accepté.', champ);
  const typeMime = correspondance[1].toLowerCase();
  const donnees = Buffer.from(correspondance[2], 'base64');
  if (donnees.length < 16) throw new ErreurValidation('Enregistrement vide.', champ);
  if (donnees.length > TAILLE_MAX) throw new ErreurValidation('Message vocal trop lourd (400 Ko maximum).', champ);
  if (!SIGNATURES[typeMime](donnees)) throw new ErreurValidation('Ce fichier n\'est pas un enregistrement audio valide.', champ);
  const duree = Math.round(Number(vocal.duree));
  if (!Number.isFinite(duree) || duree < 1 || duree > DUREE_MAX_S) throw new ErreurValidation('Un message vocal dure d\'une seconde à une minute.', champ);
  return { typeMime, donnees, duree };
}

module.exports = { lireVocal, TAILLE_MAX, DUREE_MAX_S };
