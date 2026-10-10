// Diffusion des images stockées en base : GET /fichiers/:id
const express = require('express');
const db = require('../db/pool');
const { chargerUtilisateur } = require('../middleware/auth');

const router = express.Router();
const FORMAT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get('/:id', async (req, res, next) => {
  if (!FORMAT_UUID.test(req.params.id)) return res.status(404).end();

  // La même requête dit si l'image est la photo d'un message privé, et de quelle conversation.
  const { rows } = await db.query(
    `SELECT f.type_mime, f.donnees, m.id AS message_id, m.masque, c.id AS conversation_id, c.type, c.membre_a, c.membre_b
       FROM fichiers f
       LEFT JOIN messages m ON m.fichier_id = f.id
       LEFT JOIN conversations c ON c.id = m.conversation_id
      WHERE f.id = $1`,
    [req.params.id],
  );
  const fichier = rows[0];
  if (!fichier) return res.status(404).end();

  // Photo d'un message privé : seuls les deux membres de la conversation peuvent la voir, même si quelqu'un
  // d'autre a obtenu son adresse (lien copié, historique du navigateur…). Pour tout autre visiteur, elle
  // « n'existe pas » (404) : on ne confirme même pas qu'il y a une photo à cette adresse.
  if (fichier.message_id) {
    await new Promise((resolve, reject) => { chargerUtilisateur(req, res, (err) => (err ? reject(err) : resolve())); });
    const moi = req.utilisateur;
    let dedans = Boolean(moi && moi.email_confirme_le);
    if (dedans && fichier.type === 'groupe') {
      // Photo envoyée dans un groupe : seulement pour ses membres ACTUELS (quelqu'un qui a quitté ne la voit plus).
      const { rowCount } = await db.query(
        'SELECT 1 FROM conversation_membres WHERE conversation_id = $1 AND membre_id = $2 AND quitte_le IS NULL',
        [fichier.conversation_id, moi.id],
      );
      dedans = rowCount > 0;
    } else if (dedans) {
      dedans = [fichier.membre_a, fichier.membre_b].includes(moi.id);
    }
    if (!dedans || fichier.masque) return res.status(404).end();
    // « private » : le navigateur du membre peut la garder, pas un cache partagé (proxy d'opérateur, cybercafé).
    res.set({ 'Content-Type': fichier.type_mime, 'Cache-Control': 'private, max-age=31536000, immutable' });
    return res.send(fichier.donnees);
  }

  res.set({
    'Content-Type': fichier.type_mime,
    // Une image ne change jamais : une nouvelle photo reçoit un nouvel identifiant.
    // Le navigateur peut donc la garder en cache un an, ce qui économise les données mobiles.
    'Cache-Control': 'public, max-age=31536000, immutable',
  });
  return res.send(fichier.donnees);
});

module.exports = router;
