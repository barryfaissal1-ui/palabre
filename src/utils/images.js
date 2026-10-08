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

  return { typeMime, donnees };
}

module.exports = { lireImageDataUrl, TAILLE_MAX };
