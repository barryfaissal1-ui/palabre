// Prépare les photos de fond pour le site : npm run photos
//
// Pose tes photos d'origine (JPEG ou PNG, même très lourdes) dans public/img/fond/, puis lance la commande.
// Pour chaque photo, le script écrit deux fichiers légers dans le même dossier :
//   nom-1080.webp  → 1080 px au plus sur le grand côté, moins de 150 Ko (le format que les téléphones récents préfèrent)
//   nom-1080.jpg   → la même image en JPEG, pour les rares navigateurs qui ne lisent pas le WebP
// puis il range l'original dans photos-originales/ (dossier hors du site et hors de git) : seul le léger est publié.
//
// Outil : jSquash (licence Apache-2.0), les codecs de Squoosh compilés en WebAssembly. Dépendance de développement
// seulement : le site en ligne n'en a pas besoin. (sharp a été écarté : ses binaires libvips sont sous LGPL.)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import decoderJpeg, { init as preparerDecodeurJpeg } from '@jsquash/jpeg/decode.js';
import encoderJpeg, { init as preparerEncodeurJpeg } from '@jsquash/jpeg/encode.js';
import decoderPng, { init as preparerDecodeurPng } from '@jsquash/png/decode.js';
import encoderWebp, { init as preparerEncodeurWebp } from '@jsquash/webp/encode.js';
import redimensionner, { initResize } from '@jsquash/resize';

const racine = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOSSIER = path.join(racine, 'public', 'img', 'fond');
const ORIGINAUX = path.join(racine, 'photos-originales');
const COTE_MAX = 1080;
const POIDS_MAX = 150 * 1024;
const SUFFIXE = '-1080';

// jSquash est prévu pour le navigateur : dans Node.js, il faut lui fournir ImageData et charger ses fichiers .wasm à la main.
globalThis.ImageData ??= class ImageData {
  constructor(data, width, height) { this.data = data; this.width = width; this.height = height; }
};
const wasm = (chemin) => WebAssembly.compile(fs.readFileSync(path.join(racine, 'node_modules', '@jsquash', chemin)));

// « Marché de Koudougou (2).JPG » → « marche-de-koudougou-2 » : un nom simple, sans accent ni espace, sûr dans une adresse.
function nomSimple(nom) {
  return nom.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'photo';
}

const ko = (octets) => `${Math.round(octets / 1024)} Ko`;

async function main() {
  if (!fs.existsSync(DOSSIER)) {
    console.log('Le dossier public/img/fond/ n\'existe pas. Crée-le et poses-y tes photos, puis relance : npm run photos');
    return;
  }
  // Les fichiers déjà prêts (nom-1080, nom-1920) ne sont jamais retraités : seules les nouvelles photos d'origine le sont.
  const sources = fs.readdirSync(DOSSIER).filter((nom) => /\.(jpe?g|png)$/i.test(nom) && !/-(1080|1920)$/.test(path.parse(nom).name));
  if (sources.length === 0) {
    console.log('Aucune nouvelle photo à préparer dans public/img/fond/ (JPEG ou PNG).');
    return;
  }

  await preparerDecodeurJpeg(await wasm('jpeg/codec/dec/mozjpeg_dec.wasm'));
  await preparerEncodeurJpeg(await wasm('jpeg/codec/enc/mozjpeg_enc.wasm'));
  await preparerDecodeurPng(await wasm('png/codec/pkg/squoosh_png_bg.wasm'));
  await preparerEncodeurWebp(await wasm('webp/codec/enc/webp_enc.wasm'));
  await initResize(await wasm('resize/lib/resize/pkg/squoosh_resize_bg.wasm'));
  fs.mkdirSync(ORIGINAUX, { recursive: true });

  for (const source of sources) {
    const chemin = path.join(DOSSIER, source);
    const octets = fs.readFileSync(chemin);
    let image = /\.png$/i.test(source) ? await decoderPng(octets) : await decoderJpeg(octets);

    // Réduction : le grand côté passe à 1080 px (une image déjà plus petite n'est pas agrandie).
    const echelle = Math.min(1, COTE_MAX / Math.max(image.width, image.height));
    if (echelle < 1) {
      image = await redimensionner(image, { width: Math.round(image.width * echelle), height: Math.round(image.height * echelle) });
    }

    // On baisse la qualité par paliers jusqu'à passer sous 150 Ko.
    const sousLePoids = async (encoder) => {
      let fichier;
      for (const quality of [78, 70, 62, 54, 46, 38, 30]) {
        fichier = Buffer.from(await encoder(image, { quality }));
        if (fichier.length <= POIDS_MAX) break;
      }
      return fichier;
    };
    const webp = await sousLePoids(encoderWebp);
    const jpeg = await sousLePoids(encoderJpeg);

    const base = `${nomSimple(path.parse(source).name)}${SUFFIXE}`;
    fs.writeFileSync(path.join(DOSSIER, `${base}.webp`), webp);
    fs.writeFileSync(path.join(DOSSIER, `${base}.jpg`), jpeg);
    fs.renameSync(chemin, path.join(ORIGINAUX, source));
    const alerte = webp.length > POIDS_MAX ? '  ← encore trop lourde, choisis une photo plus simple' : '';
    console.log(`${source} (${ko(octets.length)}) → ${base}.webp ${ko(webp.length)}, ${base}.jpg ${ko(jpeg.length)}, ${image.width} × ${image.height} px${alerte}`);
  }
  console.log('\nOriginaux rangés dans photos-originales/. Pense à noter le lien et l\'auteur de chaque photo dans LICENCES.md.');
}

main().catch((erreur) => {
  console.error('Échec :', erreur.message);
  process.exit(1);
});
