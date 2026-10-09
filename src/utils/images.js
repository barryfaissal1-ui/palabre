// Vérification des images envoyées par les membres.
// Le navigateur compresse l'image avant l'envoi ; le serveur vérifie quand même tout,
// car on ne fait jamais confiance à ce qui vient de l'extérieur.
const { ErreurValidation } = require('./validation');

const TAILLE_MAX = 500 * 1024; // 500 Ko après compression

// Les premiers octets d'un fichier révèlent son vrai format, quel que soit son nom.
const SIGNATURES = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
};

function lireImageDataUrl(dataUrl, champ = 'image') {
  if (typeof dataUrl !== 'string') throw new ErreurValidation('Aucune image reçue.', champ);

  const correspondance = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!correspondance) throw new ErreurValidation('Format accepté : JPEG, PNG ou WebP.', champ);

  const typeMime = correspondance[1];
  const donnees = Buffer.from(correspondance[2], 'base64');
  if (donnees.length === 0) throw new ErreurValidation('Image vide.', champ);
  if (donnees.length > TAILLE_MAX) throw new ErreurValidation('Image trop lourde (500 Ko maximum).', champ);
  if (!SIGNATURES[typeMime](donnees)) throw new ErreurValidation('Ce fichier n\'est pas une image valide.', champ);

  return { typeMime, donnees, ...dimensions(typeMime, donnees) };
}

// Largeur et hauteur de l'image, lues dans les premiers octets du fichier (sans bibliothèque).
// Renvoie { largeur: null, hauteur: null } si le format n'est pas reconnu : l'image s'affiche quand même.
function dimensions(typeMime, b) {
  const rien = { largeur: null, hauteur: null };
  try {
    if (typeMime === 'image/png') return { largeur: b.readUInt32BE(16), hauteur: b.readUInt32BE(20) };
    if (typeMime === 'image/jpeg') {
      // Un JPEG est une suite de blocs « FF xx longueur » ; la taille est dans le bloc SOF (C0 à CF, sauf C4, C8, CC).
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) return rien;
        const marqueur = b[i + 1];
        if (marqueur >= 0xc0 && marqueur <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marqueur)) {
          return { largeur: b.readUInt16BE(i + 7), hauteur: b.readUInt16BE(i + 5) };
        }
        i += 2 + b.readUInt16BE(i + 2);
      }
      return rien;
    }
    // WebP : trois variantes, reconnues par les 4 lettres à la position 12.
    const variante = b.subarray(12, 16).toString('ascii');
    if (variante === 'VP8X') return { largeur: b.readUIntLE(24, 3) + 1, hauteur: b.readUIntLE(27, 3) + 1 };
    if (variante === 'VP8 ') return { largeur: b.readUInt16LE(26) & 0x3fff, hauteur: b.readUInt16LE(28) & 0x3fff };
    if (variante === 'VP8L') {
      const bits = b.readUInt32LE(21);
      return { largeur: (bits & 0x3fff) + 1, hauteur: ((bits >> 14) & 0x3fff) + 1 };
    }
  } catch { /* fichier trop court : pas de taille */ }
  return rien;
}

module.exports = { lireImageDataUrl, TAILLE_MAX };
